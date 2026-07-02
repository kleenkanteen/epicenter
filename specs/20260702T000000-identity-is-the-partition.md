# Identity Is the Partition

**Date**: 2026-07-02
**Status**: In Progress
**Owner**: Braden
**Branch**: `prinicipal`
**ADR**: [ADR-0092](../docs/adr/0092-identity-is-the-partition.md) (Proposed; flip to Accepted when Wave 5 lands)

## One Sentence

Epicenter deletes the ownership seam: the server authenticates a principal, and the partition is the principal id by definition.

## How to Read This Spec

```txt
Read first:
  One Sentence
  Target Shape
  Wave Plan
  Verification
  Review Stops

Read when implementing:
  Target Byte Pins
  Fresh Inventory
  ADR Notes
```

## Target Shape

The shared server keeps one auth injection point: `ResolvePrincipal`. It returns a `Principal` whose `id` is a `PrincipalId`. Routes read `c.var.principal.id`, and that value is the partition key. There is no `OwnershipRule`, `perUser`, `instance`, `resolveOwnerId`, `createRequireOwnership`, `c.var.ownerId`, or `c.var.user`.

Cloud and the self-hosted instance differ only in how they authenticate principals. Cloud uses Better Auth to resolve many principals and includes `email` on the principal. The self-hosted instance uses the operator bearer to resolve one principal, `{ id: INSTANCE_PRINCIPAL_ID }`, with no email. Nobody fabricates an email.

The surviving id brand is `PrincipalId`, not `UserId`. Better Auth keeps owning `user`: its `user` table and `session.user` remain live, and Epicenter OAuth bearers cannot be handed to Better Auth profile endpoints. Better Auth users are one source of principals; the instance bearer is another.

The HTTP and WebSocket wire drops the owner segment: `/api/rooms/:roomId`, `/api/blobs`, and `/api/blobs/:sha256`. Durable bytes also take the clean-break shape because there are no durable users or data to preserve. New R2 keys, Durable Object names, Bun SQLite room filenames derived from those names, IndexedDB keys, and HKDF info bytes use the principal vocabulary: `principals/<id>/...` and `principal:${label}`.

## Review Stops

- Stop after Wave 0 for Braden to review this spec, the draft ADR, the fresh inventory, and the target byte pins.
- Stop after Wave 2 for Braden to review the server seam collapse.
- Do not start Wave 1 until the open PR race gate has been run:
  `gh pr list --state open --json number,title,files --limit 50`.

## Target Byte Pins

Wave 0 pins the clean-break strings that later waves must not move. These are not compatibility pins for old data. They are target-shape pins so the refactor cannot accidentally keep `owners/` alive at the durable boundary.

- [x] `packages/server/src/owner.test.ts` asserts `doName`, `blobKey`, and `blobOwnerPrefix` under `principals/<id>/...` for a per-user id and `INSTANCE_OWNER_ID`.
- [x] `packages/workspace/src/document/local-yjs-key.test.ts` asserts `getOwnedYjsPrefix` and `createOwnedYjsKey` under `epicenter/<server>/principals/<id>/...` for a per-user id and `INSTANCE_OWNER_ID`.
- [x] `packages/encryption/src/crypto.test.ts` pins exact `deriveKeyring` output bytes for labels `alice` and `instance`, with comments naming the HKDF info contract: `principal:${label}`.

Any later wave may rename parameters, types, and helper names in these files. The new output strings must stay byte-identical.

## Fresh Inventory

Re-run on 2026-07-02 in this worktree. The untracked `prompt.md` appears in each grep because it is the handoff source, not implementation.

### `OwnershipRule|perUser|resolveOwnerId|requireOwnership`

```txt
AGENTS.md
README.md
apps/api/README.md
apps/api/server.ts
apps/api/worker/index.ts
apps/self-host/AGENTS.md
docs/CONTEXT.md
docs/adr/0070-self-host-adds-no-new-ownership-or-auth-mode.md
docs/adr/0075-self-host-is-a-single-partition-instance-behind-one-operator-supplied-bearer.md
docs/articles/identity-and-partition-are-different-axes.md
packages/constants/src/api-routes.ts
packages/identity/src/identity.ts
packages/server/src/bun.ts
packages/server/src/index.ts
packages/server/src/middleware/rate-limit.test.ts
packages/server/src/middleware/rate-limit.ts
packages/server/src/middleware/require-ownership.test.ts
packages/server/src/middleware/require-ownership.ts
packages/server/src/ownership.ts
packages/server/src/routes/blobs.ts
packages/server/src/routes/inference.ts
packages/server/src/routes/rooms.ts
packages/server/src/routes/session.ts
packages/server/src/routes/transcription.ts
packages/server/src/types.ts
prompt.md
specs/20260624T223835-privacy-is-a-deployment-self-host-and-relay-anchor-gradations.md
```

