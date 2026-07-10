/**
 * Bun-owned routes on the one trusted Epicenter origin.
 *
 * Query owns its final SPA and API namespaces. The bootstrap route is host
 * infrastructure: Tauri exchanges the per-launch credential there before any
 * SPA reaches domain code.
 */

const stripTrailing = (value: string) => value.replace(/\/+$/, '');

function route(pattern: string) {
	return {
		pattern,
		url: (baseUrl: string) => `${stripTrailing(baseUrl)}${pattern}`,
	} as const;
}

export const BOOTSTRAP_ROUTE = route('/_epicenter/bootstrap');
export const QUERY_ROUTE = route('/apps/query/');
export const SESSION_ROUTE = route('/api/query/session');
export const SESSION_STREAM_ROUTE = route('/api/query/session/stream');
