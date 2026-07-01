import type { Static, TSchema } from 'typebox';
import { Value } from 'typebox/value';
import { defineErrors, type InferErrors } from 'wellcrafted/error';
import { Ok, type Result } from 'wellcrafted/result';
import type { AppConfig } from './config.ts';
import {
	type GmailLabel,
	type GmailMessage,
	GmailMessageSchema,
	type HistoryPage,
	HistoryPageSchema,
	type HistoryRecord,
	ListLabelsResponseSchema,
	ListMessageIdsResponseSchema,
	ProfileResponseSchema,
} from './schema.ts';
import type { TokenError, TokenManager } from './token-manager.ts';

/**
 * The Gmail REST API client: `messages.list`/`messages.get` for full pulls,
 * `history.list` for incremental refresh, `labels.list`, and `getProfile` for
 * the post-full-pull `historyId` baseline. Same job as `apps/local-books`'
 * `qb-client.ts`: bearer auth from the token manager, one-shot refresh on 401,
 * backoff on throttling.
 *
 * Grounded against Gmail API docs (2026-06-30/07-01):
 * - Rate limiting is 429 (`rateLimitExceeded`/`userRateLimitExceeded`) or 403
 *   (`dailyLimitExceeded`, project-level); both back off, everything else 403
 *   is a hard permission error, not retried.
 *   https://developers.google.com/gmail/api/guides/handle-errors
 * - `history.list` 404s when `startHistoryId` is expired/invalid ("typically
 *   available for at least one week and often longer"); the caller must fall
 *   back to a full sync. https://developers.google.com/gmail/api/guides/sync
 */

export const GmailApiError = defineErrors({
	Network: ({ cause }: { cause: unknown }) => ({
		message: `Network error calling the Gmail API: ${String(cause)}`,
		cause,
	}),
	Http: ({ status, body }: { status: number; body: string }) => ({
		message: `Gmail API returned ${status}: ${body.slice(0, 500)}`,
		status,
		body,
	}),
	/** `startHistoryId` is expired or invalid; the caller must fall back to a full sync. */
	HistoryExpired: () => ({
		message:
			'Gmail history.list returned 404: startHistoryId is expired or invalid.',
	}),
	Throttled: ({ retries }: { retries: number }) => ({
		message: `Gmail API throttled the request after ${retries} retries.`,
		retries,
	}),
	InvalidResponse: ({ detail }: { detail: string }) => ({
		message: `Gmail API response was not the expected JSON shape: ${detail}`,
		detail,
	}),
});
export type GmailApiError = InferErrors<typeof GmailApiError>;

export type GmailClientError = GmailApiError | TokenError;

export type { HistoryPage, HistoryRecord };

export type GmailClient = {
	listMessageIds(
		pageToken?: string,
	): Promise<
		Result<{ ids: string[]; nextPageToken?: string }, GmailClientError>
	>;
	getMessage(id: string): Promise<Result<GmailMessage, GmailClientError>>;
	listHistory(
		startHistoryId: string,
		pageToken?: string,
	): Promise<Result<HistoryPage, GmailClientError>>;
	listLabels(): Promise<Result<GmailLabel[], GmailClientError>>;
	/** Current mailbox `historyId`, used as the baseline right after a full pull. */
	getProfile(): Promise<Result<{ historyId: string }, GmailClientError>>;
};

export type GmailClientDeps = {
	config: AppConfig;
	tokens: TokenManager;
	log?: (message: string) => void;
};

const MAX_RETRIES = 5;
const THROTTLE_WAIT_MS = 30_000;
const RETRYABLE_403_REASONS = new Set([
	'rateLimitExceeded',
	'userRateLimitExceeded',
	'dailyLimitExceeded',
]);

function retryAfterMs(response: Response): number | null {
	const header = response.headers.get('retry-after');
	if (!header) return null;
	const seconds = Number(header);
	return Number.isFinite(seconds) ? seconds * 1000 : null;
}

/**
 * Best-effort scrape of Google's error-body `reason`, used only to decide
 * whether a 403 is retryable. Deliberately untyped/tolerant rather than
 * typebox-validated: a wrong-shaped or non-JSON error body should silently
 * fall through to "not retryable", never fail the request a second way.
 */
function errorReason(body: string): string | null {
	try {
		const parsed = JSON.parse(body) as {
			error?: { errors?: { reason?: string }[] };
		};
		return parsed.error?.errors?.[0]?.reason ?? null;
	} catch {
		return null;
	}
}

/**
 * Validate a parsed JSON response against its expected shape. `Value.Check`
 * is a type predicate, so `data` narrows to `Static<S>` inside the true
 * branch with no cast. The boundary-validation counterpart to `tokens.ts`'
 * `tokenSetFromGrant`, applied to every Gmail response instead of just the
 * OAuth grant.
 */
