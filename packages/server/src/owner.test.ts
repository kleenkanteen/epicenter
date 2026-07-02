/**
 * Owner derivations: every durable string for per-user and instance topologies.
 *
 * The point of these tests is to pin the wire formats. If any of these
 * strings change, every existing DO, R2 object, and owner-scoped local
 * database keyed on the old shape becomes orphaned. They are contracts.
 *
 * Per-user and instance topologies share the same shape; in the per-user topology
 * `ownerId` is the signed-in user's id, on an instance it is the literal
 * `'instance'`.
 */

import { describe, expect, test } from 'bun:test';
import { asOwnerId, INSTANCE_OWNER_ID } from '@epicenter/identity';
import { doName } from './owner.js';

const userOwner = asOwnerId('abc');
const instance = INSTANCE_OWNER_ID;

describe('doName', () => {
	test('per-user partitions DO names under the user', () => {
		expect(doName(userOwner, 'r123')).toBe('owners/abc/rooms/r123');
	});
	test('instance partitions DO names under the literal instance owner', () => {
		expect(doName(instance, 'r123')).toBe('owners/instance/rooms/r123');
	});
});
