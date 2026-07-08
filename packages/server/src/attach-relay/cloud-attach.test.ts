/**
 * AttachRelay proof (ADR-0115): account-mediated hosted attach.
 *
 * Self-host already proves the same mount and coordinator with per-device grants,
 * but every grant resolves to the single `instance` principal. That cannot prove
 * the hosted invariant: two signed-in devices under user A may share one host,
 * while user B cannot attach by guessing ids.
 *
 * This test supplies the missing axis with a fake OAuth resolver: distinct
 * bearer tokens resolve to distinct principals. OAuth verification itself is
 * owned by `middleware/require-auth.test.ts`; this file consumes only the
 * `ResolveBearerPrincipal` contract and proves `mountAttachRelayApp` stamps that
 * resolved principal server-side before the coordinator routes the socket.
 *
 * The transport is the existing Bun attach backend because a Workers/Durable
 * Object attach backend is not built yet. The property under test is above that
 * runtime seam: resolver output -> authenticated mount -> coordinator partition.
 */

import { Principal } from '@epicenter/auth';
import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { Ok } from 'wellcrafted/result';
import { OAuthError } from '../auth/oauth-errors.js';
import type { Env, ResolveBearerPrincipal } from '../types.js';
import { createAttachRelayBunServer } from './bun-server.js';
import { RELAY_CLOSE } from './contracts.js';
import { mountAttachRelayApp } from './mount.js';
import { ATTACH_RELAY_ROUTE } from './route.js';

const HOST_ID = 'host-mac';

const A_DESKTOP = 'bearer-a-desktop';
const A_PHONE = 'bearer-a-phone';
const B_ATTACKER = 'bearer-b-attacker';

const PRINCIPAL_A = 'user-a';
const PRINCIPAL_B = 'user-b';

function createFakeOAuthResolver(seed: Record<string, string>): {
	resolveBearerPrincipal: ResolveBearerPrincipal;
	revoke(bearer: string): void;
} {
	const principalByBearer = new Map(Object.entries(seed));
	return {
		resolveBearerPrincipal: async (_c, presented) => {
			const principalId = principalByBearer.get(presented);
			return principalId !== undefined
				? Ok(Principal.assert({ id: principalId }))
				: OAuthError.InvalidToken();
		},
		revoke(bearer) {
			principalByBearer.delete(bearer);
		},
	};
}

/**
 * Bound teardown for the refusal case. Bun can hang when the server closes a
 * WebSocket during its own `open` handler, which is what HOST_NOT_FOUND does.
 * The attach was already refused; the timeout prevents teardown from owning the
 * test result.
 */
async function stopServer(server: ReturnType<typeof Bun.serve>): Promise<void> {
	await Promise.race([
		server.stop(true),
		new Promise((resolve) => setTimeout(resolve, 500)),
	]);
}

function serveCloudRelay(): {
	server: ReturnType<typeof Bun.serve>;
	origin: string;
	resolver: ReturnType<typeof createFakeOAuthResolver>;
} {
	const attachRelay = createAttachRelayBunServer();
	const resolver = createFakeOAuthResolver({
		[A_DESKTOP]: PRINCIPAL_A,
		[A_PHONE]: PRINCIPAL_A,
		[B_ATTACKER]: PRINCIPAL_B,
	});
	const app = new Hono<Env>();
	mountAttachRelayApp(app, {
		resolveBearerPrincipal: resolver.resolveBearerPrincipal,
		relay: attachRelay,
	});

	const server = Bun.serve({
		hostname: '127.0.0.1',
		port: 0,
		fetch: (req) => app.fetch(req, {} as never),
		websocket: attachRelay.websocket,
	});
	attachRelay.bindServer(server);
	return { server, origin: `ws://127.0.0.1:${server.port}`, resolver };
}

type TestSocket = {
	ready: Promise<void>;
	closed: Promise<number>;
	opened(): boolean;
	frames: string[];
	send(data: string): void;
	close(): void;
	next(
		predicate: (frame: string) => boolean,
		description: string,
		timeoutMs?: number,
	): Promise<string>;
};

function openRelaySocket(url: string, bearer: string): TestSocket {
	const ws = new WebSocket(url, ATTACH_RELAY_ROUTE.subprotocols(bearer));
	const frames: string[] = [];
	const listeners = new Set<(frame: string) => void>();
	let didOpen = false;

	let resolveReady!: () => void;
	const ready = new Promise<void>((resolve) => {
		resolveReady = resolve;
	});
	let resolveClosed!: (code: number) => void;
	const closed = new Promise<number>((resolve) => {
		resolveClosed = resolve;
	});

	ws.onopen = () => {
		didOpen = true;
		resolveReady();
	};
	ws.onerror = () => {};
	ws.onmessage = (event) => {
		if (typeof event.data !== 'string') return;
		frames.push(event.data);
		for (const listener of listeners) listener(event.data);
	};
	ws.onclose = (event) => resolveClosed(event.code);

	return {
		ready,
		closed,
		opened: () => didOpen,
		frames,
		send: (data) => ws.send(data),
		close: () => ws.close(),
		next(predicate, description, timeoutMs = 5000) {
			return new Promise((resolve, reject) => {
				const existing = frames.find(predicate);
				if (existing !== undefined) {
					resolve(existing);
					return;
				}
				const timer = setTimeout(() => {
					listeners.delete(check);
					reject(new Error(`timed out waiting for ${description}`));
				}, timeoutMs);
				const check = (frame: string) => {
					if (!predicate(frame)) return;
					clearTimeout(timer);
					listeners.delete(check);
					resolve(frame);
				};
				listeners.add(check);
			});
		},
	};
}