function checkedResult<S extends TSchema>(
	schema: S,
	data: unknown,
	context: string,
): Result<Static<S>, GmailApiError> {
	if (Value.Check(schema, data)) return Ok(data);
	const [first] = Value.Errors(schema, data);
	const detail = first
		? `${first.message} at ${first.instancePath || '/'}`
		: 'unexpected shape';
	return GmailApiError.InvalidResponse({ detail: `${context}: ${detail}` });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createGmailClient(deps: GmailClientDeps): GmailClient {
	const { config, tokens } = deps;
	const log = deps.log ?? (() => {});
	const backoffMs = (attempt: number) =>
		Math.min(THROTTLE_WAIT_MS, 1000 * 2 ** attempt);

	async function request(
		path: string,
		params: Record<string, string> = {},
	): Promise<Result<unknown, GmailClientError>> {
		const url = new URL(`${config.apiBase}/gmail/v1/users/me/${path}`);
		for (const [key, value] of Object.entries(params)) {
			url.searchParams.set(key, value);
		}

		let attempt = 0;
		let refreshed = false;

		while (true) {
			const token = await tokens.getValidAccessToken();
			if (token.error) return token;

			let response: Response;
			try {
				response = await fetch(url.toString(), {
					headers: {
						Authorization: `Bearer ${token.data}`,
						Accept: 'application/json',
					},
				});
			} catch (cause) {
				if (attempt < MAX_RETRIES) {
					attempt += 1;
					await sleep(backoffMs(attempt));
					continue;
				}
				return GmailApiError.Network({ cause });
			}

			if (response.ok) {
				const json = await response.json().catch(() => null);
				if (json === null || typeof json !== 'object') {
					return GmailApiError.InvalidResponse({
						detail: 'body was not a JSON object',
					});
				}
				return Ok(json);
			}

			if (response.status === 401 && !refreshed) {
				refreshed = true;
				const forced = await tokens.forceRefresh();
				if (forced.error) return forced;
				continue;
			}

			// `history.list`'s expired-cursor signal is a bare 404, distinct from
			// a throttle or a hard error; the sync engine decides to fall back to
			// FULL, not this client.
			if (response.status === 404 && path === 'history') {
				return GmailApiError.HistoryExpired();
			}

			const body = await response.text().catch(() => '');
			const retryableThrottle =
				response.status === 429 ||
				(response.status === 403 &&
					RETRYABLE_403_REASONS.has(errorReason(body) ?? ''));

			if (retryableThrottle || response.status >= 500) {
				if (attempt >= MAX_RETRIES) {
					return retryableThrottle
						? GmailApiError.Throttled({ retries: attempt })
						: GmailApiError.Http({ status: response.status, body });
				}
				attempt += 1;
				const wait = retryableThrottle
					? (retryAfterMs(response) ?? backoffMs(attempt))
					: backoffMs(attempt);
				log(
					`Gmail API ${response.status}; waiting ${wait}ms before retry ${attempt}/${MAX_RETRIES}.`,
				);
				await sleep(wait);
				continue;
			}

			return GmailApiError.Http({ status: response.status, body });
		}
	}

	return {
		async listMessageIds(pageToken) {
			const { data, error } = await request('messages', {
				maxResults: String(config.pageSize),
				...(pageToken ? { pageToken } : {}),
			});
			if (error) return { data: null, error };
			const parsed = checkedResult(
				ListMessageIdsResponseSchema,
				data,
				'messages.list',
			);
			if (parsed.error) return parsed;
			return Ok({
				ids: (parsed.data.messages ?? []).map((m) => m.id),
				nextPageToken: parsed.data.nextPageToken,
			});
		},

		async getMessage(id) {
			const { data, error } = await request(`messages/${id}`, {
				format: 'full',
			});
			if (error) return { data: null, error };
			return checkedResult(GmailMessageSchema, data, 'messages.get');
		},

		async listHistory(startHistoryId, pageToken) {
			const { data, error } = await request('history', {
				startHistoryId,
				...(pageToken ? { pageToken } : {}),
			});
			if (error) return { data: null, error };
			return checkedResult(HistoryPageSchema, data, 'history.list');
		},

		async listLabels() {
			const { data, error } = await request('labels');
			if (error) return { data: null, error };
			const parsed = checkedResult(
				ListLabelsResponseSchema,
				data,
				'labels.list',
			);
			if (parsed.error) return parsed;
			return Ok(parsed.data.labels ?? []);
		},

		async getProfile() {
			const { data, error } = await request('profile');
			if (error) return { data: null, error };
			return checkedResult(ProfileResponseSchema, data, 'getProfile');
		},
	};
}
