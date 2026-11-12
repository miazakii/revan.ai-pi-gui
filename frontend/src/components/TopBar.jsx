import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	NativeSelect,
	NativeSelectOption,
} from "@/components/ui/native-select";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { SidebarTrigger } from "@/components/ui/sidebar";
import Logo from "./Logo.jsx";
import ThemeMenu from "./ThemeMenu.jsx";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "cn";
import { apiGet } from "../api/client.js";
import {
	ArrowRight,
	ArrowUp,
	Bell,
	Braces,
	FileDown,
	FileText,
	FolderOpen,
	Keyboard,
	Minimize2,
	Plus,
	SlidersHorizontal,
	Square,
} from "lucide-react";

function ActionButton({
	id,
	label,
	icon: Icon,
	variant = "ghost",
	onClick,
	disabled,
	shortcut,
	className,
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					id={id}
					variant={variant}
					size="sm"
					className={cn("gap-1.5", className)}
					onClick={onClick}
					disabled={disabled}
					aria-label={label}
				>
					<Icon className="size-4" />
					<span className="hidden min-[1440px]:inline">{label}</span>
				</Button>
			</TooltipTrigger>
			<TooltipContent side="bottom">
				{label}
				{shortcut ? <span className="ml-1 text-muted-foreground">{shortcut}</span> : null}
			</TooltipContent>
		</Tooltip>
	);
}

function StatusBadge({ id = "status", status, className }) {
	const isBusy = /berjalan|menyambung|compacting/i.test(status);
	const isError = /gagal|berhenti|ditolak/i.test(status);
	return (
		<Badge
			id={id}
			variant="outline"
			className={cn(
				"status max-w-[190px] shrink-0 gap-1.5 truncate",
				isError && "border-destructive/40 text-destructive",
				isBusy && "border-primary/40 text-rose-700 dark:text-primary",
				className,
			)}
			title={status}
			aria-live="polite"
		>
			<span
				className={cn(
					"size-1.5 rounded-full bg-muted-foreground",
					isBusy && "animate-pulse bg-primary",
					isError && "bg-destructive",
					!isBusy && !isError && "bg-emerald-500 dark:bg-emerald-400",
				)}
			/>
			<span className="truncate">{status}</span>
		</Badge>
	);
}