function openHost(
	origin: string,
	bearer: string,
	principalId = PRINCIPAL_A,
): TestSocket {
	return openRelaySocket(
		ATTACH_RELAY_ROUTE.hostUrl(origin, { principalId, hostId: HOST_ID }),
		bearer,
	);
}

function openClient(
	origin: string,
	bearer: string,
	principalId = PRINCIPAL_A,
	deviceId = 'phone',
): TestSocket {
	return openRelaySocket(
		ATTACH_RELAY_ROUTE.clientUrl(origin, {
			principalId,
			hostId: HOST_ID,
			deviceId,
			attachId: 'attach-1',
		}),
		bearer,
	);
}

function frameMatches(
	frame: string,
	fields: Record<string, unknown>,
): boolean {
	let value: unknown;
	try {
		value = JSON.parse(frame);
	} catch {
		return false;
	}
	if (value === null || typeof value !== 'object') return false;
	const record = value as Record<string, unknown>;
	return Object.entries(fields).every(([key, want]) => record[key] === want);
}

const attachFrame = (deviceId = 'phone') => (frame: string) =>
	frameMatches(frame, {
		deviceId,
		attachId: 'attach-1',
		event: 'attach',
	});

describe('AttachRelay: account-mediated hosted attach', () => {
	test('phone A attaches to desktop A and exchanges live session bytes', async () => {
		const { server, origin } = serveCloudRelay();
		const host = openHost(origin, A_DESKTOP);
		await host.ready;

		const phone = openClient(origin, A_PHONE);
		await phone.ready;

		try {
			await host.next(attachFrame(), 'the host seeing the phone attach');

			phone.send('session-command-from-phone');
			await host.next(
				(f) =>
					frameMatches(f, {
						deviceId: 'phone',
						attachId: 'attach-1',
						payload: 'session-command-from-phone',
					}),
				'the host receiving the phone command',
			);

			host.send(
				JSON.stringify({
					deviceId: 'phone',
					attachId: 'attach-1',
					payload: 'snapshot-for-phone',
				}),
			);
			expect(
				await phone.next(
					(f) => f === 'snapshot-for-phone',
					'the phone receiving the host snapshot',
				),
			).toBe('snapshot-for-phone');
		} finally {
			phone.close();
			host.close();
			await stopServer(server);
		}
	});

	test("account B cannot attach to account A's host, even guessing its ids", async () => {
		const { server, origin } = serveCloudRelay();
		const host = openHost(origin, A_DESKTOP);
		await host.ready;

		const attacker = openClient(
			origin,
			B_ATTACKER,
			PRINCIPAL_A,
			'attacker-phone',
		);
		try {
			expect(await attacker.closed).toBe(RELAY_CLOSE.HOST_NOT_FOUND);
			expect(host.frames.some((f) => f.includes('attacker-phone'))).toBe(false);
		} finally {
			attacker.close();
			host.close();
			await stopServer(server);
		}
	});

	test('query principalId is inert because the mount stamps auth principal', async () => {
		const { server, origin } = serveCloudRelay();
		const host = openHost(origin, A_DESKTOP, 'query-says-anything');
		await host.ready;

		const phone = openClient(origin, A_PHONE, 'query-says-something-else');
		await phone.ready;
		try {
			await host.next(
				attachFrame(),
				'the host pairing across mismatched query principals',
			);
		} finally {
			phone.close();
			host.close();
			await stopServer(server);
		}
	});

	test('unknown and revoked bearers fail closed on connect', async () => {
		const { server, origin, resolver } = serveCloudRelay();
		try {
			const hostUrl = ATTACH_RELAY_ROUTE.hostUrl(origin, {
				principalId: PRINCIPAL_A,
				hostId: HOST_ID,
			});

			const forged = openRelaySocket(hostUrl, 'bearer-nobody-issued');
			await forged.closed;
			expect(forged.opened()).toBe(false);

			const live = openRelaySocket(hostUrl, A_PHONE);
			await live.ready;
			expect(live.opened()).toBe(true);
			live.close();

			resolver.revoke(A_PHONE);
			const afterRevoke = openRelaySocket(hostUrl, A_PHONE);
			await afterRevoke.closed;
			expect(afterRevoke.opened()).toBe(false);
		} finally {
			await stopServer(server);
		}
	});
});
