/**
 * AttachRelay Wave 1 proof (ADR-0115, spec wave 1): endpoint-addressed
 * forwarding, plaintext, loopback.
 *
 * A desktop holds one Super Chat host and registers it with a real loopback
 * relay (`createAttachRelayBunServer` on `Bun.serve`); two client endpoints
 * (a stand-in phone and a stand-in CLI) attach by `hostId` and share the one
 * session. This is the relay-transport counterpart of the direct two-socket
 * proof in `server.test.ts`: the same host-owned session command seam
 * (ADR-0113), now reached over the relay instead of the shell's own loopback
 * WebSocket.
 *
 * What this pins:
 * - both clients see the same host snapshot after a turn either one drives;
 * - either client can approve a mutation the other's turn raised;
 * - every frame on the host wire is endpoint-addressed only: the quadruple
 *   `(principalId, hostId, deviceId, attachId)`, never a route, channel, or
 *   capability name (ADR-0115 clause 1; the relay-floor organs stay deleted).
 */

import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAttachRelayBunServer } from '@epicenter/server/bun';
import type { AgentEngine, EngineChunk } from '@epicenter/workspace/agent';
import { createAttachRelayClient } from './attach-relay-client.ts';
import {
	attachHostToRelay,
	type RelayHostSocket,
} from './attach-relay-host.ts';
import { createSuperChatHost, type SuperChatHost } from './host.ts';
import type { SuperChatServerEvent } from './server.ts';

const PRINCIPAL = 'principal-1';
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
	return mkdtempSync(join(tmpdir(), 'super-chat-relay-test-'));
}

function createTestHost(engine: AgentEngine) {
	return createSuperChatHost({
		dataDir: testDataDir(),
		model: 'test-model',
		engine,
	});
}

/** Stand up the relay coordinator on a loopback Bun server. */
function serveRelay() {
	const relay = createAttachRelayBunServer();
	const server = Bun.serve({
		hostname: '127.0.0.1',
		port: 0,
		fetch: relay.fetch,
		websocket: relay.websocket,
	});
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
 * Wrap a real host-side relay socket and record every frame crossing the host
 * wire, both directions, so a test can assert the addressing carries no route.
 * Outbound frames are captured by shadowing `send`; inbound by a second
 * `message` listener, leaving `onmessage` free for the adapter to drive.
 */
function capturingHostSocket(
	frames: string[],
): (url: string) => RelayHostSocket {
	return (url) => {
		const ws = new WebSocket(url);
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

async function attachClient(
	origin: string,
	deviceId: string,
	attachId: string,
) {
	const client = createAttachRelayClient({
		relayOrigin: origin,
		principalId: PRINCIPAL,
		hostId: HOST_ID,
		deviceId,
		attachId,
	});
	await client.ready;
	return client;
}

describe('AttachRelay wave 1: two clients share one host over the relay', () => {
	test('a turn one client drives settles for both attached clients', async () => {
		await using host: SuperChatHost = await createTestHost(
			scriptedEngine([
				[{ type: 'text-delta', delta: 'Shared over the relay.' }],
			]),
		);
		const { server, origin } = serveRelay();
		const relayHost = attachHostToRelay({
			host,
			relayOrigin: origin,
			principalId: PRINCIPAL,
			hostId: HOST_ID,
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
		const { server, origin } = serveRelay();
		const relayHost = attachHostToRelay({
			host,
			relayOrigin: origin,
			principalId: PRINCIPAL,
			hostId: HOST_ID,
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

	test('every host-wire frame is endpoint-addressed, never route-addressed', async () => {
		await using host: SuperChatHost = await createTestHost(
			scriptedEngine([[{ type: 'text-delta', delta: 'Endpoint only.' }]]),
		);
		const { server, origin } = serveRelay();
		const hostWireFrames: string[] = [];
		const relayHost = attachHostToRelay({
			host,
			relayOrigin: origin,
			principalId: PRINCIPAL,
			hostId: HOST_ID,
			openSocket: capturingHostSocket(hostWireFrames),
		});
		await relayHost.ready;

		const phone = await attachClient(origin, 'phone', 'attach-1');
		try {
			const settled = nextClientSnapshot(
				phone,
				settledWith('Endpoint only.'),
				'the phone settling',
			);
			phone.send({ type: 'send', content: 'hello' });
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
				// The addressing is always the endpoint pair; nothing selects a
				// sub-surface of the host.
				expect(typeof parsed.deviceId).toBe('string');
				expect(typeof parsed.attachId).toBe('string');
			}
		} finally {
			phone.close();
			relayHost.close();
			await server.stop(true);
		}
	});
});
