/**
 * Compile a set of saved entries into a practice request: the user turn Vocab's
 * focus surface sends into a conversation. It lists the verbatim entry text and
 * asks for a short passage that puts them in context.
 *
 * Deliberately language-neutral: it names no target or source language, so the
 * conversation's tutor persona stays the single owner of which language the
 * passage and its explanation come back in. That keeps the future language
 * profile seam in one place and this path free of language-specific strings.
 *
 * It reads only entry text and writes nothing. The compiled passage is an
 * ordinary assistant turn in the human-owned transcript, never entry metadata
 * (ADR-0102): no entry is marked practiced, and nothing is auto-saved back.
 */
export function buildPracticePrompt(entryTexts: string[]): string {
	const list = entryTexts.map((text) => `- ${text}`).join('\n');
	return `Using the entries I'm learning below, write a short, natural passage or dialogue that puts them in context at my level, then briefly explain the parts that are tricky.\n\nEntries:\n${list}`;
}
