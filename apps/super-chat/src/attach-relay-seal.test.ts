/**
 * AttachRelay sealing proof (ADR-0115 wave 4): authenticated, content-blind
 * encryption above the relay. These run on the same authenticated self-host mount
 * as wave 3 (`mountAttachRelayApp` + per-device grants), with sealing turned on
 * in the Super Chat adapters. What they pin:
 *
 * - A sealed host and client share one session end to end, exactly as the
 *   plaintext path does, so sealing is a transparent layer above the transport.
 * - The relay forwards only ciphertext: every payload captured at the host wire
 *   is either a handshake frame (public keys and MACs, no content) or a sealed
 *   frame, and none of them contain a prompt, a tool name, an approval, or a
 *   decodable Super Chat command or snapshot.
 * - A malicious relay that substitutes its own ephemeral key cannot complete the
 *   handshake (the PSK-keyed confirmation MAC fails), so no session forms and no
 *   plaintext ever crosses it: there is no man-in-the-middle.
 * - The pairing secret is what authenticates: a wrong PSK stalls, and re-pairing
 *   with the matching PSK recovers, which is how a lost key is replaced.
 *
 * The PSK is a pairing artifact injected here, distinct from the wave-3 relay
 * grant (the relay sees the grant on connect, so it cannot be the anti-MITM
 * secret). The device-grant plumbing is unchanged; sealing rides above it.
 */

import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	createAttachRelayBunServer,
	createBunRooms,
	createDeviceGrantStore,
	createServerApp,
	type DeviceGrantStore,
	mergeBunWebSocketHandlers,
	mountAttachRelayApp,
} from '@epicenter/server/bun';
import type { AgentEngine, EngineChunk } from '@epicenter/workspace/agent';
import {
	createAttachRelayClient,
	type RelayClientSocket,
} from './attach-relay-client.ts';
import {
	attachHostToRelay,
	type RelayHostSocket,
} from './attach-relay-host.ts';
import {
	createClientSealSession,
	startHostSealSession,
} from './attach-relay-seal.ts';
import { createSuperChatHost, type SuperChatHost } from './host.ts';
import type { SuperChatServerEvent } from './server.ts';

const HOST_ID = 'host-mac';

function scriptedEngine(scripts: EngineChunk[][]): AgentEngine {
	let step = 0;
	return async function* () {
		const script = scripts[Math.min(step, scripts.length - 1)] ?? [];
		step += 1;
		for (const chunk of script) yield chunk;
	};
}

function testDataDir(): string {
	return mkdtempSync(join(tmpdir(), 'super-chat-seal-'));
}

function createTestHost(engine: AgentEngine) {
	return createSuperChatHost({
		dataDir: testDataDir(),
		model: 'test-model',
		engine,
	});
}

/** A fresh pairing pre-shared key, the out-of-band secret both endpoints share. */
function makePsk(): Uint8Array {
	return crypto.getRandomValues(new Uint8Array(32));
}

/**
 * Stand up the authenticated self-host relay (the wave-3 wiring). Sealing is a
 * layer in the adapters, so the mount is untouched; the store is returned so a
 * test can mint the device grants the connect still needs.
 */
function serveSelfHostRelay(): {
	server: ReturnType<typeof Bun.serve>;
	origin: string;
	grants: DeviceGrantStore;
} {
	const bunRooms = createBunRooms({ dir: testDataDir() });
	const attachRelay = createAttachRelayBunServer();
	const grants = createDeviceGrantStore();
	const app = createServerApp({
		resolveRooms: () => bunRooms.rooms,
		identity: {
			resolveOrigin: () => 'http://127.0.0.1',
			resolveTrustedOrigins: () => [],
		},
	});
	mountAttachRelayApp(app, {
		resolveBearerPrincipal: grants.resolveBearerPrincipal,
		relay: attachRelay,
	});
	const server = Bun.serve({
		hostname: '127.0.0.1',
		port: 0,
		fetch: (req) => app.fetch(req, {} as never),
		websocket: mergeBunWebSocketHandlers({
			rooms: bunRooms.websocket,
			attach: attachRelay.websocket,
		}),
	});
	bunRooms.bindServer(server);
	attachRelay.bindServer(server);
	return { server, origin: `ws://127.0.0.1:${server.port}`, grants };
}

