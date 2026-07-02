# Daemon role after the relay-channel deletion

- **Status:** Draft (decision memo; the one executable wave is § Cleanup wave)
- **Date:** 2026-07-02
- **Relates:** `specs/20260702T210000-relay-channel-layer-deletion.md` (the deletion this audits the survivors of), `specs/20260702T014940-ungated-durable-local-open.md` (Super Chat step 7, the product pressure), ADR-0079/0086 (why the channel layer died), ADR-0080 (the desktop host), ADR-0088/0094 (sign-in is an enhancement; one connect call), ADR-0021 (actions are the only surface that crosses a process boundary)

## Verdict up front

The daemon earns its place, with a narrower job than its name history suggests. What died with the relay-channel layer was the daemon's claim to be a remote capability endpoint. What remains was never remote: a projection host for one app on a box, plus a unix-socket shell adapter. Nothing about that is overbuilt; `app.ts` is under 100 lines and every route has a live consumer.

One thing does not survive greenfield review: `collaboration.actions`. After the channel deletion, `openCollaboration`'s `actions` parameter validates keys and mirrors them back; nothing serves them to peers, nothing on the wire carries them. That is a second owner for a value the bundle already owns. Delete the mirror (§ Cleanup wave).

## Product sentence

The workspace bundle owns the app's action registry; every consumer (app UI, agent catalog, daemon `/run`) enters through `invokeAction` on that one registry; the daemon's one job is to keep a signed-in replica of one app live on a box, project it into files and SQLite, and let the shell run that app's actions over a unix socket.

Collaboration's one job shrinks to match: sync the doc and report who else is in the room. It carries no actions.

## Current owners

```txt
workspace.actions      = the app's command surface, built once in defineWorkspace
                         (workspace.ts:737-739); the single registry every
                         adapter projects
collaboration.actions  = a mirror of the same object (open-collaboration.ts:230-233);
                         zero production readers; DELETE
daemon /run            = shell adapter: invokeAction against the served registry
                         (action-handler.ts:47); consumer: `epicenter run`
daemon /list           = metadata projection of the same registry (app.ts:87-93);
                         consumer: `epicenter list` and /run's suggestions
daemon /peers          = collaboration.peers.list() over the socket (app.ts:78-86);
                         consumer: `epicenter peers`
local-tool-catalog     = agent-tool projection of any registry, in-process
                         (local-tool-catalog.ts:28); consumer: Super Chat host arm A
mount()                = create() + Yjs log + cloud sync + materializers + workers,
                         session-gated (workspace.ts:852-924); consumers:
                         tab-manager and opensidian mount.ts
Super Chat host        = N apps composed into one catalog in one Bun process
                         (host.ts:66); today create() only, spec 20260702T014940
                         makes it connect(null, { persistence })
presence               = liveness only: nodeId, connectedAt, agentId
                         (presence-protocol.ts); server-owned, pushed as text frames
WebSocket sync room    = binary y-protocols sync; untouched, load-bearing
```

## Answers to the open questions

**1. Does the daemon still earn a product role?** Yes. Its live product behavior today: tab-manager's markdown vault with SQLite FTS and git autosave, opensidian's always-on sync mirror, `epicenter run markdown_rebuild` from the shell, and the operator surface (`ps`, `logs`, `down`, `peers`). Its committed future consumer: the always-on child-doc workers (ADR-0024/0025), which need exactly a long-lived signed-in host.

**2. One-sentence job:** the daemon keeps one app's signed-in replica live on a box and projects it (files, SQLite, workers), reachable from the shell over its unix socket.

**3. Should `/run` survive?** Yes, as-is. It is not a remote RPC leftover; it is ADR-0021's process-boundary adapter for the one process that outlives the shell. The "simpler host/runtime adapter" already exists and is a sibling, not a replacement: `createLocalToolCatalog` is the in-process projection, `/run` is the cross-process one. Both are thin wrappers over `invokeAction`. Two adapters over one primitive is the healthy shape.

**4. Should `collaboration.actions` be removed?** Removed, not deprecated. See § Cleanup wave. The bundle's top-level `actions` is the one owner; the mirror exists only because pre-ADR-0073 collaboration served actions to the room, and the channel deletion removes the last wire reason. The `daemon/types.ts:50-54` invariant comment ("must be the same registry handed to openCollaboration, so local runs and the published peer manifest stay in lockstep") describes a manifest that no longer exists; the invariant dissolves rather than needing enforcement.

