/**
 * Super Chat attach sealing (ADR-0115 wave 4): authenticated, content-blind
 * encryption that rides above the AttachRelay so a Cloud relay forwards only
 * ciphertext and the endpoint envelope. This module owns all of the crypto; the
 * relay coordinator (`packages/server/src/attach-relay/core.ts`) stays
 * byte-forwarding, key-blind, and frame-blind, and never imports this file.
 * Sealing is a layer strictly above the transport, exactly as ADR-0115 clause 5
 * frames it, and it lives in the Super Chat adapters (clause 4), never in the
 * shared relay package.
 *
 * ## What crosses the relay
 *
 * Everything the relay forwards is the opaque `payload` string. This module puts
 * two kinds of frame in it, both discriminated by a `k` field the relay never
 * reads:
 *
 * - `{ k: 'hs', ... }`  a handshake frame carrying ephemeral public keys and
 *   key-confirmation MACs. It carries no session content, so it is safe in the
 *   clear; its integrity is what the PSK authenticates.
 * - `{ k: 'seal', n, ct }`  a sealed application frame: `ct` is XChaCha20-Poly1305
 *   ciphertext of one Super Chat command or snapshot, `n` its per-direction nonce
 *   counter. The relay sees neither the command type nor the content.
 *
 * ## The key agreement, and what authenticates it
 *
 * Each attach session runs a fresh ephemeral ECDH (P-256, Web Crypto) so the
 * AEAD keys have forward secrecy: a later PSK compromise does not decrypt a past
 * session, because its ephemeral private keys are gone. The exchange is
 * authenticated by a pairing pre-shared key (the PSK): both sides derive a
 * `macKey` from `HKDF(salt = PSK, ikm = ECDH shared)` and send an HMAC over the
 * transcript (protocol label plus both ephemeral public keys). A relay that
 * substitutes an ephemeral key changes the transcript on one side, so the
 * confirmation MAC fails and no session is established. The relay never learns
 * the PSK, so it cannot forge a MAC and cannot man-in-the-middle the channel.
 *
 * ### Why the PSK is not the device grant
 *
 * The wave-3 device grant authenticates the socket TO the relay: the client
 * presents it as `bearer.<grant>` and the mount hashes and compares it, so the
 * relay sees the raw grant transiently on every connect. A secret the relay sees
 * cannot defeat a malicious relay, so the anti-MITM secret must be one the relay
 * never sees. The PSK is that secret: it is a pairing artifact shared only
 * between the two endpoints (the QR/paste of ADR-0115 clause 3), never sent to
 * the relay. Two questions, two secrets: the grant answers "may this socket
 * connect," the PSK answers "is my peer the device I paired with." This module
 * takes the PSK as an injected pairing artifact and does not mint it; deriving
 * the grant and the PSK from one pairing secret is an account-layer refinement
 * left to a later wave.
 *
 * ## Nonce discipline
 *
 * Each direction has its own AEAD key (`keyH2C`, `keyC2H`) and its own monotonic
 * counter starting at 0, so a `(key, nonce)` pair is never reused. The 24-byte
 * XChaCha nonce is the big-endian counter in its low 8 bytes. A receiver requires
 * a strictly increasing counter, so a replayed or reordered frame is rejected
 * before decryption.
 */

import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';

/**
 * A pairing pre-shared key: the out-of-band secret shared between the host and
 * one paired client (a QR scan or a paste). A string is read as its UTF-8 bytes;
 * raw bytes are used as-is.
 */
export type SealPsk = Uint8Array | string;

/** One client endpoint, the addressing pair the host seals per attached device. */
export type SealEndpoint = { deviceId: string; attachId: string };

/** The versioned protocol label, mixed into every derived key so a version bump cannot collide. */
const PROTOCOL = 'epicenter/attach-seal/v1';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function normalizePsk(psk: SealPsk): Uint8Array {
	return typeof psk === 'string' ? textEncoder.encode(psk) : psk;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
	const total = parts.reduce((sum, part) => sum + part.length, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}

/** Portable base64 for the wire; sizes here (65-byte keys, small frames) suit `btoa`/`atob`. */
function bytesToBase64(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
	const binary = atob(value);
	const out = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
	return out;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i += 1)
		diff |= (a[i] as number) ^ (b[i] as number);
	return diff === 0;
}

