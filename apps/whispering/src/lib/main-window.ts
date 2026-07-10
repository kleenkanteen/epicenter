import { defineWindowSignal } from '$lib/window-events';

/** An auxiliary window asking the main Whispering window to come to the front. */
export const revealMainWindow = defineWindowSignal('main-window:reveal');
