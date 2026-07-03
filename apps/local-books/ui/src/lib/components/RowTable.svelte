<script lang="ts">
	import * as Table from '@epicenter/ui/table';
	import { columnLabel, formatCell, numberFmt } from '$lib/format';
	import type { EntityRowsPage } from '$lib/types';

	let {
		page,
		loading,
		error,
		selectedId,
		onSelect,
	}: {
		page: EntityRowsPage | undefined;
		loading: boolean;
		error: string | null;
		selectedId: string | null;
		onSelect: (id: string) => void;
	} = $props();

	const columns = $derived(page?.columns ?? []);
	const rows = $derived(page?.rows ?? []);
</script>

<div class="flex min-h-0 flex-1 flex-col">
	<div
		class="flex h-9 shrink-0 items-center justify-between border-b border-border px-3 text-xs text-muted-foreground"
	>
		{#if page}
			<span>{page.entity}</span>
			<span class="tabular-nums">
				{numberFmt.format(rows.length)} of {numberFmt.format(page.total)} rows
			</span>
		{/if}
	</div>

	<div class="min-h-0 flex-1 overflow-auto">
		{#if error}
			<p class="p-4 text-sm text-destructive">{error}</p>
		{:else if loading}
			<p class="p-4 text-sm text-muted-foreground">Loading…</p>
		{:else if rows.length === 0}
			<p class="p-4 text-sm text-muted-foreground">
				No rows. This record type may not be synced yet.
			</p>
		{:else}
			<Table.Root class="text-sm">
				<Table.Header>
					<Table.Row>
						<Table.Head class="w-24 font-mono text-xs">id</Table.Head>
						{#each columns as column (column.name)}
							<Table.Head class="capitalize {column.type === 'REAL' ? 'text-right' : ''}">
								{columnLabel(column.name)}
							</Table.Head>
						{/each}
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each rows as row (row.id)}
						<Table.Row
							class="cursor-pointer {selectedId === String(row.id) ? 'bg-muted' : ''} {row.deleted === 1 ? 'text-muted-foreground line-through' : ''}"
							onclick={() => onSelect(String(row.id))}
						>
							<Table.Cell class="font-mono text-xs">{row.id}</Table.Cell>
							{#each columns as column (column.name)}
								<Table.Cell class={column.type === 'REAL' ? 'text-right tabular-nums' : ''}>
									{formatCell(row[column.name], column)}
								</Table.Cell>
							{/each}
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		{/if}
	</div>
</div>