/** Generate one ephemeral P-256 key pair; the public key is exported raw (65 bytes) for the wire. */
async function generateEphemeral(): Promise<{
	privateKey: CryptoKey;
	publicKeyRaw: Uint8Array;
}> {
	const pair = await crypto.subtle.generateKey(
		{ name: 'ECDH', namedCurve: 'P-256' },
		true,
		['deriveBits'],
	);
	const publicKeyRaw = new Uint8Array(
		await crypto.subtle.exportKey('raw', pair.publicKey),
	);
	return { privateKey: pair.privateKey, publicKeyRaw };
}

/** ECDH: our ephemeral private key against the peer's raw ephemeral public key. */
async function deriveSharedSecret(
	privateKey: CryptoKey,
	peerPublicKeyRaw: Uint8Array,
): Promise<Uint8Array> {
	const peerKey = await crypto.subtle.importKey(
		'raw',
		peerPublicKeyRaw as BufferSource,
		{ name: 'ECDH', namedCurve: 'P-256' },
		false,
		[],
	);
	const bits = await crypto.subtle.deriveBits(
		{ name: 'ECDH', public: peerKey },
		privateKey,
		256,
	);
	return new Uint8Array(bits);
}

/**
 * The keys one session runs on, derived from the ECDH shared secret with the PSK
 * as HKDF salt, so every key depends on BOTH the ephemeral agreement and the
 * pairing secret. The transcript (protocol label plus both public keys) binds the
 * keys to the exact exchange, which is what makes a substituted key detectable.
 */
type SessionKeys = {
	/** Host-to-client AEAD key. */
	keyHostToClient: Uint8Array;
	/** Client-to-host AEAD key. */
	keyClientToHost: Uint8Array;
	/** Key for the handshake confirmation MACs. */
	macKey: Uint8Array;
	/** The bound transcript both MACs cover. */
	transcript: Uint8Array;
};

function deriveSessionKeys(
	sharedSecret: Uint8Array,
	psk: Uint8Array,
	hostPublicKey: Uint8Array,
	clientPublicKey: Uint8Array,
): SessionKeys {
	const transcript = concatBytes(
		textEncoder.encode(PROTOCOL),
		hostPublicKey,
		clientPublicKey,
	);
	const master = hkdf(
		sha256,
		sharedSecret,
		psk,
		concatBytes(textEncoder.encode('master|'), transcript),
		32,
	);
	const expand = (label: string): Uint8Array =>
		hkdf(sha256, master, undefined, textEncoder.encode(label), 32);
	return {
		keyHostToClient: expand('h2c'),
		keyClientToHost: expand('c2h'),
		macKey: expand('confirm'),
		transcript,
	};
}

function confirmationTag(
	macKey: Uint8Array,
	role: 'host' | 'client',
	transcript: Uint8Array,
): Uint8Array {
	return hmac(
		sha256,
		macKey,
		concatBytes(textEncoder.encode(`${role}|`), transcript),
	);
}

function nonceForCounter(counter: number): Uint8Array {
	const nonce = new Uint8Array(24);
	new DataView(nonce.buffer).setBigUint64(16, BigInt(counter), false);
	return nonce;
}

/** Seal one plaintext into a `{ k: 'seal', n, ct }` wire frame under `key` and `counter`. */
function sealFrame(
	key: Uint8Array,
	counter: number,
	plaintext: string,
): string {
	const ciphertext = xchacha20poly1305(key, nonceForCounter(counter)).encrypt(
		textEncoder.encode(plaintext),
	);
	return JSON.stringify({
		k: 'seal',
		n: counter,
		ct: bytesToBase64(ciphertext),
	});
}

/**
 * A stream reader for one direction: opens sealed frames under `key`, rejecting a
 * frame whose counter does not strictly advance (a replay or reorder).
 */
function createSealReader(
	key: Uint8Array,
): (envelope: SealDataFrame) => string | undefined {
	let lastCounter = -1;
	return (envelope) => {
		if (envelope.n <= lastCounter) return undefined;
		let plaintext: Uint8Array;
		try {
			plaintext = xchacha20poly1305(key, nonceForCounter(envelope.n)).decrypt(
				base64ToBytes(envelope.ct),
			);
		} catch {
			return undefined;
		}
		lastCounter = envelope.n;
		return textDecoder.decode(plaintext);
	};
}

type SealDataFrame = { k: 'seal'; n: number; ct: string };
type HandshakeFrame = {
	k: 'hs';
	s: 'offer' | 'accept' | 'confirm';
	epk?: string;
	mac?: string;
};

