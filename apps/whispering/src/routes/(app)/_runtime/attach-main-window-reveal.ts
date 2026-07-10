import type { UnlistenFn } from '@tauri-apps/api/event';
import { tauri } from '#platform/tauri';
import { goto } from '$app/navigation';
import { normalizeWhisperingPath } from '$lib/constants/urls';
import { revealMainWindow } from '$lib/main-window';

/**
 * Bring the main window to the front when an auxiliary window asks for it (the
 * recording overlay pill). Reveals first (show + unminimize + focus) so a
 * minimized main window actually
 * surfaces, then routes if the request carried a path. Desktop only.
 */
export function attachMainWindowReveal() {
	const desktop = tauri;
	if (!desktop) return () => {};

	let unlisten: UnlistenFn | undefined;
	let destroyed = false;

	void revealMainWindow
		.listen(async ({ payload }) => {
			await desktop.mainWindow.reveal();
			if (payload.path) await goto(normalizeWhisperingPath(payload.path));
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
