import * as oauth from 'oauth4webapi';
import { Value } from 'typebox/value';
import {
	defineErrors,
	extractErrorMessage,
	type InferErrors,
} from 'wellcrafted/error';
import type { Result } from 'wellcrafted/result';
import type { AppConfig } from './config.ts';
import { ProfileResponseSchema } from './schema.ts';
import {
	type TokenGrantError,
	type TokenSet,
	tokenSetFromGrant,
} from './tokens.ts';

/**
 * Google OAuth2 built on `oauth4webapi` (the same client `@epicenter/auth` and
 * `apps/local-books` use). `connect` runs an authorization-code + PKCE loopback
 * flow once, stores the resulting refresh token, and the refresh grant keeps it
 * alive after that.
 */

export const OAuthError = defineErrors({
	MissingCredentials: () => ({
		message:
			'Missing Gmail OAuth credentials. Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET ' +
			'(or run via `infisical run --path=/apps/local-mail`).',
	}),
	TokenExchangeFailed: ({ cause }: { cause: unknown }) => ({
		message: `Gmail token exchange failed: ${extractErrorMessage(cause)}`,
		cause,
	}),
	AuthorizationDenied: ({
		error,
		description,
	}: {
		error: string;
		description: string;
	}) => ({
		message: `Gmail denied authorization: ${error}${description ? ` (${description})` : ''}`,
		error,
		description,
	}),
	Timeout: ({ ms }: { ms: number }) => ({
		message: `Timed out after ${ms}ms waiting for the OAuth callback.`,
		ms,
	}),
	ProfileLookupFailed: ({ cause }: { cause: unknown }) => ({
		message: `Could not read the connected Gmail profile: ${extractErrorMessage(cause)}`,
		cause,
	}),
	ReauthRequired: ({ reason }: { reason: string }) => ({
		message: `Re-authentication required: ${reason}.`,
		reason,
	}),
});
export type OAuthError = InferErrors<typeof OAuthError>;

type GrantResult = Promise<Result<TokenSet, OAuthError | TokenGrantError>>;

export type AuthorizationFlowOptions = {
	now: () => number;
	openBrowser?: (url: string) => void;
	log?: (message: string) => void;
	timeoutMs?: number;
};

const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

/** Hand-built server metadata; Google's OAuth endpoints are known constants. */
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

function buildAuthorizeUrl(
	config: AppConfig,
	{
		state,
		codeChallenge,
		redirectUri,
	}: { state: string; codeChallenge: string; redirectUri: string },
): string {
	const url = new URL(config.authorizeUrl);
	url.searchParams.set('client_id', config.clientId ?? '');
	url.searchParams.set('response_type', 'code');
	url.searchParams.set('scope', GMAIL_READONLY_SCOPE);
	url.searchParams.set('redirect_uri', redirectUri);
	url.searchParams.set('state', state);
	url.searchParams.set('code_challenge', codeChallenge);
	url.searchParams.set('code_challenge_method', 'S256');
	url.searchParams.set('access_type', 'offline');
	url.searchParams.set('prompt', 'consent');
	return url.toString();
}

function defaultOpenBrowser(url: string): void {
	if (process.platform !== 'darwin') return;
	try {
		Bun.spawn(['open', url], { stdout: 'ignore', stderr: 'ignore' });
	} catch {
		// Non-fatal: the consent URL is printed for manual paste.
	}
}

async function fetchAccountEmail(
	config: AppConfig,
	accessToken: string,
): Promise<Result<string, OAuthError>> {
	try {
		const response = await fetch(`${config.apiBase}/gmail/v1/users/me/profile`, {
			headers: {
				Authorization: `Bearer ${accessToken}`,
				Accept: 'application/json',
			},
		});
		if (!response.ok) {
			return OAuthError.ProfileLookupFailed({
				cause: new Error(`profile returned ${response.status}`),
			});
		}
		const json = await response.json();
		if (!Value.Check(ProfileResponseSchema, json) || !json.emailAddress) {
			return OAuthError.ProfileLookupFailed({
				cause: new Error('profile response did not include emailAddress'),
			});
		}
		return { data: json.emailAddress, error: null };
	} catch (cause) {
		return OAuthError.ProfileLookupFailed({ cause });
	}
}

