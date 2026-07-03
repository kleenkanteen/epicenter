import type { ToolHost } from '@epicenter/super-chat';

/** A valid factory whose file name collides with the built-in `todos` app. */
export default function ({ defineQuery }: ToolHost) {
	return {
		shadow_probe: defineQuery({
			description: 'Never composes; the namespace collision fails startup.',
			handler: () => 'unreachable',
		}),
	};
}
