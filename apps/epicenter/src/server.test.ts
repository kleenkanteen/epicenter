/**
 * Query Server Tests
 *
 * Verifies the loopback shell around one host session (ADR-0084): the
 * per-launch token gates every HTTP request and WebSocket upgrade, the SPA is
 * one self-contained document served byte-for-byte at `/`, and the WebSocket
 * drives the single shared chat session.
 *
 * Key behaviors:
 * - Every route 401s without the token (bearer header or `?token=` query)
 * - `/` returns exactly the page string the server was constructed with
 * - Malformed WebSocket frames drop silently without killing the socket
 * - The real vite build emits one document with no external asset references
 * - The spawned `main.ts` sidecar announces a port, serves the built SPA, and
 *   drives a tool-calling turn against an OpenAI-compatible endpoint
 *
 * See also:
 * - `host.test.ts` for tool catalog composition and turn execution
 * - `packages/client/src/openai-provider.test.ts` for the SSE frame shapes
 *   the fake inference endpoint below reuses
 */

import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentEngine, EngineChunk } from '@epicenter/workspace/agent';
import {
	createQueryHost,
	type QueryHost,
	type QueryHostOptions,
} from './host.ts';
import {
	createQueryServer,
	type QueryServerEvent,
	type QuerySessionResponse,
} from './server.ts';

const TOKEN = 'per-launch-secret';

/** A stand-in for the built SPA document; `/` must return it byte-for-byte. */
const PAGE = '<!doctype html><html><body>Query test page</body></html>';

const queryDir = fileURLToPath(new URL('..', import.meta.url));

function scriptedEngine(scripts: EngineChunk[][]): AgentEngine {
	let step = 0;
	return async function* () {
		const script = scripts[Math.min(step, scripts.length - 1)] ?? [];
		step += 1;
		for (const chunk of script) yield chunk;
	};
}

function testDataDir(): string {
	return mkdtempSync(join(tmpdir(), 'query-server-test-'));
}

function createTestHost(
	options: Omit<QueryHostOptions, 'dataDir' | 'model'>,
) {
	return createQueryHost({
		dataDir: testDataDir(),
		model: 'test-model',
		...options,
	});
}

async function serveHost(host: QueryHost, page: string = PAGE) {
	const { app, websocket } = createQueryServer({
		host,
		token: TOKEN,
		page,
	});
	const server = Bun.serve({
		hostname: '127.0.0.1',
		port: 0,
		fetch: app.fetch,
		websocket,
	});
	return server;
}

function conversationOf(event: QueryServerEvent) {
	return event.snapshot.conversation;
}

function streamUrl(server: { url: URL }): string {
	return `${server.url.origin.replace('http', 'ws')}/api/session/stream?token=${TOKEN}`;
}

/**
 * Resolve on the first pushed frame matching `predicate`; reject on socket
 * error or timeout. The listener attaches synchronously at call time, so call
 * this before (or in the same task as) the send that should trigger it.
 */
function nextSnapshot(
	ws: WebSocket,
	predicate: (event: QueryServerEvent) => boolean,
	description: string,
	timeoutMs = 5000,
): Promise<QueryServerEvent> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error(`timed out waiting for ${description}`)),
			timeoutMs,
		);
		ws.addEventListener('message', (event) => {
			const parsed = JSON.parse(String(event.data)) as QueryServerEvent;
			if (!predicate(parsed)) return;
			clearTimeout(timer);
			resolve(parsed);
		});
		ws.addEventListener('error', () => {
			clearTimeout(timer);
			reject(new Error('socket error'));
		});
	});
}

/** The turn settled and the last assistant message contains `text`. */
const settledWith =
	(text: string) =>
	(event: QueryServerEvent): boolean => {
		const snapshot = conversationOf(event);
		const last = snapshot.messages.at(-1);
		return (
			!snapshot.isGenerating &&
			last?.role === 'assistant' &&
			last.parts.some(
				(part) => part.type === 'text' && part.text.includes(text),
			)
		);
	};

