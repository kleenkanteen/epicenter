<script lang="ts">
	import { Badge } from '@epicenter/ui/badge';
	import { Label } from '@epicenter/ui/label';
	import * as Select from '@epicenter/ui/select';
	import { cn } from '@epicenter/ui/utils';
	import {
		groupedTranscriptionProviders,
		type TranscriptionProviderEntry,
	} from '$lib/services/transcription/provider-ui';
	import { type TranscriptionServiceId } from '$lib/services/transcription/providers';
	import { tauri } from '#platform/tauri';

	let {
		id = 'transcription-service',
		label = 'Transcription Service',
		selected = $bindable(),
		recommendedServiceId = tauri ? 'local' : 'OpenAI',
	}: {
		id?: string;
		label?: string;
		selected: TranscriptionServiceId;
		recommendedServiceId?: TranscriptionServiceId | null;
	} = $props();

	// The one grouping source both selectors iterate. A new `access` family lights
	// up here automatically; it can never be silently dropped the way `session`
	// (Epicenter) once was from this dropdown.
	const groups = $derived(groupedTranscriptionProviders({ tauri: Boolean(tauri) }));

	const selectedService = $derived(
		groups.flatMap((group) => group.services).find((s) => s.id === selected),
	);
</script>

{#snippet renderServiceIcon(service: TranscriptionProviderEntry)}
	<div
		class={cn(
			'size-4 shrink-0 flex items-center justify-center [&>svg]:size-full',
			service.invertInDarkMode &&
				'dark:[&>svg]:invert dark:[&>svg]:brightness-90',
		)}
	>
		{@html service.icon}
	</div>
{/snippet}

<div class="flex flex-col gap-2">
	<Label class="text-sm" for={id}>
		{label}
	</Label>
	<Select.Root type="single" bind:value={selected}>
		<Select.Trigger class="w-full" {id}>
			<div class="flex items-center gap-2">
				{#if selectedService}
					{@render renderServiceIcon(selectedService)}
					<span>{selectedService.label}</span>
				{:else}
					<span>Select a transcription service</span>
				{/if}
			</div>
		</Select.Trigger>
		<Select.Content class="max-h-[400px]">
			{#each groups as group, i (group.access)}
				{#if i > 0}
					<Select.Separator />
				{/if}
				<Select.Group>
					<Select.GroupHeading>{group.heading}</Select.GroupHeading>
					{#each group.services as service (service.id)}
						<Select.Item value={service.id} label={service.label}>
							<div class="flex items-start gap-3 py-1">
								<div class="mt-0.5">{@render renderServiceIcon(service)}</div>
								<div class="flex-1 min-w-0">
									<div class="flex items-center gap-2">
										<span class="font-medium">{service.label}</span>
										<Badge variant="outline" class="text-xs">{group.badge}</Badge>
										{#if service.id === recommendedServiceId}
											<Badge variant="outline" class="text-xs">Recommended</Badge>
										{/if}
									</div>
									{#if service.description}
										<div class="text-xs text-muted-foreground mt-1">
											{service.description}
										</div>
									{/if}
									{#if service.access === 'key' && service.models.length > 0}
										<div class="text-xs text-muted-foreground mt-1">
											{service.models.length}
											model{service.models.length > 1 ? 's' : ''}
											available
										</div>
									{/if}
								</div>
							</div>
						</Select.Item>
					{/each}
				</Select.Group>
			{/each}
		</Select.Content>
	</Select.Root>
</div>
