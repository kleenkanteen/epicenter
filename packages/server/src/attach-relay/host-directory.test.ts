/**
 * Attach host directory guard proof (ADR-0115 wave 5, wave 6 status): the
 * directory entry carries `hostId`, `label`, and `status` only, and rejects any
 * route-, capability-, action-, or tool-shaped field. This is PR #2277's
 * presence-schema guard re-homed onto the AttachRelay directory, so the
 * directory cannot grow into a capability registry.
 *
 * What this pins:
 * - a well-formed `online`/`offline`/`unreachable` entry parses and infers its
 *   three fields (wave 6 added `unreachable` as a distinct liveness state);
 * - a bad or missing `status`, and an empty `hostId`, fail closed;
 * - every capability/route/action/tool-shaped extra field fails to parse,
 *   because the schema rejects undeclared keys.
 */

import { describe, expect, test } from 'bun:test';
import { type } from 'arktype';
import { AttachHostDirectoryEntry } from './host-directory.js';

/** A valid entry, the base each negative case perturbs. */
const validEntry = {
	hostId: 'mac-1',
	label: "Braden's Mac",
	status: 'online',
} as const;

describe('attach host directory entry: valid shapes', () => {
	test('an online entry parses and keeps exactly its three fields', () => {
		const parsed = AttachHostDirectoryEntry(validEntry);
		expect(parsed instanceof type.errors).toBe(false);
		expect(parsed).toEqual(validEntry);
	});

	test('offline and unreachable entries parse as distinct liveness states', () => {
		for (const status of ['offline', 'unreachable'] as const) {
			const parsed = AttachHostDirectoryEntry({
				hostId: 'mac-1',
				label: "Braden's Mac",
				status,
			});
			expect(parsed instanceof type.errors).toBe(false);
		}
	});
});

describe('attach host directory entry: malformed core fields fail closed', () => {
	test('a missing status fails', () => {
		expect(
			AttachHostDirectoryEntry({ hostId: 'mac-1', label: 'Mac' }) instanceof
				type.errors,
		).toBe(true);
	});

	test('a status outside the closed enum fails', () => {
		// The enum is online | offline | unreachable (wave 6); nothing else parses.
		for (const status of ['busy', 'live', 'asleep', '']) {
			expect(
				AttachHostDirectoryEntry({ ...validEntry, status }) instanceof
					type.errors,
			).toBe(true);
		}
	});

	test('an empty hostId fails', () => {
		expect(
			AttachHostDirectoryEntry({ ...validEntry, hostId: '' }) instanceof
				type.errors,
		).toBe(true);
	});

	test('a missing hostId fails', () => {
		expect(
			AttachHostDirectoryEntry({ label: 'Mac', status: 'online' }) instanceof
				type.errors,
		).toBe(true);
	});
});

/**
 * The refusal that makes this wave: no field that describes what the host can
 * do, addresses a route, or names a tool may enter the directory. The closed
 * schema rejects each on sight, so none has anywhere to live.
 */
const REFUSED_FIELDS = [
	// capability-shaped
	'capability',
	'capabilities',
	// route-shaped
	'route',
	'routes',
	'exposedRoutes',
	'path',
	// action-shaped
	'action',
	'actions',
	// MCP / tool-shaped
	'tools',
	'toolName',
	'methods',
	'method',
	'tools/list',
	'tools/call',
	// misc addressing surface
	'topic',
	'name',
] as const;

describe('attach host directory entry: route/capability/action/tool fields refused', () => {
	for (const field of REFUSED_FIELDS) {
		test(`an extra "${field}" field fails to parse`, () => {
			const withExtra = { ...validEntry, [field]: 'anything' };
			expect(AttachHostDirectoryEntry(withExtra) instanceof type.errors).toBe(
				true,
			);
		});
	}

	test('a full capability catalog shape is refused wholesale', () => {
		const catalog = {
			...validEntry,
			exposedRoutes: ['imessage.search', 'mail.list'],
			capabilities: { imessage: { read: true } },
			tools: [{ name: 'searchMessages', method: 'tools/call' }],
		};
		expect(AttachHostDirectoryEntry(catalog) instanceof type.errors).toBe(true);
	});
});
