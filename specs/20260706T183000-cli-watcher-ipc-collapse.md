# CLI watcher IPC collapse

**Date**: 2026-07-06
**Status**: In Progress
**Owner**: Braden
**ADR**: `docs/adr/0112-the-cli-watcher-is-not-a-callable-action-server.md`

## One Sentence

Keep Epicenter's headless watcher, but delete the external daemon IPC plane so a running `epicenter` process syncs and materializes a folder without becoming a callable action server.

## How to read this spec

Read first:

- One Sentence
- Target shape
- Wave 1
- Success criteria

Read when changing deeper architecture:

- Design decisions
- Runtime shape follow-up
- Open questions

Historical only:

- Earlier clean-break analysis named the broader radical-options pass; this spec is the narrower execution slice.

## Current shape

The CLI has two products tangled together:

```txt
Headless watcher:
  epicenter daemon up
    -> load epicenter.config.ts
    -> claim .epicenter machine state
    -> open mount
    -> sync
    -> materialize SQLite / Markdown
    -> write logs and metadata
    -> stop on signal

Callable action server:
  epicenter run/list/peers
    -> daemon client
    -> Unix socket
    -> Hono app
    -> /run /list /peers
    -> action registry exposed by the mount runtime
```

The first product is still useful. The second product is the collapse target.

## Target shape

`epicenter daemon up` remains for the first implementation wave. It opens one app mount headlessly for one folder, keeps sync and materializers alive, writes logs and metadata, and shuts down cleanly. It does not bind a socket and nothing can call it.

```txt
CLI after Wave 1:
  daemon up      keep, no socket
  daemon down    keep, metadata + pid signal
  daemon ps      keep, metadata + pid liveness
  daemon logs    keep, log file tail/read
  auth           keep
  init           keep
  blobs          keep
  matter         keep

  run            delete
  list           delete
  peers          delete
```

Workspace actions stay. Apps, local tools, tests, and future app-specific commands can call actions in-process. This spec deletes only the generic off-process daemon action bus.

## Motivation

The current daemon IPC plane preserves an old story: the daemon as a callable peer. ADR-0009 says `run`, `list`, and `peers` require a daemon because the daemon represents an online callable device. That no longer matches the code. The mesh peer, `run --peer`, and relay action dispatch were deleted; `action-handler.ts` explicitly says cross-device runs are not a `/run` concern.

The current shape creates problems:

1. The watcher has to carry an action registry because the socket can serve it, even though the sync/materialization product does not need external calls.
2. `connectDaemonActions` and the daemon client create a public-looking script surface with no production caller.
3. The CLI teaches users `run`, `list`, and `peers` while the live product need is headless sync and materialization.
4. Hono, socket routing, request schemas, JSON parsing, manifest output, and error mapping exist only to support the callable-server product.

The desired state is smaller: a headless watcher plus explicit future verbs when a real workflow earns them.

## Design decisions

| Decision | Class | Choice | Rationale |
| --- | --- | --- | --- |
| Keep headless operation | 2 coherence | Keep `daemon up/down/ps/logs` in Wave 1 | The watcher owns real lifecycle value: lease, sync, materializers, logs, metadata. |
| Delete external IPC | 2 coherence | Remove socket, Hono app, daemon client, `/run`, `/list`, `/peers` | The product sentence does not include “call a running process.” ADR-0112 records the durable decision. |
| Keep workspace actions | 2 coherence | Do not delete `defineActions`, `invokeAction`, local tool catalogs, or app action registries | Actions are still the in-process write/tool boundary. Only the off-process bus is removed. |
| Do not rename daemon yet | 3 taste | Leave `epicenter daemon up` in Wave 1 | Avoid hiding the functional collapse under vocabulary churn. Rename after the socket deletion is green. |
| Do not add `sync` yet | Deferred | Add one-shot sync after watcher shape is smaller | `sync` needs a convergence contract; it should not block deleting unused IPC. |

## Architecture

Before:

```txt
epicenter run/list/peers
  -> getDaemon(root)
    -> socketPathFor(root)
      -> daemonClient(socket)
        -> Unix socket transport
          -> Hono app
            -> mount.runtime.actions / mount.runtime.collaboration.peers
```

