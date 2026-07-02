# One Preset Shape and Derived Migration Guids

**Date**: 2026-07-02
**Status**: Draft
**Owner**: Braden
**ADRs**: `docs/adr/0092-sign-in-migration-child-doc-guids-are-derived-from-the-schema.md` (Proposed; flip to Accepted when Wave 1 lands). Wave 2 completes ADR-0088; it needs no new ADR.

## One Sentence

Finish ADR-0088's "one composition shape" by deriving sign-in-migration child-doc guids from the workspace schema (deleting the kit's `childDocs` option and all five hand-written readers) and moving Whispering onto the `defineWorkspace(...).connectLocal()` / `.connect()` presets (deleting `connectLocalFirst`).

## How to read this spec

```txt
Read first:
  One Sentence, Overview, Motivation, Architecture, Implementation Plan, Success Criteria

Read if changing the design:
  Research Findings, Design Decisions, Call Sites, Edge Cases

Decide during implementation:
  Open Questions
```

The two waves are independent. Implement and commit them as two standalone units (Wave 1 first: it is smaller and pure deletion-plus-tests). Each wave must leave the tree green on its own.

## Overview

Two clean breaks, both net-deleting, both behavior-identical for every current app: the migration kit computes child-doc guids from the tables it already receives instead of asking each app to hand-list them, and Whispering's boot moves from the doc-level `connectLocalFirst` helper onto the same `defineWorkspace` presets every other app uses.

## Motivation

### Current State

Every app except Whispering boots through the preset branch (`apps/honeycrisp/src/lib/workspace/browser.ts`):

```ts
return auth.state.status === 'signed-out'
	? honeycrispWorkspace.connectLocal()
	: honeycrispWorkspace.connect({ ...projectSignedIn(auth), nodeId });
```

Whispering does the same branch one level lower (`apps/whispering/src/lib/whispering/whispering.active.ts`), because its workspace is built with the low-level `createWorkspace` instead of a `defineWorkspace` model:

```ts
const workspace = createWhispering({ defaultTranscriptionService });
const { whenReady, collaboration } = connectLocalFirst({
	auth,
	ydoc: workspace.ydoc,
	nodeId,
	actions: workspace.actions,
});
```

And every app with per-row child docs hand-writes a guid reader for the migration kit (`apps/honeycrisp/src/lib/migration/sign-in-migration.ts`):

```ts
childDocs: {
	guids: (tables) =>
		tables.notes
			.scan()
			.rows.map((row) => tables.notes.docs.body.guid(row.id)),
},
```

This creates problems:

1. **A documentation-enforced data-loss invariant**: the `workspace-app-composition` skill says every table with `.docs(...)` MUST appear in `childDocs.guids` or Add strands child content in a bare database. A forgotten entry fails silently. An audit (see Research Findings) shows all five hand-written readers encode exactly the derivable rule and nothing else.
2. **Two boot shapes**: `connectLocalFirst` survives with exactly one code consumer (Whispering), the skill carries a permanent "Whispering predates the presets" caveat, and stale comments in honeycrisp still claim it uses `connectLocalFirst`.
3. **Whispering is missing bundle surface**: it has no `wipe()` at all (no forget-device path exists in its source), no per-row child-doc openers if it ever declares one, and its bundle does not participate in the `LocalWorkspace | ConnectedWorkspace` narrowing shared UI relies on.

### Desired State

One model, four presets, and a migration kit whose child-doc handling is pure mechanism:

```ts
// Whispering's env factory, same shape as every other app:
const model = defineWhispering(defaultTranscriptionService);
return auth.state.status === 'signed-out'
	? model.connectLocal(compose)
	: model.connect({ ...projectSignedIn(auth), nodeId }, compose);

// Every app's migration wiring, childDocs gone:
export const signInMigration = createSignInMigration({
	auth,
	openLocalSource,
	target: honeycrisp,
	describe: describeLocalContents,
	errorNoun: 'notes',
});
```

