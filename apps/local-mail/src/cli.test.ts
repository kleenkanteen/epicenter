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
import { loadConfig } from './config.ts';
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

test('modify parses intent flags and repeatable label changes', () => {
	const args = parseArgs([
		'modify',
		'm1',
		'm2',
		'--read',
		'--archive',
		'--add',
		'Work',
		'--add=Label_2',
		'--remove',
		'Travel',
	]);
	expect(args.command).toBe('modify');
	expect(args.positionals).toEqual(['m1', 'm2']);
	expect(args.read).toBe(true);
	expect(args.archive).toBe(true);
	expect(args.addLabels).toEqual(['Work', 'Label_2']);
	expect(args.removeLabels).toEqual(['Travel']);
});

test('LOCAL_MAIL_READ_ONLY enables read-only config mode', () => {
	const previous = process.env.LOCAL_MAIL_READ_ONLY;
	process.env.LOCAL_MAIL_READ_ONLY = '1';
	try {
		expect(loadConfig().readOnly).toBe(true);
	} finally {
		if (previous === undefined) delete process.env.LOCAL_MAIL_READ_ONLY;
		else process.env.LOCAL_MAIL_READ_ONLY = previous;
	}
});

test('modify honors LOCAL_MAIL_READ_ONLY before resolving labels', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'local-mail-cli-readonly-test-'));
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
	const previousReadOnly = process.env.LOCAL_MAIL_READ_ONLY;
	const errors: string[] = [];
	const originalError = console.error;
	process.env.LOCAL_MAIL_DIR = dir;
	process.env.LOCAL_MAIL_ACCOUNT = '';
	process.env.LOCAL_MAIL_TOKEN_FILE = '';
	process.env.LOCAL_MAIL_READ_ONLY = '1';
	console.error = (message?: unknown) => {
		errors.push(String(message));
	};
	try {
		expect(await runCli(['modify', 'm1', '--add', 'Missing Label'])).toBe(1);
		expect(errors.join('\n')).toContain('Refusing to write: read-only mode');
		expect(errors.join('\n')).not.toContain('Unknown Gmail label');
	} finally {
		console.error = originalError;
		if (previousDir === undefined) delete process.env.LOCAL_MAIL_DIR;
		else process.env.LOCAL_MAIL_DIR = previousDir;
		if (previousAccount === undefined) delete process.env.LOCAL_MAIL_ACCOUNT;
		else process.env.LOCAL_MAIL_ACCOUNT = previousAccount;
		if (previousTokenFile === undefined)
			delete process.env.LOCAL_MAIL_TOKEN_FILE;
		else process.env.LOCAL_MAIL_TOKEN_FILE = previousTokenFile;
		if (previousReadOnly === undefined) delete process.env.LOCAL_MAIL_READ_ONLY;
		else process.env.LOCAL_MAIL_READ_ONLY = previousReadOnly;
		rmSync(dir, { recursive: true, force: true });
	}
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
