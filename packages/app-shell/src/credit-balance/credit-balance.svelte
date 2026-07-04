<script lang="ts">
	/**
	 * Compact hosted-credit display. Presentational only: it takes a resolved
	 * {@link CreditSnapshot} (or `null`) and never fetches, so the same line renders
	 * from any host that already holds an auth'd fetch (the account popover, the
	 * dashboard). Renders nothing when there is no snapshot, so a signed-out or
	 * self-hosted surface shows no billing chrome at all.
	 *
	 * Three states, one rule ({@link creditStatus}): `ok` shows the balance plainly,
	 * `low` tints it and nudges, `out` says so and (when a dashboard URL is given)
	 * offers the one action that helps: add credits. This is the whole surface; the
	 * rich plan/usage/checkout UI stays in the dashboard.
	 */
	import { Link } from '@epicenter/ui/link';
	import { cn } from '@epicenter/ui/utils';
	import Coins from '@lucide/svelte/icons/coins';
	import { type CreditSnapshot, creditStatus } from './credit-balance.js';

	let {
		snapshot,
		dashboardUrl,
		class: className,
	}: {
		/** The resolved wallet, or `null` when there are no hosted credits to show. */
		snapshot: CreditSnapshot | null;
		/** Where "Add credits" points (the hosted dashboard). Omit to hide the CTA. */
		dashboardUrl?: string;
		class?: string;
	} = $props();

	const status = $derived(snapshot ? creditStatus(snapshot) : null);
</script>

{#if snapshot && status}
	<div class={cn('flex items-center gap-2 text-sm', className)}>
		<Coins
			class={cn(
				'size-4 shrink-0',
				status === 'out'
					? 'text-destructive'
					: status === 'low'
						? 'text-amber-600 dark:text-amber-400'
						: 'text-muted-foreground',
			)}
		/>
		{#if status === 'out'}
			<span class="font-medium text-destructive">Out of credits</span>
		{:else}
			<span class="tabular-nums font-medium">
				{snapshot.remaining.toLocaleString()}
			</span>
			<span class="text-muted-foreground">
				credit{snapshot.remaining === 1 ? '' : 's'}
			</span>
			{#if status === 'low'}
				<span class="text-xs text-amber-600 dark:text-amber-400">Low</span>
			{/if}
		{/if}

		{#if dashboardUrl && status !== 'ok'}
			<Link
				href={dashboardUrl}
				target="_blank"
				rel="noopener noreferrer"
				class="ml-auto text-xs"
			>
				Add credits
			</Link>
		{/if}
	</div>
{/if}
