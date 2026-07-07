# Scripting

Scripts read Epicenter materializations directly. SQLite and Markdown are files on
disk, so a Bun script can inspect them without opening a Y.Doc, joining sync, or
calling a running watcher.

Generic off-process writes are deliberately not part of the scripting surface.
The watcher keeps a folder synchronized and materialized; it is not a callable
action server. When a real shell workflow needs to mutate app data, add an
app-specific command or script that opens the workspace in-process under that
workflow's ownership.

## The whole read shape

```ts
import { findEpicenterRoot, openWorkspaceSqlite } from '@epicenter/workspace/node';

const epicenterRoot = findEpicenterRoot();
const cutoff = '2026-01-01T00:00:00Z';

const db = openWorkspaceSqlite(epicenterRoot, 'notes');
const stale = db
  .query('SELECT id FROM notes WHERE pinned = 1 AND updatedAt < ?')
  .all(cutoff);

db.close();
```

The Epicenter root is the folder that holds `epicenter.config.ts`. That config
default-exports one mount. `epicenter daemon up` opens the mount, joins sync when
signed in, and refreshes materializers. Scripts can read the materialized files
whether or not the watcher is currently running.

## SQLite materializer

`openWorkspaceSqlite(epicenterRoot, workspaceId)` opens the guid-keyed convention
path `.epicenter/sqlite/<workspaceId>.db` read-only. First-party mounts write
there. A mount that passed a custom `filePath` to its materializer needs
`openSqliteReader({ filePath })` with that same explicit path.

Neither helper inspects `epicenter.config.ts`. `.epicenter/` is generated machine
state, not a source layout or route registry. The watcher's
`attachBunSqliteMaterializer` keeps that file fresh; the script opens it
read-only with `PRAGMA query_only = 1`, so an errant `INSERT` fails at the driver
instead of silently diverging.

The materializer is the same SQL surface an app can use for fast local reads:
column-typed rows, FTS5 indexes, and normal joins. Query cost is
`O(rows-returned)` rather than `O(history)`, so cron jobs do not pay the
seconds-of-Y.Doc-replay tax that an in-process snapshot would cost.

For ranked search with snippets, use `openSqliteReader({ filePath })`; it wraps
the same database and exposes a `search()` helper. For typed Drizzle queries,
pass the returned `db` to `drizzle(db, { schema })`; the per-app schema lives in
the app's npm package.

## Markdown materializer

Markdown exports are read-only projections. A script can scan, publish, archive,
or lint them like ordinary files. It must not edit generated Markdown to mutate
app data, because the materializer never reads Markdown back into Yjs.

If an app wants Markdown as an authoring format, that parser/editor belongs in an
app action, UI surface, or app-specific CLI command that writes Yjs directly.
The generic materialized Markdown export is not a round-trip format.

## Writes

There is no replacement for `connectDaemonActions` in this wave. That is the
point of the collapse: a live watcher is not a local action server.

Choose one of these shapes when a concrete write workflow appears:

```txt
App UI or local tool:
  open the workspace in-process
  call the app's action registry

App-specific CLI command:
  parse the workflow's real inputs
  claim or respect the root lease
  open the workspace in-process
  call the app action or direct domain service
  exit
```

Do not reintroduce a generic `run <action>` protocol unless a real caller needs
stable off-process action names, schemas, concurrency semantics, and error
mapping.

## What if the watcher is not running?

SQLite and Markdown reads still work against the last materialized state. They
may be stale. Start `epicenter daemon up` when the script needs the folder to
keep syncing and refreshing in the background.
