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
import { createSuperChatHost } from './host.ts';
import { createSuperChatServer } from './server.ts';

const baseURL = process.env.SUPER_CHAT_INFERENCE_URL;
const model = process.env.SUPER_CHAT_MODEL;
const apiKey = process.env.SUPER_CHAT_API_KEY;
if (!baseURL || !model) {
	console.error(
		'Set SUPER_CHAT_INFERENCE_URL and SUPER_CHAT_MODEL (an OpenAI-compatible endpoint) to start Super Chat.',
	);
	process.exit(1);
}

const token = (await readLine(Bun.stdin.stream())).trim();
if (token === '') {
	console.error(
		'Super Chat expects the per-launch token as the first line on stdin.',
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
			'You are Super Chat, a local assistant that acts across the apps installed on this machine through their tools.',
		],
	}),
});

const host = await createSuperChatHost({ engine });

const pageFile = Bun.file(new URL('../dist/index.html', import.meta.url));
if (!(await pageFile.exists())) {
	console.error(
		'The built SPA is missing. Run `bun run --filter @epicenter/super-chat build` first.',
	);
	process.exit(1);
}
const page = await pageFile.text();

const { app, websocket } = createSuperChatServer({ host, token, page });

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
