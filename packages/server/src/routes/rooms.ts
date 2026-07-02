/**
 * Rooms sub-app: one room per named Y.Doc, resolved through the injected
 * `Rooms` registry (a Cloudflare Durable Object in the cloud, an in-process
 * `bun:sqlite` room on a Bun host). The route is backend-blind.
 *
 * URL shape: `/api/rooms/:roomId`. The deployment mounts auth upstream, and
 * `c.var.principal.id` is the partition key by definition.
 *
 * The Durable Object name is the principal-partitioned identifier produced by
 * {@link doName}; nothing here interpolates strings inline. The DO itself
 * is principal-blind: every connection is identified by the
 * `(principalId, nodeId)` pair stamped onto its WebSocket attachment.
 *
 * The route reads neither `c.var.db` nor `c.var.afterResponseQueue`: it records
 * no telemetry, so it composes no Postgres dependency on any deployment.
 */

import { RequestGuardError } from '@epicenter/constants/request-guard-errors';
import { ROOM_ROUTE } from '@epicenter/sync';
import { Hono, type MiddlewareHandler } from 'hono';
import { createMiddleware } from 'hono/factory';
import { describeRoute } from 'hono-openapi';
import { createOAuthUnauthorizedResourceResponse } from '../auth/oauth-resource.js';
import { isWebSocketUpgrade } from '../is-websocket-upgrade.js';
import { normalizeWebSocketAuth } from '../middleware/websocket-auth.js';
import { doName } from '../principal.js';
import type { Env, ResolvePrincipal } from '../types.js';

/**
 * Build the rooms sub-app. Rooms are WebSocket-only: the authenticated upgrade
 * is the single way to reach a room. The former one-shot HTTP surface (GET
 * snapshot, POST sync RPC) was deleted with its last consumer; a plain GET
 * answers `426 Upgrade Required` so a stray non-upgrade request gets a readable
 * refusal instead of doc bytes.
 */
function createRoomsApp(): Hono<Env> {
	return new Hono<Env>().get(
		ROOM_ROUTE.pattern,
		describeRoute({
			description: 'Upgrade to the room WebSocket',
			tags: ['rooms'],
		}),
		(c) => {
			if (!isWebSocketUpgrade(c)) {
				return new Response('Rooms are WebSocket-only', { status: 426 });
			}

			// Validate nodeId presence at the route boundary so the backend
			// can trust it is set. nodeId is the participant identity the
			// relay reports in presence; a missing one would produce a
			// presence-ghost connection.
			const nodeId = c.req.query('nodeId');
			if (!nodeId) {
				const err = RequestGuardError.MissingNodeId();
				return c.json(err, err.error.status);
			}

			const roomId = c.req.param('roomId');
			const principalId = c.var.principal.id;
			const room = c.var.rooms.get(doName(principalId, roomId));

			// Identity goes to the backend as data, not stamped into a
			// reconstructed request URL: principalId from auth (authoritative,
			// never the client's), nodeId the client's own. The backend
			// performs its runtime-specific accept (see ResolvedRoom).
			return room.handleUpgrade({
				request: c.req.raw,
				principalId,
				nodeId,
			});
		},
	);
}

/**
 * Bearer auth for the rooms surface, the only WebSocket surface.
 *
 * Same bearer-only resolution as `requireBearerPrincipal`, but a failed WebSocket
 * upgrade is rejected through the runtime's {@link Rooms.rejectUpgrade}: the
 * socket is accepted and immediately closed with `4000 + status` (401 -> 4401
 * permanent, 503 -> 4503 retryable), so the browser receives a close code it
 * can read. A plain HTTP error on an upgrade surfaces only as an opaque failed
 * handshake, which the client cannot tell from a network blip. A failed
 * non-upgrade rooms request still answers with the shared HTTP helper. The
 * serialized error is the close reason; the client branches on `error.name`.
 */
function requireRoomBearer<E extends Env>(
	resolvePrincipal: ResolvePrincipal<E>,
): MiddlewareHandler<E> {
	return createMiddleware<E>(async (c, next) => {
		const { data: principal, error } = await resolvePrincipal(c);
		if (error) {
			if (isWebSocketUpgrade(c)) {
				return c.var.rooms.rejectUpgrade({
					request: c.req.raw,
					code: 4000 + error.status,
					reason: JSON.stringify(error),
				});
			}
			return createOAuthUnauthorizedResourceResponse(c, error);
		}
		c.set('principal', principal);
		await next();
	});
}

/**
 * Mount the rooms surface on a deployment's server app.
 *
 * Bundles the full request pipeline for the only WebSocket surface:
 * transport normalization, auth, and the route mount, in one
 * call. Deployments call this once; they do not assemble the chain manually.
 *
 * Rooms is the one surface that resolves the bearer itself rather than taking a
 * prebuilt `auth` wrapper, because a failed WebSocket upgrade must close with a
 * readable code rather than answer a plain HTTP error. So it closes its own
 * WS-aware wrapper over the deployment's {@link ResolvePrincipal} (the cloud's OAuth
 * resolver, an instance's env-token resolver).
 *
 * Order matters. {@link normalizeWebSocketAuth} runs first so that on a
 * browser upgrade the ambient session cookie is dropped and the
 * `bearer.<token>` subprotocol is lifted into `Authorization` before
 * {@link requireRoomBearer} (bearer-only: rooms is for external clients,
 * never cookie-bearing browsers) reads it.
 */
export function mountRoomsApp<E extends Env = Env>(
	app: Hono<E>,
	opts: { resolvePrincipal: ResolvePrincipal<E> },
): void {
	app.use(
		ROOM_ROUTE.prefixPattern,
		normalizeWebSocketAuth,
		requireRoomBearer(opts.resolvePrincipal),
	);
	app.route('/', createRoomsApp());
}