## Research Findings

### All five `childDocs.guids` readers are the same derivable rule

| App | Hand-written reader | Equals "all declared docs of included tables"? |
| --- | --- | --- |
| honeycrisp | `notes.docs.body` for every notes row | Yes |
| vocab | `conversations.docs.messages` for every row | Yes |
| opensidian | `files.docs.content` + `conversations.docs.messages` | Yes (conversations UI is retired but the schema keeps the table; a human had to remember to include it) |
| tab-manager | `conversations.docs.messages` | Yes, over the subset `openLocalSource` passes (`savedTabs`, `bookmarks`, `conversations`; `devices` and `toolTrust` deliberately excluded as whole tables) |
| whispering | option omitted | Yes (no `.docs(...)` declarations, empty set) |

**Key finding**: zero app-specific judgment lives in any reader. The judgment that exists (which tables migrate) lives in `openLocalSource`'s returned table subset, and derivation over that subset preserves it exactly.

**Implication**: the option can be deleted, not just defaulted. See ADR-0092.

### The schema already carries the derivers

`createWorkspace` builds a guid-only `.docs.<field>.guid(rowId)` namespace on every table handle from the table's child-doc declarations (`packages/workspace/src/document/workspace.ts`, the `.docs` loop in `createWorkspace`). Every app's `openLocalSource` calls `.create()` (or `createWhispering`), so the tables the kit already receives carry the derivers. A table without declarations has an empty `docs` object. Nothing is missing.

### `connectLocalFirst` has one consumer and less surface than the presets

- Only live code consumer: `apps/whispering/src/lib/whispering/whispering.active.ts`. All other hits are comments; the one in `apps/honeycrisp/src/lib/honeycrisp.ts:5` is stale (honeycrisp uses the presets).
- It returns only `{ whenReady, collaboration }`. The presets additionally return `wipe()`, per-row child-doc openers, and the `LocalWorkspace | ConnectedWorkspace` bundle shape.
- Its branch-selection test (`packages/svelte-utils/src/connect-local-first.test.ts`, IndexedDB database name proves which wiring ran) is partially duplicated by `packages/workspace/src/document/connect-local.test.ts`, which already guards `connectLocal()` storage naming, child-doc openers, and `wipe()` at the preset level.

### Whispering's two real differences from the preset apps

1. **Parameterized KV defaults**: `createWhispering({ defaultTranscriptionService })` bakes a runtime argument into the KV defaults; the platform leaves pass `'OpenAI'` (web) and `'parakeet'` (Tauri). Defaults are read-side fallbacks, never written, so this does not affect the wire contract or the doc guid (`epicenter-whispering`). A model factory expresses it.
2. **A layered `settings` namespace** (key list, `getDefault`, bulk `reset`) added via `satisfiesWorkspace`. The presets' `compose` callback already merges arbitrary runtime extras onto the bundle, so this moves into `compose` unchanged.

Its transcription/audio runtime lives entirely above the workspace (service and query layers) and is untouched.

### Test infrastructure precedent

`packages/app-shell` has no tests today. `packages/svelte-utils` tests rune modules under plain `bun:test` by stubbing `$state` as identity on `globalThis` (`packages/svelte-utils/src/session.svelte.test.ts`), and uses `fake-indexeddb` plus a `FakeBroadcastChannel`. Copy that pattern; the migration kit's crash-safety orderings are currently asserted only in comments.

### License check

Deletions land in `@epicenter/svelte` (private) and changes in `@epicenter/app-shell` (AGPL); additions land in `apps/whispering` (AGPL). No code moves from an AGPL package into an MIT one. `@epicenter/workspace` (MIT) only gains tests if any.

## Design Decisions

