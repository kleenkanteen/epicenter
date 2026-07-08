/**
 * Node and Bun-only workspace APIs.
 *
 * Keep these exports out of the root `@epicenter/workspace` barrel so browser
 * bundles do not traverse modules that import `node:*` or `bun:*`.
 */

export { findEpicenterRoot } from './client/find-epicenter-root.js';
export { DEFAULT_EPICENTER_CONFIG_SOURCE } from './config/epicenter-config-source.js';
export { EpicenterConfigError } from './config/load-epicenter-config.js';
export {
	type InactiveMount,
	type OpenEpicenterRootOptions,
	type OpenedMount,
	openEpicenterRoot,
	WorkspaceAppError,
	type WorkspaceAuthClient,
} from './config/open-epicenter-root.js';
export {
	type AttachMountInfrastructureOptions,
	attachMountInfrastructure,
} from './daemon/attach-mount-infrastructure.js';
export {
	defineMount,
	defineSessionMount,
	inactive,
	isInactive,
	type Mount,
	type MountContext,
	type MountInactive,
	type MountSession,
	type SessionMountContext,
} from './daemon/define-mount.js';
export {
	claimDaemonLease,
	type DaemonLease,
} from './daemon/lease.js';
export {
	type DaemonMetadata,
	enumerateDaemons,
	readMetadata,
	unlinkMetadata,
	writeMetadata,
} from './daemon/metadata.js';
export {
	attachMountMarkdown,
	attachMountSqlite,
	type MarkdownMountOptions,
	type NodeMountRuntime,
	nodeMountRuntime,
	type SqliteMountOptions,
} from './daemon/mount-runtime.js';
export {
	dirHash,
	leasePathFor,
	logPathFor,
	metadataPathFor,
} from './daemon/paths.js';
export { sweepDaemonRuntimeFiles } from './daemon/runtime-files.js';
export { StartupError } from './daemon/startup-errors.js';
export type { DaemonRuntime, StartedMount } from './daemon/types.js';
export {
	attachYjsLog,
	type YjsLogAttachment,
} from './document/attach-yjs-log.js';
export {
	attachYjsLogReader,
	type YjsLogReaderAttachment,
} from './document/attach-yjs-log-reader.js';
export {
	type BunLocalPersistenceOptions,
	bunLocalPersistence,
} from './document/bun-local-persistence.js';
export {
	type OpenSqliteReaderOptions,
	openSqliteReader,
	type SqliteReader,
} from './document/open-sqlite-reader.js';
export { openWorkspaceSqlite } from './document/open-workspace-sqlite.js';
export {
	markdownPath,
	sqlitePath,
	yjsPath,
} from './document/workspace-paths.js';
export { hashYDocClientId } from './shared/client-id.js';
export type { EpicenterRoot } from './shared/types.js';
