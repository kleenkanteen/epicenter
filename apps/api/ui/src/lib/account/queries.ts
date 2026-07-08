/**
 * TanStack Query bindings for the account page.
 *
 * The Better Auth-owned lists (linked accounts, passkeys) come from the Better
 * Auth client ({@link authClient}); the deployment's configured providers and
 * the signed-in profile come from Epicenter's `/sign-in/context` bootstrap
 * (owned by packages/server/src/routes/auth.ts), so the page can never offer a
 * provider the server refuses. `accountKeys.all` namespaces the lists so one
 * invalidate refreshes both after a link/unlink/passkey change.
 *
 * Plain TanStack `queryOptions` (not wellcrafted's `defineQuery`) because the
 * upstream is the Better Auth client's `{ data, error }`, not a wellcrafted
 * `Result`; each `queryFn` throws Better Auth's `error` into TanStack's error
 * channel, so `query.error` carries the `{ message, status }` the UI reads.
 */

import { queryOptions } from '@tanstack/svelte-query';
import { defineKeys } from 'wellcrafted/query';
import { authClient, type LinkedAccount, type Passkey } from '$lib/auth/client';
import type { SignInContext } from '$lib/auth/sign-in-context';

export const accountKeys = defineKeys({
	all: ['account'],
	context: ['account', 'context'],
	linked: ['account', 'linked'],
	passkeys: ['account', 'passkeys'],
});

export const account = {
	context: queryOptions({
		queryKey: accountKeys.context,
		queryFn: async () => {
			const response = await fetch('/sign-in/context', {
				credentials: 'include',
			});
			if (!response.ok) throw new Error('Could not load your account.');
			return (await response.json()) as SignInContext;
		},
	}),

	linked: queryOptions({
		queryKey: accountKeys.linked,
		queryFn: async () => {
			const { data, error } = await authClient.listAccounts();
			if (error) throw error;
			// Better Auth types `createdAt` as Date, but the JSON wire value is a
			// string; the view type reflects the runtime shape.
			return data as unknown as LinkedAccount[];
		},
	}),

	passkeys: queryOptions({
		queryKey: accountKeys.passkeys,
		queryFn: async () => {
			const { data, error } = await authClient.passkey.listUserPasskeys();
			if (error) throw error;
			return data as unknown as Passkey[];
		},
	}),
};
