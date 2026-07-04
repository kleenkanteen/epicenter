import {
	type CredentialSource,
	type ProviderCredentialSpec,
	resolveProviderCredentials,
} from '@epicenter/constants/provider-credentials';
import { Err, Ok, type Result } from 'wellcrafted/result';
import type { GmailEnvironment } from './tokens.ts';

/**
 * Gmail provider-credential spec (ADR-0105), app-owned. Local Mail has two Google
 * Desktop OAuth clients, a dev/unverified one and a prod/verified one, and they
 * are entirely distinct clients (different ids, secrets, and consent screens), so
 * both roles vary per environment and are environment-qualified:
 *
 *   GMAIL_DEV_CLIENT_ID   / GMAIL_DEV_CLIENT_SECRET    (unverified dev client)
 *   GMAIL_PROD_CLIENT_ID  / GMAIL_PROD_CLIENT_SECRET   (verified prod client)
 *
 * The old undifferentiated `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` are retired.
 * Which vault environment stores each qualified name is an orthogonal
 * access-control choice, not a selector: the name carries the environment.
 */
export const GMAIL_SPEC = {
	prefix: 'GMAIL',
	environments: ['dev', 'prod'],
	environmentRoles: ['CLIENT_ID', 'CLIENT_SECRET'],
} as const satisfies ProviderCredentialSpec<GmailEnvironment>;

/**
 * Resolve the Google OAuth client keyset for a target environment. Throws a
 * `ProviderCredentialError` naming the exact missing qualified variables when the
 * environment's keys are absent, so a wrong-keyset run fails loudly at resolution
 * time instead of dying later as an opaque Google `invalid_client`.
 */
export function resolveGmailCredentials(
	environment: GmailEnvironment,
	read?: CredentialSource,
): { clientId: string; clientSecret: string } {
	const credentials = resolveProviderCredentials(GMAIL_SPEC, environment, read);
	return {
		clientId: credentials.CLIENT_ID,
		clientSecret: credentials.CLIENT_SECRET,
	};
}

/** The environments whose full keyset is present in the injected source. */
export function availableGmailEnvironments(
	read?: CredentialSource,
): GmailEnvironment[] {
	return GMAIL_SPEC.environments.filter((environment) => {
		try {
			resolveGmailCredentials(environment, read);
			return true;
		} catch {
			return false;
		}
	});
}

/**
 * Pick the provider-environment to connect an account under (ADR-0105 rule 4).
 * The `--gmail-env` flag is the chooser and the disambiguator: it is required
 * only when more than one environment's credentials are present. With a single
 * keyset present it is inferred; with none present the failure names both
 * keysets so the operator knows what to set.
 */
export function selectGmailEnvironment(
	explicit: GmailEnvironment | undefined,
	read?: CredentialSource,
): Result<GmailEnvironment, { message: string }> {
	const available = availableGmailEnvironments(read);
	if (explicit) {
		if (available.includes(explicit)) return Ok(explicit);
		const upper = explicit.toUpperCase();
		return Err({
			message: `No Gmail ${explicit} credentials found. Set GMAIL_${upper}_CLIENT_ID and GMAIL_${upper}_CLIENT_SECRET (see .env.example).`,
		});
	}
	if (available.length === 1) return Ok(available[0] as GmailEnvironment);
	if (available.length === 0) {
		return Err({
			message:
				'No Gmail OAuth credentials found. Set GMAIL_DEV_CLIENT_ID / GMAIL_DEV_CLIENT_SECRET or GMAIL_PROD_CLIENT_ID / GMAIL_PROD_CLIENT_SECRET (see .env.example).',
		});
	}
	return Err({
		message:
			'Both dev and prod Gmail credentials are present; choose one with --gmail-env dev|prod.',
	});
}
