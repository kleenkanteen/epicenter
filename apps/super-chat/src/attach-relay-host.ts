/**
 * Bind one {@link SuperChatHost} to the AttachRelay (ADR-0115): the desktop
 * host dials out to the per-user rendezvous, registers as a host endpoint, and
 * forwards the same session it already owns to every attached client. This is a
 * second transport for the host-owned session command seam (ADR-0113), beside
 * the direct loopback server in `server.ts`: both drive the one host through
 * `handleCommand` and re-render every client from `host.snapshot()`, so a
 * remote client and a local one attach to the same session, never their own
 * thread (ADR-0080).
 *
 * ## What crosses the relay
 *
 * The host addresses each attached client endpoint on its own wire frame, never
 * a broadcast: on any host change it sends each client its own snapshot, and on
 * a client's command bytes it drives `handleCommand`. Addressing each client
 * separately is the seam wave 4 seals (the host will seal per device grant, so
 * the relay only ever forwards per-endpoint ciphertext, ADR-0115 clause 5);
 * wave 1 sends the same plaintext snapshot to each, but already per endpoint.
 *
 * The relay reads none of this: the snapshot and the command bytes are the
 * opaque `payload`; only the endpoint envelope (`deviceId`, `attachId`) is the
 * relay's to route.
 */

import {
	ATTACH_RELAY_ROUTE,
	type RelayToHostFrame,
} from '@epicenter/server/bun';
import {
	type HostSealSession,
	type SealEndpoint,
	type SealPsk,
	startHostSealSession,
} from './attach-relay-seal.ts';
import {
	parseSuperChatCommand,
	type SuperChatClientCommand,
	type SuperChatHost,
} from './host.ts';
import type { SuperChatServerEvent } from './server.ts';

export type AttachRelayHostOptions = {
	/** The one host-owned session every attached client shares. */
	host: SuperChatHost;
	/** The relay's origin, e.g. `ws://127.0.0.1:<port>` on loopback. */
	relayOrigin: string;
	/**
	 * The principal that owns both ends. The authenticated relay ignores this and
	 * stamps the principal from the device grant (the instance principal on
	 * self-host, ADR-0115 wave 3), so it is carried only to complete the connect
	 * URL's addressing quadruple and can never point the attach at another
	 * partition.
	 */
	principalId: string;
	/** This desktop's stable host id, the endpoint clients attach to. */
	hostId: string;
	/**
	 * This host's device grant for the relay (ADR-0115 wave 3): the operator mints
	 * one grant per device, the desktop host's own included, and it rides the
	 * `bearer.<token>` WebSocket subprotocol, the one channel a browser upgrade has.
	 * Every attach is authenticated, so this is required; revoking the grant cuts
	 * this host off on its next connect.
	 */
	bearer: string;
	/**
	 * Open a WebSocket to the relay. Defaults to the global `WebSocket`; tests
	 * inject one so no real global is needed. Kept minimal on purpose: only
	 * `send`, `close`, and the three event hooks the adapter drives.
	 */
	openSocket?: (url: string, protocols?: string[]) => RelayHostSocket;
	/**
	 * Seal every attached client's frames (ADR-0115 wave 4). When present, each
	 * client endpoint runs an authenticated ECDH handshake before any snapshot is
	 * sent, so the relay forwards only ciphertext: prompts, tool results, and
	 * approvals never cross it in the clear. `resolvePsk` returns the pairing
	 * pre-shared key for one endpoint (the QR/paste secret, distinct from the
	 * relay grant); an endpoint with no PSK is refused a sealed session and gets
	 * no snapshots (fail-closed). Omit sealing entirely for the self-host plaintext
	 * opt-out, where the operator is the user (ADR-0115 clause 5).
	 */
	sealing?: { resolvePsk: (endpoint: SealEndpoint) => SealPsk | undefined };
};

/** The minimal outbound-socket surface the host adapter drives. */
export type RelayHostSocket = {
	send(data: string): void;
	close(): void;
	readyState: number;
	onopen: (() => void) | null;
	onmessage: ((event: { data: unknown }) => void) | null;
	onclose: (() => void) | null;
};

export type AttachRelayHost = {
	/** Resolves once the host has registered with the relay (its socket opened). */
	ready: Promise<void>;
	/** Stop forwarding and drop the relay connection. */
	close(): void;
};

/**
 * Register `host` with the relay and forward its session to every client that
 * attaches. Returns once the connection is initiated; await `ready` to know the
 * host endpoint is live before pointing a client at it.
 */
