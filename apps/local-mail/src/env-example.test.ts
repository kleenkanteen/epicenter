import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { specToEnvExampleLines } from '@epicenter/constants/provider-credentials';
import { GMAIL_SPEC } from './gmail-credentials.ts';

/**
 * Drift guard for `.env.example` (ADR-0108): the committed file must document
 * exactly the environment-qualified names `GMAIL_SPEC` resolves. `specToEnvExampleLines`
 * builds those names from the same name-builder the resolver reads through, so
 * this test fails the moment the file lists a stale name (the retired unqualified
 * `GMAIL_CLIENT_ID`) or omits a real one.
 */

/** Extract the `NAME=` variable names from `.env.example`-style lines. */
function envNames(lines: string[]): string[] {
	return lines
		.filter((line) => /^[A-Z0-9_]+=/.test(line))
		.map((line) => line.slice(0, line.indexOf('=')));
}

test(".env.example lists exactly GMAIL_SPEC's qualified names", () => {
	const file = readFileSync(
		join(import.meta.dir, '..', '.env.example'),
		'utf8',
	);
	const documented = envNames(file.split('\n'));
	const expected = envNames(specToEnvExampleLines(GMAIL_SPEC));

	expect(expected).toEqual([
		'GMAIL_DEV_CLIENT_ID',
		'GMAIL_DEV_CLIENT_SECRET',
		'GMAIL_PROD_CLIENT_ID',
		'GMAIL_PROD_CLIENT_SECRET',
	]);
	expect([...documented].sort()).toEqual([...expected].sort());
});
