import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "cn";
import {
	ArrowDownWideNarrowIcon,
	CheckIcon,
	ChevronRightIcon,
	CopyIcon,
	FolderPlusIcon,
	GitBranchIcon,
	GripVerticalIcon,
	ListChecksIcon,
	MessageSquareIcon,
	MoreHorizontalIcon,
	PencilIcon,
	PinIcon,
	PinOffIcon,
	RefreshCwIcon,
	SearchIcon,
	Trash2Icon,
	XIcon,
} from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
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
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuAction,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuSkeleton,
	useSidebar,
} from "@/components/ui/sidebar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { contentText, relativeTime } from "../utils/format.js";
import Logo from "./Logo.jsx";

const COLLAPSE_KEY = "pi-gui-collapsed-projects";
const PINS_KEY = "pi-gui-pins";

function loadPins() {
	try {
		const raw = JSON.parse(localStorage.getItem(PINS_KEY) ?? "[]");
		return new Set(Array.isArray(raw) ? raw.filter((item) => typeof item === "string") : []);
	} catch {
		return new Set();
	}
}

function savePins(pins) {
	try {
		localStorage.setItem(PINS_KEY, JSON.stringify([...pins]));
	} catch {
		/* localStorage diblokir/penuh */
	}
}

function loadCollapsedProjects() {
	try {
		const raw = JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? "[]");
		return new Set(Array.isArray(raw) ? raw.filter((item) => typeof item === "string") : []);
	} catch {
		return new Set();
	}
}

function saveCollapsedProjects(collapsed) {
	try {
		localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...collapsed]));
	} catch {
		/* localStorage diblokir/penuh */
	}
}

function LoadingRows() {
	return (
		<div className="flex flex-col gap-1 p-2">
			{Array.from({ length: 5 }).map((_, index) => (
				<SidebarMenuSkeleton key={index} showIcon />
			))}
		</div>
	);
}

function SidebarEmpty({ title, description }) {
	return (
		<Empty className="border-0 p-4">
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<MessageSquareIcon />
				</EmptyMedia>
				<EmptyTitle className="text-sm">{title}</EmptyTitle>
				<EmptyDescription className="text-xs">{description}</EmptyDescription>
			</EmptyHeader>
		</Empty>
	);
}

