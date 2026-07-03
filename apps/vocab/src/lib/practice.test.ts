import { describe, expect, test } from 'bun:test';
import { buildPracticePrompt } from './practice.js';

describe('buildPracticePrompt', () => {
	test('lists each term verbatim, one bullet per term, in order', () => {
		const prompt = buildPracticePrompt(['你好', '学习中文', 'chengyu']);
		expect(prompt).toContain('- 你好\n- 学习中文\n- chengyu');
	});

	test('does not normalize or trim the given text', () => {
		const prompt = buildPracticePrompt(['  spaced  phrase  ']);
		expect(prompt).toContain('-   spaced  phrase  ');
	});

	test('names no target or source language: the tutor persona owns that', () => {
		const prompt = buildPracticePrompt(['你好']).toLowerCase();
		for (const leak of ['chinese', 'mandarin', 'english', 'pinyin', '简体']) {
			expect(prompt).not.toContain(leak);
		}
	});

	test('handles a single term', () => {
		expect(buildPracticePrompt(['你好'])).toContain('- 你好');
	});
});
