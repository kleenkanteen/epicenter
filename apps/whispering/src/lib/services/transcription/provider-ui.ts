/**
 * UI-facing provider data: the icons plus the `TRANSCRIPTION_PROVIDERS` join.
 * Kept out of `providers.ts` so the workspace schema can import
 * `TRANSCRIPTION_SERVICE_IDS` without bundling these `?raw` SVGs.
 * `TRANSCRIPTION_PROVIDERS` is the join of each provider's data with its icon:
 * an array (id + every provider field + icon) that the settings selectors
 * iterate and filter by `access`.
 */
import deepgramIcon from '$lib/constants/icons/deepgram.svg?raw';
import elevenlabsIcon from '$lib/constants/icons/elevenlabs.svg?raw';
import epicenterIcon from '$lib/constants/icons/epicenter.svg?raw';
import ggmlIcon from '$lib/constants/icons/ggml.svg?raw';
import groqIcon from '$lib/constants/icons/groq.svg?raw';
import mistralIcon from '$lib/constants/icons/mistral.svg?raw';
import openaiIcon from '$lib/constants/icons/openai.svg?raw';
import speachesIcon from '$lib/constants/icons/speaches.svg?raw';
import {
	PROVIDERS,
	type ProviderAccess,
	type TranscriptionServiceId,
} from './providers';

export const PROVIDER_ICONS = {
	epicenter: { icon: epicenterIcon, invertInDarkMode: false },
	OpenAI: { icon: openaiIcon, invertInDarkMode: true },
	Groq: { icon: groqIcon, invertInDarkMode: false },
	ElevenLabs: { icon: elevenlabsIcon, invertInDarkMode: true },
	Deepgram: { icon: deepgramIcon, invertInDarkMode: true },
	Mistral: { icon: mistralIcon, invertInDarkMode: false },
	local: { icon: ggmlIcon, invertInDarkMode: true },
	speaches: { icon: speachesIcon, invertInDarkMode: false },
} as const satisfies Record<
	TranscriptionServiceId,
	{ icon: string; invertInDarkMode: boolean }
>;

/**
 * One provider's registry data joined with its icon, discriminated by id:
 * narrowing on `access` (or `id`) narrows every field together, `id`
 * included. A plain `Object.entries(...).map(...)` type would cross the full
 * id union with the full provider union, so narrowing `access` would leave
 * `id` broad; the mapped type keeps each id paired with its own shape.
 */
export type TranscriptionProviderEntry = {
	[K in TranscriptionServiceId]: { id: K } & (typeof PROVIDERS)[K] &
		(typeof PROVIDER_ICONS)[K];
}[TranscriptionServiceId];

/** UI-facing list: each provider's data joined with its icon, in declaration order. */
export const TRANSCRIPTION_PROVIDERS = (
	Object.entries(PROVIDERS) as [
		TranscriptionServiceId,
		(typeof PROVIDERS)[TranscriptionServiceId],
	][]
).map(([id, provider]) => ({
	id,
	...provider,
	...PROVIDER_ICONS[id],
})) as TranscriptionProviderEntry[];

/**
 * The single source of how each `access` family is presented: the group heading
 * both service selectors show and the short badge the settings dropdown tags each
 * row with. Declaration order is display order. `satisfies Record<ProviderAccess,
 * ...>` makes a new access member a compile error here, so a family can never be
 * silently dropped from a selector the way `session` once was. Group *membership*
 * lives in the registry (`access`); this map owns only presentation.
 */
export const ACCESS_GROUPS = {
	session: { heading: 'Epicenter', badge: 'Hosted' },
	onDevice: { heading: 'On-device', badge: 'Local' },
	key: { heading: 'Provider API', badge: 'API' },
	endpoint: { heading: 'Custom server', badge: 'Self-Hosted' },
} as const satisfies Record<ProviderAccess, { heading: string; badge: string }>;

export type TranscriptionServiceGroup = {
	access: ProviderAccess;
	heading: string;
	badge: string;
	services: TranscriptionProviderEntry[];
};

/**
 * The providers grouped by `access` in display order, one entry per non-empty
 * group. The single derivation both selectors iterate, so their group set, order,
 * and headings can never disagree. On-device providers transcribe through Rust, so
 * they are hidden off Tauri (`tauri: false`), matching the readiness check.
 */
export function groupedTranscriptionProviders({
	tauri,
}: {
	tauri: boolean;
}): TranscriptionServiceGroup[] {
	return (Object.keys(ACCESS_GROUPS) as ProviderAccess[]).flatMap((access) => {
		if (access === 'onDevice' && !tauri) return [];
		const services = TRANSCRIPTION_PROVIDERS.filter(
			(service) => service.access === access,
		);
		if (services.length === 0) return [];
		return [{ access, ...ACCESS_GROUPS[access], services }];
	});
}