After Wave 1:

```txt
epicenter daemon up
  -> claim lease
  -> openEpicenterRoot
    -> load epicenter.config.ts
    -> open mount
      -> sync
      -> materializers
  -> write metadata
  -> monitor collaboration status on stderr
  -> stop on SIGINT/SIGTERM

No command talks back to this process.
```

## Implementation plan

### Wave 1: delete external daemon IPC

Goal: the watcher still runs, but no socket exists and no CLI command can call it.

- [x] Remove CLI commands `run`, `list`, and `peers` from `packages/cli/src/commands/` and from `packages/cli/src/cli.ts`.
- [x] Delete CLI utilities used only by `run`/`list` if no callers remain, especially JSON input parsing and action-output helpers.
- [x] Remove `startDaemonServer` from `packages/cli/src/commands/up.ts`; `runUp` should open the mount and write metadata without binding a socket.
- [x] Delete workspace daemon IPC modules: `app.ts`, `server.ts`, `unix-socket.ts`, `client.ts`, `action-handler.ts`, `action-errors.ts`, and `list-mount` tests/helpers if no non-test caller remains.
- [x] Delete client proxy modules: `packages/workspace/src/client/connect-daemon-actions.ts` and `daemon-actions.ts`, plus tests.
- [x] Remove now-dead node exports: `connectDaemonActions`, `DaemonActions`, `RunError`, `DaemonListSnapshot`, `PeerSnapshot`, `RunRequest`, `DaemonClient`, `DaemonError`, `daemonClient`, `getDaemon`, `pingDaemon`, `socketPathFor`, `startDaemonServer`, and `DaemonServer` unless a real non-test caller remains.
- [x] Remove package dependencies that become unused, likely `hono`, `@hono/standard-validator`, and `arktype` from `@epicenter/workspace`; remove CLI-only dependencies made unused by deleting `list`/`run`.
- [x] Update tests so lifecycle coverage proves `daemon up` opens and tears down the mount without socket assertions.
- [x] Re-grep deleted names and sweep stale JSDoc, README claims, and docs that teach external IPC.

Green checkpoint:

```txt
bun test packages/cli packages/workspace
bun run --cwd packages/cli typecheck
bun run --cwd packages/workspace typecheck
```

If repo scripts do not support package arguments for `bun test`, run targeted test files first, then the package-local test scripts.

### Wave 2: trim runtime shape

Goal: once no socket serves actions, `DaemonRuntime` should not require `actions` just to satisfy an old transport.

- [x] Remove `actions` from `DaemonRuntime` if all remaining callers can use a runtime without it. (Zero non-test callers; `compose` is side-effect only and `MountComposition` is deleted.)
- [x] Keep workspace actions in connected workspace bundles.
- [x] Decide whether materializer maintenance operations should remain action-shaped or become direct materializer methods. (Direct methods: `rebuild(table?)` and `search(table, query, options?)`; the action shape existed only for wire introspection.)

### Wave 3: lifecycle surface rename

Goal: make the CLI say what the product is.

