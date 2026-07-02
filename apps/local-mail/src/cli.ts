import { loadConfig } from './config.ts';
import type { MailDb } from './db.ts';
import { runMcpServer } from './mcp.ts';
import { redeemRefreshToken, runAuthorizationFlow } from './oauth.ts';
import { queryMail } from './query.ts';
import { openLocalMailRuntime, openSyncSession } from './runtime.ts';
import { readMailStatus } from './status.ts';
import { runSyncLoop, type SyncOutcome, syncMailbox } from './sync.ts';
import { createFileTokenStore } from './token-store.ts';
import { VERSION } from './version.ts';

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

const DEFAULT_WATCH_INTERVAL_MS = 30_000;

const HELP = `local-mail: keep a private local copy of Gmail for local tools and agents.

Usage:
  local-mail connect [--client-id <id>]
  local-mail seed-token <refreshToken>
  local-mail sync [--full] [--watch [intervalMs]]
  local-mail status
  local-mail query "<sql>"
  local-mail mcp

Commands:
  connect      Connect a Gmail account once using browser OAuth.
  seed-token   Redeem an existing refresh token for headless bootstrap.
               Verifies it against Google; the account email comes from
               the Gmail profile.
  sync         Refresh the local mirror. Use --watch to keep polling.
  status       Show connection state, cursor, and row counts.
  query        Run a read-only SQL query over the local mirror.
  mcp          Serve query/status/sync tools to an agent over stdio.

Options:
  --client-id <id>      Override GMAIL_CLIENT_ID for connect.
  --full                Force a full pull on the first sync pass.
  --watch [intervalMs]  Keep syncing on a loop. Default: 30000.
  -h, --help            Show this help.
  -v, --version         Show version.

Environment:
  GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET   Google OAuth desktop client keys.
  LOCAL_MAIL_ACCOUNT                      Account override when multiple are connected.
  LOCAL_MAIL_DIR                          Where the local copy lives.
  LOCAL_MAIL_TOKEN_FILE                   Override the credentials file path.
`;

function parseWatchInterval(input: string): number {
	const value = Number(input.trim());
	if (!Number.isFinite(value) || value <= 0) {
		throw new Error(
			`Invalid --watch interval "${input}". Use a positive number of milliseconds.`,
		);
	}
	return value;
}

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
			case '--watch': {
				args.watch = true;
				// Accept both --watch=5000 and --watch 5000; the space form was
				// previously swallowed into positionals and silently ignored.
				const next = argv[i + 1];
				if (inlineValue !== undefined) {
					args.watchIntervalMs = parseWatchInterval(inlineValue);
				} else if (next !== undefined && !next.startsWith('-')) {
					i += 1;
					args.watchIntervalMs = parseWatchInterval(next);
				}
				break;
			}
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
	const config = args.clientId
		? { ...loaded, clientId: args.clientId }
		: loaded;

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
	console.log(`Next: run "local-mail sync --full".`);
	return 0;
}

async function runSeedToken(args: ParsedArgs): Promise<number> {
	const [refreshToken] = args.positionals;
	if (!refreshToken || args.positionals.length > 1) {
		console.error(
			'Usage: local-mail seed-token <refreshToken>\nThe account email is read from the Gmail profile, not typed.',
		);
		return 1;
	}
	const config = loadConfig();
	const { data: token, error } = await redeemRefreshToken(
		config,
		refreshToken,
		() => Date.now(),
	);
	if (error) {
		console.error(`Could not redeem the refresh token: ${error.message}`);
		return 1;
	}
	const store = createFileTokenStore(config.credentialsPath);
	await store.set(token);
	console.log(`Seeded ${token.accountEmail} at ${config.credentialsPath}.`);
	console.log(`Next: run "local-mail sync --full".`);
	return 0;
}

function printOutcome(db: MailDb, outcome: SyncOutcome): void {
	console.log(JSON.stringify(outcome, null, 2));
	if (outcome.failure) return;

	const { messages } = db.counts();
	console.log(`\n${messages} live messages mirrored. Most recent:`);
	for (const row of db.recentMessages(5)) {
		console.log(
			`  ${row.sender ?? '(unknown)'}: ${row.subject ?? '(no subject)'}`,
		);
	}
}

async function runSync(args: ParsedArgs): Promise<number> {
	if (args.positionals.length > 0) {
		console.error(
			`sync takes no positional arguments (got: ${args.positionals.join(' ')}).`,
		);
		return 1;
	}
	const { data: runtime, error: runtimeError } = await openLocalMailRuntime();
	if (runtimeError) {
		console.error(runtimeError.message);
		return 1;
	}
	const { data: session, error: sessionError } = await openSyncSession(
		runtime,
		{
			gmailLog: (m) => console.log(`[gmail] ${m}`),
			syncLog: (m) => console.log(`[sync] ${m}`),
		},
	);
	if (sessionError) {
		console.error(sessionError.message);
		return 1;
	}

	if (!args.watch) {
		const outcome = await syncMailbox(session.deps, { forceFull: args.full });
		printOutcome(session.db, outcome);
		const failed = outcome.failure !== null;
		session.close();
		return failed ? 1 : 0;
	}

	const intervalMs = args.watchIntervalMs ?? DEFAULT_WATCH_INTERVAL_MS;
	console.log(`Watching every ${intervalMs}ms. Ctrl-C to stop.`);
	const controller = new AbortController();
	process.on('SIGINT', () => controller.abort());
	// The exit code reflects the LAST pass, so a supervisor restarting on
	// nonzero sees current health, not a transient failure hours ago.
	let lastPassFailed = false;
	await runSyncLoop(session.deps, {
		forceFull: args.full,
		intervalMs,
		signal: controller.signal,
		onPass: (outcome, pass) => {
			lastPassFailed = outcome.failure !== null;
			console.log(`\n=== pass ${pass} ===`);
			printOutcome(session.db, outcome);
		},
	});
	session.close();
	return lastPassFailed ? 1 : 0;
}

async function runQuery(args: ParsedArgs): Promise<number> {
	const sql = args.positionals[0];
	if (!sql) {
		console.error('Usage: local-mail query "<sql>"');
		return 1;
	}
	const { data: runtime, error: runtimeError } = await openLocalMailRuntime();
	if (runtimeError) {
		console.error(runtimeError.message);
		return 1;
	}
	const { data, error } = queryMail({
		dataDir: runtime.config.dataDir,
		accountEmail: runtime.accountEmail,
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

async function runStatus(): Promise<number> {
	const { data: runtime, error } = await openLocalMailRuntime();
	if (error) {
		console.error(error.message);
		return 1;
	}
	console.log(JSON.stringify(await readMailStatus(runtime), null, 2));
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
		case 'status':
			return runStatus();
		case 'query':
			return runQuery(args);
		case 'mcp':
			return runMcpServer();
		default:
			console.error(`Unknown command: ${args.command}\n`);
			console.log(HELP);
			return 1;
	}
}
