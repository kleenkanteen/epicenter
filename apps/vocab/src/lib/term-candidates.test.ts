/**
 * Term Candidate Tests
 *
 * Verifies the model prompt and parser that turn one settled tutor message into
 * transient savable term candidates.
 *
 * Key behaviors:
 * - Prompt stays language-neutral and requests spans only
 * - Parser accepts clean one-span-per-line output
 * - Parser strips common model formatting without inventing terms
 */
import { describe, expect, test } from 'bun:test';
import {
	buildTermCandidatePrompt,
	parseTermCandidates,
} from './term-candidates.js';

describe('buildTermCandidatePrompt', () => {
	test('names no target or source language: the tutor persona owns that', () => {
		const prompt = buildTermCandidatePrompt().toLowerCase();
		for (const leak of ['chinese', 'mandarin', 'english', 'pinyin', '简体']) {
			expect(prompt).not.toContain(leak);
		}
	});

	test('asks for spans only, no meaning or gloss', () => {
		const prompt = buildTermCandidatePrompt().toLowerCase();
		expect(prompt).toContain('one span per line');
		expect(prompt).toContain('do not add a meaning');
	});
});

describe('parseTermCandidates', () => {
	test('clean one-span-per-line input passes through verbatim, in order', () => {
		const raw = '你好\n学习中文\n一鸣惊人';
		expect(parseTermCandidates(raw)).toEqual([
			'你好',
			'学习中文',
			'一鸣惊人',
		]);
	});

	test('preserves inner spacing of a legitimate multi-word phrase', () => {
		expect(parseTermCandidates('by and large')).toEqual(['by and large']);
	});

	test('does not split a hyphenated word without surrounding spaces', () => {
		expect(parseTermCandidates('state-of-the-art')).toEqual([
			'state-of-the-art',
		]);
	});

	test('strips numbered list markers', () => {
		const raw = '1. 你好\n2) 学习\n3. 谢谢';
		expect(parseTermCandidates(raw)).toEqual(['你好', '学习', '谢谢']);
	});

	test('strips bullet markers (-, *, •)', () => {
		const raw = '- 你好\n* 学习\n• 谢谢';
		expect(parseTermCandidates(raw)).toEqual(['你好', '学习', '谢谢']);
	});

	test('recovers the span when the model appends a gloss', () => {
		const raw = '学习 - to study\n一鸣惊人 — to amaze everyone';
		expect(parseTermCandidates(raw)).toEqual(['学习', '一鸣惊人']);
	});

	test('recovers the span across a colon gloss (full-width and ascii)', () => {
		const raw = '你好：hello\n谢谢: thank you';
		expect(parseTermCandidates(raw)).toEqual(['你好', '谢谢']);
	});

	test('drops header and preamble lines ending in a colon', () => {
		const raw = 'Vocabulary:\n你好\n学习\n关键词：';
		expect(parseTermCandidates(raw)).toEqual(['你好', '学习']);
	});

	test('strips markdown emphasis and backtick wrapping', () => {
		const raw = '**你好**\n`学习`\n*谢谢*';
		expect(parseTermCandidates(raw)).toEqual(['你好', '学习', '谢谢']);
	});

	test('drops code-fence lines and blank lines', () => {
		const raw = '```\n你好\n\n学习\n```';
		expect(parseTermCandidates(raw)).toEqual(['你好', '学习']);
	});

	test('dedupes to the first occurrence, order preserved', () => {
		const raw = '你好\n学习\n你好\n谢谢\n学习';
		expect(parseTermCandidates(raw)).toEqual(['你好', '学习', '谢谢']);
	});

	test('empty or whitespace-only input yields no candidates', () => {
		expect(parseTermCandidates('')).toEqual([]);
		expect(parseTermCandidates('\n  \n\t\n')).toEqual([]);
	});

	test('handles a numbered list that also carries a gloss', () => {
		const raw = '1. 学习 - to study\n2. 你好 - hello';
		expect(parseTermCandidates(raw)).toEqual(['学习', '你好']);
	});
});
