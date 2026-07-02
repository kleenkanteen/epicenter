# Multi-Node Sync Architecture

Epicenter replicates a `Y.Doc` across many nodes over a WebSocket relay. Yjs's CRDT semantics keep every replica eventually consistent regardless of message order or how many nodes are connected. The relay is a dumb pipe: it moves bytes, never executes business logic.

This document describes the runtime: the one public primitive (`openCollaboration`), the handle it returns, and how the wire is organized.

## One primitive: `openCollaboration`

Every document that participates in sync, the workspace doc and every nested content doc, goes through `openCollaboration`. There is no second primitive. The workspace doc passes a real action registry; content docs pass `actions: {}`.

```ts
import {
    defineActions,
    defineMutation,
    openCollaboration,
    roomWsUrl,
} from '@epicenter/workspace';

const collaboration = openCollaboration(ydoc, {
    url: roomWsUrl({ baseURL, ownerId, guid: ydoc.guid, nodeId }),
    waitFor: idb.whenLoaded,
    openWebSocket: auth.openWebSocket,
    onReconnectSignal: auth.onStateChange,
    actions: defineActions({
        tabs_close: defineMutation({ /* ... */ }),
    }),
});

// Local invocation: direct function call against the registry.
await collaboration.actions.tabs_close({ tabIds: [1, 2] });

// Online peers (relay-owned presence), each carrying its node id.
const phone = collaboration.peers
    .list()
    .find((peer) => peer.nodeId === 'phone');
```

Content docs (rich-text bodies, attachments, anything nested that syncs independently) use the same call with `actions: {}`. That registry is local to the returned handle; it is no longer published in presence.

## The `Collaboration` handle

`openCollaboration` returns synchronously:

| Field             | What it is                                                         |
| ----------------- | ------------------------------------------------------------------ |
| `actions`         | Live local action registry; call directly                          |
| `status`          | Current `SyncStatus` (`offline`/`connecting`/`connected`/`failed`) |
| `whenConnected`   | Resolves on first successful handshake; rejects on permanent fail  |
| `whenDisposed`    | Resolves once the supervisor exits and the socket closes           |
| `onStatusChange`  | Subscribe to status changes; returns unsubscribe                   |
| `reconnect`       | Manually wake the supervisor (resets backoff)                      |
| `peers`           | `list()` / `subscribe()` over the server-owned presence channel    |
| `[Symbol.dispose]`| Sugar for `ydoc.destroy()`; cascades through every attachment      |

`peers.list()` returns `Peer[]`, where each peer carries `{ nodeId, connectedAt, agentId? }`. Local `collaboration.actions` remains the app's callable registry; presence never publishes it.

## The wire: one socket, two surfaces

`openCollaboration` opens exactly one authenticated WebSocket per `(Y.Doc, relay)` pair. Two surfaces share that socket:

```
binary frames   ->  Yjs CRDT sync (STEP1 / STEP2 / UPDATE)
text frames     ->  presence (the server-owned peer list)
```

The server never inspects the contents of a Yjs binary frame; it only routes and persists sync updates.

### Sync plane (binary)

Standard Yjs sync: STEP1 (state vector), STEP2 (missing updates), UPDATE (incremental changes). The supervisor encodes and decodes through `@epicenter/sync`'s `handleSyncPayload`. The first STEP2 or UPDATE after connect completes the handshake and flips status to `connected`.

