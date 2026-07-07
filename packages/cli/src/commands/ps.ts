/**
 * `epicenter daemon ps`: list running `daemon up` daemons (this user, this machine).
 *
 * Enumerates `<runtimeDir>/*.meta.json`, checks each recorded pid for
 * liveness, and renders a compact table. Metadata carries the pid so `down`
 * can signal the process. Orphaned metadata is opportunistically swept.
 *
 * No `--json` flag in v1; the spec defers it until a tooling consumer
 * (Conductor panel, shell prompt) asks.
 *
 * See spec: `20260426T235000-cli-up-long-lived-peer.md` § "Process lifecycle".
 */

import {
	enumerateDaemons,
	sweepDaemonRuntimeFiles,
} from '@epicenter/workspace/node';
import { cmd } from '../util/cmd.js';
import { isProcessAlive } from '../util/process-alive.js';

type PsRow = {
	dir: string;
	pid: number;
	uptime: string;
};

function humanUptime(startedAt: string): string {
	const ms = Date.now() - new Date(startedAt).getTime();
	if (Number.isNaN(ms) || ms < 0) return '0s';
	const sec = Math.floor(ms / 1000);
	if (sec < 60) return `${sec}s`;
	const min = Math.floor(sec / 60);
	if (min < 60) return `${min}m`;
	const hr = Math.floor(min / 60);
	const restMin = min % 60;
	return `${hr}h${restMin}m`;
}

export const psCommand = cmd({
	command: 'ps',
	describe:
		'List running `epicenter daemon up` daemons (this user, this machine).',
	handler: async () => {
		const rows: PsRow[] = [];
		for (const meta of enumerateDaemons()) {
			if (!isProcessAlive(meta.pid)) {
				sweepDaemonRuntimeFiles(meta.dir);
				continue;
			}
			rows.push({
				dir: meta.dir,
				pid: meta.pid,
				uptime: humanUptime(meta.startedAt),
			});
		}

		if (rows.length === 0) {
			process.stderr.write('no daemons running\n');
			return;
		}
		// `console.table` is the spec-mentioned renderer; it writes to stdout.
		console.table(rows);
	},
});
