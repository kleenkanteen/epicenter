/**
 * WebAuthn ceremonies for the hosted sign-in page, driven directly against
 * the Better Auth passkey plugin's REST endpoints (`@better-auth/passkey`;
 * the wire contract is pinned by `packages/server/src/auth/plugins.test.ts`).
 * `@simplewebauthn/browser` runs the browser ceremony and plain fetch carries
 * it, matching how the rest of this SPA talks to Better Auth.
 *
 * Both ceremonies resolve instead of throwing. The `PromptCancelled` error
 * means the user dismissed the browser prompt; callers reset quietly instead
 * of showing an error. Every other error carries its user-facing copy in
 * `message`.
 *
 * Registration needs a FRESH session (Better Auth `freshSessionMiddleware`,
 * `freshAge` default 24h) while sessions live 7 days, so a user can be
 * visibly signed in and still get refused. Both refusals (401 no session,
 * 403 stale session) have the same remedy: sign in again.
 */

import {
	type PublicKeyCredentialCreationOptionsJSON,
	type PublicKeyCredentialRequestOptionsJSON,
	startAuthentication,
	startRegistration,
} from '@simplewebauthn/browser';
import { defineErrors, type InferErrors } from 'wellcrafted/error';
import { Err, Ok, type Result, tryAsync } from 'wellcrafted/result';

export const PasskeyCeremonyError = defineErrors({
	/** The user dismissed or timed out the browser prompt; reset quietly. */
	PromptCancelled: () => ({
		message: 'Passkey prompt was cancelled.',
	}),
	/** Registration was refused for a missing or stale session. */
	SessionNotFresh: () => ({
		message: 'Sign in again to add a passkey.',
	}),
	/** Any other failed ceremony step; `message` is the step's user copy. */
	StepFailed: ({ message, cause }: { message: string; cause?: unknown }) => ({
		message,
		cause,
	}),
});
export type PasskeyCeremonyError = InferErrors<typeof PasskeyCeremonyError>;

type PasskeyCeremonyResult = Result<void, PasskeyCeremonyError>;

export function supportsPasskeys(): boolean {
	return typeof PublicKeyCredential !== 'undefined';
}

/** The browser reports a dismissed or timed-out prompt as NotAllowedError. */
function isCancelled(cause: unknown): boolean {
	return cause instanceof Error && cause.name === 'NotAllowedError';
}

async function fetchOptions<TOptions>({
	endpoint,
	failureMessage,
	requireFreshSession = false,
}: {
	endpoint: string;
	failureMessage: string;
	requireFreshSession?: boolean;
}): Promise<Result<TOptions, PasskeyCeremonyError>> {
	const { data: response, error: fetchError } = await tryAsync({
		try: () =>
			fetch(endpoint, {
				credentials: 'include',
				headers: { Accept: 'application/json' },
			}),
		catch: (cause) =>
			PasskeyCeremonyError.StepFailed({ message: failureMessage, cause }),
	});
	if (fetchError) return Err(fetchError);

	if (
		requireFreshSession &&
		(response.status === 401 || response.status === 403)
	) {
		return PasskeyCeremonyError.SessionNotFresh();
	}
	if (!response.ok) {
		return PasskeyCeremonyError.StepFailed({ message: failureMessage });
	}

	return tryAsync({
		try: () => response.json() as Promise<TOptions>,
		catch: (cause) =>
			PasskeyCeremonyError.StepFailed({ message: failureMessage, cause }),
	});
}

async function runPrompt<TCredential>(
	failureMessage: string,
	run: () => Promise<TCredential>,
): Promise<Result<TCredential, PasskeyCeremonyError>> {
	return tryAsync({
		try: run,
		catch: (cause) =>
			isCancelled(cause)
				? PasskeyCeremonyError.PromptCancelled()
				: PasskeyCeremonyError.StepFailed({ message: failureMessage, cause }),
	});
}

async function verifyCredential({
	endpoint,
	credential,
	failureMessage,
}: {
	endpoint: string;
	credential: unknown;
	failureMessage: string;
}): Promise<PasskeyCeremonyResult> {
	const { data: response, error: fetchError } = await tryAsync({
		try: () =>
			fetch(endpoint, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({ response: credential }),
			}),
		catch: (cause) =>
			PasskeyCeremonyError.StepFailed({ message: failureMessage, cause }),
	});
	if (fetchError) return Err(fetchError);
	if (!response.ok) {
		return PasskeyCeremonyError.StepFailed({ message: failureMessage });
	}
	return Ok(undefined);
}

export async function authenticateWithPasskey(): Promise<PasskeyCeremonyResult> {
	const { data: options, error: optionsError } =
		await fetchOptions<PublicKeyCredentialRequestOptionsJSON>({
			endpoint: '/auth/passkey/generate-authenticate-options',
			failureMessage: 'Could not start passkey sign-in.',
		});
	if (optionsError) return Err(optionsError);

	const { data: credential, error: promptError } = await runPrompt(
		'Passkey sign-in failed.',
		() => startAuthentication({ optionsJSON: options }),
	);
	if (promptError) return Err(promptError);

	return verifyCredential({
		endpoint: '/auth/passkey/verify-authentication',
		credential,
		failureMessage: 'Passkey could not be verified.',
	});
}

export async function registerPasskey(): Promise<PasskeyCeremonyResult> {
	const { data: options, error: optionsError } =
		await fetchOptions<PublicKeyCredentialCreationOptionsJSON>({
			endpoint: '/auth/passkey/generate-register-options',
			failureMessage: 'Could not start passkey setup.',
			requireFreshSession: true,
		});
	if (optionsError) return Err(optionsError);

	const { data: credential, error: promptError } = await runPrompt(
		'Passkey setup failed.',
		() => startRegistration({ optionsJSON: options }),
	);
	if (promptError) return Err(promptError);

	return verifyCredential({
		endpoint: '/auth/passkey/verify-registration',
		credential,
		failureMessage: 'Passkey could not be saved.',
	});
}