| Decision | Class | Choice | Rationale |
| --- | --- | --- | --- |
| Delete `childDocs` vs default it | 2 coherence | Delete outright | ADR-0092. An optional override with zero use cases is an invitation to re-add hand lists. Exclusion lives in `openLocalSource`'s table subset. |
| Derive over `source.tables` vs schema definitions | 1 evidence | Over `source.tables` (post-subset) | Verified: tab-manager excludes `devices`/`toolTrust` by returning a subset; deriving from raw definitions would break that exclusion. |
| Whispering model shape | 3 taste | Factory `defineWhispering(defaultTranscriptionService)` returning `defineWorkspace(...)` | The per-platform default is real; a factory is the honest home. Alternatives (hoisting the default out of the schema) move the difference somewhere less visible. Constraint: the `./workspace` export becomes a factory, so any future mount/test consumer calls it with some default (harmless, defaults are read-side). |
| `settings` + export action placement | 2 coherence | One `compose` callback passed to both presets | The skill already mandates "pass the SAME compose to both presets". `ConnectComposition` merges extras onto the bundle. |
| Keep `#platform/whispering` two-leaf seam | 3 taste | Keep | Consistent with the seam doctrine; the leaves shrink to one-line default-service picks. Logged in Decisions Log. |
| Delete `connectLocalFirst` + its test | 1 evidence | Delete after Whispering moves | Verified single consumer. `projectSignedIn` stays (the presets need it). Preset-level coverage exists in `connect-local.test.ts`; verify signed-in owner-scoped naming is covered somewhere before deleting the old test, port the assertion if not. |
| New ADR for Wave 2 | 2 coherence | No | Wave 2 completes ADR-0088's already-accepted decision; the skill's caveat deletion is the record. |
| Whispering `wipe()` UI | Deferred | Deferred | The preset puts `wipe()` on the bundle for free; wiring a "Forget this device" surface is product work, not part of this break. |

## Architecture

The target shape, end to end:

```txt
            define<App>(perPlatformArgs?) = defineWorkspace({ id, name, tables, kv, actions })
                                                        |
        +------------------+----------------------------+----------------------+
     .create()        .connectLocal(compose)      .connect(conn, compose)   .mount(opts)
     bare root         signed-out boot             signed-in boot           daemon
     (tests,           bare IDB + channel          owner IDB + relay
      migration        +----- same bundle: tables (.docs.<f>.open), kv,
      source)                 actions, wipe(), whenReady, collaboration? ----+

every app boot (Whispering included):
  auth.state.status === 'signed-out'
    ? model.connectLocal(compose)
    : model.connect({ ...projectSignedIn(auth), nodeId }, compose)

first signed-in boot:
  createSignInMigration({ auth, openLocalSource, target, describe, note?, errorNoun })
    child-doc guids DERIVED, never listed:
      for table of source.tables -> for field of table.docs
        -> for row of table.scan().rows -> field.guid(row.id)
    exclusion = leave the table out of openLocalSource (rows AND docs together)
```

The derivation in the kit, roughly:

```ts
function deriveChildGuids(tables: TTables): string[] {
	return Object.values(tables).flatMap((table) =>
		Object.values(table.docs).flatMap((field) =>
			table.scan().rows.map((row) => field.guid(row.id)),
		),
	);
}
```

The kit's `TTables` constraint widens from `{ scan() }` to also carry the guid-only docs namespace:

```ts
Record<string, {
	scan(): { rows: Array<{ id: string }> };
	docs: Record<string, { guid(rowId: string): string }>;
}>
```

The internal `if (childDocs)` branches collapse: always derive; an empty list already short-circuits the child phases (`childGuids.length > 0` gates cleanup, the merge loop over `[]` is a no-op). Preserve the crash-safety orderings exactly as documented in the kit: Add merges child content into owner storage FIRST, then copies rows and clears the bare root, then best-effort deletes bare child copies; Delete clears bare children FIRST, then the root.

## Call sites: before and after

### honeycrisp migration wiring

**Before** (`apps/honeycrisp/src/lib/migration/sign-in-migration.ts:45`):

