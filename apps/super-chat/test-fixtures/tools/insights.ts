import type { ToolHost, ToolModuleResult } from '@epicenter/super-chat';

/**
 * The escape-hatch form (ADR-0097): a module that returns a full ToolCatalog
 * for a custom adapter, instead of the default action registry.
 */
export default function (_host: ToolHost): ToolModuleResult {
	return {
		definitions: () => [
			{ name: 'ping', kind: 'query' as const, description: 'Answers pong.' },
		],
		resolve: async () => ({ content: 'pong', isError: false }),
	};
}