async function grantFor(
	grants: DeviceGrantStore,
	deviceId: string,
): Promise<string> {
	return (await grants.mint({ deviceId })).token;
}

/** Resolve on the first snapshot matching `predicate`, checking the latest first. */
function nextClientSnapshot(
	client: {
		latest(): SuperChatServerEvent | undefined;
		subscribe(l: (e: SuperChatServerEvent) => void): () => void;
	},
	predicate: (event: SuperChatServerEvent) => boolean,
	description: string,
	timeoutMs = 5000,
): Promise<SuperChatServerEvent> {
	return new Promise((resolve, reject) => {
		let unsubscribe = () => {};
		const timer = setTimeout(() => {
			unsubscribe();
			reject(new Error(`timed out waiting for ${description}`));
		}, timeoutMs);
		const settle = (event: SuperChatServerEvent) => {
			if (!predicate(event)) return;
			clearTimeout(timer);
			unsubscribe();
			resolve(event);
		};
		unsubscribe = client.subscribe(settle);
		const current = client.latest();
		if (current) settle(current);
	});
}

const settledWith =
	(text: string) =>
	(event: SuperChatServerEvent): boolean => {
		const conversation = event.snapshot.conversation;
		const last = conversation.messages.at(-1);
		return (
			!conversation.isGenerating &&
			last?.role === 'assistant' &&
			last.parts.some(
				(part) => part.type === 'text' && part.text.includes(text),
			)
		);
	};

/** Wrap a real host socket to record every frame crossing the host wire (the relay's view). */
function capturingHostSocket(
	frames: string[],
): (url: string, protocols?: string[]) => RelayHostSocket {
	return (url, protocols) => {
		const ws = new WebSocket(url, protocols);
		const originalSend = ws.send.bind(ws);
		(ws as { send: (data: string) => void }).send = (data: string) => {
			frames.push(data);
			originalSend(data);
		};
		ws.addEventListener('message', (event) => {
			if (typeof event.data === 'string') frames.push(event.data);
		});
		return ws as unknown as RelayHostSocket;
	};
}

const wait = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

