/**
 * Tab Manager mount.
 *
 * `tabManager(opts?)` returns the Mount used by `epicenter.config.ts`.
 * It projects saved tabs, bookmarks, and devices into markdown while keeping
 * the Y.Doc update log and SQLite mirror under `.epicenter/`. Tab Manager's
 * tab/bookmark actions are browser-only and live in `tab-manager/extension.ts`;
 * the watcher only syncs and materializes (ADR-0112).
 */

import type { GitAutosaveConfig } from '@epicenter/workspace/document/materializer/markdown';
import {
	attachMountMarkdown,
	attachMountSqlite,
	nodeMountRuntime,
} from '@epicenter/workspace/node';
import { tabManagerWorkspace } from './src/lib/workspace/definition.js';

export type TabManagerMountOptions = {
	/** Enable per-materializer Git autosave for markdown output. */
	git?: GitAutosaveConfig | false;
	/**
	 * Base URL of the Epicenter cloud API used for sync.
	 * Defaults to `process.env.EPICENTER_API_URL`, falling back to the hosted API.
	 */
	baseURL?: string;
};

export function tabManager({
	git = false,
	baseURL,
}: TabManagerMountOptions = {}) {
	return tabManagerWorkspace.mount({
		baseURL,
		runtime: nodeMountRuntime(),
		compose({ workspace, scope }) {
			attachMountSqlite(scope, workspace, {
				fts: {
					bookmarks: ['title', 'url'],
					savedTabs: ['title', 'url'],
				},
			});
			attachMountMarkdown(scope, workspace, {
				tables: {
					bookmarks: {},
					devices: {},
					savedTabs: {},
				},
				git,
			});
		},
	});
}