```ts
export const signInMigration = createSignInMigration({
	auth,
	openLocalSource,
	target: honeycrisp,
	describe: describeLocalContents,
	errorNoun: 'notes',
	childDocs: {
		guids: (tables) =>
			tables.notes
				.scan()
				.rows.map((row) => tables.notes.docs.body.guid(row.id)),
	},
});
```

**After**:

```ts
export const signInMigration = createSignInMigration({
	auth,
	openLocalSource,
	target: honeycrisp,
	describe: describeLocalContents,
	errorNoun: 'notes',
});
```

Same deletion in vocab, opensidian, tab-manager, and (a no-op, the option was already omitted) whispering. Opensidian's comment about legacy conversations riding along should move to a short note near `openLocalSource` if kept at all; derivation makes it automatic.

**Semantic shift to flag**: none for any current app; the derived set equals every hand list (verified in Research Findings). Grep target: `childDocs` must have zero hits outside git history when done.

### Whispering boot

**Before** (`apps/whispering/src/lib/whispering/whispering.active.ts:41`):

```ts
export function openWhispering(
	defaultTranscriptionService: TranscriptionServiceId,
) {
	const workspace = createWhispering({ defaultTranscriptionService });
	const { whenReady, collaboration } = connectLocalFirst({
		auth,
		ydoc: workspace.ydoc,
		nodeId,
		actions: workspace.actions,
	});
	return satisfiesWorkspace({
		...workspace,
		actions: defineActions({
			...workspace.actions,
			recordings_export_markdown: defineRecordingsMarkdownExport(
				workspace.tables.recordings,
			),
		}),
		whenReady,
		collaboration,
	});
}
```

**After** (shape, not verbatim):

```ts
export function openWhispering(
	defaultTranscriptionService: TranscriptionServiceId,
) {
	const model = defineWhispering(defaultTranscriptionService);
	const compose = (workspace: /* ConnectedWorkspaceContext of the model */) => ({
		actions: defineActions({
			...workspace.actions,
			recordings_export_markdown: defineRecordingsMarkdownExport(
				workspace.tables.recordings,
			),
		}),
		settings: createWhisperingSettings(/* kv definitions closure */),
	});
	const bundle =
		auth.state.status === 'signed-out'
			? model.connectLocal(compose)
			: model.connect({ ...projectSignedIn(auth), nodeId }, compose);
	return { ...bundle, whenReady: bundle.idb.whenLoaded };
}
```

`definition.ts` changes from `createWhispering` (a `createWorkspace` call) to `defineWhispering(defaultTranscriptionService)` returning `defineWorkspace({ id: 'epicenter-whispering', name: 'Whispering', tables, kv, ... })`, and exports a `settings`-builder helper the composer calls (it closes over the kv definitions map, which stays module-private). The `id` MUST NOT change: existing user data lives under it.

**Semantic shift to flag**: the `./workspace` package export becomes a factory returning a model rather than a bundle-builder; update `src/lib/workspace/index.ts` re-exports and every importer of `createWhispering` (currently `whispering.active.ts` and `migration/sign-in-migration.ts`). The bundle gains `wipe()` and `idb`; nothing should start calling them in this spec's scope.

### Whispering migration source

**Before** (`apps/whispering/src/lib/migration/sign-in-migration.ts:21`):

```ts
function openLocalSource() {
	const workspace = createWhispering({ defaultTranscriptionService: 'OpenAI' });
	const idb = attachIndexedDb(workspace.ydoc);
	...
}
```

**After**: `defineWhispering('OpenAI').create()` (or any default; the comment already says it is irrelevant, only table rows are copied) plus the same `attachIndexedDb`, matching the other four apps' `openLocalSource` shape exactly.

## Implementation Plan

### Wave 1: derive child-doc guids in the migration kit (standalone commit set, lands first)

Build, prove, remove within the wave:

