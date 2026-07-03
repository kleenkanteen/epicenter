import type {
	ActionRegistry,
	defineMutation,
	defineQuery,
} from '@epicenter/workspace';
import type { ToolCatalog } from '@epicenter/workspace/agent';
import type Type from 'typebox';

/**
 * Scoped workspace handles the Super Chat host chooses to expose to trusted
 * tool modules. The loader owns the concrete shape for each installed app; the
 * module contract only says a tool receives one named bag, not ambient imports.
 */
export type ToolWorkspaces = Record<string, unknown>;

/**
 * The API injected into a trusted TypeScript tool module. Tool files import this
 * type for editor help, but receive the runtime values from the host so a
 * compiled sidecar never asks vendored code to resolve host packages.
 */
export type ToolHost<TWorkspaces extends ToolWorkspaces = ToolWorkspaces> = {
	readonly defineQuery: typeof defineQuery;
	readonly defineMutation: typeof defineMutation;
	readonly Type: typeof Type;
	readonly workspaces: TWorkspaces;
};

/**
 * A loaded module may return an action registry, which Super Chat can project
 * through `createLocalToolCatalog`, or a complete catalog when it needs a custom
 * adapter. The first form is the default; the second is the escape hatch.
 */
export type ToolModuleResult = ActionRegistry | ToolCatalog;

/**
 * Default export contract for trusted tool modules scanned at startup from the
 * host's tools directory (`<dataDir>/tools/*.ts`; see `tool-loader.ts`).
 */
export type ToolModule<TWorkspaces extends ToolWorkspaces = ToolWorkspaces> = (
	host: ToolHost<TWorkspaces>,
) => ToolModuleResult | Promise<ToolModuleResult>;
