/**
 * Tauri runtime client for Whispering. Consumed everywhere through the
 * `#platform/whispering` seam; see `whispering.active.ts` for what
 * `openWhispering` builds. The desktop default transcription service is
 * the on-device local GGUF provider.
 */

import { openWhispering } from './whispering.active';

export const whispering = openWhispering('local');
