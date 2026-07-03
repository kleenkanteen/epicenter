import { skills } from '$lib/skills/client';
import type { LayoutLoad } from './$types';

export const ssr = false;

/**
 * Gate the first paint on local storage hydration. `SkillsList` reads an empty
 * table until storage loads, so without this the "No skills yet" empty state
 * flashes before the skills load from disk. SvelteKit blocks the route's render
 * until this load resolves; `whenReady` is a single promise, so it resolves once
 * and a reload never re-blocks.
 */
export const load: LayoutLoad = async () => {
	await skills.whenReady;
};
