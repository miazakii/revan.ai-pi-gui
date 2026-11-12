import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
	ArrowDownIcon,
	BrainIcon,
	CheckIcon,
	ChevronDownIcon,
	ChevronUpIcon,
	CopyIcon,
	FilePenLineIcon,
	FileTextIcon,
	FolderIcon,
	GitBranchIcon,
	GlobeIcon,
	InfoIcon,
	Loader2Icon,
	RotateCcwIcon,
	SearchIcon,
	SparklesIcon,
	TerminalIcon,
	XIcon,
} from "lucide-react";
import { cn } from "cn";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Dialog,
	DialogContent,
	DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import MarkdownBlock from "./Markdown.jsx";
import { clockTime, contentText, fmtNum, truncate } from "../utils/format.js";

function ImageBlock({ block }) {
	return (
		<img
			className="msg-image"
			src={`data:${block.mimeType};base64,${block.data}`}
			alt="gambar"
			loading="lazy"
		/>
	);
}

function ContentBlocks({ content }) {
	return (
		<div className="content space-y-3">
			{typeof content === "string" ? (
				<MarkdownBlock source={content} />
			) : (
				(content ?? []).map((block, index) => {
					if (block.type === "text") return <MarkdownBlock key={index} source={block.text} />;
					if (block.type === "image") return <ImageBlock key={index} block={block} />;
					return null;
				})
			)}
		</div>
	);
}

function ThinkingBlock({ text }) {
	const approxTokens = Math.round(text.length / 4);
	return (
		<Collapsible className="group thinking rounded-lg border border-dashed border-border/80">
			<CollapsibleTrigger asChild>
				<button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
					<BrainIcon className="size-3.5 text-amber-600 dark:text-amber-300" />
					<span>
						Thinking · {fmtNum(text.length)} char
						<span className="ml-1 text-muted-foreground/70"> (~{fmtNum(approxTokens)} token)</span>
					</span>
					<ChevronDownIcon className="ml-auto size-3.5 transition-transform group-data-[state=open]:rotate-180" />
				</button>
			</CollapsibleTrigger>
			<CollapsibleContent>
				<Separator />
				<pre className="think-body p-3">{text}</pre>
			</CollapsibleContent>
		</Collapsible>
	);
}

function toolSummary(name, args) {
	if (!args || typeof args !== "object") return "";
	if (name === "bash") return args.command ?? "";
	if (typeof args.path === "string") return args.path;
	if (typeof args.pattern === "string") return args.pattern;
	if (typeof args.command === "string") return args.command;
	return Object.keys(args).slice(0, 3).join(", ");
}

function toolIcon(name) {
	switch (name) {
		case "bash":
			return TerminalIcon;
		case "read":
			return FileTextIcon;
		case "edit":
		case "write":
			return FilePenLineIcon;
		case "grep":
		case "find":
			return SearchIcon;
		case "ls":
			return FolderIcon;
		case "web":
		case "fetch":
			return GlobeIcon;
		default:
			return TerminalIcon;
	}
}

function DiffBlock({ diffText }) {
	return (
		<div className="diff">
			{String(diffText)
				.split("\n")
				.map((line, index) => {
					const kind = line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : "ctx";
					return (
						<div key={index} className={`diff-line ${kind}`}>
							{line || " "}
						</div>
					);
				})}
		</div>
	);
}

function diffStats(diff) {
	if (!diff) return null;
	const lines = String(diff).split("\n");
	const added = lines.filter((line) => line.startsWith("+")).length;
	const removed = lines.filter((line) => line.startsWith("-")).length;
	return { added, removed };
}

