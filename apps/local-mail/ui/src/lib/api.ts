import type {
	MailboxStatus,
	MailLabel,
	MessageDetail,
	MessageSummary,
	ModifyMessageLabelsOutcome,
	SyncOutcome,
} from './types';

// The same-origin `/api` client. The bearer lives in sessionStorage: it
// survives F5 within the tab, dies with the tab, and is unreadable by any
// sandboxed mail-body frame. In production the SPA earns the bearer once by
// exchanging the single-use bootstrap token carried in the URL fragment; in dev
// the Vite proxy injects a fixed bearer, so no exchange runs and no credential
// touches the browser.

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	await ensureSession();
	const headers = new Headers(init?.headers);
	headers.set('content-type', 'application/json');
	const bearer = readBearer();
	if (bearer) headers.set('authorization', `Bearer ${bearer}`);
	const res = await fetch(path, { ...init, headers });
	if (!res.ok) {
		const body = (await res.json().catch(() => null)) as {
			error?: string;
		} | null;
		throw new Error(body?.error ?? `Request failed (${res.status}).`);
	}
	return res.json() as Promise<T>;
}

export type MessageQuery = {
	label?: string;
	search?: string;
	limit?: number;
	offset?: number;
};

export const api = {
	status: () => request<MailboxStatus>('/api/status'),
	labels: () => request<{ labels: MailLabel[] }>('/api/labels'),
	messages: (query: MessageQuery = {}) => {
		const params = new URLSearchParams();
		if (query.label) params.set('label', query.label);
		if (query.search) params.set('q', query.search);
		if (query.limit) params.set('limit', String(query.limit));
		if (query.offset) params.set('offset', String(query.offset));
		const qs = params.toString();
		return request<{ messages: MessageSummary[] }>(
			`/api/messages${qs ? `?${qs}` : ''}`,
		);
	},
	message: (id: string) =>
		request<MessageDetail>(`/api/messages/${encodeURIComponent(id)}`),
	sync: () => request<SyncOutcome>('/api/sync', { method: 'POST' }),
	modify: (input: {
		ids: string[];
		addLabels?: string[];
		removeLabels?: string[];
	}) =>
		request<ModifyMessageLabelsOutcome>('/api/messages/modify', {
			method: 'POST',
			body: JSON.stringify(input),
		}),
};
