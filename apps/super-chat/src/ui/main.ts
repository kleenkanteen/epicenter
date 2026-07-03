/**
 * SPA boot: pull the per-launch token out of the query string, scrub it from
 * the visible URL, and keep it only in memory. Never write it to
 * localStorage, sessionStorage, or a cookie; storage outlives the launch and
 * hands the token to anything else that ever runs on this origin.
 */

import { mount } from 'svelte';
import App from './App.svelte';

// An empty `?token=` is as useless as a missing one; both show the
// missing-token screen instead of reconnecting into 401s forever.
const token = new URLSearchParams(location.search).get('token') || null;
history.replaceState(null, '', location.pathname);

mount(App, {
	// biome-ignore lint/style/noNonNullAssertion: index.html always ships the mount node.
	target: document.getElementById('app')!,
	props: { token },
});
