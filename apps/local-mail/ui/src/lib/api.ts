import type { ApiApp } from '@epicenter/local-mail/http/api';
import { hc } from 'hono/client';

// The same-origin `/api` client, typed end to end by `hc<ApiApp>`: its request
// and response shapes are inferred from the Hono routes in
// `apps/local-mail/src/http/api.ts`, so the wire contract cannot drift from the
// server. The bearer lives in sessionStorage: it survives F5 within the tab,
// dies with the tab, and is unreadable by any sandboxed mail-body frame. In
// production the SPA earns the bearer once by exchanging the single-use
// bootstrap token carried in the URL fragment; in dev the Vite proxy injects a
// fixed bearer, so no exchange runs and no credential touches the browser.

const BEARER_KEY = 'local-mail:session-bearer';

function readBearer(): string | null {
	if (typeof sessionStorage === 'undefined') return null;
	return sessionStorage.getItem(BEARER_KEY);
}

/**
 * Read the bootstrap token from `location.hash`, strip it immediately so it
 * never lingers in history, and exchange it for the per-launch session bearer.
 * No fragment (dev, or a reload after the exchange) is not an error: dev is
 * proxy-authenticated and a reload already has the stored bearer.
 */
async function bootstrap(): Promise<void> {
	if (typeof window === 'undefined' || readBearer()) return;
	const match = window.location.hash.match(/token=([^&]+)/);
	if (!match) return;
	const bootstrapToken = decodeURIComponent(match[1] as string);
	window.history.replaceState(
		null,
		'',
		window.location.pathname + window.location.search,
	);
	const res = await fetch('/api/session', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ token: bootstrapToken }),
	});
	if (!res.ok) return;
	const body = (await res.json()) as { token?: string };
	if (body.token) sessionStorage.setItem(BEARER_KEY, body.token);
}

let sessionReady: Promise<void> | null = null;
function ensureSession(): Promise<void> {
	sessionReady ??= bootstrap();
	return sessionReady;
}

// Every hc request routes through this: ensure the session exists, then attach
// the per-launch bearer. The bootstrap exchange above uses a raw fetch, so it
// never re-enters here. Typed with an explicit signature rather than `typeof
// fetch` so it does not have to restate Bun's `fetch.preconnect`.
const authedFetch = async (
	input: RequestInfo | URL,
	init?: RequestInit,
): Promise<Response> => {
	await ensureSession();
	const headers = new Headers(init?.headers);
	const bearer = readBearer();
	if (bearer) headers.set('authorization', `Bearer ${bearer}`);
	return fetch(input, { ...init, headers });
};

// Same-origin: hc needs an absolute base for URL construction, and this module
// only ever executes in the browser (the SPA is `ssr: false`, `prerender:
// false`). The localhost fallback keeps a stray import from throwing at load.
const base =
	typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
const client = hc<ApiApp>(base, { fetch: authedFetch });

/** The typed client, exported so `types.ts` derives the wire shapes from it. */
export type ApiClient = typeof client;

async function toError(res: Response): Promise<Error> {
	const body = (await res.json().catch(() => null)) as {
		error?: string;
	} | null;
	return new Error(body?.error ?? `Request failed (${res.status}).`);
}

export type MessageQuery = {
	label?: string;
	search?: string;
	limit?: number;
	offset?: number;
};

export const api = {
	status: async () => {
		const res = await client.api.status.$get();
		if (!res.ok) throw await toError(res);
		return res.json();
	},
	labels: async () => {
		const res = await client.api.labels.$get();
		if (!res.ok) throw await toError(res);
		return res.json();
	},
	messages: async (query: MessageQuery = {}) => {
		const res = await client.api.messages.$get({
			query: {
				...(query.label ? { label: query.label } : {}),
				...(query.search ? { q: query.search } : {}),
				...(query.limit != null ? { limit: String(query.limit) } : {}),
				...(query.offset != null ? { offset: String(query.offset) } : {}),
			},
		});
		if (!res.ok) throw await toError(res);
		return res.json();
	},
	message: async (id: string) => {
		const res = await client.api.messages[':id'].$get({ param: { id } });
		if (!res.ok) throw await toError(res);
		return res.json();
	},
	sync: async () => {
		const res = await client.api.sync.$post();
		if (!res.ok) throw await toError(res);
		return res.json();
	},
	modify: async (input: {
		ids: string[];
		addLabels?: string[];
		removeLabels?: string[];
	}) => {
		const res = await client.api.messages.modify.$post({ json: input });
		if (!res.ok) throw await toError(res);
		return res.json();
	},
};
