import { useRef, useState } from "react";
import { cn } from "cn";
import {
	AlertCircleIcon,
	Minimize2Icon,
	PaperclipIcon,
	SendIcon,
	SquareIcon,
	XIcon,
} from "lucide-react";

import {
	Alert,
	AlertDescription,
} from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Command,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import {
	NativeSelect,
	NativeSelectOption,
} from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { truncate } from "../utils/format.js";

export default function Composer({
	banner,
	onBannerAction,
	onBannerClose,
	queue,
	extWidgetLines,
	attachments,
	onRemoveAttachment,
	slashItems,
	slashIndex,
	onApplySlash,
	inputRef,
	input,
	onInputChange,
	onInputKeyDown,
	onPaste,
	onDropFiles,
	behavior,
	onBehaviorChange,
	stats,
	onSubmit,
	isStreaming = false,
	queueCount = 0,
	contextPercent = 0,
	onStop,
	onCompact,
	stopBusy = false,
}) {
	const fileInputRef = useRef(null);
	const [dragActive, setDragActive] = useState(false);
	const sendLabel = isStreaming ? (behavior === "steer" ? "Steer" : "Antre") : "Kirim";

	return (
		<footer
			className={cn(
				"composer relative shrink-0 border-t border-border/70 bg-background/95 px-4 py-3 backdrop-blur",
				dragActive && "drop-active",
			)}
			onDragOver={(event) => {
				if (!event.dataTransfer?.types.includes("Files")) return;
				event.preventDefault();
				setDragActive(true);
			}}
			onDragLeave={(event) => {
				if (event.currentTarget.contains(event.relatedTarget)) return;
				setDragActive(false);
			}}
			onDrop={(event) => {
				const files = [...(event.dataTransfer?.files ?? [])];
				setDragActive(false);
				if (files.length === 0) return;
				event.preventDefault();
				onDropFiles(files);
			}}
		>
			{dragActive ? (
				<div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-background/80 text-sm font-medium text-primary">
					Lepaskan gambar untuk melampirkan
				</div>
			) : null}
			<div className="mx-auto flex w-full max-w-4xl flex-col gap-2">
				<div id="banner" className={banner ? "" : "hidden"}>
					<Alert
						variant="destructive"
						className="flex items-center gap-2 border-destructive/30 bg-destructive/5 py-2"
					>
						<AlertCircleIcon className="size-4 shrink-0" />
						<AlertDescription
							id="banner-text"
							className="min-w-0 flex-1 truncate text-xs text-destructive/90"
						>
							{banner?.message ?? ""}
						</AlertDescription>
						{banner?.actionLabel ? (
							<Button
								id="banner-action"
								size="xs"
								variant="outline"
								onClick={onBannerAction}
							>
								{banner.actionLabel}
							</Button>
						) : null}
						<Button
							id="banner-close"
							size="icon-xs"
							variant="ghost"
							aria-label="Tutup pesan"
							onClick={onBannerClose}
						>
							<XIcon />
						</Button>
					</Alert>
				</div>

				<div id="queue" className="queue flex flex-wrap gap-1.5 empty:hidden">
					{queue.steering.map((text, index) => (
						<Badge
							key={`steer-${index}`}
							variant="outline"
							className="chip steer h-5 max-w-full border-amber-500/30 bg-amber-500/10 px-2 text-[10.5px] font-normal text-amber-700 dark:text-amber-300"
						>
							Steer · {truncate(text, 90)}
						</Badge>
					))}
					{queue.followUp.map((text, index) => (
						<Badge
							key={`follow-${index}`}
							variant="secondary"
							className="chip h-5 max-w-full px-2 text-[10.5px] font-normal"
						>
							Follow-up · {truncate(text, 90)}
						</Badge>
					))}
					{queue.unknown > 0 ? (
						<Badge variant="secondary" className="chip h-5 px-2 text-[10.5px] font-normal">
							{queue.unknown} pesan di queue
						</Badge>
					) : null}
				</div>

				<div id="ext-widget" className="ext-widget space-y-0.5 empty:hidden">
					{extWidgetLines.map((line, index) => (
						<pre
							key={index}
							className="widget-line m-0 font-mono text-[11px] whitespace-pre-wrap text-muted-foreground"
						>
							{line}
						</pre>
					))}
				</div>

				<div id="attachments" className="attachments flex flex-wrap gap-2 empty:hidden">
					{attachments.map((item, index) => (
						<div
							className="attachment relative overflow-hidden rounded-lg border border-border bg-muted/40"
							key={`${item.mimeType}-${index}`}
							title={
								item.size
									? `${item.mimeType} · ${Math.round(item.size / 1024)} KB`
									: item.mimeType
							}
						>
							<img src={item.preview} alt={item.mimeType} />
							<Button
								className="absolute top-1 right-1"
								size="icon-xs"
								variant="secondary"
								title="Hapus gambar"
								aria-label="Hapus gambar"
								onClick={() => onRemoveAttachment(index)}
							>
								<XIcon />
							</Button>
						</div>
					))}
				</div>

				<div id="slash" className={cn("slash", slashItems.length ? "" : "hidden")}>
					<Command
						shouldFilter={false}
						className="overflow-hidden rounded-xl border border-border bg-popover shadow-lg"
					>
						<CommandList className="max-h-[240px]">
							{slashItems.map((command, index) => (
								<CommandItem
									key={`${command.source ?? "cmd"}-${command.name}`}
									value={`${command.source ?? "cmd"}-${command.name}`}
									className={cn(
										"slash-item flex items-baseline gap-2 px-3 py-2",
										index === slashIndex && "bg-accent text-accent-foreground",
									)}
									onSelect={() => onApplySlash(command)}
								>
									<span className="cmd shrink-0 font-mono text-xs text-rose-700 dark:text-primary">
										/{command.name}
									</span>
									<span className="desc min-w-0 flex-1 truncate text-xs text-muted-foreground">
										{command.description ?? ""}
									</span>
									<span className="src shrink-0 text-[10px] text-muted-foreground/70">
										{command.source ?? ""}
									</span>
								</CommandItem>
							))}
						</CommandList>
					</Command>
				</div>

				{contextPercent >= 80 ? (
					<Alert className="flex items-center gap-2 border-amber-500/40 bg-amber-500/10 py-2">
						<AlertCircleIcon className="size-4 shrink-0 text-amber-600 dark:text-amber-300" />
						<AlertDescription className="min-w-0 flex-1 text-xs text-amber-800 dark:text-amber-200">
							Konteks sudah {Math.round(contextPercent)}%. Ringkas percakapan agar
							tidak kehabisan ruang.
						</AlertDescription>
						<Button
							type="button"
							size="xs"
							variant="outline"
							className="shrink-0 gap-1"
							onClick={onCompact}
						>
							<Minimize2Icon className="size-3" />
							Compact
						</Button>
					</Alert>
				) : null}

				<div className="rounded-xl border border-input bg-card shadow-sm transition-shadow focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/20">
					<Textarea
						id="input"
						ref={inputRef}
						rows={3}
						placeholder="Tanya sesuatu…  (Enter kirim · Shift+Enter baris baru · Esc stop · / untuk command)"
						className="max-h-80 min-h-[76px] resize-none border-0 bg-transparent p-3 text-sm shadow-none focus-visible:ring-0 dark:bg-transparent"
						value={input}
						onChange={(event) => onInputChange(event.target.value)}
						onKeyDown={onInputKeyDown}
						onPaste={onPaste}
					/>
					<div className="flex items-center gap-2 border-t border-border/70 px-2 py-1.5">
						<div
							className={cn(
								"w-[110px] shrink-0",
								!isStreaming && queueCount === 0 && "hidden",
							)}
						>
							<NativeSelect
								id="behavior"
								size="sm"
								className="h-7 text-xs"
								title="Perilaku saat agent sedang berjalan"
								value={behavior}
								onChange={(event) => onBehaviorChange(event.target.value)}
								tabIndex={!isStreaming && queueCount === 0 ? -1 : undefined}
							>
								<NativeSelectOption value="followUp">Follow-up</NativeSelectOption>
								<NativeSelectOption value="steer">Steer</NativeSelectOption>
							</NativeSelect>
						</div>
						<span
							id="stats"
							className="stats min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground"
						>
							{stats}
						</span>
						<input
							ref={fileInputRef}
							type="file"
							accept="image/*"
							multiple
							className="hidden"
							onChange={(event) => {
								const files = [...(event.target.files ?? [])];
								if (files.length > 0) onDropFiles(files);
								event.target.value = "";
							}}
						/>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									type="button"
									variant="ghost"
									size="icon-sm"
									aria-label="Lampirkan gambar"
									onClick={() => fileInputRef.current?.click()}
								>
									<PaperclipIcon />
								</Button>
							</TooltipTrigger>
							<TooltipContent side="top">Lampirkan gambar</TooltipContent>
						</Tooltip>
						{isStreaming ? (
							<Button
								id="composer-stop"
								type="button"
								size="icon-sm"
								variant="outline"
								className="text-destructive"
								title="Hentikan run (Esc)"
								aria-label="Hentikan run"
								disabled={stopBusy}
								onClick={onStop}
							>
								<SquareIcon className="size-3.5" />
							</Button>
						) : null}
						<Button
							id="send"
							type="button"
							size="sm"
							className="primary gap-1.5"
							onClick={onSubmit}
							title={
								isStreaming
									? "Kirim ke queue agent yang sedang berjalan"
									: "Kirim pesan (Enter)"
							}
						>
							<SendIcon className="size-3.5" />
							{sendLabel}
						</Button>
					</div>
				</div>

				<div className="hidden items-center gap-1.5 text-[11px] text-muted-foreground sm:flex">
					<Kbd>Enter</Kbd>
					<span>{isStreaming ? "Antre" : "Kirim"}</span>
					<Kbd>Shift</Kbd>
					<span>+</span>
					<Kbd>Enter</Kbd>
					<span>Baris Baru</span>
					<Kbd>Esc</Kbd>
					<span>Stop</span>
					<span className="ml-auto font-mono text-muted-foreground/70">/ command</span>
				</div>
			</div>
		</footer>
	);
}
