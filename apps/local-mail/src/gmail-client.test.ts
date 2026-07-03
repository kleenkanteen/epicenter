/**
 * Gmail Client Tests
 *
 * Verifies the HTTP boundary for the Gmail REST client. These tests pin the
 * request method/body behavior that fakes in sync and modify tests do not
 * exercise.
 *
 * Key behaviors:
 * - messages.modify sends POST with the add/remove label body
 * - Slim Gmail Message responses validate successfully
 */

import { expect, test } from 'bun:test';
import { Ok } from 'wellcrafted/result';
import type { AppConfig } from './config.ts';
import { createGmailClient } from './gmail-client.ts';
import type { TokenManager } from './token-manager.ts';

const config: AppConfig = {
	dataDir: '/tmp/local-mail-gmail-client-test',
	clientId: 'test-client',
	clientSecret: 'test-secret',
	apiBase: 'http://127.0.0.1:0',
	authorizeUrl: 'http://127.0.0.1:0/auth',
	tokenUrl: 'http://127.0.0.1:0/token',
	historySafeWindowDays: 5,
	fullBackstopDays: 30,
	pageSize: 100,
	credentialsPath: '/tmp/local-mail-gmail-client-test/credentials.json',
	account: null,
	readOnly: false,
};

const tokens: TokenManager = {
	async getValidAccessToken() {
		return Ok('access-token-123');
	},
	async forceRefresh() {
		return Ok('access-token-123');
	},
};

test('modifyMessage sends POST body and accepts a slim message response', async () => {
	const requests: {
		method: string;
		pathname: string;
		body: unknown;
		authorization: string | null;
		accept: string | null;
		contentType: string | null;
	}[] = [];
	const server = Bun.serve({
		hostname: '127.0.0.1',
		port: 0,
		async fetch(request) {
			const url = new URL(request.url);
			requests.push({
				method: request.method,
				pathname: url.pathname,
				body: await request.json(),
				authorization: request.headers.get('authorization'),
				accept: request.headers.get('accept'),
				contentType: request.headers.get('content-type'),
			});
			return Response.json({
				id: 'm1',
				threadId: 't-m1',
				labelIds: ['INBOX', 'Label_1'],
			});
		},
	});

	try {
		const client = createGmailClient({
			config: { ...config, apiBase: `http://127.0.0.1:${server.port}` },
			tokens,
		});

		const result = await client.modifyMessage('m1', {
			addLabelIds: ['Label_1'],
			removeLabelIds: ['UNREAD'],
		});

		expect(result.error).toBeNull();
		expect(result.data).toEqual({
			id: 'm1',
			threadId: 't-m1',
			labelIds: ['INBOX', 'Label_1'],
		});
		expect(requests).toEqual([
			{
				method: 'POST',
				pathname: '/gmail/v1/users/me/messages/m1/modify',
				body: {
					addLabelIds: ['Label_1'],
					removeLabelIds: ['UNREAD'],
				},
				authorization: 'Bearer access-token-123',
				accept: 'application/json',
				contentType: 'application/json',
			},
		]);
	} finally {
		server.stop(true);
	}
});
