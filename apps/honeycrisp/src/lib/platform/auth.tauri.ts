import { loadPersistedAuthStorage } from '@epicenter/auth';
import {
	EPICENTER_HONEYCRISP_OAUTH_CLIENT_ID,
	EPICENTER_HONEYCRISP_TAURI_OAUTH_REDIRECT_URI,
} from '@epicenter/constants/oauth-clients';
import { APP_URLS } from '@epicenter/constants/vite';
import { createHostedDeepLinkAuth } from '@epicenter/svelte/auth/tauri';
import { invoke } from '@tauri-apps/api/core';
import { defineErrors, extractErrorMessage } from 'wellcrafted/error';
import { createLogger } from 'wellcrafted/logger';
import { tryAsync } from 'wellcrafted/result';
import { instanceSetting } from '$lib/instance';
import type { PlatformAuth } from './types';

const log = createLogger('honeycrisp/platform/auth');

const KeyringError = defineErrors({
	ReadFailed: ({ cause }: { cause: unknown }) => ({
		message: `Failed to read from the OS keyring: ${extractErrorMessage(cause)}`,
		cause,
	}),
	WriteFailed: ({ cause }: { cause: unknown }) => ({
		message: `Failed to write to the OS keyring: ${extractErrorMessage(cause)}`,
		cause,
	}),
});

/**
 * Tolerant like the `localStorage` adapter's `get`: a keychain read failure
 * (locked keychain, platform error) reads as signed-out rather than crashing
 * app boot. The next sign-in re-establishes the grant.
 */
async function readGrant(): Promise<string | null> {
	const { data, error } = await tryAsync({
		try: () => invoke<string | null>('keyring_read'),
		catch: (cause) => KeyringError.ReadFailed({ cause }),
	});
	if (error !== null) {
		log.warn(error);
		return null;
	}
	return data;
}

/**
 * Strict like the `localStorage` adapter's `set`: a grant that could not be
 * persisted must fail the sign-in or refresh that produced it, not silently
 * look saved.
 */
async function writeGrant(serialized: string | null): Promise<void> {
	const { error } = await tryAsync({
		try: () => invoke('keyring_write', { value: serialized }),
		catch: (cause) => KeyringError.WriteFailed({ cause }),
	});
	if (error !== null) throw error;
}

export const auth: PlatformAuth = createHostedDeepLinkAuth({
	instanceSetting,
	clientId: EPICENTER_HONEYCRISP_OAUTH_CLIENT_ID,
	redirectUri: EPICENTER_HONEYCRISP_TAURI_OAUTH_REDIRECT_URI,
	api: APP_URLS.API,
	persistedAuthStorage: await loadPersistedAuthStorage({
		read: readGrant,
		write: writeGrant,
	}),
});

if (import.meta.hot) {
	import.meta.hot.dispose(() => auth[Symbol.dispose]());
}
