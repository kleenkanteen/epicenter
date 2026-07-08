import { field } from '@epicenter/field';
import {
	attachPlainText,
	defineTable,
	type InferTableRow,
	nullable,
} from '@epicenter/workspace';
import type { FileId } from './ids.js';

export const filesTable = defineTable({
	id: field.string<FileId>(),
	name: field.string(),
	parentId: nullable(field.string<FileId>()),
	type: field.select(['file', 'folder']),
	size: field.number(),
	// Timestamps are canonical UTC instants, not raw millis: a fixed-width
	// instant sorts chronologically as TEXT (the SQLite mirror and the
	// recency index both rely on this) and stays readable in the CRDT.
	createdAt: field.instant(),
	updatedAt: field.instant(),
	trashedAt: nullable(field.instant()),
}).docs({
	content: {
		// A file body is plain text (Markdown source) stored as a Y.Text at
		// `getText('content')` (ADR-0107).
		layout: attachPlainText,
		// Body edits bypass the tree API, so bump `updatedAt` here to keep the
		// same modification-time invariant the file operations already maintain.
		touch: 'updatedAt',
	},
});

/** File metadata row derived from the files table definition */
export type FileRow = InferTableRow<typeof filesTable>;
