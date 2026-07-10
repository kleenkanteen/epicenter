/**
 * The sidecar entrypoint (ADR-0084): read the per-launch token from stdin
 * (never argv, which any same-user process can read via `ps`), open the host,
 * and serve on a loopback ephemeral port. The one line this prints to stdout
 * is the port announcement Rust discovers via the Tauri sidecar
 * `CommandEvent::Stdout` pattern; everything else goes to stderr.
 *
 * Inference is BYOK for this slice: an OpenAI-compatible endpoint configured
 * by environment. The engine reads the context per turn, so a restart is only
 * needed to change it because this entrypoint reads the env once.
 */

import { createOpenAiAgentEngine } from '@epicenter/client';
import { createQueryHost } from './host.ts';
import { createQueryServer } from './server.ts';

const baseURL = process.env.EPICENTER_QUERY_INFERENCE_URL;
const model = process.env.EPICENTER_QUERY_MODEL;
const apiKey = process.env.EPICENTER_QUERY_API_KEY;
if (!baseURL || !model) {
	console.error(
		'Set EPICENTER_QUERY_INFERENCE_URL and EPICENTER_QUERY_MODEL (an OpenAI-compatible endpoint) to start Query.',
	);
	process.exit(1);
}

const token = (await readLine(Bun.stdin.stream())).trim();
if (token === '') {
	console.error(
		'Query expects the per-launch token as the first line on stdin.',
	);
	process.exit(1);
}

const engine = createOpenAiAgentEngine({
	data: () => ({
		fetch: apiKey
			? (input, init) =>
					fetch(input, {
						...init,
						headers: { ...init?.headers, authorization: `Bearer ${apiKey}` },
					})
			: fetch,
		baseURL,
		model,
		systemPrompts: [
			'You are Query, a local assistant that acts across the apps on this machine through their tools.',
		],
	}),
});

const host = await createQueryHost({ engine, model });

const pageFile = Bun.file(new URL('../dist/index.html', import.meta.url));
if (!(await pageFile.exists())) {
	console.error(
		'The built SPA is missing. Run `bun run --filter @epicenter/epicenter build` first.',
	);
	process.exit(1);
}
const page = await pageFile.text();

const { app, websocket } = createQueryServer({ host, token, page });

const server = Bun.serve({
	// Loopback only, never a LAN-reachable interface; port 0 lets the OS pick.
	hostname: '127.0.0.1',
	port: 0,
	fetch: app.fetch,
	websocket,
});

// The port announcement: the single stdout line the Tauri shell waits for.
console.log(JSON.stringify({ port: server.port }));

async function readLine(stream: ReadableStream<Uint8Array>): Promise<string> {
	const decoder = new TextDecoder();
	const reader = stream.getReader();
	let buffer = '';
	try {
		while (true) {
			const { value, done } = await reader.read();
			if (value) {
				buffer += decoder.decode(value, { stream: true });
				const newline = buffer.indexOf('\n');
				if (newline !== -1) return buffer.slice(0, newline);
			}
			if (done) return buffer;
		}
	} finally {
		reader.releaseLock();
	}
}
