/**
 * Blob route boundary tests.
 *
 * Wave 2 keeps the old `/api/owners/:ownerId/blobs` URL shape while the server
 * partition source moves to `c.var.principal.id`. These tests pin the temporary
 * mismatch guard until Wave 3 removes the owner segment from the wire.
 */

import { expect, test } from 'bun:test';
import { API_ROUTES } from '@epicenter/constants/api-routes';
import { asPrincipalId } from '@epicenter/identity';
import { Hono } from 'hono';
import type { Env } from '../types.js';
import { mountBlobsApp } from './blobs.js';

function createTestApp() {
	const app = new Hono<Env>();
	mountBlobsApp(app, {
		auth: async (c, next) => {
			c.set('principal', { id: asPrincipalId('alice') });
			await next();
		},
	});
	return app;
}

test('temporary owner segment must match the authenticated principal', async () => {
	const res = await createTestApp().request(
		API_ROUTES.blobs.list.url('https://x', asPrincipalId('bob')),
		{},
		{
			BLOBS_S3_ENDPOINT: 'https://s3.test',
			BLOBS_S3_ACCESS_KEY_ID: 'key',
			BLOBS_S3_SECRET_ACCESS_KEY: 'secret',
		},
	);

	expect(res.status).toBe(403);
	const body = (await res.json()) as { error: { name: string } };
	expect(body.error.name).toBe('OwnerMismatch');
});
