/**
 * Boot-time Whispering client for both platforms (Option A: sync singleton +
 * reload).
 *
 * `toConnection` reads the persisted `auth.state` ONCE at startup
 * (ADR-0088/ADR-0094): signed out projects to `null` (plaintext local doc),
 * signed in / reauth-required projects to the principal's connection (principal doc
 * with relay sync). Construction is synchronous; data still loads async
 * behind `whenReady`. Identity changes are never an in-place swap:
 * `reloadOnPrincipalChange` (same subpath, mounted in the root layout) reloads
 * the page so the next boot re-projects.
 *
 * `openWhisperingBrowser` takes the boot inputs every workspace app passes to
 * its browser opener (`auth`, `nodeId`) and wraps the doc with the one action
 * every platform needs (`recordings_export_markdown`, whose logic is identical
 * on both platforms; see `recordings-markdown-export.ts`). The two platform
 * leaves (`whispering.browser.ts`, `whispering.tauri.ts`) still choose the
 * default transcription service and platform auth seam.
 */

import type { SyncAuthClient } from '@epicenter/auth';
import { toConnection } from '@epicenter/svelte/auth';
import type { NodeId } from '@epicenter/workspace';
import { defineActions, satisfiesWorkspace } from '@epicenter/workspace';
import type { TranscriptionServiceId } from '$lib/services/transcription/providers';
import { defineWhispering } from '$lib/workspace';
import { defineRecordingsMarkdownExport } from './recordings-markdown-export';

export function openWhisperingBrowser({
	auth,
	nodeId,
	defaultTranscriptionService,
}: {
	auth: SyncAuthClient;
	nodeId: NodeId;
	defaultTranscriptionService: TranscriptionServiceId;
}) {
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
		whenReady: bundle.storage.whenLoaded,
	});
}
