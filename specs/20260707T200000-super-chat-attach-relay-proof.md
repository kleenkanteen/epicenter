# Super Chat AttachRelay proof waves

- **Status:** Draft
- **Date:** 2026-07-07
- **Relates:** ADR-0115 (the decision this proves), ADR-0080, ADR-0079, ADR-0113, ADR-0086, trust-model.md
- **Nature:** Execution scaffolding for ADR-0115. Proof waves only; wave 1 has landed. When the remaining waves land, harvest any durable refinement into ADR-0115 and delete this spec (two-state lifecycle).

This spec sequences the smallest proofs that the AttachRelay is endpoint-addressed, content-blind, and not the deleted relay floor. Each wave has one verification target. The waves are ordered so the plane separation and the anti-resurrection guard land before any network or crypto risk.

## Invariant the whole sequence protects

Epicenter forwards sealed bytes between two authenticated endpoints of one principal, addressed by `principalId`, `hostId`, `deviceId`, and `attachId`, and never by a route name. The relay reads no session frames and holds no keys.

## Proof waves

### Wave 1: endpoint-addressed forwarding, plaintext, loopback

Desktop holds a host endpoint; a browser client and a CLI client each attach by `hostId`; the relay matches the pair by principal and forwards bytes. Two clients share one host session (extends the existing two-socket test at `apps/super-chat/src/server.test.ts:310`).

Verification target: both clients see the same host snapshot and either can approve, and the routing carries no route name, only the endpoint quadruple.

### Wave 2: self-host symmetry

Point the same desktop and client at a self-hosted instance (a URL and an `INSTANCE_TOKEN`, ADR-0075) with no code change.

Verification target: attach works against self-host exactly as against Cloud, proving "just works after sign-in" and the self-host plaintext posture (the operator is the user).

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
