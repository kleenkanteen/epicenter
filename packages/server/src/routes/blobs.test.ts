/**
 * Blob route boundary tests.
 *
 * Wave 3 removes the identity URL segment. Auth supplies the principal; the route
 * URL carries only the blob surface and optional sha256.
 */

import { expect, test } from 'bun:test';
import { API_ROUTES } from '@epicenter/constants/api-routes';
import { Hono } from 'hono';

test('list route uses the principal from auth without a principal URL segment', async () => {
	const app = new Hono().get(
		API_ROUTES.blobs.list.pattern,
		(c) =>
			new Response(JSON.stringify({ path: c.req.path }), {
				headers: { 'content-type': 'application/json' },
			}),
	);
	const url = API_ROUTES.blobs.list.url('https://x');
	const res = await app.request(url);

	expect(res.status).toBe(200);
	expect(new URL(url).pathname).toBe('/api/blobs');
	const body = (await res.json()) as unknown;
	expect(body).toEqual({ path: '/api/blobs' });
});