The server merges every update it sees (Yjs is multi-writer; admission control is not the server's job here) and fans out to peers excluding origin. The update log persists to per-room storage and is opportunistically compacted when the room empties.

### Presence plane (server-owned)

The relay tracks live WebSocket connections in a `connections` Map. That map is the source of truth for "who is here." On every membership or identity change it broadcasts one server-to-client text frame carrying the whole list:

```ts
type PresenceFrame = {
    type: 'presence';
    peers: Peer[];
};

type Peer = {
    nodeId: string;
    connectedAt: number;
    agentId?: string;          // set only by a resident agent mount (ADR-0025)
};
```

- The frame is sent to a freshly-upgraded socket, and rebroadcast to every other socket whenever a peer joins, leaves, or republishes its identity.
- `peers` is computed per recipient with the receiver's own install excluded, so the client stores it verbatim.
- Multi-tab same-install collapses to one row (newest-wins by `connectedAt`); a graceful tab handoff produces no wire-visible transition (300 ms debounce).
- A close code of `4401` (permanent auth failure) bypasses the debounce: the dropped peer disappears from everyone else's list immediately.

There is no delta protocol. The relay owns the whole truth and ships the whole truth on every change; the client never reassembles `added` / `removed` events.

Nodes publish their presence identity with one client-to-server frame on every (re)connect:

```ts
type PresencePublishFrame = {
    type: 'presence_publish';
    agentId?: string;
};
```

The relay stores the identity against the sending socket's connection attachment (so it survives Cloudflare hibernation via `serializeAttachment`) and rebroadcasts presence so peers see the update.

`openCollaboration` never publishes the action registry; the wire carries no action manifest (ADR-0073 deleted the in-room dispatch subsystem, and the compatibility field was removed once deployed readers stopped requiring it).

#### Why server-owned, not awareness

Presence used to ride y-protocols Awareness. Awareness is built for ephemeral peer-to-peer state with concurrent per-peer writers (cursors, selections, typing indicators), not for a server-authoritative fact the relay already holds in its `connections` Map. Moving presence onto a plain server-pushed channel deleted the awareness round-trip, the Durable Object hibernation restore loop, and the clock-fabrication seed.

Cursor and selection sync, when they arrive, bring Awareness back, used for what it is designed for and kept separate from this presence channel.

## URLs and routing

A cloud document is owned by the authenticated `OwnerId` and addressed by its own `ydoc.guid`. The client builds the URL from `(baseURL, ownerId, guid, nodeId)`:

```ts
roomWsUrl({
    baseURL: 'https://api.epicenter.so',
    ownerId,
    guid: ydoc.guid,
    nodeId,
});
// -> wss://api.epicenter.so/api/owners/<ownerId>/rooms/<guid>?nodeId=<id>
```

In per-user cloud, `ownerId` equals the signed-in user's id; on an instance it
is the literal `'instance'`. The URL shape is uniform across deployments. The
relay takes the user from the auth token, resolves the expected owner partition
for the deployment, verifies the URL `:ownerId` matches that partition, and
builds the internal Durable Object name `owners/${ownerId}/rooms/${room}`.
Cloud deployments resolve one partition per user. Self-hosted instance
deployments resolve one partition for operator-authorized requests.

This is the consumer Google Docs model and the first of three account layers, introduced over time:

- **Layer 1 (this)**: personal content. `owners/${ownerId}` owns the doc, where `ownerId === userId`.
- **Layer 1.5 (future)**: sharing. A per-document ACL grants other users access; the owner's DO name does not change.
- **Layer 2 (future)**: shared-drive content. A self-hosted instance uses `ownerId === 'instance'` so content is decoupled from any caller identity.
- **Layer 3 (future)**: tenancy and billing. An organization groups user accounts for one invoice and admin policy; it never owns a document.

`nodeId` is appended as a query parameter (`?nodeId=`) on every connect, including reconnects. It is a routing label stamped on the socket at upgrade, not an auth principal: the relay authorizes the room from the token, and within that room `nodeId` decides how presence identifies this install.

`/owners/:ownerId/rooms/:room` is the single cloud sync route shape (per-user cloud: `:ownerId` is the user id; instance: `:ownerId === 'instance'`). Browser apps and the workspace daemon both build their URL with `roomWsUrl`.

## Supervisor lifecycle

`openCollaboration` wraps an internal `createSyncSupervisor` that owns the WebSocket. Three timers participate:

| Timer                 | Default | Job                                                         |
| --------------------- | ------- | ----------------------------------------------------------- |
| `CONNECT_TIMEOUT_MS`  | 15 s    | Abort a socket stuck in CONNECTING                          |
| `PING_INTERVAL_MS`    | 60 s    | Send a `'ping'` text frame to keep the socket alive         |
| `LIVENESS_TIMEOUT_MS` | 90 s    | Close the socket if no traffic arrives for this long (checked every 10 s) |

### Connect, reconnect, backoff

```
   ┌─────────────┐
   │   offline   │ ◄── ydoc.destroy()
   └──────┬──────┘
          │ waitFor resolves
          ▼
   ┌─────────────┐
   │ connecting  │ ──► attemptConnection(signal)
   │ retries=N   │ ◄── reconnect() wakes the loop
   └──────┬──────┘
          │ STEP2/UPDATE handshake
          ▼
   ┌─────────────┐
   │  connected  │ ──► whenConnected.resolve()
   │             │ ──► presence_publish sent
   └──────┬──────┘
          │ ws.onclose
          ▼
   backoff sleep (jittered, capped at 30 s)
          │
          └─► retry
```

Backoff is `min(BASE_DELAY_MS * 2 ** retries, MAX_DELAY_MS)` scaled by `0.5 + Math.random() * 0.5`. Window `online`, `offline`, and `visibilitychange` events wake the backoff or close the socket as appropriate.

### Permanent failure

A server-side auth rejection closes the WebSocket with code `4401` and a JSON reason `{ "code": "<reason>" }`. Codes seen today: `invalid_token`, `token_expired`, `deauthorized`, `unknown`. On 4401:

- Status becomes `{ phase: 'failed', reason: { type: 'auth', code } }`.
- `whenConnected` rejects with `SyncFailedError.AuthRejected({ code })`.
- The supervisor parks; only `reconnect()` reopens it. Apps wire `reconnect()` to `auth.onStateChange` so a sign-in retries automatically.

### Cancellation hierarchy

```
masterController   aborts on ydoc.destroy(); kills everything
   ▼
cycleController    aborts on reconnect(); kills the current iteration only
```

`reconnect()` replaces `cycleController` (rather than just re-aborting it) so the next cycle gets a fresh signal unrelated to the old one. The supervisor reads `cycleController.signal` fresh at the top of each iteration; aborting the old one wakes a parked supervisor and the next iteration picks up the replacement.

## Mental model in one paragraph

`openCollaboration(ydoc, config)` is the one collaboration primitive: it opens a single WebSocket to the relay, runs the Yjs binary sync protocol, publishes this node's presence identity via `presence_publish`, and mirrors the relay's server-owned presence channel into `peers` (including each peer's node id and agent id). The relay merges Yjs updates (eventually consistent CRDT semantics, no admission control) and tracks the live connections Map (source of truth for who is here). Presence is the relay's `connections` Map, not Yjs Awareness. Content docs use the same primitive with `actions: {}` as a local empty registry.
