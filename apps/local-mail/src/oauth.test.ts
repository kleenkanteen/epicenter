/**
 * Gmail OAuth Connect Flow Tests
 *
 * Exercises the interactive authorization-code + PKCE path without opening a
 * browser: the test captures the generated consent URL, sends the loopback
 * callback by hand, and serves mock Google token/profile endpoints.
 *
 * Key behaviors:
 * - Consent URL requests gmail.readonly only
 * - Token exchange authenticates the desktop client with HTTP Basic
 * - The connected Gmail profile supplies the token-store account key
 */

import { expect, test } from 'bun:test';
import { Buffer } from 'node:buffer';
import type { AppConfig } from './config.ts';
import { runAuthorizationFlow } from './oauth.ts';

function config(overrides: Partial<AppConfig>): AppConfig {
	return {
		dataDir: '/tmp/local-mail-oauth-test',
		clientId: 'client-id-123',
		clientSecret: 'client-secret-456',
		apiBase: 'http://127.0.0.1:0',
		authorizeUrl: 'http://127.0.0.1:0/auth',
		tokenUrl: 'http://127.0.0.1:0/token',
		historySafeWindowDays: 5,
		fullBackstopDays: 30,
		pageSize: 100,
		credentialsPath: '/tmp/local-mail-oauth-test/credentials.json',
		account: null,
		...overrides,
	};
}

async function waitFor<T>(read: () => T | null): Promise<T> {
	for (let i = 0; i < 100; i += 1) {
		const value = read();
		if (value !== null) return value;
		await Bun.sleep(5);
	}
	throw new Error('timed out waiting for test value');
}

test('runAuthorizationFlow exchanges a PKCE callback and stores the connected Gmail account', async () => {
	const tokenRequests: URLSearchParams[] = [];
	const tokenAuthHeaders: string[] = [];
	const tokenServer = Bun.serve({
		hostname: '127.0.0.1',
		port: 0,
		async fetch(request) {
			const body = await request.text();
			tokenRequests.push(new URLSearchParams(body));
			tokenAuthHeaders.push(request.headers.get('authorization') ?? '');
			return Response.json(
				{
					token_type: 'Bearer',
					access_token: 'access-token-123',
					refresh_token: 'refresh-token-123',
					expires_in: 3600,
				},
				{ headers: { 'content-type': 'application/json' } },
			);
		},
	});
	const apiServer = Bun.serve({
		hostname: '127.0.0.1',
		port: 0,
		fetch(request) {
			expect(request.headers.get('authorization')).toBe(
				'Bearer access-token-123',
			);
			return Response.json({
				historyId: '1000',
				emailAddress: 'you@example.com',
			});
		},
	});

	let authorizeUrl: string | null = null;
	const flow = runAuthorizationFlow(
		config({
			apiBase: `http://127.0.0.1:${apiServer.port}`,
			authorizeUrl: `http://127.0.0.1:${tokenServer.port}/auth`,
			tokenUrl: `http://127.0.0.1:${tokenServer.port}/token`,
		}),
		{
			now: () => Date.parse('2026-07-01T00:00:00.000Z'),
			openBrowser: (url) => {
				authorizeUrl = url;
			},
			timeoutMs: 5000,
		},
	);

	const url = new URL(await waitFor(() => authorizeUrl));
	expect(url.searchParams.get('scope')).toBe(
		'https://www.googleapis.com/auth/gmail.readonly',
	);
	expect(url.searchParams.get('code_challenge_method')).toBe('S256');
	expect(url.searchParams.get('access_type')).toBe('offline');

	const redirectUri = url.searchParams.get('redirect_uri');
	const state = url.searchParams.get('state');
	expect(redirectUri).not.toBeNull();
	expect(state).not.toBeNull();
	await fetch(`${redirectUri}?code=auth-code-123&state=${state}`);

	const { data: token, error } = await flow;
	expect(error).toBeNull();
	expect(token?.accountEmail).toBe('you@example.com');
	expect(token?.refreshToken).toBe('refresh-token-123');
	expect(token?.clientIdUsed).toBe('client-id-123');

	const request = tokenRequests[0];
	expect(request?.get('grant_type')).toBe('authorization_code');
	expect(request?.get('client_secret')).toBeNull();
	expect(
		Buffer.from(tokenAuthHeaders[0]?.replace('Basic ', '') ?? '', 'base64').toString(),
	).toBe(
		'client%2Did%2D123:client%2Dsecret%2D456',
	);
	expect(request?.get('code_verifier')).toBeTruthy();

	tokenServer.stop(true);
	apiServer.stop(true);
});
