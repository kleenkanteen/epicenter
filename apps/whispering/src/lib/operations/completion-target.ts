import { INFERENCE, type InferenceProviderId } from '../constants/inference';
import {
	PROVIDERS,
	type TranscriptionServiceId,
} from '../services/transcription/providers';

export type CompletionTarget = {
	baseUrl: string;
	apiKey: string | undefined;
};

/**
 * The single resolved completion fact set: what to call, whether Polish can run,
 * and whether transcript text leaves the machine. All three are derived together
 * from one config read so they can never disagree (a null target with `canRun`,
 * or copy that claims a different locality than the target it was resolved from).
 * The Polish gate reads `canRun`, the call path reads `target`, and the privacy
 * copy reads the whole state.
 */
export type CompletionState = {
	/**
	 * The OpenAI-compatible connection to hand `complete()`. Null only when there
	 * is no base URL to talk to (Custom with no endpoint configured), the one
	 * genuinely un-runnable state.
	 */
	target: CompletionTarget | null;
	/**
	 * Whether the selected provider can serve a request now. A configured key is
	 * capability; so is a configured endpoint override with no key, the keyless
	 * local case (Custom pointed at Ollama or LM Studio). A canonical cloud
	 * provider with no key would 401, so it is not capable.
	 */
	canRun: boolean;
	/**
	 * Whether transcript text never leaves this machine: true when the resolved
	 * base URL host is loopback, regardless of provider id or API key. This is a
	 * property of the resolved host, not the provider label, so an OpenAI or Groq
	 * base URL pointed at localhost is correctly reported as on-device.
	 */
	textStaysOnDevice: boolean;
};

export type InferenceConfigKey =
	| (typeof INFERENCE)[InferenceProviderId]['apiKeyConfigKey']
	| NonNullable<(typeof INFERENCE)[InferenceProviderId]['endpointConfigKey']>;

type DeviceConfigReader = (key: InferenceConfigKey) => string;

export function resolveCompletionStateFromConfig({
	provider,
	getDeviceConfig,
}: {
	provider: InferenceProviderId;
	getDeviceConfig: DeviceConfigReader;
}): CompletionState {
	const { apiKeyConfigKey, endpointConfigKey, defaultBaseUrl } =
		INFERENCE[provider];
	const override = endpointConfigKey
		? getDeviceConfig(endpointConfigKey).trim()
		: '';
	const baseUrl = override || defaultBaseUrl;
	if (!baseUrl)
		return { target: null, canRun: false, textStaysOnDevice: false };
	const apiKey = getDeviceConfig(apiKeyConfigKey).trim() || undefined;
	return {
		target: { baseUrl, apiKey },
		canRun: apiKey !== undefined || override.length > 0,
		textStaysOnDevice: isLoopbackBaseUrl(baseUrl),
	};
}

function isLoopbackBaseUrl(baseUrl: string): boolean {
	try {
		const hostname = new URL(baseUrl).hostname;
		return (
			hostname === 'localhost' ||
			hostname === '127.0.0.1' ||
			hostname === '[::1]'
		);
	} catch {
		return false;
	}
}

export function describePolishDestination(
	transcriptionService: TranscriptionServiceId,
	completionProvider: InferenceProviderId,
	state: CompletionState,
): string {
	const transcriptionProvider = PROVIDERS[transcriptionService];
	const completionLabel = INFERENCE[completionProvider].label;

	if (!state.target || !state.canRun) {
		if (transcriptionProvider.location === 'local') {
			return 'Audio stays on this device. Polish is not ready, so transcripts ship raw.';
		}
		return `Audio is sent to ${transcriptionProvider.label}. Polish is not ready, so transcripts ship raw.`;
	}

	const { textStaysOnDevice } = state;

	if (transcriptionProvider.location === 'local' && textStaysOnDevice) {
		return 'Audio and transcript text both stay on this device.';
	}

	if (transcriptionProvider.location === 'local') {
		return `Audio is transcribed on-device, but Polish sends transcript text to ${completionLabel}.`;
	}

	if (textStaysOnDevice) {
		return `Audio is sent to ${transcriptionProvider.label}, then Polish keeps transcript text on this device.`;
	}

	return `Audio is sent to ${transcriptionProvider.label}, and Polish sends transcript text to ${completionLabel}.`;
}
