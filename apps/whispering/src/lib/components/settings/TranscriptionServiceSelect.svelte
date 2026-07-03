<script lang="ts">
	import { Badge } from '@epicenter/ui/badge';
	import { Label } from '@epicenter/ui/label';
	import * as Select from '@epicenter/ui/select';
	import { cn } from '@epicenter/ui/utils';
	import type { Snippet } from 'svelte';
	import {
		TRANSCRIPTION_PROVIDERS,
		type TranscriptionProviderEntry,
	} from '$lib/services/transcription/provider-ui';
	import { type TranscriptionServiceId } from '$lib/services/transcription/providers';
	import { tauri } from '#platform/tauri';

	let {
		id = 'transcription-service',
		label = 'Transcription Service',
		selected = $bindable(),
		class: className,
		disabled = false,
		hideLabel = false,
		description,
		recommendedServiceId = tauri ? 'parakeet' : 'OpenAI',
	}: {
		id?: string;
		label?: string;
		selected: TranscriptionServiceId;
		class?: string;
		disabled?: boolean;
		hideLabel?: boolean;
		description?: string | Snippet;
		recommendedServiceId?: TranscriptionServiceId | null;
	} = $props();

	const starServices = $derived(
		TRANSCRIPTION_PROVIDERS.filter((service) => service.access === 'star'),
	);

	const onDeviceServices = $derived(
		tauri
			? TRANSCRIPTION_PROVIDERS.filter((service) => service.access === 'onDevice')
			: [],
	);

	const cloudServices = $derived(
		TRANSCRIPTION_PROVIDERS.filter((service) => service.access === 'byok'),
	);

	const customServerServices = $derived(
		TRANSCRIPTION_PROVIDERS.filter((service) => service.access === 'byoe'),
	);

	const selectedService = $derived(
		[
			...starServices,
			...onDeviceServices,
			...cloudServices,
			...customServerServices,
		].find((service) => service.id === selected),
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
	<Label class={cn('text-sm', hideLabel && 'sr-only')} for={id}>
		{label}
	</Label>
	<Select.Root type="single" bind:value={selected} {disabled}>
		<Select.Trigger class={cn('w-full', className)} {id}>
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
			{#if starServices.length > 0}
				<Select.Group>
					<Select.GroupHeading>Epicenter</Select.GroupHeading>
					{#each starServices as service (service.id)}
						<Select.Item value={service.id} label={service.label}>
							<div class="flex items-start gap-3 py-1">
								<div class="mt-0.5">{@render renderServiceIcon(service)}</div>
								<div class="flex-1 min-w-0">
									<div class="flex items-center gap-2">
										<span class="font-medium">{service.label}</span>
									</div>
									{#if service.description}
										<div class="text-xs text-muted-foreground mt-1">
											{service.description}
										</div>
									{/if}
								</div>
							</div>
						</Select.Item>
					{/each}
				</Select.Group>
			{/if}

			{#if onDeviceServices.length > 0}
				{#if starServices.length > 0}
					<Select.Separator />
				{/if}
				<Select.Group>
					<Select.GroupHeading>On-device</Select.GroupHeading>
					{#each onDeviceServices as service}
						<Select.Item value={service.id} label={service.label}>
							<div class="flex items-start gap-3 py-1">
								<div class="mt-0.5">{@render renderServiceIcon(service)}</div>
								<div class="flex-1 min-w-0">
									<div class="flex items-center gap-2">
										<span class="font-medium">{service.label}</span>
										<Badge variant="secondary" class="text-xs">On-device</Badge>
										{#if service.id === recommendedServiceId}
											<Badge variant="outline" class="text-xs"
												>Recommended</Badge
											>
										{/if}
									</div>
									{#if service.description}
										<div class="text-xs text-muted-foreground mt-1">
											{service.description}
										</div>
									{/if}
								</div>
							</div>
						</Select.Item>
					{/each}
				</Select.Group>
			{/if}

			{#if cloudServices.length > 0}
				{#if starServices.length > 0 || onDeviceServices.length > 0}
					<Select.Separator />
				{/if}
				<Select.Group>
					<Select.GroupHeading>Provider API</Select.GroupHeading>
					{#each cloudServices as service}
						<Select.Item value={service.id} label={service.label}>
							<div class="flex items-start gap-3 py-1">
								<div class="mt-0.5">{@render renderServiceIcon(service)}</div>
								<div class="flex-1 min-w-0">
									<div class="flex items-center gap-2">
										<span class="font-medium">{service.label}</span>
										<Badge variant="outline" class="text-xs">API</Badge>
										{#if service.id === recommendedServiceId}
											<Badge variant="outline" class="text-xs"
												>Recommended</Badge
											>
										{/if}
									</div>
									{#if service.description}
										<div class="text-xs text-muted-foreground mt-1">
											{service.description}
										</div>
									{/if}
									{#if service.access === 'byok' && service.models.length > 0}
										<div class="text-xs text-muted-foreground mt-1">
											{service.models.length}
											model{service.models.length > 1
												? 's'
												: ''}
											available
										</div>
									{/if}
								</div>
							</div>
						</Select.Item>
					{/each}
				</Select.Group>
			{/if}

			{#if customServerServices.length > 0}
				{#if onDeviceServices.length > 0 || cloudServices.length > 0}
					<Select.Separator />
				{/if}
				<Select.Group>
					<Select.GroupHeading>Custom server</Select.GroupHeading>
					{#each customServerServices as service}
						<Select.Item value={service.id} label={service.label}>
							<div class="flex items-start gap-3 py-1">
								<div class="mt-0.5">{@render renderServiceIcon(service)}</div>
								<div class="flex-1 min-w-0">
									<div class="flex items-center gap-2">
										<span class="font-medium">{service.label}</span>
										<Badge variant="outline" class="text-xs">Custom server</Badge>
									</div>
									{#if service.description}
										<div class="text-xs text-muted-foreground mt-1">
											{service.description}
										</div>
									{/if}
								</div>
							</div>
						</Select.Item>
					{/each}
				</Select.Group>
			{/if}
		</Select.Content>
	</Select.Root>
	{#if description}
		<div class="text-muted-foreground text-sm">
			{#if typeof description === 'string'}
				{description}
			{:else}
				{@render description()}
			{/if}
		</div>
	{/if}
</div>
