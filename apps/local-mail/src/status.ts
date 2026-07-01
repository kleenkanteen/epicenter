import { existsSync } from 'node:fs';
import type { AppConfig } from './config.ts';
import { openMailDb } from './db.ts';
import { dbPath } from './paths.ts';
import type { TokenStore } from './token-store.ts';
import { isAccessTokenExpired } from './tokens.ts';

export type MailStatus = {
	accountEmail: string;
	dataDir: string;
	tokenFile: string;
	connected: boolean;
	accessToken: { valid: boolean; expiresAt: string } | null;
	mirrorBuilt: boolean;
	schemaVersion: string | null;
	historyId: string | null;
	lastFullPullAt: string | null;
	lastSyncedAt: string | null;
	rows: { messages: number; labels: number };
};

export async function readMailStatus({
	config,
	accountEmail,
	store,
}: {
	config: AppConfig;
	accountEmail: string;
	store: TokenStore;
}): Promise<MailStatus> {
	const token = await store.get(accountEmail);
	const base = {
		accountEmail,
		dataDir: config.dataDir,
		tokenFile: config.credentialsPath,
		connected: token !== null,
		accessToken: token
			? {
					valid: !isAccessTokenExpired(token, Date.now(), 0),
					expiresAt: token.accessTokenExpiresAt,
				}
			: null,
	};

	const path = dbPath(config.dataDir, accountEmail);
	if (!existsSync(path)) {
		return {
			...base,
			mirrorBuilt: false,
			schemaVersion: null,
			historyId: null,
			lastFullPullAt: null,
			lastSyncedAt: null,
			rows: { messages: 0, labels: 0 },
		};
	}

	const db = openMailDb(path, { readonly: true });
	try {
		const realm = db.readRealmState();
		const schemaVersion =
			db.raw
				.query<{ value: string }, []>(
					`SELECT value FROM _meta WHERE key = 'schema_version'`,
				)
				.get()?.value ?? null;
		const messages =
			db.raw
				.query<{ n: number }, []>(
					`SELECT count(*) AS n FROM messages WHERE deleted = 0`,
				)
				.get()?.n ?? 0;
		const labels =
			db.raw.query<{ n: number }, []>(`SELECT count(*) AS n FROM labels`).get()
				?.n ?? 0;
		return {
			...base,
			mirrorBuilt: true,
			schemaVersion,
			historyId: realm.historyId,
			lastFullPullAt: realm.lastFullPullAt,
			lastSyncedAt: realm.lastSyncedAt,
			rows: { messages, labels },
		};
	} finally {
		db.close();
	}
}
