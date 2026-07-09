/**
 * Host directory store + Bun join proof (ADR-0115 clause 3): membership is the
 * trace of the host-register act, liveness is the coordinator, and a status is
 * their join.
 *
 * What this pins:
 * - `createHostDirectory` retains a host after it disconnects (so an asleep
 *   desktop still lists) and falls back to the `hostId` when no label is given;
 * - the Bun server's `hostDirectory` records a host by the act of connecting as a
 *   host, lists it `online` while its socket is live, and flips it to `offline`
 *   (never dropping it) when the socket closes;
 * - a client connect never enters the directory (no host/client discriminator to
 *   get wrong: only a `role=host` connect writes membership);
 * - the directory is partitioned by principal;
 * - liveness is conflict-correct: a refused second host registration never
 *   displaces the incumbent's `online`.
 */

import { describe, expect, test } from 'bun:test';
import type { ServerWebSocket } from 'bun';
import {
	type AttachRelayBunServer,
	type AttachRelaySocketData,
	createAttachRelayBunServer,
} from './bun-server.js';
import { createHostDirectory } from './host-directory.js';

describe('createHostDirectory (membership store)', () => {
	test('retains a host after disconnect and falls back to hostId', () => {
		const directory = createHostDirectory();
		directory.record('p', 'mac', "Braden's Mac");
		directory.record('p', 'mini', undefined);

		expect(directory.entries('p')).toEqual([
			{ hostId: 'mac', label: "Braden's Mac" },
			// A blank label falls back to the hostId so the closed schema accepts it.
			{ hostId: 'mini', label: 'mini' },
		]);
	});

	test('is partitioned by principal', () => {
		const directory = createHostDirectory();
		directory.record('p', 'mac', 'Mac');
		directory.record('q', 'other', 'Other');

		expect(directory.entries('p')).toEqual([{ hostId: 'mac', label: 'Mac' }]);
		expect(directory.entries('other-principal')).toEqual([]);
	});

	test('re-recording a host refreshes its label without duplicating it', () => {
		const directory = createHostDirectory();
		directory.record('p', 'mac', 'Old name');
		directory.record('p', 'mac', 'New name');

		expect(directory.entries('p')).toEqual([
			{ hostId: 'mac', label: 'New name' },
		]);
	});
});

/** A test double for a Bun `ServerWebSocket` the coordinator drives. */
function fakeSocket(
	data: AttachRelaySocketData,
): ServerWebSocket<AttachRelaySocketData> {
	return {
		data,
		readyState: 1,
		send() {},
		close() {},
	} as unknown as ServerWebSocket<AttachRelaySocketData>;
}

/** Open a socket on the relay's websocket handler, as `Bun.serve` would. */
function open(relay: AttachRelayBunServer, data: AttachRelaySocketData): void {
	relay.websocket.open?.(fakeSocket(data));
}

describe("Bun server's host directory join", () => {
	test('a host lists online while live and offline after it closes', () => {
		const relay = createAttachRelayBunServer();
		const hostSocket = fakeSocket({
			surface: 'attach',
			role: 'host',
			principalId: 'instance',
			hostId: 'mac',
			label: "Braden's Mac",
		});

		relay.websocket.open?.(hostSocket);
		expect(relay.hostDirectory.list('instance')).toEqual([
			{ hostId: 'mac', label: "Braden's Mac", status: 'online' },
		]);

		relay.websocket.close?.(hostSocket, 1000, 'bye');
		// Retained, not dropped: an asleep desktop still lists, now offline.
		expect(relay.hostDirectory.list('instance')).toEqual([
			{ hostId: 'mac', label: "Braden's Mac", status: 'offline' },
		]);
	});

	test('a client connect never enters the directory', () => {
		const relay = createAttachRelayBunServer();
		// A live host so the client attach pairs rather than being refused.
		open(relay, {
			surface: 'attach',
			role: 'host',
			principalId: 'instance',
			hostId: 'mac',
			label: 'Mac',
		});
		open(relay, {
			surface: 'attach',
			role: 'client',
			principalId: 'instance',
			hostId: 'mac',
			deviceId: 'phone',
			attachId: 'a1',
		});

		// Only the host is in the directory; the client left no membership trace.
		expect(relay.hostDirectory.list('instance')).toEqual([
			{ hostId: 'mac', label: 'Mac', status: 'online' },
		]);
	});

	test('is partitioned by principal', () => {
		const relay = createAttachRelayBunServer();
		open(relay, {
			surface: 'attach',
			role: 'host',
			principalId: 'instance',
			hostId: 'mac',
			label: 'Mac',
		});

		expect(relay.hostDirectory.list('someone-else')).toEqual([]);
	});

	test('a refused second host registration keeps the incumbent online', async () => {
		const relay = createAttachRelayBunServer();
		const incumbent = fakeSocket({
			surface: 'attach',
			role: 'host',
			principalId: 'instance',
			hostId: 'mac',
			label: 'Mac',
		});
		const conflicting = fakeSocket({
			surface: 'attach',
			role: 'host',
			principalId: 'instance',
			hostId: 'mac',
			label: 'Mac (stale reconnect)',
		});

		relay.websocket.open?.(incumbent);
		relay.websocket.open?.(conflicting);
		// The coordinator refused the newcomer; the incumbent still owns the pair.
		expect((await relay.hostDirectory.list('instance'))[0]?.status).toBe(
			'online',
		);

		// The refused newcomer's socket closes; it never owned the entry, so the
		// incumbent stays online (conflict-correct liveness from the coordinator).
		relay.websocket.close?.(conflicting, 4409, 'host already registered');
		expect((await relay.hostDirectory.list('instance'))[0]?.status).toBe(
			'online',
		);
	});
});
