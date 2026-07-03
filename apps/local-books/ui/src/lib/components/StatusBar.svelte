<script lang="ts">
	import { Button } from '@epicenter/ui/button';
	import { Spinner } from '@epicenter/ui/spinner';
	import AlertTriangleIcon from '@lucide/svelte/icons/triangle-alert';
	import LockIcon from '@lucide/svelte/icons/lock';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import { relativeTime } from '$lib/format';
	import type { BooksStatus } from '$lib/types';

	let {
		status,
		syncing,
		syncError,
		onRefresh,
	}: {
		status: BooksStatus | undefined;
		syncing: boolean;
		syncError: string | null;
		onRefresh: () => void;
	} = $props();

	// The mirror is "ready" once built and connected, "stale" when built but the
	// token has lapsed (browse still works, sync will fail), "empty" before the
	// first pull.
	const tone = $derived(
		!status
			? 'bg-muted-foreground'
			: !status.mirrorBuilt
				? 'bg-muted-foreground'
				: status.accessToken?.valid || status.refreshToken?.valid
					? 'bg-emerald-500'
					: 'bg-amber-500',
	);
	const label = $derived(
		!status
			? 'loading'
			: !status.mirrorBuilt
				? 'not built'
				: status.connected
					? 'ready'
					: 'disconnected',
	);
</script>

<header
	class="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-border bg-background px-4"
>
	<div class="flex items-center gap-3 min-w-0">
		<span class="text-sm font-semibold tracking-tight">Local Books</span>
		{#if status}
			<span class="truncate font-mono text-xs text-muted-foreground">
				{status.realmId} · {status.environment}
			</span>
		{/if}
	</div>

	<div class="flex items-center gap-3 text-xs text-muted-foreground">
		{#if status}
			<span class="flex items-center gap-1.5" title="Mirror state">
				<span class="size-2 rounded-full {tone}"></span>
				<span class="capitalize">{label}</span>
			</span>
			<span
				class="tabular-nums"
				title={status.cdcCursor ?? 'no cursor yet'}
			>
				synced {relativeTime(status.lastSyncedAt)}
			</span>
			{#if status.readOnly}
				<span
					class="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 font-medium text-amber-500"
					title="LOCAL_BOOKS_READ_ONLY is set: QuickBooks writes are disabled"
				>
					<LockIcon class="size-3" /> read-only
				</span>
			{/if}
		{/if}
		{#if syncError}
			<span class="flex items-center gap-1 text-destructive" title={syncError}>
				<AlertTriangleIcon class="size-3.5" /> sync failed
			</span>
		{/if}
		<Button
			size="sm"
			variant="outline"
			onclick={onRefresh}
			disabled={syncing}
			tooltip="Refresh the mirror from QuickBooks (POST /api/sync)"
		>
			{#if syncing}
				<Spinner class="size-3.5" />
			{:else}
				<RefreshCwIcon class="size-3.5" />
			{/if}
			<span>Sync</span>
		</Button>
	</div>
</header>
