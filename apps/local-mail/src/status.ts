import { existsSync } from 'node:fs';
import type { AppConfig } from './config.ts';
import { openMailDbReadonly } from './db.ts';
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

	const db = openMailDbReadonly(path);
	try {
		const realm = db.realmState();
		return {
			...base,
			mirrorBuilt: true,
			schemaVersion: db.schemaVersion(),
			historyId: realm.historyId,
			lastFullPullAt: realm.lastFullPullAt,
			lastSyncedAt: realm.lastSyncedAt,
			rows: db.counts(),
		};
	} finally {
		db.close();
	}
}