function ToolStatus({ status, isError, startedAt }) {
	const running = status === "…" || status === "jalan…";
	const [now, setNow] = useState(Date.now());
	useEffect(() => {
		if (!running || !startedAt) return;
		const timer = setInterval(() => setNow(Date.now()), 250);
		return () => clearInterval(timer);
	}, [running, startedAt]);
	if (isError) {
		return (
			<Badge className="tool-state h-5 shrink-0 px-1.5 text-[10px]" variant="destructive">
				Gagal
			</Badge>
		);
	}
	if (running) {
		return (
			<span className="tool-state inline-flex h-5 shrink-0 items-center gap-1 px-1.5 font-mono text-[10px] text-muted-foreground">
				<Loader2Icon className="size-3 animate-spin" />
				{startedAt ? `${Math.max(0, (now - startedAt) / 1000).toFixed(1)}s` : "Jalan"}
			</span>
		);
	}
	if (/^\d+(?:\.\d+)?s$/.test(status ?? "")) {
		return (
			<span className="tool-state shrink-0 px-1 font-mono text-[10px] text-muted-foreground">
				{status}
			</span>
		);
	}
	// Sukses tanpa durasi tidak perlu badge; kurangi noise visual.
	return <span className="tool-state shrink-0" aria-hidden="true" />;
}

function ToolResultView({ result }) {
	const text = result?.output ?? "";
	const diff = typeof result?.details?.diff === "string" ? result.details.diff : null;
	return (
		<>
			{diff ? <DiffBlock diffText={diff} /> : null}
			{text ? (
				diff ? (
					<details className="raw-output">
						<summary>Output Mentah</summary>
						<pre className="tool-output mt-2 rounded-md border bg-muted/30 p-2">
							{truncate(text, 20_000)}
						</pre>
					</details>
				) : (
					<pre className="tool-output rounded-md border bg-muted/30 p-2">
						{truncate(text, 20_000)}
					</pre>
				)
			) : null}
		</>
	);
}