- [x] **1.1** Add test infrastructure to `packages/app-shell` copying `packages/svelte-utils`' pattern: `bun:test`, `$state` identity stub on `globalThis`, `fake-indexeddb`, `FakeBroadcastChannel`. Add a `test` script to `package.json` (verify how the monorepo's root test orchestration picks packages up; mirror svelte-utils).
- [x] **1.2** Write the kit's first tests against the CURRENT API (childDocs still present) to lock behavior before changing it: probe opens dialog on non-empty tables; Add copies rows idempotently then clears the bare root; with child docs, Add merges child content into owner-scoped storage BEFORE the row copy and best-effort clears bare children after; Delete clears bare children before the root; a failure before the row copy leaves the bare doc intact. Use a two-table fixture where one table declares a child doc via `defineTable(...).docs({ body })`.
  > **Note**: Landed as one final test file after the API removal, rather than a separate pre-removal checkpoint. The tests still pin the old behavior: probe, idempotent row copy, child merge-before-copy, best-effort child cleanup, delete child-before-root, and retryable root preservation on copy failure.
- [x] **1.3** Implement derivation in `create-sign-in-migration.svelte.ts`: widen the `TTables` constraint to carry `docs`, add `deriveChildGuids`, delete the `childDocs` option and its `if (childDocs)` branches, keep the phase orderings byte-for-byte in behavior. Update the module JSDoc.
- [x] **1.4** Update the tests from 1.2: drop the `childDocs` argument, add the equivalence cases: derived set for the fixture equals the previous hand list; a table subset passed through `openLocalSource` excludes both its rows and its child guids (the tab-manager shape); a workspace with no declarations derives `[]` and never touches owner scope.
- [x] **1.5** Delete the `childDocs` block from all five apps' `sign-in-migration.ts` (whispering has none; confirm). Keep each app's `openLocalSource`, `describe`, `note`, `errorNoun` untouched.
- [x] **1.6** Update `.agents/skills/workspace-app-composition/SKILL.md`: delete the MUST paragraph and the `childDocs` example lines; state that exclusion happens only via `openLocalSource`'s table subset and child-doc guids are derived (cite ADR-0092).
- [x] **1.7** Flip ADR-0092 from Proposed to Accepted. Run `bun scripts/check-doc-hygiene.ts`.
- [x] **1.8** Green gate: `bun run typecheck` and tests across affected packages/apps.
  > **Verification**: `bun run typecheck`, `bun run --cwd packages/app-shell test`, `bun run --cwd packages/app-shell typecheck`, and `bun run check:doc-hygiene` pass. `bun run --cwd packages/workspace test` still has unrelated daemon Unix socket and git autosave failures in this environment; app-shell's new migration suite passes, and the workspace typecheck passes after the `WebSocket.send` typing fix.

### Wave 2: Whispering onto the presets (standalone commit set)

- [x] **2.1** Rework `apps/whispering/src/lib/workspace/definition.ts`: `defineWhispering(defaultTranscriptionService)` wrapping `defineWorkspace({ id: 'epicenter-whispering', name: 'Whispering', tables, kv })`. Export a settings-builder helper (key list, `getDefault`, `reset`) for the composer; keep the kv definitions module-private. Update `workspace/index.ts` re-exports.
- [x] **2.2** Rework `whispering.active.ts` to the preset branch with one shared `compose` (actions + settings), per the Call Sites section. Keep `createNodeId`, the `#platform/auth` import, and the module JSDoc's Option A explanation (updated to name the presets instead of `connectLocalFirst`). Keep `whenReady` aliasing `idb.whenLoaded`.
- [x] **2.3** Update `apps/whispering/src/lib/migration/sign-in-migration.ts`'s `openLocalSource` to `defineWhispering(...).create()` + `attachIndexedDb`, matching the other apps.
- [x] **2.4** Prove: whispering typecheck + tests + a manual boot smoke on web (signed-out boot writes the bare `epicenter-whispering` IndexedDB database; signed-in boot writes the owner-scoped database; migration dialog still probes). Verify signed-in owner-scoped storage naming is asserted at the preset level (`connect-local.test.ts` covers the bare side; `attach-local-storage.test.ts` likely covers owner scoping); port the missing assertion from `connect-local-first.test.ts` into `packages/workspace` if there is a gap.
  > **Note**: Ported the signed-in owner-scoped storage-name assertion into `packages/workspace/src/document/connect-local.test.ts`. A one-off Whispering model smoke was blocked by Bun eval not honoring the app's `$lib` alias; the app is covered by `bun run --cwd apps/whispering typecheck`, `bun run --cwd apps/whispering test`, and the preset-level storage assertion.
