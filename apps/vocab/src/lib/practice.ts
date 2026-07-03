/**
 * Compile a set of saved terms into a practice request: the user turn Vocab's
 * focus surface sends into a conversation. It lists the verbatim term text and
 * asks for a short passage that puts them in context.
 *
 * Deliberately language-neutral: it names no target or source language, so the
 * conversation's tutor persona stays the single owner of which language the
 * passage and its explanation come back in. That keeps the future language
 * profile seam in one place and this path free of language-specific strings.
 *
 * It reads only term text and writes nothing. The compiled passage is an
 * ordinary assistant turn in the human-owned transcript, never term metadata
 * (ADR-0100): no term is marked practiced, and nothing is auto-saved back.
 */
export function buildPracticePrompt(termTexts: string[]): string {
	const list = termTexts.map((text) => `- ${text}`).join('\n');
	return `Using the terms I'm learning below, write a short, natural passage or dialogue that puts them in context at my level, then briefly explain the parts that are tricky.\n\nTerms:\n${list}`;
}
