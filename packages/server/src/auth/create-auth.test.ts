/**
 * Auth Provider Configuration Tests
 *
 * Verifies the cloud auth provider registry that feeds Better Auth social
 * provider registration.
 *
 * Key behaviors:
 * - Google, GitHub, and Apple register when their full credential set is present
 * - Partially configured providers are omitted
 * - No other social provider is part of the hosted provider registry
 */

import { expect, test } from 'bun:test';
import { type CloudAuthBindings, configuredProviders } from './create-auth.js';

const BASE_ENV = {
	BETTER_AUTH_SECRET: 'test-secret',
} satisfies CloudAuthBindings;

test('configuredProviders registers Google, GitHub, and Apple when credentials are present', () => {
	const providers = configuredProviders({
		...BASE_ENV,
		GOOGLE_CLIENT_ID: 'google-id',
		GOOGLE_CLIENT_SECRET: 'google-secret',
		GITHUB_CLIENT_ID: 'github-id',
		GITHUB_CLIENT_SECRET: 'github-secret',
		APPLE_CLIENT_ID: 'apple-id',
		APPLE_TEAM_ID: 'apple-team-id',
		APPLE_KEY_ID: 'apple-key-id',
		APPLE_PRIVATE_KEY: 'apple-private-key',
	});

	expect(providers).toEqual({
		google: { clientId: 'google-id', clientSecret: 'google-secret' },
		github: { clientId: 'github-id', clientSecret: 'github-secret' },
		apple: {
			clientId: 'apple-id',
			teamId: 'apple-team-id',
			keyId: 'apple-key-id',
			privateKey: 'apple-private-key',
		},
	});
	expect(Object.keys(providers)).toEqual(['google', 'github', 'apple']);
});

test('configuredProviders omits providers with incomplete credentials', () => {
	const providers = configuredProviders({
		...BASE_ENV,
		GOOGLE_CLIENT_ID: 'google-id',
		GITHUB_CLIENT_SECRET: 'github-secret',
		APPLE_CLIENT_ID: 'apple-id',
		APPLE_TEAM_ID: 'apple-team-id',
		APPLE_KEY_ID: 'apple-key-id',
	});

	expect(providers).toEqual({
		google: null,
		github: null,
		apple: null,
	});
});
