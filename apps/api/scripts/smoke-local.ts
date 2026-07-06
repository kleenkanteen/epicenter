/**
 * One-command local runtime-parity smoke. No Infisical, no secrets, no services.
 *
 * This is the agent-runnable local twin of the `Runtime parity` CI gate
 * (`.github/workflows/ci.runtime-parity.yml`): it boots the Bun runtime port
 * with the dev resolver injected (`server.dev.ts`), waits for health, runs the
 * one-scenario smoke (`smoke.ts`) against it, then tears the server down and
 * propagates the smoke's exit code.
 *
 *   bun run smoke:local        # from apps/api
 *   bun run --cwd apps/api smoke:local   # from the repo root
 *
 * Why it needs nothing:
 *   - Auth is the dev bearer (`Bearer dev:<principalId>`, resolved on localhost
 *     only by `dev-auth.ts`), so no Google OAuth, no Better Auth session, no
 *     seeded user, and no database query on the smoked path.
 *   - The env vars below are throwaway, low-entropy, and deliberately fake. Boot
 *     validates them as strings; the dev path never exercises them. They match
 *     the CI gate's fake values so a local green means the same thing CI's does.
 *   - Rooms are `bun:sqlite` files under a throwaway temp dir, removed on exit.
 *   - Blobs need object storage, so without `BLOBS_S3_*` the blob steps report a
 *     non-fatal SKIP. To get a fully green blob round-trip, start the local S3
 *     store first (`docker compose up -d` in apps/api) and export the same
 *     `BLOBS_S3_*` values the CI gate uses; this script forwards any that are
 *     already set in the environment.
 *
 * Scope mirror: like the CI gate, this proves LOGIC parity (the same Hono app
 * over injected runtime hooks), NOT transport parity. `Bun.serve` vs workerd and
 * the WebSocket upgrade path only differ under `wrangler dev`, which needs real
 * Infisical secrets and stays a manual / staging step.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { API_BUN_DEV_PORT } from '@epicenter/constants/apps';

const scriptDir = import.meta.dir;
const serverEntry = resolve(scriptDir, '../server.dev.ts');
const smokeEntry = resolve(scriptDir, 'smoke.ts');
const baseUrl = `http://localhost:${API_BUN_DEV_PORT}`;

// Dev-safe throwaway env, only filled where the caller left a hole. Setting via
// `??=` lets a caller who HAS a real local Postgres or S3 store override any of
// these (e.g. `BLOBS_S3_ENDPOINT=... bun run smoke:local` for a green blob leg).
process.env.DATABASE_URL ??=
	'postgres://postgres:postgres@localhost:5432/epicenter';
process.env.BETTER_AUTH_SECRET ??= 'smoke-local-not-a-real-secret';
process.env.GOOGLE_CLIENT_ID ??= 'smoke-local-not-a-real-client-id';
process.env.GOOGLE_CLIENT_SECRET ??= 'smoke-local-not-a-real-client-secret';

// Keep room files out of the working tree so a smoke never dirties git status.
const dataRoot = mkdtempSync(join(tmpdir(), 'epicenter-smoke-'));
process.env.DATA_DIR = join(dataRoot, 'rooms');
const serverLog = join(dataRoot, 'server.log');

async function waitForHealth(timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(baseUrl);
			if (res.ok) return true;
		} catch {
			// Server not listening yet; keep polling until the deadline.
		}
		await Bun.sleep(250);
	}
	return false;
}

const logFile = Bun.file(serverLog).writer();
const server = Bun.spawn(['bun', serverEntry], {
	// Capture the server's own logs so a boot failure is diagnosable, but keep
	// them out of the smoke transcript unless something actually breaks.
	stdout: 'pipe',
	stderr: 'pipe',
	env: process.env,
});
// Fan both server streams into the log file without blocking this process.
void server.stdout.pipeTo(
	new WritableStream({
		write: (chunk) => void logFile.write(chunk),
	}),
);
void server.stderr.pipeTo(
	new WritableStream({
		write: (chunk) => void logFile.write(chunk),
	}),
);

function dumpServerLog() {
	logFile.flush();
	try {
		const log = readFileSync(serverLog, 'utf8').trim();
		if (log) {
			console.error('\n----- Bun server log -----');
			console.error(log);
		}
	} catch {
		// No log to show.
	}
}

async function cleanup() {
	server.kill();
	await server.exited;
	logFile.end();
	rmSync(dataRoot, { recursive: true, force: true });
}

let exitCode = 0;
try {
	console.log(
		`\nBooting apps/api Bun runtime port (dev auth) on ${baseUrl} ...`,
	);
	if (!(await waitForHealth(30_000))) {
		console.error('::error:: Bun server did not become healthy within 30s');
		dumpServerLog();
		exitCode = 1;
	} else {
		const smoke = Bun.spawn(['bun', smokeEntry, baseUrl], {
			stdout: 'inherit',
			stderr: 'inherit',
			env: process.env,
		});
		exitCode = await smoke.exited;
		if (exitCode !== 0) {
			console.error(`::error:: Runtime-parity smoke failed (exit ${exitCode})`);
			dumpServerLog();
		}
	}
} finally {
	await cleanup();
}

process.exit(exitCode);
