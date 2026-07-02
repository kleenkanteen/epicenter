import type { SyncAuthClient } from '@epicenter/auth';
import type { SignedIn } from './session.svelte.js';

/**
 * Project a signed-in auth snapshot into the `SignedIn` payload workspace
 * connectors consume (`model.connect({ ...projectSignedIn(auth), nodeId })`).
 *
 * `server`/`baseURL` are constant across auth states (one API per client).
 * This is the same projection `createSession` does internally; exposed as a
 * plain function on purpose, because `createSession`'s live reactive swap
 * fights reload-on-auth. Throws while signed out: the boot branch checks
 * `auth.state.status` first.
 */
export function projectSignedIn(auth: SyncAuthClient): SignedIn {
	const state = auth.state;
	if (state.status === 'signed-out') {
		throw new Error('[auth] projectSignedIn() called while signed-out.');
	}
	const baseURL = auth.baseURL;
	return {
		server: new URL(baseURL).host,
		baseURL,
		ownerId: state.ownerId,
		openWebSocket: auth.openWebSocket,
		onReconnectSignal: auth.onStateChange,
	};
}