**5. Should `mount()` be split?** Directionally yes, but not now and not into four primitives. The real split is the one spec 20260702T014940 already designs: local persistence becomes an injected environment on `connect(null, { persistence })`. Once that seam exists, `mount()` is "connect + cloud sync + materializers + workers + session," and its Open Question 5 (unfuse `attachMountInfrastructure`'s disk-plus-cloud) is the only remaining fusion. Defer that unfuse exactly as the spec recommends. Trigger to revisit: a daemon that must boot signed-out (ADR-0088 for the daemon), or a second host that needs materializers.

**6. Is Super Chat the canonical node/Bun runtime shape?** For multi-app composition, yes: `connect(null, { persistence })` in a plain Bun process becomes the canonical durable local open, and daemon mount loses its claim to being the only durable node path. But Super Chat does not replace the daemon, because they answer different sentences: the host opens N apps as one verb catalog for a chat session; the daemon keeps one app's replica live and projected under an Epicenter root. Convergence happens underneath (both should eventually open through the same persistence seam), not by collapsing one into the other.

**7. What user value dies if the daemon disappears?** The markdown vault and SQLite mirror of your tabs and bookmarks, git autosave of those projections, the whole `epicenter up/run/list/peers/ps/logs/down` operator surface, a warm always-synced box replica, and the only viable host for the always-on agent workers. That is a product, not scaffolding.

**Rename?** No. `epicenter daemon up` is published CLI vocabulary, and the narrowed job is still daemon-shaped (a long-lived host process). The "misnamed" feeling came from the relay acceptor and MCP gateway living in `daemon/`; those are deleted. Renaming the directory now is churn with no product behavior behind it.

## Greenfield verdicts

```txt
daemon                  KEEP (narrowed)  projection host + shell adapter; the
                                         relay deletion already removed everything
                                         that made it look overbuilt
daemon /run             KEEP             `epicenter run <action>` against the live mount
daemon /list            KEEP             `epicenter list` + /run suggestions
daemon /peers           KEEP             `epicenter peers`; up.ts join/leave lines
                                         (up.ts:263-275)
collaboration.actions   DELETE NOW       zero production readers; second owner of
                                         the bundle's registry (§ Cleanup wave)
mount()                 KEEP, split later behind spec 20260702T014940 OQ5's trigger;
                                         do not pre-split into four primitives
local tool catalog      KEEP             Super Chat arm A; the in-process projection
Local Books stdio MCP   KEEP             arm B airlock (ADR-0080/0081)
agentId presence        DEFER (keep)     zero publishers today; it is the workers
                                         buildout's designation address (ADR-0025).
                                         Trigger to delete: the workers buildout is
                                         abandoned, or ships without presence
                                         decoration.
```

## Cleanup wave: delete the actions mirror

One standalone PR after the relay-channel deletion lands (its wave 6 edits `open-collaboration.ts` too; do not collide).

- `open-collaboration.ts`: drop `actions` from `OpenCollaborationConfig` (86-93), the key re-validation loop (134-142; `defineActions` already validates at construction), the `collaboration.actions` getter (230-233), and the `Collaboration<TActions>` generic (260-261). Fix the stale comments at 89 and 169-170.
- `connect-doc.ts`: drop the `actions` option (58, 66, 82) and the `actions: {}` default; content docs stop passing an empty registry ritual.
- `workspace.ts`: `connectDoc(workspace.ydoc, connection)` with no actions bag (814-816); `collaboration: Collaboration` loses its generic (294); fix the "the registry connectDoc serves to peers" comment (765-772).
- `attach-mount-infrastructure.ts`: stop threading `actions` into `openCollaboration` (89); the returned `actions` (95) stays, it is the daemon's served set.
- `daemon/types.ts`: delete the stale lockstep comment (50-54); `DaemonRuntime.actions` is the one owner.
- Retarget `workspace.test.ts:316` from `workspace.collaboration.actions.notes_count()` to `workspace.actions.notes_count()`.
- Docs and comments: `SYNC_ARCHITECTURE.md:30,56`, `README.md:1427`, `presence-protocol.ts:13`, `apps/honeycrisp/src/routes/state/folders.svelte.ts:92-95`.

User loss: none. Every caller already reaches the registry through the bundle; the mirror's only consumers are one test assertion and prose.

## Recommended sequence

1. Land the relay-channel deletion PR (spec 20260702T210000; already in flight in this worktree).
2. Land the cleanup wave above as its own small PR.
3. Land Super Chat durable local open (spec 20260702T014940) on the merged shape.
4. Revisit `mount()` unfuse only behind its trigger; record it in the Proposed ADR that spec's phase 4.1 already plans. No daemon collapse, split, or rename is warranted now.

No new ADR is needed for this memo's verdicts: keeping the daemon executes ADR-0079/0080/0086 as decided, and the mirror deletion is small enough to record in the PR body and a `docs/CONTEXT.md` vocabulary touch-up ("actions live on the workspace bundle; collaboration is sync and presence only").

Spec edits elsewhere: none required. Spec 20260702T014940 already carries the mount-unfuse recommendation (OQ5); the relay-channel deletion spec's survives-list stands unchanged.
