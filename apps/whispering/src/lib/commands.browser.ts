import type { SatisfiedCommand } from '$lib/commands';

/**
 * Browser builds contribute no extra commands. The recipe picker is
 * desktop-only: it captures the selection in another app via a simulated system
 * copy, which a browser tab cannot do. The cross-platform `Run recipe on
 * clipboard` command covers the web recipe path. See `commands.tauri.ts` for the
 * desktop addition.
 */
export const platformCommands = [] as const satisfies SatisfiedCommand[];
