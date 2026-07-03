/**
 * Partition derivations: every durable string for per-user and instance topologies.
 *
 * The point of these tests is to pin the durable namespace target. There is
 * no compatibility exception for the legacy owner-named shape; the clean-break target
 * is principals/ everywhere new durable server state is addressed.
 *
 * Per-user and instance topologies share the same shape; in the per-user topology
 * `principalId` is the signed-in user's id, on an instance it is the literal
 * `'instance'`.
 */

import { describe, expect, test } from 'bun:test';
import { asPrincipalId, INSTANCE_PRINCIPAL_ID } from '@epicenter/identity';
import { blobKey, blobPrincipalPrefix, doName } from './principal.js';

const userPrincipal = asPrincipalId('abc');
const instance = INSTANCE_PRINCIPAL_ID;

describe('doName', () => {
	test('per-user partitions DO names under the user', () => {
		expect(doName(userPrincipal, 'r123')).toBe('principals/abc/rooms/r123');
	});
	test('instance partitions DO names under the literal instance principal', () => {
		expect(doName(instance, 'r123')).toBe('principals/instance/rooms/r123');
	});
});

describe('blobKey', () => {
	test('per-user partitions blob objects under the user', () => {
		expect(blobKey(userPrincipal, 'f'.repeat(64))).toBe(
			`principals/abc/blobs/${'f'.repeat(64)}`,
		);
	});

	test('instance partitions blob objects under the literal instance principal', () => {
		expect(blobKey(instance, 'a'.repeat(64))).toBe(
			`principals/instance/blobs/${'a'.repeat(64)}`,
		);
	});
});

describe('blobPrincipalPrefix', () => {
	test('per-user blob listings keep the principals prefix', () => {
		expect(blobPrincipalPrefix(userPrincipal)).toBe('principals/abc/blobs/');
	});

	test('instance blob listings keep the principals prefix', () => {
		expect(blobPrincipalPrefix(instance)).toBe('principals/instance/blobs/');
	});
});
