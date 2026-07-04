import * as Y from 'yjs';

type TimelineYMap = Y.Map<unknown>;

export function attachTimeline(ydoc: Y.Doc, key = 'timeline') {
	const timeline = ydoc.getArray<TimelineYMap>(key);

	// The body owns a single text layout. Entries are stored as Y.Maps with a
	// frozen shape (`type`/`content`/`createdAt`, ADR-0106); in practice the log
	// holds one text entry, edited in place. `type` and `createdAt` are written
	// for the durable format and a future step-3 migration reader, not read here.

	/** The current entry's text content, or null when the timeline is empty. */
	function currentText(): Y.Text | null {
		if (timeline.length === 0) return null;
		const entry = timeline.get(timeline.length - 1);
		if (entry?.get('type') !== 'text') return null;
		const content = entry.get('content');
		return content instanceof Y.Text ? content : null;
	}

	/** Append a new text entry and return its Y.Text. The stored shape is frozen. */
	function pushText(content: string): Y.Text {
		const entry = new Y.Map();
		entry.set('type', 'text');
		const ytext = new Y.Text();
		ytext.insert(0, content);
		entry.set('content', ytext);
		entry.set('createdAt', Date.now());
		timeline.push([entry]);
		return ytext;
	}

	return {
		/** Read the current entry as a plain string. Empty when there is none. */
		read(): string {
			return currentText()?.toString() ?? '';
		},

		/** Write string content to the current entry, seeding one if empty. */
		write(text: string) {
			ydoc.transact(() => {
				const content = currentText();
				if (!content) {
					pushText(text);
					return;
				}
				// Overwrite existing Y.Text in-place (select-all + paste)
				content.delete(0, content.length);
				content.insert(0, text);
			});
		},

		/** Append text to the current entry, or seed one if the timeline is empty. */
		appendText(text: string) {
			ydoc.transact(() => {
				const content = currentText();
				if (!content) {
					pushText(text);
					return;
				}
				content.insert(content.length, text);
			});
		},

		/**
		 * Get current content as Y.Text for editor binding. Pushes an empty text
		 * entry when the timeline is empty, so callers must gate on local
		 * hydration before binding (see opensidian's ContentEditor).
		 */
		asText(): Y.Text {
			return currentText() ?? ydoc.transact(() => pushText(''));
		},

		/**
		 * Watch for structural timeline changes, such as entries added or removed.
		 * Re-read via `read()`/`asText()` in the callback to get the new state.
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
