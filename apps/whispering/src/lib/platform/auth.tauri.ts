import {
	EPICENTER_WHISPERING_OAUTH_CLIENT_ID,
	EPICENTER_WHISPERING_TAURI_OAUTH_REDIRECT_URI,
} from '@epicenter/constants/oauth-clients';
import { APP_URLS } from '@epicenter/constants/vite';
import { createHostedDeepLinkAuth } from '@epicenter/svelte/auth/tauri';
import { instanceSetting } from '$lib/instance';
import type { PlatformAuth } from './types';

export const auth: PlatformAuth = createHostedDeepLinkAuth({
	instanceSetting,
	namespace: 'whispering',
	clientId: EPICENTER_WHISPERING_OAUTH_CLIENT_ID,
	redirectUri: EPICENTER_WHISPERING_TAURI_OAUTH_REDIRECT_URI,
	api: APP_URLS.API,
});

if (import.meta.hot) {
	import.meta.hot.dispose(() => auth[Symbol.dispose]());
}
