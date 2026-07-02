import { attachIndexedDb } from '@epicenter/workspace';
import * as Y from 'yjs';

/**
 * Delete one bare (unowned) local IndexedDB database by doc guid.
 *
 * Bare docs name their database after the guid itself
 * (`attachIndexedDb` default), so the guid is the handle. The throwaway doc
 * is destroyed before the delete so the provider's connection never races
 * the deletion.
 */
export async function clearBareDoc(guid: string): Promise<void> {
	const doc = new Y.Doc({ guid });
	const idb = attachIndexedDb(doc);
	doc.destroy();
	await idb.whenDisposed;
	await idb.clearLocal();
}
