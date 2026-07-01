import { credentialsFilePath, resolveDataDir } from './paths.ts';

/**
 * Fully-resolved runtime configuration. Precedence is env > built-in defaults;
 * there is no `config.json` yet (local-books' file-config layer is not ported
 * until Phase 2's connect flow needs per-mode `clientId` selection). Base-URL
 * fields are overridable so tests can point the client at a mock Gmail server.
 *
 * Unlike `apps/local-books`' `AppConfig.entities` (a configurable QuickBooks
 * entity list), Gmail's entity set is fixed: messages, threads, labels. There
 * is nothing to narrow, so no `entities` field exists here.
 */
export type AppConfig = {
	dataDir: string;
	clientId: string | null;
	clientSecret: string | null;
	/** Gmail REST API origin. */
	apiBase: string;
	/** Google OAuth2 token endpoint (refresh-token exchange). */
	tokenUrl: string;
	/**
	 * Force a FULL pull once the time since the last successful sync exceeds
	 * this many days. Gmail's `historyId` retention is "at least a week, often
	 * longer" (not a fixed number like QuickBooks' 30-day CDC window), so this
	 * measures wall-clock staleness of our own last poll rather than trying to
	 * parse an age out of the opaque `historyId` cursor itself.
	 */
	historySafeWindowDays: number;
	/** Force a FULL pull this many days after the last one, as a correctness backstop. */
	fullBackstopDays: number;
	/** `messages.list` / `history.list` page size; Gmail caps at 500. */
	pageSize: number;
	/** Absolute path to the `0600` `credentials.json` holding the account's OAuth tokens. */
	credentialsPath: string;
	accountOverride: string | null;
};

const DEFAULT_API_BASE = 'https://gmail.googleapis.com';
const DEFAULT_TOKEN_URL = 'https://oauth2.googleapis.com/token';

function env(name: string): string | undefined {
	const value = process.env[name];
	return value && value.length > 0 ? value : undefined;
}

export function loadConfig(): AppConfig {
	const dataDir = resolveDataDir();

	return {
		dataDir,
		// The bare GMAIL_* names match what Infisical injects at /apps/local-mail.
		clientId: env('GMAIL_CLIENT_ID') ?? null,
		clientSecret: env('GMAIL_CLIENT_SECRET') ?? null,
		apiBase: env('LOCAL_MAIL_GMAIL_API_BASE') ?? DEFAULT_API_BASE,
		tokenUrl: env('LOCAL_MAIL_GMAIL_TOKEN_URL') ?? DEFAULT_TOKEN_URL,
		historySafeWindowDays: 5,
		fullBackstopDays: 30,
		pageSize: 100,
		credentialsPath:
			env('LOCAL_MAIL_TOKEN_FILE') ?? credentialsFilePath(dataDir),
		accountOverride: env('LOCAL_MAIL_ACCOUNT') ?? null,
	};
}
