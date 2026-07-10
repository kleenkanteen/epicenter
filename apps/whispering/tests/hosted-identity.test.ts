/**
 * Hosted SPA identity tests.
 *
 * Whispering is one SPA with browser and Epicenter build environments. It keeps
 * its application routes and platform adapters, while Epicenter owns the native
 * desktop identity.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	normalizeWhisperingPath,
	whisperingPath,
} from '../src/lib/constants/urls';

const ROOT = join(import.meta.dir, '..');
const read = (name: string) => readFileSync(join(ROOT, name), 'utf8');

describe('Epicenter-hosted Whispering identity', () => {
	test('the canonical package is the independently hostable SPA', () => {
		expect(JSON.parse(read('package.json')).name).toBe('@epicenter/whispering');
	});

	test('the browser and Epicenter builds own distinct base paths and outputs', () => {
		const config = read('svelte.config.js');
		expect(config).toContain("pages: '../epicenter/dist/whispering'");
		expect(config).toContain("paths: { base: '/apps/whispering' }");
		expect(read('src/lib/platform/base-path.browser.ts')).toContain(
			"WHISPERING_BASE_PATHNAME = ''",
		);
		expect(read('src/lib/platform/base-path.tauri.ts')).toContain(
			"WHISPERING_BASE_PATHNAME = '/apps/whispering'",
		);
		expect(whisperingPath('/')).toBe('/');
		expect(whisperingPath('/recording-overlay')).toBe('/recording-overlay');
		expect(normalizeWhisperingPath('/settings')).toBe('/settings');
	});

	test('the canonical SPA no longer documents the retired native identifier', () => {
		expect(read('src/lib/services/fs-paths.ts')).not.toContain(
			'so.epicenter.whispering',
		);
		expect(read('src/lib/services/fs-paths.ts')).toContain('so.epicenter.app');
	});

	test('OAuth callbacks use the unified Epicenter deep-link scheme', () => {
		const auth = read('src/lib/platform/auth.tauri.ts');
		expect(auth).toContain('EPICENTER_DESKTOP_OAUTH_CLIENT_ID');
		expect(auth).toContain('EPICENTER_DESKTOP_TAURI_OAUTH_REDIRECT_URI');
		expect(auth).not.toContain(
			'EPICENTER_WHISPERING_TAURI_OAUTH_REDIRECT_URI',
		);
	});
});
