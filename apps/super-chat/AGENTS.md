# super-chat

One local desktop chat session; built-in apps enter through one verb catalog; the Bun sidecar owns chat execution, static assets, and the local token gate.

Design authority: [ADR-0080](../../docs/adr/0080-the-super-app-is-a-desktop-host-cross-device-is-remote-access-to-the-session-not-a-per-app-capability-plane.md) (desktop host; remote devices attach to the session, never to per-app endpoints), [ADR-0111](../../docs/adr/0111-super-chat-v1-exposes-built-in-epicenter-apps-and-defers-extension-surfaces.md) (v1 exposes built-in Epicenter apps and defers extension surfaces), [ADR-0084](../../docs/adr/0084-super-chat-shell-is-a-bun-hosted-local-server-not-a-bundled-spa.md) (the shell is a Bun-hosted loopback server with a per-launch token; its old tool-loading half is superseded), and [ADR-0113](../../docs/adr/0113-super-chat-session-commands-are-host-owned-transports-only-frame-them.md) (the host session owns command semantics; transports only frame and deliver them).

## Shape

- `src/host.ts` composes the static built-in list: in-process Yjs apps (arm A) as durable local `connect(null, { persistence })` replicas over their action registries, boxed apps (arm B, Local Books) as a local stdio MCP subprocess via `src/stdio-mcp-catalog.ts`. Every source is namespaced (`todos__`, `localbooks__`) and merged with `composeToolCatalogs` into the one `ToolCatalog` the agent loop consumes.
- The in-process apps use `bunLocalPersistence({ dir, nodeId })` under the host data directory. This is signed-out local durability only; sign-in and relay sync for the host are a later enhancement.
- Transcripts are durable locally: the host's own workspace (`src/workspace.ts`) holds the canonical conversations table (ADR-0055), null-connected under the same persistence directory, so finished messages survive restarts without touching a relay. Boot resumes the most recent row by `updatedAt`; a row is minted lazily on the first send; `clear` starts a fresh conversation. Relay sync for transcripts is a deliberate later wave that rides host sign-in and requires an ADR-0080 amendment before any data reaches the relay.
- Command semantics belong to the host session, not the WebSocket adapter. Chat sends, direct invocations, approval answers, and later palette or voice commands must route through one host-owned session command surface.

## Refusals (do not reopen without a new ADR)

- No daemon `mount.ts` as the composition model; the mount path is CLI/projection for one app.
- No MCP for first-party in-process apps; MCP stays the boxed-app airlock (ADR-0081).
- No loose in-process TypeScript tool modules in v1; future scripting starts from an out-of-process runner unless a new ADR explicitly accepts unsafe developer-mode host imports.
- No bundled Tauri SPA plus side IPC; Bun serves the SPA and the API from one loopback origin.
- No jsrepo production path until trust, pinning, and installed-state tracking are designed.
- The loopback server always binds `127.0.0.1` and rejects every request without the per-launch token; this ships with the first server version, not later (ADR-0084).
- No HTTP command route, Tauri IPC command path, stdio command protocol for the browser UI, generic synced command table, or transport-adapter framework until a real second consumer earns it. The current WebSocket is a session adapter, not the architecture.
