/**
 * Vocab browser composition: the one boot call (ADR-0088/ADR-0094).
 *
 * `toConnection` reads `auth.state` once: signed out projects to `null` (bare
 * guid-named IndexedDB, cross-tab channel, no relay), signed in projects to
 * the owner's connection (owner-scoped storage plus relay). Both arms return
 * the same bundle shape, per-conversation message-doc openers and `wipe()`
 * included, so nothing downstream branches on auth again.
 */

import type { SyncAuthClient } from '@epicenter/auth';
import { toConnection } from '@epicenter/svelte/auth';
import type { NodeId } from '@epicenter/workspace';
import { vocabWorkspace } from './vocab.js';

export function openVocabBrowser({
	auth,
	nodeId,
}: {
	auth: SyncAuthClient;
	nodeId: NodeId;
}) {
	return vocabWorkspace.connect(toConnection(auth, nodeId));
}

export type VocabBrowser = ReturnType<typeof openVocabBrowser>;