function parseFrame(
	payload: string,
): SealDataFrame | HandshakeFrame | undefined {
	let value: unknown;
	try {
		value = JSON.parse(payload);
	} catch {
		return undefined;
	}
	if (value === null || typeof value !== 'object') return undefined;
	const record = value as Record<string, unknown>;
	if (
		record.k === 'seal' &&
		typeof record.n === 'number' &&
		typeof record.ct === 'string'
	) {
		return { k: 'seal', n: record.n, ct: record.ct };
	}
	if (
		record.k === 'hs' &&
		(record.s === 'offer' || record.s === 'accept' || record.s === 'confirm')
	) {
		return {
			k: 'hs',
			s: record.s,
			epk: typeof record.epk === 'string' ? record.epk : undefined,
			mac: typeof record.mac === 'string' ? record.mac : undefined,
		};
	}
	return undefined;
}

/** The host's view of one inbound payload from a client endpoint. */
export type HostInbound =
	/** A sealed client command, decrypted to its plaintext. */
	| { type: 'command'; plaintext: string }
	/** A handshake frame the session consumed. */
	| { type: 'handshake' }
	/** Not understood or rejected (a bad MAC, a replay, a frame before ready). */
	| { type: 'drop' };

/** One host-side seal session, one per attached client endpoint. */
export type HostSealSession = {
	/**
	 * Feed one inbound payload string from this endpoint. Never rejects: a
	 * malformed or hostile frame resolves to a `drop`, so the relay cannot turn
	 * garbage into an unhandled rejection.
	 */
	handleInbound(payload: string): Promise<HostInbound>;
	/** Seal an app plaintext for this endpoint, or `undefined` until the handshake completes. */
	seal(plaintext: string): string | undefined;
	/** True once the client authenticated and the session can carry sealed frames. */
	readonly ready: boolean;
};

/**
 * Start a host seal session for one client endpoint. Returns synchronously so the
 * caller can register the session before any inbound frame is routed to it, then
 * generates the host's ephemeral key and emits the handshake offer through `send`
 * once it is ready. `handleInbound` awaits that same ephemeral, so an accept that
 * races ahead of the offer is still processed in order. The session becomes
 * {@link HostSealSession.ready} on the client's authenticated accept, at which
 * point `onReady` fires so the host can push the first sealed snapshot.
 */
export function startHostSealSession(opts: {
	psk: SealPsk;
	send: (payload: string) => void;
	onReady: () => void;
}): HostSealSession {
	const psk = normalizePsk(opts.psk);
	const ephemeralPromise = generateEphemeral();
	let keys: SessionKeys | undefined;
	let readSealed: ((envelope: SealDataFrame) => string | undefined) | undefined;
	let sendCounter = 0;
	let ready = false;

	// Offer the host's ephemeral public key once it is generated. The client
	// answers with its own key and a MAC that proves it holds the PSK and saw
	// this exact offer.
	void ephemeralPromise.then((ephemeral) =>
		opts.send(
			JSON.stringify({
				k: 'hs',
				s: 'offer',
				epk: bytesToBase64(ephemeral.publicKeyRaw),
			}),
		),
	);

	return {
		get ready() {
			return ready;
		},
		async handleInbound(payload) {
			const frame = parseFrame(payload);
			if (!frame) return { type: 'drop' };
			const ephemeral = await ephemeralPromise;
			if (frame.k === 'hs') {
				try {
					if (frame.s !== 'accept' || ready || !frame.epk || !frame.mac) {
						return { type: 'drop' };
					}
					const clientPublicKey = base64ToBytes(frame.epk);
					const sharedSecret = await deriveSharedSecret(
						ephemeral.privateKey,
						clientPublicKey,
					);
					const derived = deriveSessionKeys(
						sharedSecret,
						psk,
						ephemeral.publicKeyRaw,
						clientPublicKey,
					);
					const expectedClientMac = confirmationTag(
						derived.macKey,
						'client',
						derived.transcript,
					);
					// The MITM check: a relay that swapped the offered key changes the
					// transcript the client MAC'd, so this comparison fails and no session
					// is established.
					if (!timingSafeEqual(base64ToBytes(frame.mac), expectedClientMac)) {
						return { type: 'drop' };
					}
					keys = derived;
					readSealed = createSealReader(derived.keyClientToHost);
					opts.send(
						JSON.stringify({
							k: 'hs',
							s: 'confirm',
							mac: bytesToBase64(
								confirmationTag(derived.macKey, 'host', derived.transcript),
							),
						}),
					);
					ready = true;
					opts.onReady();
					return { type: 'handshake' };
				} catch {
					// A malformed key or MAC (bad base64, an off-curve point) is just a
					// failed handshake, not a crash: drop it, so a hostile relay cannot
					// turn garbage handshake bytes into an unhandled rejection. Fail-closed.
					return { type: 'drop' };
				}
			}
			if (!ready || !readSealed) return { type: 'drop' };
			const plaintext = readSealed(frame);
			return plaintext === undefined
				? { type: 'drop' }
				: { type: 'command', plaintext };
		},
		seal(plaintext) {
			if (!ready || !keys) return undefined;
			const frame = sealFrame(keys.keyHostToClient, sendCounter, plaintext);
			sendCounter += 1;
			return frame;
		},
	};
}

