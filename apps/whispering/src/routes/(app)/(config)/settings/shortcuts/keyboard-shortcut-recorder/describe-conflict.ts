import { type Command, commands } from '$lib/commands';
import type { ShortcutConflict } from '$lib/platform/types';

const titleOf = (id: Command['id']): string =>
	commands.find((command) => command.id === id)?.title ?? id;

/**
 * Render a {@link ShortcutConflict} to the message shown when a recorded key is
 * refused. The one place conflict prose lives: the policy layer (the backends and
 * the reach router) returns structured conflicts, and this turns them into words
 * with the catalog titles it has on hand, so a backend never formats a
 * user-facing string.
 */
export function describeShortcutConflict(conflict: ShortcutConflict): string {
	switch (conflict.kind) {
		case 'reserved':
			return conflict.reason;
		case 'duplicate':
			return `Those keys already trigger "${titleOf(conflict.commandId)}". Pick a different combination.`;
		case 'crossStore':
			return `Those keys are already used by "${titleOf(conflict.commandId)}", which also fires in this window. Pick a different combination.`;
	}
}
