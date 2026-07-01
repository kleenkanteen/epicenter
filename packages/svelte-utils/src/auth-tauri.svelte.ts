import type { InstanceSetting, SyncAuthClient } from '@epicenter/auth';
import { createWebStoragePersistedAuthStorage } from '@epicenter/auth';
import { createTauriDeepLinkOAuthLauncher } from '@epicenter/auth/oauth-launchers/tauri';
import { createAppAuthClient } from './auth.svelte.js';

/** Options for {@link createHostedDeepLinkAuth}: only what varies per app. */
export type CreateHostedDeepLinkAuthOptions = {
	/** The app's persisted instance setting: hosted default or a self-host token. */
	instanceSetting: InstanceSetting;
	/** Namespace for the persisted-auth storage key (`<namespace>.auth.persisted`). */
	namespace: string;
	/** This app's hosted OAuth client id (used by both the client and the launcher). */
	clientId: string;
	/** This app's registered deep-link callback (e.g. `epicenter-whispering://auth/callback`). */
	redirectUri: string;
	/** The hosted API origin (e.g. `APP_URLS.API`): owns the issuer and the resource. */
	api: string;
};

/**
 * Package the hosted deep-link OAuth convention every Tauri desktop app
 * repeats: a `<namespace>.auth.persisted` grant, a deep-link launcher built
 * from the hosted constants (`${api}/auth` issuer, `api` as the resource),
 * and the persisted `Instance` fed to {@link createAppAuthClient}. Each app
 * passes only what varies: its namespace, OAuth client id, registered
 * redirect URI, and the hosted API origin. The result is a reactive
 * `SyncAuthClient`, ready for `createSession`.
 *
 * Both the grant and the launcher's PKCE transaction live in `localStorage`,
 * never `sessionStorage`: a deep-link callback can cold-start the app, which
 * would drop a `sessionStorage`-held transaction before it completes. This
 * has no override knob because no Tauri app has needed one — the
 * `ADR-0079` sessionStorage swap on the web-build sibling
 * ({@link createHostedBrowserRedirectAuth}) is a browser-only XSS concern
 * that doesn't apply to a native webview.
 *
 * Deep-link-only by construction: it owns no browser-redirect or extension
 * launcher and no self-host token branch. The self-host path still works
 * because `createAppAuthClient` reads it off the passed `instanceSetting` (a
 * token instance ignores the launcher); this factory only builds the
 * deep-link launcher the hosted branch needs. A Tauri app keeps this for its
 * desktop build and uses `createHostedBrowserRedirectAuth` for its web build
 * (ADR-0078).
 *
 * Separate subpath (`@epicenter/svelte/auth/tauri`) from the rest of this
 * package's auth exports: `@tauri-apps/*` are optional peer dependencies, so
 * only a Tauri app's own import graph pulls them in, not every web-only
 * consumer of `@epicenter/svelte/auth`.
 */
export function createHostedDeepLinkAuth({
	instanceSetting,
	namespace,
	clientId,
	redirectUri,
	api,
}: CreateHostedDeepLinkAuthOptions): SyncAuthClient {
	return createAppAuthClient(instanceSetting.read(), {
		clientId,
		persistedAuthStorage: createWebStoragePersistedAuthStorage({
			key: `${namespace}.auth.persisted`,
			storage: window.localStorage,
		}),
		launcher: createTauriDeepLinkOAuthLauncher({
			issuer: `${api}/auth`,
			clientId,
			resource: api,
			redirectUri,
			storage: window.localStorage,
		}),
	});
}
