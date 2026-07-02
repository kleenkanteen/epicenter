/**
 * Honeycrisp's wiring of the shared first-sign-in migration
 * (`@epicenter/app-shell/sign-in-migration`): the local-source opener and the
 * words are app-side; the probe, Add, Delete, Keep, and derived child-doc
 * phases are the kit's.
 */

import { createSignInMigration } from '@epicenter/app-shell/sign-in-migration';
import { attachIndexedDb } from '@epicenter/workspace';
import { auth } from '#platform/auth';
import { honeycrisp } from '$lib/honeycrisp';
import { honeycrispWorkspace } from '$lib/workspace';

/**
 * Open a throwaway handle to the signed-out plaintext local doc (the migration
 * source). This opens the same `epicenter-honeycrisp` IndexedDB the
 * signed-out app uses; the principal doc's storage is partitioned, so this never
 * collides with the active synced doc. `dispose()` tears down the connection
 * without deleting data (`clearLocal` does the deletion).
 */
function openLocalSource() {
	const workspace = honeycrispWorkspace.create();
	const idb = attachIndexedDb(workspace.ydoc);
	return {
		tables: workspace.tables,
		whenLoaded: idb.whenLoaded,
		clearLocal: idb.clearLocal,
		dispose: () => workspace.ydoc.destroy(),
	};
}

/**
 * Human phrase for what is staged locally, e.g. "3 notes", "2 folders", or
 * "3 notes and 2 folders".
 */
function describeLocalContents(counts: Record<string, number>): string {
	const parts: string[] = [];
	const notes = counts.notes ?? 0;
	if (notes > 0) parts.push(`${notes} note${notes === 1 ? '' : 's'}`);
	const folders = counts.folders ?? 0;
	if (folders > 0) parts.push(`${folders} folder${folders === 1 ? '' : 's'}`);
	return parts.length > 0 ? parts.join(' and ') : 'data';
}

export const signInMigration = createSignInMigration({
	auth,
	openLocalSource,
	target: honeycrisp,
	describe: describeLocalContents,
	errorNoun: 'notes',
});
