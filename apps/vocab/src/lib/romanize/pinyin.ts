import type { Romanizer, Segment } from '@epicenter/ui/markdown';
import { pinyin } from 'pinyin-pro';

/** CJK Unified Ideographs (simplified + traditional Chinese). */
const CJK_REGEX = /[一-鿿㐀-䶿豈-﫿]+/g;

/**
 * Hiragana + katakana (`぀-ヿ`) and hangul syllables
 * (`가-힣`). Their presence marks a run as Japanese or Korean, where
 * shared Han characters take non-Mandarin readings (今日 is `kyō`, not the
 * Mandarin reading of 今 + 日). When any appears we omit readings for the whole
 * run rather than stamp a wrong one: a missing reading is safe, a wrong one
 * teaches the wrong pronunciation.
 *
 * Residual gap (accepted): a pure-Han run with no kana or hangul in the same
 * text leaf still reads as Mandarin. The designed fix for real multi-script
 * readings is not a second local library. It is a lazy, round-trip-validated
 * AI annotation (a sibling of `harvest.ts`: settled message, one-shot
 * `complete()`, lenient parse) that emits `[base]{reading}` parsed by a sync
 * romanizer through this same `Romanizer` seam. Build it only when a
 * non-Chinese, non-Latin script is actually being studied (ADR-0104).
 */
const JAPANESE_KOREAN_REGEX = /[぀-ヿ가-힣]/;

/**
 * Per-character pinyin for Chinese runs; every other run (Latin, punctuation,
 * whitespace, HTML entities) passes through with no reading. The returned
 * segments cover the whole input in order, so concatenating their `text`
 * reproduces it exactly.
 *
 * Fails safe on Japanese/Korean text: a run carrying kana or hangul is passed
 * through untouched (see {@link JAPANESE_KOREAN_REGEX}) so Han glyphs shared
 * across those languages never receive a Mandarin reading.
 */
export const pinyinRomanizer: Romanizer = (text) => {
	if (JAPANESE_KOREAN_REGEX.test(text)) return [{ text }];
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
		for (const char of run) {
			segments.push({
				text: char,
				reading: readings[charIndex] ?? '',
			});
			charIndex++;
		}
		lastIndex = match.index + run.length;
		match = regex.exec(text);
	}
	if (lastIndex < text.length) {
		segments.push({ text: text.slice(lastIndex) });
	}
	return segments;
};
