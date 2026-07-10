import type { UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
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
	const unlisteners: UnlistenFn[] = [];
	let destroyed = false;
	const trackUnlistener = (unlisten: UnlistenFn) => {
		if (destroyed) unlisten();
		else unlisteners.push(unlisten);
	};

	const overlayStatus = $derived(
		projectLifecycleToStatus(dictationLifecycle.current),
	);

	$effect(() => {
		recordingOverlay.sync(overlayStatus);
	});

	if (tauri) {
		void recordingOverlayAction
			.listen((event) =>
				dispatchPillAction(event.payload),
			)
			.then(trackUnlistener);
		void revealMainWindow
			.listen(async () => {
				const mainWindow = getCurrentWindow();
				await mainWindow.show();
				await mainWindow.unminimize();
				// setFocus often fails on macOS; ignore.
				await mainWindow.setFocus().catch(() => {});
			})
			.then(trackUnlistener);
	}

	return () => {
		destroyed = true;
		for (const unlisten of unlisteners) unlisten();
	};
}
