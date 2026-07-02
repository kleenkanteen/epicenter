/**
 * Yjs Sync Protocol Encoding/Decoding Utilities
 *
 * Pure functions for encoding and decoding the binary WebSocket channel.
 *
 * The binary channel carries exactly one message family: Yjs document
 * sync. A binary frame *is* a sync frame, so there is no top-level
 * message-type varint; the first varint is the sync sub-type (STEP1,
 * STEP2, or UPDATE). This is byte-identical to raw y-protocols/sync
 * framing. Wire-format versioning, if ever needed, rides the WebSocket
 * subprotocol (`MAIN_SUBPROTOCOL`), not an in-band discriminator.
 *
 * Presence and relay-channel frames ride WebSocket *text* frames, not this
 * channel.
 *
 * All sync payloads use Yjs V2 encoding for ~40% smaller wire size.
 * State vectors are version-independent (same format for V1 and V2).
 *
 * Pure encoder/decoder functions: protocol only, no transport logic.
 *
 * Encoders return `Uint8Array<ArrayBuffer>`: lib0 always copies into a fresh
 * plain buffer, and transports rely on the narrow type (`WebSocket.send`'s
 * DOM typing rejects `ArrayBufferLike`-backed views). Don't widen these
 * return annotations back to bare `Uint8Array`.
 */

import * as encoding from 'lib0/encoding';
import * as Y from 'yjs';

// ============================================================================
// Sync Protocol (V2 encoding)
// ============================================================================

/**
 * Sub-message types within sync frames.
 * Derived from y-protocols/sync constants for consistency.
 *
 * This is the first (and only) varint preceding the payload in a binary
 * WebSocket frame.
 */
export const SYNC_MESSAGE_TYPE = {
	/** Initial handshake: "here's my state vector, what am I missing?" */
	STEP1: 0,
	/** Response to STEP1: "here are the updates you're missing" */
	STEP2: 1,
	/** Incremental document update broadcast */
	UPDATE: 2,
} as const;

export type SyncMessageType =
	(typeof SYNC_MESSAGE_TYPE)[keyof typeof SYNC_MESSAGE_TYPE];

/**
 * Encodes a sync step 1 message containing the document's state vector.
 *
 * This is the first message in the Yjs sync protocol handshake. The server
 * sends its state vector to the client, asking "what updates do you have
 * that I'm missing?" The client responds with sync step 2 containing any
 * updates the server doesn't have.
 *
 * State vector encoding is version-independent (same for V1 and V2).
 *
 * @param options.doc - The Yjs document to get the state vector from
 * @returns Encoded message ready to send over WebSocket
 */
export function encodeSyncStep1({
	doc,
}: {
	doc: Y.Doc;
}): Uint8Array<ArrayBuffer> {
	return encoding.encode((encoder) => {
		encoding.writeVarUint(encoder, SYNC_MESSAGE_TYPE.STEP1);
		encoding.writeVarUint8Array(encoder, Y.encodeStateVector(doc));
	});
}

/**
 * Encodes a document update message for broadcasting to clients.
 *
 * After initial sync, any changes to the document are broadcast as update
 * messages. These are incremental and can be applied in any order due to
 * Yjs's CRDT properties.
 *
 * @param options.update - V2-encoded Yjs update bytes (from doc.on('updateV2'))
 * @returns Encoded message ready to send over WebSocket
 */
export function encodeSyncUpdate({
	update,
}: {
	update: Uint8Array;
}): Uint8Array<ArrayBuffer> {
	return encoding.encode((encoder) => {
		encoding.writeVarUint(encoder, SYNC_MESSAGE_TYPE.UPDATE);
		encoding.writeVarUint8Array(encoder, update);
	});
}

/**
 * Handle a decoded sync sub-message and return a response if needed.
 *
 * Pre-decoded alternative to y-protocols' `readSyncMessage`: accepts already-
 * decoded `syncType` and `payload` instead of a mutable lib0 decoder. The
 * caller reads these two fields from the decoder inline.
 *
 * Dispatches on the three sync sub-types (all V2 encoded):
 * - STEP1: `payload` is a state vector, responds with a V2 diff (STEP2)
 * - STEP2: `payload` is a V2 update, applied to doc, no response
 * - UPDATE: `payload` is a V2 update, applied to doc, no response
 *
 * @param options.syncType - Which sync sub-message (STEP1, STEP2, or UPDATE)
 * @param options.payload - The sub-message bytes (state vector for STEP1, V2 update for STEP2/UPDATE)
 * @param options.doc - The Yjs document to sync. Mutated for STEP2/UPDATE via applyUpdateV2.
 * @param options.origin - Transaction origin passed to applyUpdateV2 (typically the connection, used to prevent echo)
 * @returns Encoded response message for STEP1, null otherwise
 */
export function handleSyncPayload({
	syncType,
	payload,
	doc,
	origin,
}: {
	syncType: SyncMessageType;
	payload: Uint8Array;
	doc: Y.Doc;
	origin: unknown;
}): Uint8Array<ArrayBuffer> | null {
	switch (syncType) {
		case SYNC_MESSAGE_TYPE.STEP1: {
			const diff = Y.encodeStateAsUpdateV2(doc, payload);
			return encoding.encode((encoder) => {
				encoding.writeVarUint(encoder, SYNC_MESSAGE_TYPE.STEP2);
				encoding.writeVarUint8Array(encoder, diff);
			});
		}
		case SYNC_MESSAGE_TYPE.STEP2:
		case SYNC_MESSAGE_TYPE.UPDATE: {
			Y.applyUpdateV2(doc, payload, origin);
			return null;
		}
		default:
			return null;
	}
}
