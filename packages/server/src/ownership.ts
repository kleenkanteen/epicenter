/**
 * Ownership rule: how a request maps to an owner partition.
 *
 * The deployment composes one of these and threads it into every library
 * surface that needs the partition (`createRequireOwnership`, `mountRoomsApp`,
 * `mountBlobsApp`, `mountSessionApp`). They are exported as constants so call
 * sites never type the discriminator string.
 *
 *   perUser:  every authenticated user owns their own partition (the
 *             partition IS the user's id). No extra check beyond auth. The
 *             multi-tenant shape, Epicenter Cloud only (`apps/api`).
 *   instance: every request resolves to ONE partition pinned to a byte-
 *             constant (INSTANCE_OWNER_ID), independent of caller identity.
 *             The self-hosted single-partition instance (`apps/self-host`,
 *             ADR-0075); the operator bearer is the gate, so there is nobody
 *             to admit or reject at the partition boundary.
 *
 * Exactly two topologies, split on partition cardinality (ADR-0075): `perUser`
 * derives the partition per identity (N partitions, Cloud-only); `instance` pins
 * it to a constant (one partition). There is no admission-gated or per-user shape
 * on an instance, and no mutable selector between the two: the deployment picks
 * one at composition time and it never changes.
 */

import {
	asOwnerId,
	INSTANCE_OWNER_ID,
	type OwnerId,
} from '@epicenter/identity';
import type { Context } from 'hono';
import type { Env } from './types.js';

/**
 * Discriminated union of every ownership shape this library knows how to
 * compose. Selected via {@link perUser} or {@link instance}; consumed by
 * {@link resolveOwnerId} and any sub-app that mounts ownership-scoped
 * routes. The instance arm is bare by design: the pin to
 * {@link INSTANCE_OWNER_ID} lives in the switch arm, so the partition decision
 * stays decoupled from caller identity (ADR-0075).
 */
export type OwnershipRule = { kind: 'perUser' } | { kind: 'instance' };

/** Per-user ownership rule (multi-tenant; Cloud only). */
export const perUser: OwnershipRule = { kind: 'perUser' };

/**
 * Single-partition instance ownership rule (self-host; ADR-0075).
 *
 * The partition is pinned to the byte-constant {@link INSTANCE_OWNER_ID},
 * independent of caller identity: every valid operator bearer maps to the SAME
 * `owners/instance` in {@link resolveOwnerId}, so adding per-person named
 * tokens later adds identity without re-partitioning the box's data. This is NOT
 * `perUser` keyed by a fixed id (that would shatter into `owners/<id>` the day a
 * second token is added).
 */
export const instance: OwnershipRule = { kind: 'instance' };

/**
 * The single switch on `rule.kind` in the codebase. The `requireOwnership`
 * middleware delegates here, so the partition decision lives in one place.
 *
 * Returns the owner partition the request maps to. Neither arm can fail: a
 * per-user request always owns its user's partition, and an instance request
 * always resolves to its pinned constant (the operator bearer already gated it
 * at the 401). The caller decides whether to compare the partition to a URL
 * `:ownerId` segment (the `requireOwnership` middleware does, rejecting a
 * mismatch with `OwnerMismatch`).
 *
 * Per-user:  the user's id branded as `OwnerId`.
 * Instance:  `INSTANCE_OWNER_ID`.
 */
export function resolveOwnerId<E extends Env = Env>(
	rule: OwnershipRule,
	c: Context<E>,
): OwnerId {
	switch (rule.kind) {
		case 'perUser':
			return asOwnerId(c.var.user.id);
		case 'instance':
			return INSTANCE_OWNER_ID;
	}
}
