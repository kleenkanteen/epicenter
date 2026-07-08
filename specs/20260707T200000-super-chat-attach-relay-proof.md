# Super Chat AttachRelay proof waves

- **Status:** Draft
- **Date:** 2026-07-07
- **Relates:** ADR-0115 (the decision this proves), ADR-0080, ADR-0079, ADR-0113, ADR-0086, trust-model.md
- **Nature:** Execution scaffolding for ADR-0115. Proof waves only; waves 1-5 have landed. When the remaining waves land, harvest any durable refinement into ADR-0115 and delete this spec (two-state lifecycle).

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

### Wave 3: pairing and device grant (account and device layer) (landed)

Replace the single per-launch Super Chat token with a per-device grant. Pair a second device by QR or account-mediated challenge; the desktop approves; revoke the device and confirm the bearer is dead on the next connect. Add an opt-in auto-allow for the principal's own devices.

Verification target (met): the desktop owns a revocable allowlist, and revocation kills attach without touching the sync plane.

Landed shape: a `createDeviceGrantStore()` (`packages/server/src/attach-relay/device-grants.ts`) holds the revocable per-device allowlist beside the attach mount, never inside the relay coordinator (which stays grant-blind). Its `resolveBearerPrincipal` is a plain `ResolveBearerPrincipal`, so `mountAttachRelayApp` closes over it with no change (the swap wave 2's JSDoc predicted); the attach coordinator, socket-data shape, wire contracts, and connect URL are all untouched. The operator token no longer authenticates an attach connect: it administers the allowlist through `mountAttachGrantsApp` (`/attach/grants` mint/list/revoke, `packages/server/src/attach-relay/grants-app.ts`), so the two credentials split cleanly with no fallback path. A connect carries a device grant as `bearer.<grant>`; the mount resolves it to the one instance principal and stamps that principal server-side, so a query `principalId` stays untrusted. `apps/self-host/server.ts` wires both mounts. Proofs run on the one authenticated surface: `apps/super-chat/src/attach-relay-self-host.test.ts` (pair, share, unpaired-refused, revoke-dies-next-connect, operator-only admin) and `packages/server/src/attach-relay/device-grants.test.ts` (mint/resolve/revoke unit).

The grant secret is a strong random URL-safe token, hashed at rest (SHA-256): `mint` returns it once (the QR/paste pairing payload), and resolution hashes the presented bearer and looks the digest up, so a forged grant needs a preimage of the digest (the same argument the operator token's constant-time compare rests on). Pairing IS the out-of-band handoff of that secret; no separate challenge/response handshake was needed.

Deferred, not built here (smallest model): the grant is not bound to the connect's query `deviceId` (recorded at mint for the operator's revoke-by-device list, but the relay's `deviceId`/`attachId` stay opaque addressing labels as in wave 2); grants are not role-scoped (any live grant can host or attach, which on a single-principal instance only spans the operator's own devices); revocation kills future connects, not live sockets; the store is in-memory, so a restart re-pairs devices (persisting beside the rooms is a later refinement); and "auto-allow the principal's own devices" is a desktop-side self-mint on a single-principal instance, not a server seeding mode.

### Wave 4: authenticated content-blind sealing (Cloud gate) (landed)

Add key agreement authenticated to the pairing, plus AEAD keyed from it. Cloud always seals; the relay observes only ciphertext and the envelope. This wave gates Cloud: no Cloud attach ships before it lands, because until it does the content-blind claim is false.

Verification target (met): assert no prompt, tool result, or approval byte is readable at the relay; assert a test relay that substitutes its own keys is rejected (no man-in-the-middle); confirm a lost key recovers by re-pairing.

Landed shape: a Super Chat sealing module (`apps/super-chat/src/attach-relay-seal.ts`) owns all crypto and lives in the adapters, never in the relay package. Per attached client endpoint, host and client run a fresh ephemeral ECDH (P-256, Web Crypto) and derive per-direction XChaCha20-Poly1305 keys plus a MAC key from `HKDF(salt = PSK, ikm = ECDH shared)`; the handshake is authenticated by PSK-keyed HMAC key-confirmation over a transcript of both ephemeral public keys, so a relay that substitutes a key fails the confirmation and no session forms. Handshake and sealed frames both ride the existing opaque `payload` string (`{ k: 'hs' }` / `{ k: 'seal', n, ct }`), so `attach-relay/core.ts` is untouched and stays byte-, key-, and frame-blind. Sealing is opt-in on both adapters (`attachHostToRelay` `sealing.resolvePsk`, `createAttachRelayClient` `sealing.psk`); absent, the plaintext path is unchanged, which is the self-host fail-closed opt-out. Nonces are per-direction monotonic counters, receiver rejects a non-increasing counter. Proofs: `apps/super-chat/src/attach-relay-seal.test.ts` (end-to-end sealed share, ciphertext opacity at the relay for prompt/tool/approval, key-substitution MITM rejected, wrong-PSK stalls and re-pair recovers, two sealed clients each with their own PSK).

Durable refinement (harvested into ADR-0115): the PSK is a distinct pairing secret from the wave-3 relay grant, because the relay sees the grant on connect and a secret the relay sees cannot defeat a malicious relay. The grant authenticates the socket to the relay; the PSK authenticates the peer end to end.

Deferred, not built here (smallest model): the PSK is an injected pairing artifact, not minted here (deriving both the grant and the PSK from one pairing secret is an account-layer refinement); the Cloudflare-DO relay backend and the actual Cloud attach mount stay unbuilt (this wave proves the sealing gate, it does not open Cloud); "Cloud always seals" as an enforced deployment policy (the adapter supports sealing, forcing it on for the Cloud wiring is that mount's job); and mapping an endpoint to its PSK by the transport `deviceId` is a test convenience, since the relay `deviceId` is still untrusted addressing (a wrong id yields a wrong PSK and a fail-closed stall, never a wrong-peer session).

### Wave 5: directory presence guard (no routes) (landed)

The host advertises a directory entry of `hostId`, label, and status only, with no capability, route, or action field. With one consumer, an attachable host is a Super Chat host by definition, so no capability label is needed.

Verification target (met): the presence schema rejects any capability-shaped, route-shaped, action-shaped, or tool-shaped field (PR #2277's guard holds), so the directory cannot grow into a capability registry.

Landed shape: a closed `AttachHostDirectoryEntry` schema (`packages/server/src/attach-relay/host-directory.ts`) of exactly `hostId`, `label`, and `status`, built with arktype's `.onUndeclaredKey('reject')`, so any undeclared key fails to parse and there is nowhere for a route/capability/action/tool field to land. It lives in the account-and-device layer beside the device grants, never inside the relay coordinator (`core.ts` and `contracts.ts` are untouched, so the relay stays directory-blind). `status` is `online | offline` only; "online but unreachable" is deferred to wave 6. This wave is a schema plus its guard tests: no runtime mount consumes the entry yet, so no host publishes one, matching "prefer a tiny schema over a live product directory until a consumer earns it." Proof: `packages/server/src/attach-relay/host-directory.test.ts` (valid online/offline entries parse; missing/out-of-enum `status` and empty/missing `hostId` fail closed; every capability-, route-, action-, and MCP/tool-shaped extra field, and a full capability catalog, are refused).

Deferred, not built here (smallest model): the directory store, the publish/discover wire, and the mount that surfaces entries to a client (a host does not advertise itself anywhere yet); the `unreachable` status (wave 6); binding an entry to a device grant's `deviceId` (the relay's `deviceId` stays opaque addressing, as in waves 2-4).

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
