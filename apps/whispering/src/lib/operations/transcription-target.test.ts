/**
 * Transcription Target Tests
 *
 * Verifies the Audio-stage locality rules the Processing surface reports.
 *
 * Key behaviors:
 * - The local runtime transcribes in-process and never leaves the device
 * - Locality follows the resolved endpoint host (loopback), not the provider's
 *   `location` label, so a self-hosted or cloud endpoint at localhost is on-device
 * - A remote self-hosted server reads as the user's own server, not a cloud vendor
 */
import { describe, expect, test } from 'bun:test';
import type { DeviceConfigKey } from '../state/device-config.svelte';
import { describeTranscriptionDestinationFromConfig } from './transcription-target';

function config(values: Partial<Record<DeviceConfigKey, string>>) {
	return (key: DeviceConfigKey) => values[key] ?? '';
}

describe('describeTranscriptionDestinationFromConfig', () => {
	test('local runtime keeps audio on device', () => {
		expect(
			describeTranscriptionDestinationFromConfig({
				service: 'local',
				getDeviceConfig: config({}),
			}),
		).toEqual({ onDevice: true, summary: 'Audio stays on this device.' });
	});

	test('cloud provider without an override names itself as the destination', () => {
		expect(
			describeTranscriptionDestinationFromConfig({
				service: 'OpenAI',
				getDeviceConfig: config({}),
			}),
		).toEqual({ onDevice: false, summary: 'Audio is sent to OpenAI.' });
	});

	test('cloud provider overridden to localhost keeps audio on device', () => {
		expect(
			describeTranscriptionDestinationFromConfig({
				service: 'OpenAI',
				getDeviceConfig: config({
					'providers.openai.endpoint': 'http://localhost:1234/v1',
				}),
			}),
		).toEqual({ onDevice: true, summary: 'Audio stays on this device.' });
	});

	test('self-hosted server at loopback keeps audio on device', () => {
		expect(
			describeTranscriptionDestinationFromConfig({
				service: 'speaches',
				getDeviceConfig: config({
					'providers.speaches.endpoint': 'http://localhost:8000',
				}),
			}),
		).toEqual({ onDevice: true, summary: 'Audio stays on this device.' });
	});

	test('self-hosted server at a remote host reads as the user own server', () => {
		expect(
			describeTranscriptionDestinationFromConfig({
				service: 'speaches',
				getDeviceConfig: config({
					'providers.speaches.endpoint': 'https://speaches.mybox.example',
				}),
			}),
		).toEqual({
			onDevice: false,
			summary: 'Audio is sent to your Speaches server.',
		});
	});

	test('unconfigured self-hosted server still reads as the user own server', () => {
		expect(
			describeTranscriptionDestinationFromConfig({
				service: 'speaches',
				getDeviceConfig: config({}),
			}),
		).toEqual({
			onDevice: false,
			summary: 'Audio is sent to your Speaches server.',
		});
	});
});
