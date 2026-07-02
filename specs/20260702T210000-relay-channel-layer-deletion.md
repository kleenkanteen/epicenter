# Relay channel layer deletion

- **Status:** Draft
- **Date:** 2026-07-02
- **Authorized by:** [ADR-0079](../docs/adr/0079-cross-device-is-two-planes-epicenter-syncs-the-crdt-the-box-is-reached-directly.md) (names the channel layer deletable, frozen behind the Whispering-sync trigger) and [ADR-0086](../docs/adr/0086-no-live-consumer-for-network-reachable-capability-reach-opensidian-is-superseded-not-migrated.md) (no live consumer; no migration left to wait on)
- **Trigger status:** Fired. Whispering boots through `model.connect(toConnection(auth, nodeId))` (`apps/whispering/src/lib/whispering/whispering.active.ts`), which is the sync-plane wiring ADR-0079 named as the milestone. Turnkey box-access never became a committed goal.

## Product sentence

A device syncs its workspace through the relay; a capability that lives on one machine is reached directly at a URL the user provides. The relay routes no capability call.

## Scope

Delete the relay floor's channel layer: the 4-frame channel protocol (`channel_open`/`accept`/`data`/`reset`), the server channel router, the account room (which exists only as the floor's discovery room), the daemon relay acceptor and its IPC routes, the route table and MCP-over-channel gateway, presence `exposedRoutes`, and the published CLI verbs that drive them.

Survives untouched: binary y-protocols sync, presence as liveness (`nodeId`, `connectedAt`, `agentId`), `collaboration.peers`, daemon `/ping` `/peers` `/list` `/run`, `epicenter peers`, local `defineActions`, the Local Books stdio MCP server, and the generic agent catalogs (`local-tool-catalog`, `compose-tool-catalogs`, `namespace-tool-catalog`).

## Sequencing

Not on the one-connect stack. Merge #2273, retarget and merge #2275, then cut a fresh branch off main for this deletion. One PR, six commits, every commit green.

## Commit waves (leaf consumers first, protocol core last)

1. **CLI leaves.** Delete `packages/cli/src/commands/cross-device-tools.ts` (`epicenter tools` / `epicenter call`); drop their registration in `cli.ts:50-51`; cut the cross-device section from `packages/cli/README.md` (lines 52, 59-89, exit-code rows 98-100); trim the `tools`/`call` cross-reference comment in `commands/peers.ts:7-8`. This is a deliberate breaking change to the published CLI package; say so in the PR body.

2. **Daemon cross-device IPC and account room.** Delete whole files: `packages/workspace/src/account/open-account-room-connection.ts`, `account/reserved-guid.ts`, `daemon/open-account-room.ts`, `daemon/open-relay-acceptor.ts`. Partial edits: `daemon/app.ts` (MCP imports 28-31, relay schemas 83-147, `accountRoom`/`deviceGateway` params 159-160, `/relay-peers` `/tools` `/call` routes 173-225), `daemon/client.ts` (relay methods 174-189 and their imports), `daemon/server.ts` (served account-room/gateway options and the third/fourth `buildDaemonApp` args), `daemon/types.ts` (`DaemonServedAccountRoom`, `DaemonServedDeviceGateway`, `PeerTransport` import), `daemon/server.test.ts` (gateway fixtures and `/relay-peers` `/tools` `/call` tests), `packages/cli/src/commands/up.ts` (relay imports, `relayExpose` option, account-room/gateway startup 175-233, yargs `relay-expose` 287-300), `packages/workspace/src/node.ts` and `src/index.ts` (stop exporting the deleted APIs).

3. **MCP-over-channel gateway.** Delete whole files: `agent/mcp-gateway-catalog.ts` + test, `agent/test-fixtures/mini-mcp-server.ts`, `mcp-stream-transport.ts`, `gateway/relay-route.ts` + test, `gateway/route-table.ts` (fully relay machinery; no surviving local-spawn purpose), `gateway/node-stream-bridge.ts`. Partial edits: `agent/index.ts` (drop the gateway export block 24-28), stale cross-device wording in `compose-tool-catalogs.ts`, `local-tool-catalog.ts`, `namespace-tool-catalog.ts`.

4. **Relay-channel implementation.** Delete `relay-channel/acceptor.ts`, `channel-bytes.ts`, `transport.ts`, `channel-port.ts` and their tests; shrink `relay-channel/index.ts` to whatever the server router tests still import (removed next commit). Delete `peer-transport.ts` (its only consumer was the gateway).

5. **Server protocol core.** Delete `packages/server/src/room/channel-router.ts` + `channel-router.test.ts` + `relay-channel-core.test.ts` and the remaining `relay-channel/*`; drop the `./relay-channel` export from `packages/workspace/package.json`. Partial edits: `packages/server/src/room/core.ts` (channel-router import 62, `pickRecipient` 310-323, router construction 326-336, channel delegation 392-398, `onClose` 475-477), `packages/server/src/types.ts` (`Connection.exposedRoutes` 80-87), comment cleanups in the Cloudflare durable object and Bun registry test.

6. **Presence shrink and docs sweep.** Drop `exposedRoutes` from `document/presence-protocol.ts` (schema 42-52, publish frame 78-79, comments) and `open-collaboration.ts` (config 103-109, publish 183-192, `textFrameListeners` 164-167, returned `textPort` 268-280); mirror in `core.ts` peer snapshot (line 237) and `presence_publish` handling (line 353). Comment cleanups: `sync-supervisor.ts:113`, `attach-mount-infrastructure.ts:98`, `define-mount.ts` relay wording (the mount contract itself survives). Docs: `packages/workspace/SYNC_ARCHITECTURE.md` (relay-channel plane section 124-160 and scattered mentions), `packages/workspace/README.md` (peer shape and cross-device paragraphs), `packages/workspace/docs/architecture/node-identity.md`, `docs/CONTEXT.md` (tool/sync vocabulary 68-80, stale mesh lines 146-147). Add the ADR-0079 footnote below and delete this spec in the same commit.

## Decisions folded in

- `agentId` stays. It has zero product readers today, but it is the mount/actor designation on the sync plane (mounts publish it; the workers buildout is its consumer story), independent of the channel layer. Cutting it is a separate decision; keep this PR a pure ADR-0079 execution.
- The account room dies wholesale, so fleet-wide "which of my devices are online" presence goes with it; workspace-room presence (`collaboration.peers`, `epicenter peers`) remains. A devices page or fleet UI re-earns an account room when a real consumer exists.
- `epicenter tools` / `epicenter call` / `--relay-expose` removal is a published-CLI break, accepted knowingly (ADR-0086 retired their consumer story).

## ADR-0079 footnote to add (wave 6)

> Update (date of landing): the deletion trigger fired. Whispering is wired into the sync plane (ADR-0088/ADR-0094 one-connect boot), and turnkey box-access never became a committed goal (ADR-0086). The channel layer is deleted: the 4-frame protocol, channel router, relay acceptor, account room, route table, MCP gateway catalog, presence `exposedRoutes`, and the CLI `tools`/`call`/`--relay-expose` surface. A future hosted remote is the ADR-0080 content-blind, end-to-end-encrypted session relay, not a resurrection of this layer.

## Verification

Per wave: `bun run typecheck` and tests in `packages/workspace`, `packages/server`, `packages/cli`. After wave 6: a sync smoke (two clients through the room server exchanging CRDT updates) to prove the additive text-frame layer's removal never touched the binary y-protocols path, plus a daemon smoke (`epicenter up`, `/peers`, `/run`). Run a fresh-eyes grill on the full diff before the PR.
