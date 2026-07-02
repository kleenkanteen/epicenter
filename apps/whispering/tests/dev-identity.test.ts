/**
 * Dev macOS Identity Tests
 *
 * Guards the macOS dev Accessibility identity against silent regression. The
 * dev grant only survives rebuilds while the configs and runner agree on one
 * identifier-only designated requirement, so these tests pin that contract.
 *
 * Key behaviors:
 * - Dev and production keep distinct identifiers.
 * - The dev runner signs ad-hoc with an explicit identifier-only requirement.
 * - Certificate and keychain provisioning do not return.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC_TAURI = join(import.meta.dir, '..', 'src-tauri');
const DEV_IDENTIFIER = 'so.epicenter.whispering.dev';

const readApp = (name: string) =>
	readFileSync(join(import.meta.dir, '..', name), 'utf8');
const read = (name: string) => readFileSync(join(SRC_TAURI, name), 'utf8');
const json = (name: string) => JSON.parse(read(name));

describe('dev macOS identity', () => {
	test('dev config carries the distinct dev identity', () => {
		const dev = json('tauri.dev.conf.json');
		expect(dev.identifier).toBe(DEV_IDENTIFIER);
		expect(dev.productName).toBe('Whispering Dev');
	});

	test('production identity is untouched', () => {
		const prod = json('tauri.conf.json');
		expect(prod.identifier).toBe('so.epicenter.whispering');
		expect(prod.productName).toBe('Whispering');
	});

	test('the codesign runner signs ad-hoc with the same dev identifier', () => {
		const runner = read('scripts/dev-codesign-runner.sh');
		expect(runner).toContain(`DEV_IDENTIFIER="${DEV_IDENTIFIER}"`);
		expect(runner).toContain('--sign -');
	});

	test('the codesign runner embeds an identifier-only designated requirement', () => {
		const runner = read('scripts/dev-codesign-runner.sh');

		expect(runner).toContain(
			'--requirements "=designated => identifier \\"$DEV_IDENTIFIER\\""',
		);
	});

	test('the codesign runner has no cert or keychain provisioning path', () => {
		const runner = read('scripts/dev-codesign-runner.sh');

		expect(runner).not.toContain('WHISPERING_DEV_SIGNING_IDENTITY');
		expect(runner).not.toContain('openssl');
		expect(runner).not.toContain('security import');
		expect(runner).not.toContain('add-trusted-cert');
		expect(runner).not.toContain('find-identity');
	});

	test('the dev doctor verifies the fixed ad-hoc requirement, not keychain state', () => {
		const doctor = readApp('scripts/dev-doctor.ts');

		expect(doctor).toContain('Signature=');
		expect(doctor).toContain('TeamIdentifier=');
		expect(doctor).toContain('designated => identifier');
		expect(doctor).toContain('expected ad-hoc');
		expect(doctor).not.toContain('WHISPERING_DEV_SIGNING_IDENTITY');
		expect(doctor).not.toContain('security');
		expect(doctor).not.toContain('keychain');
		expect(doctor).not.toContain('self-signed');
	});

	test('the macOS dev config wires in the codesign runner', () => {
		const macos = json('tauri.dev.macos.conf.json');
		expect(macos.build.runner.cmd).toBe('./scripts/dev-codesign-runner.sh');
	});
});
