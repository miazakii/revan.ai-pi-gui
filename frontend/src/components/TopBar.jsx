import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	NativeSelect,
	NativeSelectOption,
} from "@/components/ui/native-select";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "cn";
import {
	Download,
	Minimize2,
	Plus,
	Square,
} from "lucide-react";

function ActionButton({ id, label, icon: Icon, variant = "ghost", onClick, disabled, shortcut }) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					id={id}
					variant={variant}
					size="sm"
					className="gap-1.5"
					onClick={onClick}
					disabled={disabled}
					aria-label={label}
				>
					<Icon className="size-4" />
					<span className="hidden xl:inline">{label}</span>
				</Button>
			</TooltipTrigger>
			<TooltipContent side="bottom">
				{label}
				{shortcut ? <span className="ml-1 text-muted-foreground">{shortcut}</span> : null}
			</TooltipContent>
		</Tooltip>
	);
}

export default function TopBar({
	cwd,
	onCwdChange,
	onRestart,
	models,
	modelValue,
	onModelChange,
	thinkingLevels,
	thinkingValue,
	onThinkingChange,
	status,
	onNewSession,
	onCompact,
	onExport,
	onStop,
	stopDisabled,
}) {
	const isBusy = /berjalan|menyambung|compacting/i.test(status);
	const isError = /gagal|berhenti|ditolak/i.test(status);

	return (
		<header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/70 bg-background/80 px-3 backdrop-blur">
			<SidebarTrigger
				id="sidebar-toggle"
				className="size-8 shrink-0"
				aria-label="Buka atau tutup sidebar"
			/>
			<span className="brand hidden size-8 shrink-0 select-none items-center justify-center rounded-lg bg-primary text-lg font-bold text-primary-foreground shadow-sm sm:flex">
				π
			</span>

			<Input
				id="cwd"
				className="cwd h-8 min-w-0 flex-1 font-mono text-xs"
				spellCheck={false}
				title="Workspace (Enter untuk pindah)"
				value={cwd}
				onChange={(event) => onCwdChange(event.target.value)}
				onKeyDown={(event) => {
					if (event.key !== "Enter") return;
					event.preventDefault();
					const next = cwd.trim();
					if (next) onRestart(next);
				}}
			/>

			<div className="hidden w-[190px] shrink-0 md:block">
				<NativeSelect
					id="model"
					size="sm"
					className="h-8 w-full text-xs"
					title="Model"
					value={modelValue}
					onChange={(event) => onModelChange(event.target.value)}
				>
					{models.length === 0 ? (
						<NativeSelectOption value="">memuat model…</NativeSelectOption>
					) : null}
					{models.map((model) => {
						const value = `${model.provider}/${model.id}`;
						return (
							<NativeSelectOption key={value} value={value}>
								{value}
							</NativeSelectOption>
						);
					})}
				</NativeSelect>
			</div>

			<div className="hidden w-24 shrink-0 sm:block">
				<NativeSelect
					id="thinking"
					size="sm"
					className="h-8 w-full text-xs"
					title="Thinking level"
					value={thinkingValue}
					onChange={(event) => onThinkingChange(event.target.value)}
				>
					{thinkingLevels.map((level) => (
						<NativeSelectOption key={level} value={level}>
							{level}
						</NativeSelectOption>
					))}
				</NativeSelect>
			</div>

			<Badge
				id="status"
				variant="outline"
				className={cn(
					"status hidden max-w-[190px] shrink-0 gap-1.5 truncate lg:inline-flex",
					isError && "border-destructive/40 text-destructive",
					isBusy && "border-primary/40 text-primary",
				)}
				title={status}
			>
				<span
					className={cn(
						"size-1.5 rounded-full bg-muted-foreground",
						isBusy && "animate-pulse bg-primary",
						isError && "bg-destructive",
						!isBusy && !isError && "bg-emerald-400",
					)}
				/>
				<span className="truncate">{status}</span>
			</Badge>

			<div className="actions ml-auto flex shrink-0 items-center gap-1">
				<ActionButton
					id="new-session"
					label="baru"
					icon={Plus}
					onClick={onNewSession}
				/>
				<ActionButton
					id="compact"
					label="compact"
					icon={Minimize2}
					onClick={onCompact}
				/>
				<ActionButton
					id="export"
					label="export"
					icon={Download}
					onClick={onExport}
				/>
				<ActionButton
					id="abort"
					label="stop"
					icon={Square}
					variant="destructive"
					onClick={onStop}
					disabled={stopDisabled}
					shortcut="Esc"
				/>
			</div>
		</header>
	);
}
