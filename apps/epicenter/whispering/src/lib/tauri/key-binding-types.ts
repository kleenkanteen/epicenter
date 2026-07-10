/**
 * The structured shortcut-binding vocabulary, owned by the frontend.
 *
 * These types used to be generated from Rust (the tap read structured bindings).
 * Since global-shortcut input is `tauri-plugin-global-shortcut` chords and Rust
 * no longer sees a `KeyBinding` (ADR-0117), the vocabulary lives here: the FE
 * stores chords in device-config and computes plugin accelerators from them, all
 * without a round trip through Rust. The barrel (`./commands`) re-exports these,
 * so every consumer keeps importing them from `$lib/tauri/commands`.
 */

/**
 * A physical key in position space (`keyD` is the D-position key regardless of
 * layout). A stable enum so the persisted binding format never drifts; keys
 * outside this set are not bindable.
 */
export type Key =
	| 'keyA'
	| 'keyB'
	| 'keyC'
	| 'keyD'
	| 'keyE'
	| 'keyF'
	| 'keyG'
	| 'keyH'
	| 'keyI'
	| 'keyJ'
	| 'keyK'
	| 'keyL'
	| 'keyM'
	| 'keyN'
	| 'keyO'
	| 'keyP'
	| 'keyQ'
	| 'keyR'
	| 'keyS'
	| 'keyT'
	| 'keyU'
	| 'keyV'
	| 'keyW'
	| 'keyX'
	| 'keyY'
	| 'keyZ'
	| 'num0'
	| 'num1'
	| 'num2'
	| 'num3'
	| 'num4'
	| 'num5'
	| 'num6'
	| 'num7'
	| 'num8'
	| 'num9'
	| 'f1'
	| 'f2'
	| 'f3'
	| 'f4'
	| 'f5'
	| 'f6'
	| 'f7'
	| 'f8'
	| 'f9'
	| 'f10'
	| 'f11'
	| 'f12'
	| 'f13'
	| 'f14'
	| 'f15'
	| 'f16'
	| 'f17'
	| 'f18'
	| 'f19'
	| 'f20'
	| 'f21'
	| 'f22'
	| 'f23'
	| 'f24'
	| 'space'
	| 'return'
	| 'tab'
	| 'escape'
	| 'backspace'
	| 'delete'
	| 'insert'
	| 'upArrow'
	| 'downArrow'
	| 'leftArrow'
	| 'rightArrow'
	| 'home'
	| 'end'
	| 'pageUp'
	| 'pageDown'
	| 'minus'
	| 'equal'
	| 'leftBracket'
	| 'rightBracket'
	| 'semiColon'
	| 'quote'
	| 'backQuote'
	| 'backSlash'
	| 'comma'
	| 'dot'
	| 'slash';

/**
 * A logical modifier. Left and right collapse (ControlLeft and ControlRight both
 * become `ctrl`). `fn` has no plugin accelerator spelling, so a binding carrying
 * it is not a registrable global chord (see `keyBindingToAccelerator`).
 */
export type Modifier = 'ctrl' | 'alt' | 'shift' | 'meta' | 'fn';

/**
 * A global shortcut binding. A registrable chord is exactly one key plus at
 * least one non-Fn modifier; the frontend refuses to configure a bare key
 * (focused only) or an Fn / modifier-only gesture (no plugin accelerator).
 */
export type KeyBinding = {
	modifiers: Modifier[];
	keys: Key[];
};
