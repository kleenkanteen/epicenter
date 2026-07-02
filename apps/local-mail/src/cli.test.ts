/**
 * Local Mail CLI Parser Tests
 *
 * Covers parse-time argument validation that protects command handlers from
 * ambiguous or unsafe flag values.
 *
 * Key behaviors:
 * - `--watch` accepts only positive millisecond values
 * - invalid watch intervals fail before the sync loop can start polling
 */

import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, runCli } from './cli.ts';
import { createFileTokenStore } from './token-store.ts';
import type { TokenSet } from './tokens.ts';

test('--watch rejects unit-suffixed intervals', () => {
	expect(() => parseArgs(['sync', '--watch=30s'])).toThrow(
		'Invalid --watch interval "30s"',
	);
});

test('--watch rejects zero milliseconds', () => {
	expect(() => parseArgs(['sync', '--watch=0'])).toThrow(
		'Invalid --watch interval "0"',
	);
});

test('--watch accepts a space-separated interval', () => {
	const args = parseArgs(['sync', '--watch', '5000']);
	expect(args.watch).toBe(true);
	expect(args.watchIntervalMs).toBe(5000);
	expect(args.positionals).toEqual([]);
});

test('--watch space form validates the value instead of swallowing it', () => {
	expect(() => parseArgs(['sync', '--watch', '30s'])).toThrow(
		'Invalid --watch interval "30s"',
	);
});

test('--watch followed by another flag stays flag-only', () => {
	const args = parseArgs(['sync', '--watch', '--full']);
	expect(args.watch).toBe(true);
	expect(args.full).toBe(true);
	expect(args.watchIntervalMs).toBeUndefined();
});

test('status resolves the sole stored account and prints JSON', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'local-mail-cli-test-'));
	const token: TokenSet = {
		accountEmail: 'you@example.com',
		clientIdUsed: 'client-id',
		accessToken: 'access-token',
		refreshToken: 'refresh-token',
		accessTokenExpiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
		obtainedAt: new Date(0).toISOString(),
	};
	await createFileTokenStore(join(dir, 'credentials.json')).set(token);
	const previousDir = process.env.LOCAL_MAIL_DIR;
	const previousAccount = process.env.LOCAL_MAIL_ACCOUNT;
	const previousTokenFile = process.env.LOCAL_MAIL_TOKEN_FILE;
	const logs: string[] = [];
	const originalLog = console.log;
	process.env.LOCAL_MAIL_DIR = dir;
	process.env.LOCAL_MAIL_ACCOUNT = '';
	process.env.LOCAL_MAIL_TOKEN_FILE = '';
	console.log = (message?: unknown) => {
		logs.push(String(message));
	};
	try {
		expect(await runCli(['status'])).toBe(0);
		expect(JSON.parse(logs[0] ?? '{}').accountEmail).toBe('you@example.com');
	} finally {
		console.log = originalLog;
		if (previousDir === undefined) delete process.env.LOCAL_MAIL_DIR;
		else process.env.LOCAL_MAIL_DIR = previousDir;
		if (previousAccount === undefined) delete process.env.LOCAL_MAIL_ACCOUNT;
		else process.env.LOCAL_MAIL_ACCOUNT = previousAccount;
		if (previousTokenFile === undefined)
			delete process.env.LOCAL_MAIL_TOKEN_FILE;
		else process.env.LOCAL_MAIL_TOKEN_FILE = previousTokenFile;
		rmSync(dir, { recursive: true, force: true });
	}
});
