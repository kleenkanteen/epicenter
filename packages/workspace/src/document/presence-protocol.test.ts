import { describe, expect, test } from 'bun:test';
import {
	checkPresenceFrame,
	checkPresencePublishFrame,
} from './presence-protocol.js';

describe('presence protocol validation', () => {
	test('accepts liveness-only presence frames', () => {
		expect(
			checkPresenceFrame.Check({
				type: 'presence',
				peers: [{ nodeId: 'device-a', connectedAt: 1, agentId: 'notes' }],
			}),
		).toBe(true);
	});

	test('rejects capability fields on peer entries', () => {
		expect(
			checkPresenceFrame.Check({
				type: 'presence',
				peers: [
					{
						nodeId: 'device-a',
						connectedAt: 1,
						capabilities: ['books'],
					},
				],
			}),
		).toBe(false);

		expect(
			checkPresenceFrame.Check({
				type: 'presence',
				peers: [
					{
						nodeId: 'device-a',
						connectedAt: 1,
						actionManifest: { notes_count: { kind: 'query' } },
					},
				],
			}),
		).toBe(false);
	});

	test('rejects extra fields on presence publish frames', () => {
		expect(
			checkPresencePublishFrame.Check({
				type: 'presence_publish',
				agentId: 'notes',
				capabilities: ['books'],
			}),
		).toBe(false);
	});
});
