import { describe, expect, test } from 'bun:test';
import { asPrincipalId, INSTANCE_PRINCIPAL_ID } from '@epicenter/identity';
import { createOwnedYjsKey, getOwnedYjsPrefix } from './local-yjs-key.js';

const SERVER = 'api.epicenter.so';
const ALICE = asPrincipalId('user-a');
const INSTANCE = INSTANCE_PRINCIPAL_ID;

describe('getOwnedYjsPrefix', () => {
	test('per-user owner id partitions the prefix under principals/', () => {
		expect(getOwnedYjsPrefix(SERVER, ALICE)).toBe(
			'epicenter/api.epicenter.so/principals/user-a/',
		);
	});
	test("instance uses the literal 'instance' owner id under the same principals/ partition", () => {
		expect(getOwnedYjsPrefix(SERVER, INSTANCE)).toBe(
			'epicenter/api.epicenter.so/principals/instance/',
		);
	});
});

describe('createOwnedYjsKey', () => {
	test('appends the ydoc guid to the partition prefix', () => {
		expect(createOwnedYjsKey(SERVER, ALICE, 'epicenter-fuji')).toBe(
			'epicenter/api.epicenter.so/principals/user-a/epicenter-fuji',
		);
		expect(createOwnedYjsKey(SERVER, INSTANCE, 'epicenter-fuji')).toBe(
			'epicenter/api.epicenter.so/principals/instance/epicenter-fuji',
		);
	});
});
