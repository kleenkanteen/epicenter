# Ungated durable local open

**Date**: 2026-07-02
**Status**: Draft (grill in progress: one question answered, four pending; see Open Questions)
**Owner**: Braden
**Blocked by**: PR #2273 then PR #2275 (`refactor!: one connect call and kv-owned settings metadata`) must merge first; this spec targets their landed shape, ADR-0094
**Relates**: `specs/20260701T235243-super-chat-canonicalization-handoff.md` (this is its step 7), ADR-0094 (the connection is the boot decision: one connect call), ADR-0088 (sign-in is an enhancement, never a door), ADR-0084 (the Bun shell), ADR-0080 (the desktop host)

## One Sentence

`connect(null)` gains an injected local-persistence environment so a headless Bun process (the Super Chat host first) opens a durable, signed-out replica of an installed app's workspace, filling the empty node cell of the ADR-0088/0094 matrix.

## Overview

ADR-0088 made "boot into a working local workspace, sign-in only adds sync" the law for browser apps, and ADR-0094 (PR #2275, in flight) collapses its mechanism to one preset: `connect(connection | null)`, where `null` wires bare local infrastructure. That local infrastructure is hardcoded to browser storage, and the only durable node path (`.mount()`) is structurally session-gated. This spec designs the missing environment seam so Super Chat moves from "composition proof" (in-memory `create()` roots) to "loads my workspaces" (durable on-disk replicas), without a sign-in gate.

> **Version note**: an earlier draft of this spec targeted `connectLocal()`. PR #2275 deletes `connectLocal` (not aliased); everything below is written against the ADR-0094 shape in that PR's worktree and must not start implementation until #2273 and #2275 merge.

## Motivation

### Current State

The open-path matrix (post-#2275 spelling) has one empty cell:

```txt
                 signed-out (ungated)              signed-in
browser          connect(null)                     connect(toConnection(auth, nodeId))
node / Bun       << nothing >>                     mount({ runtime })  <- gated
```

Super Chat's host opens apps with zero-attachment factories (`apps/super-chat/src/host.ts:71-72`, merged in PR #2274):

```ts
const honeycrisp = honeycrispWorkspace.create();
const todos = createTodos();
```

The two existing durable paths both fail the host:

1. **`mount()` is structurally gated.** `workspace.ts` wraps every mount in `runtime.defineSessionMount(...)`, and `defineSessionMount` refuses to run the body when machine auth is signed out (`packages/workspace/src/daemon/define-mount.ts:143-146`: `ctx.session === null ? inactive("Sign in to enable ...")`). There is no `MountOptions` flag to opt out. It is also the wrong shape for the host: it returns a daemon `Mount` (projection surface for `epicenter daemon up`), not the workspace bundle the agent catalog composes over, and `apps/super-chat/AGENTS.md` explicitly refuses daemon mount as the composition model.
2. **`connect()` hardcodes browser storage in both arms.** In #2275's `workspace.ts`, the null arm attaches `attachBroadcastChannel` + `attachIndexedDb` directly; the credentialed arm gets IndexedDB inside `connectDoc`; and every child-doc body repeats the same pair in `connectTableChildDocs`'s null-connection branch. `attachIndexedDb` is `y-indexeddb` over the DOM `indexedDB` global; Bun has none (tests polyfill with `fake-indexeddb`, which is in-memory, not durable).
3. **Every host launch is amnesia.** Notes and todos written through Super Chat evaporate on exit, so the shipped shell cannot honestly claim to load anything.

The auth-independent building blocks already exist, unwired:

- `attachYjsLog(ydoc, { filePath })`: bun:sqlite append log with replay and compaction, exported from `@epicenter/workspace/node` (`packages/workspace/src/document/attach-yjs-log.ts:56`). No session anywhere in its signature or body.
- `defineMount`'s own doc comment names the intended pattern: "Local-only mirrors that can run signed out use `defineMount` instead" (`define-mount.ts:134-135`), but nothing production uses it; the only demo is a type-test fixture (`define-mount.test-d.ts:18-39`).
- Node identity is already ungated: `resolveDaemonNodeId` mints/reads a persisted nanoid with no auth dependency (`packages/workspace/src/config/daemon-node-id.ts:37-52`), and `openEpicenterRoot` resolves it *before* it builds the session.

### Desired State

One preset, one boot decision (the connection, per ADR-0094), plus one environment decision (the storage), which stays implicit in browsers and is injected in Bun from the node barrel (the isomorphic model file never imports `bun:*`, same discipline `mount()` uses with `NodeMountRuntime`):

```ts
// browser (unchanged, exactly as #2275 ships it)
honeycrispWorkspace.connect(toConnection(auth, nodeId));

// headless Bun (Super Chat host)
import { bunLocalPersistence } from '@epicenter/workspace/node';

honeycrispWorkspace.connect(null, {
	persistence: bunLocalPersistence({ dir: superChatDataDir }),
});
```

Both return the same bundle shape (tables with child-doc openers, actions, readiness promise, `wipe()`), so the agent catalog, the sign-in migration kit, and everything downstream stay preset-blind. A second host launch replays the log and sees yesterday's rows.

## Research Findings

Full trace ran on this branch and was re-verified line-by-line against source; the `connect()` facts below were additionally verified against PR #2275's worktree (`feat/one-connect-and-kv-metadata`).

| Path | Gate | Root storage | Child docs | Returns |
| --- | --- | --- | --- | --- |
| `create()` | none | none | guid derivers only | `Workspace` |
| `connect(null)` (#2275) | none | IndexedDB + BroadcastChannel (hardcoded) | bare IDB per body (hardcoded) | `LocalWorkspace` |
| `connect(config)` (#2275) | caller passes signed-in `ConnectionConfig` | IndexedDB + relay via `connectDoc` | IDB + relay per body | `ConnectedWorkspace` |
| `mount()` | `defineSessionMount` (structural) | Yjs log + cloud sync, fused in `attachMountInfrastructure` | mount workers | daemon `Mount` |

**Key findings:**

- The sign-in gate is not a policy check a caller can toggle; it is the type of the one node preset. `attachMountInfrastructure` cannot even be reused ungated: it is typed against `SessionMountContext` and reads `ctx.session.ownerId` / `openWebSocket` unconditionally (`attach-mount-infrastructure.ts:83-88`), because it fuses disk persistence with cloud sync in one helper.
- The browser hardcoding lives in exactly two places per arm: `connect`'s root wiring and `connectTableChildDocs`'s `connection: null` branch. A persistence seam threaded through those sites covers the whole surface, child docs included (Honeycrisp's note bodies are child docs, so this is required for "loads my workspaces", not optional polish).
- #2275 deliberately keeps the `idb` bundle key on both arms, discriminated by `collaboration`. The name is honest while browser storage is the only implementation; injection is the moment it stops being honest (see Open Question 3).
- Neither Honeycrisp nor Todos has a `mount.ts` at all; their only durable openers today are browser factories. The host cannot borrow an existing node path even if the gate fell.
- Todos does not use `defineWorkspace`: `createTodos()` calls the low-level `createWorkspace` directly and layers actions by hand (`apps/todos/todos.ts:73-130`). Its only consumer outside `apps/todos` is Super Chat's host itself (verified by grep), so reshaping it is nearly free.
- Precedents: ADR-0088/0094 are the browser half of this exact rule; `defineMount`'s doc comment names the local-only-mirror intent; ADR-0075's instance is "ungated relative to per-user OAuth" but still bearer-and-relay-shaped, so it is adjacent, not a template.

**Implication**: the design is a seam extraction, not new machinery. The durable-storage primitive, the identity primitive, and the ungated-preset shape all exist; what is missing is the injection point that lets them meet.

## Design Decisions

| Decision | Class | Choice | Rationale |
| --- | --- | --- | --- |
| Land after the #2273 -> #2275 stack; target ADR-0094's `connect(connection \| null)` | 1 evidence | Sequencing, not optional | #2275 deletes `connectLocal`; building on it is building on sand. Verified against the PR's worktree. |
| Where the injection lives | 3 taste, **pending grill** | Recommended: options-bag second param, `connect(null, { persistence, compose? })` (function = compose, object = options) | Matches `mount()`'s injected-runtime idiom; zero churn on #2275's fresh signature; browser call sites untouched. Alternatives in Open Question 1. |
| Seam scope this slice | 2 coherence | Null arm (and child-doc null branch) only; `connectDoc`'s arm keeps hardcoded IDB | The host is signed-out by definition here. The contract must be one the credentialed arm can accept later (signed-in host slice), not a null-arm special. |
| Node storage primitive | 1 evidence | `attachYjsLog` per doc (root and each child body), files under an injected `dir`, named by doc guid | Verified: ungated, durable, replay + compaction built in (`attach-yjs-log.ts:56-196`). Path shape mirrors `yjsPath()`'s `<root>/.epicenter/yjs/<id>.db` convention without binding the host to an Epicenter project root. |
| Persistence contract owns root attach, child attach, and wipe | 2 coherence | One injected object; browser default extracted from today's literal behavior | The hardcoded sites and `wipeBareStorage` are one storage concern; splitting them across arguments invites a browser/node mismatch. |
| Browser behavior | 1 evidence | Unchanged; default reproduces `attachBroadcastChannel` + `attachIndexedDb` + `wipeBareStorage` exactly | ADR-0088/0094 apps keep compiling and behaving byte-for-byte. |
| Host identity | 2 coherence | Persist a host nodeId and pin `clientID` via `hashYDocClientId`, as `attachMountInfrastructure` does | Cheap insurance: a stable clientID is what makes the replica safe to sync later (the signed-in enhancement) without split-brain client ids. |
| Signed-in sync for the host | Deferred | Out of scope | Sign-in stays an enhancement; the host's signed-in preset (relay sync of these same replicas) is its own slice. The seam must not foreclose it, which pinned clientID and guid-named files ensure. |
| ADR | 2 coherence | Write "the local preset is environment-injected; sign-in is an enhancement on every runtime" as a Proposed ADR when the grill settles this spec | Extends ADR-0088/0094 across runtimes; durable, worth not re-litigating. |

## Architecture

The seam threads one injected object through the sites that today hardcode the browser (null arm shown; the credentialed arm accepts the same object in a later slice):

```txt
model.connect(null, { persistence?, compose? })
  -> create()                                   (unchanged bare root)
  -> connectTableChildDocs(connection: null)
       each body doc -> persistence.attach(bodyDoc)   [was: attachIndexedDb + broadcast]
  -> compose(...)                               (unchanged)
  -> persistence.attach(root ydoc)              [was: attachIndexedDb + broadcast]
  -> bundle { tables, actions, storage, wipe }  (wipe -> persistence.wipe(id))
```

Sketch of the contract (implementer owns the final shape):

```ts
export type LocalPersistence = {
	/** Attach durable storage to one doc (root or child body). */
	attach(ydoc: Y.Doc): {
		/** Resolves when persisted state has replayed into the doc. */
		whenLoaded: Promise<void>;
		whenDisposed: Promise<void>;
	};
	/** Remove every stored doc for this workspace (root + child bodies). */
	wipe(workspaceId: string): Promise<void>;
};
```

- Browser default: current literal behavior, extracted (BroadcastChannel stays inside the browser impl; it is a browser concern, and it already no-ops elsewhere).
- Node impl `bunLocalPersistence({ dir })`: `attachYjsLog(ydoc, { filePath: join(dir, 'yjs', `${ydoc.guid}.db`) })`; `wipe` deletes the workspace's files. Child bodies land beside the root automatically because files are guid-named.

## Call sites: before and after

### Super Chat host (`apps/super-chat/src/host.ts:71-72`)

**Before**:

```ts
const honeycrisp = honeycrispWorkspace.create();
const todos = createTodos();
```

**After** (shape, not final code):

```ts
const persistence = bunLocalPersistence({ dir: options.dataDir });
const honeycrisp = honeycrispWorkspace.connect(null, { persistence });
const todos = todosWorkspace.connect(null, { persistence });
```

**Semantic shifts to flag**: the host must await readiness before serving (the shell today serves immediately over empty in-memory docs); teardown gains `whenDisposed` waits; `SuperChatHostOptions` grows a `dataDir`.

### Honeycrisp browser factory (post-#2275 `apps/honeycrisp/src/lib/workspace/browser.ts`)

**Before and after are identical**; this is the seam's acceptance test:

```ts
return honeycrispWorkspace.connect(toConnection(auth, nodeId));
```

### Todos (`apps/todos/todos.ts:73-130`)

`createTodos()` builds on raw `createWorkspace`, so it has no presets to inject into. Reshape it to `defineWorkspace` (id, tables, actions in the model; `createTodos()` survives as `todosWorkspace.create()` or is deleted in favor of the model export). `openTodosBrowser` (`todos.browser.ts:8-26`) then becomes the standard preset call instead of hand-attaching IDB. Blast radius: one external consumer (the Super Chat host).

## Implementation Plan

### Phase 0: sequencing gate

- [ ] **0.1** #2273 merged, #2275 retargeted to main and merged (per the stacked-PR gotcha: retarget before any branch delete). Start the work on a fresh branch off main after both.

### Phase 1: the persistence seam (packages/workspace)

- [ ] **1.1** Define the `LocalPersistence` contract beside `connect`; extract today's browser wiring as the default implementation (null-arm root attaches, child-doc null branch, `wipeBareStorage` in `wipe()`).
- [ ] **1.2** Thread the injected persistence through `connectTableChildDocs`'s null-connection branch so child bodies use it; keep the returned bundle key names environment-neutral (see Open Question 3).
- [ ] **1.3** Add `bunLocalPersistence({ dir })` to the node barrel (`packages/workspace/src/node.ts`), built on `attachYjsLog`, with guid-named files and `wipe`.
- [ ] **1.4** Tests: browser default unchanged (existing local-arm tests still green); node round-trip in a temp dir (write rows and a child-doc body, dispose, reopen, assert replay); wipe removes files.

### Phase 2: Todos onto `defineWorkspace`

- [ ] **2.1** Reshape `apps/todos` to `defineWorkspace` (pending grill; see Open Question 4), updating `openTodosBrowser` and test call sites.

### Phase 3: Super Chat host goes durable

- [ ] **3.1** Host opens both apps via `connect(null, { persistence })` under a host data dir; await readiness before the server accepts its first request; extend teardown.
- [ ] **3.2** Persist a host nodeId and pin `clientID` (`hashYDocClientId`).
- [ ] **3.3** Integration test: scripted-engine run writes a todo, host disposes, second host over the same dir reads it back through the catalog (the actual "loads my workspaces" proof).

### Phase 4: record and route

- [ ] **4.1** Write the Proposed ADR (the local preset is environment-injected; sign-in is an enhancement on every runtime), referencing ADR-0088/0094.
- [ ] **4.2** Update `apps/super-chat/AGENTS.md` (the "named gap" line) and the `workspace-app-composition` skill's preset section; resolve step 7 in the canonicalization handoff.

## Edge Cases

### The replica starts empty

An ungated node replica has no way to receive the user's existing browser data until the signed-in sync enhancement exists (or a manual export/import). First host launch shows empty workspaces. This is honest and matches ADR-0088's browser story (a signed-out visitor's doc is unowned and starts empty); the spec must not paper over it with a hosted sync backdoor.

### Two processes over one log file

A future daemon and the Super Chat host could open the same guid under the same dir. `attachYjsLog` is written as a single-writer log (`openWriterSqlite`). Evidence check for the implementer: what bun:sqlite locking actually does under a second writer, and whether the host should hold an advisory lock or simply own a host-private dir (recommended default: host-private dir, which sidesteps the question for this slice).

### Crash mid-write

`attachYjsLog` appends per `updateV2` and compacts on thresholds; a crash between append and compaction must replay cleanly. Existing unit tests cover replay; the phase 1 node test should kill-and-reopen at least once.

### Wipe while the shell is serving

`wipe()` disposes the workspace out from under live catalog tools. The host does not expose wipe in this slice; keep it off the shell surface until the tool-approval story covers destructive host operations.

## Open Questions

Grill state: merge-#2274 was answered (merged 2026-07-02). These four are pending Braden.

1. **Where does the injection live in ADR-0094's signature?**
   - Options: (a) options-bag second param, `connect(null, { persistence, compose? })`, discriminated from the compose function by typeof; (b) a node-barrel opener `openWorkspaceNode(model, { dir, compose? })` that leaves `connect` untouched but needs `workspace.ts` internals exported (second composition site, drift risk); (c) a third connection variant `connect({ persistence })` (bends ADR-0094's "the connection IS the boot decision": storage is not a connection).
   - **Recommendation**: (a). It is `mount()`'s injected-runtime idiom applied to the other preset, and it keeps one composition site.

2. **Where does the host's data dir live?**
   - Options: (a) a platform app-data dir (`~/Library/Application Support/epicenter-super-chat` style), (b) under an Epicenter project root's `.epicenter/`, (c) caller-supplied only, decided by the Tauri slice later.
   - **Recommendation**: (c) for the package seam (pure `dir` injection), with the host defaulting to (a) once the Tauri sidecar exists. Keeps the seam free of path policy.

3. **Does the bundle key `idb` survive?**
   - #2275 deliberately keeps `idb` on both arms; the name is honest today. Injection is the moment it stops being honest (a Bun bundle's "idb" would be a yjs-log handle). Singletons alias `whenReady: browser.idb.whenLoaded`.
   - Options: (a) rename to `storage` in the same wave the seam lands (mechanical sweep across the ADR-0088 apps, but churn on #2275-fresh code), (b) keep `idb` as a Class 3 keep until a second consumer complains.
   - **Recommendation**: (a), in the seam wave, not before: rename when the name becomes wrong, not while it is still right.

4. **Reshape Todos to `defineWorkspace`, or hand-wire persistence in the host?**
   - Verified: `createTodos`'s only consumer outside `apps/todos` is the Super Chat host.
   - **Recommendation**: reshape. Todos is small, the reshape kills its bespoke browser factory too, and the host should not carry a second open path for one app.

5. **Should `mount()` also unfuse persistence from sync?**
   - `attachMountInfrastructure` fusing disk + cloud is why even hand-rolled `defineMount` mounts cannot reuse it. Unfusing would let daemons boot ungated too (ADR-0088 for the daemon).
   - **Recommendation**: defer; name it in the ADR as the expected follow-on, do not widen this slice.

## Success Criteria

- [ ] `bun run --filter @epicenter/workspace test` green, including new node round-trip and wipe tests; existing local-arm tests untouched or trivially updated.
- [ ] Browser factories (honeycrisp, vocab, opensidian) compile with zero call-site changes (modulo Open Question 3's rename if accepted).
- [ ] A Super Chat host launched twice over the same dir reads back the first run's todos mutation through the composed catalog, with no auth client constructed anywhere in the process.
- [ ] `apps/super-chat` typecheck and tests green; no `packages/workspace` browser barrel imports `bun:*`.
- [ ] Proposed ADR exists; handoff spec step 7 resolved.

## Cold-start prompt

Paste this into a fresh agent session once #2273 and #2275 have merged:

```txt
You are working in the Epicenter monorepo. Create a fresh worktree/branch off origin/main for this work; do not reuse the merged super-chat branch.

Goal: implement specs/20260702T014940-ungated-durable-local-open.md, the ungated durable local open path (step 7 of the Super Chat canonicalization). The one sentence: connect(null) gains an injected local-persistence environment so a headless Bun process (the Super Chat host) opens a durable, signed-out replica of an installed app's workspace.

Preconditions to verify before writing code:
1. PR #2273 and PR #2275 are merged (ADR-0094: connect(connection | null) is the one preset; connectLocal no longer exists). If not merged, stop.
2. Read the spec end to end, then re-verify its file:line claims against current main (they were verified on 2026-07-02 against the PR worktrees and may have drifted).
3. Read docs/adr/0094, 0088, 0084, 0080 and apps/super-chat/AGENTS.md (its refusals are binding).

Open questions in the spec carry recommendations; if Braden has not answered them in the session that hands you this prompt, implement the recommendations and flag each choice in the PR body.

Execution shape: follow the spec's phases as separate commit waves (seam -> todos reshape -> host -> ADR/docs). After each substantive wave, run the fresh-eyes-grill skill through a different-model subagent; findings are hypotheses to verify against installed source before applying. Verify with bun run --filter @epicenter/workspace test, bun run --filter @epicenter/super-chat test, and the integration proof: a host launched twice over one temp dir reads back the first run's todos mutation with no auth client constructed anywhere in the process.

Repo constraints: use bun, never npm/yarn/pnpm. Stage specific files only; never git add . or -A. No AI/tool attribution in commits. AGENTS.md files are canonical; CLAUDE.md files are shims. The workspace browser barrel must never import bun:*.
```

## References

- `packages/workspace/src/document/workspace.ts` - `connect` (post-#2275: one preset, null arm hardcodes browser storage), `connectTableChildDocs` null branch, `mount`: the seam's home.
- `packages/workspace/src/document/attach-yjs-log.ts` - the node storage primitive.
- `packages/workspace/src/daemon/define-mount.ts` - the gate (137-148) and the local-mirror intent comment (134-135).
- `packages/workspace/src/config/daemon-node-id.ts` - ungated node identity precedent.
- `docs/adr/0094-the-connection-is-the-boot-decision-one-connect-call.md` (arrives with #2275) - the preset shape this targets.
- `apps/honeycrisp/src/lib/workspace/browser.ts` - the boot line that must not change.
- `apps/todos/todos.ts`, `apps/todos/todos.browser.ts` - the reshape candidate.
- `apps/super-chat/src/host.ts` - the consumer this unblocks.
- `docs/adr/0088-sign-in-is-an-enhancement-never-a-door.md` - the rule this extends across runtimes.