function SessionRow({
	session,
	onSwitch,
	onDelete,
	draggingPath,
	setDraggingPath,
	selectMode,
	selected,
	onToggleSelect,
	projects = [],
	projectId = null,
	onAssign,
	onCopyPath,
	onRename,
	pinned = false,
	onTogglePin,
}) {
	const dragging = draggingPath === session.path;
	const selectable = Boolean(session.path) && !session.current;
	const checked = Boolean(selectMode && selected);
	const label = session.name || session.preview || session.id || "sesi";
	return (
		<SidebarMenuItem
			className={cn(
				"session-row",
				dragging && "dragging",
				selectMode && "selecting",
				checked && "selected",
			)}
			data-path={session.path ?? ""}
			draggable={Boolean(session.path) && !selectMode}
			onDragStart={(event) => {
				if (!session.path) return;
				setDraggingPath(session.path);
				event.dataTransfer.effectAllowed = "move";
				event.dataTransfer.setData("text/plain", session.path);
			}}
			onDragEnd={() => setDraggingPath(null)}
		>
			<SidebarMenuButton
				isActive={Boolean(session.current)}
				className={cn(
					"session-item h-auto flex-col items-start gap-0.5 py-1.5",
					!selectMode && "pr-14",
					session.current && "current",
				)}
				title={`${session.path ?? ""}${session.model ? `\nmodel: ${session.model}` : ""}`}
				disabled={selectMode && !selectable}
				onClick={() => {
					if (!selectMode) return onSwitch(session);
					if (selectable) onToggleSelect(session);
				}}
			>
				<span className="s-preview flex w-full min-w-0 items-center gap-1.5 text-[13px] font-medium">
					{selectMode ? (
						<span
							className={cn(
								"s-check flex size-3.5 shrink-0 items-center justify-center rounded-[4px] border border-muted-foreground/50 transition-colors",
								checked && "border-primary bg-primary text-primary-foreground",
								!selectable && "opacity-40",
							)}
							aria-hidden="true"
						>
							{checked ? <CheckIcon className="size-2.5" strokeWidth={3} /> : null}
						</span>
					) : null}
					{pinned ? <PinIcon className="size-2.5 shrink-0 text-primary" aria-label="disematkan" /> : null}
					<span className="truncate">
						{session.name || session.preview || "(kosong)"}
					</span>
				</span>
				<span className="s-meta flex w-full items-center gap-1 text-[10.5px] font-normal text-muted-foreground">
					{selectMode ? null : <GripVerticalIcon className="size-3 shrink-0 opacity-40" />}
					<span className="truncate">
						{relativeTime(session.mtime)}
						{session.current ? " · aktif" : ""}
						{session.messageCount
							? ` · ${session.messageCount}${session.messageCountPartial ? "+" : ""} pesan`
							: ""}
					</span>
					{session.parentSession ? (
						<span className="fork shrink-0 text-rose-700 dark:text-primary">· fork</span>
					) : null}
				</span>
			</SidebarMenuButton>
			{!selectMode && session.path ? (
				<>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<SidebarMenuAction
								className={cn("session-menu", !session.current ? "right-7" : "right-1")}
								showOnHover
								aria-label={`Aksi sesi ${label}`}
								title="Aksi sesi"
								onClick={(event) => event.stopPropagation()}
							>
								<MoreHorizontalIcon />
							</SidebarMenuAction>
						</DropdownMenuTrigger>
						<DropdownMenuContent side="right" align="start" className="w-56">
							<DropdownMenuLabel className="truncate">{label}</DropdownMenuLabel>
							<DropdownMenuLabel className="text-[10px] font-normal text-muted-foreground">
								Pindah ke Proyek
							</DropdownMenuLabel>
							<DropdownMenuItem
								disabled={!projectId}
								onSelect={() => onAssign?.(session.path, null)}
							>
								Tanpa Proyek
							</DropdownMenuItem>
							{projects.map((project) => (
								<DropdownMenuItem
									key={project.id}
									onSelect={() => onAssign?.(session.path, project.id)}
								>
									<span className="min-w-0 flex-1 truncate">{project.name}</span>
									{projectId === project.id ? <CheckIcon className="size-3.5" /> : null}
								</DropdownMenuItem>
							))}
							<DropdownMenuSeparator />
							<DropdownMenuItem onSelect={() => onRename?.(session)}>
								<PencilIcon className="size-3.5" /> Ganti Nama
							</DropdownMenuItem>
							<DropdownMenuItem onSelect={() => onTogglePin?.(session)}>
								{pinned ? (
									<PinOffIcon className="size-3.5" />
								) : (
									<PinIcon className="size-3.5" />
								)}
								{pinned ? "Lepas Pin" : "Pin Sesi"}
							</DropdownMenuItem>
							<DropdownMenuItem onSelect={() => onCopyPath?.(session.path)}>
								<CopyIcon className="size-3.5" /> Salin Path
							</DropdownMenuItem>
							{!session.current ? (
								<DropdownMenuItem
									className="text-destructive focus:text-destructive"
									onSelect={() => onDelete(session)}
								>
									<Trash2Icon className="size-3.5" /> Hapus Sesi
								</DropdownMenuItem>
							) : null}
						</DropdownMenuContent>
					</DropdownMenu>
					{!session.current ? (
						<SidebarMenuAction
							className="session-delete"
							showOnHover
							aria-label={`Hapus sesi ${label}`}
							title="Hapus sesi"
							onClick={(event) => {
								event.stopPropagation();
								onDelete(session);
							}}
						>
							<XIcon />
						</SidebarMenuAction>
					) : null}
				</>
			) : null}
		</SidebarMenuItem>
	);
}

