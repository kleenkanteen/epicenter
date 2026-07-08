import { unlinkMetadata } from './metadata.js';

/** Sweep runtime-dir files that identify a daemon for one Epicenter root. */
export function sweepDaemonRuntimeFiles(epicenterRoot: string): void {
	unlinkMetadata(epicenterRoot);
}