/** The client's view of one inbound payload from the host. */
export type ClientInbound =
	/** A sealed host snapshot, decrypted to its plaintext. */
	| { type: 'snapshot'; plaintext: string }
	/** A handshake frame the session consumed (no state change to surface). */
	| { type: 'handshake' }
	/** The handshake just completed; the session is now ready. */
	| { type: 'ready' }
	/** Not understood or rejected. */
	| { type: 'drop' };

/** One client-side seal session for the attach to a host endpoint. */
export type ClientSealSession = {
	/**
	 * Feed one inbound payload string forwarded from the host. Never rejects: a
	 * malformed or hostile frame resolves to a `drop`, so the relay cannot turn
	 * garbage into an unhandled rejection.
	 */
	handleInbound(payload: string): Promise<ClientInbound>;
	/** Seal an app plaintext for the host, or `undefined` until the handshake completes. */
	seal(plaintext: string): string | undefined;
	/** True once the host authenticated and the session can carry sealed frames. */
	readonly ready: boolean;
};

/**
 * Create a client seal session. It stays idle until the host's offer arrives:
 * on the offer it derives keys, sends its authenticated accept, and waits for the
 * host's confirm before it is {@link ClientSealSession.ready}. `onReady` fires
 * once, when the host's confirm MAC verifies.
 */
export function createClientSealSession(opts: {
	psk: SealPsk;
	send: (payload: string) => void;
	onReady: () => void;
}): ClientSealSession {
	const psk = normalizePsk(opts.psk);
	let keys: SessionKeys | undefined;
	let readSealed: ((envelope: SealDataFrame) => string | undefined) | undefined;
	let sendCounter = 0;
	let ready = false;

	return {
		get ready() {
			return ready;
		},
		async handleInbound(payload) {
			const frame = parseFrame(payload);
			if (!frame) return { type: 'drop' };
			if (frame.k === 'hs') {
				try {
					if (frame.s === 'offer' && !keys && frame.epk) {
						const hostPublicKey = base64ToBytes(frame.epk);
						const ephemeral = await generateEphemeral();
						const sharedSecret = await deriveSharedSecret(
							ephemeral.privateKey,
							hostPublicKey,
						);
						keys = deriveSessionKeys(
							sharedSecret,
							psk,
							hostPublicKey,
							ephemeral.publicKeyRaw,
						);
						readSealed = createSealReader(keys.keyHostToClient);
						opts.send(
							JSON.stringify({
								k: 'hs',
								s: 'accept',
								epk: bytesToBase64(ephemeral.publicKeyRaw),
								mac: bytesToBase64(
									confirmationTag(keys.macKey, 'client', keys.transcript),
								),
							}),
						);
						return { type: 'handshake' };
					}
					if (frame.s === 'confirm' && keys && !ready && frame.mac) {
						const expectedHostMac = confirmationTag(
							keys.macKey,
							'host',
							keys.transcript,
						);
						// The MITM check on the client side: a swapped host key fails here.
						if (!timingSafeEqual(base64ToBytes(frame.mac), expectedHostMac)) {
							return { type: 'drop' };
						}
						ready = true;
						opts.onReady();
						return { type: 'ready' };
					}
					return { type: 'drop' };
				} catch {
					// A malformed key or MAC (bad base64, an off-curve point) is just a
					// failed handshake, not a crash: drop it, so a hostile relay cannot
					// turn garbage handshake bytes into an unhandled rejection. Fail-closed.
					return { type: 'drop' };
				}
			}
			if (!ready || !readSealed) return { type: 'drop' };
			const plaintext = readSealed(frame);
			return plaintext === undefined
				? { type: 'drop' }
				: { type: 'snapshot', plaintext };
		},
		seal(plaintext) {
			if (!ready || !keys) return undefined;
			const frame = sealFrame(keys.keyClientToHost, sendCounter, plaintext);
			sendCounter += 1;
			return frame;
		},
	};
}