function ProjectGroup({
	project,
	sessions,
	collapsed,
	onToggle,
	onRename,
	onDelete,
	onAssign,
	draggingPath,
	setDraggingPath,
	onSwitch,
	onDeleteSession,
	selectMode,
	selectedPaths,
	onToggleSelect,
	projects = [],
	assignments = {},
	onCopyPath,
	pins = new Set(),
	onTogglePin,
	onRenameSession,
}) {
	const key = project?.id ?? "__none__";
	const [dropTarget, setDropTarget] = useState(false);
	const projectId = project?.id ?? null;

	const dropSessionPath = (event) =>
		draggingPath || event.dataTransfer?.getData("text/plain") || "";

	return (
		<div
			className={cn(
				"project rounded-lg border border-transparent p-0.5 transition-colors",
				!project && "loose",
				dropTarget && "drop-target",
			)}
			data-project-key={key}
			onDragOver={(event) => {
				if (!dropSessionPath(event)) return;
				event.preventDefault();
				event.dataTransfer.dropEffect = "move";
				setDropTarget(true);
			}}
			onDragLeave={(event) => {
				if (event.currentTarget.contains(event.relatedTarget)) return;
				setDropTarget(false);
			}}
			onDrop={(event) => {
				const sessionPath = dropSessionPath(event);
				if (!sessionPath) return;
				event.preventDefault();
				setDropTarget(false);
				setDraggingPath(null);
				onAssign(sessionPath, projectId);
			}}
		>
			<Collapsible
				open={!collapsed}
				onOpenChange={(open) => onToggle(key, open)}
			>
				<div className="flex items-center gap-1 px-1 py-0.5">
					<CollapsibleTrigger asChild>
						<button
							className="project-toggle flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-sidebar-accent"
							aria-expanded={!collapsed}
							aria-controls={`project-body-${key}`}
							title={
								project
									? `${project.name} — tarik sesi ke sini untuk memindahkan`
									: "Sesi yang belum masuk proyek (tarik ke sini untuk melepas)"
							}
						>
							<ChevronRightIcon
								className={cn(
									"size-3.5 shrink-0 text-muted-foreground transition-transform",
									!collapsed && "rotate-90",
								)}
							/>
							<span
								className={cn(
									"project-name min-w-0 flex-1 truncate text-[10.5px] font-semibold tracking-wider text-muted-foreground uppercase",
									!project && "font-normal tracking-normal normal-case italic",
								)}
							>
								{project ? project.name : "Tanpa Proyek"}
							</span>
							<Badge
								variant="secondary"
								className="project-count h-4 shrink-0 px-1 text-[9px]"
							>
								{sessions.length}
							</Badge>
						</button>
					</CollapsibleTrigger>
					{project ? (
						<div className="flex shrink-0 items-center gap-0.5">
							<Button
								className="project-action size-6"
								variant="ghost"
								size="icon-xs"
								title="Ganti nama proyek"
								aria-label={`Ganti nama proyek ${project.name}`}
								onClick={(event) => {
									event.stopPropagation();
									onRename(project);
								}}
							>
								<PencilIcon className="size-3" />
							</Button>
							<Button
								className="project-action danger size-6 text-muted-foreground hover:text-destructive"
								variant="ghost"
								size="icon-xs"
								title="Hapus proyek (sesi tidak dihapus)"
								aria-label={`Hapus proyek ${project.name}`}
								onClick={(event) => {
									event.stopPropagation();
									onDelete(project);
								}}
							>
								<Trash2Icon className="size-3" />
							</Button>
						</div>
					) : null}
				</div>
				<CollapsibleContent>
					<SidebarMenu
						id={`project-body-${key}`}
						role="group"
						className="project-body mt-0.5 gap-0.5 pl-1"
					>
						{sessions.map((session) => (
							<SessionRow
								key={session.path ?? session.id}
								session={session}
								onSwitch={onSwitch}
								onDelete={onDeleteSession}
								draggingPath={draggingPath}
								setDraggingPath={setDraggingPath}
								selectMode={selectMode}
								selected={selectedPaths?.has(session.path)}
								onToggleSelect={onToggleSelect}
								projects={projects}
								projectId={assignments[session.path] ?? null}
								onAssign={onAssign}
								onCopyPath={onCopyPath}
								onRename={onRenameSession}
								pinned={pins.has(session.path)}
								onTogglePin={onTogglePin}
							/>
						))}
						{sessions.length === 0 ? (
							<li className="project-empty px-2 py-1.5 text-[11px] italic text-muted-foreground">
								tarik sesi ke sini
							</li>
						) : null}
					</SidebarMenu>
				</CollapsibleContent>
			</Collapsible>
		</div>
	);
}

