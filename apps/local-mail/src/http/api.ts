import { randomBytes } from 'node:crypto';
import { sValidator } from '@hono/standard-validator';
import { type } from 'arktype';
import { Hono } from 'hono';
import type { MailDb } from '../db.ts';
import {
	resolveAndModifyMessageLabels,
	setMessagesTrashed,
} from '../modify.ts';
import type { LocalMailRuntime } from '../runtime.ts';
import { readMailStatus } from '../status.ts';
import { type SyncDeps, syncMailbox } from '../sync.ts';
import { ApiError } from './api-errors.ts';

/**
 * The `/api` surface of `local-mail app`, as a Hono app. It owns routing, the
 * bearer gate, and request validation; the loopback host primitive around it
 * (`Bun.serve` in `app.ts`) owns the Host-check kill switch and static SPA
 * serving: `/api/*` falls through to this Hono app, `/*` serves `ui/dist`.
 *
 * The app is built by a factory so its per-launch dependencies (the writer db,
 * the sync gate, the per-launch bearer) are injected rather than captured at
 * module load, while `export type ApiApp = ReturnType<typeof createApiApp>`
 * still hands the SPA a precise end-to-end typed `hc` client. Every handler
 * returns `c.json(...)`, so the client's response types are inferred from the
 * exact shapes the server returns: the wire contract cannot silently drift.
 *
 * Auth is one per-launch bearer, minted by the host and handed to the SPA out of
 * band (an injected `window.__LOCAL_MAIL__` global, never the URL). Every `/api`
 * request must present it; there is no bootstrap-token exchange endpoint.
 *
 * Label writes go through the same core the CLI and MCP use
 * (`resolveAndModifyMessageLabels`); the archive/read/label intents desugar into
 * one `/api/messages/modify` route, not per-intent routes. Trash is separate
 * because Gmail models trash/untrash as their own endpoints, not a label delta,
 * but it stays one route: `/api/messages/trash` carries the direction as a
 * `trashed` boolean, the same shape the core (`setMessagesTrashed`) already owns.
 */

/** The per-launch local API bearer: 256 bits of CSPRNG, base64url. Minted once
 * by the host, never a Gmail token, never carried in a URL. */
export function mintBearer(): string {
	return randomBytes(32).toString('base64url');
}

// Request schemas are arktype, the repo's HTTP-boundary validator (paired with
// `@hono/standard-validator`, as in `packages/server`). typebox stays for the
// Gmail wire shapes in `schema.ts`; these are two different boundaries.

/** `POST /api/messages/modify` body: ids plus the add/remove label sets the UI
 * desugars its archive/read/label intents into. */
const ModifyBody = type({
	ids: 'string[]',
	'addLabels?': 'string[]',
	'removeLabels?': 'string[]',
});

/** `POST /api/messages/trash` body: the ids and the direction. `trashed:true`
 * moves them to Trash, `false` restores them (the write behind Undo). The
 * direction is explicit, matching the core's `setMessagesTrashed({trashed})`. */
const TrashBody = type({ ids: 'string[]', trashed: 'boolean' });

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
	/** The per-launch local API bearer every `/api` request must present. The
	 * host mints it (`mintBearer`) and hands it to the SPA out of band (an
	 * injected `window.__LOCAL_MAIL__` global), never a Gmail token. */
	bearer: string;
};

export function createApiApp(deps: ApiDeps) {
	const { rt, syncDeps, readOnly, gate, bearer } = deps;
	const db: MailDb = syncDeps.db;

	const app = new Hono()
		// The bearer gate on every `/api` route: present the one per-launch bearer
		// or get 401. There is no unauthenticated route (the bootstrap exchange is
		// gone; the SPA already holds the bearer via the injected global).
		.use('/api/*', async (c, next) => {
			const header = c.req.header('authorization');
			const provided = header?.startsWith('Bearer ')
				? header.slice('Bearer '.length)
				: null;
			if (!provided || provided !== bearer) {
				const err = ApiError.Unauthorized();
				return c.json(err, err.error.status);
			}
			return next();
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
			if (!detail) {
				const err = ApiError.MessageNotFound();
				return c.json(err, err.error.status);
			}
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
			if (error) {
				const err = ApiError.ModifyFailed({ message: error.message });
				return c.json(err, err.error.status);
			}
			return c.json(data);
		})
		.post('/api/messages/trash', sValidator('json', TrashBody), async (c) => {
			const { ids, trashed } = c.req.valid('json');
			const { data, error } = await setMessagesTrashed({
				deps: syncDeps,
				ids,
				trashed,
				readOnly,
			});
			if (error) {
				const err = ApiError.ModifyFailed({ message: error.message });
				return c.json(err, err.error.status);
			}
			return c.json(data);
		})
		.notFound((c) => {
			const err = ApiError.NotFound();
			return c.json(err, err.error.status);
		});

	return app;
}

/** The typed shape of the `/api` app, for the SPA's `hc<ApiApp>` client. */
export type ApiApp = ReturnType<typeof createApiApp>;
