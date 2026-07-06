# Workspace Actions, Layout, And Attachments

Detailed guidance for `defineWorkspace` actions, JSDoc, runtime action
composition, workspace file layout, attachment ordering, and script/daemon
boundaries.

## Actions

Actions wrap table and KV operations as `defineMutation` (writes) or
`defineQuery` (reads). Put portable table/KV actions in the workspace
definition's `actions` callback. The callback receives the live root workspace,
so handlers close over `tables`, `kv`, and `ydoc` through normal JavaScript
scope.

```typescript
import { field } from '@epicenter/field';
import {
	defineActions,
	defineMutation,
	defineTable,
	defineWorkspace,
} from '@epicenter/workspace';
import { Type } from 'typebox';

const postsTable = defineTable({
	id: field.string<PostId>(),
	title: field.string(),
	published: field.boolean(),
	publishedAt: field.number(),
});

export const blogWorkspace = defineWorkspace({
	id: 'epicenter-blog',
	name: 'blog',
	tables: { posts: postsTable },
	kv: {},
	actions: ({ tables, ydoc }) =>
		defineActions({
			/**
			 * Mark a post as published and record the publication timestamp.
			 *
			 * Separated from `tables.posts.update()` because publishing sets a
			 * coherent state transition in one transaction.
			 */
			posts_publish: defineMutation({
				description: 'Publish a draft post',
				input: Type.Object({ id: tables.posts.schema.properties.id }),
				handler: ({ id }) => {
					ydoc.transact(() => {
						tables.posts.update(id, {
							published: true,
							publishedAt: Date.now(),
						});
					});
				},
			}),
		}),
});
```

For full input composition guidance (full-row writes, narrow patches, blanket
PATCH, id-only inputs), see [Deriving action input schemas](deriving-action-inputs.md).

### Runtime-Specific Actions

Runtime-specific actions belong in the runtime composition site, not in the
shared workspace definition. Use this when a handler needs browser APIs, Chrome
extension APIs, Node/Bun filesystem access, Tauri commands, or materializer
handles.

```typescript
const workspace = tabManagerWorkspace.connect(connection, ({ actions }) => ({
	actions: defineActions({
		...actions,
		tabs_close: defineMutation({
			title: 'Close Tabs',
			description: 'Close browser tabs by ID',
			input: Type.Object({ tabIds: Type.Array(Type.Number()) }),
			handler: async ({ tabIds }) => {
				await browser.tabs.remove(tabIds);
				return { closedCount: tabIds.length };
			},
		}),
	}),
}));
```

The registry returned from `compose` is the final registry exposed on the
workspace bundle and, for daemon mounts, served through daemon action surfaces.
That ordering is why runtime actions are composed inside `connect(...)` or
`mount(...)`, not patched onto the bundle after construction.

### Return Shapes: Direct vs Adapter Contract

Actions have two important invocation shapes. Direct callers see the handler's
signature verbatim: sync stays sync, raw stays raw, throws throw. Adapter
callers use `invokeAction(action, input)`, which validates the declared input
schema, wraps raw handler values in `Ok`, preserves existing `Result`s, and
catches thrown errors as `Err(cause)`.

Rule of thumb:

- Return `Err(TypedError)` for failures local callers should branch on.
- Throw for bugs and invariants. `invokeAction` catches the throw and returns
  `Err(cause)` to the adapter.
- Return raw when failure is not a meaningful concept for the operation.

There is no in-room peer action dispatch through `openCollaboration`. The
collaboration wire syncs Yjs updates and presence; actions stay local and are
projected by daemon, CLI, MCP, or other adapter surfaces.

For the full matrix (every caller's view of every handler shape, all the
decision trees, and the normalization boundaries), read
[Action return shapes](action-return-shapes.md).

### JSDoc On Action Methods

Every action method inside the `actions` object should have a JSDoc comment. The
JSDoc and the `description` field serve different audiences:

- `description`: consumed by MCP servers, CLI help text, and OpenAPI specs. Keep
  it short and declarative.
- JSDoc: consumed by developers hovering in an IDE. Explain why the action
  exists as a separate operation, what non-obvious behavior it has, or what
  assumptions it makes.

```typescript
// Bad: parrots the description.
/** Import skills from an agentskills.io-compliant directory. */
importFromDisk: defineMutation({
	description: 'Import skills from an agentskills.io-compliant directory',
	// ...
});

// Good: adds distinct developer context.
/**
 * Scan a directory of SKILL.md files and upsert them into the workspace.
 *
 * Skills without a `metadata.id` in their frontmatter get one generated and
 * written back to disk, so future imports produce stable IDs across machines.
 */
importFromDisk: defineMutation({
	description: 'Import skills from an agentskills.io-compliant directory',
	// ...
});
```

