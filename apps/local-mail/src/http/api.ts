import { randomBytes } from 'node:crypto';
import { API_ROUTES } from '@epicenter/constants/api-routes';
import { sValidator } from '@hono/standard-validator';
import { type } from 'arktype';
import { Hono } from 'hono';
import type { MailDb } from '../db.ts';
import { resolveAndModifyMessageLabels } from '../modify.ts';
import type { LocalMailRuntime } from '../runtime.ts';
import { readMailStatus } from '../status.ts';
import { type SyncDeps, syncMailbox } from '../sync.ts';

/**
 * The `/api` surface of `local-mail app`, as a Hono app. It owns routing, the
 * bearer gate, and request validation; the loopback host primitive around it
 * (`Bun.serve` in `app.ts`) owns the Host-check kill switch and static SPA
 * serving: `/api/*` falls through to this Hono app, `/*` serves `ui/dist`.
 *
 * The app is built by a factory so its per-launch dependencies (the writer db,
 * the sync gate, the valid-bearer set) are injected rather than captured at
 * module load, while `export type ApiApp = ReturnType<typeof createApiApp>`
 * still hands the SPA a precise end-to-end typed `hc` client. Every handler
 * returns `c.json(...)`, so the client's response types are inferred from the
 * exact shapes the server returns: the wire contract cannot silently drift.
 *
 * Writes go through the same core the CLI and MCP use
 * (`resolveAndModifyMessageLabels`); there are no per-intent routes.
 */

/** Bound online guessing by another local user against the exchange endpoint. */
const MAX_FAILED_EXCHANGES = 25;

/** 256 bits of CSPRNG, base64url: well past the spec's 128-bit floor. */
export function mintToken(): string {
	return randomBytes(32).toString('base64url');
}

// Request schemas are arktype, the repo's HTTP-boundary validator (paired with
// `@hono/standard-validator`, as in `packages/server`). typebox stays for the
// Gmail wire shapes in `schema.ts`; these are two different boundaries.

/** `POST /api/session` body: the single-use bootstrap token being exchanged. */
const SessionBody = type({ token: 'string >= 1' });

/** `POST /api/messages/modify` body: ids plus the add/remove label sets the UI
 * desugars its archive/read/label intents into. */
const ModifyBody = type({
	ids: 'string[]',
	'addLabels?': 'string[]',
	'removeLabels?': 'string[]',
});

/** `GET /api/messages` query. Values arrive as strings; `limit`/`offset` are
 * parsed and clamped in the handler, matching the original bounds. */
const MessageQuery = type({
	'label?': 'string',
	'q?': 'string',
	'limit?': 'string',
	'offset?': 'string',
});

type ApiDeps = {
	rt: LocalMailRuntime;
	syncDeps: SyncDeps;
	readOnly: boolean;
	/** The one in-process serialize gate: the background loop and `POST /api/sync`
	 * both enqueue here, so at most one pass touches the mirror at a time. */
	gate: <T>(fn: () => Promise<T>) => Promise<T>;
	/** The valid-bearer set, owned by the launcher so dev can pre-seed the fixed
	 * proxy token. Prod fills it only through the bootstrap exchange below. */
	sessionBearers: Set<string>;
	/** The single-use bootstrap token, or `null` in dev (the Vite proxy carries
	 * the bearer, so no exchange runs). Consumed at first successful exchange. */
	bootstrapToken: string | null;
};

export function createApiApp(deps: ApiDeps) {
	const { rt, syncDeps, readOnly, gate, sessionBearers } = deps;
	const db: MailDb = syncDeps.db;

	// Per-launch auth state, mutated in place across requests.
	let bootstrapToken = deps.bootstrapToken;
	let failedExchanges = 0;

	const app = new Hono()
		// The bearer gate on every `/api` route except the one public exchange.
		// The skip is an explicit path check, not a registration-order trick, so
		// it stays correct wherever this middleware sits in the chain.
		.use('/api/*', async (c, next) => {
			if (
				c.req.path === API_ROUTES.session.pattern &&
				c.req.method === 'POST'
			) {
				return next();
			}
			const header = c.req.header('authorization');
			const bearer = header?.startsWith('Bearer ')
				? header.slice('Bearer '.length)
				: null;
			if (!bearer || !sessionBearers.has(bearer)) {
				return c.json({ error: 'Unauthorized. Restart local-mail app.' }, 401);
			}
			return next();
		})
		// The one unauthenticated mutation: exchange the bootstrap for a bearer.
		.post(API_ROUTES.session.pattern, sValidator('json', SessionBody), (c) => {
			if (bootstrapToken === null) {
				return c.json({ error: 'No bootstrap token is outstanding.' }, 401);
			}
			if (failedExchanges >= MAX_FAILED_EXCHANGES) {
				return c.json({ error: 'Too many exchange attempts.' }, 429);
			}
			const { token } = c.req.valid('json');
			if (token !== bootstrapToken) {
				failedExchanges += 1;
				return c.json({ error: 'Invalid bootstrap token.' }, 401);
			}
			const bearer = mintToken();
			sessionBearers.add(bearer);
			bootstrapToken = null; // single use: invalidate at exchange
			return c.json({ token: bearer });
		})
		.get('/api/status', async (c) => {
			const status = await readMailStatus(rt);
			return c.json({
				accountEmail: status.accountEmail,
				connected: status.connected,
				mirror: status.mirror,
				historyId: status.historyId,
				lastSyncedAt: status.lastSyncedAt,
				lastFullPullAt: status.lastFullPullAt,
				rows: status.rows,
				readOnly,
			});
		})
		.get('/api/labels', (c) => c.json({ labels: db.listLabels() }))
		.get('/api/messages', sValidator('query', MessageQuery), (c) => {
			const { label, q, limit, offset } = c.req.valid('query');
			return c.json({
				messages: db.listMessages({
					labelId: label,
					search: q?.trim() || undefined,
					limit: Math.min(Number(limit) || 100, 200),
					offset: Math.max(Number(offset) || 0, 0),
				}),
			});
		})
		// Hono already URL-decodes path params, so no manual decodeURIComponent.
		.get('/api/messages/:id', (c) => {
			const detail = db.getMessageDetail(c.req.param('id'));
			if (!detail) return c.json({ error: 'Message not found.' }, 404);
			return c.json(detail);
		})
		.post('/api/sync', async (c) => {
			const outcome = await gate(() =>
				syncMailbox(syncDeps, { forceFull: false }),
			);
			return c.json(outcome);
		})
		.post('/api/messages/modify', sValidator('json', ModifyBody), async (c) => {
			const { ids, addLabels, removeLabels } = c.req.valid('json');
			const { data, error } = await resolveAndModifyMessageLabels({
				deps: syncDeps,
				ids,
				addLabels: addLabels ?? [],
				removeLabels: removeLabels ?? [],
				readOnly,
			});
			if (error) return c.json({ error: error.message }, 400);
			return c.json(data);
		})
		.notFound((c) => c.json({ error: 'Not found.' }, 404));

	return app;
}

/** The typed shape of the `/api` app, for the SPA's `hc<ApiApp>` client. */
export type ApiApp = ReturnType<typeof createApiApp>;
