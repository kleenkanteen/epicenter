import yargs from 'yargs';
import { authCommand } from './commands/auth.js';
import { blobsCommand } from './commands/blobs.js';
import { daemonCommand } from './commands/daemon.js';
import { initCommand } from './commands/init.js';
import { matterCommand } from './commands/matter.js';

/**
 * Create the Epicenter CLI instance.
 *
 * Operate Epicenter roots from the shell.
 *
 *   - `auth`: manage the local machine auth session (pre-workspace)
 *   - `blobs`: archive a file/URL into the content-addressed cloud blob store
 *   - `init`: scaffold epicenter.config.ts (explicit root creation)
 *   - `daemon`: run and inspect the headless sync/materialization watcher
 *   - `matter`: lint a folder of typed markdown (disk is the source; SQLite is a projection)
 *
 * Workspace actions remain an in-process app/tool boundary. The CLI no longer
 * exposes a generic daemon action server.
 */
export function createCLI() {
	return {
		run: async (argv: string[]) => {
			const cli = yargs()
				.scriptName('epicenter')
				.command(authCommand)
				.command(blobsCommand)
				.command(initCommand)
				.command(daemonCommand)
				.command(matterCommand)
				.demandCommand(1)
				.strict()
				.exitProcess(false)
				.help();

			await cli.parse(argv);
		},
	};
}
