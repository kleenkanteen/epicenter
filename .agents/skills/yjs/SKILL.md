---
name: yjs
description: Yjs CRDT patterns, shared types (Y.Map, Y.Array, Y.Text), transactions, y-protocols sync and awareness, y-indexeddb persistence, conflict resolution, and document storage. Use when mentioning Yjs, Y.Doc, CRDTs, collaborative editing, real-time sync, awareness, IndexeddbPersistence, or Yjs providers.
metadata:
  author: epicenter
  version: '1.0'
---

# Yjs CRDT Patterns
## Reference Repositories

- [Yjs](https://github.com/yjs/yjs): CRDT framework for shared editing and offline-first data
- [Yjs Protocols](https://github.com/yjs/y-protocols) - Sync, awareness, and auth protocol helpers
- [Y IndexedDB](https://github.com/yjs/y-indexeddb) - Browser persistence provider for Y.Doc updates

## Upstream Grounding

When conflict semantics, transaction origins, shared-type behavior, update encoding, storage growth, or shared-type APIs affect correctness, use source-backed grounding before relying on memory. If DeepWiki MCP is available, ask a narrow question against `yjs/yjs`; for sync, awareness, auth protocol helpers, or provider interoperability, ask against `yjs/y-protocols`; for browser persistence behavior, ask against `yjs/y-indexeddb`. If DeepWiki is unavailable or the repo is not indexed, use upstream source or official docs directly. Treat DeepWiki as orientation, then verify decisive details against local installed types, source, or official docs before changing code.

Skip DeepWiki for stable basics and repo-local patterns already documented below.

> **Related Skills**: See `workspace-api` for the workspace abstraction built on Yjs.

## Transactions, Origins, And Undo

- Yjs updates are commutative and idempotent. Custom sync and persistence layers should use state vectors instead of inventing ordering guarantees.
- Use `Y.encodeStateVector(doc)` to describe local clocks, then `Y.encodeStateAsUpdate(doc, remoteStateVector)` to send only missing updates.
- Wrap multi-write user actions in `doc.transact(() => { ... }, origin)`. This reduces observer churn and gives persistence, providers, and undo logic a useful origin.
- Treat transaction origins as the boundary for filtering provider echoes, app-authored operations, and undo tracking.
- Scope `Y.UndoManager` to concrete shared types. Set `trackedOrigins`, tune `captureTimeout`, and call `stopCapturing()` between logically separate commands.
- Use relative positions for collaborative cursor and selection anchors. Raw numeric indexes drift under remote edits.
- `Y.snapshot()` is a historical marker that depends on retained delete history. `Y.encodeStateAsUpdate(doc)` is the self-contained checkpoint format.
- Prefer separate top-level docs over Yjs subdocuments unless Epicenter owns the whole provider lifecycle for the subdoc path.

## Provider Protocols

- The sync protocol has `SyncStep1`, `SyncStep2`, and incremental `Update` messages. Providers should implement that flow rather than exchanging full documents by default.
- Awareness is ephemeral presence, not canonical document state. Never persist awareness into Y.Doc or IndexedDB as data.
- Awareness is single-writer per client and clocked. Apply remote awareness only when the clock is newer.
- On disconnect, set local awareness state to `null` so peers do not wait for timeout.
- For read-only clients, filter mutation messages at the protocol boundary. Authorization still belongs in the provider or server boundary.

## IndexedDB Persistence

- `IndexeddbPersistence(name, doc)` starts local loading immediately. Wait for upstream `whenSynced`, or Epicenter's wrapper `whenLoaded`, before assuming local state is hydrated.
- Upstream `whenSynced` means local IndexedDB load complete. It does not mean remote network convergence.
- Do not call `_storeUpdate`; it is an internal listener installed by the provider.
- `destroy()` stops persistence and closes the DB connection. `clearData()` destroys persistence and deletes local stored data.
- Stop writers before reset flows that call `clearData()`.
- Use provider `set`, `get`, and `del` only for local provider metadata. Collaborative state belongs in shared Yjs types.
- y-indexeddb periodically compacts stored update rows into a single encoded update, but that does not remove CRDT modeling costs inside the encoded document.

## Core Concepts

### Shared Types

Yjs provides six shared types. You'll mostly use three:

- `Y.Map` - Key-value pairs (like JavaScript Map)
- `Y.Array` - Ordered lists (like JavaScript Array)
- `Y.Text` - Rich text with formatting

The other three (`Y.XmlElement`, `Y.XmlFragment`, `Y.XmlText`) are for rich text editor integrations.

### Client ID

Every Y.Doc gets a random `clientID` on creation. Raw Yjs conflict ordering can
use this id, so concurrent writes to the same raw map key are not "latest
timestamp wins" unless the data structure adds its own timestamp policy.

```typescript
const doc = new Y.Doc();
console.log(doc.clientID); // Random number like 1090160253
```

From dmonad (Yjs creator):

> "The 'winner' is decided by `ydoc.clientID` of the document (which is a generated number). The higher clientID wins."
>
> Source: [GitHub issue #520](https://github.com/yjs/yjs/issues/520)

The actual comparison in source ([updates.js#L357](https://github.com/yjs/yjs/blob/main/src/utils/updates.js#L357)):

```javascript
return dec2.curr.id.client - dec1.curr.id.client; // Higher clientID wins
```

This is deterministic (all clients converge to the same state) but not
intuitive: a later edit can lose. Epicenter's table, KV, and record surfaces do
not expose this raw policy directly; they sit on `YKeyValueLww`, which adds a
timestamped last-write-wins layer for keyed rows.

### Shared Types Cannot Move

Once you add a shared type to a document, **it can never be moved**. "Moving" an item in an array is actually delete + insert. Yjs doesn't know these operations are related.

## Critical Patterns

### 1. Single-Writer Keys (Counters, Votes, Presence)

**Problem**: Multiple writers updating the same key causes lost writes.

```typescript
// BAD: Both clients read 5, both write 6, one click lost
function increment(ymap) {
	const count = ymap.get('count') || 0;
	ymap.set('count', count + 1);
}
```

**Solution**: Partition by clientID. Each writer owns their key.

```typescript
// GOOD: Each client writes to their own key
function increment(ymap) {
	const key = ymap.doc.clientID;
	const count = ymap.get(key) || 0;
	ymap.set(key, count + 1);
}

function getCount(ymap) {
	let sum = 0;
	for (const value of ymap.values()) {
		sum += value;
	}
	return sum;
}
```

### 2. Fractional Indexing (Reordering)

**Problem**: Drag-and-drop reordering with delete+insert causes duplicates and lost updates.

```typescript
// BAD: "Move" = delete + insert = broken
function move(yarray, from, to) {
	const [item] = yarray.delete(from, 1);
	yarray.insert(to, [item]);
}
```

**Solution**: Add an `index` property. Sort by index. Reordering = updating a property.

```typescript
// GOOD: Reorder by changing index property
function move(yarray, from, to) {
	const sorted = [...yarray].sort((a, b) => a.get('index') - b.get('index'));
	const item = sorted[from];

	const earlier = from > to;
	const before = sorted[earlier ? to - 1 : to];
	const after = sorted[earlier ? to : to + 1];

	const start = before?.get('index') ?? 0;
	const end = after?.get('index') ?? 1;

	// Add randomness to prevent collisions
	const index = (end - start) * (Math.random() + Number.MIN_VALUE) + start;
	item.set('index', index);
}
```

### 3. Nested Structures for Conflict Avoidance

**Problem**: Storing entire objects under one key means any property change conflicts with any other.

```typescript
// BAD: Alice changes nullable, Bob changes default, one loses
schema.set('title', {
	type: 'text',
	nullable: true,
	default: 'Untitled',
});
```

**Solution**: Use nested Y.Maps so each property is a separate key.

```typescript
// GOOD: Each property is independent
const titleSchema = schema.get('title'); // Y.Map
titleSchema.set('type', 'text');
titleSchema.set('nullable', true);
titleSchema.set('default', 'Untitled');
// Alice and Bob edit different keys = no conflict
```

## Storage Optimization

### Y.Map vs Workspace Keyed Stores

`Y.Map` tombstones retain the key forever. Every `ymap.set(key, value)` creates a new internal item and tombstones the previous one.

In Epicenter, do not reach for upstream `y-utility` from app code. The workspace
package owns keyed table, KV, and record storage through internal
`YKeyValueLww`, a timestamped last-write-wins store over a `Y.Array`.

```typescript
// App code should usually stay at this level.
workspace.tables.notes.set(note);
workspace.kv.set('theme.mode', 'dark');

using messages = workspace.tables.conversations.docs.messages.open(id);
messages.set(message.id, message);
```

Use raw `Y.Map` for bounded, rarely changing structures inside a private
attachment. Use workspace tables, KV, or `attachRecords` for keyed app data.
Only edit `YKeyValueLww` itself when you are working inside
`packages/workspace/src/document/y-keyvalue/`; ground that work in the local
tests and benchmarks.

### Epoch-Based Compaction

If your architecture uses versioned snapshots, you get free compaction:

```typescript
// Compact a Y.Doc by re-encoding current state
const snapshot = Y.encodeStateAsUpdate(doc);
const freshDoc = new Y.Doc({ guid: doc.guid });
Y.applyUpdate(freshDoc, snapshot);
// freshDoc has same content, no history overhead
```

## Common Mistakes

### 1. Assuming Raw "Last Write Wins" Means Timestamps

It doesn't. Raw Yjs conflict ordering can use clientID, not wall-clock time.
Design around this, use single-writer keys, or use an Epicenter surface that
already owns timestamped LWW semantics (`YKeyValueLww` through tables, KV, or
records).

### 2. Using Y.Array Position for User-Controlled Order

Array position is for append-only data (logs, chat). User-reorderable lists need fractional indexing.

### 3. Forgetting Document Integration

Y types must be added to a document before use:

```typescript
// BAD: Orphan Y.Map
const orphan = new Y.Map();
orphan.set('key', 'value'); // Works but doesn't sync

// GOOD: Attached to document
const attached = doc.getMap('myMap');
attached.set('key', 'value'); // Syncs to peers
```

### 4. Storing Non-Serializable Values

Y types store JSON-serializable data. No functions, no class instances, no circular references.

### 5. Expecting Moves to Preserve Identity

```typescript
// This creates a NEW item, not a moved item
yarray.delete(0);
yarray.push([sameItem]); // Different Y.Map instance internally
```

Any concurrent edits to the "moved" item are lost because you deleted the original.

### 6. Working with Raw Y.js Types Outside Their Owning Module

Y.js shared types (`Y.Map`, `Y.Text`, `Y.XmlFragment`, `Y.Array`) are implementation details that should stay behind typed APIs. When consumer code reaches through an abstraction to manipulate raw shared types, it creates coupling that's hard to change later.

**The pattern**: If a module returns Y.js shared types for editor binding (e.g., `handle.asText()` returns `Y.Text`), that's intentional: the consumer needs the live CRDT reference. But if consumer code is *constructing*, *casting*, or *mutating* Y.js types that the owning module should encapsulate, that's a leak.

```typescript
// BAD: consumer reaches through handle to do raw Y.Text mutation
const entry = handle.currentEntry;
if (entry?.type === 'text') {
    handle.batch(() => entry.content.insert(entry.content.length, text));
}

// GOOD: timeline owns the append operation
handle.append(text);
```

```typescript
// BAD: consumer constructs Y.Maps to call an internal CSV helper
import { parseSheetFromCsv } from '@epicenter/workspace';
const columns = new Y.Map<Y.Map<string>>();
const rows = new Y.Map<Y.Map<string>>();
parseSheetFromCsv(csv, columns, rows);

// GOOD: use the handle's write method, which encapsulates CSV parsing
handle.write(csv);  // mode-aware, handles sheet internally
```

### How to Spot Abstraction Leaks

These are code smell indicators that Y.js internals are leaking:

- **Type assertions**: `as Y.Map`, `as Y.Text`, `as Y.XmlFragment` outside the owning module means someone is working with untyped data and forcing it into shape. The typed API is incomplete.
- **Mode branching**: `if (entry.type === 'text') ... else if (entry.type === 'sheet')` in consumer code means the consumer knows about internal content modes that the abstraction should handle.
- **Raw mutations in batch callbacks**: `handle.batch(() => ytext.insert(...))` means the consumer is doing CRDT operations that should be a method on the handle.
- **Internal helper re-exports**: Functions that take `Y.Map<Y.Map<string>>` parameters on a public API force consumers to have raw Y.js references to call them.
- **`ydoc.getArray()`/`ydoc.getMap()` outside infrastructure**: Consumer code accessing the raw Y.Doc to read/write data bypasses the table/kv/timeline APIs.

### The Boundary Rule

Three layers, each with clear Y.js exposure:

```
┌──────────────────────────────────────────────────────┐
│  Consumer Code (apps, features)                      │
│  • Uses handle.read(), handle.write(), tables.*.set()│
│  • MAY bind to Y.Text/Y.XmlFragment from as*()      │
│  • NEVER constructs Y.js types                       │
│  • NEVER casts to Y.js types                         │
│  • NEVER calls .insert()/.delete() on raw types      │
├──────────────────────────────────────────────────────┤
│  Format Bridges (markdown, sheet converters)          │
│  • Accepts Y.js types as parameters (they're bridges)│
│  • Converts between Y.js ↔ string/JSON               │
│  • Lives close to the owning module                   │
├──────────────────────────────────────────────────────┤
│  Timeline / Table / KV Internals                      │
│  • Constructs and manages Y.js shared types           │
│  • Owns the Y.Doc layout (array keys, map structure)  │
│  • Exposes typed APIs that hide the CRDT details      │
└──────────────────────────────────────────────────────┘
```

When reviewing code, ask: "Could this consumer do its job with only the typed API?" If yes and it's using raw Y.js types instead, that's a leak worth fixing.

See the article `docs/articles/yjs-abstraction-leaks-cost-more-than-the-abstraction.md` for the full pattern with real examples.

## Debugging Tips

### Inspect Document State

```typescript
console.log(doc.toJSON()); // Full document as plain JSON
```

### Check Client IDs

```typescript
// See who would win a conflict
console.log('My ID:', doc.clientID);
```

### Watch for Tombstone Bloat

If documents grow unexpectedly, check for:

- Frequent Y.Map key overwrites
- "Move" operations on arrays
- Missing epoch compaction or a runtime doc accidentally created with `gc: false`

## References

- [Learn Yjs](https://learn.yjs.dev/) - Interactive tutorials
- [Yjs Documentation](https://docs.yjs.dev/) - API reference
- [Yjs INTERNALS.md](https://github.com/yjs/yjs/blob/main/INTERNALS.md) - How Yjs works internally
- [GitHub issue #520](https://github.com/yjs/yjs/issues/520) - Conflict resolution discussion with dmonad
- [fractional-indexing](https://github.com/rocicorp/fractional-indexing) - Production library
- [YATA paper](https://www.researchgate.net/publication/310212186_Near_Real-Time_Peer-to-Peer_Shared_Editing_on_Extensible_Data_Types) - Academic foundation
- `packages/workspace/src/document/y-keyvalue/y-keyvalue-lww.ts` - Epicenter's timestamped keyed store for tables, KV, and records
- `packages/workspace/src/document/attach-indexed-db.ts` - Epicenter's wrapper around `y-indexeddb`