### `OwnerId|asOwnerId|INSTANCE_OWNER_ID|ownerId`

The live implementation matches the handoff and adds many historical docs/specs. Later docs work should update living docs, ADR touch-ups named by Wave 5, and current tests/code. Historical specs, release notes, and stale articles are intentionally not swept unless Wave 5 names them.

Key live files:

```txt
apps/api/README.md
apps/api/scripts/cli-auth-smoke.ts
apps/api/scripts/smoke.ts
apps/self-host/AGENTS.md
apps/self-host/scripts/smoke.ts
apps/whispering/src/lib/state/secrets.svelte.ts
docs/CONTEXT.md
docs/adr/README.md
docs/adr/0067-auth-owns-the-session-endpoint-the-data-client-is-owner-scoped.md
docs/adr/0074-the-secret-vault-is-an-owner-scoped-synced-store-encrypted-under-a-server-derived-keyring.md
docs/adr/0075-self-host-is-a-single-partition-instance-behind-one-operator-supplied-bearer.md
docs/adr/0089-the-blob-store-is-a-presigned-s3-kernel-and-the-bucket-is-its-only-index.md
docs/adr/0091-blobs-trade-a-file-for-a-durable-content-addressed-url-documents-are-the-only-manifest.md
docs/architecture.md
docs/architecture/account-and-document-ownership.md
docs/guides/branded-types-as-helpers.md
docs/guides/consuming-epicenter-api.md
docs/guides/yjs-persistence-guide.md
docs/licensing/licensing-strategy.md
docs/trust-model.md
examples/notes-cross-peer/notes.ts
examples/notes-cross-peer/peer-a/workspaces/notes/daemon.ts
examples/notes-cross-peer/peer-b/workspaces/notes/daemon.ts
packages/app-shell/src/account-popover/account-popover.svelte
packages/app-shell/src/sign-in-migration/create-sign-in-migration.svelte.ts
packages/auth/src/auth-types.ts
packages/auth/src/auth-contract.ts
packages/auth/src/create-oauth-app-auth.test.ts
packages/auth/src/create-oauth-app-auth.ts
packages/auth/src/instance-token-auth.test.ts
packages/auth/src/instance-token-auth.ts
packages/auth/src/node/machine-auth.test.ts
packages/auth/src/node/machine-auth.ts
packages/auth/src/node/oob-launcher.ts
packages/auth/src/node/resolve-machine-auth-client.test.ts
packages/auth/src/persisted-auth-format.test.ts
packages/auth/src/persisted-auth-storage.test.ts
packages/auth/src/persisted-auth-storage.ts
packages/auth/src/read-api-session.test.ts
packages/auth/src/same-origin-cookie-auth.test.ts
packages/auth/src/same-origin-cookie-auth.ts
packages/client/src/index.test.ts
packages/client/src/index.ts
packages/cli/src/commands/blobs.ts
packages/cli/src/commands/up.test.ts
packages/cli/src/commands/up.ts
packages/constants/src/api-routes.ts
packages/constants/src/blob-errors.ts
packages/encryption/src/derivation.ts
packages/identity/src/auth-state.ts
packages/identity/src/identity.ts
packages/server/src/middleware/rate-limit.test.ts
packages/server/src/middleware/rate-limit.ts
packages/server/src/middleware/require-ownership.test.ts
packages/server/src/middleware/require-ownership.ts
packages/server/src/owner.test.ts
packages/server/src/owner.ts
packages/server/src/ownership.ts
packages/server/src/room/backends/cloudflare/durable-object.ts
packages/server/src/room/backends/cloudflare/registry.ts
packages/server/src/room/contracts.ts
packages/server/src/routes/blobs.ts
packages/server/src/routes/rooms-route-pattern.test.ts
packages/server/src/routes/rooms.ts
packages/server/src/routes/session.ts
packages/server/src/s3-blob-store.ts
packages/server/src/types.ts
packages/svelte-utils/src/connect-local-first.test.ts
packages/svelte-utils/src/connect-local-first.ts
packages/svelte-utils/src/reload-on-owner-change.ts
packages/svelte-utils/src/session.svelte.test.ts
packages/svelte-utils/src/session.svelte.ts
packages/sync/src/room-route.ts
packages/workspace/src/account/open-account-room-connection.ts
packages/workspace/src/config/open-epicenter-root.test.ts
packages/workspace/src/config/open-epicenter-root.ts
packages/workspace/src/daemon/attach-mount-infrastructure.ts
packages/workspace/src/daemon/define-mount.test-d.ts
packages/workspace/src/daemon/define-mount.ts
packages/workspace/src/daemon/mount-runtime.ts
packages/workspace/src/daemon/open-account-room.ts
packages/workspace/src/document/attach-broadcast-channel.ts
packages/workspace/src/document/attach-local-storage-corrupt-load.test.ts
packages/workspace/src/document/attach-local-storage.test.ts
packages/workspace/src/document/attach-local-storage.ts
packages/workspace/src/document/connect-doc.ts
packages/workspace/src/document/http-room-sync.test.ts
packages/workspace/src/document/http-room-sync.ts
packages/workspace/src/document/local-yjs-key.test.ts
packages/workspace/src/document/local-yjs-key.ts
packages/workspace/src/document/node-id.ts
packages/workspace/src/document/transport.test.ts
packages/workspace/src/document/transport.ts
packages/workspace/src/document/wipe-local-storage.ts
packages/workspace/src/document/workspace-mount.test.ts
packages/workspace/src/document/workspace.test.ts
packages/workspace/src/document/workspace.ts
packages/workspace/src/index.ts
```