function SessionsView({
	sessions,
	projects,
	assignments,
	sessionsDir,
	callbacks,
	draggingPath,
	setDraggingPath,
	selectMode,
	selectedPaths,
	onToggleSelect,
}) {
	const [collapsedProjects, setCollapsedProjects] = useState(loadCollapsedProjects);
	const [pins, setPins] = useState(loadPins);
	const [query, setQuery] = useState("");
	const [sortMode, setSortMode] = useState("recent");
	const needle = query.trim().toLowerCase();

	const matches = (session) => {
		if (!needle) return true;
		return [session.name, session.preview, session.id, session.path]
			.filter(Boolean)
			.some((value) => String(value).toLowerCase().includes(needle));
	};
	const filteredSessions = (needle ? sessions.filter(matches) : sessions).slice();
	filteredSessions.sort((a, b) => {
		const aPinned = pins.has(a.path);
		const bPinned = pins.has(b.path);
		if (aPinned !== bPinned) return aPinned ? -1 : 1;
		if (sortMode === "name") {
			const left = a.name || a.preview || a.id || "";
			const right = b.name || b.preview || b.id || "";
			return left.localeCompare(right, "id", { sensitivity: "base" });
		}
		return (b.mtime ?? 0) - (a.mtime ?? 0);
	});

	const visibleProjects = projects.filter(
		(project) => !project.dir || !sessionsDir || project.dir === sessionsDir,
	);

	const togglePin = (session) => {
		if (!session.path) return;
		setPins((previous) => {
			const next = new Set(previous);
			if (next.has(session.path)) next.delete(session.path);
			else next.add(session.path);
			savePins(next);
			return next;
		});
	};

	const toggleProject = (key, open) => {
		setCollapsedProjects((previous) => {
			const next = new Set(previous);
			if (open) next.delete(key);
			else next.add(key);
			saveCollapsedProjects(next);
			return next;
		});
	};

	const searchBox = sessions.length > 0 ? (
		<div className="sticky top-0 z-10 bg-sidebar/95 px-2 pt-2 pb-1 backdrop-blur">
			<div className="relative">
				<SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
				<Input
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					placeholder="Cari sesi…"
					aria-label="Cari sesi"
					className="h-8 pr-8 pl-8 text-xs"
				/>
				{query ? (
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						className="absolute top-1/2 right-1 -translate-y-1/2"
						title="Bersihkan pencarian"
						aria-label="Bersihkan pencarian"
						onClick={() => setQuery("")}
					>
						<XIcon />
					</Button>
				) : null}
			</div>
			<div className="flex items-center justify-between gap-2 px-1 pt-1">
				<p className="text-[10.5px] text-muted-foreground">
					{filteredSessions.length} sesi{needle ? " cocok" : ""}
				</p>
				<Button
					type="button"
					variant="ghost"
					size="xs"
					className="h-5 gap-1 px-1 text-[10.5px] text-muted-foreground"
					title={
						sortMode === "recent"
							? "Urutkan berdasarkan nama"
							: "Urutkan berdasarkan terbaru"
					}
					onClick={() =>
						setSortMode((mode) => (mode === "recent" ? "name" : "recent"))
					}
				>
					<ArrowDownWideNarrowIcon className="size-3" />
					{sortMode === "recent" ? "Terbaru" : "Nama"}
				</Button>
			</div>
		</div>
	) : null;

	if (sessions.length === 0 && visibleProjects.length === 0) {
		return (
			<SidebarEmpty
				title={sessionsDir ? "Belum ada sesi" : "Sesi tidak persisten"}
				description={
					sessionsDir
						? "Mulai percakapan untuk membuat sesi di workspace ini."
						: "Workspace ini tidak menyimpan riwayat sesi."
				}
			/>
		);
	}

	if (needle && filteredSessions.length === 0) {
		return (
			<>
				{searchBox}
				<SidebarEmpty
					title="Tidak ada sesi cocok"
					description={`Tidak ada sesi yang mengandung “${query.trim()}”.`}
				/>
			</>
		);
	}

	const byProject = new Map(visibleProjects.map((project) => [project.id, []]));
	const loose = [];
	for (const session of filteredSessions) {
		const projectId = assignments[session.path];
		if (projectId && byProject.has(projectId)) byProject.get(projectId).push(session);
		else loose.push(session);
	}
	const shownProjects = needle
		? visibleProjects.filter((project) => (byProject.get(project.id) ?? []).length > 0)
		: visibleProjects;

	if (visibleProjects.length === 0) {
		return (
			<>
				{searchBox}
				<div className="p-2 pt-1">
					<SidebarMenu className="gap-0.5">
						{filteredSessions.map((session) => (
							<SessionRow
								key={session.path ?? session.id}
								session={session}
								onSwitch={callbacks.switchSession}
								onDelete={callbacks.deleteSession}
								draggingPath={draggingPath}
								setDraggingPath={setDraggingPath}
								selectMode={selectMode}
								selected={selectedPaths?.has(session.path)}
								onToggleSelect={onToggleSelect}
								projects={visibleProjects}
								projectId={assignments[session.path] ?? null}
								onAssign={callbacks.assignSession}
								onCopyPath={callbacks.copyPath}
								onRename={callbacks.renameSession}
								pinned={pins.has(session.path)}
								onTogglePin={togglePin}
							/>
						))}
					</SidebarMenu>
				</div>
			</>
		);
	}

	return (
		<>
			{searchBox}
			<div className="flex flex-col gap-1 p-2 pt-1">
				{shownProjects.map((project) => (
					<ProjectGroup
						key={project.id}
						project={project}
						sessions={byProject.get(project.id) ?? []}
						collapsed={needle ? false : collapsedProjects.has(project.id)}
						onToggle={toggleProject}
						onRename={callbacks.renameProject}
						onDelete={callbacks.deleteProject}
						onAssign={callbacks.assignSession}
						draggingPath={draggingPath}
						setDraggingPath={setDraggingPath}
						onSwitch={callbacks.switchSession}
						onDeleteSession={callbacks.deleteSession}
						selectMode={selectMode}
						selectedPaths={selectedPaths}
						onToggleSelect={onToggleSelect}
						projects={visibleProjects}
						assignments={assignments}
						onCopyPath={callbacks.copyPath}
						pins={pins}
						onTogglePin={togglePin}
						onRenameSession={callbacks.renameSession}
					/>
				))}
				{loose.length > 0 || !needle ? (
					<ProjectGroup
						project={null}
						sessions={loose}
						collapsed={needle ? false : collapsedProjects.has("__none__")}
						onToggle={toggleProject}
						onAssign={callbacks.assignSession}
						draggingPath={draggingPath}
						setDraggingPath={setDraggingPath}
						onSwitch={callbacks.switchSession}
						onDeleteSession={callbacks.deleteSession}
						selectMode={selectMode}
						selectedPaths={selectedPaths}
						onToggleSelect={onToggleSelect}
						projects={visibleProjects}
						assignments={assignments}
						onCopyPath={callbacks.copyPath}
						pins={pins}
						onTogglePin={togglePin}
						onRenameSession={callbacks.renameSession}
					/>
				) : null}
			</div>
		</>
	);
}

