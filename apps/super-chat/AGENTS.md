# super-chat

One local desktop chat session; installed apps enter through one verb catalog; the Bun sidecar owns tool loading, chat execution, static assets, and the local token gate.

Design authority: [ADR-0080](../../docs/adr/0080-the-super-app-is-a-desktop-host-cross-device-is-remote-access-to-the-session-not-a-per-app-capability-plane.md) (desktop host; remote devices attach to the session, never to per-app endpoints) and [ADR-0084](../../docs/adr/0084-super-chat-tools-load-as-vendored-typescript-the-shell-is-a-bun-hosted-local-server.md) (tools load as trusted TypeScript via Bun `import()`; the shell is a Bun-hosted loopback server with a per-launch token).

## Shape

- `src/host.ts` composes the static install list: in-process Yjs apps (arm A) as durable local `connect(null, { persistence })` replicas over their action registries, boxed apps (arm B, Local Books) as a local stdio MCP subprocess via `src/stdio-mcp-catalog.ts`. Every source is namespaced (`todos__`, `localbooks__`) and merged with `composeToolCatalogs` into the one `ToolCatalog` the agent loop consumes.
- `src/tool-loader.ts` is the one dynamic source (ADR-0097): at startup it scans `<dataDir>/tools/*.ts`, imports each file with Bun `import()`, and calls the default-exported factory with the injected `ToolHost` (host-owned `defineQuery`, `defineMutation`, `Type`, and scoped `workspaces`). Each file's tools compose under its file-name namespace; a malformed module or a namespace collision fails startup with the file named, and a missing directory just means no modules are installed.
- The in-process apps use `bunLocalPersistence({ dir, nodeId })` under the host data directory. This is signed-out local durability only; sign-in and relay sync for the host are a later enhancement.
- Chat history is intentionally ephemeral (`src/message-store.ts`) until the transcript-persistence decision is made; tool results can carry data ADR-0080's confidentiality rule keeps off hosted readable planes.

## Refusals (do not reopen without a new ADR)

- No daemon `mount.ts` as the composition model; the mount path is CLI/projection for one app.
- No MCP for first-party in-process apps; MCP stays the boxed-app airlock (ADR-0081).
- No bundled Tauri SPA plus side IPC; Bun serves the SPA and the API from one loopback origin.
- No jsrepo production path until trust, pinning, and installed-state tracking are designed.
- The loopback server always binds `127.0.0.1` and rejects every request without the per-launch token; this ships with the first server version, not later (ADR-0084).
