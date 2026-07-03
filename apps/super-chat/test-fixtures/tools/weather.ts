import type { ToolHost } from '@epicenter/super-chat';

/**
 * The registry form (ADR-0097): no runtime imports. `defineQuery` and `Type`
 * arrive through the injected host, and the type-only import above erases at
 * transpile time, so loading never resolves host packages.
 */
export default function ({ defineQuery, Type, workspaces }: ToolHost) {
	return {
		weather_get: defineQuery({
			description: 'Current weather for a city.',
			input: Type.Object({ city: Type.String() }),
			handler: ({ city }) => `Sunny in ${city}`,
		}),
		workspaces_list: defineQuery({
			description: 'The workspace handles the host exposed to this module.',
			handler: () => Object.keys(workspaces).sort().join(','),
		}),
	};
}
