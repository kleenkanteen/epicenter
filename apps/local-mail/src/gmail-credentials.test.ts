import { expect, test } from 'bun:test';
import {
	availableGmailEnvironments,
	resolveGmailCredentials,
	selectGmailEnvironment,
} from './gmail-credentials.ts';

/**
 * The Gmail credential resolver and the connect-time environment chooser
 * (ADR-0108). Every case injects a `read` source instead of touching
 * `process.env`, so the tests are hermetic and order-independent.
 */

/** Read from a fixed map instead of process.env. */
const readFrom =
	(map: Record<string, string>) =>
	(name: string): string | undefined =>
		map[name];

const DEV = {
	GMAIL_DEV_CLIENT_ID: 'dev-id',
	GMAIL_DEV_CLIENT_SECRET: 'dev-secret',
};
const PROD = {
	GMAIL_PROD_CLIENT_ID: 'prod-id',
	GMAIL_PROD_CLIENT_SECRET: 'prod-secret',
};

test('resolveGmailCredentials reads the environment-qualified keyset', () => {
	expect(resolveGmailCredentials('dev', readFrom({ ...DEV, ...PROD }))).toEqual(
		{
			clientId: 'dev-id',
			clientSecret: 'dev-secret',
		},
	);
	expect(
		resolveGmailCredentials('prod', readFrom({ ...DEV, ...PROD })),
	).toEqual({
		clientId: 'prod-id',
		clientSecret: 'prod-secret',
	});
});

test('availableGmailEnvironments reports only the fully-present keysets', () => {
	expect(availableGmailEnvironments(readFrom(DEV))).toEqual(['dev']);
	expect(availableGmailEnvironments(readFrom({ ...DEV, ...PROD }))).toEqual([
		'dev',
		'prod',
	]);
	// A half-present keyset (id but no secret) does not count as available.
	expect(
		availableGmailEnvironments(readFrom({ GMAIL_DEV_CLIENT_ID: 'dev-id' })),
	).toEqual([]);
});

test('selectGmailEnvironment infers the sole present environment', () => {
	const { data, error } = selectGmailEnvironment(undefined, readFrom(DEV));
	expect(error).toBeNull();
	expect(data).toBe('dev');
});

test('selectGmailEnvironment requires the flag when both keysets are present', () => {
	const { data, error } = selectGmailEnvironment(
		undefined,
		readFrom({ ...DEV, ...PROD }),
	);
	expect(data).toBeNull();
	expect(error?.message).toContain('--gmail-env');
});

test('selectGmailEnvironment honors an explicit choice that is present', () => {
	const { data, error } = selectGmailEnvironment(
		'prod',
		readFrom({ ...DEV, ...PROD }),
	);
	expect(error).toBeNull();
	expect(data).toBe('prod');
});

test('selectGmailEnvironment names the missing vars for an absent explicit choice', () => {
	const { data, error } = selectGmailEnvironment('prod', readFrom(DEV));
	expect(data).toBeNull();
	expect(error?.message).toContain('GMAIL_PROD_CLIENT_ID');
});

test('selectGmailEnvironment fails when no keyset is present', () => {
	const { data, error } = selectGmailEnvironment(undefined, readFrom({}));
	expect(data).toBeNull();
	expect(error?.message).toContain('GMAIL_DEV_CLIENT_ID');
});