describe('AttachRelay sealing (ADR-0115 wave 4)', () => {
	test('a sealed host and client share one session end to end', async () => {
		await using host: SuperChatHost = await createTestHost(
			scriptedEngine([
				[{ type: 'text-delta', delta: 'Sealed and delivered.' }],
			]),
		);
		const { server, origin, grants } = serveSelfHostRelay();
		const psk = makePsk();
		const relayHost = attachHostToRelay({
			host,
			relayOrigin: origin,
			principalId: 'ignored',
			hostId: HOST_ID,
			bearer: await grantFor(grants, 'host-mac'),
			sealing: { resolvePsk: () => psk },
		});
		await relayHost.ready;

		const client = createAttachRelayClient({
			relayOrigin: origin,
			principalId: 'ignored',
			hostId: HOST_ID,
			deviceId: 'phone',
			attachId: 'attach-1',
			bearer: await grantFor(grants, 'phone'),
			sealing: { psk },
		});
		await client.ready;
		try {
			const settled = nextClientSnapshot(
				client,
				settledWith('Sealed and delivered.'),
				'the sealed client settling',
			);
			client.send({ type: 'send', content: 'secret prompt over the relay' });
			const event = await settled;
			expect(event.snapshot.conversation.messages.map((m) => m.role)).toEqual([
				'user',
				'assistant',
			]);
		} finally {
			client.close();
			relayHost.close();
			await server.stop(true);
		}
	});

	test('the relay forwards only ciphertext: no prompt, tool, or approval plaintext crosses it', async () => {
		await using host: SuperChatHost = await createTestHost(
			scriptedEngine([
				[
					{
						type: 'tool-call',
						toolCallId: 'call-1',
						toolName: 'todos__todos_create',
						input: { title: 'Buy oat milk' },
					},
				],
				[{ type: 'text-delta', delta: 'Created it.' }],
			]),
		);
		const { server, origin, grants } = serveSelfHostRelay();
		const psk = makePsk();
		const hostWireFrames: string[] = [];
		const relayHost = attachHostToRelay({
			host,
			relayOrigin: origin,
			principalId: 'ignored',
			hostId: HOST_ID,
			bearer: await grantFor(grants, 'host-mac'),
			sealing: { resolvePsk: () => psk },
			openSocket: capturingHostSocket(hostWireFrames),
		});
		await relayHost.ready;

		const client = createAttachRelayClient({
			relayOrigin: origin,
			principalId: 'ignored',
			hostId: HOST_ID,
			deviceId: 'phone',
			attachId: 'attach-1',
			bearer: await grantFor(grants, 'phone'),
			sealing: { psk },
		});
		await client.ready;
		try {
			const pending = nextClientSnapshot(
				client,
				(event) => event.snapshot.pendingApprovals.length === 1,
				'the sealed client seeing the approval',
			);
			// A prompt, a tool call, and an approval all cross the relay this turn.
			client.send({ type: 'send', content: 'buy oat milk please' });
			const pendingEvent = await pending;
			const approval = pendingEvent.snapshot.pendingApprovals[0];
			if (!approval) throw new Error('expected a pending approval');
			const settled = nextClientSnapshot(
				client,
				settledWith('Created it.'),
				'the sealed client settling after approval',
			);
			client.send({ type: 'approve', requestId: approval.id, approved: true });
			await settled;

			expect(hostWireFrames.length).toBeGreaterThan(0);
			// Every secret that flowed this turn must be absent from the relay's view.
			const secrets = [
				'buy oat milk please',
				'Buy oat milk',
				'todos__todos_create',
				'Created it.',
				'approve',
				'send',
				'snapshot',
				'pendingApprovals',
			];
			let sealedFrameCount = 0;
			let handshakeFrameCount = 0;
			const allowedWireKeys = new Set([
				'deviceId',
				'attachId',
				'event',
				'payload',
			]);
			for (const frame of hostWireFrames) {
				for (const secret of secrets) {
					expect(frame).not.toContain(secret);
				}
				const envelope = JSON.parse(frame) as Record<string, unknown>;
				// The wire is still endpoint-addressed: sealing added nothing to the
				// relay's routing surface. The seal fields live inside the opaque
				// `payload`, never as top-level routing keys (ADR-0115 clause 1).
				for (const key of Object.keys(envelope)) {
					expect(allowedWireKeys.has(key)).toBe(true);
				}
				const payload = envelope.payload;
				if (typeof payload !== 'string') continue;
				// The payload is opaque: it never decodes to a command or a snapshot;
				// it is a sealed or handshake envelope only.
				const inner = JSON.parse(payload) as Record<string, unknown>;
				expect(inner.type).toBeUndefined(); // not a SuperChatServerEvent
				expect(inner.k === 'seal' || inner.k === 'hs').toBe(true);
				if (inner.k === 'seal') sealedFrameCount += 1;
				if (inner.k === 'hs') handshakeFrameCount += 1;
			}
			// The turn really did travel sealed, and a handshake really did run.
			expect(sealedFrameCount).toBeGreaterThan(0);
			expect(handshakeFrameCount).toBeGreaterThan(0);
		} finally {
			client.close();
			relayHost.close();
			await server.stop(true);
		}
	});

	test('a relay that substitutes its own ephemeral key cannot man-in-the-middle', async () => {
		await using host: SuperChatHost = await createTestHost(
			scriptedEngine([
				[{ type: 'text-delta', delta: 'Never reaches the wire.' }],
			]),
		);
		const { server, origin, grants } = serveSelfHostRelay();
		const psk = makePsk();

		// A malicious relay generates its own ephemeral key and swaps it into the
		// host's offer, so the client would agree a key with the relay, not the host.
		const attacker = await crypto.subtle.generateKey(
			{ name: 'ECDH', namedCurve: 'P-256' },
			true,
			['deriveBits'],
		);
		const attackerPubRaw = new Uint8Array(
			await crypto.subtle.exportKey('raw', attacker.publicKey),
		);
		let attackerB64 = '';
		for (const byte of attackerPubRaw) attackerB64 += String.fromCharCode(byte);
		attackerB64 = btoa(attackerB64);

		/** A client socket whose inbound host offer has its ephemeral key substituted. */
		const maliciousClientSocket = (
			url: string,
			protocols?: string[],
		): RelayClientSocket => {
			const ws = new WebSocket(url, protocols);
			const wrapper: RelayClientSocket = {
				send: (data) => ws.send(data),
				close: () => ws.close(),
				get readyState() {
					return ws.readyState;
				},
				onopen: null,
				onmessage: null,
				onclose: null,
			};
			ws.addEventListener('open', () => wrapper.onopen?.());
			ws.addEventListener('close', () => wrapper.onclose?.());
			ws.addEventListener('message', (event) => {
				let data = event.data as unknown;
				if (typeof data === 'string' && data.includes('"s":"offer"')) {
					const frame = JSON.parse(data) as Record<string, unknown>;
					frame.epk = attackerB64; // substitute the host's key
					data = JSON.stringify(frame);
				}
				wrapper.onmessage?.({ data });
			});
			return wrapper;
		};

		const relayHost = attachHostToRelay({
			host,
			relayOrigin: origin,
			principalId: 'ignored',
			hostId: HOST_ID,
			bearer: await grantFor(grants, 'host-mac'),
			sealing: { resolvePsk: () => psk },
		});
		await relayHost.ready;

		const client = createAttachRelayClient({
			relayOrigin: origin,
			principalId: 'ignored',
			hostId: HOST_ID,
			deviceId: 'phone',
			attachId: 'attach-1',
			bearer: await grantFor(grants, 'phone'),
			sealing: { psk },
			openSocket: maliciousClientSocket,
		});
		try {
			// The host cannot verify the client's accept (its transcript covers the
			// substituted key), so it never confirms and the session never forms.
			const outcome = await Promise.race([
				client.ready.then(() => 'ready' as const),
				wait(750).then(() => 'stalled' as const),
			]);
			expect(outcome).toBe('stalled');
			// Nothing ever decrypted, so no snapshot reached the client.
			expect(client.latest()).toBeUndefined();
		} finally {
			client.close();
			relayHost.close();
			await server.stop(true);
		}
	});

	test('a wrong PSK stalls, and re-pairing with the matching PSK recovers', async () => {
		const { server, origin, grants } = serveSelfHostRelay();
		try {
			// The host pairs under one PSK.
			const hostPsk = makePsk();
			await using host: SuperChatHost = await createTestHost(
				scriptedEngine([[{ type: 'text-delta', delta: 'Paired at last.' }]]),
			);
			const relayHost = attachHostToRelay({
				host,
				relayOrigin: origin,
				principalId: 'ignored',
				hostId: HOST_ID,
				bearer: await grantFor(grants, 'host-mac'),
				sealing: { resolvePsk: () => hostPsk },
			});
			await relayHost.ready;

			// A client with the WRONG PSK cannot authenticate: it stalls.
			const wrongClient = createAttachRelayClient({
				relayOrigin: origin,
				principalId: 'ignored',
				hostId: HOST_ID,
				deviceId: 'phone',
				attachId: 'attach-wrong',
				bearer: await grantFor(grants, 'phone'),
				sealing: { psk: makePsk() },
			});
			const wrongOutcome = await Promise.race([
				wrongClient.ready.then(() => 'ready' as const),
				wait(600).then(() => 'stalled' as const),
			]);
			expect(wrongOutcome).toBe('stalled');
			wrongClient.close();

			// Re-pair: a client holding the host's PSK attaches and settles.
			const goodClient = createAttachRelayClient({
				relayOrigin: origin,
				principalId: 'ignored',
				hostId: HOST_ID,
				deviceId: 'phone',
				attachId: 'attach-good',
				bearer: await grantFor(grants, 'phone'),
				sealing: { psk: hostPsk },
			});
			await goodClient.ready;
			const settled = nextClientSnapshot(
				goodClient,
				settledWith('Paired at last.'),
				'the re-paired client settling',
			);
			goodClient.send({ type: 'send', content: 'hello again' });
			await settled;
			goodClient.close();
			relayHost.close();
		} finally {
			await server.stop(true);
		}
	});

	test('two sealed clients, each with its own PSK, share one session', async () => {
		await using host: SuperChatHost = await createTestHost(
			scriptedEngine([[{ type: 'text-delta', delta: 'Both sealed.' }]]),
		);
		const { server, origin, grants } = serveSelfHostRelay();
		// Each paired device has its own PSK, resolved by the transport deviceId.
		const psks = new Map<string, Uint8Array>([
			['phone', makePsk()],
			['cli', makePsk()],
		]);
		const relayHost = attachHostToRelay({
			host,
			relayOrigin: origin,
			principalId: 'ignored',
			hostId: HOST_ID,
			bearer: await grantFor(grants, 'host-mac'),
			sealing: { resolvePsk: ({ deviceId }) => psks.get(deviceId) },
		});
		await relayHost.ready;

		const phone = createAttachRelayClient({
			relayOrigin: origin,
			principalId: 'ignored',
			hostId: HOST_ID,
			deviceId: 'phone',
			attachId: 'attach-1',
			bearer: await grantFor(grants, 'phone'),
			sealing: { psk: psks.get('phone') as Uint8Array },
		});
		const cli = createAttachRelayClient({
			relayOrigin: origin,
			principalId: 'ignored',
			hostId: HOST_ID,
			deviceId: 'cli',
			attachId: 'attach-2',
			bearer: await grantFor(grants, 'cli'),
			sealing: { psk: psks.get('cli') as Uint8Array },
		});
		await Promise.all([phone.ready, cli.ready]);
		try {
			const phoneSettled = nextClientSnapshot(
				phone,
				settledWith('Both sealed.'),
				'the phone settling',
			);
			const cliSettled = nextClientSnapshot(
				cli,
				settledWith('Both sealed.'),
				'the cli settling',
			);
			cli.send({ type: 'send', content: 'from the cli' });
			const [phoneEvent, cliEvent] = await Promise.all([
				phoneSettled,
				cliSettled,
			]);
			expect(phoneEvent.snapshot.conversation.messages).toEqual(
				cliEvent.snapshot.conversation.messages,
			);
		} finally {
			phone.close();
			cli.close();
			relayHost.close();
			await server.stop(true);
		}
	});
});

