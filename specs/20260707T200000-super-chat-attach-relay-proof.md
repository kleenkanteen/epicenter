# Super Chat AttachRelay proof waves

- **Status:** Draft
- **Date:** 2026-07-07
- **Relates:** ADR-0115 (the decision this proves), ADR-0080, ADR-0079, ADR-0113, ADR-0086, trust-model.md
- **Nature:** Execution scaffolding for ADR-0115. Proof waves only; waves 1 and 2 have landed. When the remaining waves land, harvest any durable refinement into ADR-0115 and delete this spec (two-state lifecycle).

This spec sequences the smallest proofs that the AttachRelay is endpoint-addressed, content-blind, and not the deleted relay floor. Each wave has one verification target. The waves are ordered so the plane separation and the anti-resurrection guard land before any network or crypto risk.

## Invariant the whole sequence protects

Epicenter forwards sealed bytes between two authenticated endpoints of one principal, addressed by `principalId`, `hostId`, `deviceId`, and `attachId`, and never by a route name. The relay reads no session frames and holds no keys.

## Proof waves

### Wave 1: endpoint-addressed forwarding (folded into wave 2)

Desktop holds a host endpoint; a browser client and a CLI client each attach by `hostId`; the relay matches the pair by principal and forwards bytes. Two clients share one host session (extends the existing two-socket test at `apps/super-chat/src/server.test.ts:310`).

Verification target: both clients see the same host snapshot and either can approve, and the routing carries no route name, only the endpoint quadruple.

Landed shape: originally proven on an unauthenticated loopback `fetch` transport. That transport had no production caller and was a second principal-resolution model, so it was deleted in wave 2; these proofs now run on the one authenticated mount in `apps/super-chat/src/attach-relay-self-host.test.ts`.

### Wave 2: self-host symmetry (landed)

Point the same desktop and client at a self-hosted instance (a URL and an `INSTANCE_TOKEN`, ADR-0075). "No code change" is the product-surface promise: a user points both ends at a self-host URL and token and attaches as on loopback. The repo work is mounting and authenticating the shared relay, not a self-host-only relay: the coordinator (`attach-relay/core.ts`) is unchanged.

Landed shape: the self-host Bun entry (`apps/self-host/server.ts`) mounts the same relay behind the operator bearer via `mountAttachRelayApp`. The mount resolves the bearer server-side (`createEnvTokenResolver` -> the literal `instance` principal) and stamps `principalId` onto the socket, so a query `principalId` is never trusted on the authenticated surface. Rooms and the relay share one `Bun.serve` through `mergeBunWebSocketHandlers`, which dispatches each socket to its backend by a `surface` tag on `ws.data` (a server-side dispatch tag, never a wire or addressing field). The credential rides `Authorization` or the `bearer.<token>` subprotocol, the same two channels rooms reads, and the 101 echoes only the main subprotocol. The wave-1 unauthenticated loopback `fetch` path was deleted here: it had no production caller (the desktop always dials out to an authenticated rendezvous), and keeping it meant carrying two principal-resolution models. Its multi-client and cross-client-approval proofs were re-homed onto the authenticated mount, so one principal model remains.

Deferred, not built here: the Cloudflare-DO relay backend (the self-host Worker gets no attach mount yet, only the Bun entry does); the readable WebSocket close-code on auth failure (a plain 401 is fail-closed, and wave 3 replaces this auth model with per-device grants). Cloud attach stays unmounted until wave 4 sealing.

Verification target (met): attach works against self-host exactly as against loopback, proving "just works after sign-in"; a wrong or missing token cannot attach (fail-closed behind `INSTANCE_TOKEN`); two ends with different query `principalId`s still pair, proving the principal is resolved server-side. See `apps/super-chat/src/attach-relay-self-host.test.ts`.

### Wave 3: pairing and device grant (account and device layer)

Replace the single per-launch Super Chat token with a per-device grant. Pair a second device by QR or account-mediated challenge; the desktop approves; revoke the device and confirm the bearer is dead on the next connect. Add an opt-in auto-allow for the principal's own devices.

Verification target: the desktop owns a revocable allowlist, and revocation kills attach without touching the sync plane.

### Wave 4: authenticated content-blind sealing (Cloud gate)

Add key agreement authenticated to the device grant, plus AEAD keyed from it. Cloud always seals; the relay observes only ciphertext and the envelope. This wave gates Cloud: no Cloud attach ships before it lands, because until it does the content-blind claim is false.

Verification target: assert no prompt, tool result, or approval byte is readable at the relay; assert a test relay that substitutes its own keys is rejected (no man-in-the-middle); confirm a lost key recovers by re-pairing.

### Wave 5: directory presence guard (no routes)

The host advertises a directory entry of `hostId`, label, and status only, with no capability, route, or action field. With one consumer, an attachable host is a Super Chat host by definition, so no capability label is needed.

Verification target: assert the presence schema rejects any capability-shaped, route-shaped, or action-shaped field (PR #2277's guard holds), so the directory cannot grow into a capability registry.

### Wave 6: source-plane tool and desktop-offline behavior

Add a read-only iMessage tool to the host catalog (memo-3 shape); ask from the phone over the sealed relay; the answer streams and the finished message syncs as transcript. Then sleep the desktop.

Verification target: no workspace table ever gains a source row, and with the desktop asleep the phone reads synced history but cannot ask a new local-source question. Confirm "online but unreachable" is a distinct state from "offline."

## What must not appear in any wave

- A route name in the relay's addressing (only `principalId`, `hostId`, `deviceId`, `attachId`).
- A route table, an `exposedRoutes` or `capabilities` presence field, or client auto-mount.
- MCP `tools/list` or `tools/call` carried over the relay as a platform surface.
- A CLI `tools`, `call`, or `--relay-expose` verb.
- A second product consumer of the primitive (that requires a new ADR, ADR-0086's bar).
- Any relay code path that parses a Super Chat command or holds a session key.
