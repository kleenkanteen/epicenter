/**
 * Tauri runtime client for Whispering. Consumed everywhere through the
 * `#platform/whispering` seam; see `whispering.active.ts` for what
 * `openWhisperingBrowser` builds. The desktop default transcription service is
 * the on-device local GGUF provider.
 */

import { createNodeId } from '@epicenter/workspace';
import { auth } from '#platform/auth';
import { openWhisperingBrowser } from './whispering.active';

const nodeId = createNodeId({ storage: window.localStorage });

export const whispering = openWhisperingBrowser({
	auth,
	nodeId,
	defaultTranscriptionService: 'local',
});