function flattenTree(nodes, depth = 0, out = []) {
	for (const node of nodes ?? []) {
		out.push({ node, depth });
		flattenTree(node.children ?? [], depth + 1, out);
	}
	return out;
}

function treeRowData(node, depth, activeIds) {
	const entry = node.entry;
	if (["usage", "label", "session_info", "context_edit"].includes(entry.type)) return null;

	let role = "";
	let text = "";
	let forkable = false;

	if (entry.type === "message") {
		const message = entry.message;
		if (message.role === "system") return null;
		if (message.role === "user") {
			role = "user";
			text = contentText(message.content).replace(/\s+/g, " ").slice(0, 160);
			forkable = true;
		} else if (message.role === "assistant") {
			role = "asst";
			const textBlock = (message.content ?? []).find((block) => block.type === "text");
			text = textBlock?.text?.replace(/\s+/g, " ").slice(0, 160) ?? "(tool call)";
		} else if (message.role === "toolResult") {
			role = "tool";
			text = message.toolName;
		} else {
			role = message.role.slice(0, 5);
			text = contentText(message.content).replace(/\s+/g, " ").slice(0, 120);
		}
	} else if (entry.type === "compaction") {
		role = "sum";
		text = `compaction · ${entry.summary.replace(/\s+/g, " ").slice(0, 100)}`;
	} else if (entry.type === "branch_summary") {
		role = "sum";
		text = "branch summary";
	} else if (entry.type === "model_change") {
		role = "model";
		text = `${entry.provider}/${entry.modelId}`;
	} else if (entry.type === "thinking_level_change") {
		role = "think";
		text = entry.thinkingLevel;
	} else if (entry.type === "custom" || entry.type === "custom_message") {
		role = "ext";
		text = entry.customType ?? "custom";
	} else {
		return null;
	}

	return { entry, depth, role, text, forkable, active: activeIds.has(entry.id), label: node.label };
}

