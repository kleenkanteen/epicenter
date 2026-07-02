import { describe, expect, test } from 'bun:test';
import { Principal } from '@epicenter/auth';
import { asPrincipalId } from '@epicenter/identity';
import { ROOM_ROUTE } from '@epicenter/sync';
import { Hono } from 'hono';
import { Ok } from 'wellcrafted/result';
import type { Env } from '../types.js';
import { mountRoomsApp } from './rooms.js';

/**
 * Regression: prove the real client/server URL contract.
 *
 * The client builds request URLs with `ROOM_ROUTE.url(...)` and the
 * server registers `ROOM_ROUTE.pattern`. This test wires both ends to the
 * same source of truth so a future change to the pattern or builder can't let
 * them drift apart. It also pins that dotted, composed child-doc guids survive
 * Hono route matching (Hono treats `.` as a literal, so a single `:roomId`
 * param captures the whole id).
 */
describe('rooms route pattern', () => {
	test('room url() round-trips through the route pattern for workspace and child-doc guids', async () => {
		const app = new Hono().get(ROOM_ROUTE.pattern, (c) =>
			c.json({
				ownerId: c.req.param('ownerId'),
				roomId: c.req.param('roomId'),
			}),
		);

		const ownerId = asPrincipalId('user-1');
		const guids = [
			// Hyphenated workspace root id.
			'epicenter-fuji',
			// Composed child-doc guid; dots separate structural segments.
			'epicenter-fuji.entries.k7x9m2p4q8.content',
		];

		for (const guid of guids) {
			const url = ROOM_ROUTE.url('https://x', ownerId, guid);
			const res = await app.request(url);

			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				ownerId: string;
				roomId: string;
			};
			expect(body.roomId).toBe(guid);
			expect(body.ownerId).toBe('user-1');
		}
	});

	test('temporary owner segment must match the authenticated principal', async () => {
		const app = new Hono<Env>();
		app.use('*', async (c, next) => {
			c.set('rooms', {
				get: () => {
					throw new Error('room lookup should not run on mismatch');
				},
				rejectUpgrade: async () => new Response(null, { status: 500 }),
			});
			await next();
		});
		mountRoomsApp(app, {
			resolvePrincipal: async () =>
				Ok(Principal.assert({ id: asPrincipalId('alice') })),
		});

		const res = await app.request(
			ROOM_ROUTE.url('https://x', asPrincipalId('bob'), 'room-1'),
		);

		expect(res.status).toBe(403);
		const body = (await res.json()) as { error: { name: string } };
		expect(body.error.name).toBe('OwnerMismatch');
	});
});
