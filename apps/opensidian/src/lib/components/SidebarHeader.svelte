<script lang="ts">
	import { Button } from '@epicenter/ui/button';
	import FilePlusIcon from '@lucide/svelte/icons/file-plus';
	import FolderPlusIcon from '@lucide/svelte/icons/folder-plus';
	import SearchIcon from '@lucide/svelte/icons/search';
	import { opensidian } from '$lib/opensidian';
</script>

<div class="flex h-8 shrink-0 items-center justify-between border-b px-2">
	<div class="flex items-center gap-1.5">
		<div class="flex size-5 items-center justify-center rounded bg-black">
			<img src="/logo.svg" alt="Epicenter" class="size-3.5">
		</div>
		<span class="text-xs font-semibold tracking-tight">opensidian</span>
	</div>
	<div class="flex items-center gap-0.5">
		<Button
			tooltip="Search files (⌘⇧F)"
			variant={opensidian.state.sidebarSearch.leftPaneView === 'search' ? 'secondary': 'ghost'}
			size="icon-xs"
			onclick={() => {
				if (opensidian.state.sidebarSearch.leftPaneView === 'search') {
					opensidian.state.sidebarSearch.closeSearch();
				} else {
					opensidian.state.sidebarSearch.openSearch();
				}
			}}
		>
			<SearchIcon class="size-3.5" />
		</Button>
		<Button
			tooltip="New folder"
			variant="ghost"
			size="icon-xs"
			onclick={() => opensidian.state.files.startCreate('folder')}
		>
			<FolderPlusIcon class="size-3.5" />
		</Button>
		<Button
			tooltip="New file"
			variant="ghost"
			size="icon-xs"
			onclick={() => opensidian.state.files.startCreate('file')}
		>
			<FilePlusIcon class="size-3.5" />
		</Button>
	</div>
</div>
