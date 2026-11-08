import { useLayoutEffect, useMemo, useRef } from "react";
import {
	BrainIcon,
	ChevronDownIcon,
	CircleAlertIcon,
	FilePenLineIcon,
	FileTextIcon,
	FolderIcon,
	GlobeIcon,
	InfoIcon,
	SearchIcon,
	SparklesIcon,
	TerminalIcon,
} from "lucide-react";
import { cn } from "cn";

import { Badge } from "@/components/ui/badge";
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
import { contentText, fmtNum, truncate } from "../utils/format.js";

function ImageBlock({ block }) {
	return (
		<img
			className="msg-image"
			src={`data:${block.mimeType};base64,${block.data}`}
			alt="gambar"
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
	return (
		<Collapsible className="group thinking rounded-lg border border-dashed border-border/80">
			<CollapsibleTrigger asChild>
				<button className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:text-foreground">
					<BrainIcon className="size-3.5 text-amber-300" />
					<span>thinking ({text.length} char)</span>
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

function ToolResultView({ result }) {
	const text = result?.output ?? "";
	const diff = typeof result?.details?.diff === "string" ? result.details.diff : null;
	return (
		<>
			{diff ? <DiffBlock diffText={diff} /> : null}
			{text ? (
				diff ? (
					<details className="raw-output">
						<summary>output mentah</summary>
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

function ToolCard({ call, result }) {
	const stats = diffStats(result?.details?.diff);
	const status = result?.status ?? "…";
	const Icon = toolIcon(call.name);
	const isError = Boolean(result?.isError);

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
					<button className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/40">
						<span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
							<Icon className="size-3.5" />
						</span>
						<span className="tool-name shrink-0 font-mono text-xs font-semibold text-primary">
							{call.name}
						</span>
						<code className="tool-arg min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
							{toolSummary(call.name, call.arguments)}
						</code>
						<span className="tool-diffstat shrink-0 font-mono text-[10.5px]">
							{stats ? (
								<>
									<span className="add text-emerald-400">+{stats.added}</span>
									<span className="del text-rose-400"> −{stats.removed}</span>
								</>
							) : null}
						</span>
						<Badge
							className="tool-state h-5 shrink-0 px-1.5 text-[10px]"
							variant={isError ? "destructive" : "secondary"}
						>
							{status}
						</Badge>
						<ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
					</button>
				</CollapsibleTrigger>
				<CollapsibleContent>
					<Separator />
					<div className="tool-body flex flex-col gap-2 p-3">
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
}

function AssistantMessage({ message, toolResults }) {
	return (
		<div className="msg assistant w-full space-y-3">
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
			<div className="meta flex items-center gap-2 text-[11px] text-muted-foreground">
				{message.model ? (
					<Badge variant="outline" className="h-5 font-mono text-[10px]">
						{message.model}
					</Badge>
				) : null}
				{message.stopReason === "error" ? (
					<Badge variant="destructive" className="h-5 text-[10px]">
						error
					</Badge>
				) : null}
			</div>
		</div>
	);
}

function Note({ children }) {
	return (
		<div className="note flex items-start gap-2 rounded-md border border-dashed border-border/80 px-3 py-2 text-xs text-muted-foreground">
			<InfoIcon className="mt-0.5 size-3.5 shrink-0" />
			<span>{children}</span>
		</div>
	);
}

function MessageView({ message, toolResults, toolCallIds }) {
	switch (message.role) {
		case "__note":
			return <Note>{message.text}</Note>;
		case "user":
			return (
				<Card className="msg user ml-auto w-fit max-w-[85%] border-primary/20 bg-primary/5 py-0 shadow-none">
					<CardContent className="p-3">
						<div className="role mb-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
							you
						</div>
						<ContentBlocks content={message.content} />
					</CardContent>
				</Card>
			);
		case "assistant":
			return <AssistantMessage message={message} toolResults={toolResults} />;
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
						<div className="bash-head mb-2 flex items-center gap-2 font-mono text-xs text-emerald-400">
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
}

function LiveAssistant({ live }) {
	if (!live) return null;
	const hasBlocks = live.blocks.length > 0;
	return (
		<div className="msg assistant live w-full space-y-3">
			{live.thinking ? (
				<div className="thinking-indicator flex items-center gap-2 text-xs text-amber-300">
					<span className="size-1.5 animate-pulse rounded-full bg-amber-300" />
					thinking…
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

export default function Transcript({
	messages,
	live,
	toolResults,
	notice,
	onCopyError,
	className,
}) {
	const transcriptRef = useRef(null);
	const stickRef = useRef(true);

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

	useLayoutEffect(() => {
		const node = transcriptRef.current;
		if (node && stickRef.current) node.scrollTop = node.scrollHeight;
	}, [messages, live, notice]);

	const onCopyClick = async (event) => {
		const button = event.target.closest?.("[data-copy]");
		if (!button) return;
		const code = button.closest(".code")?.querySelector("pre");
		if (!code) return;
		try {
			await navigator.clipboard.writeText(code.textContent ?? "");
			button.textContent = "✓";
			setTimeout(() => {
				button.textContent = "copy";
			}, 1200);
		} catch {
			onCopyError("clipboard ditolak browser", "error");
		}
	};

	const empty = messages.length === 0 && !live && !notice;

	return (
		<main
			id="transcript"
			ref={transcriptRef}
			className={cn(
				"transcript min-h-0 flex-1 overflow-y-auto overscroll-contain",
				className,
			)}
			onClick={onCopyClick}
			onScroll={() => {
				const node = transcriptRef.current;
				if (!node) return;
				stickRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 120;
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

				{messages.map((message, index) => (
					<MessageView
						key={message.id ?? message.entryId ?? `${message.role}-${index}`}
						message={message}
						toolResults={toolResults}
						toolCallIds={toolCallIds}
					/>
				))}
				<LiveAssistant live={live} />
				{notice ? (
					<div className="note flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
						<CircleAlertIcon className="size-3.5 shrink-0" />
						{notice}
					</div>
				) : null}
			</div>
		</main>
	);
}