function SettingsSheet({
	open,
	onOpenChange,
	cwd,
	onCwdChange,
	onRestart,
	recentCwds,
	models,
	modelValue,
	onModelChange,
	thinkingLevels,
	thinkingValue,
	onThinkingChange,
	status,
	isStreaming,
	queueCount,
	otherTabs = false,
	onNewSession,
	onCompact,
	onExport,
	onExportMarkdown,
	onExportJson,
	onOpenHelp,
	onEnableNotifications,
	notificationPermission = "default",
	onStop,
	stopDisabled,
}) {
	const [browserOpen, setBrowserOpen] = useState(false);
	const [browsePath, setBrowsePath] = useState(cwd);
	const [browseParent, setBrowseParent] = useState("");
	const [browseDirs, setBrowseDirs] = useState([]);
	const [browseLoading, setBrowseLoading] = useState(false);
	const [browseError, setBrowseError] = useState("");

	const applyCwd = (value) => {
		const next = String(value ?? "").trim();
		if (!next) return;
		onOpenChange(false);
		setBrowserOpen(false);
		if (next === cwd) return;
		onRestart(next);
	};

	const loadDirs = async (path) => {
		setBrowseLoading(true);
		setBrowseError("");
		const data = await apiGet(`/api/dirs?path=${encodeURIComponent(path)}`);
		if (data.error) {
			setBrowseError(data.error);
			setBrowseLoading(false);
			return;
		}
		setBrowsePath(data.path);
		setBrowseParent(data.parent ?? "");
		setBrowseDirs(data.dirs ?? []);
		setBrowseLoading(false);
	};

	const openBrowser = () => {
		setBrowserOpen(true);
		void loadDirs(cwd);
	};

	useEffect(() => {
		if (!open) setBrowserOpen(false);
	}, [open]);

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent
				side="right"
				className="flex w-[92vw] flex-col gap-0 p-0 sm:max-w-sm"
			>
				<SheetHeader className="border-b border-border/70">
					<SheetTitle>Pengaturan sesi</SheetTitle>
					<SheetDescription>
						Model, thinking, dan workspace. Semua bisa diubah saat agent berjalan.
					</SheetDescription>
				</SheetHeader>

				<div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
					<div className="space-y-2">
						<div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
							status
						</div>
						<StatusBadge id="settings-status" status={status} className="max-w-full" />
						{queueCount > 0 ? (
							<p className="text-[11px] text-muted-foreground">
								{queueCount} pesan di queue
							</p>
						) : null}
						{otherTabs ? (
							<p className="text-[11px] text-amber-700 dark:text-amber-300">
								pi-gui terbuka di tab lain; agent dan session dipakai bersama.
							</p>
						) : null}
					</div>

					<div className="space-y-2">
						<label className="text-xs font-medium" htmlFor="settings-cwd">
							workspace
						</label>
						<div className="flex gap-1.5">
							<Input
								id="settings-cwd"
								className="h-8 min-w-0 flex-1 font-mono text-xs"
								spellCheck={false}
								value={cwd}
								onChange={(event) => onCwdChange(event.target.value)}
								onKeyDown={(event) => {
									if (event.key !== "Enter") return;
									event.preventDefault();
									applyCwd(cwd);
								}}
							/>
							<Button
								type="button"
								size="sm"
								variant="outline"
								className="shrink-0 gap-1"
								onClick={() => applyCwd(cwd)}
							>
								<ArrowRight className="size-3.5" />
								Pindah
							</Button>
							<Button
								type="button"
								size="icon-sm"
								variant="outline"
								className="shrink-0"
								title="Jelajahi folder"
								aria-label="Jelajahi folder"
								onClick={openBrowser}
							>
								<FolderOpen className="size-3.5" />
							</Button>
						</div>
						<p className="text-[11px] text-muted-foreground">
							Enter atau tombol pindah akan me-restart proses pi di folder itu.
						</p>
						{recentCwds.length > 0 ? (
							<div className="flex flex-wrap gap-1">
								{recentCwds.slice(0, 6).map((path) => (
									<Button
										key={path}
										type="button"
										variant="secondary"
										size="xs"
										className="max-w-full justify-start truncate font-mono text-[10.5px]"
										title={path}
										onClick={() => applyCwd(path)}
									>
										{path}
									</Button>
								))}
							</div>
						) : null}
					</div>

					<div className="space-y-2">
						<label className="text-xs font-medium" htmlFor="settings-model">
							model
						</label>
						<NativeSelect
							id="settings-model"
							size="sm"
							className="h-9 w-full text-xs"
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
										{model.name ?? model.id}
										{model.contextWindow
											? ` · ${Math.round(model.contextWindow / 1000)}k ctx`
											: ""}
									</NativeSelectOption>
								);
							})}
						</NativeSelect>
					</div>

					<div className="space-y-2">
						<label className="text-xs font-medium" htmlFor="settings-thinking">
							thinking level
						</label>
						<NativeSelect
							id="settings-thinking"
							size="sm"
							className="h-9 w-full text-xs"
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

					<div className="space-y-2">
						<div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
							aksi
						</div>
						<div className="grid grid-cols-2 gap-1.5">
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="justify-start gap-1.5"
								onClick={() => {
									onOpenChange(false);
									onNewSession();
								}}
							>
								<Plus className="size-3.5" /> Sesi Baru
							</Button>
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="justify-start gap-1.5"
								onClick={() => {
									onOpenChange(false);
									onCompact();
								}}
							>
								<Minimize2 className="size-3.5" /> Compact
							</Button>
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="justify-start gap-1.5"
								onClick={() => {
									onOpenChange(false);
									onExport();
								}}
							>
								<FileDown className="size-3.5" /> HTML
							</Button>
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="justify-start gap-1.5"
								onClick={() => {
									onOpenChange(false);
									onExportMarkdown();
								}}
							>
								<FileText className="size-3.5" /> Markdown
							</Button>
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="justify-start gap-1.5"
								onClick={() => {
									onOpenChange(false);
									onExportJson();
								}}
							>
								<Braces className="size-3.5" /> JSON
							</Button>
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="justify-start gap-1.5"
								onClick={() => {
									onOpenChange(false);
									onOpenHelp();
								}}
							>
								<Keyboard className="size-3.5" /> Shortcut
							</Button>
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="col-span-2 justify-start gap-1.5"
								disabled={
									notificationPermission === "granted" ||
									notificationPermission === "unsupported"
								}
								title={
									notificationPermission === "granted"
										? "Notifikasi sudah aktif"
										: "Minta izin notifikasi browser"
								}
								onClick={() => {
									onOpenChange(false);
									onEnableNotifications();
								}}
							>
								<Bell className="size-3.5" />
								{notificationPermission === "granted"
									? "Notifikasi Aktif"
									: notificationPermission === "unsupported"
										? "Notifikasi Tidak Didukung"
										: "Aktifkan Notifikasi Selesai"}
							</Button>
							<Button
								type="button"
								variant="destructive"
								size="sm"
								className="col-span-2 justify-start gap-1.5"
								disabled={stopDisabled}
								onClick={() => {
									onOpenChange(false);
									onStop();
								}}
							>
								<Square className="size-3.5" /> {isStreaming ? "Stop" : "Idle"}
							</Button>
						</div>
					</div>
				</div>

				<SheetFooter className="border-t border-border/70">
					<Button
						type="button"
						variant="secondary"
						onClick={() => onOpenChange(false)}
					>
						Tutup
					</Button>
				</SheetFooter>

				<Dialog open={browserOpen} onOpenChange={setBrowserOpen}>
					<DialogContent className="sm:max-w-lg">
						<DialogHeader>
							<DialogTitle>Pilih workspace</DialogTitle>
							<DialogDescription>
								Telusuri folder, lalu pilih untuk me-restart pi di sana.
							</DialogDescription>
						</DialogHeader>
						<div className="flex items-center gap-1.5">
							<Button
								type="button"
								size="icon-sm"
								variant="outline"
								aria-label="Folder induk"
								title="Folder induk"
								disabled={!browseParent}
								onClick={() => void loadDirs(browseParent)}
							>
								<ArrowUp className="size-3.5" />
							</Button>
							<Input
								value={browsePath}
								onChange={(event) => setBrowsePath(event.target.value)}
								onKeyDown={(event) => {
								if (event.key !== "Enter") return;
								event.preventDefault();
								void loadDirs(browsePath);
							}}
								className="h-8 font-mono text-xs"
								aria-label="Path folder"
							/>
						</div>
						{browseError ? (
							<p className="text-xs text-destructive">{browseError}</p>
						) : null}
						<div className="max-h-64 overflow-y-auto rounded-md border border-border/70">
							{browseLoading ? (
								<p className="p-3 text-xs text-muted-foreground">memuat…</p>
							) : browseDirs.length === 0 ? (
								<p className="p-3 text-xs text-muted-foreground">tidak ada subfolder</p>
							) : (
								browseDirs.map((name) => (
									<button
										key={name}
										type="button"
										className="flex w-full items-center gap-2 border-b border-border/40 px-3 py-2 text-left text-xs last:border-b-0 hover:bg-muted/50"
										onClick={() =>
											void loadDirs(
												`${browsePath.replace(/\/+$/, "")}/${name}`,
											)
										}
									>
										<FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
										<span className="truncate">{name}</span>
									</button>
								))
							)}
						</div>
						<DialogFooter className="gap-2">
							<Button
								type="button"
								variant="secondary"
								onClick={() => setBrowserOpen(false)}
							>
								Batal
							</Button>
							<Button type="button" onClick={() => applyCwd(browsePath)}>
								Pilih Folder Ini
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			</SheetContent>
		</Sheet>
	);
}

