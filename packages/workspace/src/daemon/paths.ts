/**
 * Daemon-process path helpers.
 *
 * Per-Epicenter-root runtime files (metadata sidecar and SQLite lease) live
 * under `runtimeDir()` (a per-user directory at `<dataDir>/run/`).
 * Persistent logs live under the env-paths log directory. Every file is
 * keyed by a hash of the daemon's Epicenter root so two daemons on the
 * same machine never collide.
 *
 * For per-workspace data layout (yjs/sqlite/markdown under the Epicenter
 * root's `.epicenter/` subdir), see `document/workspace-paths.ts`. Different
 * audience, different rationale.
 *
 * Pure helpers: no side effects, no directory creation. The `up`
 * command owns the `mkdir`/`chmod` work; consumers here are free to call
 * these from anywhere without worrying about filesystem mutation.
 */

import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import envPaths from 'env-paths';

/**
 * env-paths layout for this app. Honors `XDG_DATA_HOME` / `XDG_STATE_HOME`
 * on Linux; uses `~/Library/Application Support/epicenter` and
 * `~/Library/Logs/epicenter` on macOS. Resolved once at module load.
 */
const PATHS = envPaths('epicenter', { suffix: '' });

const DEFAULT_DATA_DIR = process.env.EPICENTER_DATA_DIR ?? PATHS.data;
const DEFAULT_LOG_DIR = process.env.EPICENTER_LOG_DIR ?? PATHS.log;

/**
 * Per-user directory for daemon metadata, node ids, and lease files.
 *
 * Default: `<dataDir>/run/`, mirroring the systemd/Docker `/run/` convention
 * for transient runtime state.
 *
 * `EPICENTER_RUNTIME_DIR` overrides the default. The env var is a workspace
 * test seam: production users do not set it (the default is correct), but
 * test cases set it to a short `mkdtemp` dir under `/tmp/` to isolate from
 * each other. Read on every call so test mutations between cases take
 * effect without re-importing the module.
 */
export function runtimeDir(): string {
	return process.env.EPICENTER_RUNTIME_DIR ?? join(DEFAULT_DATA_DIR, 'run');
}

/**
 * Stable hash of an absolute, fs-resolved Epicenter root path.
 *
 * Truncated to 16 hex chars (64 bits) so runtime filenames stay compact.
 * Symlinks are resolved via `realpathSync` so two equivalent paths always hash the same.
 * The dir must exist; every production caller hashes a resolved Epicenter root
 * directory that daemon discovery or Epicenter root lookup has already accepted.
 */
export function dirHash(dir: string): string {
	return createHash('sha256')
		.update(realpathSync(dir))
		.digest('hex')
		.slice(0, 16);
}

/** Metadata JSON sidecar for the daemon serving `dir`. */
export function metadataPathFor(dir: string): string {
	return join(runtimeDir(), `${dirHash(dir)}.meta.json`);
}

/** SQLite lease file for the daemon serving `dir`. */
export function leasePathFor(dir: string): string {
	return join(runtimeDir(), `${dirHash(dir)}.lease.sqlite`);
}

/**
 * Log file for the daemon serving `dir`.
 *
 * Always lives under the user log directory (env-paths default,
 * `~/Library/Logs/epicenter` on macOS, `~/.local/state/epicenter` on
 * Linux), so the operator can read post-mortem logs after a crash or
 * reboot. `EPICENTER_LOG_DIR` overrides; read on every call so tests can
 * isolate.
 */
export function logPathFor(dir: string): string {
	return join(
		process.env.EPICENTER_LOG_DIR ?? DEFAULT_LOG_DIR,
		`${dirHash(dir)}.log`,
	);
}

/**
 * Path for the daemon's durable node-id file for the root at `dir`.
 *
 * Hash-keyed the same way as {@link metadataPathFor} and {@link leasePathFor},
 * so two daemons on the same machine get distinct ids and the same daemon always
 * loads the same id on restart. Lives under `runtimeDir()` (machine-local,
 * OUTSIDE the repo tree) so it survives `git clean` and is never accidentally
 * committed.
 *
 * The node id is a public routing label (the relay's `?nodeId=`) and the seed
 * for the Y.Doc CRDT `clientID`, not a secret, so the file is written with the
 * default mode.
 */
export function nodeIdPathFor(dir: string): string {
	return join(runtimeDir(), `${dirHash(dir)}.node-id`);
}
