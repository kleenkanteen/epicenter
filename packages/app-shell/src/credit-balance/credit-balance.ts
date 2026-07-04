/**
 * The shared hosted-credit surface: one snapshot type, one status rule, and one
 * fetch helper, consumed by every app-shell surface that shows Epicenter AI
 * credits (the account popover today; a picker or transcription surface later).
 *
 * The presentational `<CreditBalance>` in this folder takes a {@link CreditSnapshot}
 * as a prop and never fetches, so the same compact display works from an OAuth
 * app (Whispering, via `auth.fetch`) and from the same-origin dashboard, which
 * resolve the credential differently. The one thing worth sharing about the fetch
 * is the shape and the "no hosted billing here" rule, so {@link fetchCreditOverview}
 * lives here too.
 *
 * Deliberately NOT the dashboard's rich card. Billing plans, usage charts, and
 * checkout stay in `apps/api/ui`; this is only "how many credits, and is that
 * enough to act". Credits are the product unit (ADR-0100): this surface shows
 * credits, never tokens, cents, or provider cost.
 */

import { defineErrors, extractErrorMessage } from 'wellcrafted/error';
import type { Result } from 'wellcrafted/result';
import { tryAsync } from 'wellcrafted/result';

/**
 * The minimum an app-shell surface needs to render hosted credit context. A
 * strict subset of the dashboard's `BillingOverview` (`apps/api/worker/billing`):
 * the server emits the full DTO and this reads only the fields a compact display
 * uses, so app-shell never imports an `apps/api` type across the package boundary.
 */
export type CreditSnapshot = {
	/** Credits available to spend right now. */
	remaining: number;
	/** Credits granted this cycle (monthly grant + rollover + top-up). Zero is
	 *  possible (a wallet that has never been granted), so status rules guard it. */
	granted: number;
	/** Display name of the active plan (e.g. "Pro", "Free"), resolved server-side. */
	planDisplayName: string;
};

/** How the wallet reads for a "can I act" decision. */
export type CreditStatus = 'out' | 'low' | 'ok';

/** Below this fraction of the cycle grant, a non-empty wallet reads as "low". */
const LOW_FRACTION = 0.1;
/** Grant-less fallback (free tier, top-up-only wallet): treat this few credits as low. */
const LOW_ABSOLUTE = 10;

/**
 * Classify a wallet for the visibility surface: `out` when nothing is left to
 * spend, `low` when a hosted action still runs but is close to failing, else
 * `ok`. Pure and host-agnostic so the popover, a picker, and a test all agree on
 * one threshold. When a grant exists, "low" is relative to it (10%); a grant-less
 * wallet falls back to a small absolute floor so a $-top-up-only balance still
 * warns before it empties.
 */
export function creditStatus(snapshot: CreditSnapshot): CreditStatus {
	if (snapshot.remaining <= 0) return 'out';
	const threshold =
		snapshot.granted > 0 ? snapshot.granted * LOW_FRACTION : LOW_ABSOLUTE;
	return snapshot.remaining <= threshold ? 'low' : 'ok';
}

/** The billing overview path. Hosted-only; a self-hosted instance never mounts it
 *  (`apps/api/worker/billing/routes.ts`), so a request there simply 404s and the
 *  caller reads that as "no hosted credits". */
const OVERVIEW_PATH = '/api/billing/overview';

export const CreditBalanceError = defineErrors({
	/** The credential-boundary fetch threw (offline, DNS) or the OK body failed to
	 *  parse. Not raised for a non-OK status: that resolves to `null` (see below). */
	RequestFailed: ({ cause }: { cause: unknown }) => ({
		message: `Failed to load credit balance: ${extractErrorMessage(cause)}`,
		cause,
	}),
});
export type CreditBalanceError = import('wellcrafted/error').InferErrors<
	typeof CreditBalanceError
>;

/** The fetch shape both hosts already have: `AuthClient.fetch`. */
type AuthFetch = (
	input: Request | string | URL,
	init?: RequestInit,
) => Promise<Response>;

/**
 * Read the signed-in account's credit snapshot through the auth credential
 * boundary. Returns `null` (not an error) whenever there are no hosted credits to
 * show: a non-200 (a self-hosted instance's 404, an unauthenticated 401, the
 * billing provider's fail-closed 503) all mean "this surface has nothing to
 * display", which the popover renders as absence rather than a scary error. Only a
 * thrown fetch or an unparseable 200 body is a real `RequestFailed`.
 *
 * `apiOrigin` is the API this client signs into (`auth.deployment.baseURL`); the path is
 * resolved against it so an OAuth app calling a cross-origin API hits the right
 * host, not its own page origin.
 */
export function fetchCreditOverview(
	authFetch: AuthFetch,
	apiOrigin: string,
): Promise<Result<CreditSnapshot | null, CreditBalanceError>> {
	const url = new URL(OVERVIEW_PATH, apiOrigin);
	// A `null` (no hosted billing here) is a value, not an error; only a thrown
	// fetch or an unparseable OK body reaches `catch`.
	return tryAsync({
		try: async (): Promise<CreditSnapshot | null> => {
			const res = await authFetch(url);
			if (!res.ok) return null;
			const body = (await res.json()) as {
				planDisplayName?: unknown;
				credits?: { remaining?: unknown; granted?: unknown };
			};
			const remaining = body.credits?.remaining;
			const granted = body.credits?.granted;
			if (typeof remaining !== 'number' || typeof granted !== 'number') {
				return null;
			}
			return {
				remaining,
				granted,
				planDisplayName:
					typeof body.planDisplayName === 'string'
						? body.planDisplayName
						: 'Free',
			};
		},
		catch: (cause) => CreditBalanceError.RequestFailed({ cause }),
	});
}
