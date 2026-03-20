<script lang="ts">
	import type { Message, MessageFile } from "$lib/types/Message";
	import { onDestroy } from "svelte";

	import IconArrowUp from "~icons/lucide/arrow-up";
	import IconMic from "~icons/lucide/mic";

	import ChatInput from "./ChatInput.svelte";
	import VoiceRecorder from "./VoiceRecorder.svelte";
	import StopGeneratingBtn from "../StopGeneratingBtn.svelte";
	import type { Model } from "$lib/types/Model";
	import FileDropzone from "./FileDropzone.svelte";
	import RetryBtn from "../RetryBtn.svelte";
	import file2base64 from "$lib/utils/file2base64";
	import { base } from "$app/paths";
	import ChatMessage from "./ChatMessage.svelte";
	import ScrollToBottomBtn from "../ScrollToBottomBtn.svelte";
	import ScrollToPreviousBtn from "../ScrollToPreviousBtn.svelte";
	import { browser } from "$app/environment";
	import { snapScrollToBottom } from "$lib/actions/snapScrollToBottom";
	import SystemPromptModal from "../SystemPromptModal.svelte";
	import ShareConversationModal from "../ShareConversationModal.svelte";
	import ChatIntroduction from "./ChatIntroduction.svelte";
	import UploadedFile from "./UploadedFile.svelte";
	import { useSettingsStore } from "$lib/stores/settings";
	import { error } from "$lib/stores/errors";
	import { shareModal } from "$lib/stores/shareModal";
	import LucideHammer from "~icons/lucide/hammer";
	import ReplyIndicator from "./ReplyIndicator.svelte";
	import { agentInspector, resetAgentInspector } from "$lib/stores/agentInspector";

	import { fly } from "svelte/transition";
	import { cubicInOut } from "svelte/easing";

	import { isVirtualKeyboard } from "$lib/utils/isVirtualKeyboard";
	import { requireAuthUser } from "$lib/utils/auth";
	import { page } from "$app/state";
	import {
		isMessageToolCallUpdate,
		isMessageToolErrorUpdate,
		isMessageToolResultUpdate,
	} from "$lib/utils/messageUpdates";
	import type { ToolFront } from "$lib/types/Tool";

	interface Props {
		messages?: Message[];
		messagesAlternatives?: Message["id"][][];
		loading?: boolean;
		pending?: boolean;
		shared?: boolean;
		currentModel: Model;
		models: Model[];
		preprompt?: string | undefined;
		files?: File[];
		onmessage?: (content: string) => void;
		onstop?: () => void;
		onretry?: (payload: { id: Message["id"]; content?: string }) => void;
		onshowAlternateMsg?: (payload: { id: Message["id"] }) => void;
		onReplyToTask?: (taskId: string) => void;
		replyToTaskId?: string | null;
		onClearReply?: () => void;
		/** Optional override for what we show as "Session" identity */
		sessionId?: string | null;
		onClearContext?: () => void | Promise<void>;
		onClearTasks?: () => void | Promise<void>;
		draft?: string;
	}

	let {
		messages = [],
		messagesAlternatives = [],
		loading = false,
		pending = false,
		shared = false,
		currentModel,
		models,
		preprompt = undefined,
		files = $bindable([]),
		draft = $bindable(""),
		onmessage,
		onstop,
		onretry,
		onshowAlternateMsg,
		onReplyToTask,
		replyToTaskId = null,
		onClearReply,
		sessionId = null,
		onClearContext,
		onClearTasks,
	}: Props = $props();

	let isReadOnly = $derived(!models.some((model) => model.id === currentModel.id));

	let agentContextId = $derived.by(() => {
		// Derive from message task metadata when available (works for both normal and agent mode).
		for (let i = messages.length - 1; i >= 0; i -= 1) {
			const cid = messages[i]?.taskMetadata?.contextId;
			if (cid) return cid;
		}
		return null;
	});

	let agentTaskCount = $derived.by(() => {
		const ids = new Set<string>();
		for (const m of messages) {
			const tid = m.taskMetadata?.taskId;
			if (tid) ids.add(tid);
		}
		return ids.size;
	});

	let agentSessionId = $derived.by(() => {
		// Prefer an explicit session id, then the derived context id, then route param id if present.
		return sessionId ?? agentContextId ?? (page.params as Record<string, string> | undefined)?.id ?? null;
	});

	// Publish agent state + clear handlers for the sidebar inspector.
	$effect(() => {
		agentInspector.set({
			agentName: currentModel.displayName,
			contextId: agentContextId,
			sessionId: agentSessionId,
			taskCount: agentTaskCount,
			disabled: loading,
			onClearContext,
			onClearTasks,
		});
	});

	let shareModalOpen = $state(false);
	let editMsdgId: Message["id"] | null = $state(null);
	let pastedLongContent = $state(false);

	// Voice recording state
	let isRecording = $state(false);
	let isTranscribing = $state(false);
	let transcriptionEnabled = $derived(
		!!(page.data as { transcriptionEnabled?: boolean }).transcriptionEnabled
	);
	let isTouchDevice = $derived(browser && navigator.maxTouchPoints > 0);

	const handleSubmit = () => {
		if (requireAuthUser() || loading || !draft) return;
		onmessage?.(draft);
		draft = "";
	};

	let lastTarget: EventTarget | null = null;

	let onDrag = $state(false);

	const onDragEnter = (e: DragEvent) => {
		lastTarget = e.target;
		onDrag = true;
	};
	const onDragLeave = (e: DragEvent) => {
		if (e.target === lastTarget) {
			onDrag = false;
		}
	};

	const onPaste = (e: ClipboardEvent) => {
		const textContent = e.clipboardData?.getData("text");

		if (!$settings.directPaste && textContent && textContent.length >= 3984) {
			e.preventDefault();
			pastedLongContent = true;
			setTimeout(() => {
				pastedLongContent = false;
			}, 1000);
			const pastedFile = new File([textContent], "Pasted Content", {
				type: "application/vnd.bindu_ui.clipboard",
			});

			files = [...files, pastedFile];
		}

		if (!e.clipboardData) {
			return;
		}

		// paste of files
		const pastedFiles = Array.from(e.clipboardData.files);
		if (pastedFiles.length !== 0) {
			e.preventDefault();

			// filter based on activeMimeTypes, including wildcards
			const filteredFiles = pastedFiles.filter((file) => {
				return activeMimeTypes.some((mimeType: string) => {
					const [type, subtype] = mimeType.split("/");
					const [fileType, fileSubtype] = file.type.split("/");
					return (
						(type === "*" || fileType === type) && (subtype === "*" || fileSubtype === subtype)
					);
				});
			});

			files = [...files, ...filteredFiles];
		}
	};

	let lastMessage = $derived(browser && (messages.at(-1) as Message));
	// Scroll signal includes tool updates and thinking blocks to trigger scroll on all content changes
	let scrollSignal = $derived.by(() => {
		const last = messages.at(-1) as Message | undefined;
		if (!last) return `${messages.length}:0`;

		// Count tool updates to trigger scroll when new tools are called or complete
		const toolUpdateCount = last.updates?.length ?? 0;

		// Include content length, tool count, and message count in signal
		return `${last.id}:${last.content.length}:${messages.length}:${toolUpdateCount}`;
	});
	let streamingAssistantMessage = $derived(
		(() => {
			for (let i = messages.length - 1; i >= 0; i -= 1) {
				const candidate = messages[i];
				if (candidate.from === "assistant") {
					return candidate;
				}
			}
			return undefined;
		})()
	);

	let lastIsError = $derived(
		!loading &&
			(streamingAssistantMessage?.updates?.findIndex(
				(u) => u.type === "status" && u.status === "error"
			) ?? -1) !== -1
	);

	// Expose currently running tool call name (if any) from the streaming assistant message
	const availableTools: ToolFront[] = $derived.by(
		() => (page.data as { tools?: ToolFront[] } | undefined)?.tools ?? []
	);
	let streamingToolCallName = $derived.by(() => {
		const updates = streamingAssistantMessage?.updates ?? [];
		if (!updates.length) return null;
		const done = new Set<string>();
		for (const u of updates) {
			if (isMessageToolResultUpdate(u) || isMessageToolErrorUpdate(u)) done.add(u.uuid);
		}
		for (let i = updates.length - 1; i >= 0; i -= 1) {
			const u = updates[i];
			if (isMessageToolCallUpdate(u) && !done.has(u.uuid)) {
				return u.call.name;
			}
		}
		return null;
	});

	let sources = $derived(
		files?.map<Promise<MessageFile>>((file) =>
			file2base64(file).then((value) => ({
				type: "base64",
				value,
				mime: file.type,
				name: file.name,
			}))
		)
	);

	const unsubscribeShareModal = shareModal.subscribe((value) => {
		shareModalOpen = value;
	});

	onDestroy(() => {
		unsubscribeShareModal();
		shareModal.close();
		resetAgentInspector();
	});

	let chatContainer: HTMLElement | undefined = $state();

	// Force scroll to bottom when user sends a new message
	// Pattern: user message + empty assistant message are added together
	let prevMessageCount = $state(messages.length);
	let forceReattach = $state(0);
	$effect(() => {
		if (messages.length > prevMessageCount) {
			const last = messages.at(-1);
			const secondLast = messages.at(-2);
			const userJustSentMessage =
				messages.length === prevMessageCount + 2 &&
				secondLast?.from === "user" &&
				last?.from === "assistant" &&
				last?.content === "";

			if (userJustSentMessage) {
				forceReattach++;
			}
		}
		prevMessageCount = messages.length;
	});

	// Combined scroll dependency for the action
	let scrollDependency = $derived({ signal: scrollSignal, forceReattach });

	const settings = useSettingsStore();

	// Model capabilities - use model defaults
	let modelIsMultimodal = $derived(currentModel.multimodal === true);
	let modelSupportsTools = $derived(
		(currentModel as unknown as { supportsTools?: boolean }).supportsTools === true
	);

	// Always allow common text-like files; add images only when model is multimodal
	import { TEXT_MIME_ALLOWLIST, IMAGE_MIME_ALLOWLIST_DEFAULT, DOCUMENT_MIME_ALLOWLIST } from "$lib/constants/mime";

	let activeMimeTypes = $derived(
		Array.from(
			new Set([
				...TEXT_MIME_ALLOWLIST,
				...DOCUMENT_MIME_ALLOWLIST,
				...(modelIsMultimodal
					? (currentModel.multimodalAcceptedMimetypes ?? [...IMAGE_MIME_ALLOWLIST_DEFAULT])
					: []),
			])
		)
	);
	let isFileUploadEnabled = $derived(activeMimeTypes.length > 0);
	let focused = $state(false);


	async function handleRecordingConfirm(audioBlob: Blob) {
		isRecording = false;
		isTranscribing = true;

		try {
			const response = await fetch(`${base}/api/transcribe`, {
				method: "POST",
				headers: { "Content-Type": audioBlob.type },
				body: audioBlob,
			});

			if (!response.ok) {
				throw new Error(await response.text());
			}

			const { text } = await response.json();
			const trimmedText = text?.trim();
			if (trimmedText) {
				// Append transcribed text to draft
				draft = draft.trim() ? `${draft.trim()} ${trimmedText}` : trimmedText;
			}
		} catch (err) {
			console.error("Transcription error:", err);
			$error = "Transcription failed. Please try again.";
		} finally {
			isTranscribing = false;
		}
	}

	async function handleRecordingSend(audioBlob: Blob) {
		isRecording = false;
		isTranscribing = true;

		try {
			const response = await fetch(`${base}/api/transcribe`, {
				method: "POST",
				headers: { "Content-Type": audioBlob.type },
				body: audioBlob,
			});

			if (!response.ok) {
				throw new Error(await response.text());
			}

			const { text } = await response.json();
			const trimmedText = text?.trim();
			if (trimmedText) {
				// Set draft and send immediately
				draft = draft.trim() ? `${draft.trim()} ${trimmedText}` : trimmedText;
				handleSubmit();
			}
		} catch (err) {
			console.error("Transcription error:", err);
			$error = "Transcription failed. Please try again.";
		} finally {
			isTranscribing = false;
		}
	}

	function handleRecordingError(message: string) {
		console.error("Recording error:", message);
		isRecording = false;
		$error = message;
	}
