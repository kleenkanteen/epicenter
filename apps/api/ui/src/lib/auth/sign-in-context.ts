/**
 * Response shape of `GET /sign-in/context`, the sign-in surface's JSON
 * bootstrap, owned by `packages/server/src/routes/auth.ts`.
 *
 * Mirrored here rather than imported: the contract is one small JSON shape
 * across an HTTP boundary, and pulling `@epicenter/server` into the SPA's
 * typecheck for it would cost more than the duplication. Keep the two in sync
 * by hand; the server's route tests pin the wire shape.
 *
 * `providers` carries the deployment's enabled OAuth providers. A provider
 * absent from this list never renders, so the UI cannot offer a dead button.
 * Passkeys do not need a server capability flag here: this app always mounts
 * the Better Auth passkey plugin, and the browser WebAuthn API is the real
 * per-client gate.
 */
export type SocialProvider = 'google' | 'github' | 'microsoft' | 'apple';

export type SignInContext = {
	providers: SocialProvider[];
	session: { name: string; email: string } | null;
};

export const PROVIDER_LABELS: Record<SocialProvider, string> = {
	google: 'Google',
	github: 'GitHub',
	microsoft: 'Microsoft',
	apple: 'Apple',
};
