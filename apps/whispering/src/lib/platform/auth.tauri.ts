import { loadPersistedAuthStorage } from '@epicenter/auth';
import {
	EPICENTER_WHISPERING_OAUTH_CLIENT_ID,
	EPICENTER_WHISPERING_TAURI_OAUTH_REDIRECT_URI,
} from '@epicenter/constants/oauth-clients';
import { APP_URLS } from '@epicenter/constants/vite';
import { createHostedDeepLinkAuth } from '@epicenter/svelte/auth/tauri';
import { createLogger } from 'wellcrafted/logger';
import { instanceSetting } from '$lib/instance';
// This file is the Tauri impl, so it imports the non-null capability bag
// directly from the Tauri marker rather than through the `#platform/tauri`
// seam (which resolves to `null` under the web condition).
import { tauriOnly } from '$lib/tauri.tauri';
import type { PlatformAuth } from './types';

const log = createLogger('whispering/platform/auth');

/**
 * Tolerant like the `localStorage` adapter's `get`: a keychain read failure
 * (locked keychain, platform error) reads as signed-out rather than crashing
 * app boot. The next sign-in re-establishes the grant.
 */
async function readGrant(): Promise<string | null> {
	const { data, error } = await tauriOnly.keyring.read();
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
	const { error } = await tauriOnly.keyring.write(serialized);
	if (error !== null) throw error;
}

export const auth: PlatformAuth = createHostedDeepLinkAuth({
	instanceSetting,
	clientId: EPICENTER_WHISPERING_OAUTH_CLIENT_ID,
	redirectUri: EPICENTER_WHISPERING_TAURI_OAUTH_REDIRECT_URI,
	api: APP_URLS.API,
	persistedAuthStorage: await loadPersistedAuthStorage({
		read: readGrant,
		write: writeGrant,
	}),
});

if (import.meta.hot) {
	import.meta.hot.dispose(() => auth[Symbol.dispose]());
}
