# "Identity is the partition" collapse: execution handoff

You are the orchestrator for a greenfield refactor of Epicenter's ownership
model. You plan waves, spawn subagents to implement them, review their diffs,
and keep the tree green. This document is self-contained: every decision,
file, and verification you need is in here; no prior conversation exists for
you to consult. Read the whole document before any edit.

## Goal

Collapse Epicenter's two deployment seams (`resolveUser` + `OwnershipRule`)
into one: **partition = authenticated principal's id, by definition**. Delete
the ownership vocabulary from the library, the wire, and the clients.

Product sentence to build toward:

> A server authenticates principals; every principal owns the partition named
> by its id; a deployment differs only in how it authenticates principals
> (Better Auth mints N principals on Cloud; one env-token bearer mints 1
> principal on a self-hosted instance).

## End state, concretely

- `OwnershipRule` union, `perUser`, `instance`, `resolveOwnerId`, and
  `createRequireOwnership` no longer exist. No mount takes an `ownership`
  option; no entry file declares `const ownership = ...`.
- One id brand: **`PrincipalId`** in `packages/identity` (MIT; it must stay
  there for the license firewall). `OwnerId`/`asOwnerId` rename to
  `PrincipalId`/`asPrincipalId`; `UserId`/`asUserId` in `packages/auth`
  DELETE (they merge into the identity brand). `INSTANCE_OWNER_ID` renames to
  `INSTANCE_PRINCIPAL_ID`; its VALUE stays the byte-pinned `'instance'`.
- `AuthUser` renames to `Principal = { id: PrincipalId, email?: string }`.
  `email` is present on Cloud (from Better Auth) and ABSENT on an instance:
  the fabricated `owner@instance.local` and the offline CLI's fabricated
  `email: ''` both die. Nobody invents an email anywhere.
- The server seam is `ResolvePrincipal: (c) => Result<Principal, ...>`
  (rename of `ResolveUser`; same injection point, ADR-0066). Context carries
  `c.var.principal`; the partition is `c.var.principal.id`. `c.var.user` and
  `c.var.ownerId` no longer exist.
- `/api/session` returns `{ principalId, email? }` flat: no `user` object, no
  `ownerId` field. WHY `email?` is here and not a separate endpoint:
  `auth.getProfile()` is implemented via the session read
  (`packages/auth/src/read-api-session.ts:96`, `getProfileVia` returns
  `session.user`), and it is the ONLY live source of the email the Cloud
  account popover and CLI `auth status` display; Better Auth's own endpoints
  do not accept Epicenter OAuth bearers. A dedicated `/api/profile` route was
  considered and REJECTED (a new route for one field fails the earned
  trigger; add it when profile facts grow past email). When `email` is
  absent, `getProfile` returns `ProfileUnavailable` and the popover falls
  back to instance identity (baseURL), which is the honest display anyway.
- Clients persist ONLY `{ grant, principalId }` (`PersistedAuth`); email is
  never cached. `AuthState` signed-in/reauth arms carry `principalId`.
- Wire URLs carry no owner: `/api/rooms/:roomId`, `/api/blobs`,
  `/api/blobs/:sha256` (currently `/api/owners/:ownerId/...`).
- The instance principal's id becomes `'instance'` (today
  `'instance-owner'`, deliberately different from the partition constant;
  that pun dies). `INSTANCE_PRINCIPAL` (the AuthUser constant) deletes; the
  resolver returns `{ id: INSTANCE_PRINCIPAL_ID }`.
- **Durable bytes take the clean-break shape**: there are zero users and no
  durable data to preserve, so R2 keys (`principals/<id>/blobs/<sha256>`), DO
  names (`principals/<id>/rooms/<roomId>` via `doName`), self-host Bun room
  SQLite filenames (`sha256(doName(...))`), IndexedDB keys
  (`epicenter/<server>/principals/<id>/<guid>`), and HKDF info bytes
  (`principal:${label}` in `packages/encryption/src/derivation.ts`) all move
  to principal vocabulary. There is no compatibility exception for the old
  `owners/` or `owner:${label}` shape.
