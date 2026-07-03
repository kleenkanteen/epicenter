/**
 * Completion Target Tests
 *
 * Verifies the pure completion targeting rules that decide whether Polish can
 * run and what privacy boundary the UI reports.
 *
 * Key behaviors:
 * - Custom endpoint without a key is a usable local completion target
 * - Cloud providers need a key before Polish can run
 * - Locality follows the resolved host (loopback), not the provider id or key
 * - Destination copy separates local audio from local transcript text
 */
import { describe, expect, test } from 'bun:test';
import type { InferenceProviderId } from '../constants/inference';
import {
	type CompletionState,
	describePolishDestination,
	type InferenceConfigKey,
	resolveCompletionStateFromConfig,
} from './completion-target';

function config(values: Partial<Record<InferenceConfigKey, string>>) {
	return (key: InferenceConfigKey) => values[key] ?? '';
}

function state(
	provider: InferenceProviderId,
	values: Partial<Record<InferenceConfigKey, string>>,
): CompletionState {
	return resolveCompletionStateFromConfig({
		provider,
		getDeviceConfig: config(values),
	});
}

describe('resolveCompletionState', () => {
	test('endpoint override beats the provider default', () => {
		expect(
			state('OpenAI', {
				'providers.openai.endpoint': ' https://proxy.example/v1 ',
				'providers.openai.apiKey': ' sk-test ',
			}),
		).toEqual({
			target: { baseUrl: 'https://proxy.example/v1', apiKey: 'sk-test' },
			canRun: true,
			textStaysOnDevice: false,
		});
	});

	test('Custom without an endpoint has no completion target and cannot run', () => {
		expect(state('Custom', {})).toEqual({
			target: null,
			canRun: false,
			textStaysOnDevice: false,
		});
	});

	test('keyless Custom loopback endpoint can serve local Polish', () => {
		expect(
			state('Custom', {
				'providers.custom.endpoint': 'http://localhost:11434/v1',
			}),
		).toEqual({
			target: { baseUrl: 'http://localhost:11434/v1', apiKey: undefined },
			canRun: true,
			textStaysOnDevice: true,
		});
	});

	test('cloud provider without a key cannot serve Polish', () => {
		expect(state('Google', {})).toEqual({
			target: {
				baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
				apiKey: undefined,
			},
			canRun: false,
			textStaysOnDevice: false,
		});
	});

	test('cloud provider endpoint override to localhost with no key runs and stays on device', () => {
		expect(
			state('OpenAI', {
				'providers.openai.endpoint': 'http://localhost:1234/v1',
			}),
		).toEqual({
			target: { baseUrl: 'http://localhost:1234/v1', apiKey: undefined },
			canRun: true,
			textStaysOnDevice: true,
		});
	});

	test('loopback endpoint with a key still stays on device', () => {
		expect(
			state('Custom', {
				'providers.custom.endpoint': 'http://127.0.0.1:11434/v1',
				'providers.custom.apiKey': 'local-key',
			}),
		).toEqual({
			target: { baseUrl: 'http://127.0.0.1:11434/v1', apiKey: 'local-key' },
			canRun: true,
			textStaysOnDevice: true,
		});
	});
});

describe('describePolishDestination', () => {
	test('local transcription and keyless Custom keeps audio and text on device', () => {
		expect(
			describePolishDestination('parakeet', 'Custom', {
				target: { baseUrl: 'http://localhost:11434/v1', apiKey: undefined },
				canRun: true,
				textStaysOnDevice: true,
			}),
		).toBe('Audio and transcript text both stay on this device.');
	});

	test('local transcription and cloud Polish names the text provider', () => {
		expect(
			describePolishDestination('parakeet', 'Google', {
				target: {
					baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
					apiKey: 'key',
				},
				canRun: true,
				textStaysOnDevice: false,
			}),
		).toBe(
			'Audio is transcribed on-device, but Polish sends transcript text to Google.',
		);
	});

	test('cloud transcription and keyless Custom splits audio from local text', () => {
		expect(
			describePolishDestination('OpenAI', 'Custom', {
				target: { baseUrl: 'http://localhost:11434/v1', apiKey: undefined },
				canRun: true,
				textStaysOnDevice: true,
			}),
		).toBe(
			'Audio is sent to OpenAI, then Polish keeps transcript text on this device.',
		);
	});

	test('local transcription and OpenAI pointed at localhost keeps text on device', () => {
		expect(
			describePolishDestination('parakeet', 'OpenAI', {
				target: { baseUrl: 'http://localhost:1234/v1', apiKey: undefined },
				canRun: true,
				textStaysOnDevice: true,
			}),
		).toBe('Audio and transcript text both stay on this device.');
	});

	test('cloud transcription and cloud Polish names both providers', () => {
		expect(
			describePolishDestination('OpenAI', 'Google', {
				target: {
					baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
					apiKey: 'key',
				},
				canRun: true,
				textStaysOnDevice: false,
			}),
		).toBe(
			'Audio is sent to OpenAI, and Polish sends transcript text to Google.',
		);
	});

	test('cloud provider default without a key ships raw instead of claiming Polish sends text', () => {
		expect(
			describePolishDestination('parakeet', 'Google', {
				target: {
					baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
					apiKey: undefined,
				},
				canRun: false,
				textStaysOnDevice: false,
			}),
		).toBe(
			'Audio stays on this device. Polish is not ready, so transcripts ship raw.',
		);
	});

	test('keyless Custom remote endpoint does not claim transcript text stays on device', () => {
		expect(
			describePolishDestination('parakeet', 'Custom', {
				target: { baseUrl: 'https://completion.example/v1', apiKey: undefined },
				canRun: true,
				textStaysOnDevice: false,
			}),
		).toBe(
			'Audio is transcribed on-device, but Polish sends transcript text to Custom (OpenAI-compatible).',
		);
	});
});
