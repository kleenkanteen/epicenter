import { loadConfig } from './config.ts';
import type { MailDb } from './db.ts';
import { openMailDb } from './db.ts';
import { createGmailClient } from './gmail-client.ts';
import { runMcpServer } from './mcp.ts';
import { runAuthorizationFlow } from './oauth.ts';
import { dbPath } from './paths.ts';
import { queryMail } from './query.ts';
import { runSyncLoop, type SyncOutcome, syncMailbox } from './sync.ts';
import { createTokenManager } from './token-manager.ts';
import { createFileTokenStore } from './token-store.ts';

export type ParsedArgs = {
	command: string;
	positionals: string[];
	full: boolean;
	watch: boolean;
	watchIntervalMs?: number;
	clientId?: string;
	help: boolean;
	version: boolean;
};

export const VERSION = '0.0.1';

const DEFAULT_WATCH_INTERVAL_MS = 30_000;

const HELP = `local-mail: keep a private local copy of Gmail for local tools and agents.

Usage:
  local-mail connect [--client-id <id>]
  local-mail seed-token <accountEmail> <refreshToken>
  local-mail sync [--full] [--watch[=intervalMs]]
  local-mail query "<sql>"
  local-mail mcp

Commands:
  connect      Connect a Gmail account once using browser OAuth.
  seed-token   Store an existing refresh token for headless bootstrap.
  sync         Refresh the local mirror. Use --watch to keep polling.
  query        Run a read-only SQL query over the local mirror.
  mcp          Serve query/status/sync tools to an agent over stdio.

Options:
  --client-id <id>      Override GMAIL_CLIENT_ID for connect.
  --full                Force a full pull on the first sync pass.
  --watch[=intervalMs]  Keep syncing on a loop. Default: 30000.
  -h, --help            Show this help.
  -v, --version         Show version.

Environment:
  GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET   Google OAuth desktop client keys.
  LOCAL_MAIL_ACCOUNT                      Account email to sync.
  LOCAL_MAIL_DIR                          Where the local copy lives.
  LOCAL_MAIL_TOKEN_FILE                   Override the credentials file path.
`;

export function parseArgs(argv: string[]): ParsedArgs {
	const args: ParsedArgs = {
		command: '',
		positionals: [],
		full: false,
		watch: false,
		help: false,
		version: false,
	};

	for (let i = 0; i < argv.length; i += 1) {
		const token = argv[i] as string;
		if (!token.startsWith('-')) {
			if (!args.command) args.command = token;
			else args.positionals.push(token);
			continue;
		}

		const eq = token.startsWith('--') ? token.indexOf('=') : -1;
		const name = eq === -1 ? token : token.slice(0, eq);
		const inlineValue = eq === -1 ? undefined : token.slice(eq + 1);
		const takeValue = (): string => {
			if (inlineValue !== undefined) return inlineValue;
			const next = argv[i + 1];
			if (next === undefined) throw new Error(`Option ${name} needs a value`);
			i += 1;
			return next;
		};

		switch (name) {
			case '--client-id':
				args.clientId = takeValue();
				break;
			case '--full':
				args.full = true;
				break;
			case '--watch':
				args.watch = true;
				if (inlineValue !== undefined) args.watchIntervalMs = Number(inlineValue);
				break;
			case '-h':
			case '--help':
				args.help = true;
				break;
			case '-v':
			case '--version':
				args.version = true;
				break;
			default:
				throw new Error(`Unknown option: ${name}`);
		}
	}

	return args;
}

async function runConnect(args: ParsedArgs): Promise<number> {
	const loaded = loadConfig();
	const config = args.clientId ? { ...loaded, clientId: args.clientId } : loaded;
	if (!config.clientId || !config.clientSecret) {
		console.error(
			'Missing Gmail OAuth credentials. Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET, or pass --client-id with GMAIL_CLIENT_SECRET set.',
		);
		return 1;
	}

	const { data: token, error } = await runAuthorizationFlow(config, {
		now: () => Date.now(),
		log: (message) => console.error(message),
	});
	if (error) {
		console.error(`Authentication failed: ${error.message}`);
		return 1;
	}

	const store = createFileTokenStore(config.credentialsPath);
	await store.set(token);
	console.log(`Connected ${token.accountEmail}.`);
	console.log(`Tokens stored in ${config.credentialsPath}.`);
	console.log(
		`Next: set LOCAL_MAIL_ACCOUNT=${token.accountEmail} and run "local-mail sync --full".`,
	);
	return 0;
}

