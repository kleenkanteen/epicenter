import { CompleteError, complete, resolveConnection } from '@epicenter/client';
import type { Result } from 'wellcrafted/result';
import { customFetch } from '#platform/http';
import { INFERENCE } from '$lib/constants/inference';
import { deviceConfig } from '$lib/state/device-config.svelte';
import { settings } from '$lib/state/settings.svelte';

/**
 * Resolve the single global completion target: the OpenAI-compatible base URL
 * (an endpoint override in deviceConfig beats the provider's canonical default)
 * and the optional Bearer key, both read at use (ADR 0012) from the global
 * `completion.*` setting and deviceConfig. Null when there is no base URL to talk
 * to (Custom with no endpoint configured), the one genuinely un-runnable state.
 */
function resolveCompletionTarget(): {
	baseUrl: string;
	apiKey: string | undefined;
} | null {
	const provider = settings.get('completion.provider');
	const { apiKeyConfigKey, endpointConfigKey, defaultBaseUrl } =
		INFERENCE[provider];
	const override = endpointConfigKey
		? deviceConfig.get(endpointConfigKey).trim()
		: '';
	const baseUrl = override || defaultBaseUrl;
	if (!baseUrl) return null;
	return {
		baseUrl,
		apiKey: deviceConfig.get(apiKeyConfigKey).trim() || undefined,
	};
}

/**
 * Run one completion against the single global AI default. Both the Polish pass
 * and every Recipe share this one call path, so provider/model/key resolution
 * lives here once. Every provider speaks the OpenAI completion wire (Anthropic
 * and Google through their OpenAI-compatibility endpoints, ADR-0060), so there is
 * no per-provider client and no wire-vs-bespoke branch: resolve a connection from
 * the `INFERENCE` table and hand it to the shared `complete()`. Provider and model
 * come from `completion.*` in settings, the key and endpoint from deviceConfig,
 * all read at use (ADR 0012) so nothing goes stale; pasted strings are trimmed.
 *
 * `signal` aborts the in-flight request (the Polish HUD's "ship raw" control).
 */
export function completeWithGlobalDefault({
	systemPrompt,
	userPrompt,
	signal,
}: {
	systemPrompt: string;
	userPrompt: string;
	signal?: AbortSignal;
}): Promise<Result<string, CompleteError>> {
	const target = resolveCompletionTarget();
	if (!target) {
		const provider = settings.get('completion.provider');
		return Promise.resolve(
			CompleteError.TransportFailed({
				cause: new Error(
					`No base URL set for the ${provider} completion provider. Add an endpoint in settings.`,
				),
			}),
		);
	}
	return complete(
		resolveConnection(
			{ baseUrl: target.baseUrl, apiKey: target.apiKey },
			customFetch,
		),
		{
			model: settings.get('completion.model').trim(),
			systemPrompt,
			userPrompt,
			signal,
		},
	);
}

/**
 * Whether the selected completion provider can serve a request right now: the
 * Polish gate ("on by default only when it will actually work") reads this so the
 * AI pass is skipped silently on a fresh, unconfigured install instead of failing
 * a request. A configured key is capability; so is a configured endpoint override
 * with no key, the keyless local case (Custom pointed at Ollama or LM Studio,
 * where a cloud key is neither needed nor wanted). A canonical cloud provider with
 * no key would 401, so it is not capable. Read at use, like the completion call.
 */
export function hasCompletionCapability(): boolean {
	const target = resolveCompletionTarget();
	if (!target) return false;
	if (target.apiKey) return true;
	const { endpointConfigKey } = INFERENCE[settings.get('completion.provider')];
	return (
		endpointConfigKey !== null &&
		deviceConfig.get(endpointConfigKey).trim().length > 0
	);
}
