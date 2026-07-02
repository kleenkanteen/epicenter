/**
 * Boot-time Whispering client for both platforms (Option A: sync singleton +
 * reload).
 *
 * The workspace model presets (ADR-0088) read the persisted `auth.state` ONCE
 * at startup and wire either the plaintext local doc (signed out) or the owner
 * doc with relay sync (signed in / reauth-required). Construction is
 * synchronous; data still loads async behind `whenReady`. Identity changes are
 * never an in-place swap: `reloadOnOwnerChange` (same subpath, mounted in the
 * root layout) reloads the page so the next boot re-runs this selection.
 *
 * `openWhispering` wraps that doc with the one action every platform needs
 * (`recordings_export_markdown` — the logic is identical on both, see
 * `recordings-markdown-export.ts`) and exports the `satisfiesWorkspace`
 * shape. The two platform leaves (`whispering.browser.ts`,
 * `whispering.tauri.ts`) call this with only their default transcription
 * service; the `#platform/whispering` seam still needs two files so the
 * bundler picks the right one, but the two are otherwise identical.
 */

import { projectSignedIn } from '@epicenter/svelte/auth';
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
	type ComposeWorkspace = Pick<
		ReturnType<typeof model.create>,
		'ydoc' | 'kv' | 'tables'
	>;
	const compose = (workspace: ComposeWorkspace) => ({
		actions: defineActions({
			recordings_export_markdown: defineRecordingsMarkdownExport(
				workspace.tables.recordings,
			),
		}),
		settings: model.createSettings(workspace),
	});
	const bundle =
		auth.state.status === 'signed-out'
			? model.connectLocal(compose)
			: model.connect({ ...projectSignedIn(auth), nodeId }, compose);

	return satisfiesWorkspace({
		...bundle,
		whenReady: bundle.idb.whenLoaded,
	});
}
