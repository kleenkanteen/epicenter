import { describe, expect, test } from 'bun:test';
import type { AgentEngine, EngineChunk } from '@epicenter/workspace/agent';
import { createSuperChatHost, type SuperChatHost } from './host.ts';
import { createSuperChatServer, type ServerEvent } from './server.ts';

const TOKEN = 'per-launch-secret';

function scriptedEngine(scripts: EngineChunk[][]): AgentEngine {
	let step = 0;
	return async function* () {
		const script = scripts[Math.min(step, scripts.length - 1)] ?? [];
		step += 1;
		for (const chunk of script) yield chunk;
	};
}

async function serveHost(host: SuperChatHost) {
	const { app, websocket } = createSuperChatServer({ host, token: TOKEN });
	const server = Bun.serve({
		hostname: '127.0.0.1',
		port: 0,
		fetch: app.fetch,
		websocket,
	});
	return server;
}

describe('createSuperChatServer', () => {
	test('refuses an empty token at construction', async () => {
		await using host = await createSuperChatHost({
			engine: scriptedEngine([[]]),
		});
		expect(() => createSuperChatServer({ host, token: '' })).toThrow(
			/per-launch token/,
		);
	});

	test('rejects every request without the token, on any route', async () => {
		await using host = await createSuperChatHost({
			engine: scriptedEngine([[]]),
		});
		const server = await serveHost(host);
		try {
			for (const path of ['/', '/api/tools', '/ws', '/nope']) {
				const bare = await fetch(server.url.origin + path);
				expect(bare.status).toBe(401);
				const wrong = await fetch(`${server.url.origin}${path}?token=wrong`);
				expect(wrong.status).toBe(401);
			}
		} finally {
			await server.stop(true);
		}
	});

	test('serves the page via query token and the API via bearer', async () => {
		await using host = await createSuperChatHost({
			engine: scriptedEngine([[]]),
		});
		const server = await serveHost(host);
		try {
			// The initial window URL carries the token once as a query parameter.
			const page = await fetch(`${server.url.origin}/?token=${TOKEN}`);
			expect(page.status).toBe(200);
			expect(await page.text()).toContain('Super Chat');

			// Subsequent fetches carry it as a bearer header.
			const tools = await fetch(`${server.url.origin}/api/tools`, {
				headers: { authorization: `Bearer ${TOKEN}` },
			});
			expect(tools.status).toBe(200);
			const body = (await tools.json()) as {
				tools: Array<{ name: string; kind: string }>;
			};
			expect(body.tools.map((t) => t.name)).toContain('todos__todos_create');
		} finally {
			await server.stop(true);
		}
	});

	test('a WebSocket session drives a chat turn and streams snapshots', async () => {
		await using host = await createSuperChatHost({
			engine: scriptedEngine([
				[{ type: 'text-delta', delta: 'Hello from the host.' }],
			]),
		});
		const server = await serveHost(host);
		try {
			const url = `${server.url.origin.replace('http', 'ws')}/ws?token=${TOKEN}`;
			const ws = new WebSocket(url);
			const snapshots: ServerEvent[] = [];
			const answered = new Promise<ServerEvent>((resolve, reject) => {
				ws.addEventListener('message', (event) => {
					const parsed = JSON.parse(String(event.data)) as ServerEvent;
					snapshots.push(parsed);
					const last = parsed.snapshot.messages.at(-1);
					if (
						!parsed.snapshot.isGenerating &&
						last?.role === 'assistant' &&
						last.parts.some(
							(part) =>
								part.type === 'text' && part.text === 'Hello from the host.',
						)
					) {
						resolve(parsed);
					}
				});
				ws.addEventListener('error', () => reject(new Error('socket error')));
				setTimeout(() => reject(new Error('timed out')), 5000);
			});
			ws.addEventListener('open', () => {
				ws.send(JSON.stringify({ type: 'send', content: 'hi' }));
			});

			const final = await answered;
			expect(final.snapshot.error).toBeNull();
			expect(final.snapshot.messages.map((m) => m.role)).toEqual([
				'user',
				'assistant',
			]);
			ws.close();
		} finally {
			await server.stop(true);
		}
	});

	test('two sockets share the one host session (the remote-session proof)', async () => {
		await using host = await createSuperChatHost({
			engine: scriptedEngine([[{ type: 'text-delta', delta: 'Shared.' }]]),
		});
		const server = await serveHost(host);
		try {
			const url = `${server.url.origin.replace('http', 'ws')}/ws?token=${TOKEN}`;
			const watcher = new WebSocket(url);
			const driver = new WebSocket(url);
			const settledAt = (ws: WebSocket) =>
				new Promise<ServerEvent>((resolve, reject) => {
					ws.addEventListener('message', (event) => {
						const parsed = JSON.parse(String(event.data)) as ServerEvent;
						const last = parsed.snapshot.messages.at(-1);
						if (!parsed.snapshot.isGenerating && last?.role === 'assistant') {
							resolve(parsed);
						}
					});
					setTimeout(() => reject(new Error('timed out')), 5000);
				});
			const bothOpen = Promise.all(
				[watcher, driver].map(
					(ws) =>
						new Promise<void>((resolve) =>
							ws.addEventListener('open', () => resolve()),
						),
				),
			);
			await bothOpen;
			driver.send(
				JSON.stringify({ type: 'send', content: 'hi from device 2' }),
			);

			// The watcher never sent anything, yet sees the same finished turn: one
			// conversation per host process, devices attach to the session
			// (ADR-0080), not to their own thread.
			const [watched, drove] = await Promise.all([
				settledAt(watcher),
				settledAt(driver),
			]);
			expect(watched.snapshot.messages).toEqual(drove.snapshot.messages);
			expect(watched.snapshot.messages.map((m) => m.role)).toEqual([
				'user',
				'assistant',
			]);
			watcher.close();
			driver.close();
		} finally {
			await server.stop(true);
		}
	});

	test('a WebSocket upgrade without the token is refused', async () => {
		await using host = await createSuperChatHost({
			engine: scriptedEngine([[]]),
		});
		const server = await serveHost(host);
		try {
			const ws = new WebSocket(`${server.url.origin.replace('http', 'ws')}/ws`);
			const outcome = await new Promise<'open' | 'refused'>((resolve) => {
				ws.addEventListener('open', () => resolve('open'));
				ws.addEventListener('error', () => resolve('refused'));
				ws.addEventListener('close', () => resolve('refused'));
			});
			expect(outcome).toBe('refused');
		} finally {
			await server.stop(true);
		}
	});
});
