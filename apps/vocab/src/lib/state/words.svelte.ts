/**
 * Reactive words state: the user-curated word pool captured from chat.
 *
 * Backed by `fromTable()` over the `words` table for reads and the connected
 * table's `set` / `update` / `delete` for writes. One device-wide singleton,
 * like `dictation` and `inferenceConnections`: there is one word pool per
 * workspace, not one per component.
 */

import { InstantString } from '@epicenter/field';
import { fromTable } from '@epicenter/svelte';
import { generateWordId, type Word, type WordId } from '@epicenter/vocab';
import { glossFor } from '$lib/gloss';
import { vocab } from '$lib/vocab';

function createWordsState() {
	const wordsView = fromTable(vocab.tables.words);

	/** Every saved word, newest first. */
	const words = $derived(
		wordsView.all.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt)),
	);

	/** Count of words marked known, for the sidebar group label. */
	const knownCount = $derived(
		words.filter((word) => word.status === 'known').length,
	);

	return {
		get words() {
			return words;
		},
		get knownCount() {
			return knownCount;
		},

		/**
		 * Capture a term tapped in the chat. Trims and dedupes by term: a
		 * double-tap or a re-tap of an already-saved word is a no-op, not a
		 * duplicate row. The gloss comes from `glossFor` (empty until the
		 * dictionary lands) and is user-editable afterward.
		 */
		capture(term: string) {
			const trimmed = term.trim();
			if (!trimmed) return false;
			if (words.some((word) => word.term === trimmed)) return false;
			vocab.tables.words.set({
				id: generateWordId(),
				term: trimmed,
				gloss: glossFor(trimmed),
				status: 'new',
				createdAt: InstantString.now(),
			});
			return true;
		},

		/**
		 * Manually add a word, the escape hatch for terms the chat never
		 * surfaced. Same trim-and-dedupe as `capture`.
		 */
		add({ term, gloss }: { term: string; gloss: string }) {
			const trimmed = term.trim();
			if (!trimmed) return false;
			if (words.some((word) => word.term === trimmed)) return false;
			vocab.tables.words.set({
				id: generateWordId(),
				term: trimmed,
				gloss: gloss.trim(),
				status: 'new',
				createdAt: InstantString.now(),
			});
			return true;
		},

		/** Change a word's mastery status. */
		setStatus(id: WordId, status: Word['status']) {
			vocab.tables.words.update(id, { status });
		},

		/** Edit a word's gloss (user-editable by design; see `glossFor`). */
		setGloss(id: WordId, gloss: string) {
			vocab.tables.words.update(id, { gloss });
		},

		/** Remove a word from the pool. */
		remove(id: WordId) {
			vocab.tables.words.delete(id);
		},
	};
}

export const wordsState = createWordsState();
