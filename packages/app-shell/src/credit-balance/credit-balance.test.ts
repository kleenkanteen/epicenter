/**
 * Credit-balance surface tests.
 *
 * Two things worth pinning: the status rule that decides `ok`/`low`/`out`, and
 * the fetch helper's "no hosted credits here" contract, where any non-200 (a
 * self-host 404, an unauth 401, a fail-closed 503) resolves to `null` rather than
 * an error, while a thrown fetch or an unparseable OK body is a real error.
 */

import { expect, test } from 'bun:test';
import { creditStatus, fetchCreditOverview } from './credit-balance.js';

test('creditStatus: empty wallet is out', () => {
	expect(creditStatus({ remaining: 0, granted: 500, planDisplayName: 'Pro' })).toBe(
		'out',
	);
	expect(
		creditStatus({ remaining: -5, granted: 500, planDisplayName: 'Pro' }),
	).toBe('out');
});

test('creditStatus: low is 10% of the cycle grant', () => {
	expect(
		creditStatus({ remaining: 50, granted: 500, planDisplayName: 'Pro' }),
	).toBe('low');
	expect(
		creditStatus({ remaining: 51, granted: 500, planDisplayName: 'Pro' }),
	).toBe('ok');
});

test('creditStatus: grant-less wallet falls back to an absolute floor', () => {
	// A top-up-only or free wallet with no cycle grant still warns before empty.
	expect(creditStatus({ remaining: 8, granted: 0, planDisplayName: 'Free' })).toBe(
		'low',
	);
	expect(creditStatus({ remaining: 40, granted: 0, planDisplayName: 'Free' })).toBe(
		'ok',
	);
});

test('fetchCreditOverview: parses the overview subset from a 200', async () => {
	const authFetch = async () =>
		new Response(
			JSON.stringify({
				planDisplayName: 'Pro',
				trial: null,
				credits: { remaining: 1234, granted: 5000, monthlyRemaining: 1234 },
				storage: { usedBytes: 0, includedBytes: 0 },
			}),
			{ status: 200, headers: { 'content-type': 'application/json' } },
		);
	const { data, error } = await fetchCreditOverview(authFetch, 'https://api.example');
	expect(error).toBeNull();
	expect(data).toEqual({ remaining: 1234, granted: 5000, planDisplayName: 'Pro' });
});

test('fetchCreditOverview: a non-200 (self-host 404, 401, 503) is null, not an error', async () => {
	for (const status of [404, 401, 503]) {
		const authFetch = async () => new Response('nope', { status });
		const { data, error } = await fetchCreditOverview(
			authFetch,
			'https://api.example',
		);
		expect(error).toBeNull();
		expect(data).toBeNull();
	}
});

test('fetchCreditOverview: a thrown fetch is a RequestFailed error', async () => {
	const authFetch = async () => {
		throw new Error('offline');
	};
	const { data, error } = await fetchCreditOverview(
		authFetch,
		'https://api.example',
	);
	expect(data).toBeNull();
	expect(error?.name).toBe('RequestFailed');
});

test('fetchCreditOverview: resolves the path against the API origin, not the page', async () => {
	let seen: string | undefined;
	const authFetch = async (input: Request | string | URL) => {
		seen = input.toString();
		return new Response(
			JSON.stringify({ planDisplayName: 'Free', credits: { remaining: 0, granted: 0 } }),
			{ status: 200 },
		);
	};
	await fetchCreditOverview(authFetch, 'https://api.epicenter.so');
	expect(seen).toBe('https://api.epicenter.so/api/billing/overview');
});
