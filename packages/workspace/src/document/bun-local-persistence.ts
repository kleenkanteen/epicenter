import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { hashYDocClientId } from '../shared/client-id.js';
import { attachYjsLog } from './attach-yjs-log.js';
import type { NodeId } from './node-id.js';
import type { LocalPersistence } from './workspace.js';

export type BunLocalPersistenceOptions = {
	/** Directory that owns this host's local Yjs update logs. */
	readonly dir: string;
	/** Stable node identity for this storage scope. Pins Y.Doc clientID. */
	readonly nodeId?: NodeId;
};

function storageFileName(guid: string): string {
	return `${encodeURIComponent(guid)}.db`;
}

function storageDir(dir: string): string {
	return join(dir, 'yjs');
}

export function bunLocalPersistence({
	dir,
	nodeId,
}: BunLocalPersistenceOptions): LocalPersistence {
	return {
		attach(ydoc) {
			const yjsLog = attachYjsLog(ydoc, {
				filePath: join(storageDir(dir), storageFileName(ydoc.guid)),
			});
			if (nodeId) ydoc.clientID = hashYDocClientId(nodeId);
			return {
				whenLoaded: Promise.resolve(),
				whenDisposed: yjsLog.whenDisposed,
			};
		},
		async wipe(workspaceId) {
			const dirPath = storageDir(dir);
			if (!existsSync(dirPath)) return;
			const rootName = storageFileName(workspaceId);
			const childPrefix = `${encodeURIComponent(`${workspaceId}.`)}`;
			for (const name of readdirSync(dirPath)) {
				if (name === rootName || name.startsWith(childPrefix)) {
					rmSync(join(dirPath, name), { force: true });
					rmSync(join(dirPath, `${name}-wal`), { force: true });
					rmSync(join(dirPath, `${name}-shm`), { force: true });
				}
			}
		},
	};
}