### `\bUserId\b|asUserId|ApiSessionResponse|PersistedAuth|c\.var\.user`

The live implementation again matches the handoff plus historical docs/specs. Key live files:

```txt
apps/api/dev-auth.test.ts
apps/api/dev-auth.ts
apps/api/worker/billing/policies.ts
apps/api/worker/billing/routes.ts
apps/api/worker/billing/service.ts
apps/tab-manager/src/lib/platform/auth/auth.ts
apps/whispering/src/lib/platform/auth.browser.ts
apps/whispering/src/lib/platform/auth.tauri.ts
docs/adr/0067-auth-owns-the-session-endpoint-the-data-client-is-owner-scoped.md
docs/guides/branded-types-as-helpers.md
docs/licensing/licensing-strategy.md
packages/auth/src/app-auth-client.ts
packages/auth/src/auth-contract.ts
packages/auth/src/auth-types.ts
packages/auth/src/client-boundary.test.ts
packages/auth/src/contract.test.ts
packages/auth/src/create-oauth-app-auth.test.ts
packages/auth/src/create-oauth-app-auth.ts
packages/auth/src/index.ts
packages/auth/src/instance-setting.ts
packages/auth/src/instance-token-auth.test.ts
packages/auth/src/node/machine-auth.test.ts
packages/auth/src/node/machine-auth.ts
packages/auth/src/node/oob-launcher.ts
packages/auth/src/node/resolve-machine-auth-client.test.ts
packages/auth/src/persisted-auth-format.test.ts
packages/auth/src/persisted-auth-storage.test.ts
packages/auth/src/persisted-auth-storage.ts
packages/auth/src/read-api-session.ts
packages/auth/src/same-origin-cookie-auth.test.ts
packages/auth/src/same-origin-cookie-auth.ts
packages/cli/src/commands/up.test.ts
packages/server/src/auth/instance-token.ts
packages/server/src/middleware/require-auth.test.ts
packages/server/src/middleware/require-auth.ts
packages/server/src/middleware/require-ownership.test.ts
packages/server/src/middleware/require-ownership.ts
packages/server/src/ownership.ts
packages/server/src/room/backends/bun/live-socket.test.ts
packages/server/src/room/backends/bun/registry.ts
packages/server/src/room/backends/cloudflare/durable-object.ts
packages/server/src/room/contracts.ts
packages/server/src/room/core.test.ts
packages/server/src/routes/rooms.ts
packages/server/src/routes/session.ts
packages/server/src/types.ts
packages/svelte-utils/src/auth.svelte.ts
packages/svelte-utils/src/session.svelte.test.ts
packages/workspace/src/document/node-id.ts
```

### `owners/:ownerId|/api/owners`

