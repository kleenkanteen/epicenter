/**
 * `get` validates disk bytes against `TokenSetSchema` and returns `null` on a
 * mismatch (token-store.ts). That's a trap for any writer that doesn't itself
 * respect the schema: `bin.ts`'s `seed-token` once wrote `accessToken: ''`,
 * which silently failed `TokenSetSchema`'s `minLength: 1` on the very next
 * `get`, so `sync` reported "no token stored" right after `seed-token` had
 * just written one. This test locks the round-trip, not just the schema.
 */

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileTokenStore } from './token-store.ts';
import type { TokenSet } from './tokens.ts';

function tempTokenFile() {
	const dir = mkdtempSync(join(tmpdir(), 'local-mail-token-store-test-'));
	return {
		path: join(dir, 'credentials.json'),
		cleanup: () => rmSync(dir, { recursive: true, force: true }),
	};
}

describe('seed-token bootstrap shape round-trips through the real store', () => {
	test("a pre-expired placeholder token (bin.ts seedToken's exact shape) survives set-then-get", async () => {
		const { path, cleanup } = tempTokenFile();
		const store = createFileTokenStore(path);
		const seeded: TokenSet = {
			accountEmail: 'you@example.com',
			clientIdUsed: 'test-client',
			accessToken: 'seed-token-placeholder-forces-immediate-refresh',
			accessTokenExpiresAt: new Date(0).toISOString(),
			refreshToken: 'a-real-refresh-token',
			obtainedAt: new Date(0).toISOString(),
		};

		await store.set(seeded);
		const read = await store.get('you@example.com');

		expect(read).not.toBeNull();
		expect(read?.refreshToken).toBe('a-real-refresh-token');
		cleanup();
	});

	test('an empty accessToken (the actual regression) fails TokenSetSchema and get() returns null', async () => {
		const { path, cleanup } = tempTokenFile();
		const store = createFileTokenStore(path);
		// Bypass the TokenSet type to prove the schema, not just TypeScript,
		// is what would have caught this.
		await store.set({
			accountEmail: 'you@example.com',
			clientIdUsed: 'test-client',
			accessToken: '',
			accessTokenExpiresAt: new Date(0).toISOString(),
			refreshToken: 'a-real-refresh-token',
			obtainedAt: new Date(0).toISOString(),
		} as TokenSet);

		expect(await store.get('you@example.com')).toBeNull();
		cleanup();
	});
});
