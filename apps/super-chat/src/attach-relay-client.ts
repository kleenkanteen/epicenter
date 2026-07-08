/**
 * A client endpoint of the AttachRelay (ADR-0115): the "phone" or second
 * browser that attaches to one desktop's Super Chat host and shares its live
 * session. It sends host-owned commands (ADR-0113) as opaque bytes and renders
 * from the host snapshots the relay forwards back; the relay reads neither, only
 * the endpoint envelope it routes by.
 *
 * This is the same session command surface the direct loopback client speaks
 * (`ui/session.svelte.ts`, `session-client.ts`); only the transport differs. It
 * is transport-thin on purpose: the host snapshot is the whole render state, so
 * this client just holds the latest one and fans it to subscribers.
 */

import { ATTACH_RELAY_ROUTE } from '@epicenter/server/bun';
import {
	type ClientSealSession,
	createClientSealSession,
	type SealPsk,
} from './attach-relay-seal.ts';
import type { SuperChatClientCommand } from './host.ts';
import type { SuperChatServerEvent } from './server.ts';

export type AttachRelayClientOptions = {
	/** The relay's origin, e.g. `ws://127.0.0.1:<port>` on loopback. */
	relayOrigin: string;
	/** The principal that owns both this device and the host it attaches to. */
	principalId: string;
	/** The desktop host endpoint to attach to. */
	hostId: string;
	/** This device's id; with `attachId` it is this client endpoint's address. */
	deviceId: string;
	/** This attach session's id, unique per attach on the device. */
	attachId: string;
	/**
	 * This device's attach grant (ADR-0115): the operator pairs the device
	 * once and hands over the minted grant (a QR or a paste), and it rides the
	 * `bearer.<token>` WebSocket subprotocol, the one channel a browser upgrade has.
	 * Every attach is authenticated, so this is required; a revoked or never-minted
	 * grant fails the handshake, so an unpaired device cannot attach.
	 */
	bearer: string;
	/** Inject the socket opener in tests; defaults to the global `WebSocket`. */
	openSocket?: (url: string, protocols?: string[]) => RelayClientSocket;
	/**
	 * Seal this attach (ADR-0115). When present, the client runs an
	 * authenticated ECDH handshake with the host before any command or snapshot
	 * crosses the relay, so the relay forwards only ciphertext. `psk` is this
	 * pairing's pre-shared key (the QR/paste secret, distinct from the relay
	 * grant); with sealing on, `ready` resolves only after the handshake completes,
	 * so a caller that awaits `ready` may send at once. Omit sealing for the
	 * self-host plaintext opt-out (ADR-0115 clause 5).
	 */
	sealing?: { psk: SealPsk };
};

/** The minimal client-socket surface this adapter drives. */
export type RelayClientSocket = {
	send(data: string): void;
	close(): void;
	readyState: number;
	onopen: (() => void) | null;
	onmessage: ((event: { data: unknown }) => void) | null;
	onclose: (() => void) | null;
};

export type AttachRelayClient = {
	/** Resolves once the attach socket has opened. */
	ready: Promise<void>;
	/** Send one host command as opaque bytes to the shared session. */
	send(command: SuperChatClientCommand): void;
	/** The most recent host snapshot, or undefined before the first arrives. */
	latest(): SuperChatServerEvent | undefined;
	/** Observe every host snapshot forwarded to this endpoint. */
	subscribe(listener: (event: SuperChatServerEvent) => void): () => void;
	/** Detach and drop the connection. */
	close(): void;
};

/** Attach to a host endpoint through the relay and mirror its session. */
export function createAttachRelayClient(
	options: AttachRelayClientOptions,
): AttachRelayClient {
	const open = options.openSocket ?? defaultOpenSocket;
	const url = ATTACH_RELAY_ROUTE.clientUrl(options.relayOrigin, {
		principalId: options.principalId,
		hostId: options.hostId,
		deviceId: options.deviceId,
		attachId: options.attachId,
	});
	const socket = open(url, ATTACH_RELAY_ROUTE.subprotocols(options.bearer));

	let latest: SuperChatServerEvent | undefined;
	const listeners = new Set<(event: SuperChatServerEvent) => void>();

	let resolveReady!: () => void;
	const ready = new Promise<void>((resolve) => {
		resolveReady = resolve;
	});

	// Deliver one plaintext server event (sealed or not) to every subscriber.
	const deliver = (data: string): void => {
		const parsed = parseServerEvent(data);
		if (!parsed) return;
		latest = parsed;
		for (const listener of listeners) listener(parsed);
	};

	// Commands sent before the handshake completes are held, then flushed sealed
	// once the session is ready, so a caller need not await readiness per send.
	const pending: SuperChatClientCommand[] = [];
	const seal: ClientSealSession | undefined = options.sealing
		? createClientSealSession({
				psk: options.sealing.psk,
				send: (payload) => socket.send(payload),
				onReady: () => {
					resolveReady();
					for (const command of pending.splice(0)) {
						const sealed = seal?.seal(JSON.stringify(command));
						if (sealed !== undefined) socket.send(sealed);
					}
				},
			})
		: undefined;

	socket.onopen = () => {
		// Plaintext attaches are ready on open; sealed ones wait for the handshake.
		if (!seal) resolveReady();
	};
	socket.onmessage = (event) => {
		if (typeof event.data !== 'string') return;
		if (seal) {
			void seal.handleInbound(event.data).then((result) => {
				if (result.type === 'snapshot') deliver(result.plaintext);
			});
			return;
		}
		deliver(event.data);
	};

	return {
		ready,
		send(command) {
			if (socket.readyState !== 1 /* OPEN */) return;
			if (seal) {
				// Seal before the relay ever sees the bytes; hold until ready.
				const sealed = seal.seal(JSON.stringify(command));
				if (sealed === undefined) pending.push(command);
				else socket.send(sealed);
				return;
			}
			// The command is the opaque payload; the relay never decodes it.
			socket.send(JSON.stringify(command));
		},
		latest() {
			return latest;
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		close() {
			listeners.clear();
			socket.close();
		},
	};
}

function defaultOpenSocket(
	url: string,
	protocols?: string[],
): RelayClientSocket {
	return new WebSocket(url, protocols) as unknown as RelayClientSocket;
}

/** Parse a forwarded host snapshot; a non-snapshot or malformed frame drops. */
function parseServerEvent(data: string): SuperChatServerEvent | undefined {
	try {
		const value = JSON.parse(data) as SuperChatServerEvent;
		return value.type === 'snapshot' ? value : undefined;
	} catch {
		return undefined;
	}
}
