import { existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import { createApiApp, mintBearer } from './http/api.ts';
import { acquireSyncLock } from './lock.ts';
import { clearPresence, writePresence } from './presence.ts';
import { openLocalMailRuntime, openSyncSession } from './runtime.ts';
import { syncMailbox } from './sync.ts';

/**
 * `local-mail app`: the desktop runtime host. One Bun process serves the triage
 * SPA and its `/api` over `127.0.0.1`, and the same process keeps the mirror
 * fresh through the sync loop, holding the per-account sync lock for its
 * lifetime (the single loop owner). Before Tauri exists this is a loopback web
 * host; Tauri later owns the window and injects the bearer via
 * `initialization_script`, replacing the HTML injection below.
 *
 * The security model, condensed:
 *
 * - Every request is Host-checked first (the DNS-rebinding kill switch): a
 *   request whose Host is not exactly `127.0.0.1:<port>` is rejected before
 *   routing.
 * - The web UI authenticates with a per-launch local API bearer (a loopback
 *   credential, never a Gmail token). The host mints it and hands it to the SPA
 *   by injecting `window.__LOCAL_MAIL__ = { origin, bearer }` into the served
 *   HTML before the SPA's scripts run. No URL fragment, no exchange endpoint, no
 *   sessionStorage. Every `/api` call carries the bearer.
 * - HTML that carries the bearer is served `no-store` (a rotated bearer is never
 *   read from cache) and frame-denied (`frame-ancestors 'none'` +
 *   `X-Frame-Options: DENY`), so a cross-origin page cannot frame the
 *   auto-authenticated SPA and clickjack a triage write.
 * - While running, the host writes a `0600` presence file (`runtime.json`:
 *   `{ origin, bearer, pid }`) so a same-UID out-of-process reader can find this
 *   bearer. Today that reader is the Vite dev server, whose proxy injects the
 *   bearer on each proxied `/api` request (SvelteKit's dev HTML pipeline cannot
 *   reproduce the prod HTML injection). Presence, not discovery-for-spawn:
 *   nothing starts the host from it.
 *
 * Routing, the bearer gate, and request validation live in the Hono app
 * (`http/api.ts`); this module owns the loopback host primitive, static SPA
 * serving with bearer injection, and the process lifecycle, dispatching
 * `/api/*` to `api.fetch`.
 */

const SYNC_INTERVAL_MS = 30_000;

/** Headers on every HTML response that carries the injected bearer. `no-store`
 * keeps a rotated bearer out of the browser cache; the frame denials stop a
 * cross-origin page from framing the auto-authenticated SPA and clickjacking a
 * triage write; `referrer-policy` keeps the loopback origin out of referrers. */
const INJECTED_HTML_HEADERS: Record<string, string> = {
	'content-type': 'text/html; charset=utf-8',
	'cache-control': 'no-store',
	'referrer-policy': 'no-referrer',
	'content-security-policy': "frame-ancestors 'none'",
	'x-frame-options': 'DENY',
};

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

/**
 * Insert `<script>window.__LOCAL_MAIL__=...</script>` right after `<head>` so
 * the global is defined before the SPA's deferred module scripts run. The bearer
 * is base64url and serialized with `JSON.stringify`, so it cannot break out of
 * the inline script string.
 */
function injectBearer(html: string, origin: string, bearer: string): string {
	const script = `<script>window.__LOCAL_MAIL__=${JSON.stringify({ origin, bearer })}</script>`;
	const marker = '<head>';
	const at = html.indexOf(marker);
	if (at === -1) return `${script}${html}`;
	const cut = at + marker.length;
	return html.slice(0, cut) + script + html.slice(cut);
}

/** Serve the SPA shell (`index.html`) with the bearer injected. Every path that
 * yields the shell (root, `/index.html`, and the deep-link fallback) routes here,
 * so no SPA entry boots without `window.__LOCAL_MAIL__`. */
async function serveIndex(
	uiDist: string,
	origin: string,
	bearer: string,
): Promise<Response> {
	const index = Bun.file(join(uiDist, 'index.html'));
	if (!(await index.exists())) {
		return new Response('Not found', { status: 404 });
	}
	const html = injectBearer(await index.text(), origin, bearer);
	return new Response(html, { headers: INJECTED_HTML_HEADERS });
}

/** Serve the built SPA from disk. Real asset files are served as-is; the shell
 * (root, `/index.html`, or a missing path that falls back to the SPA) is served
 * with the bearer injected. */
async function serveStatic(
	uiDist: string,
	pathname: string,
	origin: string,
	bearer: string,
): Promise<Response> {
	const rel = pathname === '/' ? '/index.html' : pathname;
	// Reject path traversal before touching the filesystem. `join` collapses
	// `..`, so match on a real separator boundary: a bare `startsWith(uiDist)`
	// would also accept a sibling like `<uiDist>-evil`.
	const target = join(uiDist, rel);
	if (target !== uiDist && !target.startsWith(uiDist + sep)) {
		return new Response('Forbidden', { status: 403 });
	}
	if (rel === '/index.html') return serveIndex(uiDist, origin, bearer);
	const file = Bun.file(target);
	if (await file.exists()) {
		return new Response(file, {
			headers: { 'referrer-policy': 'no-referrer' },
		});
	}
	// Deep-link fallback: an unknown path is a client-side route, so serve the
	// injected shell (not a bare index.html, which would boot without the bearer).
	return serveIndex(uiDist, origin, bearer);
}

export async function runApp(options: { port?: number }): Promise<number> {
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

	const lock = acquireSyncLock({
		dataDir: runtime.config.dataDir,
		accountEmail: runtime.accountEmail,
	});
	if (!lock) {
		console.error(
			`Another Local Mail sync owner is already active for ${runtime.accountEmail} (an app or a "local-mail sync"). Stop it first.`,
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

	const readOnly = runtime.config.readOnly;
	const bearer = mintBearer();
	const uiDist = join(import.meta.dir, '..', 'ui', 'dist');
	const gate = createSyncGate();
	const controller = new AbortController();

	const api = createApiApp({
		rt: runtime,
		syncDeps: session.deps,
		readOnly,
		gate,
		bearer,
	});

	const server = Bun.serve({
		hostname: '127.0.0.1',
		port: options.port ?? (Number(process.env.LOCAL_MAIL_PORT) || 0),
		fetch(req): Response | Promise<Response> {
			const url = new URL(req.url);

			// Host check first: the DNS-rebinding kill switch. Every request must
			// name this exact loopback origin (the Vite proxy rewrites Host to
			// match via changeOrigin, so dev passes too).
			const expectedHost = `127.0.0.1:${server.port}`;
			if (req.headers.get('host') !== expectedHost) {
				return new Response('Forbidden', { status: 403 });
			}

			if (url.pathname.startsWith('/api/')) return api.fetch(req);
			const origin = `http://127.0.0.1:${server.port}`;
			return serveStatic(uiDist, url.pathname, origin, bearer);
		},
	});

	// The background sync loop, serialized through the same gate as POST /api/sync.
	(async () => {
		while (!controller.signal.aborted) {
			await gate(() => syncMailbox(session.deps, { forceFull: false })).catch(
				(cause) => console.error(`[sync] loop pass failed: ${cause}`),
			);
			if (controller.signal.aborted) break;
			await Bun.sleep(SYNC_INTERVAL_MS);
		}
	})();

	const origin = `http://127.0.0.1:${server.port}`;
	// Publish presence so the Vite dev server (and, later, a routed one-shot
	// `sync`) can find this host's origin and bearer. Presence, not spawn.
	writePresence({ origin, bearer, pid: process.pid }, runtime.config.dataDir);
	// stdout carries only the origin, so a caller can capture it; the hint goes
	// to stderr. No browser is launched: opening the window is the host's job
	// (a terminal today, Tauri later), not the engine's.
	console.log(origin);
	console.error(
		`Local Mail runtime host listening on ${origin}. Open it in your browser.`,
	);
	if (!existsSync(uiDist)) {
		console.error(
			`Note: ${uiDist} does not exist yet. Build the SPA with "bun run --cwd apps/local-mail/ui build".`,
		);
	}

	await new Promise<void>((resolve) => {
		process.on('SIGINT', () => {
			controller.abort();
			server.stop();
			session.close();
			lock.release();
			clearPresence(runtime.config.dataDir);
			resolve();
		});
	});
	return 0;
}
