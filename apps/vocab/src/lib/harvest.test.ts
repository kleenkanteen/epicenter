import { describe, expect, test } from 'bun:test';
import { buildHarvestPrompt, parseHarvestCandidates } from './harvest.js';

describe('buildHarvestPrompt', () => {
	test('names no target or source language: the tutor persona owns that', () => {
		const prompt = buildHarvestPrompt().toLowerCase();
		for (const leak of ['chinese', 'mandarin', 'english', 'pinyin', '简体']) {
			expect(prompt).not.toContain(leak);
		}
	});

	test('asks for spans only, no meaning or gloss', () => {
		const prompt = buildHarvestPrompt().toLowerCase();
		expect(prompt).toContain('one span per line');
		expect(prompt).toContain('do not add a meaning');
	});
});

describe('parseHarvestCandidates', () => {
	test('clean one-span-per-line input passes through verbatim, in order', () => {
		const raw = '你好\n学习中文\n一鸣惊人';
		expect(parseHarvestCandidates(raw)).toEqual([
			'你好',
			'学习中文',
			'一鸣惊人',
		]);
	});

	test('preserves inner spacing of a legitimate multi-word phrase', () => {
		expect(parseHarvestCandidates('by and large')).toEqual(['by and large']);
	});

	test('does not split a hyphenated word without surrounding spaces', () => {
		expect(parseHarvestCandidates('state-of-the-art')).toEqual([
			'state-of-the-art',
		]);
	});

	test('strips numbered list markers', () => {
		const raw = '1. 你好\n2) 学习\n3. 谢谢';
		expect(parseHarvestCandidates(raw)).toEqual(['你好', '学习', '谢谢']);
	});

	test('strips bullet markers (-, *, •)', () => {
		const raw = '- 你好\n* 学习\n• 谢谢';
		expect(parseHarvestCandidates(raw)).toEqual(['你好', '学习', '谢谢']);
	});

	test('recovers the span when the model appends a gloss', () => {
		const raw = '学习 - to study\n一鸣惊人 — to amaze everyone';
		expect(parseHarvestCandidates(raw)).toEqual(['学习', '一鸣惊人']);
	});

	test('recovers the span across a colon gloss (full-width and ascii)', () => {
		const raw = '你好：hello\n谢谢: thank you';
		expect(parseHarvestCandidates(raw)).toEqual(['你好', '谢谢']);
	});

	test('drops header and preamble lines ending in a colon', () => {
		const raw = 'Vocabulary:\n你好\n学习\n关键词：';
		expect(parseHarvestCandidates(raw)).toEqual(['你好', '学习']);
	});

	test('strips markdown emphasis and backtick wrapping', () => {
		const raw = '**你好**\n`学习`\n*谢谢*';
		expect(parseHarvestCandidates(raw)).toEqual(['你好', '学习', '谢谢']);
	});

	test('drops code-fence lines and blank lines', () => {
		const raw = '```\n你好\n\n学习\n```';
		expect(parseHarvestCandidates(raw)).toEqual(['你好', '学习']);
	});

	test('dedupes to the first occurrence, order preserved', () => {
		const raw = '你好\n学习\n你好\n谢谢\n学习';
		expect(parseHarvestCandidates(raw)).toEqual(['你好', '学习', '谢谢']);
	});

	test('empty or whitespace-only input yields no candidates', () => {
		expect(parseHarvestCandidates('')).toEqual([]);
		expect(parseHarvestCandidates('\n  \n\t\n')).toEqual([]);
	});

	test('handles a numbered list that also carries a gloss', () => {
		const raw = '1. 学习 - to study\n2. 你好 - hello';
		expect(parseHarvestCandidates(raw)).toEqual(['学习', '你好']);
	});
});
