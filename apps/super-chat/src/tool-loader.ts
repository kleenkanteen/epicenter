/**
 * Startup loading of trusted TypeScript tool modules: the ADR-0084 mechanism
 * (Bun's native `import()` over vendored `.ts` files) carrying the ADR-0097
 * contract (a default-exported factory that receives the host API). The loader
 * scans one flat directory, calls each factory with the host-owned
 * {@link ToolHost}, and projects each result into a namespaced
 * {@link ToolCatalog} the host merges beside the built-in apps.
 *
 * Failure policy: a malformed module fails host startup instead of being
 * skipped. Tool files are trusted, user-installed code; a launch failure that
 * names the file is easier to notice and fix than a verb that silently never
 * appears. A missing directory is not a failure: nothing is installed, and the
 * host runs with the built-in apps only.
 */

import { type Dirent, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
	createLocalToolCatalog,
	namespaceToolCatalog,
	type ToolCatalog,
} from '@epicenter/workspace/agent';
import type { ToolHost, ToolModule, ToolModuleResult } from './tool-module.ts';

export type LoadToolModulesOptions = {
	/** The flat directory scanned for `*.ts` tool modules. */
	dir: string;
	/** The host API injected into every module factory (ADR-0097). */
	host: ToolHost;
	/**
	 * Namespaces the static install list already owns. A module file whose name
	 * matches one fails startup; under first-wins composition it would otherwise
	 * silently shadow (or be shadowed by) a built-in app's verbs.
	 */
	reservedNamespaces: readonly string[];
};

/**
 * Load every tool module in `dir` and return one namespaced catalog per file.
 * The namespace is the file name without `.ts`: `weather.ts` contributes
 * `weather__<tool>` verbs to the composed surface.
 */
export async function loadToolModuleCatalogs({
	dir,
	host,
	reservedNamespaces,
}: LoadToolModulesOptions): Promise<ToolCatalog[]> {
	const taken = new Set(reservedNamespaces);
	const catalogs: ToolCatalog[] = [];
	for (const file of listToolFiles(dir)) {
		const path = join(dir, file);
		const namespace = file.slice(0, -'.ts'.length);
		// `namespaceToolCatalog` requires a prefix free of the `__` separator.
		if (
			!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(namespace) ||
			namespace.includes('__')
		) {
			throw new Error(
				`Tool module "${path}" has an invalid namespace "${namespace}": use letters, digits, "-", or single "_" (never "__"). Rename the file.`,
			);
		}
		if (taken.has(namespace)) {
			throw new Error(
				`Tool module "${path}" would claim the namespace "${namespace}", which is already taken. Rename the file.`,
			);
		}
		taken.add(namespace);
		catalogs.push(
			namespaceToolCatalog(namespace, await loadToolModule(path, host)),
		);
	}
	return catalogs;
}

/** The `.ts` files directly in `dir`, sorted for a deterministic load order. */
function listToolFiles(dir: string): string[] {
	let entries: Dirent[];
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
		throw error;
	}
	return entries
		.filter(
			(entry) =>
				entry.isFile() &&
				entry.name.endsWith('.ts') &&
				!entry.name.endsWith('.d.ts'),
		)
		.map((entry) => entry.name)
		.sort();
}

/** Import one module, run its factory, and project the result to a catalog. */
async function loadToolModule(
	path: string,
	host: ToolHost,
): Promise<ToolCatalog> {
	const module: { default?: unknown } = await import(
		pathToFileURL(path).href
	).catch((cause) => {
		throw new Error(`Tool module "${path}" failed to import.`, { cause });
	});
	if (typeof module.default !== 'function') {
		throw new Error(
			`Tool module "${path}" must default-export a factory function receiving the ToolHost (ADR-0097); its default export is ${typeof module.default}.`,
		);
	}
	const factory = module.default as ToolModule;
	let result: ToolModuleResult;
	try {
		result = await factory(host);
	} catch (cause) {
		throw new Error(`Tool module "${path}" threw while building its tools.`, {
			cause,
		});
	}
	if (isToolCatalog(result)) return result;
	if (typeof result !== 'object' || result === null) {
		throw new Error(
			`Tool module "${path}" must return an action registry or a ToolCatalog; it returned ${result === null ? 'null' : typeof result}.`,
		);
	}
	// The registry form: every value must be an action (the callable IS the
	// handler, with `type` attached by the injected defineQuery/defineMutation).
	for (const [key, action] of Object.entries(result)) {
		if (
			typeof action !== 'function' ||
			(action.type !== 'query' && action.type !== 'mutation')
		) {
			throw new Error(
				`Tool module "${path}" registry entry "${key}" is not an action; build entries with the injected defineQuery/defineMutation.`,
			);
		}
	}
	return createLocalToolCatalog(result);
}

/** The escape-hatch form: a full catalog is `{ definitions(), resolve() }`. */
function isToolCatalog(result: ToolModuleResult): result is ToolCatalog {
	return (
		typeof (result as ToolCatalog).definitions === 'function' &&
		typeof (result as ToolCatalog).resolve === 'function'
	);
}
