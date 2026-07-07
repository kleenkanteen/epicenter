/**
 * WebAuthn ceremonies for the hosted sign-in page, driven directly against
 * the Better Auth passkey plugin's REST endpoints (`@better-auth/passkey`;
 * the wire contract is pinned by `packages/server/src/auth/plugins.test.ts`).
 * `@simplewebauthn/browser` runs the browser ceremony and plain fetch carries
 * it, matching how the rest of this SPA talks to Better Auth.
 *
 * Both ceremonies resolve instead of throwing. A failed result with
 * `error: null` means the user dismissed the browser prompt; callers reset
 * quietly instead of showing an error.
 *
 * Registration needs a FRESH session (Better Auth `freshSessionMiddleware`,
 * `freshAge` default 24h) while sessions live 7 days, so a user can be
 * visibly signed in and still get refused. Both refusals (401 no session,
 * 403 stale session) have the same remedy: sign in again.
 */

import {
	startAuthentication,
	startRegistration,
	type AuthenticationResponseJSON,
	type PublicKeyCredentialCreationOptionsJSON,
	type PublicKeyCredentialRequestOptionsJSON,
	type RegistrationResponseJSON,
} from '@simplewebauthn/browser';

export type PasskeyCeremonyResult =
	| { ok: true }
	| { ok: false; error: string | null };

export function supportsPasskeys(): boolean {
	return typeof PublicKeyCredential !== 'undefined';
}

/** The browser reports a dismissed or timed-out prompt as NotAllowedError. */
function isCancelled(cause: unknown): boolean {
	return cause instanceof Error && cause.name === 'NotAllowedError';
}

export async function authenticateWithPasskey(): Promise<PasskeyCeremonyResult> {
	let options: PublicKeyCredentialRequestOptionsJSON;
	try {
		const response = await fetch(
			'/auth/passkey/generate-authenticate-options',
			{ credentials: 'include', headers: { Accept: 'application/json' } },
		);
		if (!response.ok) {
			return { ok: false, error: 'Could not start passkey sign-in.' };
		}
		options = await response.json();
	} catch {
		return { ok: false, error: 'Network error starting passkey sign-in.' };
	}

	let credential: AuthenticationResponseJSON;
	try {
		credential = await startAuthentication({ optionsJSON: options });
	} catch (cause) {
		return {
			ok: false,
			error: isCancelled(cause) ? null : 'Passkey sign-in failed.',
		};
	}

	try {
		const response = await fetch('/auth/passkey/verify-authentication', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'include',
			body: JSON.stringify({ response: credential }),
		});
		if (!response.ok) {
			return { ok: false, error: 'Passkey could not be verified.' };
		}
	} catch {
		return { ok: false, error: 'Network error verifying passkey.' };
	}
	return { ok: true };
}

export async function registerPasskey(): Promise<PasskeyCeremonyResult> {
	let options: PublicKeyCredentialCreationOptionsJSON;
	try {
		const response = await fetch('/auth/passkey/generate-register-options', {
			credentials: 'include',
			headers: { Accept: 'application/json' },
		});
		if (response.status === 401 || response.status === 403) {
			return { ok: false, error: 'Sign in again to add a passkey.' };
		}
		if (!response.ok) {
			return { ok: false, error: 'Could not start passkey setup.' };
		}
		options = await response.json();
	} catch {
		return { ok: false, error: 'Network error starting passkey setup.' };
	}

	let credential: RegistrationResponseJSON;
	try {
		credential = await startRegistration({ optionsJSON: options });
	} catch (cause) {
		return {
			ok: false,
			error: isCancelled(cause) ? null : 'Passkey setup failed.',
		};
	}

	try {
		const response = await fetch('/auth/passkey/verify-registration', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'include',
			body: JSON.stringify({ response: credential }),
		});
		if (!response.ok) {
			return { ok: false, error: 'Passkey could not be saved.' };
		}
	} catch {
		return { ok: false, error: 'Network error saving passkey.' };
	}
	return { ok: true };
}
