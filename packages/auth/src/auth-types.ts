import { PrincipalId } from '@epicenter/identity';
import { type } from 'arktype';

/**
 * The authenticated principal projected for Epicenter clients.
 *
 * Better Auth still owns its `user` table and session model. This projection is
 * the Epicenter principal used by the workspace partition. Hosted Cloud
 * principals include `email`; the self-hosted instance principal does not.
 */
export const Principal = type({
	'+': 'delete',
	id: PrincipalId,
	'email?': 'string',
});

export type Principal = typeof Principal.infer;

/**
 * OAuth token grant. Persisted under `PersistedAuth.grant`.
 *
 * Server-access material: required to call `/api/*` online; offline-useless
 * on its own. Refresh tokens rotate on every successful refresh.
 */
export const OAuthTokenGrant = type({
	'+': 'delete',
	accessToken: 'string',
	refreshToken: 'string',
	/**
	 * Absolute access-token expiry as epoch milliseconds.
	 *
	 * Computed from the OAuth `expires_in` seconds returned with the token
	 * grant (`accessTokenExpiresAt = now() + expires_in * 1000`). Used only as
	 * a transport refresh hint: the resource server is still the source of
	 * truth for token validity, so this value is checked locally to decide
	 * when to refresh, never to authorize a request.
	 */
	accessTokenExpiresAt: 'number',
});

export type OAuthTokenGrant = typeof OAuthTokenGrant.infer;

/**
 * The single persisted auth cell.
 *
 * Browser persists to localStorage, extension to chrome.storage.local, CLI
 * to a per-API-target file under the platform data directory (mode 0o600);
 * see {@link machineAuthFilePath}. All three cells validate against this
 * arktype, which satisfies StandardSchemaV1 natively via `~standard`, so it
 * plugs straight into Standard-Schema consumers like createPersistedState.
 * Profile data is intentionally absent; application surfaces fetch it when
 * they display it.
 *
 * Wave 1 keeps the old field names so persisted JSON remains unchanged until
 * the session and client shape collapse in Wave 3. Both ids are now
 * {@link PrincipalId}; the duplicate fields disappear when the wire shape does.
 */
export const PersistedAuth = type({
	'+': 'delete',
	grant: OAuthTokenGrant,
	userId: PrincipalId,
	ownerId: PrincipalId,
});

export type PersistedAuth = typeof PersistedAuth.infer;

/**
 * Canonical `/api/session` response shape. The single contract between the
 * API and every Epicenter auth client (browser, extension, CLI machine,
 * daemon).
 *
 * Wave 1 keeps the old response fields (`user`, `ownerId`) while merging their
 * brands to {@link PrincipalId}. Wave 3 collapses this to the final
 * `{ principalId, email? }` shape.
 */
export const ApiSessionResponse = type({
	'+': 'delete',
	user: Principal,
	ownerId: PrincipalId,
});

export type ApiSessionResponse = typeof ApiSessionResponse.infer;