## Workspace File Structure

Default to one shared workspace contract plus runtime-specific openers. Split
files only when the schema, runtime opener, or action registry has grown enough
to earn a boundary.

```txt
src/lib/
|
|-- workspace.ts       <- isomorphic schema, branded IDs, defineWorkspace(), pure actions
|-- browser.ts         <- browser/local opener around workspaceDefinition.connect(...)
|-- daemon.ts          <- daemon mount or daemon-specific composition when present
|
+-- client.ts          <- optional runtime singleton
```

```txt
workspace.ts
  defineTable() / defineKv() / table.docs(...)
    -> defineWorkspace({ id, name, tables, kv, actions })

browser.ts / tauri.ts / extension.ts
  workspaceDefinition.connect(connection | null, compose?)
    -> runtime-specific actions and UI-side dependencies

mount.ts
  workspaceDefinition.mount(...)
    -> Yjs log, cloud sync, materializers, daemon actions
```

### Layering Rules

1. `workspace.ts` or `workspace/index.ts`: pure schema, branded IDs,
   `defineWorkspace(...)`, isomorphic actions, and child-doc declarations.
2. `browser.ts`, `extension.ts`, `tauri.ts`, or similar: runtime openers. Read
   auth once, call `.connect(...)`, and compose runtime-specific actions.
3. `mount.ts`: daemon/runtime mount factory. Attach materializers and daemon
   actions through `.mount(...)`.
4. `client.ts`: optional singleton. It owns side effects such as auth
   subscriptions, persisted UI state, and module-level construction.

### Import Convention

```typescript
// Components/state that need the live workspace instance:
import { workspace, auth } from '$lib/client';

// Components that only need types or the definition:
import { type Note, type NoteId, generateNoteId } from '$lib/workspace';

// Other packages in the monorepo:
import { honeycrispWorkspace, type HoneycrispWorkspace } from '@epicenter/honeycrisp';
```

### Package.json Subpath Exports

Each app exports its shared workspace surface from the package root or a single
`./workspace` subpath:

```json
{
	"exports": {
		".": "./workspace.ts",
		"./mount": "./mount.ts"
	}
}
```

The exported workspace surface is isomorphic, so it is safe for any consumer
(server, CLI, other apps). Avoid separate `./definition` and `./actions`
subpaths unless a real external consumer needs that split.

## Attachment Ordering

`defineWorkspace(...).connect(...)` owns the standard browser/local ordering:
local persistence loads first, then relay collaboration opens with a `waitFor`
gate. Use the lower-level ordering rules only when you are writing package
internals, tests, older ports, or a custom runtime below `connect(...)`.

| Primitive | Typical `waitFor` | Behavior |
|---|---|---|
| `createWorkspace({ id, tables, kv })` | none | Allocates the root `Y.Doc` and wires tables + KV |
| `attachIndexedDb` / `attachLocalStorage` | none | Starts local load immediately |
| `openCollaboration` | `storage.whenLoaded` | Opens sync and presence after local replay |
| Materializers | caller-chosen `waitFor` when available | Mirrors workspace state to SQLite, Markdown, or another read model |

The manual shape is persistence first, then collaboration with `waitFor`:

```typescript
const root = createWorkspace({ id: 'test', tables, kv: {} });
const storage = attachIndexedDb(root.ydoc);
const collaboration = openCollaboration(root.ydoc, {
	url: roomWsUrl({ baseURL, guid: root.ydoc.guid, nodeId }),
	openWebSocket,
	onReconnectSignal,
	waitFor: storage.whenLoaded,
});
```

This ordering matters because sync exchanges the delta between local state and
the server. If collaboration starts before local state loads, cold starts
download more than they need.

## Scripts And Daemon Actions

Do not use a nonexistent `connectWorkspace()` shortcut. Current one-off scripts
usually take one of these shapes:

- Read materialized files or SQLite when they only need a read model.
- Call daemon actions through the daemon client when they need live app
  behavior.
- Use `createWorkspace(...)` directly only for in-memory tests, package
  internals, migrations, or older ports that intentionally bypass the app-facing
  `defineWorkspace(...).connect(...)` path.

Long-running Node behavior belongs in `epicenter.config.ts` / `mount.ts` as a
daemon mount or materializer, not as an ad hoc script that opens its own
parallel sync topology.
