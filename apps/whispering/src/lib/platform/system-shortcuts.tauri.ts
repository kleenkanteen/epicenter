import { extractErrorMessage } from 'wellcrafted/error';
import { Err, tryAsync } from 'wellcrafted/result';
import { type Command, commands } from '$lib/commands';
import {
	DEFAULT_GLOBAL_BINDINGS,
	deviceConfig,
} from '$lib/state/device-config.svelte';
import { type ChordRegistration, tauriOnly } from '$lib/tauri.tauri';
import {
	bindingsOverlap,
	isEmptyBinding,
	isRegistrableChord,
	type KeyBinding,
	keyBindingToAccelerator,
} from '$lib/utils/key-binding';
import { validateGlobalBinding } from '$lib/utils/reserved-shortcuts';
import { createShortcuts } from './shortcuts.shared';
import type { Shortcuts } from './types';

/**
 * Tauri build of `#platform/system-shortcuts`: system-global chords driven by
 * tauri-plugin-global-shortcut, stored in device-config under
 * `shortcuts.global.*` (never synced across devices). The default bindings live
 * in `DEFAULT_GLOBAL_BINDINGS` because they double as the device-config schema
 * defaults.
 *
 * The reach router (`shortcuts.ts`) composes this with the universal
 * `focusedShortcuts`; the web build of this seam supplies `null` (no system
 * backend), which is how the router caps web at focused reach. See ADR-0052.
 */

const globalKey = (id: Command['id']) => `shortcuts.global.${id}` as const;

/**
 * Device-config validates `keys` structurally as `string[]`, so this read is the
 * boundary that narrows the stored value to `KeyBinding`. The registrability
 * check below rejects any key string the plugin vocabulary cannot spell.
 *
 * A stale persisted binding that is not a registrable plugin chord (a
 * pre-ADR-0117 Fn or modifier-only hold) is sanitized to `null`: it no longer
 * registers, so it reads as unset instead of surfacing "Works everywhere" for a
 * dead gesture or being silently skipped at push time.
 */
function readBinding(id: Command['id']): KeyBinding | null {
	const stored = (deviceConfig.get(globalKey(id)) as KeyBinding | null) ?? null;
	if (stored === null || isEmptyBinding(stored)) return null;
	return isRegistrableChord(stored) ? stored : null;
}

export const systemShortcuts: Shortcuts | null = createShortcuts({
	read: readBinding,
	getDefault: (id) => DEFAULT_GLOBAL_BINDINGS[id] ?? null,
	write: (id, binding) => deviceConfig.set(globalKey(id), binding),
	// tauri-plugin-global-shortcut registers complete chords, so a gesture that
	// contains (or is contained by) another would shadow it or be unreachable.
	// Refuse reserved gestures and overlaps, naming the collision.
	findConflict: (id, binding) => {
		const reserved = validateGlobalBinding(binding);
		if (reserved) return { kind: 'reserved', reason: reserved };
		for (const command of commands) {
			if (command.id === id) continue;
			const other = readBinding(command.id);
			if (other && !isEmptyBinding(other) && bindingsOverlap(other, binding)) {
				return { kind: 'overlap', commandId: command.id, binding: other };
			}
		}
		return null;
	},
	syncErrorTitle: 'Error registering global shortcuts',
	async push(entries) {
		const chords: ChordRegistration[] = [];
		for (const entry of entries) {
			if (entry.binding === null) continue;
			const accelerator = keyBindingToAccelerator(entry.binding as KeyBinding);
			if (accelerator === null) continue;
			chords.push({ commandId: entry.command.id, accelerator });
		}
		// A plugin registration the OS rejects (a chord another app holds) fails
		// the whole replace-all; surface it instead of partially binding.
		const { error } = await tryAsync({
			try: async () => {
				await tauriOnly.keyboard.registerChords(chords);
			},
			catch: (cause) =>
				Err({
					name: 'GlobalShortcutRegistrationFailed',
					message: extractErrorMessage(cause),
				}),
		});
		return error ?? null;
	},
});
