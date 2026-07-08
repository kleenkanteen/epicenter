/**
 * OAuth endpoint URLs Epicenter CALLS as a Better Auth client.
 *
 * Distinct from `oauth-metadata.ts`, which computes the discovery paths
 * (`/.well-known/*`) the SERVER advertises. This file captures the
 * authorization-server endpoints Epicenter clients (CLI, Tauri, hosted
 * UI) hit during OAuth flows.
 *
 * The `token`, `authorize`, and `revoke` values mirror Better Auth's default
 * issuer path layout under `/auth/*`; changing them requires a coordinated
 * Better Auth configuration change. `cliCallback` is the exception: it is a
 * page Epicenter owns (the CLI's OOB redirect target), not a Better Auth
 * endpoint, so it lives at root (`/cli-callback`) alongside the other hosted
 * auth UI pages (`/sign-in`, `/consent`) instead of inside Better Auth's
 * reserved `/auth/*` catch-all namespace. This module is the single place
 * every caller imports from so the change lands once.
 *
 * @example
 * ```ts
 * import { OAUTH_ROUTES } from '@epicenter/constants/oauth-routes';
 * const tokenUrl = OAUTH_ROUTES.token.url(authBaseURL);
 * const res = await fetch(tokenUrl, { method: 'POST', body });
 * ```
 */

const stripTrailing = (s: string) => s.replace(/\/+$/, '');

export const OAUTH_ROUTES = {
	cliCallback: {
		pattern: '/cli-callback',
		url: (baseURL: string) => `${stripTrailing(baseURL)}/cli-callback`,
	},
	token: {
		pattern: '/auth/oauth2/token',
		url: (baseURL: string) => `${stripTrailing(baseURL)}/auth/oauth2/token`,
	},
	authorize: {
		pattern: '/auth/oauth2/authorize',
		url: (baseURL: string) => `${stripTrailing(baseURL)}/auth/oauth2/authorize`,
	},
	revoke: {
		pattern: '/auth/oauth2/revoke',
		url: (baseURL: string) => `${stripTrailing(baseURL)}/auth/oauth2/revoke`,
	},
} as const;
