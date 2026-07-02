/**
 * Honeycrisp browser composition: the one boot branch (ADR-0088).
 *
 * Reads `auth.state` once and picks a preset: `connectLocal()` signed out
 * (bare guid-named IndexedDB, cross-tab channel, no relay) or `connect()`
 * signed in (owner-scoped storage plus relay). Both presets return the same
 * bundle shape, per-row note-body openers and `wipe()` included, so nothing
 * downstream branches on auth again.
 */

import type { SyncAuthClient } from '@epicenter/auth';
import { projectSignedIn } from '@epicenter/svelte/auth';
import type { NodeId } from '@epicenter/workspace';
import { honeycrispWorkspace } from './index.js';

export function openHoneycrispBrowser({
	auth,
	nodeId,
}: {
	auth: SyncAuthClient;
	nodeId: NodeId;
}) {
	return auth.state.status === 'signed-out'
		? honeycrispWorkspace.connectLocal()
		: honeycrispWorkspace.connect({ ...projectSignedIn(auth), nodeId });
}

export type HoneycrispBrowser = ReturnType<typeof openHoneycrispBrowser>;
