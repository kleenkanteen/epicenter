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
import type {
	ConversationSnapshot,
	ToolCatalog,
} from '@epicenter/workspace/agent';
import { Hono } from 'hono';
import { createBunWebSocket } from 'hono/bun';
import type { SuperChatHost } from './host.ts';

/** What a WebSocket client may ask of the one chat session. */
export type ClientCommand =
	| { type: 'send'; content: string }
	| { type: 'stop' }
	| { type: 'retry' };

/** What the server pushes: the full render state, on every loop change. */
export type ServerEvent = { type: 'snapshot'; snapshot: ConversationSnapshot };

export type SuperChatServerOptions = {
	host: SuperChatHost;
	/** The per-launch token; the process must refuse to serve without one. */
	token: string;
};

/**
 * Build the Hono app plus the Bun WebSocket handler to pass to `Bun.serve`.
 * Binding (loopback, port 0) is the entrypoint's job, so tests can serve the
 * same app on an ephemeral port.
 */
export function createSuperChatServer({ host, token }: SuperChatServerOptions) {
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

	// The SPA slot. The real static assets land with the SPA slice; until then
	// the placeholder proves the serving shape (page and API from one origin).
	app.get('/', (c) => c.html(PLACEHOLDER_PAGE));

	app.get('/api/tools', (c) => c.json(listTools(host.tools)));

	app.get(
		'/ws',
		upgradeWebSocket(() => {
			let unsubscribe: (() => void) | undefined;
			const push = (ws: { send(data: string): void }) => {
				const event: ServerEvent = {
					type: 'snapshot',
					snapshot: host.conversation.snapshot(),
				};
				ws.send(JSON.stringify(event));
			};
			return {
				onOpen(_event, ws) {
					unsubscribe = host.conversation.subscribe(() => push(ws));
					push(ws);
				},
				onMessage(event, ws) {
					const command = parseCommand(event.data);
					if (!command) return;
					switch (command.type) {
						case 'send':
							host.conversation.send(command.content);
							break;
						case 'stop':
							host.conversation.stop();
							break;
						case 'retry':
							host.conversation.retry();
							break;
						default:
							command satisfies never;
					}
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

function listTools(tools: ToolCatalog) {
	return {
		tools: tools.definitions().map(({ name, kind, title, description }) => ({
			name,
			kind,
			...(title !== undefined && { title }),
			...(description !== undefined && { description }),
		})),
	};
}

function parseCommand(data: unknown): ClientCommand | undefined {
	if (typeof data !== 'string') return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(data);
	} catch {
		return undefined;
	}
	if (parsed === null || typeof parsed !== 'object') return undefined;
	const command = parsed as Record<string, unknown>;
	if (command.type === 'send' && typeof command.content === 'string') {
		return { type: 'send', content: command.content };
	}
	if (command.type === 'stop') return { type: 'stop' };
	if (command.type === 'retry') return { type: 'retry' };
	return undefined;
}

const PLACEHOLDER_PAGE = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>Super Chat</title>
	</head>
	<body>
		<h1>Super Chat</h1>
		<p>The shell is serving. The SPA lands in a later slice; until then, talk to /ws.</p>
	</body>
</html>
`;
