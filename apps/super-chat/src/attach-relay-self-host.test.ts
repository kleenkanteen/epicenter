/**
 * AttachRelay proof (ADR-0115): authenticated attach behind INSTANCE_TOKEN.
 *
 * The relay is served the way a self-hosted instance serves it: mounted on
 * `createServerApp` behind the operator bearer (`INSTANCE_TOKEN`, ADR-0075),
 * sharing one `Bun.serve` with the rooms backend through the merged websocket
 * handler. There is one principal-resolution model: the mount resolves the
 * bearer server-side and stamps the instance principal onto the socket. The
 * unauthenticated loopback `fetch` path was removed with its wave-1 test (it had
 * no production caller and was a second principal model), so these proofs run on
 * the one authenticated surface.
 *
 * What this pins:
 * - a host and a client that carry the token attach and share one session,
 *   proving "just works after sign-in" against a self-host URL + token;
 * - two clients share one host session, and either can approve a mutation the
 *   other's turn raised (the host fans one session to every endpoint);
 * - the surface is fail-closed: a wrong token or no token cannot attach;
 * - `principalId` is resolved SERVER-SIDE: two ends that put DIFFERENT
 *   `principalId`s in their query still pair, because the mount ignores the
 *   query and stamps the one instance principal the bearer resolves to;
 * - the authenticated host wire carries only the endpoint envelope, never a
 *   route, channel, or capability name (ADR-0115 clause 1).
 */

import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	createAttachRelayBunServer,
	createBunRooms,
	createEnvTokenResolver,
	createServerApp,
	mergeBunWebSocketHandlers,
	mountAttachRelayApp,
} from '@epicenter/server/bun';
import type { AgentEngine, EngineChunk } from '@epicenter/workspace/agent';
import { createAttachRelayClient } from './attach-relay-client.ts';
import {
	attachHostToRelay,
	type RelayHostSocket,
} from './attach-relay-host.ts';
import { createSuperChatHost, type SuperChatHost } from './host.ts';
import type { SuperChatServerEvent } from './server.ts';

/** A strong-enough operator bearer for the resolver's constant-time compare. */
const TOKEN = 'self-host-instance-token-0123456789abcdef';
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
	return mkdtempSync(join(tmpdir(), 'super-chat-relay-selfhost-'));
}

function createTestHost(engine: AgentEngine) {
	return createSuperChatHost({
		dataDir: testDataDir(),
		model: 'test-model',
		engine,
	});
}

/**
 * Stand up the authenticated self-host relay: `createServerApp` +
 * `mountAttachRelayApp` behind the env-token resolver, sharing one `Bun.serve`
 * with the rooms backend via the merged websocket handler. This is the exact
 * production wiring of `apps/self-host/server.ts`, minus inference/blobs.
 */
