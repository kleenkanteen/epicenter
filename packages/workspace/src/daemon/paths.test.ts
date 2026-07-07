import { describe, expect, test } from 'bun:test';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { dirHash } from './paths.js';

describe('daemon/paths', () => {
	test('dirHash of a relative path equals the hash of its realpath', () => {
		// `tmpdir()` may resolve through a symlink (e.g. /tmp -> /private/tmp on
		// macOS); dirHash should normalize via realpathSync so equivalent inputs
		// hash identically.
		const symlinked = tmpdir();
		const real = realpathSync(symlinked);
		expect(dirHash(symlinked)).toBe(dirHash(real));
	});
});
