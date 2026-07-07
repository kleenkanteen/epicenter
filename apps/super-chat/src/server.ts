/**
 * The Super Chat shell: one Hono app served by Bun on a loopback address,
 * carrying the SPA page, the HTTP API, and the chat WebSocket from one origin
 * (ADR-0084). Tauri points its window at this server instead of a bundled
 * `frontendDist`.
 *
 * The token gate is a mandatory consequence of that shape, not hardening:
 * Tauri provides no protection for an external-URL window, a loopback bind
 * only stops other machines, and behind this port sits a process with full
 * ambient trust to invoke tools. Every HTTP request and every WebSocket
 * upgrade is rejected before any tool executes unless it carries the
 * per-launch token: an `Authorization: Bearer` header for fetches, or a
 * `?token=` query parameter for the initial page load and WebSocket upgrades
 * (the browser `WebSocket` constructor cannot set custom headers).
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { createBunWebSocket } from 'hono/bun';
import type { AgentToolDefinition } from '@epicenter/workspace/agent';
import {
	parseSuperChatCommand,
	type SuperChatHost,
	type SuperChatSessionSnapshot,
} from './host.ts';
import { SESSION_ROUTE, SESSION_STREAM_ROUTE } from './routes.ts';

/**
 * The transport frames (ADR-0113: the host owns command semantics and session
 * state; the transport owns how they travel). The server pushes the full
 * render state on every host change; `/api/session` returns the same snapshot
 * plus the tool catalog for hydration.
 */
export type SuperChatServerEvent = {
	type: 'snapshot';
	snapshot: SuperChatSessionSnapshot;
};

export type SuperChatSessionResponse = {
	tools: AgentToolDefinition[];
	snapshot: SuperChatSessionSnapshot;
};

export type SuperChatServerOptions = {
	host: SuperChatHost;
	/** The per-launch token; the process must refuse to serve without one. */
	token: string;
	/** The built SPA document; the caller owns reading it from disk. */
	page: string;
};

/**
 * Build the Hono app plus the Bun WebSocket handler to pass to `Bun.serve`.
 * Binding (loopback, port 0) is the entrypoint's job, so tests can serve the
 * same app on an ephemeral port.
 */
export function createSuperChatServer({
	host,
	token,
	page,
}: SuperChatServerOptions) {
	if (token === '') {
		throw new Error(
			'Super Chat refuses to serve without a per-launch token (ADR-0084).',
		);
	}

	const { upgradeWebSocket, websocket } = createBunWebSocket();
	const app = new Hono();

	app.use('*', async (c, next) => {
		const header = c.req.header('authorization');
		const bearer = header?.startsWith('Bearer ')
			? header.slice('Bearer '.length)
			: undefined;
		const candidate = bearer ?? c.req.query('token');
		if (candidate === undefined || !tokensMatch(candidate, token)) {
			return c.text('Unauthorized', 401);
		}
		await next();
	});

	// The SPA: one self-contained document (all JS and CSS inlined by the
	// build), because a separate asset request could not carry the bearer.
	// `no-store` keeps the `/?token=` navigation out of the webview's disk
	// cache, whose entries are keyed by the full URL including the query; the
	// token must never outlive the process (ADR-0084).
	app.get('/', (c) => {
		c.header('cache-control', 'no-store');
		return c.html(page);
	});

	app.get(SESSION_ROUTE.pattern, (c) =>
		c.json({
			tools: host.tools.definitions(),
			snapshot: host.snapshot(),
		} satisfies SuperChatSessionResponse),
	);

	app.get(
		SESSION_STREAM_ROUTE.pattern,
		upgradeWebSocket(() => {
			let unsubscribe: (() => void) | undefined;
			const push = (ws: { send(data: string): void }) => {
				const event: SuperChatServerEvent = {
					type: 'snapshot',
					snapshot: host.snapshot(),
				};
				ws.send(JSON.stringify(event));
			};
			return {
				onOpen(_event, ws) {
					unsubscribe = host.subscribe(() => push(ws));
					push(ws);
				},
				onMessage(event, ws) {
					const command = parseSuperChatCommand(parseFrame(event.data));
					// Malformed frames drop silently for now: our own clients send
					// typed commands, and an error outcome has nothing to name until
					// the direct-invocation vocabulary adds command ids (Wave 2).
					if (!command) return;
					host.handleCommand(command);
					push(ws);
				},
				onClose() {
					unsubscribe?.();
				},
			};
		}),
	);

	return { app, websocket };
}

/** Constant-time token comparison; hashing first equalizes lengths. */
function tokensMatch(candidate: string, expected: string): boolean {
	const a = createHash('sha256').update(candidate).digest();
	const b = createHash('sha256').update(expected).digest();
	return timingSafeEqual(a, b);
}

/** Transport framing only: one text frame to one JSON value, or nothing. */
function parseFrame(data: unknown): unknown {
	if (typeof data !== 'string') return undefined;
	try {
		return JSON.parse(data);
	} catch {
		return undefined;
	}
}