function serveSelfHostRelay(token: string) {
	const bunRooms = createBunRooms({ dir: testDataDir() });
	const attachRelay = createAttachRelayBunServer();
	const app = createServerApp({
		resolveRooms: () => bunRooms.rooms,
		identity: {
			resolveOrigin: () => 'http://127.0.0.1',
			resolveTrustedOrigins: () => [],
		},
	});
	const resolveBearerPrincipal = createEnvTokenResolver(token);
	mountAttachRelayApp(app, { resolveBearerPrincipal, relay: attachRelay });

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
	return { server, origin: `ws://127.0.0.1:${server.port}` };
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

/** The turn settled and the last assistant message contains `text`. */
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

/**
 * Open a raw WebSocket and resolve how the handshake settled: `open` if the
 * server upgraded it, `close` if it refused. The negative proof needs no
 * adapter; it only needs to know whether the socket ever opened.
 */
function handshakeOutcome(
	url: string,
	protocols?: string[],
): Promise<'open' | 'close'> {
	return new Promise((resolve) => {
		const ws = new WebSocket(url, protocols);
		ws.onopen = () => {
			resolve('open');
			ws.close();
		};
		ws.onerror = () => {};
		ws.onclose = () => resolve('close');
	});
}

/** Wrap a real host socket to record every frame crossing the host wire. */
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

/** Attach a client endpoint carrying the operator token. */
async function attachClient(
	origin: string,
	deviceId: string,
	attachId: string,
) {
	const client = createAttachRelayClient({
		relayOrigin: origin,
		principalId: 'ignored-by-server',
		hostId: HOST_ID,
		deviceId,
		attachId,
		bearer: TOKEN,
	});
	await client.ready;
	return client;
}

describe('AttachRelay: authenticated attach behind INSTANCE_TOKEN', () => {
	test('a host and client that carry the token share one session', async () => {
		await using host: SuperChatHost = await createTestHost(
			scriptedEngine([
				[{ type: 'text-delta', delta: 'Attached through self-host.' }],
			]),
		);
		const { server, origin } = serveSelfHostRelay(TOKEN);
		const relayHost = attachHostToRelay({
			host,
			relayOrigin: origin,
			principalId: 'ignored-by-server',
			hostId: HOST_ID,
			bearer: TOKEN,
		});
		await relayHost.ready;

		const client = createAttachRelayClient({
			relayOrigin: origin,
			principalId: 'ignored-by-server',
			hostId: HOST_ID,
			deviceId: 'phone',
			attachId: 'attach-1',
			bearer: TOKEN,
		});
		await client.ready;
		try {
			const settled = nextClientSnapshot(
				client,
				settledWith('Attached through self-host.'),
				'the client settling',
			);
			client.send({ type: 'send', content: 'hi over self-host' });
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

	test('the server stamps the instance principal, ignoring the query principalId', async () => {
		await using host: SuperChatHost = await createTestHost(
			scriptedEngine([[{ type: 'text-delta', delta: 'One partition.' }]]),
		);
		const { server, origin } = serveSelfHostRelay(TOKEN);
		// The host and the client put DIFFERENT principalIds in their query. On the
		// unauthenticated wave-1 relay this would key two different partitions and
		// never pair; here the mount ignores both and stamps the one instance
		// principal, so they DO pair.
		const relayHost = attachHostToRelay({
			host,
			relayOrigin: origin,
			principalId: 'principal-A',
			hostId: HOST_ID,
			bearer: TOKEN,
		});
		await relayHost.ready;

		const client = createAttachRelayClient({
			relayOrigin: origin,
			principalId: 'principal-B',
			hostId: HOST_ID,
			deviceId: 'phone',
			attachId: 'attach-1',
			bearer: TOKEN,
		});
		await client.ready;
		try {
			const settled = nextClientSnapshot(
				client,
				settledWith('One partition.'),
				'the client settling across mismatched query principals',
			);
			client.send({ type: 'send', content: 'still one partition' });
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

	test('a wrong token and a missing token both fail closed', async () => {
		const { server, origin } = serveSelfHostRelay(TOKEN);
		try {
			const hostUrl = `${origin}/attach?role=host&principalId=x&hostId=${HOST_ID}`;
			// Wrong token: the bearer resolves to InvalidToken, so the upgrade never
			// happens and the handshake closes.
			expect(
				await handshakeOutcome(hostUrl, ['epicenter', `bearer.${TOKEN}-wrong`]),
			).toBe('close');
			// No token at all: nothing to extract, so 401 and no upgrade.
			expect(await handshakeOutcome(hostUrl, ['epicenter'])).toBe('close');
			expect(await handshakeOutcome(hostUrl)).toBe('close');
			// The correct token DOES upgrade (a host registers with no live client).
			expect(
				await handshakeOutcome(hostUrl, ['epicenter', `bearer.${TOKEN}`]),
			).toBe('open');
		} finally {
			await server.stop(true);
		}
	});

	test('the authenticated host wire is still endpoint-addressed, never route-addressed', async () => {
		await using host: SuperChatHost = await createTestHost(
			scriptedEngine([[{ type: 'text-delta', delta: 'Endpoint only.' }]]),
		);
		const { server, origin } = serveSelfHostRelay(TOKEN);
		const hostWireFrames: string[] = [];
		const relayHost = attachHostToRelay({
			host,
			relayOrigin: origin,
			principalId: 'ignored',
			hostId: HOST_ID,
			bearer: TOKEN,
			openSocket: capturingHostSocket(hostWireFrames),
		});
		await relayHost.ready;

		const client = createAttachRelayClient({
			relayOrigin: origin,
			principalId: 'ignored',
			hostId: HOST_ID,
			deviceId: 'phone',
			attachId: 'attach-1',
			bearer: TOKEN,
		});
		await client.ready;
		try {
			const settled = nextClientSnapshot(
				client,
				settledWith('Endpoint only.'),
				'the client settling',
			);
			client.send({ type: 'send', content: 'hello' });
			await settled;

			expect(hostWireFrames.length).toBeGreaterThan(0);
			const allowedKeys = new Set(['deviceId', 'attachId', 'event', 'payload']);
			const forbidden = [
				'route',
				'channel',
				'capability',
				'name',
				'path',
				'toolName',
			];
			for (const frame of hostWireFrames) {
				const parsed = JSON.parse(frame) as Record<string, unknown>;
				for (const key of Object.keys(parsed)) {
					expect(allowedKeys.has(key)).toBe(true);
				}
				for (const key of forbidden) {
					expect(Object.keys(parsed)).not.toContain(key);
				}
			}
		} finally {
			client.close();
			relayHost.close();
			await server.stop(true);
		}
	});

	test('a turn one client drives settles for both attached clients', async () => {
		await using host: SuperChatHost = await createTestHost(
			scriptedEngine([[{ type: 'text-delta', delta: 'Shared over the relay.' }]]),
		);
		const { server, origin } = serveSelfHostRelay(TOKEN);
		const relayHost = attachHostToRelay({
			host,
			relayOrigin: origin,
			principalId: 'ignored-by-server',
			hostId: HOST_ID,
			bearer: TOKEN,
		});
		await relayHost.ready;

		const phone = await attachClient(origin, 'phone', 'attach-1');
		const cli = await attachClient(origin, 'cli', 'attach-2');
		try {
			const phoneSettled = nextClientSnapshot(
				phone,
				settledWith('Shared over the relay.'),
				'the phone settling',
			);
			const cliSettled = nextClientSnapshot(
				cli,
				settledWith('Shared over the relay.'),
				'the cli settling',
			);

			// The CLI drives; the phone, which sent nothing, sees the same turn.
			cli.send({ type: 'send', content: 'hi from the cli' });

			const [phoneEvent, cliEvent] = await Promise.all([
				phoneSettled,
				cliSettled,
			]);
			expect(phoneEvent.snapshot.conversation.messages).toEqual(
				cliEvent.snapshot.conversation.messages,
			);
			expect(
				phoneEvent.snapshot.conversation.messages.map((m) => m.role),
			).toEqual(['user', 'assistant']);
		} finally {
			phone.close();
			cli.close();
			relayHost.close();
			await server.stop(true);
		}
	});

	test('either client can approve a mutation the other client raised', async () => {
		await using host: SuperChatHost = await createTestHost(
			scriptedEngine([
				[
					{
						type: 'tool-call',
						toolCallId: 'call-approve',
						toolName: 'todos__todos_create',
						input: { title: 'Approve over the relay' },
					},
				],
				[{ type: 'text-delta', delta: 'Created over the relay.' }],
			]),
		);
		const { server, origin } = serveSelfHostRelay(TOKEN);
		const relayHost = attachHostToRelay({
			host,
			relayOrigin: origin,
			principalId: 'ignored-by-server',
			hostId: HOST_ID,
			bearer: TOKEN,
		});
		await relayHost.ready;

		const phone = await attachClient(origin, 'phone', 'attach-1');
		const cli = await attachClient(origin, 'cli', 'attach-2');
		try {
			const phonePending = nextClientSnapshot(
				phone,
				(event) => event.snapshot.pendingApprovals.length === 1,
				'the phone seeing the approval',
			);
			const cliPending = nextClientSnapshot(
				cli,
				(event) => event.snapshot.pendingApprovals.length === 1,
				'the cli seeing the approval',
			);

			// The CLI drives a turn that raises a mutation approval.
			cli.send({ type: 'send', content: 'create a todo' });

			const [phonePendingEvent] = await Promise.all([phonePending, cliPending]);
			const approval = phonePendingEvent.snapshot.pendingApprovals[0];
			if (!approval) throw new Error('expected a pending approval');
			expect(approval.toolName).toBe('todos__todos_create');

			// The PHONE approves the CLI's turn: either endpoint drives the one session.
			const phoneSettled = nextClientSnapshot(
				phone,
				settledWith('Created over the relay.'),
				'the phone settling after approval',
			);
			const cliSettled = nextClientSnapshot(
				cli,
				settledWith('Created over the relay.'),
				'the cli settling after approval',
			);
			phone.send({ type: 'approve', requestId: approval.id, approved: true });

			const [phoneEvent, cliEvent] = await Promise.all([
				phoneSettled,
				cliSettled,
			]);
			expect(phoneEvent.snapshot.pendingApprovals).toEqual([]);
			expect(cliEvent.snapshot.pendingApprovals).toEqual([]);
			expect(cliEvent.snapshot.conversation.error).toBeNull();
		} finally {
			phone.close();
			cli.close();
			relayHost.close();
			await server.stop(true);
		}
	});
});