const ToolCard = memo(function ToolCard({ call, result }) {
	const stats = diffStats(result?.details?.diff);
	const status = result?.status ?? "…";
	const Icon = toolIcon(call.name);
	const isError = Boolean(result?.isError);
	const summary = toolSummary(call.name, call.arguments);
	const [copied, setCopied] = useState(false);
	const output = result?.output ?? "";

	const copyOutput = async () => {
		if (!output) return;
		try {
			await navigator.clipboard.writeText(output);
			setCopied(true);
			setTimeout(() => setCopied(false), 1200);
		} catch {
			/* clipboard ditolak */
		}
	};

	return (
		<Card
			className={cn(
				"tool gap-0 overflow-hidden border-border/70 bg-card/60 py-0 shadow-none",
				isError && "border-destructive/40",
			)}
			data-call-id={call.id}
		>
			<Collapsible className="group">
				<CollapsibleTrigger asChild>
					<button className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
						<span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
							<Icon className="size-3.5" />
						</span>
						<span className="tool-name shrink-0 font-mono text-xs font-semibold text-rose-700 dark:text-primary">
							{call.name}
						</span>
						<code
							className="tool-arg min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground"
							title={summary}
						>
							{summary}
						</code>
						<span className="tool-diffstat shrink-0 font-mono text-[10.5px]">
							{stats ? (
								<>
									<span className="add text-emerald-600 dark:text-emerald-400">+{stats.added}</span>
									<span className="del text-rose-600 dark:text-rose-400"> −{stats.removed}</span>
								</>
							) : null}
						</span>
						<ToolStatus status={status} isError={isError} startedAt={result?.startedAt} />
						<ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
					</button>
				</CollapsibleTrigger>
				<CollapsibleContent>
					<Separator />
					<div className="tool-body flex flex-col gap-2 p-3">
						{output ? (
							<div className="flex justify-end">
								<Button
									type="button"
									size="xs"
									variant="ghost"
									className="gap-1 text-[10.5px] text-muted-foreground"
									onClick={copyOutput}
								>
									{copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
									{copied ? "Tersalin" : "Salin Output"}
								</Button>
							</div>
						) : null}
						<pre className="tool-args rounded-md border bg-muted/30 p-2">
							{JSON.stringify(call.arguments ?? {}, null, 2)}
						</pre>
						<div className="tool-result">
							<ToolResultView result={result} />
						</div>
					</div>
				</CollapsibleContent>
			</Collapsible>
		</Card>
	);
});

function messageText(message) {
	return (message.content ?? [])
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("\n\n")
		.trim();
}

const AssistantMessage = memo(
	function AssistantMessage({ message, toolResults, showModel, onCopy, previousUser, onRegenerate }) {
		const text = messageText(message);
		const timestamp = clockTime(message.timestamp);
		const showTimestamp = Boolean(timestamp && (showModel || text || message.errorMessage));
		const showMeta =
			(showModel && message.model) || Boolean(message.errorMessage) || showTimestamp || Boolean(text);
		return (
			<div className="msg assistant group/msg w-full space-y-3">
				<div className="body space-y-3">
					{(message.content ?? []).map((block, index) => {
						if (block.type === "text") return <MarkdownBlock key={index} source={block.text} />;
						if (block.type === "thinking") return <ThinkingBlock key={index} text={block.thinking} />;
						if (block.type === "toolCall") {
							return (
								<ToolCard
									key={block.id ?? index}
									call={block}
									result={toolResults[block.id]}
								/>
							);
						}
						return null;
					})}
					{message.errorMessage ? (
						<div className="error-text rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
							{message.errorMessage}
						</div>
					) : null}
				</div>
				{showMeta ? (
				<div className="meta flex items-center gap-2 text-[11px] text-muted-foreground">
					{showModel && message.model ? (
						<Badge variant="outline" className="h-5 font-mono text-[10px]">
							{message.model}
						</Badge>
					) : null}
					{message.stopReason === "error" ? (
						<Badge variant="destructive" className="h-5 text-[10px]">
							error
						</Badge>
					) : null}
					{showTimestamp ? (
						<span className="font-mono text-[10px] text-muted-foreground">
							{timestamp}
						</span>
					) : null}
					{previousUser && (text || message.errorMessage) ? (
						<Button
							type="button"
							size="icon-xs"
							variant="ghost"
							className="ml-auto text-muted-foreground opacity-70 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/msg:opacity-100 focus-visible:opacity-100"
							title="Fork dan kirim ulang prompt terakhir"
							aria-label="Ulangi jawaban"
							onClick={() => onRegenerate?.(previousUser.entryId, previousUser.text)}
						>
							<RotateCcwIcon />
						</Button>
					) : null}
					{text ? (
						<Button
							type="button"
							size="icon-xs"
							variant="ghost"
							className={cn("text-muted-foreground opacity-70 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/msg:opacity-100 focus-visible:opacity-100", !previousUser && "ml-auto")}
							title="Salin jawaban"
							aria-label="Salin jawaban"
							onClick={() => onCopy?.(text, "jawaban disalin")}
						>
							<CopyIcon />
						</Button>
					) : null}
				</div>
				) : null}
			</div>
		);
	},
	(prev, next) => {
		if (
			prev.message !== next.message ||
			prev.showModel !== next.showModel ||
			prev.onCopy !== next.onCopy ||
			prev.previousUser !== next.previousUser ||
			prev.onRegenerate !== next.onRegenerate
		) {
			return false;
		}
		for (const block of prev.message.content ?? []) {
			if (block.type !== "toolCall") continue;
			if (prev.toolResults[block.id] !== next.toolResults[block.id]) return false;
		}
		return true;
	},
);

function Note({ children }) {
	return (
		<div className="note flex items-start gap-2 rounded-md border border-dashed border-border/80 px-3 py-2 text-xs text-muted-foreground">
			<InfoIcon className="mt-0.5 size-3.5 shrink-0" />
			<span>{children}</span>
		</div>
	);
}

const MessageView = memo(function MessageView({
	message,
	toolResults,
	toolCallIds,
	showModel,
	onCopy,
	onFork,
	onRegenerate,
	previousUser,
}) {
	switch (message.role) {
		case "__note":
			return <Note>{message.text}</Note>;
		case "user": {
			const text = contentText(message.content).trim();
			return (
				<Card className="msg user group/msg relative ml-auto w-fit max-w-[85%] border-primary/20 bg-primary/5 py-0 shadow-none">
					<CardContent className="p-3">
						<div className="role mb-1 flex items-center gap-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
							<span>you</span>
							<span className="ml-auto flex items-center gap-1 normal-case tracking-normal">
								{clockTime(message.timestamp) ? (
									<span className="font-mono text-[10px] text-muted-foreground">
										{clockTime(message.timestamp)}
									</span>
								) : null}
								<span className="flex items-center gap-0.5 opacity-70 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/msg:opacity-100 focus-within:opacity-100">
								{text ? (
									<Button
										type="button"
										size="icon-xs"
										variant="ghost"
										title="Salin pesan"
										aria-label="Salin pesan"
										onClick={() => onCopy?.(text, "pesan disalin")}
									>
										<CopyIcon />
									</Button>
								) : null}
								{message.entryId && text ? (
									<Button
										type="button"
										size="icon-xs"
										variant="ghost"
										title="Fork dari pesan ini"
										aria-label="Fork dari pesan ini"
										onClick={() => onFork?.(message.entryId, text)}
									>
										<GitBranchIcon />
									</Button>
								) : null}
								</span>
							</span>
						</div>
						<ContentBlocks content={message.content} />
					</CardContent>
				</Card>
			);
		}
		case "assistant":
			return (
				<AssistantMessage
					message={message}
					toolResults={toolResults}
					showModel={showModel}
					onCopy={onCopy}
				/>
			);
		case "toolResult": {
			if (toolCallIds.has(message.toolCallId)) return null;
			return (
				<ToolCard
					call={{ id: message.toolCallId, name: message.toolName, arguments: {} }}
					result={
						toolResults[message.toolCallId] ?? {
							output: contentText(message.content),
							isError: Boolean(message.isError),
							details: message.details,
							status: message.isError ? "gagal" : "selesai",
						}
					}
				/>
			);
		}
		case "bashExecution":
			return (
				<Card
					className={cn(
						"msg bash gap-0 overflow-hidden border-border/70 bg-card/60 py-0 shadow-none",
						message.exitCode ? "border-destructive/40" : "",
					)}
				>
					<CardContent className="p-3">
						<div className="bash-head mb-2 flex items-center gap-2 font-mono text-xs text-emerald-600 dark:text-emerald-400">
							<TerminalIcon className="size-3.5" />$ {message.command}
						</div>
						<pre className="tool-output rounded-md border bg-muted/30 p-2">
							{message.output || "(tanpa output)"}
						</pre>
					</CardContent>
				</Card>
			);
		case "compactionSummary":
			return <Note>konteks diringkas · {fmtNum(message.tokensBefore)} token</Note>;
		case "branchSummary":
			return <Note>ringkasan branch</Note>;
		case "custom":
			return message.display ? <Note>{contentText(message.content)}</Note> : null;
		case "system":
			return null;
		default:
			return null;
	}
});

function LiveAssistant({ live }) {
	if (!live) return null;
	const hasBlocks = live.blocks.length > 0;
	return (
		<div className="msg assistant live w-full space-y-3">
			{live.thinkingText ? (
				<Collapsible defaultOpen className="group thinking rounded-lg border border-dashed border-border/80">
					<CollapsibleTrigger asChild>
						<button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:text-foreground">
							<BrainIcon className="size-3.5 text-amber-600 dark:text-amber-300" />
							<span>Thinking… ({fmtNum(live.thinkingText.length)} char)</span>
							<ChevronDownIcon className="ml-auto size-3.5 transition-transform group-data-[state=open]:rotate-180" />
						</button>
					</CollapsibleTrigger>
					<CollapsibleContent>
						<Separator />
						<pre className="think-body p-3">{truncate(live.thinkingText, 12_000)}</pre>
					</CollapsibleContent>
				</Collapsible>
			) : live.thinking ? (
				<div className="thinking-indicator flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300">
					<span className="size-1.5 animate-pulse rounded-full bg-amber-500 dark:bg-amber-300" />
					Thinking…
				</div>
			) : null}
			<div className="body space-y-3">
				{live.blocks.map((block) => (
					<MarkdownBlock
						key={block.index}
						source={block.text}
						allowAuto={block.final}
					/>
				))}
				{hasBlocks ? <span className="live-cursor" aria-hidden="true" /> : null}
			</div>
		</div>
	);
}

function searchableText(message, toolResults) {
	if (!message) return "";
	if (message.role === "__note") return message.text ?? "";
	if (message.role === "assistant") {
		const parts = [];
		for (const block of message.content ?? []) {
			if (block.type === "text") parts.push(block.text ?? "");
			else if (block.type === "thinking") parts.push(block.thinking ?? "");
			else if (block.type === "toolCall") {
				parts.push(block.name ?? "");
				parts.push(JSON.stringify(block.arguments ?? {}));
				parts.push(toolResults?.[block.id]?.output ?? "");
			}
		}
		return parts.join("\n").slice(0, 40_000);
	}
	return contentText(message.content);
}

export default function Transcript({
	messages,
	live,
	toolResults,
	notice,
	onCopyError,
	onNotify,
	onFork,
	onRegenerate,
	isStreaming = false,
	sessionKey = null,
	className,
}) {
	const transcriptRef = useRef(null);
	const stickRef = useRef(true);
	const initializedKeyRef = useRef(null);
	const saveScrollTimerRef = useRef(null);
	const searchInputRef = useRef(null);
	const [atBottom, setAtBottom] = useState(true);
	const [lightbox, setLightbox] = useState(null);
	const [searchOpen, setSearchOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [matchIndex, setMatchIndex] = useState(0);

	const toolCallIds = useMemo(() => {
		const ids = new Set();
		for (const message of messages) {
			if (message.role !== "assistant") continue;
			for (const block of message.content ?? []) {
				if (block.type === "toolCall" && block.id) ids.add(block.id);
			}
		}
		return ids;
	}, [messages]);

	const showModelByIndex = useMemo(() => {
		const out = new Map();
		let lastModel = null;
		messages.forEach((message, index) => {
			if (message.role !== "assistant") return;
			const model = message.model ?? null;
			if (model && model !== lastModel) out.set(index, true);
			if (model) lastModel = model;
		});
		return out;
	}, [messages]);

	const previousUserByIndex = useMemo(() => {
		const out = new Map();
		let lastUser = null;
		messages.forEach((message, index) => {
			if (message.role === "user") {
				const text = contentText(message.content).trim();
				lastUser = message.entryId ? { entryId: message.entryId, text } : null;
			} else if (message.role === "assistant" && lastUser) {
				out.set(index, lastUser);
			}
		});
		return out;
	}, [messages]);

	const searchMatches = useMemo(() => {
		const needle = query.trim().toLowerCase();
		if (!needle) return [];
		const out = [];
		messages.forEach((message, index) => {
			if (message.role === "system") return;
			if (message.role === "toolResult" && toolCallIds.has(message.toolCallId)) return;
			if (message.role === "custom" && !message.display) return;
			if (searchableText(message, toolResults).toLowerCase().includes(needle)) out.push(index);
		});
		return out;
	}, [messages, toolResults, query, toolCallIds]);

	const activeMatch =
		searchOpen && searchMatches.length > 0
			? searchMatches[matchIndex % searchMatches.length]
			: -1;

	useEffect(() => {
		setMatchIndex(0);
	}, [query]);

	useEffect(() => {
		if (!searchOpen || activeMatch < 0) return;
		const node = transcriptRef.current?.querySelector(`[data-msg-index="${activeMatch}"]`);
		node?.scrollIntoView({
			block: "center",
			behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
				? "auto"
				: "smooth",
		});
	}, [activeMatch, searchOpen]);

	useEffect(() => {
		const onFind = (event) => {
			if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "f") return;
			event.preventDefault();
			setSearchOpen(true);
			setTimeout(() => searchInputRef.current?.focus(), 0);
		};
		window.addEventListener("keydown", onFind);
		return () => window.removeEventListener("keydown", onFind);
	}, []);

	useEffect(
		() => () => {
			if (saveScrollTimerRef.current) clearTimeout(saveScrollTimerRef.current);
		},
		[],
	);

	useLayoutEffect(() => {
		const node = transcriptRef.current;
		if (!node) return;
		const key = sessionKey || "anonymous";
		if (initializedKeyRef.current !== key && messages.length > 0) {
			initializedKeyRef.current = key;
			let saved = null;
			try {
				saved = JSON.parse(localStorage.getItem(`pi-gui-scroll:${key}`) ?? "null");
			} catch {
				saved = null;
			}
			if (saved && Number.isFinite(saved.top)) {
				node.scrollTop = saved.top;
				stickRef.current = Boolean(saved.atBottom);
				setAtBottom(Boolean(saved.atBottom));
			} else {
				node.scrollTop = node.scrollHeight;
				stickRef.current = true;
				setAtBottom(true);
			}
			return;
		}
		if (stickRef.current) node.scrollTop = node.scrollHeight;
		setAtBottom(node.scrollHeight - node.scrollTop - node.clientHeight < 120);
	}, [messages, live, notice, sessionKey]);

	useEffect(() => {
		const node = transcriptRef.current;
		if (!node || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(() => {
			if (stickRef.current) node.scrollTop = node.scrollHeight;
			setAtBottom(node.scrollHeight - node.scrollTop - node.clientHeight < 120);
		});
		observer.observe(node);
		return () => observer.disconnect();
	}, []);

	const copyText = useCallback(
		async (text, label = "disalin") => {
			try {
				await navigator.clipboard.writeText(text);
				onNotify?.(label);
			} catch {
				onCopyError?.("clipboard ditolak browser", "error");
			}
		},
		[onNotify, onCopyError],
	);

	const onCopyClick = async (event) => {
		const image = event.target.closest?.("img");
		if (image && (image.classList.contains("msg-image") || image.closest(".md"))) {
			setLightbox(image.src);
			return;
		}
		const button = event.target.closest?.("[data-copy]");
		if (!button) return;
		const code = button.closest(".code")?.querySelector("pre");
		if (!code) return;
		try {
			await navigator.clipboard.writeText(code.textContent ?? "");
			button.textContent = "✓";
			setTimeout(() => {
				button.textContent = "Copy";
			}, 1200);
		} catch {
			onCopyError?.("clipboard ditolak browser", "error");
		}
	};

	const scrollToBottom = () => {
		const node = transcriptRef.current;
		if (!node) return;
		stickRef.current = true;
		setAtBottom(true);
		node.scrollTo({
			top: node.scrollHeight,
			behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
				? "auto"
				: "smooth",
		});
	};

	const goMatch = (delta) => {
		if (searchMatches.length === 0) return;
		setMatchIndex((current) => {
			const next = current + delta;
			return (next + searchMatches.length) % searchMatches.length;
		});
	};

	const empty = messages.length === 0 && !live && !notice;

	return (
		<div className={cn("relative flex min-h-0 flex-1 flex-col", className)}>
			<div className="absolute top-2 right-3 z-20">
				{searchOpen ? (
					<div className="flex items-center gap-1 rounded-lg border border-border/70 bg-background/95 p-1 shadow-lg backdrop-blur">
						<SearchIcon className="ml-1 size-3.5 shrink-0 text-muted-foreground" />
						<Input
							ref={searchInputRef}
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder="Cari di transcript…"
							aria-label="Cari di transcript"
							className="h-7 w-36 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0 sm:w-52"
							onKeyDown={(event) => {
								if (event.key === "Enter") {
									event.preventDefault();
									goMatch(event.shiftKey ? -1 : 1);
								}
								if (event.key === "Escape") {
									event.preventDefault();
									event.stopPropagation();
									setSearchOpen(false);
								}
							}}
						/>
						<span className="min-w-10 shrink-0 text-center font-mono text-[10px] text-muted-foreground">
							{searchMatches.length
								? `${(matchIndex % searchMatches.length) + 1}/${searchMatches.length}`
								: "0"}
						</span>
						<Button
							type="button"
							size="icon-xs"
							variant="ghost"
							title="Hasil sebelumnya (Shift+Enter)"
							aria-label="Hasil sebelumnya"
							onClick={() => goMatch(-1)}
						>
							<ChevronUpIcon />
						</Button>
						<Button
							type="button"
							size="icon-xs"
							variant="ghost"
							title="Hasil berikutnya (Enter)"
							aria-label="Hasil berikutnya"
							onClick={() => goMatch(1)}
						>
							<ChevronDownIcon />
						</Button>
						<Button
							type="button"
							size="icon-xs"
							variant="ghost"
							title="Tutup pencarian (Esc)"
							aria-label="Tutup pencarian"
							onClick={() => setSearchOpen(false)}
						>
							<XIcon />
						</Button>
					</div>
				) : (
					<Button
						type="button"
						size="icon-sm"
						variant="secondary"
						className="border border-border/70 shadow-sm"
						title="Cari di transcript (⌘/Ctrl+F)"
						aria-label="Cari di transcript"
						onClick={() => {
							setSearchOpen(true);
							setTimeout(() => searchInputRef.current?.focus(), 0);
						}}
					>
						<SearchIcon />
					</Button>
				)}
			</div>
			<main
				id="transcript"
				ref={transcriptRef}
				role="log"
				aria-label="Transkrip percakapan"
				aria-live="polite"
				aria-relevant="additions text"
				aria-busy={isStreaming}
				className="transcript min-h-0 flex-1 overflow-y-auto overscroll-contain"
				onClick={onCopyClick}
				onScroll={() => {
					const node = transcriptRef.current;
					if (!node) return;
					const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 120;
					stickRef.current = nearBottom;
					setAtBottom(nearBottom);
					const key = sessionKey || "anonymous";
					if (saveScrollTimerRef.current) clearTimeout(saveScrollTimerRef.current);
					saveScrollTimerRef.current = setTimeout(() => {
						try {
							localStorage.setItem(
								`pi-gui-scroll:${key}`,
								JSON.stringify({ top: node.scrollTop, atBottom: nearBottom }),
							);
						} catch {
							/* localStorage diblokir */
						}
					}, 200);
				}}
			>
				<div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 py-6">
					{empty ? (
						<Empty className="border border-dashed border-border/70">
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<SparklesIcon />
								</EmptyMedia>
								<EmptyTitle>Mulai percakapan</EmptyTitle>
								<EmptyDescription>
									Ketik pesan di bawah, tempel screenshot, atau ketik{" "}
									<code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">/</code>{" "}
									untuk command.
								</EmptyDescription>
							</EmptyHeader>
						</Empty>
					) : null}

					{messages.map((message, index) => {
						if (message.role === "system") return null;
						if (message.role === "toolResult" && toolCallIds.has(message.toolCallId)) return null;
						if (message.role === "custom" && !message.display) return null;
						return (
							<div
								key={message.id ?? message.entryId ?? `${message.role}-${index}`}
								data-msg-index={index}
								className={cn(
									"rounded-lg transition-shadow",
									activeMatch === index && "ring-2 ring-primary/50",
								)}
							>
								<MessageView
									message={message}
									toolResults={toolResults}
									toolCallIds={toolCallIds}
									showModel={showModelByIndex.get(index) ?? false}
									onCopy={copyText}
									onFork={onFork}
								/>
							</div>
						);
					})}
					<LiveAssistant live={live} />
					{notice ? (
						<div className="note flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
							<CircleAlertIcon className="size-3.5 shrink-0" />
							{notice}
						</div>
					) : null}
				</div>
			</main>

			{!atBottom ? (
				<Button
					type="button"
					size="sm"
					variant="secondary"
					className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 gap-1.5 rounded-full border border-border/70 shadow-lg"
					onClick={scrollToBottom}
				>
					<ArrowDownIcon className="size-3.5" />
					Pesan Terbaru
				</Button>
			) : null}

			<Dialog
				open={Boolean(lightbox)}
				onOpenChange={(open) => {
					if (!open) setLightbox(null);
				}}
			>
				<DialogContent className="max-w-5xl border-border/70 bg-background/95 p-2">
					<DialogTitle className="sr-only">Gambar</DialogTitle>
					{lightbox ? (
						<img
							src={lightbox}
							alt="gambar diperbesar"
							className="max-h-[80vh] w-full rounded-md object-contain"
						/>
					) : null}
				</DialogContent>
			</Dialog>
		</div>
	);
}
