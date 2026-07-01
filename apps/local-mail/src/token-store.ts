import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Value } from 'typebox/value';
import { type TokenSet, TokenSetSchema } from './tokens.ts';

/**
 * Where an account's OAuth `TokenSet` lives, keyed by `accountEmail`: the
 * connect flow (Phase 2) writes it, `sync` reads it. The set never lives inside
 * an account's mirror db, so the mirror's read-only SQL surface can never read
 * it. `get` returns `null` when nothing is stored; `set` throws if the write
 * fails (disk, permissions), which bubbles to the caller rather than threading a
 * Result through every call site. Same shape as `apps/local-books`'
 * `token-store.ts`, see ADR-0062.
 */
export type TokenStore = {
	get(accountEmail: string): Promise<TokenSet | null>;
	set(token: TokenSet): Promise<void>;
};

/**
 * The `0600` JSON-file token store at `<data-dir>/credentials.json` (or wherever
 * `LOCAL_MAIL_TOKEN_FILE` points). The set is not encrypted; the file mode is
 * the protection, the same tradeoff `git credential-store` and `~/.aws/credentials`
 * make. Disk bytes are untrusted, so a read validates against `TokenSetSchema`
 * and treats a malformed entry as absent.
 */
export function createFileTokenStore(filePath: string): TokenStore {
	const load = (): Record<string, string> => {
		try {
			const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
			return typeof parsed === 'object' && parsed !== null ? parsed : {};
		} catch {
			return {};
		}
	};
	const save = (map: Record<string, string>) => {
		mkdirSync(dirname(filePath), { recursive: true });
		writeFileSync(filePath, JSON.stringify(map, null, 2));
		chmodSync(filePath, 0o600);
	};
	return {
		async get(accountEmail) {
			const raw = load()[accountEmail];
			if (!raw) return null;
			try {
				const parsed: unknown = JSON.parse(raw);
				return Value.Check(TokenSetSchema, parsed) ? parsed : null;
			} catch {
				return null;
			}
		},
		async set(token) {
			const map = load();
			map[token.accountEmail] = JSON.stringify(token);
			save(map);
		},
	};
}
