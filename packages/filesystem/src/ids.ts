import { type Guid, generateId } from '@epicenter/workspace';
import type { Brand } from 'wellcrafted/brand';

/** Branded file identifier: a Guid that is specifically a file ID. */
export type FileId = Guid & Brand<'FileId'>;
/**
 * Syntactic sugar for `value as FileId`. The constrained `string` parameter
 * is what earns it over a raw `as` cast (callers can't widen to `unknown`).
 * The only place in the codebase where `as FileId` should appear.
 */
export const asFileId = (value: string): FileId => value as FileId;

/** Generate a new unique file identifier */
export function generateFileId(): FileId {
	return generateId<FileId>();
}