export async function completeAuthorization(
	config: AppConfig,
	{
		callbackUrl,
		state,
		codeVerifier,
		redirectUri,
	}: {
		callbackUrl: URL;
		state: string;
		codeVerifier: string;
		redirectUri: string;
	},
	now: () => number,
): GrantResult {
	if (!config.clientId || !config.clientSecret) {
		return OAuthError.MissingCredentials();
	}
	const as = authServer(config);
	const client: oauth.Client = { client_id: config.clientId };
	try {
		const params = oauth.validateAuthResponse(as, client, callbackUrl, state);
		const response = await oauth.authorizationCodeGrantRequest(
			as,
			client,
			oauth.ClientSecretPost(config.clientSecret),
			params,
			redirectUri,
			codeVerifier,
			httpOptions(config),
		);
		const grant = await oauth.processAuthorizationCodeResponse(
			as,
			client,
			response,
		);
		const accessToken =
			typeof grant.access_token === 'string' ? grant.access_token : null;
		if (!accessToken) {
			return OAuthError.ProfileLookupFailed({
				cause: new Error('token response did not include access_token'),
			});
		}
		const { data: accountEmail, error } = await fetchAccountEmail(
			config,
			accessToken,
		);
		if (error) return { data: null, error };
		return tokenSetFromGrant(grant, {
			accountEmail,
			clientIdUsed: config.clientId,
			now: now(),
		});
	} catch (cause) {
		if (cause instanceof oauth.AuthorizationResponseError) {
			return OAuthError.AuthorizationDenied({
				error: cause.error,
				description: cause.error_description ?? '',
			});
		}
		return OAuthError.TokenExchangeFailed({ cause });
	}
}

export async function runAuthorizationFlow(
	config: AppConfig,
	options: AuthorizationFlowOptions,
): GrantResult {
	if (!config.clientId || !config.clientSecret) {
		return OAuthError.MissingCredentials();
	}

	const state = oauth.generateRandomState();
	const codeVerifier = oauth.generateRandomCodeVerifier();
	const codeChallenge = await oauth.calculatePKCECodeChallenge(codeVerifier);
	const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000;
	const log = options.log ?? (() => {});
	const { promise: callback, resolve } = Promise.withResolvers<URL | null>();

	const server = Bun.serve({
		hostname: '127.0.0.1',
		port: 0,
		fetch(request) {
			const url = new URL(request.url);
			if (url.pathname !== '/oauth/callback') {
				return new Response('Not found', { status: 404 });
			}
			setTimeout(() => resolve(url), 0);
			return new Response(
				'<html><body><h2>Local Mail connected.</h2><p>You can close this window and return to the terminal.</p></body></html>',
				{ headers: { 'content-type': 'text/html' } },
			);
		},
	});
	const redirectUri = `http://127.0.0.1:${server.port}/oauth/callback`;
	const authorizeUrl = buildAuthorizeUrl(config, {
		state,
		codeChallenge,
		redirectUri,
	});
	log('Opening your browser to authorize Gmail access.');
	log(`If it does not open, visit:\n  ${authorizeUrl}`);
	(options.openBrowser ?? defaultOpenBrowser)(authorizeUrl);

	const timeout = new Promise<URL | null>((resolveTimeout) => {
		setTimeout(() => resolveTimeout(null), timeoutMs);
	});
	const callbackUrl = await Promise.race([callback, timeout]);
	server.stop(true);
	if (!callbackUrl) return OAuthError.Timeout({ ms: timeoutMs });

	return completeAuthorization(
		config,
		{ callbackUrl, state, codeVerifier, redirectUri },
		options.now,
	);
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
