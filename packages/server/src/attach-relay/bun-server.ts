/**
 * A Bun WebSocket transport for the {@link createAttachRelay} coordinator, the
 * runtime a self-hosted instance runs (ADR-0115: the relay is a WebSocket
 * channel on the per-user rendezvous each device dials out to; a Durable Object
 * backend for Cloud is not built). Mirrors `createBunRooms`: it returns the
 * `websocket` handler `Bun.serve` needs, `bindServer` to hand back the `Server`
 * once serving, and `handleUpgrade` to accept one authenticated attach.
 *
 * ## One authenticated upgrade path
 *
 * {@link handleUpgrade} is the only way in: the authenticated mount
 * (`mountAttachRelayApp`) resolves the operator bearer to the one principal this
 * deployment admits (the instance principal on self-host) and stamps
 * `principalId` SERVER-SIDE, so a query `principalId` is never trusted. It
 * requires a bound `Server` (`bindServer`), the same impedance the rooms backend
 * has, because Bun upgrades by calling `server.upgrade` rather than returning a
 * 101 from `fetch`. There is deliberately no unauthenticated path: every attach
 * carries a bearer, so the relay has one principal-resolution model, not two.
 *
 * Wave 3 replaces the bearer-to-instance-principal step with a per-device grant;
 * the coordinator and the socket-data shape do not change, only the layer above.
 *
 * The socket the coordinator drives is the Bun `ServerWebSocket` itself: it
 * satisfies {@link RelaySocket} structurally (`send`, `close`, `readyState`),
 * so no wrapper is needed, the same move the room backend makes.
 */

import type { Server, ServerWebSocket, WebSocketHandler } from 'bun';
import { sanitizeUpgradeSubprotocols } from '../sanitize-upgrade-subprotocols.js';
import {
	type ClientConnection,
	createAttachRelay,
	type HostConnection,
} from './core.js';

/**
 * Per-connection identity Bun carries on `ws.data`, set at `server.upgrade` and
 * read back in the `websocket` handler. Discriminated by `role`: a host
 * registers under `(principalId, hostId)`; a client attaches under the full
 * endpoint quadruple. The `surface` tag lets {@link mergeBunWebSocketHandlers}
 * route this socket to the attach relay when it shares one `Bun.serve` with the
 * rooms backend; it is a server-side dispatch discriminant, never a wire field.
 */
export type AttachRelaySocketData = { surface: 'attach' } & (
	| { role: 'host'; principalId: string; hostId: string }
	| {
			role: 'client';
			principalId: string;
			hostId: string;
			deviceId: string;
			attachId: string;
	  }
);

/**
 * The identity and request the Bun backend needs to accept one authenticated
 * attach upgrade. `principalId` is the authenticated principal stamped
 * server-side (the instance principal on self-host), never a query value. The
 * endpoint ids come from the connect query; the backend validates their
 * presence for the given `role`.
 */
export type AttachUpgrade = {
	request: Request;
	principalId: string;
	role: string | undefined;
	hostId: string | undefined;
	deviceId: string | undefined;
	attachId: string | undefined;
};

export type AttachRelayBunServer = {
	/**
	 * Accept one authenticated attach: the mount stamps `principalId` from the
	 * resolved bearer. Requires the `Server` bound via {@link bindServer}.
	 */
	handleUpgrade(upgrade: AttachUpgrade): Response;
	/** Hand back the `Server` once `Bun.serve` returns, so `handleUpgrade` can upgrade. */
	bindServer(server: Server<AttachRelaySocketData>): void;
	websocket: WebSocketHandler<AttachRelaySocketData>;
};

/**
 * Build the Bun transport around one relay coordinator. Bind the `Server` once
 * `Bun.serve` returns (Bun's `server.upgrade` needs the live instance), pass
 * `websocket` to `Bun.serve` (or merge it with the rooms handler), and accept
 * one authenticated `/attach` upgrade through `handleUpgrade`.
 */
export function createAttachRelayBunServer(): AttachRelayBunServer {
	const relay = createAttachRelay();
	const connections = new WeakMap<
		ServerWebSocket<AttachRelaySocketData>,
		HostConnection | ClientConnection
	>();
	let server: Server<AttachRelaySocketData> | null = null;

	return {
		handleUpgrade({ request, principalId, role, hostId, deviceId, attachId }) {
			if (!server) {
				return new Response('attach relay server not bound', { status: 500 });
			}
			const data = buildSocketData({
				principalId,
				role,
				hostId,
				deviceId,
				attachId,
			});
			if (!data) {
				return new Response('Bad attach request', { status: 400 });
			}
			// Echo only the main subprotocol on the 101, so a `bearer.<token>` a
			// browser client offered is never round-tripped (the uWS auto-echo leak).
			sanitizeUpgradeSubprotocols(request);
			if (server.upgrade(request, { data })) {
				// Bun hijacked the socket and sent the 101; this placeholder Response is
				// discarded. Hono requires a Response.
				return new Response(null);
			}
			return new Response('Expected a WebSocket upgrade', { status: 426 });
		},

		bindServer(boundServer) {
			server = boundServer;
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

/**
 * Shape a validated {@link AttachRelaySocketData} from the server-stamped
 * `principalId` plus the connect query's endpoint ids, or `undefined` if the
 * shape is incomplete for the `role`. This is the one place the relay's
 * addressing shape is enforced: it accepts only the endpoint quadruple, never a
 * route, channel, or capability field, so there is nowhere for one to enter
 * (ADR-0115 clause 1).
 */
function buildSocketData(params: {
	principalId: string | undefined;
	role: string | undefined;
	hostId: string | undefined;
	deviceId: string | undefined;
	attachId: string | undefined;
}): AttachRelaySocketData | undefined {
	const { principalId, role, hostId, deviceId, attachId } = params;
	if (!principalId || !hostId) return undefined;
	if (role === 'host') {
		return { surface: 'attach', role: 'host', principalId, hostId };
	}
	if (role === 'client') {
		if (!deviceId || !attachId) return undefined;
		return {
			surface: 'attach',
			role: 'client',
			principalId,
			hostId,
			deviceId,
			attachId,
		};
	}
	return undefined;
}
