import type { Romanizer, Segment } from '@epicenter/ui/markdown';
import { pinyin } from 'pinyin-pro';

/** CJK Unified Ideographs (simplified + traditional Chinese). */
const CJK_REGEX = /[一-鿿㐀-䶿豈-﫿]+/g;

/**
 * Word-level segmenter for Chinese, constructed once at module scope: splits a
 * CJK run into the words a learner would tap as one unit (e.g. 你好 -> `['你好']`,
 * 学习中文 -> `['学习', '中文']`).
 */
const wordSegmenter = new Intl.Segmenter('zh-Hans', { granularity: 'word' });

/**
 * Per-character pinyin for Chinese runs; every other run (Latin, punctuation,
 * whitespace, HTML entities) passes through with no reading. The returned
 * segments cover the whole input in order, so concatenating their `text`
 * reproduces it exactly.
 *
 * Each CJK character segment also carries `term`: the containing word, from
 * {@link wordSegmenter}. A tap anywhere in a multi-character word (via
 * `Ruby`'s tap target) captures the whole word, not just the tapped
 * character.
 */
export const pinyinRomanizer: Romanizer = (text) => {
	const segments: Segment[] = [];
	const regex = new RegExp(CJK_REGEX);
	let lastIndex = 0;
	let match: RegExpExecArray | null = regex.exec(text);
	while (match !== null) {
		if (match.index > lastIndex) {
			segments.push({ text: text.slice(lastIndex, match.index) });
		}
		const run = match[0];
		const readings = pinyin(run, { type: 'array' });
		let charIndex = 0;
		for (const { segment: word } of wordSegmenter.segment(run)) {
			for (const char of word) {
				segments.push({
					text: char,
					reading: readings[charIndex] ?? '',
					term: word,
				});
				charIndex++;
			}
		}
		lastIndex = match.index + run.length;
		match = regex.exec(text);
	}
	if (lastIndex < text.length) {
		segments.push({ text: text.slice(lastIndex) });
	}
	return segments;
};