- `docs/articles/identity-and-partition-are-different-axes.md` is KEPT with a
  dated postscript pointing at the new ADR (owner-confirmed; the article
  records a real position and its overturning is useful history).

## Why (decision record; do NOT reopen these)

1. **Split rejected.** Forking `apps/self-host` off `packages/server` deletes
   no concepts, only the compiler enforcing the shared wire protocol (one
   client implementation, `packages/workspace/src/document/transport.ts`,
   speaks to both deployments). The shared package stays.
2. **The two seams are 100% correlated.** No deployment mixes Better Auth
   with `instance` or the bearer with `perUser`. Two knobs, one decision, so
   the second knob (`ownership`) is deleted, not parameterized differently.
3. **Refusal that buys the collapse: an instance has exactly one tenant.**
   No per-person identity on a self-hosted box, ever. Offboarding = rotate
   `INSTANCE_TOKEN`. Trigger to revisit: recurring rotation pain in a real
   team adds a credential registry mapping many named tokens to the SAME
   principal id; per-person server-side attribution means that user has
   outgrown the instance (Cloud story, not a patch).
4. **Refusal: no owner echo on the wire.** The 403 `OwnerMismatch` tripwire
   dies with the URL segment. Partition bugs become auth bugs; auth is the
   single audited path. Trigger to revisit: cross-owner access as a product
   feature.
5. **Self-hosted multi-tenant refused.** Want isolation, run a second
   instance. (Support refusal, not a moat; AGPL already allows deploying
   `apps/api`.)
