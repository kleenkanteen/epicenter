# super-chat

One local desktop chat session; built-in apps enter through one verb catalog; the Bun sidecar owns chat execution, static assets, and the local token gate.

Design authority: [ADR-0080](../../docs/adr/0080-the-super-app-is-a-desktop-host-cross-device-is-remote-access-to-the-session-not-a-per-app-capability-plane.md) (desktop host; remote devices attach to the session, never to per-app endpoints), [ADR-0110](../../docs/adr/0110-super-chat-v1-exposes-built-in-epicenter-apps-and-defers-extension-surfaces.md) (v1 exposes built-in Epicenter apps and defers extension surfaces), and [ADR-0084](../../docs/adr/0084-super-chat-tools-load-as-vendored-typescript-the-shell-is-a-bun-hosted-local-server.md) (the shell is a Bun-hosted loopback server with a per-launch token; its old tool-loading half is superseded).

## Shape

- `src/host.ts` composes the static built-in list: in-process Yjs apps (arm A) as durable local `connect(null, { persistence })` replicas over their action registries, boxed apps (arm B, Local Books) as a local stdio MCP subprocess via `src/stdio-mcp-catalog.ts`. Every source is namespaced (`todos__`, `localbooks__`) and merged with `composeToolCatalogs` into the one `ToolCatalog` the agent loop consumes.
- The in-process apps use `bunLocalPersistence({ dir, nodeId })` under the host data directory. This is signed-out local durability only; sign-in and relay sync for the host are a later enhancement.
- Chat history is intentionally ephemeral (`src/message-store.ts`) until the transcript-persistence decision is made; tool results can carry data ADR-0080's confidentiality rule keeps off hosted readable planes.

## Refusals (do not reopen without a new ADR)

- No daemon `mount.ts` as the composition model; the mount path is CLI/projection for one app.
- No MCP for first-party in-process apps; MCP stays the boxed-app airlock (ADR-0081).
- No loose in-process TypeScript tool modules in v1; future scripting starts from an out-of-process runner unless a new ADR explicitly accepts unsafe developer-mode host imports.
- No bundled Tauri SPA plus side IPC; Bun serves the SPA and the API from one loopback origin.
- No jsrepo production path until trust, pinning, and installed-state tracking are designed.
- The loopback server always binds `127.0.0.1` and rejects every request without the per-launch token; this ships with the first server version, not later (ADR-0084).
