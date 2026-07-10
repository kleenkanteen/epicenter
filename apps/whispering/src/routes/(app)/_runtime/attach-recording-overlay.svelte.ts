import type { UnlistenFn } from '@tauri-apps/api/event';
import { recordingOverlay } from '#platform/recording-overlay';
import { tauri } from '#platform/tauri';
import {
	recordingOverlayAction,
	revealMainWindow,
} from '$lib/recording-overlay/events';
import { dispatchPillAction } from '$lib/recording-overlay/pill-actions';
import { projectLifecycleToStatus } from '$lib/recording-overlay/projection';
import { dictationLifecycle } from '$lib/state/dictation-lifecycle.svelte';

export function attachRecordingOverlay() {
	const desktop = tauri;
	const unlisteners: UnlistenFn[] = [];
	let isDestroyed = false;
	const trackUnlistener = (unlisten: UnlistenFn) => {
		if (isDestroyed) unlisten();
		else unlisteners.push(unlisten);
	};

	const overlayStatus = $derived(
		projectLifecycleToStatus(dictationLifecycle.current),
	);

	$effect(() => {
		recordingOverlay.sync(overlayStatus);
	});

	if (desktop) {
		void recordingOverlayAction
			.listen((event) => dispatchPillAction(event.payload))
			.then(trackUnlistener);
		void revealMainWindow
			.listen(async () => {
				await desktop.mainWindow.reveal();
			})
			.then(trackUnlistener);
	}

	return () => {
		isDestroyed = true;
		for (const unlisten of unlisteners) unlisten();
	};
}
