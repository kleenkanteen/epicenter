import * as Y from 'yjs';

type TimelineYMap = Y.Map<unknown>;

// ── Entry types ──────────────────────────────────────────────────────────

/**
 * A timeline entry. The body owns a single layout (text), so there is one
 * entry shape. At runtime an entry is a Y.Map; `pushText` constructs it and
 * `readEntry` validates and extracts it into this shape.
 *
 * The stored `type` discriminant is retained (every stored entry is already
 * `'text'`) so the durable format is untouched: the `timeline` slot and its
 * `type`/`content`/`createdAt` keys are frozen (ADR-0106).
 */
export type TextEntry = {
	type: 'text';
	content: Y.Text;
	createdAt: number;
};

export function attachTimeline(ydoc: Y.Doc, key = 'timeline') {
	const timeline = ydoc.getArray<TimelineYMap>(key);

	// ── State ─────────────────────────────────────────────────────────────

	function readEntry(entry: Y.Map<unknown> | undefined): TextEntry | null {
		if (!entry) return null;

		const type = entry.get('type');
		const createdAt = (entry.get('createdAt') as number) ?? 0;

		if (type === 'text') {
			const content = entry.get('content');
			if (content instanceof Y.Text)
				return { type: 'text', content, createdAt };
		}

		return null;
	}
	// ── Primitive push ops (closures, not on returned object) ─────────────

	function pushText(content: string): TextEntry {
		const entry = new Y.Map();
		entry.set('type', 'text');
		const ytext = new Y.Text();
		ytext.insert(0, content);
		entry.set('content', ytext);
		const createdAt = Date.now();
		entry.set('createdAt', createdAt);
		timeline.push([entry]);
		return { type: 'text', content: ytext, createdAt };
	}
	// ── Public API ────────────────────────────────────────────────────────

	return {
		/** Number of entries in the timeline. */
		get length() {
			return timeline.length;
		},
		/**
		 * The current entry, validated and typed. Returns `null` if no entries
		 * exist. Recomputed on every access, so do not rely on reference equality
		 * between calls.
		 */
		get currentEntry(): TextEntry | null {
			const last =
				timeline.length > 0 ? timeline.get(timeline.length - 1) : undefined;
			return readEntry(last);
		},

		/** Read the current entry as a plain string. Empty when there is none. */
		read(): string {
			const entry = this.currentEntry;
			return entry ? entry.content.toString() : '';
		},

		/** Write string content to the current entry in a single transaction. */
		write(text: string) {
			ydoc.transact(() => {
				const entry = this.currentEntry;
				if (!entry) {
					pushText(text);
					return;
				}
				// Overwrite existing Y.Text in-place (select-all + paste)
				entry.content.delete(0, entry.content.length);
				entry.content.insert(0, text);
			});
		},

		/** Append text to the current entry, or seed one if the timeline is empty. */
		appendText(text: string) {
			ydoc.transact(() => {
				const entry = this.currentEntry;
				if (!entry) {
					pushText(text);
					return;
				}
				// Append directly to existing Y.Text. No new entry.
				entry.content.insert(entry.content.length, text);
			});
		},

		/**
		 * Get current content as Y.Text for editor binding. Pushes an empty text
		 * entry when the timeline is empty, so callers must gate on local
		 * hydration before binding (see opensidian's ContentEditor).
		 */
		asText(): Y.Text {
			const entry = this.currentEntry;
			if (!entry) return ydoc.transact(() => pushText('')).content;
			return entry.content;
		},

		/** Batch mutations into a single Yjs transaction. */
		batch(fn: () => void) {
			ydoc.transact(fn);
		},

		/**
		 * Watch for structural timeline changes, such as entries added or removed.
		 * Re-read `currentEntry` in the callback to get the new state.
		 *
		 * @returns Unsubscribe function.
		 */
		observe(callback: () => void): () => void {
			const handler = () => callback();
			timeline.observe(handler);
			return () => timeline.unobserve(handler);
		},
	};
}

export type Timeline = ReturnType<typeof attachTimeline>;
