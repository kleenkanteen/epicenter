/**
 * Meaning lookup for a captured term: the seam where a bundled CC-CEDICT
 * dictionary plugs in later. Phase 1 has no dictionary, so capture saves an
 * empty gloss and the user fills it in from the words list (gloss is
 * user-editable by design; the dictionary only prefills).
 */
export function glossFor(_term: string): string {
	return '';
}