function TreeView({ tree, leafId, onFork }) {
	const rows = useMemo(() => {
		const flat = flattenTree(tree ?? []);
		const byId = new Map(flat.map(({ node }) => [node.entry.id, node]));
		const activeIds = new Set();
		const guard = new Set();
		let cursor = leafId;
		while (cursor && byId.has(cursor) && !guard.has(cursor)) {
			guard.add(cursor);
			activeIds.add(cursor);
			cursor = byId.get(cursor).entry.parentId;
		}
		return flat
			.map(({ node, depth }) => treeRowData(node, depth, activeIds))
			.filter(Boolean);
	}, [tree, leafId]);

	if (rows.length === 0) {
		return <SidebarEmpty title="Tree kosong" description="Belum ada pesan untuk ditampilkan." />;
	}

	return (
		<div className="flex flex-col gap-0.5 p-2">
			{rows.map((row) => (
				<button
					key={row.entry.id}
					className={cn(
						"tree-node flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left text-xs transition-colors",
						row.active && "active bg-sidebar-accent",
						row.forkable && "forkable hover:bg-sidebar-accent",
						row.role === "tool" && "muted text-muted-foreground",
					)}
					style={{ paddingLeft: `${8 + row.depth * 12}px` }}
					title={row.forkable ? "Klik untuk fork dari pesan ini" : undefined}
					onClick={row.forkable ? () => onFork(row.entry.id, row.text) : undefined}
				>
					<span className="t-role w-9 shrink-0 font-mono text-[9px] uppercase text-muted-foreground">
						{row.label ? `${row.role}*` : row.role}
					</span>
					<span className="t-text min-w-0 flex-1 truncate">
						{row.text || "(kosong)"}
					</span>
					{row.forkable ? (
						<GitBranchIcon className="mt-0.5 size-3 shrink-0 text-rose-600 dark:text-primary/70" />
					) : null}
				</button>
			))}
		</div>
	);
}

