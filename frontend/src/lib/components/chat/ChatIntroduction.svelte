<script lang="ts">
	import type { Model } from "$lib/types/Model";
	import { usePublicConfig } from "$lib/utils/PublicConfig.svelte";
	import Logo from "$lib/components/icons/Logo.svelte";

	const publicConfig = usePublicConfig();

	interface Props {
		currentModel: Model;
		onmessage?: (content: string) => void;
	}

	let { currentModel: _currentModel, onmessage }: Props = $props();

	$effect(() => {
		// referenced to appease linter while UI blocks are commented out
		void _currentModel;
		void onmessage;
	});
</script>

<div class="my-auto grid items-center justify-center gap-8 text-center">
	<div class="intro-hero -translate-y-12 select-none md:-translate-y-10">
		<div class="intro-glow" aria-hidden="true"></div>
		<div class="intro-mark-row flex-col gap-2">
			<h1 class="intro-title rounded-xl text-4xl font-semibold tracking-tight md:text-6xl">
				Chat with Bindu
			</h1>
			<p class="mt-4 text-[11px] font-semibold uppercase tracking-[0.4em] text-slate-800/60 dark:text-slate-400/40">
				IMAGINE • BUILD • CONNECT
			</p>

		</div>


	</div>
	<!-- <div class="lg:col-span-1">
		<div>
			<div class="mb-3 flex items-center text-2xl font-semibold">
				<Logo classNames="mr-1 flex-none dark:invert" />
				{publicConfig.PUBLIC_APP_NAME}
				<div
					class="ml-3 flex h-6 items-center rounded-lg border border-gray-100 bg-gray-50 px-2 text-base text-gray-400 dark:border-gray-700/60 dark:bg-gray-800"
				>
					{publicConfig.PUBLIC_VERSION}
				</div>
			</div>
			<p class="text-base text-gray-600 dark:text-gray-400">
				{publicConfig.PUBLIC_APP_DESCRIPTION ||
					"Making the community's best AI chat models available to everyone."}
			</p>
		</div>
	</div>
	<div class="lg:col-span-2 lg:pl-24">
		{#each JSON5.parse(publicConfig.PUBLIC_ANNOUNCEMENT_BANNERS || "[]") as banner}
			<AnnouncementBanner classNames="mb-4" title={banner.title}>
				<a
					target={banner.external ? "_blank" : "_self"}
					href={banner.linkHref}
					class="mr-2 flex items-center underline hover:no-underline">{banner.linkTitle}</a
				>
			</AnnouncementBanner>
		{/each}
		<div class="overflow-hidden rounded-xl border dark:border-gray-800">
			<div class="flex p-3">
				<div>
					<div class="text-sm text-gray-600 dark:text-gray-400">Current Model</div>
					<div class="flex items-center gap-1.5 font-semibold max-sm:text-smd">
						{#if currentModel.logoUrl}
							<img
								class="aspect-square size-4 rounded border bg-white dark:border-gray-700"
								src={currentModel.logoUrl}
								alt=""
							/>
						{:else}
							<div
								class="size-4 rounded border border-transparent bg-gray-300 dark:bg-gray-800"
							></div>
						{/if}
						{currentModel.displayName}
					</div>
				</div>
				<a
					href="{base}/settings/{currentModel.id}"
					aria-label="Settings"
					class="btn ml-auto flex h-7 w-7 self-start rounded-full bg-gray-100 p-1 text-xs hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:hover:bg-gray-600"
					><IconGear /></a
				>
			</div>
			<ModelCardMetadata variant="dark" model={currentModel} />
		</div>
	</div>
	<div class="h-40 sm:h-24"></div> -->
</div>

<style>
	.intro-hero {
		position: relative;
		animation: intro-fade-up 0.6s cubic-bezier(0.22, 1, 0.36, 1) both;
	}

	@keyframes intro-fade-up {
		from {
			opacity: 0;
			transform: translateY(calc(-4rem + 12px));
		}
		to {
			opacity: 1;
			transform: translateY(-4rem);
		}
	}

	@media (min-width: 768px) {
		@keyframes intro-fade-up {
			from {
				opacity: 0;
				transform: translateY(calc(-3rem + 12px));
			}
			to {
				opacity: 1;
				transform: translateY(-3rem);
			}
		}
	}

	.intro-glow {
		position: absolute;
		inset: 0;
		margin: auto;
		width: 360px;
		height: 160px;
		border-radius: 9999px;
		background: radial-gradient(ellipse at center, rgba(85, 124, 247, 0.17) 0%, transparent 70%);
		filter: blur(26px);
		pointer-events: none;
	}

	.intro-mark-row {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 1rem;
	}

	.intro-mark {
		width: 3.1rem;
		height: 3.1rem;
		filter: grayscale(1) brightness(1.95);
		opacity: 0.95;
	}

	:global(.dark) .intro-glow {
		background: radial-gradient(ellipse at center, rgba(98, 139, 255, 0.24) 0%, transparent 70%);
	}

	.intro-title {
		background: linear-gradient(135deg, #1e293b 0%, #475569 100%);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
	}

	:global(.dark) .intro-title {
		background: linear-gradient(180deg, #d9e2f3 0%, #a5afc4 100%);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
	}

</style>
