import { defineErrors, type InferErrors } from 'wellcrafted/error';

/**
 * Structured error variants for the `/attach/grants` admin surface (ADR-0115).
 *
 * The device-grant admin surface has only two client-visible failures: a
 * malformed mint body, and a revoke of a grant that is not there. Auth failures
 * (a non-operator token) are the deployment auth wrapper's OAuth 401, not this
 * union. Owned by the grants route ({@link grants-app.ts}), its only emitter; each
 * variant bakes in its own HTTP `status`, and the serialized envelope is
 * `wellcrafted`'s `{ data: null, error: { name, message, ...fields } }`.
 */
export const GrantError = defineErrors({
	/** The mint request body was not `{ deviceId: string, label?: string }`. */
	InvalidMintRequest: ({ summary }: { summary: string }) => ({
		message: `Invalid grant request: ${summary}`,
		status: 400 as const,
		summary,
	}),
	/** No grant exists for the given id (already revoked, or never minted). */
	NotFound: ({ id }: { id: string }) => ({
		message: `No such grant: '${id}'.`,
		status: 404 as const,
		id,
	}),
});

/** Discriminated union of all grant-admin error payloads, keyed by `name`. */
export type GrantError = InferErrors<typeof GrantError>;