describe('a malformed handshake frame fails closed, never crashes', () => {
	/**
	 * Valid base64, but a 65-byte uncompressed point at (0, 0), which is not on
	 * the P-256 curve, so Web Crypto's `importKey` rejects it. A hostile relay can
	 * substitute exactly this to try to fault the handshake.
	 */
	const offCurvePointB64 = ((): string => {
		const raw = new Uint8Array(65);
		raw[0] = 0x04; // uncompressed prefix
		let binary = '';
		for (const byte of raw) binary += String.fromCharCode(byte);
		return btoa(binary);
	})();

	test('a client drops a malformed offer instead of rejecting', async () => {
		const seal = createClientSealSession({
			psk: makePsk(),
			send: () => {},
			onReady: () => {},
		});
		// Bad base64 in `epk`: `atob` throws inside key decode.
		expect(
			await seal.handleInbound('{"k":"hs","s":"offer","epk":"!!!!"}'),
		).toEqual({ type: 'drop' });
		// Valid base64 but not a curve point: ECDH `importKey` rejects.
		expect(
			await seal.handleInbound(
				JSON.stringify({ k: 'hs', s: 'offer', epk: offCurvePointB64 }),
			),
		).toEqual({ type: 'drop' });
		// No session formed from garbage.
		expect(seal.ready).toBe(false);
	});

	test('a host drops a malformed accept instead of rejecting', async () => {
		const seal = startHostSealSession({
			psk: makePsk(),
			send: () => {},
			onReady: () => {},
		});
		// Bad base64 in `epk`.
		expect(
			await seal.handleInbound(
				'{"k":"hs","s":"accept","epk":"!!!!","mac":"AAAA"}',
			),
		).toEqual({ type: 'drop' });
		// Valid base64 but not a curve point.
		expect(
			await seal.handleInbound(
				JSON.stringify({
					k: 'hs',
					s: 'accept',
					epk: offCurvePointB64,
					mac: 'AAAA',
				}),
			),
		).toEqual({ type: 'drop' });
		expect(seal.ready).toBe(false);
	});
});
