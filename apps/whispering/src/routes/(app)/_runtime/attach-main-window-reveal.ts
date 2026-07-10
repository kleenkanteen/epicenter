import type { UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { tauri } from '#platform/tauri';
import { revealMainWindow } from '$lib/main-window';

/** Reveal the main window when the non-activating recording panel asks. */
export function attachMainWindowReveal() {
	if (!tauri) return () => {};

	let unlisten: UnlistenFn | undefined;
	let destroyed = false;

	void revealMainWindow
		.listen(async () => {
			const mainWindow = getCurrentWindow();
			await mainWindow.show();
			await mainWindow.unminimize();
			// setFocus often fails on macOS; ignore.
			await mainWindow.setFocus().catch(() => {});
		})
		.then((fn) => {
			if (destroyed) fn();
			else unlisten = fn;
		});

	return () => {
		destroyed = true;
		unlisten?.();
	};
}
