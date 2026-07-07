import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';

import {
	type DaemonMetadata,
	readMetadata,
	unlinkMetadata,
	writeMetadata,
} from './metadata';
import { metadataPathFor } from './paths';

let originalRuntimeDir: string | undefined;
let runtimeRoot: string;
let workDir: string;

beforeEach(() => {
	originalRuntimeDir = process.env.EPICENTER_RUNTIME_DIR;
	// `/tmp/...` keeps runtime-path tests isolated without touching user state.
	runtimeRoot = mkdtempSync('/tmp/eps-meta-');
	process.env.EPICENTER_RUNTIME_DIR = runtimeRoot;
	mkdirSync(runtimeRoot, { recursive: true });

	workDir = mkdtempSync('/tmp/eps-meta-dir-');
});

afterEach(() => {
	if (originalRuntimeDir === undefined)
		delete process.env.EPICENTER_RUNTIME_DIR;
	else process.env.EPICENTER_RUNTIME_DIR = originalRuntimeDir;
	rmSync(runtimeRoot, { recursive: true, force: true });
	rmSync(workDir, { recursive: true, force: true });
});

const sampleMeta = (
	overrides: Partial<DaemonMetadata> = {},
): DaemonMetadata => ({
	pid: process.pid,
	dir: workDir,
	startedAt: new Date(0).toISOString(),
	cliVersion: '0.0.0-test',
	...overrides,
});

describe('readMetadata / writeMetadata / unlinkMetadata', () => {
	test('round-trips write → read', () => {
		const meta = sampleMeta();
		writeMetadata(workDir, meta);
		expect(readMetadata(workDir)).toEqual(meta);
	});

	test('readMetadata returns null when sidecar absent', () => {
		expect(readMetadata(workDir)).toBeNull();
	});

	test('unlinkMetadata removes the sidecar; second call is a no-op', () => {
		writeMetadata(workDir, sampleMeta());
		expect(existsSync(metadataPathFor(workDir))).toBe(true);
		unlinkMetadata(workDir);
		expect(existsSync(metadataPathFor(workDir))).toBe(false);
		unlinkMetadata(workDir);
	});
});
