/**
 * Server-only derived identifiers built from an `PrincipalId`.
 *
 * `PrincipalId` itself lives in `@epicenter/identity` because it flows through
 * `/api/session`, the persisted auth cell, and every client (browser,
 * extension, CLI, daemon). What lives here are the durable strings only
 * a server cares about: Durable Object names, R2 object keys, and the
 * partition path segment they all share.
 *
 * Per-user and instance share the exact same path shape. The partition
 * segment is always `principals/<ownerId>`. In the per-user topology `ownerId`
 * is the signed-in user's id; on an instance it is the pinned constant
 * `INSTANCE_PRINCIPAL_ID` (the literal `instance`). The path is honest either way:
 * every durable identifier the server writes is rooted at
 * `principals/<ownerId>`.
 *
 * Every durable string follows the rule:
 *   `principals/<ownerId>/<resource type>/<id>`
 *
 * One shape, one helper per resource type, no ternary.
 */

import type { PrincipalId } from '@epicenter/identity';

/** Durable Object name template, single form. */
export type RoomDoName = `principals/${string}/rooms/${string}`;

/**
 * R2 object key template for a content-addressed blob, single form. The id
 * segment is a sha256 hex digest, so the key IS the content address: R2 is
 * the index, with no separate database row. See
 * ADR-0089 (the blob store is a presigned-S3 kernel and the bucket is its only index).
 */
export type BlobR2Key = `principals/${string}/blobs/${string}`;

/** Common prefix for one partition's blobs, used by the S3 client's list enumeration. */
export type BlobOwnerPrefix = `principals/${string}/blobs/`;

/** Durable name of a room's Cloudflare Durable Object. */
export function doName(ownerId: PrincipalId, roomId: string): RoomDoName {
	return `principals/${ownerId}/rooms/${roomId}`;
}

/** Durable key of a content-addressed blob's R2 object (id = sha256 hex). */
export function blobKey(ownerId: PrincipalId, sha256: string): BlobR2Key {
	return `principals/${ownerId}/blobs/${sha256}`;
}

/** Prefix matching every blob this partition has stored. */
export function blobOwnerPrefix(ownerId: PrincipalId): BlobOwnerPrefix {
	return `principals/${ownerId}/blobs/`;
}