6. **Zero-users and no-durable-data assumptions are in force** (owner's
   explicit call, including the owner's own Cloud/self-hosted clients). The
   wire-immutability claims in `packages/constants/src/api-routes.ts` and
   `packages/sync/src/room-route.ts` headers are released. Durable namespace
   compatibility is also released. Clients update in lockstep, same branch.
   Old app builds against an updated server may fail to sync until updated;
   data written under the old durable shape is allowed to become unreadable
   because there is no data to preserve.
7. **Forward constraint: a principal is not necessarily a human.** A future
   hosted "team brain" maps N member accounts to ONE shared principal (a
   membership row inside the hosted resolver decides which principal a
   session resolves to). Nothing in this refactor may assume one account per
   partition or that the principal names a person. The new ADR names this as
   the seam the collapse deliberately enables.
8. **Brand name settled: `PrincipalId`** (2026-07-02, file-grounded review +
   greenfield pass). `UserId` is a present-tense category error (the shipping
   instance principal `asUserId('instance-owner')` already violates the
   brand's "issued by Better Auth" JSDoc) and guarantees a second wire rename
   after the zero-users window closes. Better Auth keeps owning `user`: its
   `user` table and `session.user` remain live, and Epicenter OAuth bearers
   cannot be handed to Better Auth profile endpoints. `OwnerId` names the
   output of the mapping being deleted, and leaving live `owners/` durable
   names would make the old concept look intentional instead of deleted.
   `PrincipalId` promotes the word ADR-0075 and the axes article already use
   precisely ("verifier-shaped: verify(presented) -> principal | null"); the
   invariant "partition id == authenticated principal id" reads as a
   definition only under this name. Rejected: `PartitionId` (names storage;
   wrong for a verifier's return type), `ActorId` (nonstandard synonym),
   `AccountId` (collides with Better Auth's `account` table = OAuth provider
   grants).
9. **Wire changes are one atom.** The route builders (`API_ROUTES.blobs.*`,
   `ROOM_ROUTE`) drop their `ownerId` parameter, which breaks every consumer
   in the same monorepo typecheck; the session shape change breaks every
   auth client the same way. Splitting wire from clients cannot leave the
   tree green, so Wave 3 lands the contract and all consumers together.

## Provenance (one line each; do not go looking for more)

- PR #2251 (merged): vocabulary rename that produced today's `perUser` and
  `instance` constants and dropped a dead `ownerId` field. Superseded by this
  plan; nothing to recover from it.
- PR #2272 and the progressive sign-in wave train (merged): rewrote app
  boot/session surfaces; it is why the principal-change reload now lives in
  `packages/svelte-utils/src/reload-on-principal-change.ts` (shared by
  whispering, opensidian, and vocab `+layout.svelte`), not under
  `apps/whispering/`.

## Stop-and-ask rules (owner: Braden)

1. **Mandatory review stops**: stop and wait for Braden's review after Wave 0
   (spec + ADR draft + frozen inventory) and after Wave 2 (server core; this
   is where misunderstanding compounds). Waves 3-5 run without a stop once 2
   is approved.
2. **Target-byte files; any unplanned output shape = stop immediately**:
   `packages/encryption/src/derivation.ts` (HKDF `principal:${label}` info
   bytes), `packages/server/src/principal.ts` output strings
   (`doName`/`blobKey`/`blobPrincipalPrefix`), the Cloudflare DO `idFromName`
   derivation, `packages/workspace/src/document/local-yjs-key.ts` output
   strings, and the Bun registry's `sha256(roomName)` file naming. These
   files intentionally change from owner vocabulary to principal vocabulary
   once. After Wave 0 pins the target strings, later waves must keep those
   target strings byte-identical. The orchestrator reviews these diffs by
   hand, never delegates them blind.
3. **`INSTANCE_PRINCIPAL_ID` value**: the bytes `'instance'` are load-bearing
   in every durable surface above. Renaming the export is the plan; changing
   the value is forbidden.
4. **Open-PR race gate**: before Wave 1, run
   `gh pr list --state open --json number,title,files --limit 50` and check
   for open PRs touching `packages/auth`, `packages/svelte-utils`, or app
   boot surfaces. As of 2026-07-02, **PR #2255 (harden Whispering hosted
   auth transport) is OPEN and rewrites the same auth-transport surface**;
   if it is still open, stop and ask Braden whether to wait or coordinate.
5. Destructive git (force-push, `--hard`, branch deletion) needs explicit
   approval. Never `git add .` / `git add -A`; commit with explicit paths.

## Wave plan

Each wave ends with the tree green (`bun run --filter '*' typecheck` + tests
in touched packages) and its own commit(s). Work in a fresh worktree:

```
git worktree add ~/Code/epicenter-worktrees/identity-is-the-partition -b feat/identity-is-the-partition origin/main
```

### Wave 0: recon, spec, ADR draft, target byte pins (orchestrator only)

- Re-run the inventory greps against fresh main and diff against the frozen
  inventory below; investigate any new file before proceeding:
  `rg -l "OwnershipRule|perUser|resolveOwnerId|requireOwnership"`,
  `rg -l "OwnerId|asOwnerId|INSTANCE_OWNER_ID|ownerId"`,
  `rg -l "\bUserId\b|asUserId|ApiSessionResponse|PersistedAuth|c\.var\.user"`,
  `rg -l "owners/:ownerId|/api/owners"`.
- Write the implementation plan as a spec in `specs/` (status `Draft`, then
  `In Progress`; `scripts/check-doc-hygiene.ts` enforces the lifecycle; the
  spec is DELETED in Wave 5 when the ADR lands).
- Draft the ADR in `docs/adr/` following `docs/adr/README.md`. CHECK THE NEXT
  FREE NUMBER at write time (this repo has a history of ADR-number
  collisions). It partially supersedes ADR-0075's identity/partition
  decoupling, reinforces ADR-0070, and revises ADR-0067 (the session/profile
  contract). Record Why items 7 and 8 and the stale-cell caveat from Wave 3.
  Read ADRs 0066, 0067, 0070, 0071, 0075, 0076 first.
- Add target pin tests asserting the clean-break durable strings, so the
  refactor diffs against executable truth, not memory:
  `doName`/`blobKey`/`blobPrincipalPrefix` outputs in
  `packages/server/src/principal.test.ts`, the IDB key shape in
  `packages/workspace/src/document/local-yjs-key.test.ts`, and the HKDF info
  bytes in `packages/encryption/src/crypto.test.ts`. The target strings use
  `principals/<id>/...` and `principal:${label}`. These tests must pass
  before AND after every subsequent wave unchanged.
- STOP for Braden's review.

### Wave 1: brand merge (types only, shapes unchanged, no behavior change)

Scope is TWO packages (the brands live in different ones):

- `packages/identity/src/identity.ts`: `OwnerId` -> `PrincipalId`,
  `asOwnerId` -> `asPrincipalId`, `INSTANCE_OWNER_ID` ->
  `INSTANCE_PRINCIPAL_ID` (value untouched). Rewrite the header JSDoc.
  Acceptance criteria for the new JSDoc: states the brand is the
  authenticated principal's id and, by definition, the partition key; states
  a person on Cloud, the literal `'instance'` on a self-hosted box; states
  the constant's bytes are pinned (HKDF label, R2 prefix, DO name, IDB key);
  contains no `perUser`-vs-`instance` derivation recipe (that distinction is
  dead; the only remaining comparison is `principalId ===
  INSTANCE_PRINCIPAL_ID`, and almost nothing should use it).
- `packages/identity/src/auth-state.ts`: arms carry `principalId`.
- `packages/auth/src/auth-types.ts`: delete `UserId`/`asUserId`; `AuthUser`
  -> `Principal = { id: PrincipalId, email?: string }` (email optional as of
  this wave; the session route still populates it everywhere until Wave 3).
  `PersistedAuth` and `ApiSessionResponse` keep their field NAMES this wave
  (`userId`/`ownerId` both typed `PrincipalId` now); their shape collapse is
  Wave 3, with their consumers.
- Mechanical ripple: every importer of the renamed symbols across the repo
  (typecheck enumerates them; see inventory). No JSON shape changes.

### Wave 2: server seam collapse

- DELETE
  <!-- doc-path-check: ignore-next-line (historical handoff: Wave 2 deleted this file) -->
  `packages/server/src/ownership.ts` and
  <!-- doc-path-check: ignore-next-line (historical handoff: Wave 2 deleted this file) -->
  `packages/server/src/middleware/require-ownership.ts` (+ its test).
- `packages/server/src/types.ts`: `ResolveUser` -> `ResolvePrincipal`
  returning `Principal`; context vars: `principal: Principal` replaces both
  `user` and `ownerId`. Rewrite topology JSDoc.
- Every `mount*` drops its `ownership` option; routes read
  `c.var.principal.id` where they read `c.var.ownerId` before:
  `routes/session.ts` (also delete the `createRequireOwnership` wiring),
  `routes/rooms.ts`, `routes/blobs.ts`, `routes/inference.ts`,
  `routes/transcription.ts`, `middleware/rate-limit.ts` (key becomes
  `c.var.principal.id`), `middleware/require-auth.ts` (resolver rename).
- Room stack: rename socket identity `userId` -> `principalId` through
  `room/contracts.ts` (`RoomUpgrade`), `room/core.ts` (`ownerOf`),
  `room/channel-router.ts` (`source: { kind: 'user', userId }` frame field:
  coordinate with Wave 3's relay protocol change or keep the wire word one
  more wave; pick ONE and note it in the wave commit), both backends
  (`backends/bun/registry.ts` `ws.data.userId`,
  `backends/cloudflare/registry.ts` + `durable-object.ts` forwarded
  `?userId=` param).
- `auth/instance-token.ts`: delete `INSTANCE_PRINCIPAL`; the resolver
  returns `{ id: INSTANCE_PRINCIPAL_ID }` (no email). Rewrite the JSDoc that
  defends identity/partition decoupling; acceptance criteria: it now states
  the principal id IS the partition by definition. If a future named-token
  registry improves instance attribution, all tokens still resolve to the same
  principal id; per-token principals would re-partition and are Cloud-shaped,
  not an instance patch (Why item 3).
- `owner.ts`: rename parameters/types to principal vocabulary; the produced
  strings use the clean-break `principals/` prefix. Update `s3-blob-store.ts`
  JSDoc to describe the principal-scoped key shape.
- Billing (hosted-only, `apps/api/worker/billing/{routes,policies,service}.ts`):
  reads `c.var.principal.id` and `c.var.principal.email`. Billing REQUIRES
  email (Autumn customer); add one boot-adjacent guard in the billing
  middleware asserting `email` is present (the hosted resolver always
  supplies it) rather than widening types.
- TEMPORARY SHIM, delete in Wave 3: `routes/session.ts` keeps emitting the
  OLD JSON shape (`{ user: { id, email }, ownerId }`) derived from
  `c.var.principal`, so auth clients stay green this wave. Mark it
  `// WAVE-3-SHIM`.
- Server tests updated: session test still asserts the old shape this wave;
  instance-token tests assert the resolver yields id `'instance'` and NO
  email; require-ownership tests deleted; target byte pins untouched and green.
- STOP for Braden's review.

### Wave 3: the wire atom (contract + every consumer, one wave)

Contract files first, then consumers fan out (subagents may parallelize only
across disjoint files):

- `packages/constants/src/api-routes.ts`: blobs patterns lose
  `/owners/:ownerId`; `url()` builders lose the `ownerId` parameter; rewrite
  the header. Acceptance criteria: keep the single-source-of-truth claim and
  the `pattern`/`prefixPattern`/`url` contract description; replace the
  "MUST match what production clients hit today" immutability paragraph with
  a dated zero-users note recording this break.
- `packages/sync/src/room-route.ts`: pattern becomes
  `/api/rooms/:roomId`, `url(baseURL, roomId)`; same header treatment.
- `packages/auth`: `ApiSessionResponse = { principalId, email? }`;
  `PersistedAuth = { grant, principalId }`; `read-api-session.ts`
  (`getProfileVia` returns `Principal` when `email` present, else
  `ProfileUnavailable`); `create-oauth-app-auth.ts` (single principalId
  compare replaces the userId+ownerId double compare);
  `same-origin-cookie-auth.ts`; `instance-token-auth.ts`;
  `persisted-auth-storage.ts`; `node/machine-auth.ts` (kill the fabricated
  `email: ''`; offline display shows principalId); `node/oob-launcher.ts`;
  `auth-contract.ts`; barrel `index.ts`.
- Server: delete the Wave 2 session shim (emit `{ principalId, email? }`,
  email from `c.var.principal.email`); route declarations follow the new
  patterns automatically via `API_ROUTES`/`ROOM_ROUTE`; relay frame field
  <!-- doc-path-check: ignore-next-line (handoff prompt names a file deleted by the relay-channel cleanup) -->
  `userId` -> `principalId` in `packages/workspace/src/relay-channel/protocol.ts`
  and its server counterpart (`room/channel-router.ts` source frames) if not
  already done in Wave 2.
- Workspace client: `document/transport.ts` (`roomWsUrl`),
  `document/http-room-sync.ts`, `document/connect-doc.ts`,
  `document/workspace.ts`, `document/local-yjs-key.ts` (rename
  `getOwnedYjsPrefix`/`createOwnedYjsKey` to principal vocabulary; output
  strings match the Wave 0 target pins), `document/attach-local-storage.ts`,
  `document/wipe-local-storage.ts`, `account/open-account-room-connection.ts`
  (one `principalId` replaces the ownerId-documented-as-userId conflation),
  `account/reserved-guid.ts` (JSDoc), `gateway/relay-route.ts`
  (`ownerUserId` -> `principalId`), `gateway/route-table.ts` (JSDoc),
  `daemon/open-account-room.ts`, `daemon/define-mount.ts`,
  `daemon/mount-runtime.ts`, `daemon/attach-mount-infrastructure.ts`,
  `config/open-epicenter-root.ts`, `config/daemon-node-id.ts` (JSDoc),
  barrel `index.ts`.
- SDK + CLI: `packages/client/src/index.ts` (`ownerId` option ->
  `principalId`; blob URLs lose the owner segment),
  `packages/cli/src/commands/blobs.ts`, `packages/cli/src/commands/up.ts`
  (`ownerUserId: accountRoom.ownerId` becomes the one principalId),
  `packages/cli/src/commands/auth.ts` (status prints email only when
  present).
- UI state: `packages/svelte-utils/src/auth.svelte.ts`,
  `to-connection.ts`, `reload-on-principal-change.ts`, package barrel;
  `packages/app-shell/src/account-popover/account-popover.svelte` (shows
  email when `getProfile` yields one, instance identity/baseURL otherwise),
  `packages/app-shell/src/sign-in-migration/create-sign-in-migration.svelte.ts`.
- Apps (consumer edits only; entry-file cleanup is Wave 4):
  `apps/whispering/src/routes/+layout.svelte`, opensidian and vocab
  `+layout.svelte` (the renamed reload import), whispering
  `lib/state/secrets.svelte.ts` (JSDoc; the HKDF info prefix is now
  `principal:`),
  `apps/tab-manager/src/lib/session.svelte.ts`.
- CI gate: update the route-string grep in `.github/workflows/ci.format.yml`
  (line ~75; pattern contains `/api/(session|owners|ai)`) to the new route
  set. It is NOT in `scripts/`; do not go looking there.
- ADR caveat to record: a stale persisted cell holding `'instance-owner'`
  fails relay admission against an upgraded server until it re-fetches
  `/api/session`; accepted under zero-users. Old encrypted payloads using the
  `owner:` HKDF info prefix are also accepted as unreadable under the
  no-durable-data assumption.

### Wave 4: deployables, dev auth, examples, benchmarks

- Four entry files, enumerated: `apps/api/worker/index.ts`,
  `apps/api/server.ts`, `apps/self-host/server.ts`,
  `apps/self-host/worker/index.ts`. Drop `const ownership = ...` and all
  ownership threading; resolvers already return `Principal`.
- `apps/api/dev-auth.ts` (+ test): `Bearer dev:<id>` resolves to
  `{ id, email: '<id>@dev.invalid' }`; keep a real email here (billing smoke
  needs one) but via the Principal shape.
- Smoke scripts: `apps/api/scripts/smoke.ts`,
  `apps/api/scripts/cli-auth-smoke.ts`, `apps/self-host/scripts/smoke.ts`
  (assert `{ principalId }`, `principalId === INSTANCE_PRINCIPAL_ID` on the
  instance, new URL shapes).
- `examples/notes-cross-peer/**` (notes.ts + both daemons),
  `packages/workspace/src/__benchmarks__/helpers.ts`,
  `packages/workspace/scripts/yjs-benchmarks/*.ts` fixtures.

### Wave 5: docs, then delete the spec

- Land the ADR (drafted in Wave 0).
- Article postscript on
  `docs/articles/identity-and-partition-are-different-axes.md`: dated,
  points at the new ADR, records that the two axes proved 100% correlated
  and the decoupling now lives inside the resolver seam; the surviving word
  (principal) is the article's own. Other articles stay stale by convention.
- Living docs sweep (these are gated by `scripts/check-doc-paths.ts`, which
  fails on citations of deleted files like `ownership.ts`; update in
  lockstep): `docs/CONTEXT.md`, `docs/architecture.md`,
  `docs/architecture/account-and-document-ownership.md`,
  `docs/trust-model.md`, `docs/guides/consuming-epicenter-api.md`,
  `docs/guides/billing-autumn-boundary.md`,
  `docs/guides/branded-types-as-helpers.md` (uses OwnerId/UserId as its
  worked example), `docs/guides/yjs-persistence-guide.md`,
  `docs/licensing/licensing-strategy.md`, ADRs 0066/0067/0070/0071/0074/
  0075/0076/0079/0089/0091 touch-ups, `docs/adr/README.md` index, root
  `AGENTS.md` ("perUser + instance seam" line), `apps/self-host/AGENTS.md`.
- Delete the Wave 0 spec (done = deletion), run
  `bun scripts/check-doc-hygiene.ts` and `bun run check:doc-paths`.

## Verification

- Per wave: `bun run --filter '*' typecheck`; `bun test` in each touched
  package; target byte pin tests green and UNCHANGED after Wave 0.
- After Wave 4, end to end: boot the self-host Bun server and run
  `apps/self-host/scripts/smoke.ts` per its header; for the api smoke there
  is NO package.json script; per its header run
  `bun run dev:bun:devauth` (in `apps/api`) then
  `bun apps/api/scripts/smoke.ts http://localhost:8788`. Connect a workspace
  client, confirm sync and blobs round-trip on the new URLs.
- Durable-bytes invariant: the Wave 0 target pins are the assertion vehicle;
  additionally eyeball one live IDB database name and one DO/SQLite room name
  after the clean-break rename.
- `bun run check:licenses` (PrincipalId must stay in MIT
  `@epicenter/identity`; `Principal`/`PersistedAuth` stay in AGPL
  `@epicenter/auth`), `bun run check:doc-paths`,
  `bun scripts/check-doc-hygiene.ts` before handoff.

## Orchestration constraints

- Subagent runtime: codex if available (its sandbox roots at the invoking
  cwd; `cd` INTO the worktree before launching, or it cannot write). If no
  codex tool is available, use general-purpose subagents, or do the wave
  yourself; the wave plan does not depend on the agent brand.
- Waves are sequential. Files within a wave fan out to parallel agents ONLY
  if disjoint; contract files (auth-types, api-routes, room-route) land
  before their consumers within Wave 3.
- Concurrent agents in one worktree scramble staging: commit with explicit
  paths only (`git commit -- <paths>`).
- Review every subagent diff yourself before committing; subagents return
  diffs, the orchestrator owns the commit. The stop-and-ask files (rule 2)
  are orchestrator-reviewed line by line.

## Repo rules that will bite here

- bun only (`bun run`, `bun test`, `bun x`).
- No `console.*` in library code (`wellcrafted/logger`).
- No em or en dashes anywhere (prose, UI strings, comments, commits); load
  the repo's writing conventions for any doc/comment text.
- AGPL/MIT boundary: `packages/server` and `packages/auth` are AGPL; never
  copy their code into MIT toolkit packages (`packages/identity`,
  `packages/workspace`, ...). `bun run check:licenses` guards dependency
  edges only.
- No AI attribution in commits. Conventional commit style; stage explicit
  paths.
- The autofix bot pushes biome formatting onto PR branches; run biome
  locally before pushing.

## Frozen inventory notes (verified 2026-07-02 against 0fddc7c84)

The wave sections above ARE the inventory; this section records only the
answers that took digging, so nobody re-derives them:

- HKDF: `packages/encryption/src/derivation.ts` info bytes move to
  `principal:${label}`; label is the partition string. Re-keying would orphan
  old ciphertext, which is accepted only because there is no durable data to
  preserve. There is also `workspace:${workspaceId}`, unrelated.
- R2 keys are built ONLY in `packages/server/src/principal.ts`
  (`blobKey`, `blobPrincipalPrefix`, plus `doName` for DO names);
  the target prefix is `principals/`; `s3-blob-store.ts` consumes keys and
  mentions the shape in JSDoc only.
- `'instance-owner'` is hardcoded in exactly one place:
  `packages/server/src/auth/instance-token.ts` (`INSTANCE_PRINCIPAL`). It
  was NEVER a durable input (only `c.var`, presence frames, relay admission,
  re-derivable cached session cells), so changing it to `'instance'` is
  safe.
- `packages/auth/src/instance-token.ts` (the non-server module) is pure
  token generation/validation and needs NO changes.
- Bun room persistence names SQLite files `sha256(doName(...))`
  (`packages/server/src/room/backends/bun/registry.ts` ~line 116), so the
  Wave 0 target `doName` output pins the SQLite filename too.
- There is no route-grep gate in `scripts/`; it is in
  `.github/workflows/ci.format.yml` (~line 75).
- `docs/spec-history.md`, `docs/release-notes/`, `docs/launches/`, and
  everything under `specs/` history are intentionally stale; do not sweep
  them.