async function runSeedToken(args: ParsedArgs): Promise<number> {
	const [accountEmail, refreshToken] = args.positionals;
	if (!accountEmail || !refreshToken) {
		console.error('Usage: local-mail seed-token <accountEmail> <refreshToken>');
		return 1;
	}
	const config = loadConfig();
	if (!config.clientId) {
		console.error('Missing GMAIL_CLIENT_ID.');
		return 1;
	}
	const store = createFileTokenStore(config.credentialsPath);
	await store.set({
		accountEmail,
		clientIdUsed: config.clientId,
		accessToken: 'seed-token-placeholder-forces-immediate-refresh',
		accessTokenExpiresAt: new Date(0).toISOString(),
		refreshToken,
		obtainedAt: new Date(0).toISOString(),
	});
	console.log(
		`Seeded a refresh token for ${accountEmail} at ${config.credentialsPath}`,
	);
	return 0;
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

async function runSync(args: ParsedArgs): Promise<number> {
	const config = loadConfig();
	const store = createFileTokenStore(config.credentialsPath);
	const accountEmail = config.account;
	if (!accountEmail) {
		console.error('Set LOCAL_MAIL_ACCOUNT to the account email from connect.');
		return 1;
	}
	const token = await store.get(accountEmail);
	if (!token) {
		console.error(`No token stored for ${accountEmail}. Run "local-mail connect" first.`);
		return 1;
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

	if (!args.watch) {
		const outcome = await syncMailbox(deps, { forceFull: args.full });
		printOutcome(db, outcome);
		const failed = outcome.failure !== null;
		db.close();
		return failed ? 1 : 0;
	}

	const intervalMs = args.watchIntervalMs ?? DEFAULT_WATCH_INTERVAL_MS;
	console.log(`Watching every ${intervalMs}ms. Ctrl-C to stop.`);
	const controller = new AbortController();
	process.on('SIGINT', () => controller.abort());
	await runSyncLoop(deps, {
		forceFull: args.full,
		intervalMs,
		signal: controller.signal,
		onPass: (outcome, pass) => {
			console.log(`\n=== pass ${pass} ===`);
			printOutcome(db, outcome);
		},
	});
	db.close();
	return 0;
}

async function runQuery(args: ParsedArgs): Promise<number> {
	const sql = args.positionals[0];
	if (!sql) {
		console.error('Usage: local-mail query "<sql>"');
		return 1;
	}
	const config = loadConfig();
	if (!config.account) {
		console.error('Set LOCAL_MAIL_ACCOUNT to the connected account email.');
		return 1;
	}
	const { data, error } = queryMail({
		dbPath: dbPath(config.dataDir, config.account),
		sql,
	});
	if (error) {
		console.error(error.message);
		return 1;
	}
	console.log(JSON.stringify(data.rows, null, 2));
	const note = data.truncated ? ' (capped; more rows matched)' : '';
	console.error(`${data.rowCount} row${data.rowCount === 1 ? '' : 's'}${note}`);
	return 0;
}

export async function runCli(argv: string[]): Promise<number> {
	const args = parseArgs(argv);

	if (args.version) {
		console.log(VERSION);
		return 0;
	}
	if (args.help || !args.command) {
		console.log(HELP);
		return args.help ? 0 : 1;
	}

	switch (args.command) {
		case 'connect':
			return runConnect(args);
		case 'seed-token':
			return runSeedToken(args);
		case 'sync':
			return runSync(args);
		case 'query':
			return runQuery(args);
		case 'mcp':
			return runMcpServer(args);
		default:
			console.error(`Unknown command: ${args.command}\n`);
			console.log(HELP);
			return 1;
	}
}
