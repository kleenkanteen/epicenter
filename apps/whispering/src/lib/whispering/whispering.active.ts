/**
 * Boot-time Whispering client for both platforms (Option A: sync singleton +
 * reload).
 *
 * `toConnection` reads the persisted `auth.state` ONCE at startup
 * (ADR-0088/ADR-0094): signed out projects to `null` (plaintext local doc),
 * signed in / reauth-required projects to the owner's connection (owner doc
 * with relay sync). Construction is synchronous; data still loads async
 * behind `whenReady`. Identity changes are never an in-place swap:
 * `reloadOnOwnerChange` (same subpath, mounted in the root layout) reloads
 * the page so the next boot re-projects.
 *
 * `openWhispering` wraps that doc with the one action every platform needs
 * (`recordings_export_markdown` — the logic is identical on both, see
 * `recordings-markdown-export.ts`) and exports the `satisfiesWorkspace`
 * shape. The two platform leaves (`whispering.browser.ts`,
 * `whispering.tauri.ts`) call this with only their default transcription
 * service; the `#platform/whispering` seam still needs two files so the
 * bundler picks the right one, but the two are otherwise identical.
 */

import { toConnection } from '@epicenter/svelte/auth';
import {
	createNodeId,
	defineActions,
	satisfiesWorkspace,
} from '@epicenter/workspace';
import { auth } from '#platform/auth';
import type { TranscriptionServiceId } from '$lib/services/transcription/providers';
import { defineWhispering } from '$lib/workspace';
import { defineRecordingsMarkdownExport } from './recordings-markdown-export';

/**
 * Stable per-node id for relay room addressing, read synchronously from
 * `localStorage` (the async variant is only for the extension's
 * `chrome.storage`). Shared across Epicenter apps on this origin.
 */
const nodeId = createNodeId({ storage: window.localStorage });

/** Build the `whispering` singleton: the active doc plus the shared recordings-export action. */
export function openWhispering(
	defaultTranscriptionService: TranscriptionServiceId,
) {
	const model = defineWhispering(defaultTranscriptionService);
	const bundle = model.connect(toConnection(auth, nodeId), (workspace) => ({
		actions: defineActions({
			recordings_export_markdown: defineRecordingsMarkdownExport(
				workspace.tables.recordings,
			),
		}),
	}));

	return satisfiesWorkspace({
		...bundle,
		whenReady: bundle.idb.whenLoaded,
	});
}
