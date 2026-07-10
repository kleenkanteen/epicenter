import { dictationCapability } from '$lib/state/dictation-capability.svelte';
import { attachAnalytics } from './attach-analytics.svelte';
import { attachAutoPasteIntent } from './attach-auto-paste-intent.svelte';
import { attachDebugCommands } from './attach-debug-commands';
import { attachDictationExceptions } from './attach-dictation-exceptions.svelte';
import { attachLocalShortcutListener } from './attach-local-shortcut-listener.svelte';
import { attachMainWindowReveal } from './attach-main-window-reveal';
import { attachRecordingOverlay } from './attach-recording-overlay.svelte';
import { attachRecordingRetention } from './attach-recording-retention.svelte';
import { attachShortcutSync } from './attach-shortcut-sync';
import { attachSignInMigration } from './attach-sign-in-migration';
import { attachUnloadPolicy } from './attach-unload-policy.svelte';
import type { RuntimeOwner } from './types';

export const runtimeOwners = [
	{ attach: attachDebugCommands },
	{ attach: attachAnalytics },
	{ attach: attachLocalShortcutListener },
	{ attach: attachShortcutSync },
	{ attach: attachRecordingOverlay },
	{ attach: attachDictationExceptions },
	{ attach: attachUnloadPolicy },
	{ attach: attachRecordingRetention },
	{ attach: attachMainWindowReveal },
	{ attach: attachAutoPasteIntent },
	{ attach: dictationCapability.attach },
	{ attach: attachSignInMigration },
] satisfies RuntimeOwner[];
