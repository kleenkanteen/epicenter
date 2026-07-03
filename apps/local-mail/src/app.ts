import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import { createApiApp, mintToken } from './http/api.ts';
import { openLocalMailRuntime, openSyncSession } from './runtime.ts';
import { syncMailbox } from './sync.ts';

/**
 * `local-mail app`: one Bun process that serves the triage SPA and its `/api`
 * over `127.0.0.1`, while the same process keeps the mirror fresh through the
 * sync loop. The security model is the up-shell spec's, condensed:
 *
 * - A single-use bootstrap token rides in the URL fragment (never the query
 *   string, so it never lands in a request line or access log). The SPA reads
 *   it, strips it, and exchanges it at `POST /api/session` for a per-launch
 *   session bearer it keeps in sessionStorage. Every other `/api` call carries
 *   that bearer.
 * - Every request is Host-checked first (the DNS-rebinding kill switch): a
 *   request whose Host is not exactly `127.0.0.1:<port>` is rejected before
 *   routing.
 * - Dev mode (`LOCAL_MAIL_DEV=1`) never disables auth. The Vite proxy injects
 *   a fixed `LOCAL_MAIL_TOKEN` bearer and rewrites Host, so the same checks run
 *   against a developer's real mailbox.
 *
 * Routing, the bearer gate, and request validation live in the Hono app
 * (`http/api.ts`); this module owns the loopback host primitive, static SPA
 * serving, and the process lifecycle, dispatching `/api/*` to `api.fetch`.
 */

const DEV = process.env.LOCAL_MAIL_DEV === '1';
const SYNC_INTERVAL_MS = 30_000;

type LockHandle = { db: Database; release(): void };

/**
 * A dedicated `lock.db` held with `BEGIN EXCLUSIVE` for the process lifetime,
 * so a second `up` for the same account is refused instantly. `flock` has no
 * Bun API and an `O_EXCL` lockfile is stale-on-crash; the fcntl lock a live
 * SQLite transaction holds is released by the kernel on `kill -9`.
 */
function acquireAccountLock(dir: string): LockHandle | null {
	const db = new Database(join(dir, 'lock.db'), { create: true });
	db.run('PRAGMA busy_timeout = 0;');
	try {
		db.run('BEGIN EXCLUSIVE;');
	} catch {
		db.close();
		return null;
	}
	return {
		db,
		release() {
			try {
				db.run('ROLLBACK;');
			} catch {
				// The process is exiting; the kernel drops the lock regardless.
			}
			db.close();
		},
	};
}

/**
 * One in-process promise chain: the background loop and a "refresh now" request
 * both enqueue here, so at most one sync pass touches the mirror at a time. No
 * coalescing (a refresh may ride a pass that started before the click); the
 * spec accepts that for v1.
 */
function createSyncGate() {
	let tail: Promise<unknown> = Promise.resolve();
	return function run<T>(fn: () => Promise<T>): Promise<T> {
		const result = tail.then(fn, fn);
		tail = result.catch(() => {});
		return result;
	};
}

/** Serve the built SPA from disk, falling back to index.html for deep links. */
async function serveStatic(
	uiDist: string,
	pathname: string,
): Promise<Response> {
	const rel = pathname === '/' ? '/index.html' : pathname;
	// Reject path traversal before touching the filesystem. `join` collapses
	// `..`, so match on a real separator boundary: a bare `startsWith(uiDist)`
	// would also accept a sibling like `<uiDist>-evil`.
	const target = join(uiDist, rel);
	if (target !== uiDist && !target.startsWith(uiDist + sep)) {
		return new Response('Forbidden', { status: 403 });
	}
	const file = Bun.file(target);
	if (await file.exists()) {
		return new Response(file, {
			headers: { 'referrer-policy': 'no-referrer' },
		});
	}
	const index = Bun.file(join(uiDist, 'index.html'));
	if (await index.exists()) {
		return new Response(index, {
			headers: {
				'content-type': 'text/html',
				'referrer-policy': 'no-referrer',
			},
		});
	}
	return new Response('Not found', { status: 404 });
}

