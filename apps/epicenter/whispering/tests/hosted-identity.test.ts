/**
 * Hosted SPA identity tests.
 *
 * Whispering is now a feature SPA inside Epicenter. It keeps its application
 * routes and platform adapters, but it does not own a second native bundle or
 * a second macOS identity.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	normalizeWhisperingPath,
	whisperingPath,
} from '../src/lib/constants/urls';

const ROOT = join(import.meta.dir, '..');
const read = (name: string) => readFileSync(join(ROOT, name), 'utf8');

describe('Epicenter-hosted Whispering identity', () => {
	test('the nested package is an SPA, not a second Tauri application', () => {
		expect(existsSync(join(ROOT, 'src-tauri'))).toBe(false);
		expect(JSON.parse(read('package.json')).name).toBe(
			'@epicenter/epicenter-whispering',
		);
	});

	test('the SPA is built and routed below its Epicenter base', () => {
		const config = read('svelte.config.js');
		expect(config).toContain("pages: '../dist/whispering'");
		expect(config).toContain("paths: { base: '/apps/whispering' }");
		expect(whisperingPath('/')).toBe('/apps/whispering/');
		expect(whisperingPath('/recording-overlay')).toBe(
			'/apps/whispering/recording-overlay',
		);
		expect(normalizeWhisperingPath('/settings')).toBe(
			'/apps/whispering/settings',
		);
		expect(normalizeWhisperingPath('/apps/whispering/recordings')).toBe(
			'/apps/whispering/recordings',
		);
	});

	test('the copied SPA no longer documents the retired native identifier', () => {
		expect(read('src/lib/services/fs-paths.ts')).not.toContain(
			'so.epicenter.whispering',
		);
		expect(read('src/lib/services/fs-paths.ts')).toContain('so.epicenter.app');
	});
});
