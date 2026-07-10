/**
 * The Bun sidecar entrypoint: accept one versioned boot frame from Rust, bind
 * its validated loopback port, announce readiness once, and remain tied to the
 * parent stdin pipe for the lifetime of the desktop application.
 *
 * Inference is BYOK for this slice: an OpenAI-compatible endpoint configured
 * by environment. The engine reads the context per turn, so a restart is only
 * needed to change it because this entrypoint reads the env once.
 */

import { join } from 'node:path';
import { type AgentEngine, createOpenAiAgentEngine } from '@epicenter/client';
import { createQueryHost, type QueryHost } from './host.ts';
import { createQueryServer } from './server.ts';
import {
	createReadyFrame,
	parseBootFrame,
	parseRuntimeMode,
	superviseSidecar,
	watchParentPipe,
} from './sidecar-runtime.ts';

async function main(): Promise<void> {
	const parentPipe = watchParentPipe(Bun.stdin.stream());
	let host: QueryHost | undefined;
	let server: ReturnType<typeof Bun.serve> | undefined;
	let lifecycleOwnsResources = false;

	try {
		const runtimeMode = parseRuntimeMode(Bun.argv);
		const boot = parseBootFrame(await parentPipe.bootLine, runtimeMode);

		const { engine, model } = queryEngineFromEnvironment(process.env);

		host = await createQueryHost({ engine, model });

		const pageFile = process.env.EPICENTER_QUERY_DIST
			? Bun.file(join(process.env.EPICENTER_QUERY_DIST, 'index.html'))
			: Bun.file(new URL('../dist/index.html', import.meta.url));
		if (!(await pageFile.exists())) {
			throw new Error(
				'The built SPA is missing. Run `bun run --filter @epicenter/epicenter build` first.',
			);
		}
		const page = await pageFile.text();
		const origin = `http://127.0.0.1:${boot.port}`;
		const { app, websocket } = createQueryServer({
			host,
			origin,
			launchToken: boot.token,
			queryPage: page,
		});

		server = Bun.serve({
			// The Rust-owned port has already passed the mode-specific policy.
			hostname: '127.0.0.1',
			port: boot.port,
			fetch: app.fetch,
			websocket,
		});

		process.stdout.write(`${JSON.stringify(createReadyFrame(boot.port))}\n`);
		lifecycleOwnsResources = true;
		await superviseSidecar({ server, host, parentPipe });
	} finally {
		if (!lifecycleOwnsResources) {
			if (server) await server.stop(true);
			if (host) await host[Symbol.asyncDispose]();
			await parentPipe.cancel();
		}
	}
}

export function queryEngineFromEnvironment(
	environment: Record<string, string | undefined>,
): { engine: AgentEngine; model: string } {
	const baseURL = environment.EPICENTER_QUERY_INFERENCE_URL;
	const model = environment.EPICENTER_QUERY_MODEL;
	const apiKey = environment.EPICENTER_QUERY_API_KEY;
	if (!baseURL || !model) {
		return {
			model: 'unconfigured',
			engine: async function* () {
				yield {
					type: 'run-error',
					code: 'stream-error',
					message:
						'Query needs an OpenAI-compatible endpoint. Set EPICENTER_QUERY_INFERENCE_URL and EPICENTER_QUERY_MODEL, then restart Epicenter.',
				};
			},
		};
	}

	return {
		model,
		engine: createOpenAiAgentEngine({
			data: () => ({
				fetch: apiKey
					? (input, init) =>
							fetch(input, {
								...init,
								headers: {
									...init?.headers,
									authorization: `Bearer ${apiKey}`,
								},
							})
					: fetch,
				baseURL,
				model,
				systemPrompts: [
					'You are Query, a local assistant that acts across the apps on this machine through their tools.',
				],
			}),
		}),
	};
}

try {
	await main();
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
