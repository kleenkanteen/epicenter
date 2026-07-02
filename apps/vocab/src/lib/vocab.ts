/**
 * Boot-time Vocab client (ADR-0088: sign-in is an enhancement, never a
 * door).
 *
 * `openVocabBrowser` reads the persisted `auth.state` ONCE at startup and
 * wires either bare local IndexedDB (signed out) or principal-scoped storage
 * plus relay sync (signed in / reauth-required), including the
 * per-conversation message child docs. Construction is synchronous; data
 * still loads async behind `whenReady`. Identity changes are never an
 * in-place swap: `reloadOnPrincipalChange` (mounted in the root layout) reloads
 * the page so the next boot re-runs this selection.
 *
 * There is no `require*()` accessor and no HMR dispose block: the workspace
 * is never `null`, so nothing gates on it existing (matches Whispering's
 * `whispering` singleton).
 */

import { openVocabBrowser } from '@epicenter/vocab/browser';
import { createNodeId } from '@epicenter/workspace';
import { auth } from '$platform/auth';

const nodeId = createNodeId({ storage: localStorage });

const browser = openVocabBrowser({ auth, nodeId });

export const vocab = {
	...browser,
	/** Resolves when local persistence has hydrated the root doc. */
	whenReady: browser.idb.whenLoaded,
};
