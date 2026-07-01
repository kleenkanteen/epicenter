import { loadConfig } from './config.ts';
import type { MailDb } from './db.ts';
import { openMailDb } from './db.ts';
import { createGmailClient } from './gmail-client.ts';
import { dbPath } from './paths.ts';
import { runSyncLoop, type SyncOutcome, syncMailbox } from './sync.ts';
import { createTokenManager } from './token-manager.ts';
import { createFileTokenStore } from './token-store.ts';

/**
 * Manual Phase 1 verification entry point: no interactive OAuth flow yet
 * (that's Phase 2's connect flow), so `seed-token` bootstraps a refresh token
 * obtained out of band (Phase 0's probe script, or Google's OAuth Playground)
 * and `sync` runs one pass (or `--watch`es on a loop) against it. Deliberately
 * not a real CLI framework (yargs, the way `apps/local-books` uses it): two
 * subcommands do not earn one.
 */

const DEFAULT_WATCH_INTERVAL_MS = 30_000;

function usage(): never {
	console.error(
		[
			'Usage:',
			'  bun run src/bin.ts seed-token <accountEmail> <refreshToken>',
			'  bun run src/bin.ts sync [--full] [--watch[=intervalMs]]',
		].join('\n'),
	);
	process.exit(1);
}

async function seedToken(
	accountEmail: string,
	refreshToken: string,
): Promise<void> {
	const config = loadConfig();
	if (!config.clientId) usage();
	const store = createFileTokenStore(config.credentialsPath);
	await store.set({
		accountEmail,
		clientIdUsed: config.clientId,
		// A non-empty placeholder, never sent to Gmail: TokenSetSchema requires
		// accessToken to be non-empty (a real one always is), and this value is
		// pre-expired so the first getValidAccessToken() call refreshes it before
		// anything reads it, proving the refresh token actually works.
		accessToken: 'seed-token-placeholder-forces-immediate-refresh',
		accessTokenExpiresAt: new Date(0).toISOString(),
		refreshToken,
		obtainedAt: new Date(0).toISOString(),
	});
	console.log(
		`Seeded a refresh token for ${accountEmail} at ${config.credentialsPath}`,
	);
}

function printOutcome(db: MailDb, outcome: SyncOutcome): void {
	console.log(JSON.stringify(outcome, null, 2));
	if (outcome.failure) return;

	const counts = db.raw
		.query<{ n: number }, []>(
			`SELECT count(*) AS n FROM messages WHERE deleted = 0`,
		)
		.get();
	const sample = db.raw
		.query<{ subject: string | null; sender: string | null }, []>(
			`SELECT subject, sender FROM messages WHERE deleted = 0 ORDER BY internal_date DESC LIMIT 5`,
		)
		.all();
	console.log(`\n${counts?.n ?? 0} live messages mirrored. Most recent:`);
	for (const row of sample) {
		console.log(
			`  ${row.sender ?? '(unknown)'}: ${row.subject ?? '(no subject)'}`,
		);
	}
}

async function sync(
	forceFull: boolean,
	watchIntervalMs: number | null,
): Promise<void> {
	const config = loadConfig();
	const store = createFileTokenStore(config.credentialsPath);
	const accountEmail = config.account;
	if (!accountEmail) {
		console.error(
			'Set LOCAL_MAIL_ACCOUNT to the account email seeded via `seed-token`.',
		);
		process.exit(1);
	}
	const token = await store.get(accountEmail);
	if (!token) {
		console.error(
			`No token stored for ${accountEmail}. Run \`seed-token\` first.`,
		);
		process.exit(1);
	}

	const tokens = createTokenManager({ config, store, token, now: Date.now });
	const client = createGmailClient({
		tokens,
		config,
		log: (m) => console.log(`[gmail] ${m}`),
	});
	const db = openMailDb(dbPath(config.dataDir, accountEmail));
	const deps = {
		db,
		client,
		config,
		now: Date.now,
		log: (m: string) => console.log(`[sync] ${m}`),
	};

	if (watchIntervalMs === null) {
		const outcome = await syncMailbox(deps, { forceFull });
		printOutcome(db, outcome);
		const failed = outcome.failure !== null;
		db.close();
		if (failed) process.exit(1);
		return;
	}

	// --watch: the live-app-shaped path (ADR-0082's "always-on while the app
	// runs" polling), also the only way to exercise gmail-client.ts's retry
	// and backoff paths against a real mailbox over time rather than in theory.
	console.log(`Watching every ${watchIntervalMs}ms. Ctrl-C to stop.`);
	const controller = new AbortController();
	process.on('SIGINT', () => controller.abort());
	await runSyncLoop(deps, {
		forceFull,
		intervalMs: watchIntervalMs,
		signal: controller.signal,
		onPass: (outcome, pass) => {
			console.log(`\n=== pass ${pass} ===`);
			printOutcome(db, outcome);
		},
	});
	db.close();
}

const [, , command, ...rest] = process.argv;
switch (command) {
	case 'seed-token': {
		const [accountEmail, refreshToken] = rest;
		if (!accountEmail || !refreshToken) usage();
		await seedToken(accountEmail, refreshToken);
		break;
	}
	case 'sync': {
		const watchArg = rest.find(
			(a) => a === '--watch' || a.startsWith('--watch='),
		);
		const watchIntervalMs = watchArg
			? Number(watchArg.split('=')[1] ?? DEFAULT_WATCH_INTERVAL_MS)
			: null;
		await sync(rest.includes('--full'), watchIntervalMs);
		break;
	}
	default:
		usage();
}
