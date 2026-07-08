/**
 * A Bun WebSocket transport for the {@link createAttachRelay} coordinator, the
 * runtime the desktop and a self-hosted instance run (ADR-0115: the relay is a
 * WebSocket channel on the per-user rendezvous each device dials out to; a
 * Durable Object backend for Cloud is a later wave). Mirrors `createBunRooms`:
 * it returns the `websocket` handler `Bun.serve` needs, `bindServer` to hand
 * back the `Server` once serving, and a `fetch` that upgrades a connect
 * request.
 *
 * ## Wave 1 scope
 *
 * This transport is plaintext and unauthenticated: `principalId` rides the
 * connect query for a loopback proof (ADR-0115 wave 1). It is deliberately not
 * mounted into the shared `createServerApp` yet, because that surface is
 * authenticated and Cloud attach must not ship before the wave-4 sealing lands.
 * Wave 2 mounts it on a self-hosted instance; wave 3 resolves `principalId`
 * from a per-device grant instead of the query. The coordinator it drives does
 * not change across those waves; only the layer above it does.
 *
 * The socket the coordinator drives is the Bun `ServerWebSocket` itself: it
 * satisfies {@link RelaySocket} structurally (`send`, `close`, `readyState`),
 * so no wrapper is needed, the same move the room backend makes.
 */

import type { Server, ServerWebSocket, WebSocketHandler } from 'bun';
import {
	type ClientConnection,
	createAttachRelay,
	type HostConnection,
} from './core.js';

/**
 * Per-connection identity Bun carries on `ws.data`, set at `server.upgrade` and
 * read back in the `websocket` handler. Discriminated by `role`: a host
 * registers under `(principalId, hostId)`; a client attaches under the full
 * endpoint quadruple.
 */
type AttachRelaySocketData =
	| { role: 'host'; principalId: string; hostId: string }
	| {
			role: 'client';
			principalId: string;
			hostId: string;
			deviceId: string;
			attachId: string;
	  };

/**
 * Build the Bun transport around one relay coordinator. Bind the `Server` once
 * `Bun.serve` returns (Bun's `server.upgrade` needs the live instance), pass
 * `websocket` to `Bun.serve`, and route `/attach` upgrades through `fetch`.
 */
export function createAttachRelayBunServer(): {
	fetch(
		request: Request,
		server: Server<AttachRelaySocketData>,
	): Response | undefined;
	websocket: WebSocketHandler<AttachRelaySocketData>;
} {
	const relay = createAttachRelay();
	const connections = new WeakMap<
		ServerWebSocket<AttachRelaySocketData>,
		HostConnection | ClientConnection
	>();

	return {
		fetch(request, server) {
			const url = new URL(request.url);
			if (url.pathname !== '/attach') {
				return new Response('Not found', { status: 404 });
			}
			const data = parseConnectData(url);
			if (!data) {
				return new Response('Bad attach request', { status: 400 });
			}
			if (server.upgrade(request, { data })) {
				// Bun sent the 101 and hijacked the socket; the upgrade contract is to
				// return nothing further.
				return undefined;
			}
			return new Response('Expected a WebSocket upgrade', { status: 426 });
		},

		websocket: {
			open(ws) {
				const connection =
					ws.data.role === 'host'
						? relay.registerHost({ ...ws.data, socket: ws })
						: relay.attachClient({ ...ws.data, socket: ws });
				connections.set(ws, connection);
			},
			message(ws, message) {
				connections.get(ws)?.receive(String(message));
			},
			close(ws) {
				connections.get(ws)?.close();
				connections.delete(ws);
			},
		},
	};
}

/** Parse the endpoint addressing out of a connect URL's query, or reject it. */
function parseConnectData(url: URL): AttachRelaySocketData | undefined {
	const q = url.searchParams;
	const role = q.get('role');
	const principalId = q.get('principalId');
	const hostId = q.get('hostId');
	if (!principalId || !hostId) return undefined;
	if (role === 'host') {
		return { role: 'host', principalId, hostId };
	}
	if (role === 'client') {
		const deviceId = q.get('deviceId');
		const attachId = q.get('attachId');
		if (!deviceId || !attachId) return undefined;
		return { role: 'client', principalId, hostId, deviceId, attachId };
	}
	return undefined;
}
