import {
	type CredentialSource,
	type ProviderCredentialSpec,
	resolveProviderCredentials,
} from '@epicenter/constants/provider-credentials';
import { providerFilePath } from './paths.ts';
import { readProviderFile, writeProviderFileIfAbsent } from './provider-store.ts';

/**
 * The single BYO Google OAuth Desktop client Local Mail connects through
 * (ADR-0108). Gmail issues one client, not a per-account keyset, so it is a
 * single-environment provider: names stay unqualified GMAIL_CLIENT_ID /
 * GMAIL_CLIENT_SECRET.
 */
export const GMAIL_SPEC = {
	prefix: 'GMAIL',
	environments: ['default'],
	environmentRoles: ['CLIENT_ID', 'CLIENT_SECRET'],
} as const satisfies ProviderCredentialSpec<'default'>;

export function resolveGmailCredentials(
	read?: CredentialSource,
): { clientId: string; clientSecret: string } {
	const credentials = resolveProviderCredentials(GMAIL_SPEC, 'default', read);
	return {
		clientId: credentials.CLIENT_ID,
		clientSecret: credentials.CLIENT_SECRET,
	};
}

/**
 * The machine-tier credential source: env wins per-name, then the 0600
 * provider.json at the data-dir root. Env stays the override/CI/test seam; the
 * file is the durable default every worktree shares.
 */
export function gmailCredentialSource(dataDir: string): CredentialSource {
	const file = readProviderFile(providerFilePath(dataDir));
	return (name) => {
		const fromEnv = process.env[name];
		if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
		const fromFile = file[name];
		return fromFile !== undefined && fromFile.length > 0
			? fromFile
			: undefined;
	};
}

/** Cache env-supplied client creds to the machine file after a good grant, if absent. */
export function persistGmailProviderCredentials(
	dataDir: string,
	creds: { clientId: string; clientSecret: string },
): void {
	writeProviderFileIfAbsent(providerFilePath(dataDir), {
		GMAIL_CLIENT_ID: creds.clientId,
		GMAIL_CLIENT_SECRET: creds.clientSecret,
	});
}