</script>

<svelte:window
	ondragenter={onDragEnter}
	ondragleave={onDragLeave}
	ondragover={(e) => {
		e.preventDefault();
	}}
	ondrop={(e) => {
		e.preventDefault();
		onDrag = false;
	}}
/>

<div class="relative flex h-full min-h-0 min-w-0 flex-col">

	{#if shareModalOpen}
		<ShareConversationModal open={shareModalOpen} onclose={() => shareModal.close()} />
	{/if}
	<div
		class="scrollbar-custom flex-1 overflow-y-auto"
		use:snapScrollToBottom={scrollDependency}
		bind:this={chatContainer}
	>

		{#if replyToTaskId}
			<ReplyIndicator taskId={replyToTaskId} onClear={onClearReply ?? (() => {})} />
		{/if}
		<div
			class="mx-auto flex h-full max-w-3xl flex-col gap-6 px-5 pt-6 sm:gap-8 xl:max-w-4xl xl:pt-10"
		>
			{#if preprompt && preprompt != currentModel.preprompt}
				<SystemPromptModal preprompt={preprompt ?? ""} />
			{/if}

			{#if messages.length > 0}
				<div class="flex h-max flex-col gap-8 pb-40">
					{#each messages as message, idx (message.id)}
						<ChatMessage
							{loading}
							{message}
							alternatives={messagesAlternatives.find((a) => a.includes(message.id)) ?? []}
							isAuthor={!shared}
							readOnly={isReadOnly}
							isLast={idx === messages.length - 1}
							bind:editMsdgId
							onretry={(payload) => onretry?.(payload)}
							onshowAlternateMsg={(payload) => onshowAlternateMsg?.(payload)}
							onReplyToTask={onReplyToTask}
						/>
					{/each}
									</div>
			{:else if pending}
				<ChatMessage
					loading={true}
					message={{
						id: "0-0-0-0-0",
						content: "",
						from: "assistant",
						children: [],
					}}
					isAuthor={!shared}
					readOnly={isReadOnly}
				/>
			{:else}
				<ChatIntroduction
					{currentModel}
					onmessage={(content) => {
						onmessage?.(content);
					}}
				/>
			{/if}
		</div>

		<ScrollToPreviousBtn class="fixed bottom-48 right-4 lg:right-10" scrollNode={chatContainer} />

		<ScrollToBottomBtn class="fixed bottom-36 right-4 lg:right-10" scrollNode={chatContainer} />
	</div>

	<div
		class="pointer-events-none absolute inset-x-0 bottom-0 z-0 mx-auto flex w-full
			max-w-3xl flex-col items-center justify-end bg-gradient-to-t from-white
			via-white/95 to-white/0 px-3.5 pt-2 dark:from-gray-950
			dark:via-gray-950/95 dark:to-transparent pb-6 sm:px-5 md:pb-8 xl:max-w-4xl [&>*]:pointer-events-auto"
	>

		{#if sources?.length && !loading}
			<div
				in:fly|local={sources.length === 1 ? { y: -20, easing: cubicInOut } : undefined}
				class="flex flex-row flex-wrap justify-center gap-2.5 rounded-xl pb-3"
			>
				{#each sources as source, index}
					{#await source then src}
						<UploadedFile
							file={src}
							onclose={() => {
								files = files.filter((_, i) => i !== index);
							}}
						/>
					{/await}
				{/each}
			</div>
		{/if}

		<div class="w-full">
			{#if messages.length === 0 && !loading && !pending}
				<div class="mb-4 flex flex-wrap justify-center gap-2 overflow-x-auto px-4 pb-2 no-scrollbar md:px-0">
					{#each [
						{ text: "Generate an image", icon: "🎨" },
						{ text: "Latest world news", icon: "📰" },
						{ text: "Trending models", icon: "🚀" },
						{ text: "Plan a trip", icon: "🗺️" },
						{ text: "Compare technologies", icon: "💻" },
						{ text: "Find a dataset", icon: "📊" },
						{ text: "Gift ideas", icon: "🎁" }
					] as prompt}
						<button
							type="button"
							class="flex items-center gap-1.5 whitespace-nowrap rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-800 transition-all hover:border-blue-500 hover:bg-blue-50/50 dark:border-gray-800 dark:bg-gray-900/50 dark:text-gray-400 dark:hover:border-gray-700 dark:hover:bg-gray-800"


							onclick={() => {
								draft = prompt.text;
								handleSubmit();
							}}
						>
							{prompt.text}
						</button>
					{/each}
				</div>
			{/if}

			<div class="flex w-full *:mb-3">
				{#if !loading && lastIsError}
					<RetryBtn
						classNames="ml-auto"
						onClick={() => {
							if (lastMessage && lastMessage.ancestors) {
								onretry?.({
									id: lastMessage.id,
								});
							}
						}}
					/>
				{/if}
			</div>
			<form
				tabindex="-1"
				aria-label={isFileUploadEnabled ? "file dropzone" : undefined}
				onsubmit={(e) => {
					e.preventDefault();
					handleSubmit();
				}}
				class={{
					"relative flex w-full max-w-4xl flex-col rounded-2xl border border-gray-200 bg-white p-1.5 shadow-sm backdrop-blur-md focus-within:border-blue-500/30 dark:border-gray-800/60 dark:bg-[#111827]/80 dark:focus-within:border-blue-500/40": true,
					"opacity-30": isReadOnly,
					"max-sm:mb-4": focused && isVirtualKeyboard(),
				}}
			>
				{#if isRecording || isTranscribing}
					<VoiceRecorder
						{isTranscribing}
						{isTouchDevice}
						oncancel={() => {
							isRecording = false;
						}}
						onconfirm={handleRecordingConfirm}
						onsend={handleRecordingSend}
						onerror={handleRecordingError}
					/>
				{:else if onDrag && isFileUploadEnabled}
					<FileDropzone bind:files bind:onDrag mimeTypes={activeMimeTypes} />
				{:else}
					<div
						class="flex w-full flex-1 flex-col rounded-xl border-none bg-transparent"
						class:paste-glow={pastedLongContent}
					>
						{#if lastIsError}
							<ChatInput value="Sorry, something went wrong. Please try again." disabled={true} />
						{:else}
							<ChatInput
								placeholder={isReadOnly ? "This conversation is read-only." : "Ask anything"}
								{loading}
								bind:value={draft}
								bind:files
								mimeTypes={activeMimeTypes}
								onsubmit={handleSubmit}
								{onPaste}
								disabled={isReadOnly || lastIsError}
								{modelIsMultimodal}
								{modelSupportsTools}
								bind:focused
							/>
						{/if}

						<div class="flex items-center justify-between px-2 pb-1.5 pt-1">
							<div class="flex items-center gap-2">
								<button
									type="button"
									class="flex size-7 items-center justify-center rounded-lg bg-gray-100 text-gray-500 transition-all hover:bg-gray-200 dark:bg-white/5 dark:text-gray-400 dark:hover:bg-white/10"
									onclick={() => {
										// Trigger file input
										const input = document.querySelector('input[type="file"]') as HTMLInputElement;
										input?.click();
									}}
									aria-label="Add attachment"
								>
									<svg viewBox="0 0 16 16" fill="currentColor" class="size-4"><path d="M8 1a.75.75 0 0 1 .75.75v5.5h5.5a.75.75 0 0 1 0 1.5h-5.5v5.5a.75.75 0 0 1-1.5 0v-5.5H1.75a.75.75 0 0 1 0-1.5h5.5V1.75A.75.75 0 0 1 8 1Z" /></svg>
								</button>
								
								<div class="flex items-center gap-1.5 rounded-full border border-blue-200/50 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-600 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-400">
									<span class="size-1.5 rounded-full bg-blue-500"></span>
									MCP
									<span class="flex size-3.5 items-center justify-center rounded-full bg-blue-100/50 text-[9px] dark:bg-blue-500/20">2</span>
									<button class="ml-0.5 opacity-50 hover:opacity-100">×</button>
								</div>
							</div>

							<div class="flex items-center gap-2">
								{#if loading}
									<StopGeneratingBtn
										onClick={() => onstop?.()}
										showBorder={true}
										classNames="flex size-8 items-center justify-center rounded-full border bg-white text-black shadow-sm transition-all hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:hover:bg-gray-700"
									/>
								{:else}
									{#if transcriptionEnabled}
										<button
											type="button"
											class="flex size-8 items-center justify-center rounded-full text-gray-500 transition-all hover:bg-gray-200/50 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
											disabled={isReadOnly}
											onclick={() => {
												isRecording = true;
											}}
											aria-label="Start voice recording"
										>
											<IconMic class="size-4" />
										</button>
									{/if}
									<button
										class="flex size-8 items-center justify-center rounded-full bg-gray-200 text-gray-400 shadow-sm transition-all enabled:bg-black enabled:text-white enabled:hover:bg-gray-800 dark:bg-gray-800 dark:text-gray-500 dark:enabled:bg-white dark:enabled:text-black dark:enabled:hover:bg-gray-200 sm:size-7 {!draft ||
										isReadOnly
											? ''
											: '!bg-black !text-white dark:!bg-white dark:!text-black'}"
										disabled={!draft || isReadOnly}
										type="submit"
										aria-label="Send message"
										name="submit"
									>
										<IconArrowUp class="size-4" />
									</button>
								{/if}
							</div>
						</div>

					</div>
				{/if}
			</form>
			<div
				class={{
					"mt-2 flex h-5 items-center justify-center self-stretch whitespace-nowrap px-0.5 text-[10px] text-gray-450 dark:text-gray-500 max-md:mb-2": true,
					"max-sm:hidden": focused && isVirtualKeyboard(),
				}}
			>
				{#if loading && streamingToolCallName}
					<span class="inline-flex items-center gap-1 whitespace-nowrap">
						<LucideHammer class="size-3" />
						Calling tool
						<span class="loading-dots font-medium">
							{availableTools.find((t) => t.name === streamingToolCallName)?.displayName ??
								streamingToolCallName}
						</span>
					</span>
				{:else}
					<div class="flex items-center gap-1.5 uppercase tracking-wider">
						<span>{currentModel.displayName}</span>
						{#if !messages.length && !loading}
							<span class="mx-1 opacity-50">•</span>
							<span>Generated content may be inaccurate or false.</span>
						{/if}
					</div>
				{/if}
			</div>
		</div>

	</div>
</div>

<style lang="postcss">
	.paste-glow {
		animation: glow 1s cubic-bezier(0.4, 0, 0.2, 1) forwards;
		will-change: box-shadow;
	}

	@keyframes glow {
		0% {
			box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.8);
		}
		50% {
			box-shadow: 0 0 20px 4px rgba(59, 130, 246, 0.6);
		}
		100% {
			box-shadow: 0 0 0 0 rgba(59, 130, 246, 0);
		}
	}

	.loading-dots::after {
		content: "";
		animation: dots-content 0.9s steps(1, end) infinite;
	}
	@keyframes dots-content {
		0% {
			content: "";
		}
		33% {
			content: ".";
		}
		66% {
			content: "..";
		}
		88% {
			content: "...";
		}
	}
</style>
