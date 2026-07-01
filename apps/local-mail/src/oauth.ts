import * as oauth from 'oauth4webapi';
import {
	defineErrors,
	extractErrorMessage,
	type InferErrors,
} from 'wellcrafted/error';
import type { Result } from 'wellcrafted/result';
import type { AppConfig } from './config.ts';
import {
	type TokenGrantError,
	type TokenSet,
	tokenSetFromGrant,
} from './tokens.ts';

/**
 * Google OAuth2 built on `oauth4webapi` (the same client `@epicenter/auth` and
 * `apps/local-books` use). Phase 1 only needs the refresh-token grant: a token
 * is seeded out of band (Phase 0's manual connect, or a future Phase 2 connect
 * flow) into the token store, and this module keeps it alive. The interactive
 * authorization-code exchange (PKCE + loopback callback per the spec's resolved
 * open question 5) is Phase 2 scope, not ported here.
 */

export const OAuthError = defineErrors({
	MissingCredentials: () => ({
		message:
			'Missing Gmail OAuth credentials. Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET ' +
			'(or run via `infisical run --path=/apps/local-mail`).',
	}),
	TokenExchangeFailed: ({ cause }: { cause: unknown }) => ({
		message: `Gmail token refresh failed: ${extractErrorMessage(cause)}`,
		cause,
	}),
	ReauthRequired: ({ reason }: { reason: string }) => ({
		message: `Re-authentication required: ${reason}.`,
		reason,
	}),
});
export type OAuthError = InferErrors<typeof OAuthError>;

type GrantResult = Promise<Result<TokenSet, OAuthError | TokenGrantError>>;

/** Hand-built server metadata; Google's endpoints are known constants. */
function authServer(config: AppConfig): oauth.AuthorizationServer {
	return {
		issuer: new URL(config.tokenUrl).origin,
		authorization_endpoint: config.authorizeUrl,
		token_endpoint: config.tokenUrl,
	};
}

/** Allow http for a mock token endpoint in tests. */
function httpOptions(config: AppConfig) {
	return {
		[oauth.allowInsecureRequests]:
			new URL(config.tokenUrl).protocol === 'http:',
	};
}

export async function refreshAccessToken(
	config: AppConfig,
	token: TokenSet,
	now: () => number,
): GrantResult {
	if (!config.clientId || !config.clientSecret) {
		return OAuthError.MissingCredentials();
	}
	const as = authServer(config);
	const client: oauth.Client = { client_id: config.clientId };
	try {
		const response = await oauth.refreshTokenGrantRequest(
			as,
			client,
			oauth.ClientSecretBasic(config.clientSecret),
			token.refreshToken,
			httpOptions(config),
		);
		const grant = await oauth.processRefreshTokenResponse(as, client, response);
		// Rotation: Google may omit refresh_token when the old one stays valid.
		return tokenSetFromGrant(grant, {
			accountEmail: token.accountEmail,
			clientIdUsed: token.clientIdUsed,
			now: now(),
			fallbackRefreshToken: token.refreshToken,
		});
	} catch (cause) {
		// Google's OAuth-style error responses (a dead grant: revoked, or a
		// Testing-mode client's 7-day test-user refresh token expired) throw
		// `ResponseBodyError` rather than returning an error value; `invalid_grant`
		// is the one case worth distinguishing (needs re-consent, not a retry).
		if (
			cause instanceof oauth.ResponseBodyError &&
			cause.error === 'invalid_grant'
		) {
			return OAuthError.ReauthRequired({ reason: cause.error });
		}
		return OAuthError.TokenExchangeFailed({ cause });
	}
}
