import { describe, expect, test } from 'bun:test';
import { asPrincipalId, INSTANCE_PRINCIPAL_ID } from '@epicenter/identity';
import {
	createPrincipalYjsKey,
	getPrincipalYjsPrefix,
} from './local-yjs-key.js';

const SERVER = 'api.epicenter.so';
const ALICE = asPrincipalId('user-a');
const INSTANCE = INSTANCE_PRINCIPAL_ID;

describe('getPrincipalYjsPrefix', () => {
	test('per-user principal id partitions the prefix under principals/', () => {
		expect(getPrincipalYjsPrefix(SERVER, ALICE)).toBe(
			'epicenter/api.epicenter.so/principals/user-a/',
		);
	});
	test("instance uses the literal 'instance' principal id under the same principals/ partition", () => {
		expect(getPrincipalYjsPrefix(SERVER, INSTANCE)).toBe(
			'epicenter/api.epicenter.so/principals/instance/',
		);
	});
});

describe('createPrincipalYjsKey', () => {
	test('appends the ydoc guid to the partition prefix', () => {
		expect(createPrincipalYjsKey(SERVER, ALICE, 'epicenter-fuji')).toBe(
			'epicenter/api.epicenter.so/principals/user-a/epicenter-fuji',
		);
		expect(createPrincipalYjsKey(SERVER, INSTANCE, 'epicenter-fuji')).toBe(
			'epicenter/api.epicenter.so/principals/instance/epicenter-fuji',
		);
	});
});
