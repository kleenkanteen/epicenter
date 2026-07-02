import { describe, expect, test } from 'bun:test';
import { encodeSyncUpdate } from '@epicenter/sync';
import * as Y from 'yjs';
import { createSyncSupervisor } from './sync-supervisor.js';

/**
 * Minimal scripted WebSocket standing in for the auth client's opener.
 * Implements exactly the surface the supervisor touches: handler slots,
 * `readyState`, `send`, `close`, and `close`-event listeners for teardown.
 */
class FakeWebSocket {
	readyState: number = WebSocket.CONNECTING;
	binaryType = 'blob';
	onopen: ((event: Event) => void) | null = null;
	onclose: ((event: CloseEvent) => void) | null = null;
	onerror: ((event: Event) => void) | null = null;
	onmessage: ((event: MessageEvent) => void) | null = null;
	sent: (Uint8Array | string)[] = [];
	#closeListeners = new Set<() => void>();

	send(data: Uint8Array | string) {
		this.sent.push(data);
	}

	close(code = 1000, reason = '') {
		this.serverClose(code, reason);
	}

	addEventListener(type: string, listener: () => void) {
		if (type === 'close') this.#closeListeners.add(listener);
	}

	removeEventListener(type: string, listener: () => void) {
		if (type === 'close') this.#closeListeners.delete(listener);
	}

	/** Simulate the 101 completing. */
	open() {
		if (this.readyState !== WebSocket.CONNECTING) return;
		this.readyState = WebSocket.OPEN;
		this.onopen?.(new Event('open'));
	}

	/** Simulate an inbound binary sync frame. */
	receive(frame: Uint8Array) {
		const copy = new Uint8Array(frame);
		this.onmessage?.(
			new MessageEvent('message', { data: copy.buffer as ArrayBuffer }),
		);
	}

	/** Simulate the server closing the socket with a close code. */
	serverClose(code: number, reason = '') {
		if (this.readyState === WebSocket.CLOSED) return;
		this.readyState = WebSocket.CLOSED;
		this.onclose?.(new CloseEvent('close', { code, reason }));
		for (const listener of this.#closeListeners) listener();
	}
}

async function waitFor<T>(
	probe: () => T | undefined | false,
	{ timeoutMs = 3000 }: { timeoutMs?: number } = {},
): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const value = probe();
		if (value) return value;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error('waitFor timed out');
}

/**
 * Boot a supervisor over scripted sockets. Each `openWebSocket` call records
 * its wall-clock time and completes its 101 on the next macrotask (after the
 * supervisor attached its handlers).
 */
function setup() {
	const ydoc = new Y.Doc();
	const sockets: FakeWebSocket[] = [];
	const openTimes: number[] = [];

	const supervisor = createSyncSupervisor(ydoc, {
		url: 'ws://fake.test/rooms/doc',
		onTextFrame: () => {},
		openWebSocket: () => {
			const ws = new FakeWebSocket();
			sockets.push(ws);
			openTimes.push(performance.now());
			setTimeout(() => ws.open(), 0);
			return ws as unknown as WebSocket;
		},
	});

	/** Drive the Yjs handshake so the session counts as connected. */
	async function connectSocket(index: number) {
		const ws = await waitFor(() => sockets[index]);
		// STEP1 goes out in `onopen`; its presence proves handlers are live.
		await waitFor(() => ws.sent.length > 0);
		const remote = new Y.Doc();
		// The protocol's UPDATE payload is a V2 update (applied via applyUpdateV2).
		ws.receive(encodeSyncUpdate({ update: Y.encodeStateAsUpdateV2(remote) }));
		await waitFor(() => supervisor.status.phase === 'connected');
		return ws;
	}

	return { ydoc, supervisor, sockets, openTimes, connectSocket };
}

describe('sync supervisor reconnect pacing', () => {
	test('a 4408 lifetime close reconnects immediately, skipping backoff', async () => {
		const { ydoc, supervisor, sockets, openTimes, connectSocket } = setup();

		const ws = await connectSocket(0);
		// Outlive the scheduled-close session floor so the 4408 counts as the
		// server's scheduled re-handshake rather than a suspicious instant close.
		await new Promise((resolve) => setTimeout(resolve, 1050));
		const closedAt = performance.now();
		ws.serverClose(4408, '');

		await waitFor(() => sockets.length === 2);
		const gap = openTimes[1]! - closedAt;
		// Backoff after a successful session sleeps a jittered 250-500ms; an
		// immediate reconnect is a handful of event-loop turns.
		expect(gap).toBeLessThan(150);

		ydoc.destroy();
		await supervisor.whenDisposed;
	});

	test('a non-4408 close after a successful session still backs off', async () => {
		const { ydoc, supervisor, sockets, connectSocket } = setup();

		const ws = await connectSocket(0);
		ws.serverClose(1006, '');

		// The jittered backoff floor is 250ms; nothing should reconnect yet.
		await new Promise((resolve) => setTimeout(resolve, 150));
		expect(sockets.length).toBe(1);

		await waitFor(() => sockets.length === 2);

		ydoc.destroy();
		await supervisor.whenDisposed;
	});

	test('a permanent auth denial parks sync until reconnect() wakes it', async () => {
		const ydoc = new Y.Doc();
		let attempts = 0;
		const supervisor = createSyncSupervisor(ydoc, {
			url: 'ws://fake.test/rooms/doc',
			onTextFrame: () => {},
			openWebSocket: () => {
				attempts += 1;
				throw {
					name: 'OpenWebSocketDenied',
					message: 'denied',
					permanence: 'permanent',
					code: 'reauth-required',
				};
			},
		});

		await waitFor(() => supervisor.status.phase === 'failed');
		expect(supervisor.status).toMatchObject({
			phase: 'failed',
			reason: { type: 'auth', code: 'reauth-required' },
		});
		await expect(supervisor.whenConnected).rejects.toMatchObject({
			name: 'AuthRejected',
			code: 'reauth-required',
		});

		// Parked: no retry while failed, even past the backoff floor.
		await new Promise((resolve) => setTimeout(resolve, 300));
		expect(attempts).toBe(1);

		// The auth state change signal (reconnect) wakes the parked supervisor.
		supervisor.reconnect();
		await waitFor(() => attempts >= 2);

		ydoc.destroy();
		await supervisor.whenDisposed;
	});

	test('a transient auth denial retries with backoff instead of parking', async () => {
		const ydoc = new Y.Doc();
		let attempts = 0;
		const supervisor = createSyncSupervisor(ydoc, {
			url: 'ws://fake.test/rooms/doc',
			onTextFrame: () => {},
			openWebSocket: () => {
				attempts += 1;
				throw {
					name: 'OpenWebSocketDenied',
					message: 'denied',
					permanence: 'transient',
					code: 'auth-unavailable',
				};
			},
		});

		await waitFor(() => attempts >= 2);
		expect(supervisor.status.phase).toBe('connecting');

		ydoc.destroy();
		await supervisor.whenDisposed;
	});

	test('a 4408 on a session shorter than the floor backs off instead of hot-looping', async () => {
		const { ydoc, supervisor, sockets, connectSocket } = setup();

		const ws = await connectSocket(0);
		// Close well inside the session floor: a server that 4408s every
		// handshake immediately must not induce a zero-delay reconnect loop.
		ws.serverClose(4408, '');

		await new Promise((resolve) => setTimeout(resolve, 150));
		expect(sockets.length).toBe(1);

		await waitFor(() => sockets.length === 2);

		ydoc.destroy();
		await supervisor.whenDisposed;
	});
});