describe('createQueryServer', () => {
	test('refuses an empty token at construction', async () => {
		await using host = await createTestHost({
			engine: scriptedEngine([[]]),
		});
		expect(() =>
			createQueryServer({ host, token: '', page: PAGE }),
		).toThrow(/per-launch token/);
	});

	test('rejects every request without the token, on any route', async () => {
		await using host = await createTestHost({
			engine: scriptedEngine([[]]),
		});
		const server = await serveHost(host);
		try {
			for (const path of [
				'/',
				'/api/session',
				'/api/session/stream',
				'/nope',
			]) {
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
		await using host = await createTestHost({
			engine: scriptedEngine([[]]),
		});
		const server = await serveHost(host);
		try {
			// The initial window URL carries the token once as a query parameter,
			// and the response IS the page the server was constructed with.
			const page = await fetch(`${server.url.origin}/?token=${TOKEN}`);
			expect(page.status).toBe(200);
			expect(await page.text()).toBe(PAGE);
			// The tokened navigation must never land in a disk cache keyed by
			// its full URL (ADR-0084: the token dies with the process).
			expect(page.headers.get('cache-control')).toBe('no-store');

			// Subsequent fetches carry it as a bearer header.
			const session = await fetch(`${server.url.origin}/api/session`, {
				headers: { authorization: `Bearer ${TOKEN}` },
			});
			expect(session.status).toBe(200);
			const body = (await session.json()) as QuerySessionResponse;
			const createTodos = body.tools.find(
				(t) => t.name === 'todos__todos_create',
			);
			expect(createTodos).toBeDefined();
			expect(createTodos?.inputSchema).toBeDefined();
			expect(body.snapshot.conversation.messages).toEqual([]);

			const oldTools = await fetch(`${server.url.origin}/api/tools`, {
				headers: { authorization: `Bearer ${TOKEN}` },
			});
			expect(oldTools.status).toBe(404);

			const oldWs = await fetch(`${server.url.origin}/ws?token=${TOKEN}`);
			expect(oldWs.status).toBe(404);
		} finally {
			await server.stop(true);
		}
	});

	test('a WebSocket session drives a chat turn and streams snapshots', async () => {
		await using host = await createTestHost({
			engine: scriptedEngine([
				[{ type: 'text-delta', delta: 'Hello from the host.' }],
			]),
		});
		const server = await serveHost(host);
		try {
			const ws = new WebSocket(streamUrl(server));
			const answered = nextSnapshot(
				ws,
				settledWith('Hello from the host.'),
				'the settled turn',
			);
			ws.addEventListener('open', () => {
				ws.send(JSON.stringify({ type: 'send', content: 'hi' }));
			});

			const final = await answered;
			expect(conversationOf(final).error).toBeNull();
			expect(conversationOf(final).messages.map((m) => m.role)).toEqual([
				'user',
				'assistant',
			]);
			ws.close();
		} finally {
			await server.stop(true);
		}
	});

	test('a pending approval reappears after reconnect and approval resumes the turn', async () => {
		await using host = await createTestHost({
			engine: scriptedEngine([
				[
					{
						type: 'tool-call',
						toolCallId: 'call-approve',
						toolName: 'todos__todos_create',
						input: { title: 'Approve over WebSocket' },
					},
				],
				[{ type: 'text-delta', delta: 'Created over WebSocket.' }],
			]),
		});
		const server = await serveHost(host);
		try {
			const firstSocket = new WebSocket(streamUrl(server));
			const pending = nextSnapshot(
				firstSocket,
				(event) => event.snapshot.pendingApprovals.length === 1,
				'a pending approval',
			);
			firstSocket.addEventListener('open', () => {
				firstSocket.send(
					JSON.stringify({ type: 'send', content: 'create a todo' }),
				);
			});

			const pendingEvent = await pending;
			const [approval] = pendingEvent.snapshot.pendingApprovals;
			expect(approval).toEqual(
				expect.objectContaining({
					toolCallId: 'call-approve',
					toolName: 'todos__todos_create',
					input: { title: 'Approve over WebSocket' },
				}),
			);
			firstSocket.close();

			// A fresh socket re-renders the same pending approval from host state
			// (ADR-0113): the prompt outlives the transport that first saw it.
			const secondSocket = new WebSocket(streamUrl(server));
			await nextSnapshot(
				secondSocket,
				(event) =>
					event.snapshot.pendingApprovals.some(
						(candidate) => candidate.id === approval!.id,
					),
				'the rehydrated approval',
			);
			secondSocket.send(
				JSON.stringify({
					type: 'approve',
					requestId: approval!.id,
					approved: true,
				}),
			);

			const final = await nextSnapshot(
				secondSocket,
				settledWith('Created over WebSocket.'),
				'the final answer',
			);
			expect(final.snapshot.pendingApprovals).toEqual([]);
			expect(conversationOf(final).error).toBeNull();
			secondSocket.close();
		} finally {
			await server.stop(true);
		}
	});

	test('two sockets share the one host session (the remote-session proof)', async () => {
		await using host = await createTestHost({
			engine: scriptedEngine([[{ type: 'text-delta', delta: 'Shared.' }]]),
		});
		const server = await serveHost(host);
		try {
			const watcher = new WebSocket(streamUrl(server));
			const driver = new WebSocket(streamUrl(server));
			const watcherSettled = nextSnapshot(
				watcher,
				settledWith('Shared.'),
				'the watcher settling',
			);
			const driverSettled = nextSnapshot(
				driver,
				settledWith('Shared.'),
				'the driver settling',
			);
			await Promise.all(
				[watcher, driver].map(
					(ws) =>
						new Promise<void>((resolve) =>
							ws.addEventListener('open', () => resolve()),
						),
				),
			);
			driver.send(
				JSON.stringify({ type: 'send', content: 'hi from device 2' }),
			);

			// The watcher never sent anything, yet sees the same finished turn: one
			// conversation per host process, devices attach to the session
			// (ADR-0080), not to their own thread.
			const [watched, drove] = await Promise.all([
				watcherSettled,
				driverSettled,
			]);
			expect(conversationOf(watched).messages).toEqual(
				conversationOf(drove).messages,
			);
			expect(conversationOf(watched).messages.map((m) => m.role)).toEqual([
				'user',
				'assistant',
			]);
			watcher.close();
			driver.close();
		} finally {
			await server.stop(true);
		}
	});

	test('an invoke frame settles as an invocation record on the same session channel', async () => {
		await using host = await createTestHost({
			engine: scriptedEngine([[]]),
		});
		const server = await serveHost(host);
		try {
			const ws = new WebSocket(streamUrl(server));
			const settled = nextSnapshot(
				ws,
				(event) =>
					event.snapshot.invocations.some(
						(invocation) => invocation.status === 'succeeded',
					),
				'the settled invocation',
			);
			ws.addEventListener('open', () => {
				ws.send(
					JSON.stringify({
						type: 'invoke',
						toolName: 'todos__todos_list',
						input: {},
					}),
				);
			});

			const final = await settled;
			expect(final.snapshot.invocations[0]).toEqual(
				expect.objectContaining({
					toolName: 'todos__todos_list',
					status: 'succeeded',
				}),
			);
			// A direct run rides the session channel but never the transcript.
			expect(conversationOf(final).messages).toEqual([]);
			ws.close();
		} finally {
			await server.stop(true);
		}
	});

	test('malformed frames drop silently without killing the session socket', async () => {
		await using host = await createTestHost({
			engine: scriptedEngine([[{ type: 'text-delta', delta: 'Still alive.' }]]),
		});
		const server = await serveHost(host);
		try {
			const ws = new WebSocket(streamUrl(server));
			const settled = nextSnapshot(
				ws,
				settledWith('Still alive.'),
				'the turn after garbage frames',
			);
			ws.addEventListener('open', () => {
				// Deliberate until commands carry client-minted ids: an error outcome
				// would have nothing to name, so bad frames drop instead of erroring.
				ws.send('not json');
				ws.send(JSON.stringify({ type: 'launch-missiles' }));
				ws.send(JSON.stringify({ type: 'send', content: 'hi' }));
			});
			const final = await settled;
			expect(conversationOf(final).error).toBeNull();
			expect(conversationOf(final).messages.map((m) => m.role)).toEqual([
				'user',
				'assistant',
			]);
			ws.close();
		} finally {
			await server.stop(true);
		}
	});

	test('a WebSocket upgrade without the token is refused', async () => {
		await using host = await createTestHost({
			engine: scriptedEngine([[]]),
		});
		const server = await serveHost(host);
		try {
			const ws = new WebSocket(
				`${server.url.origin.replace('http', 'ws')}/api/session/stream`,
			);
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

// ============================================================================
// Built SPA Tests (the real vite build)
// ============================================================================

let builtPagePromise: Promise<string> | undefined;

/**
 * Run the real vite build once per test run and return dist/index.html.
 * Memoized because both the built-SPA describe and the sidecar smoke need it,
 * and bun test does not guarantee an ordering contract between describes.
 */
function buildSpaOnce(): Promise<string> {
	builtPagePromise ??= (async () => {
		const build = Bun.spawn(['bun', 'x', 'vite', 'build'], {
			cwd: queryDir,
			stdout: 'pipe',
			stderr: 'pipe',
		});
		const exitCode = await build.exited;
		if (exitCode !== 0) {
			const stderr = await new Response(build.stderr).text();
			throw new Error(`vite build exited with ${exitCode}:\n${stderr}`);
		}
		return Bun.file(join(queryDir, 'dist', 'index.html')).text();
	})();
	return builtPagePromise;
}

describe('the built SPA', () => {
	test('the build emits one self-contained document and the server returns it byte-for-byte', async () => {
		const page = await buildSpaOnce();

		// One inline script, and it must be inline: a `src` attribute would be
		// a second request the token gate 401s (ADR-0084: the page is ONE
		// request; every other request carries the token explicitly).
		const scriptTags = page.match(/<script\b[^>]*>/gi) ?? [];
		expect(scriptTags.length).toBeGreaterThan(0);
		for (const tag of scriptTags) {
			expect(tag).not.toMatch(/\ssrc\s*=/i);
		}
		// No asset-bearing tag may reference an external file. Matching tag
		// attributes (not raw substrings) keeps legitimate inline JS or CSS
		// content from false-positives.
		for (const [tag] of page.matchAll(
			/<(?:img|iframe|source|audio|video|embed)\b[^>]*>/gi,
		)) {
			expect(tag).not.toMatch(/\ssrc\s*=/i);
		}
		expect(page).not.toMatch(/<link\b[^>]*\brel\s*=\s*["']?stylesheet/i);
		expect(page).not.toMatch(/<link\b[^>]*\bhref\s*=/i);

		await using host = await createTestHost({
			engine: scriptedEngine([[]]),
		});
		const server = await serveHost(host, page);
		try {
			const response = await fetch(`${server.url.origin}/?token=${TOKEN}`);
			expect(response.status).toBe(200);
			expect(await response.text()).toBe(page);
		} finally {
			await server.stop(true);
		}
	}, 60_000);
});

// ============================================================================
// Sidecar End-to-End Smoke (the real main.ts entrypoint)
// ============================================================================

/** Build an OpenAI SSE response: one `data:` frame per chunk, then `[DONE]`. */
function openAiSse(chunks: object[]): Response {
	const encoder = new TextEncoder();
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) {
				controller.enqueue(
					encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`),
				);
			}
			controller.enqueue(encoder.encode('data: [DONE]\n\n'));
			controller.close();
		},
	});
	return new Response(body, {
		status: 200,
		headers: { 'content-type': 'text/event-stream' },
	});
}

/** First model call: a fragmented streamed tool call to `todos__todos_list`. */
const TOOL_CALL_TURN = [
	{
		choices: [
			{
				delta: {
					tool_calls: [
						{
							index: 0,
							id: 'call_1',
							type: 'function',
							function: { name: 'todos__todos_list', arguments: '' },
						},
					],
				},
				finish_reason: null,
			},
		],
	},
	{
		choices: [
			{
				delta: { tool_calls: [{ index: 0, function: { arguments: '{}' } }] },
				finish_reason: null,
			},
		],
	},
	{ choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
];

const FINAL_TEXT = 'Your todo list is empty.';

/** Second model call: the final assistant sentence as text deltas. */
const FINAL_TEXT_TURN = [
	{
		choices: [{ delta: { content: 'Your todo list' }, finish_reason: null }],
	},
	{ choices: [{ delta: { content: ' is empty.' }, finish_reason: null }] },
	{ choices: [{ delta: {}, finish_reason: 'stop' }] },
];

/**
 * Read the sidecar's stdout until the one-line `{"port": N}` announcement.
 * Rejects with the buffered stdout (or the sidecar's stderr, if it exited)
 * so a failed launch names its cause instead of timing out silently.
 */
async function readPortAnnouncement(
	sidecar: {
		stdout: ReadableStream<Uint8Array>;
		stderr: ReadableStream<Uint8Array>;
	},
	timeoutMs: number,
): Promise<number> {
	const reader = sidecar.stdout.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			reject(
				new Error(
					`no port announcement within ${timeoutMs}ms; stdout so far: ${JSON.stringify(buffer)}`,
				),
			);
		}, timeoutMs);
	});
	try {
		while (true) {
			const { value, done } = await Promise.race([reader.read(), timeout]);
			if (value) {
				buffer += decoder.decode(value, { stream: true });
				const newline = buffer.indexOf('\n');
				if (newline !== -1) {
					const line = buffer.slice(0, newline);
					return (JSON.parse(line) as { port: number }).port;
				}
			}
			if (done) {
				const stderr = await new Response(sidecar.stderr).text();
				throw new Error(
					`the sidecar exited before announcing a port:\n${stderr}`,
				);
			}
		}
	} finally {
		clearTimeout(timer);
		reader.releaseLock();
	}
}

describe('sidecar end-to-end smoke', () => {
	test('the spawned entrypoint serves the built SPA and drives a tool-calling turn', async () => {
		const page = await buildSpaOnce();

		// The fake OpenAI-compatible backend: first request streams a
		// `todos__todos_list` tool call, second streams the final sentence.
		let inferenceRequests = 0;
		const inference = Bun.serve({
			hostname: '127.0.0.1',
			port: 0,
			fetch(request) {
				const { pathname } = new URL(request.url);
				if (request.method !== 'POST' || pathname !== '/v1/chat/completions') {
					return new Response('Not found', { status: 404 });
				}
				inferenceRequests += 1;
				return openAiSse(
					inferenceRequests === 1 ? TOOL_CALL_TURN : FINAL_TEXT_TURN,
				);
			},
		});

		const sidecar = Bun.spawn(['bun', 'run', 'src/main.ts'], {
			cwd: queryDir,
			env: {
				...process.env,
				// The engine POSTs `${baseURL}/chat/completions`, so the base
				// carries the `/v1` prefix.
				EPICENTER_QUERY_INFERENCE_URL: `${inference.url.origin}/v1`,
				EPICENTER_QUERY_MODEL: 'fake-model',
				// Keep the host's replicas out of the real user data directory.
				EPICENTER_QUERY_DATA_DIR: testDataDir(),
			},
			stdin: 'pipe',
			stdout: 'pipe',
			stderr: 'pipe',
		});
		try {
			// The per-launch token travels as the first stdin line, never argv.
			sidecar.stdin.write(`${TOKEN}\n`);
			await sidecar.stdin.flush();
			const port = await readPortAnnouncement(sidecar, 30_000);
			const origin = `http://127.0.0.1:${port}`;

			// The one-request page: exactly the built document.
			const served = await fetch(`${origin}/?token=${TOKEN}`);
			expect(served.status).toBe(200);
			expect(await served.text()).toBe(page);

			// The API behind the bearer exposes the composed catalog and snapshot.
			const session = await fetch(`${origin}/api/session`, {
				headers: { authorization: `Bearer ${TOKEN}` },
			});
			expect(session.status).toBe(200);
			const catalog = (await session.json()) as QuerySessionResponse;
			expect(catalog.tools.map((t) => t.name)).toContain('todos__todos_list');
			expect(catalog.snapshot.conversation.messages).toEqual([]);

			// One WebSocket turn: send, then await the settled snapshot.
			const ws = new WebSocket(
				`ws://127.0.0.1:${port}/api/session/stream?token=${TOKEN}`,
			);
			const settled = nextSnapshot(
				ws,
				settledWith(FINAL_TEXT),
				'the settled turn',
				20_000,
			);
			ws.addEventListener('open', () => {
				ws.send(JSON.stringify({ type: 'send', content: 'list my todos' }));
			});
			let final: QueryServerEvent;
			try {
				final = await settled;
			} finally {
				ws.close();
			}

			expect(conversationOf(final).error).toBeNull();
			const parts = conversationOf(final).messages.flatMap((m) => m.parts);
			expect(parts).toContainEqual(
				expect.objectContaining({
					type: 'tool-call',
					toolName: 'todos__todos_list',
				}),
			);
			expect(parts).toContainEqual(
				expect.objectContaining({
					type: 'tool-result',
					toolName: 'todos__todos_list',
					isError: false,
				}),
			);
			expect(inferenceRequests).toBe(2);
		} finally {
			sidecar.kill();
			await inference.stop(true);
		}
	}, 120_000);
});
