/**
 * attach-timeline: an append-only, single-layout (text) document body.
 *
 * `attachTimeline` reserves `ydoc.getArray('timeline')` as the storage for a
 * single text body and exposes text accessors (`read`, `write`, `appendText`,
 * `asText`, `observe`). The durable `timeline` slot and its entry shape are
 * frozen; the polymorphic (rich-text/sheet) surface was refused by ADR-0106.
 *
 * @module
 */

export { attachTimeline, type Timeline } from './timeline.js';
