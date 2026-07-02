import { Err, Ok, type Result } from 'wellcrafted/result';
import { type AppConfig, loadConfig } from './config.ts';
import { type MailDb, openMailDb } from './db.ts';
import { createGmailClient } from './gmail-client.ts';
import type { SyncDeps } from './sync.ts';
import { createTokenManager } from './token-manager.ts';
import {
	createFileTokenStore,
	resolveAccount,
	type TokenStore,
} from './token-store.ts';

/**
 * The composition root for every account-scoped verb (sync, query, status,
 * and the MCP server). Config, the credential store, and THE account are
 * resolved exactly once per process; nothing downstream re-resolves any of
 * them. That is a deliberate lifetime rule, not just deduplication: a
 * long-lived MCP server must keep one stable account identity for its whole
 * session (connecting a second account mid-session must not flip which
 * mailbox existing tools talk to), and Phase 3 write-through tools inherit
 * that guarantee by construction.
 *
 * `connect` and `seed-token` stay outside: they create accounts, so there is
 * no account to resolve yet.
 */
export type LocalMailRuntime = {
	config: AppConfig;
	store: TokenStore;
	accountEmail: string;
	now: () => number;
};

export async function openLocalMailRuntime(): Promise<
	Result<LocalMailRuntime, { message: string }>
> {
	const config = loadConfig();
	const store = createFileTokenStore(config.credentialsPath);
	const { data: accountEmail, error } = await resolveAccount(config, store);
	if (error) return Err(error);
	return Ok({ config, store, accountEmail, now: () => Date.now() });
}

export type SyncSession = {
	/** The writer handle, exposed for post-pass reporting (row counts). */
	db: MailDb;
	deps: SyncDeps;
	close(): void;
};

/**
 * Everything one sync pass needs, assembled from the runtime: the stored
 * token, a refreshing token manager, the Gmail client, and the writer db.
 * Both sync surfaces (CLI verb, MCP tool) build their pass through here, so
 * the assembly cannot drift between them.
 */
export async function openSyncSession(
	runtime: LocalMailRuntime,
	{
		gmailLog,
		syncLog,
	}: {
		gmailLog?: (message: string) => void;
		syncLog?: (message: string) => void;
	} = {},
): Promise<Result<SyncSession, { message: string }>> {
	const { config, store, accountEmail, now } = runtime;
	const token = await store.get(accountEmail);
	if (!token) {
		return Err({
			message: `No token stored for ${accountEmail}. Run "local-mail connect" first.`,
		});
	}
	const tokens = createTokenManager({ config, store, token, now });
	const client = createGmailClient({ tokens, config, log: gmailLog });
	const db = openMailDb({ dataDir: config.dataDir, accountEmail });
	return Ok({
		db,
		deps: { db, client, config, now, log: syncLog },
		close: () => db.close(),
	});
}