- [x] Promote `daemon up` to `up`.
- [x] Promote `daemon down` to `down`.
- [x] Rename `daemon ps` to `status`.
- [x] Promote `daemon logs` to `logs`.
- [x] Decide whether to keep temporary aliases. (No aliases: no package script, workflow, or external contract invokes the `daemon` namespace; the only callers were this repo's tests and docs, updated in the same change.)

### Wave 4: one-shot sync

Goal: add `epicenter sync` only after the watcher runtime is smaller.

Open design question: what proves convergence? Candidate signal: root doc `whenConnected`, child-doc sync completion for materialized rows, and materializer flush/drain. Do not add `sync` until this contract is explicit.

## PR strategy

Open a PR after Wave 1 if the diff is reviewable and green. Wave 1 is already a coherent product change: the headless watcher remains, but the callable action server is gone. It should not wait for rename churn or `sync`.

Recommended PR title:

```txt
Collapse daemon IPC into a headless watcher
```

Recommended PR body shape:

```txt
This keeps `epicenter daemon up` as the headless sync/materialization process, but removes the generic local action server around it.

Before:
  run/list/peers -> daemon client -> Unix socket -> Hono app -> action registry

After:
  daemon up opens the mount, syncs, materializes, writes logs and metadata, and cannot be called.

Workspace actions remain in-process for apps and local tools. Future write workflows should earn explicit app verbs instead of reviving a generic daemon action bus.
```

## When to use a bigger orchestrator review

Use a bigger orchestrator before Wave 2 or Wave 3, not before Wave 1, unless Wave 1 uncovers a real production caller for IPC.

Wave 1 is evidence-backed and mechanically bounded. The risky design questions come next:

- whether `DaemonRuntime.actions` disappears entirely;
- whether materializer operations stay action-shaped;
- whether lifecycle commands get clean-break renames without aliases;
- what `sync` means and how it proves convergence.

A good orchestrator prompt after Wave 1:

```txt
Review the Wave 1 diff for the CLI watcher IPC collapse. Challenge whether any remaining `daemon`, `actions`, socket, or RPC-shaped boundary still exists only because the old callable-server model leaked through. Do not propose compatibility aliases unless you can name a real contract. Focus on Wave 2: should `DaemonRuntime.actions` disappear, and should materializer rebuild/search remain action-shaped or become direct materializer methods?
```

## Edge cases

### Inactive mount

`daemon up` may still return an inactive mount when a session-required app is signed out. It should report the reason, release the lease, and exit without metadata for a running watcher.

### Mount with collaboration

`daemon up` should still print initial peers and sync status from the in-process collaboration object. Deleting `epicenter peers` removes only the on-demand query path.

### Existing socket files

If runtime-file sweeping currently removes stale sockets, keep the cleanup if it also handles metadata/log hygiene. Delete socket-specific cleanup only when no caller or test depends on it.

### External package consumers

`@epicenter/workspace` is published. Removing `connectDaemonActions` and daemon client exports is a clean break. Pause if we decide published compatibility matters for the current release; otherwise ADR-0112 is the decision record.

## Open questions

1. Should `daemon` vocabulary be renamed internally to `watcher`?
   - Recommendation: not in Wave 1. Delete behavior first, rename once the shape is smaller.

2. Should materializer rebuild/search remain workspace actions?
   - Recommendation: defer to Wave 2. The answer is probably “direct materializer methods,” but collapsing the external IPC plane should not wait on it.

3. Should `epicenter peers` be replaced by `status --peers`?
   - Recommendation: no. Presence is visible in watcher logs or app UI until a real operator workflow needs an on-demand command.

4. Should `run` return later as an app-specific command generator?
   - Recommendation: no generic return. Add explicit verbs for real workflows, such as import, capture, or post.

## Success criteria

- [x] `epicenter daemon up` starts a mount, syncs, materializes, writes metadata, logs status, and tears down.
- [x] No Unix socket is bound by the watcher.
- [x] `epicenter run`, `epicenter list`, and `epicenter peers` are gone from the CLI.
- [x] No exported daemon client or `connectDaemonActions` surface remains without a non-test caller.
- [x] Workspace actions still work in-process.
- [x] Package tests and typechecks pass for `packages/cli` and `packages/workspace`.
- [ ] ADR-0112 is accepted or left Proposed for PR review, and ADR-0009 is no longer the active decision after merge.

## References

- `docs/adr/0112-the-cli-watcher-is-not-a-callable-action-server.md` - durable decision for the clean break.
- `docs/adr/0009-the-cli-dispatches-through-a-mandatory-daemon.md` - superseded callable-peer rationale.
- `packages/cli/src/commands/up.ts` - watcher startup owner.
- `packages/cli/src/cli.ts` - CLI command registration.
- `packages/workspace/src/config/open-epicenter-root.ts` - config-to-mounted-runtime startup path.
- `packages/workspace/src/daemon/types.ts` - runtime shape to trim after IPC deletion.
- `packages/workspace/src/daemon/app.ts` - Hono IPC app to delete in Wave 1.
- `packages/workspace/src/daemon/client.ts` - daemon client to delete in Wave 1.
- `packages/workspace/src/client/connect-daemon-actions.ts` - documented script proxy to delete in Wave 1.