- [x] **2.5** Remove: delete `packages/svelte-utils/src/connect-local-first.ts`'s `connectLocalFirst` (keep `projectSignedIn`; consider renaming the file to `project-signed-in.ts` if nothing else remains) and `connect-local-first.test.ts`; update the `auth.svelte.ts` barrel; fix the stale comments in `apps/honeycrisp/src/lib/honeycrisp.ts`, `apps/honeycrisp/src/routes/state/folders.svelte.ts`, `apps/whispering/src/routes/+layout.svelte`, and the `connectLocalFirst` mentions in `packages/svelte-utils/src/session.svelte.ts` and `reload-on-owner-change.ts` JSDoc.
- [x] **2.6** Update `.agents/skills/workspace-app-composition/SKILL.md`: delete the "Whispering predates `defineWorkspace`" caveat; if the factory-model shape (`define<App>(args)` for per-platform schema arguments) is worth documenting, add one short paragraph.
- [x] **2.7** Green gate: repo-wide `bun run typecheck`, affected tests, `bun scripts/check-doc-hygiene.ts`.
  > **Verification**: `bun run typecheck`, `bun run --cwd apps/whispering typecheck`, `bun run --cwd apps/whispering test`, `bun run --cwd packages/svelte-utils typecheck`, `bun run --cwd packages/svelte-utils test`, `bun test packages/workspace/src/document/connect-local.test.ts`, and `bun run check:doc-hygiene` pass.
- [ ] **2.8** Delete this spec (done means deleted; git keeps the body). Confirm ADR-0092 was flipped in Wave 1.

## Edge Cases

### Tab-manager's excluded tables

1. `openLocalSource` returns only `savedTabs`, `bookmarks`, `conversations`.
2. Derivation runs over that subset: `devices`/`toolTrust` rows are neither probed, copied, nor doc-scanned.
3. Expected: identical to today, including the documented "Add clears the WHOLE bare root afterward" behavior for the excluded tables' rows.

### Workspace with zero child docs (whispering)

1. Every table's `docs` object is empty.
2. Derived guid set is `[]`; the merge loop and cleanup are no-ops.
3. Expected: identical to omitting the old option.

### Orphaned bare child docs (row deleted before sign-in)

1. A row is created and deleted while signed out; its child doc's bare IndexedDB database may linger.
2. Neither the old hand lists nor derivation can enumerate it (both map over current rows).
3. Expected: unchanged behavior; explicitly out of scope.

### Whispering's parameterized defaults across surfaces

1. The daemon is not a consumer (whispering has no `./mount` export), tests and the migration source call the factory with an arbitrary default.
2. Defaults are read-side fallbacks: never written to the doc, never on the wire.
3. Expected: two boots with different defaults still converge on sync; only unset KV reads differ, which is today's behavior across web/desktop already.

### The compose ordering

1. `compose` runs after child-doc openers wire but before `connectDoc`; the returned `actions` are what the relay serves.
2. Whispering's `recordings_export_markdown` must therefore be layered in `compose` (as it is today via `satisfiesWorkspace`) so signed-in peers can call it.
3. Expected: verify the served action registry includes it on the signed-in path.

## Open Questions

1. **Where does the app-shell test script hook into CI?**
   - Verify how package test scripts are aggregated (root `package.json` / turbo / CI workflow) and mirror whatever `packages/svelte-utils` does.