export async function runApp(options: {
	noOpen: boolean;
	port?: number;
}): Promise<number> {
	const { data: runtime, error: runtimeError } = await openLocalMailRuntime();
	// Narrow on `runtime` itself, not just the error: the value is captured in
	// the fetch/loop/SIGINT closures below, where only a truthiness guard on the
	// const survives.
	if (runtimeError || !runtime) {
		console.error(
			runtimeError?.message ?? 'Failed to open local-mail runtime.',
		);
		return 1;
	}

	const accountDir = join(runtime.config.dataDir, runtime.accountEmail);
	const lock = acquireAccountLock(accountDir);
	if (!lock) {
		console.error(
			`local-mail app is already running for ${runtime.accountEmail}. Stop it first, or open the URL it printed.`,
		);
		return 1;
	}

	const { data: session, error: sessionError } = await openSyncSession(
		runtime,
		{
			gmailLog: (m) => console.error(`[gmail] ${m}`),
			syncLog: (m) => console.error(`[sync] ${m}`),
		},
	);
	if (sessionError || !session) {
		lock.release();
		console.error(sessionError?.message ?? 'Failed to open sync session.');
		return 1;
	}

	// Re-bind the non-null values: TS drops the post-guard narrowing of the
	// destructured `runtime`/`session` bindings inside the fetch/loop/SIGINT
	// closures below, so capture them here where the narrowing holds.
	const rt = runtime;
	const sess = session;
	const readOnly = rt.config.readOnly;

	// The valid-bearer set. Dev pre-seeds the fixed proxy token; prod fills it
	// only through the bootstrap exchange handled inside the Hono app.
	const sessionBearers = new Set<string>();
	let bootstrapToken: string | null = null;
	if (DEV) {
		const devToken = process.env.LOCAL_MAIL_TOKEN;
		if (!devToken) {
			lock.release();
			sess.close();
			console.error(
				'LOCAL_MAIL_DEV=1 requires LOCAL_MAIL_TOKEN so the Vite proxy can authenticate.',
			);
			return 1;
		}
		sessionBearers.add(devToken);
	} else {
		bootstrapToken = mintToken();
	}

	const uiDist = join(import.meta.dir, '..', 'ui', 'dist');
	const gate = createSyncGate();
	const controller = new AbortController();

	const api = createApiApp({
		rt,
		syncDeps: sess.deps,
		readOnly,
		gate,
		sessionBearers,
		bootstrapToken,
	});

	const server = Bun.serve({
		hostname: '127.0.0.1',
		port: options.port ?? (Number(process.env.LOCAL_MAIL_PORT) || 0),
		fetch(req) {
			const url = new URL(req.url);

			// Host check first: the DNS-rebinding kill switch. Every request must
			// name this exact loopback origin (the Vite proxy rewrites Host to
			// match via changeOrigin, so dev passes too).
			const expectedHost = `127.0.0.1:${server.port}`;
			if (req.headers.get('host') !== expectedHost) {
				return new Response('Forbidden', { status: 403 });
			}

			if (url.pathname.startsWith('/api/')) return api.fetch(req);
			return serveStatic(uiDist, url.pathname);
		},
	});

	// The background sync loop, serialized through the same gate as POST /api/sync.
	(async () => {
		while (!controller.signal.aborted) {
			await gate(() => syncMailbox(sess.deps, { forceFull: false })).catch(
				(cause) => console.error(`[sync] loop pass failed: ${cause}`),
			);
			if (controller.signal.aborted) break;
			await Bun.sleep(SYNC_INTERVAL_MS);
		}
	})();

	const origin = `http://127.0.0.1:${server.port}`;
	if (DEV) {
		console.error(`local-mail app (dev API) listening on ${origin}`);
		console.error('Run the SPA with: bun run --cwd apps/local-mail/ui dev');
	} else {
		const noOpen = options.noOpen || process.env.LOCAL_MAIL_NO_OPEN === '1';
		const launchUrl = `${origin}/#token=${bootstrapToken}`;
		console.log(launchUrl);
		if (!existsSync(uiDist)) {
			console.error(
				`Note: ${uiDist} does not exist yet. Build the SPA with "bun run --cwd apps/local-mail/ui build".`,
			);
		}
		// `--no-open` prints the URL without launching a browser; the env fallback
		// supports headless hosts, CI, and "copy the URL into the browser I want" workflows.
		if (!noOpen) {
			Bun.spawn(['open', launchUrl]).exited.catch(() => {});
		}
	}

	await new Promise<void>((resolve) => {
		process.on('SIGINT', () => {
			controller.abort();
			server.stop();
			sess.close();
			lock.release();
			resolve();
		});
	});
	return 0;
}
