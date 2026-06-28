<script lang="ts">
	import { Button } from '@epicenter/ui/button';
	import * as Kbd from '@epicenter/ui/kbd';
	import { Spinner } from '@epicenter/ui/spinner';
	import { cn } from '@epicenter/ui/utils';
	import XIcon from '@lucide/svelte/icons/x';
	import type { Snippet } from 'svelte';
	import LevelMeter from '$lib/components/LevelMeter.svelte';
	import VadIndicator from '$lib/recording-overlay/VadIndicator.svelte';
	import { webPillLevel } from '$lib/recording-overlay/web-pill.svelte';
	import { dictationCapability } from '$lib/state/dictation-capability.svelte';
	import { tauri } from '#platform/tauri';
	import type { RecordingActionController } from './recording-action-controller';

	// The controller owns the state machine and every derived label/icon. The card
	// only decides presentation: a spinner while pending, the destructive "filled"
	// treatment while active, and a footer shown only at rest.
	let {
		controller,
		footer,
		iconViewTransitionName,
	}: {
		controller: RecordingActionController;
		footer?: Snippet;
		/**
		 * When set, names the action glyph for a cross-page view transition while
		 * the card is at rest. Suppressed automatically while `active`, because the
		 * live glyph (a stop square, a waveform) is a different object and must not
		 * morph from the resting mode glyph. Callers pass the name unconditionally;
		 * the card owns the at-rest gate.
		 */
		iconViewTransitionName?: string;
	} = $props();

	const accessibleLabel = $derived(
		controller.shortcutLabel
			? `${controller.label} (${controller.shortcutLabel})`
			: controller.label,
	);

	// Exactly one live meter shows at a time, on the surface holding your
	// attention. On desktop the always-on-top overlay is that meter: it floats over
	// even the focused app for the whole recording, so the card defers to it with a
	// static glyph and a second meter here would only double the overlay's. On web
	// there is no floating overlay, so the in-window surface carries the meter: this
	// card on the home route (where the in-page pill stands down), the pill on the
	// other routes. The smoothed level is already in this window on web
	// (`webPillLevel`); on desktop it is emitted straight to the overlay, not here.
	const showsLiveMeter = !tauri;
</script>

<div
	class={cn(
		'w-full overflow-hidden rounded-3xl bg-card text-foreground shadow-sm transition-[box-shadow] duration-200',
		controller.active && 'shadow-md ring-1 ring-destructive/15',
	)}
>
	<Button
		aria-label={accessibleLabel}
		aria-pressed={controller.active}
		aria-busy={controller.pending}
		tooltip={controller.tooltip}
		disabled={controller.pending}
		onclick={controller.toggle}
		variant="ghost"
		class={cn(
			'group h-auto w-full justify-start gap-3 rounded-none bg-transparent px-5 pt-5 pb-4 text-left hover:bg-transparent dark:hover:bg-transparent sm:gap-4',
			controller.pending && 'cursor-wait',
		)}
	>
		<!-- The glyph slot is the record CTA: idle = the brand --primary circle (this
		app's primary action), active = a --destructive (red) circle, mirroring the
		colors the floating pill already uses for live/stop. The icon (mic -> stop
		square) and the active flag both come from the controller; this only paints.
		Hover feedback lives on this circle (a slight scale + lift via group-hover),
		not a fill behind the row: the button spans only the top zone, so a row fill
		would cut a hard horizontal edge across the rounded card above the footer. -->
		<span
			aria-hidden="true"
			class={cn(
				'relative flex size-14 shrink-0 items-center justify-center rounded-full shadow-lg ring-4 transition-[transform,box-shadow,colors] duration-200 group-hover:scale-[1.04] group-hover:shadow-xl sm:size-16',
				controller.active
					? 'bg-destructive text-white shadow-destructive/30 ring-destructive/15'
					: 'bg-primary text-primary-foreground shadow-primary/25 ring-primary/10',
			)}
		>
			{#if controller.pending}
				<Spinner class="size-7 text-current" />
			{:else if controller.active && showsLiveMeter}
				<!-- Live capture: the glyph slot becomes the meter, the same bars the
				floating pill draws, scaled to fit the box. White bars read on the red
				(--destructive) recording circle. -->
				<LevelMeter
					level={webPillLevel.level}
					class="gap-[2px]"
					barClass="w-[2px] bg-white"
					minPx={3}
					maxPx={28}
				/>
				{#if controller.vad}
					<!-- VAD session: the same dim-dot -> lit-dot -> spinner indicator the
					floating pill shows beside its meter, here in the glyph's corner. The
					bars track loudness; this dot tracks whether VAD has latched onto speech
					and becomes a spinner while a previous phrase is still transcribing. On
					'/' the pill yields the recording phase to this card, so this is the
					only place that last signal shows. The signals come from this card's own
					controller (present only for VAD), not a global lookup. -->
					<span
						class="absolute top-0.5 right-0.5 flex size-4 items-center justify-center"
					>
						<VadIndicator
							signals={controller.vad}
							dimClass="bg-white/40"
							litClass="bg-white"
							spinnerClass="text-white/70"
						/>
					</span>
				{/if}
			{:else}
				{@const Icon = controller.icon}
				<span
					class="inline-flex"
					style:view-transition-name={controller.active
						? undefined
						: iconViewTransitionName}
				>
					<Icon
						class={cn(
							'size-7',
							controller.active && 'size-6 fill-current stroke-[1.75]',
						)}
					/>
				</span>
			{/if}
		</span>
		<span class="flex min-w-0 flex-1 flex-col gap-1">
			<span class="truncate text-base font-semibold leading-none sm:text-lg">
				{controller.label}
			</span>
			<span class="truncate text-xs font-medium text-muted-foreground sm:text-sm">
				{controller.description}
			</span>
		</span>
		{#if controller.shortcutLabel}
			<!-- On desktop the shortcut is the global rdev tap, which only fires when
			the capability is active. Keep showing the key but dim it whenever the tap
			can't fire (macOS Accessibility ungranted or stale, or Linux Wayland),
			reading the same fact the home-page notice does so the two agree. -->
			<Kbd.Root
				class={cn(
					'h-7 max-w-28 shrink-0 rounded-md bg-muted/75 px-2 text-xs text-muted-foreground shadow-none',
					dictationCapability.isUnavailable && 'opacity-50',
				)}
			>
				{controller.shortcutLabel}
			</Kbd.Root>
		{/if}
	</Button>

	<!-- The footer slot is the card's secondary zone: at rest it configures the
	pipeline; while live it discards the take. Keeping the slot filled in both
	states keeps the discard control tethered to the card (not orphaned below it)
	and holds the card's height steady across start/stop. VAD has no discard, so
	its live footer is empty and the slot collapses. -->
	{#if controller.active}
		{#if controller.cancel}
			<div class="flex justify-center px-5 pb-5 pt-1">
				<Button
					tooltip="Cancel recording and discard audio"
					onclick={() => controller.cancel?.()}
					variant="ghost-destructive"
					size="sm"
				>
					<XIcon class="size-4" />
					Cancel recording
				</Button>
			</div>
		{/if}
	{:else if footer}
		<div class="px-5 pb-5 pt-1">
			{@render footer()}
		</div>
	{/if}
</div>