export function attachHostToRelay(
	options: AttachRelayHostOptions,
): AttachRelayHost {
	const { host, relayOrigin, principalId, hostId, bearer, sealing } = options;
	const open = options.openSocket ?? defaultOpenSocket;

	const url = ATTACH_RELAY_ROUTE.hostUrl(relayOrigin, { principalId, hostId });
	const socket = open(url, ATTACH_RELAY_ROUTE.subprotocols(bearer));

	// The client endpoints currently attached to this host, keyed by
	// `deviceId`/`attachId`. The host re-sends each its own snapshot on change.
	// When sealing is on, each endpoint carries its seal session; a client with a
	// pending or refused handshake has no session yet, so it receives no snapshot.
	type Client = {
		deviceId: string;
		attachId: string;
		seal?: HostSealSession;
	};
	const clients = new Map<string, Client>();
	const clientKey = (deviceId: string, attachId: string): string =>
		`${deviceId} ${attachId}`;

	// Address one client endpoint on its own wire frame, sealing the payload when
	// the endpoint runs a ready session. The relay routes by the envelope and
	// never sees inside `payload`.
	const sendToClient = (client: Client, payload: string): void => {
		if (socket.readyState !== 1 /* OPEN */) return;
		socket.send(
			JSON.stringify({
				deviceId: client.deviceId,
				attachId: client.attachId,
				payload,
			}),
		);
	};

	const sendSnapshot = (client: Client): void => {
		const event: SuperChatServerEvent = {
			type: 'snapshot',
			snapshot: host.snapshot(),
		};
		const plaintext = JSON.stringify(event);
		if (sealing) {
			// Sealed: skip until the handshake completes, then send ciphertext. The
			// session becomes ready on the client's authenticated accept, and it is
			// sent the current snapshot at that point, so nothing is lost.
			const sealed = client.seal?.seal(plaintext);
			if (sealed !== undefined) sendToClient(client, sealed);
			return;
		}
		sendToClient(client, plaintext);
	};

	// One host subscription for the whole relay transport: on any session change,
	// push a fresh snapshot to each attached client. Client re-render is from
	// host state, never from the frame that triggered the change (ADR-0113).
	const unsubscribe = host.subscribe(() => {
		for (const client of clients.values()) sendSnapshot(client);
	});

	let resolveReady!: () => void;
	const ready = new Promise<void>((resolve) => {
		resolveReady = resolve;
	});

	// Apply one decoded client command to the one host session. The resulting
	// change fans a fresh snapshot to every attached client.
	const applyCommandPayload = (payload: string): void => {
		const command = parseCommandPayload(payload);
		if (command) host.handleCommand(command);
	};

	socket.onopen = () => resolveReady();
	socket.onmessage = (event) => {
		if (typeof event.data !== 'string') return;
		const frame = parseRelayToHostFrame(event.data);
		if (!frame) return;
		if ('event' in frame) {
			const key = clientKey(frame.deviceId, frame.attachId);
			if (frame.event === 'attach') {
				const client: Client = {
					deviceId: frame.deviceId,
					attachId: frame.attachId,
				};
				if (sealing) {
					// Seal this endpoint: run the authenticated handshake, then push the
					// first snapshot on ready. An endpoint with no PSK is refused a
					// session and gets no snapshots (fail-closed).
					const psk = sealing.resolvePsk({
						deviceId: client.deviceId,
						attachId: client.attachId,
					});
					if (psk !== undefined) {
						client.seal = startHostSealSession({
							psk,
							send: (payload) => sendToClient(client, payload),
							onReady: () => sendSnapshot(client),
						});
					}
				}
				clients.set(key, client);
				// Without sealing, a freshly attached client gets the current state at
				// once, so a passive watcher renders before anyone acts. With sealing,
				// the first snapshot waits for the handshake (see `onReady` above).
				if (!sealing) sendSnapshot(client);
			} else {
				clients.delete(key);
			}
			return;
		}
		// A client's opaque bytes. Sealed: hand to its session, which decrypts a
		// command or absorbs a handshake frame. Plaintext: parse and apply directly.
		const client = clients.get(clientKey(frame.deviceId, frame.attachId));
		if (client?.seal) {
			void client.seal.handleInbound(frame.payload).then((result) => {
				if (result.type === 'command') applyCommandPayload(result.plaintext);
			});
			return;
		}
		if (sealing) return; // Sealing on but no session: drop unsealed bytes.
		applyCommandPayload(frame.payload);
	};
	socket.onclose = () => {
		clients.clear();
	};

	return {
		ready,
		close() {
			unsubscribe();
			clients.clear();
			socket.close();
		},
	};
}

/** The default outbound socket: the global `WebSocket` as a {@link RelayHostSocket}. */
function defaultOpenSocket(url: string, protocols?: string[]): RelayHostSocket {
	return new WebSocket(url, protocols) as unknown as RelayHostSocket;
}

/** Parse one relay-to-host frame; anything off the endpoint-addressed shape drops. */
function parseRelayToHostFrame(data: string): RelayToHostFrame | undefined {
	let value: unknown;
	try {
		value = JSON.parse(data);
	} catch {
		return undefined;
	}
	if (value === null || typeof value !== 'object') return undefined;
	const record = value as Record<string, unknown>;
	if (
		typeof record.deviceId !== 'string' ||
		typeof record.attachId !== 'string'
	)
		return undefined;
	if (record.event === 'attach' || record.event === 'detach') {
		return {
			deviceId: record.deviceId,
			attachId: record.attachId,
			event: record.event,
		};
	}
	if (typeof record.payload === 'string') {
		return {
			deviceId: record.deviceId,
			attachId: record.attachId,
			payload: record.payload,
		};
	}
	return undefined;
}

/** Decode a client's opaque payload into a host command, or nothing. */
function parseCommandPayload(
	payload: string,
): SuperChatClientCommand | undefined {
	try {
		return parseSuperChatCommand(JSON.parse(payload));
	} catch {
		return undefined;
	}
}
