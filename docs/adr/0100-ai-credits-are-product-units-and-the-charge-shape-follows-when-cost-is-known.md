# 0100. AI credits are product-priced units, and the charge shape follows whether cost is known before the call

- **Status:** Accepted
- **Date:** 2026-07-02
- **Relates:** [ADR-0054](0054-an-inference-backend-is-the-metered-gateway-or-a-custom-server.md) (the metered hosted gateway these credits price; house-key-only, no BYOK bypass), [ADR-0053](0053-the-epicenter-bearer-is-an-audience-scoped-credential.md) (the audience-scoped bearer that authorizes metering)

## Context

The hosted gateway meters every AI call ([ADR-0054](0054-an-inference-backend-is-the-metered-gateway-or-a-custom-server.md)), but "meter" was never pinned to a unit. Two failure modes bracket the design. Request-unit billing (one credit per call regardless of work, the model GitHub Copilot is retreating from) prices a two-second clip the same as a thirty-minute recording. Raw provider pass-through (bill the user Autumn's cents-per-token) makes spend unpredictable and leaks provider pricing into the product. Between them sits the real constraint: some AI costs are known before the call (a chat model has a fixed per-call credit price) and some are not (a transcription's cost is its audio duration, known only after the provider returns). A billing shape that ignores that split either over-charges cheap calls or cannot fail closed on expensive ones.

## Decision

An Epicenter AI credit is a predictable product unit, not a request count and not a provider cost. How a call charges is dictated by whether its cost is known before the provider runs.

- **Cost known before the call (chat): reserve the exact amount.** The model's catalog credit price is taken as an Autumn lock before the provider call, then confirmed on success or released on failure. The gate is exact: a wallet that cannot cover this model's price fails closed before any provider spend.
- **Cost unknown before the call (STT): gate on a non-empty wallet, then meter by duration.** Transcription is priced per transcribed minute (rounded up, floor of one credit). Before the provider call, a cheap check refuses an empty wallet (or a provider outage that hides the balance). After a 200, the real per-minute charge is tracked off the after-response queue from the duration the gateway returns.
- **Pre-provider billing fails closed; post-success metering never fails the user's response.** If entitlement cannot be verified before spend, the call is rejected (`failOpen: false`). Once the provider has answered the user, settling the charge is best-effort telemetry: its failure is swallowed, never surfaced as an error to a browser that already holds its result.

STT is deliberately not a fixed per-call reservation. Its cost profile is unlike chat's, and forcing it into chat's reserve-exact shape is rejected below.

## Consequences

- **Two honest billing shapes, not one symmetric one.** Chat and STT charge through different code paths (`reserveAiChat` with a lock versus `checkAiCredits` plus `trackAiTranscription`) because their cost profiles differ. This is deliberate asymmetry; a later reader should not "unify" them.
- **STT's pre-gate is structurally weaker than chat's, and that is inherent.** Because duration is unknown up front, the STT gate can only prove "some credits exist," not "enough for this call." Overspend is possible on the one call that tips a near-empty wallet negative, bounded by in-flight concurrency. A reservation lock would tighten it and is deferred; it is not a defect to remove by abandoning duration pricing.
- **The metering path depends on Autumn parsing balance responses that legitimately contain nulls.** A metered feature that only feeds a credit system (`ai_usage` into `ai_credits`) reports `ai_usage: null` in `track` and `check` responses. `autumn-js` must be at a version whose response schema treats those map values as nullable (1.2.33 or later; the repo pins `^1.2.34`). Below that, a successful 200 charge throws a client-side `ResponseValidationError` after the fact. Customer-read responses omit null-balance features, so only the `track` and `check` path needs the nullable schema.
- **Post-success metering can move to Autumn async usage events later.** Because settling is already best-effort and tolerant of eventual consistency, the STT charge can migrate from synchronous `track()` (200 with a balance body) to Autumn's async usage-event ingestion (202, no balance body), removing the response-validation surface entirely. That is a metering-path semantics change, taken as its own follow-up, not justified as a bug fix (the nullable schema already removes the failure).
- **Provider pricing stays out of the product.** Users see credits, never tokens or cents. The credit-to-provider-cost margin is a catalog concern (`ai-model-pricing.ts`), invisible at the billing boundary.

## Considered alternatives

- **Fixed per-call STT reservation** (one credit reserved and confirmed per transcription, mirroring chat's lock). Rejected: it makes "fail closed before spend" clean but prices a thirty-minute recording identically to a two-second clip, which is the request-unit problem this ADR exists to avoid. Accurate product units beat a tidy symmetric gate.
- **Raw provider pass-through** (bill Autumn's per-token or per-minute provider cost directly). Rejected: unpredictable user-facing spend, and provider pricing leaking into the product; credits exist precisely to decouple the two.
- **One unified metered call shape for chat and STT.** Rejected: chat cost is known pre-call and STT cost is not, so a single shape must either over-charge cheap calls or drop the pre-spend gate. The split is the honest model.