```txt
apps/api/README.md
apps/api/scripts/smoke.ts
apps/self-host/scripts/smoke.ts
apps/whispering/specs/20260701T120000-whispering-cloud-sync-remainder.md
docs/adr/0091-blobs-trade-a-file-for-a-durable-content-addressed-url-documents-are-the-only-manifest.md
docs/architecture/account-and-document-ownership.md
docs/guides/consuming-epicenter-api.md
docs/articles/identity-and-partition-are-different-axes.md
packages/auth/src/create-oauth-app-auth.test.ts
packages/auth/src/instance-token-auth.test.ts
packages/constants/src/api-routes.ts
packages/constants/src/blob-errors.ts
packages/server/src/middleware/require-ownership.test.ts
packages/server/src/routes/blobs.ts
packages/server/src/routes/rooms.ts
packages/sync/src/room-route.ts
packages/workspace/README.md
packages/workspace/SYNC_ARCHITECTURE.md
packages/workspace/src/document/transport.test.ts
packages/workspace/src/document/transport.ts
packages/workspace/src/index.ts
prompt.md
specs/20260701T150659-blobs-are-a-url-machine.md
specs/20260524T021140-asset-visibility-and-client-sdk.md
```

## Wave Plan

### Wave 0: recon, ADR draft, target byte pins

- [x] Re-run the four inventory greps against this worktree.
- [x] Write this execution spec and mark it In Progress.
- [x] Draft ADR-0092 and add it to the ADR index.
- [x] Add or confirm target pins for server durable names, IndexedDB keys, and HKDF info bytes.
- [ ] Stop for Braden review.

### Wave 1: brand merge

- [ ] Rename `OwnerId` to `PrincipalId`, `asOwnerId` to `asPrincipalId`, and `INSTANCE_OWNER_ID` to `INSTANCE_PRINCIPAL_ID` in `packages/identity`.
- [ ] Delete `UserId` and `asUserId` from `packages/auth`.
- [ ] Rename `AuthUser` to `Principal`; keep existing JSON shapes until Wave 3.
- [ ] Keep behavior unchanged.

### Wave 2: server seam collapse

- [ ] Delete ownership middleware and ownership rule vocabulary.
- [ ] Rename `ResolveUser` to `ResolvePrincipal` and carry `c.var.principal`.
- [ ] Drop `ownership` options from all mounts.
- [ ] Rewrite instance-token JSDoc so future named instance tokens, if earned, still resolve to the same instance principal id; per-token principals would re-partition and belong to Cloud-shaped auth.
- [ ] Keep the old session JSON shape behind a temporary `WAVE-3-SHIM`.
- [ ] Stop for Braden review.

### Wave 3: wire atom

- [ ] Drop owner segments from `API_ROUTES` and `ROOM_ROUTE`.
- [ ] Collapse `/api/session` to `{ principalId, email? }`.
- [ ] Update all auth, workspace, SDK, CLI, Svelte state, app, and CI consumers in one coherent wave.
- [ ] Preserve the clean-break durable byte outputs pinned in Wave 0.

### Wave 4: deployables and smoke surfaces

- [ ] Remove entry-file ownership constants and threading.
- [ ] Update dev auth, smoke scripts, examples, and benchmarks.
- [ ] Run the self-host and API smoke tests described in the handoff.

### Wave 5: docs and spec deletion

- [ ] Flip ADR-0092 to Accepted.
- [ ] Add the dated postscript to the identity/partition axes article.
- [ ] Sweep living docs named by the handoff.
- [ ] Delete this spec.
- [ ] Run doc hygiene and doc path checks.

## ADR Notes

ADR-0092 is drafted as Proposed in Wave 0. It amends ADR-0075 where that ADR deliberately decoupled identity from partition for the instance, reinforces ADR-0070's "auth stays one total gate" finding, and revises ADR-0067's session contract. It also records the future hosted "team brain" shape: many Better Auth accounts may resolve to one principal, so the new invariant must not assume one human account per partition.

ADR-0092 also records the naming boundary: `PrincipalId` survives because `user` remains Better Auth vocabulary, and because the authenticated thing is not always a person.

Wave 3 must keep the zero-users and no-durable-data assumption visible in the ADR before acceptance. A persisted cell or encrypted payload from the old shape is allowed to become unreadable; this is accepted only because there is no durable data to preserve.

## Verification

Wave 0 verification:

```bash
bun test packages/server/src/owner.test.ts
bun test packages/workspace/src/document/local-yjs-key.test.ts
bun test packages/encryption/src/crypto.test.ts
bun scripts/check-doc-hygiene.ts
```

Per later wave:

```bash
bun run --filter '*' typecheck
bun test
```
