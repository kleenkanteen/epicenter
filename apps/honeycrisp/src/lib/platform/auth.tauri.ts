import { createWebStoragePersistedAuthStorage } from '@epicenter/auth';
import {
	EPICENTER_HONEYCRISP_OAUTH_CLIENT_ID,
	EPICENTER_HONEYCRISP_TAURI_OAUTH_REDIRECT_URI,
} from '@epicenter/constants/oauth-clients';
import { APP_URLS } from '@epicenter/constants/vite';
import { createHostedDeepLinkAuth } from '@epicenter/svelte/auth/tauri';
import { instanceSetting } from '$lib/instance';
import type { PlatformAuth } from './types';

export const auth: PlatformAuth = createHostedDeepLinkAuth({
	instanceSetting,
	clientId: EPICENTER_HONEYCRISP_OAUTH_CLIENT_ID,
	redirectUri: EPICENTER_HONEYCRISP_TAURI_OAUTH_REDIRECT_URI,
	api: APP_URLS.API,
	// Carried over unchanged: the grant lives in localStorage until Honeycrisp
	// grows a credential-backed store (Whispering's OS keyring is the
	// reference). Moving it is a product/security decision, not cleanup.
	persistedAuthStorage: createWebStoragePersistedAuthStorage({
		key: 'honeycrisp.auth.persisted',
		storage: window.localStorage,
	}),
});

if (import.meta.hot) {
	import.meta.hot.dispose(() => auth[Symbol.dispose]());
}