export default function TopBar({
	cwd,
	onCwdChange,
	onRestart,
	recentCwds = [],
	models,
	modelValue,
	onModelChange,
	thinkingLevels,
	thinkingValue,
	onThinkingChange,
	status,
	isStreaming,
	queueCount,
	otherTabs = false,
	onNewSession,
	onCompact,
	onExport,
	onExportMarkdown,
	onExportJson,
	onOpenHelp,
	onEnableNotifications,
	notificationPermission = "default",
	onStop,
	stopDisabled,
	sidebarOpen,
}) {
	const [settingsOpen, setSettingsOpen] = useState(false);

	useEffect(() => {
		if (!settingsOpen) return;
		const onKey = (event) => {
			if (event.key === "Escape") setSettingsOpen(false);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [settingsOpen]);

	return (
		<>
			<header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/70 bg-background/80 px-3 backdrop-blur">
				<SidebarTrigger
					id="sidebar-toggle"
					className="size-8 shrink-0"
					aria-label="Buka atau tutup sidebar"
				/>
				<Logo
					className={cn(
						"brand h-4 w-[108px] text-foreground",
						sidebarOpen ? "hidden" : "hidden lg:inline-block",
					)}
				/>

				<Input
					id="cwd"
					className="cwd h-8 min-w-[100px] flex-1 font-mono text-xs sm:min-w-[180px]"
					spellCheck={false}
					title="Workspace (Enter untuk pindah)"
					aria-label="Workspace"
					value={cwd}
					onChange={(event) => onCwdChange(event.target.value)}
					onKeyDown={(event) => {
						if (event.key !== "Enter") return;
						event.preventDefault();
						const next = cwd.trim();
						if (next && next !== cwd) onRestart(next);
					}}
				/>

				<div className="hidden w-[210px] shrink-0 md:block">
					<NativeSelect
						id="model"
						size="sm"
						className="h-8 w-full text-xs"
						title="Model"
						aria-label="Model"
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
									{model.name ?? model.id}
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
						aria-label="Thinking level"
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

				<StatusBadge status={status} className="hidden lg:inline-flex" />

				<div className="actions ml-auto flex shrink-0 items-center gap-1">
					<Button
						id="settings-toggle"
						type="button"
						variant="ghost"
						size="sm"
						className="md:hidden"
						aria-label="Buka pengaturan sesi"
						title="Pengaturan sesi"
						onClick={() => setSettingsOpen(true)}
					>
						<SlidersHorizontal className="size-4" />
					</Button>
					<ThemeMenu />
					<ActionButton
						id="new-session"
						label="Baru"
						icon={Plus}
						onClick={onNewSession}
					/>
					<ActionButton
						id="compact"
						label="Compact"
						icon={Minimize2}
						onClick={onCompact}
						className="hidden md:inline-flex"
					/>
					<ActionButton
						id="export"
						label="Export"
						icon={FileDown}
						onClick={onExport}
						className="hidden md:inline-flex"
					/>
					<ActionButton
						id="abort"
						label="Stop"
						icon={Square}
						variant="destructive"
						onClick={onStop}
						disabled={stopDisabled}
						shortcut="Esc"
					/>
				</div>
			</header>

			<SettingsSheet
				open={settingsOpen}
				onOpenChange={setSettingsOpen}
				cwd={cwd}
				onCwdChange={onCwdChange}
				onRestart={onRestart}
				recentCwds={recentCwds}
				models={models}
				modelValue={modelValue}
				onModelChange={onModelChange}
				thinkingLevels={thinkingLevels}
				thinkingValue={thinkingValue}
				onThinkingChange={onThinkingChange}
				status={status}
				isStreaming={isStreaming}
				queueCount={queueCount}
				otherTabs={otherTabs}
				onNewSession={onNewSession}
				onCompact={onCompact}
				onExport={onExport}
				onExportMarkdown={onExportMarkdown}
				onExportJson={onExportJson}
				onOpenHelp={onOpenHelp}
				onEnableNotifications={onEnableNotifications}
				notificationPermission={notificationPermission}
				onStop={onStop}
				stopDisabled={stopDisabled}
			/>
		</>
	);
}