export default function AppSidebar({
	sideTab,
	onSideTab,
	onClose,
	onRefresh,
	onCreateProject,
	onClone,
	onRenameSession,
	sessions,
	projects,
	assignments,
	sessionsDir,
	sidebarLoading,
	sidebarError,
	tree,
	treeLeafId,
	callbacks,
	onDraggingChange,
}) {
	const { isMobile, open, openMobile, setOpen, setOpenMobile } = useSidebar();
	const [draggingPath, setDraggingPath] = useState(null);
	const [selectMode, setSelectMode] = useState(false);
	const [selectedPaths, setSelectedPaths] = useState(() => new Set());
	const refreshRef = useRef(onRefresh);
	refreshRef.current = onRefresh;

	const selectableSessions = useMemo(
		() => (sessions ?? []).filter((session) => session.path && !session.current),
		[sessions],
	);
	const selectablePaths = useMemo(
		() => new Set(selectableSessions.map((session) => session.path)),
		[selectableSessions],
	);
	const allSelected =
		selectableSessions.length > 0 && selectedPaths.size >= selectableSessions.length;

	// Buang pilihan yang sudah tidak ada (sesi terhapus / berganti workspace).
	useEffect(() => {
		setSelectedPaths((previous) => {
			let changed = false;
			const next = new Set();
			for (const path of previous) {
				if (selectablePaths.has(path)) next.add(path);
				else changed = true;
			}
			return changed ? next : previous;
		});
	}, [selectablePaths]);

	const toggleSelect = (session) => {
		if (!session.path || session.current) return;
		setSelectedPaths((previous) => {
			const next = new Set(previous);
			if (next.has(session.path)) next.delete(session.path);
			else next.add(session.path);
			return next;
		});
	};

	const toggleSelectAll = () => {
		setSelectedPaths(allSelected ? new Set() : new Set(selectablePaths));
	};

	const exitSelectMode = () => {
		setSelectMode(false);
		setSelectedPaths(new Set());
	};

	const deleteSelected = async () => {
		const chosen = selectableSessions.filter((session) => selectedPaths.has(session.path));
		if (chosen.length === 0) return;
		const deleted = await callbacks.deleteSessions?.(chosen);
		if (deleted) exitSelectMode();
	};

	useEffect(() => {
		onDraggingChange?.(Boolean(draggingPath));
	}, [draggingPath, onDraggingChange]);

	useEffect(() => {
		if (isMobile ? openMobile : open) refreshRef.current?.();
	}, [isMobile, openMobile, open]);

	const sessionCallbacks = {
		...callbacks,
		switchSession: (session) => {
			callbacks.switchSession(session);
			if (isMobile) setOpenMobile(false);
		},
		forkFrom: (entryId, text) => {
			callbacks.forkFrom(entryId, text);
			if (isMobile) setOpenMobile(false);
		},
	};

	const content = sidebarLoading ? (
		<LoadingRows />
	) : sidebarError ? (
		<Alert variant="destructive" className="mx-2 my-2">
			<AlertDescription>{sidebarError}</AlertDescription>
		</Alert>
	) : sideTab === "sessions" ? (
		<SessionsView
			sessions={sessions}
			projects={projects}
			assignments={assignments}
			sessionsDir={sessionsDir}
			callbacks={sessionCallbacks}
			draggingPath={draggingPath}
			setDraggingPath={setDraggingPath}
			selectMode={selectMode}
			selectedPaths={selectedPaths}
			onToggleSelect={toggleSelect}
		/>
	) : (
		<TreeView tree={tree} leafId={treeLeafId} onFork={sessionCallbacks.forkFrom} />
	);

	return (
		<Sidebar id="sidebar" collapsible="offcanvas" className="border-r border-sidebar-border">
			<Tabs
				value={sideTab}
				onValueChange={onSideTab}
				className="flex min-h-0 flex-1 flex-col"
			>
				<SidebarHeader className="gap-2 border-b border-sidebar-border px-3 py-3">
					<div className="flex items-center gap-2">
						<div className="flex min-w-0 flex-1 flex-col gap-1.5">
							<Logo className="h-[18px] w-[122px] text-foreground" />
							<div className="truncate text-[11px] text-muted-foreground">
								pi gui · sesi & workspace
							</div>
						</div>
						<Button
							id="sidebar-close"
							variant="ghost"
							size="icon-sm"
							aria-label="Tutup sidebar"
							onClick={() => {
								if (isMobile) setOpenMobile(false);
								else setOpen(false);
								onClose?.();
							}}
						>
							<XIcon />
						</Button>
					</div>
					<TabsList className="grid w-full grid-cols-2">
						<TabsTrigger className="side-tab" data-tab="sessions" value="sessions">
							<MessageSquareIcon className="size-3.5" />
							Sesi
						</TabsTrigger>
						<TabsTrigger className="side-tab" data-tab="tree" value="tree">
							<GitBranchIcon className="size-3.5" />
							Tree
						</TabsTrigger>
					</TabsList>
				</SidebarHeader>

				<TabsContent
					value="sessions"
					className="mt-0 flex min-h-0 flex-1 flex-col"
				>
					<SidebarContent id="side-body">{content}</SidebarContent>
				</TabsContent>
				<TabsContent value="tree" className="mt-0 flex min-h-0 flex-1 flex-col">
					<SidebarContent id="side-body-tree">{content}</SidebarContent>
				</TabsContent>

				<SidebarFooter className="border-t border-sidebar-border">
					{sideTab === "sessions" && selectMode ? (
						<div id="side-selection" className="flex flex-col gap-2">
							<div className="flex items-center justify-between gap-2 px-1 text-xs">
								<span id="side-selected-count" className="font-medium">
									{selectedPaths.size} dipilih
								</span>
								<Button
									id="side-select-all"
									variant="ghost"
									size="xs"
									className="h-6 px-1.5 text-[11px]"
									disabled={selectableSessions.length === 0}
									onClick={toggleSelectAll}
								>
									{allSelected ? "Kosongkan" : "Pilih Semua"}
								</Button>
							</div>
							<div className="grid grid-cols-2 gap-1">
								<Button
									id="side-delete-selected"
									variant="destructive"
									size="sm"
									className="gap-1.5 text-xs"
									disabled={selectedPaths.size === 0}
									onClick={deleteSelected}
								>
									<Trash2Icon className="size-3.5" />
									Hapus ({selectedPaths.size})
								</Button>
								<Button
									id="side-select-cancel"
									variant="ghost"
									size="sm"
									className="text-xs"
									onClick={exitSelectMode}
								>
									Batal
								</Button>
							</div>
						</div>
					) : (
						<>
							<Button
								id="side-new-project"
								variant="outline"
								size="sm"
								className="w-full justify-start gap-2"
								onClick={onCreateProject}
							>
								<FolderPlusIcon className="size-4" />
								+ Proyek
							</Button>
							<div
								className={cn(
									"grid gap-1",
									sideTab === "sessions" ? "grid-cols-4" : "grid-cols-3",
								)}
							>
								<Button
									id="side-clone"
								title="Duplikat sesi aktif"
									variant="ghost"
									size="sm"
									className="gap-1.5 px-1 text-xs"
									onClick={onClone}
								>
									<CopyIcon className="size-3.5" />
									Clone
								</Button>
								<Button
									id="side-rename"
								title="Ganti nama sesi aktif"
									variant="ghost"
									size="sm"
									className="gap-1.5 px-1 text-xs"
									onClick={() => onRenameSession?.()}
								>
									<PencilIcon className="size-3.5" />
									Rename
								</Button>
								<Button
									id="side-refresh"
								title="Muat ulang daftar sesi"
									variant="ghost"
									size="sm"
									className="gap-1.5 px-1 text-xs"
									onClick={onRefresh}
								>
									<RefreshCwIcon className="size-3.5" />
									Muat
								</Button>
								{sideTab === "sessions" ? (
									<Button
										id="side-select"
								title="Pilih beberapa sesi untuk dihapus"
										variant="ghost"
										size="sm"
										className="gap-1.5 px-1 text-xs"
										disabled={selectableSessions.length === 0}
										onClick={() => {
											setSelectedPaths(new Set());
											setSelectMode(true);
										}}
									>
										<ListChecksIcon className="size-3.5" />
										Pilih
									</Button>
								) : null}
							</div>
						</>
					)}
				</SidebarFooter>
			</Tabs>
		</Sidebar>
	);
}