2. **Does `packages/workspace` already assert signed-in owner-scoped storage naming at the preset level?**
   - `connect-local.test.ts` covers the bare side. If `connect()`'s owner-scoped database naming is only asserted in the doomed `connect-local-first.test.ts`, port that assertion into `packages/workspace` before deleting. **Recommendation**: port it regardless; it is the half of the branch that protects user data partitioning.
3. **Rename `connect-local-first.ts` after the deletion?**
   - If only `projectSignedIn` remains, `project-signed-in.ts` is the honest name. **Recommendation**: rename, update the barrel; it is a private package.
4. **Document the factory-model shape in the skill?**
   - **Recommendation**: yes, one paragraph: "when a schema needs a per-platform argument, the model is a factory `define<App>(args)`; the id and tables stay fixed, only defaults vary."

## Decisions Log

- Keep the `#platform/whispering` two-leaf seam even though the leaves collapse to one-line default picks: consistent with the build-time seam doctrine and free at runtime.
  Revisit when: a third platform leaf appears, or the leaves diverge beyond the default service.
- Defer wiring a "Forget this device" UI in Whispering even though the preset now provides `wipe()`.
  Revisit when: whispering adopts `WorkspaceGate` or the account popover grows the forget-device affordance there.

## Success Criteria

- [ ] `grep -rn "childDocs" apps packages --include="*.ts"` returns zero hits (option, readers, and JSDoc mentions all gone; the schema-side `.docs(...)` declarations are untouched and keep their name).
- [ ] `grep -rn "connectLocalFirst"` returns zero hits (code and comments).
- [ ] `@epicenter/app-shell` has a passing test suite covering: probe, Add (rows + derived child merge ordering), Delete ordering, derived-equals-hand-list equivalence, table-subset exclusion, zero-child-doc no-op.
- [ ] Whispering boots through `model.connectLocal()` / `model.connect()`; signed-out writes the bare `epicenter-whispering` database, signed-in writes the owner-scoped one (asserted by test at the preset level, smoke-checked in the app).
- [ ] Whispering's bundle still exposes `settings` (keys, `getDefault`, `reset`) and serves `recordings_export_markdown` when signed in.
- [ ] `workspace-app-composition` skill shows one shape with no Whispering caveat and no `childDocs` MUST rule; ADR-0092 is Accepted; doc hygiene passes.
- [ ] Repo-wide typecheck and affected tests green after each wave independently.
- [ ] This spec is deleted in the final commit of Wave 2.

## References

- `docs/adr/0088-sign-in-is-an-enhancement-never-a-door.md`: the decision both waves complete.
- `docs/adr/0092-sign-in-migration-child-doc-guids-are-derived-from-the-schema.md`: Wave 1's durable decision (flip to Accepted).
- `packages/app-shell/src/sign-in-migration/create-sign-in-migration.svelte.ts`: the kit; derivation lands here.
- `packages/workspace/src/document/workspace.ts`: `defineWorkspace`, presets, and the `.docs` guid-deriver loop (the schema source of truth).
- `packages/workspace/src/document/connect-local.test.ts`: preset-level storage-naming guard to extend, not duplicate.
- `packages/svelte-utils/src/connect-local-first.ts` + `.test.ts`: deleted in Wave 2 (keep `projectSignedIn`).
- `packages/svelte-utils/src/session.svelte.test.ts`: the `$state` identity-stub test pattern to copy into app-shell.
- `apps/whispering/src/lib/whispering/whispering.active.ts`, `apps/whispering/src/lib/workspace/definition.ts`: Wave 2's main rework.
- `apps/{honeycrisp,vocab,opensidian,tab-manager,whispering}/src/lib/migration/sign-in-migration.ts`: `childDocs` deletion sites.
- `.agents/skills/workspace-app-composition/SKILL.md`: the skill both waves simplify.
