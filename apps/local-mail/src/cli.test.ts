/**
 * Local Mail CLI Parser Tests
 *
 * Covers parse-time argument validation that protects command handlers from
 * ambiguous or unsafe flag values.
 *
 * Key behaviors:
 * - `--watch` accepts only positive millisecond values
 * - invalid watch intervals fail before the sync loop can start polling
 */

import { expect, test } from 'bun:test';
import { parseArgs } from './cli.ts';

test('--watch rejects unit-suffixed intervals', () => {
	expect(() => parseArgs(['sync', '--watch=30s'])).toThrow(
		'Invalid --watch interval "30s"',
	);
});

test('--watch rejects zero milliseconds', () => {
	expect(() => parseArgs(['sync', '--watch=0'])).toThrow(
		'Invalid --watch interval "0"',
	);
});
