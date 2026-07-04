/**
 * attach-timeline: an append-only, single-layout (text) document body.
 *
 * `attachTimeline` reserves `ydoc.getArray('timeline')` as a log of typed
 * entries and exposes text accessors (`read`, `write`, `appendText`,
 * `asText`). The durable `timeline` slot and its entry shape are frozen;
 * the polymorphic (rich-text/sheet) surface was refused by ADR-0106.
 *
 * @module
 */

export { attachTimeline, type TextEntry, type Timeline } from './timeline.js';
