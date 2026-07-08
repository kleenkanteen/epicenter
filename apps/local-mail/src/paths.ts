import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * `LOCAL_MAIL_DIR` beats the OS-appropriate application-data directory for
 * the mirror. Scoping the db by account email keeps multiple connected Gmail
 * accounts from colliding.
 *
 * macOS: `~/Library/Application Support/local-mail`
 * Linux/other: `$XDG_DATA_HOME/local-mail` or `~/.local/share/local-mail`
 */
export function resolveDataDir(): string {
	const env = process.env.LOCAL_MAIL_DIR;
	if (env && env.length > 0) return env;
	if (process.platform === 'darwin') {
		return join(homedir(), 'Library', 'Application Support', 'local-mail');
	}
	const xdg = process.env.XDG_DATA_HOME;
	if (xdg && xdg.length > 0) return join(xdg, 'local-mail');
	return join(homedir(), '.local', 'share', 'local-mail');
}

/**
 * The default file token store: `credentials.json` at the data-dir root, sibling
 * to each account's `<accountEmail>/` mirror dir. Deliberately not inside the
 * mirror dir, so a read-only SQL surface over `mail.db` can never read it. Same
 * reasoning as `apps/local-books` (ADR-0062).
 */
export function credentialsFilePath(dataDir: string): string {
	return join(dataDir, 'credentials.json');
}

/** The 0600 machine-level provider-credentials file, sibling to credentials.json. */
export function providerFilePath(dataDir: string): string {
	return join(dataDir, 'provider.json');
}
