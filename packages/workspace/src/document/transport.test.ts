/**
 * Sync Transport URL Tests
 *
 * Verifies cloud sync URL construction for the rooms WebSocket endpoint.
 *
 * Key behaviors:
 * - Single URL form: `/api/rooms/<guid>` in every deployment.
 * - `guid` is `encodeURIComponent`-encoded.
 * - Trailing slashes on `baseURL` are stripped.
 * - `http` origins become `ws`; `https` origins become `wss`.
 * - `nodeId` is appended as a query parameter.
 */

import { describe, expect, test } from 'bun:test';
import { asNodeId } from './node-id.js';
import { roomWsUrl } from './transport.js';

describe('roomWsUrl', () => {
	test('builds the public room URL without a principal path segment', () => {
		expect(
			roomWsUrl({
				baseURL: 'https://api.example.com',
				guid: 'epicenter-fuji',
				nodeId: asNodeId('client-1'),
			}),
		).toBe(
			'wss://api.example.com/api/rooms/epicenter-fuji?nodeId=client-1',
		);
	});

	test('encodes the guid and strips trailing slashes', () => {
		expect(
			roomWsUrl({
				baseURL: 'https://api.example.com/',
				guid: 'a/b?c#d',
				nodeId: asNodeId('client-1'),
			}),
		).toBe(
			'wss://api.example.com/api/rooms/a%2Fb%3Fc%23d?nodeId=client-1',
		);
	});

	test('converts http origins to ws and https origins to wss', () => {
		expect(
			roomWsUrl({
				baseURL: 'http://localhost:8787',
				guid: 'epicenter-fuji',
				nodeId: asNodeId('client-1'),
			}),
		).toBe(
			'ws://localhost:8787/api/rooms/epicenter-fuji?nodeId=client-1',
		);
	});
});
