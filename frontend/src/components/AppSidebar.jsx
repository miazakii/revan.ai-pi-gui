import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "cn";
import {
	CheckIcon,
	ChevronRightIcon,
	CopyIcon,
	FolderPlusIcon,
	GitBranchIcon,
	GripVerticalIcon,
	ListChecksIcon,
	MessageSquareIcon,
	PencilIcon,
	RefreshCwIcon,
	Trash2Icon,
	XIcon,
} from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

const COLLAPSE_KEY = "pi-gui-collapsed-projects";

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
}) {
	const dragging = draggingPath === session.path;
	const selectable = Boolean(session.path) && !session.current;
	const checked = Boolean(selectMode && selected);
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
					!selectMode && "pr-7",
					session.current && "current",
				)}
				title={session.path}
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
					<span className="truncate">
						{session.name || session.preview || "(kosong)"}
					</span>
				</span>
				<span className="s-meta flex w-full items-center gap-1 text-[10.5px] font-normal text-muted-foreground">
					{selectMode ? null : <GripVerticalIcon className="size-3 shrink-0 opacity-40" />}
					<span className="truncate">
						{relativeTime(session.mtime)} · {(session.id ?? "").slice(0, 8)}
					</span>
					{session.parentSession ? (
						<span className="fork shrink-0 text-primary">· fork</span>
					) : null}
				</span>
			</SidebarMenuButton>
			{!session.current && !selectMode ? (
				<SidebarMenuAction
					className="session-delete"
					showOnHover
					aria-label={`Hapus sesi ${session.name || session.preview || session.id}`}
					title="Hapus sesi"
					onClick={(event) => {
						event.stopPropagation();
						onDelete(session);
					}}
				>
					<XIcon />
				</SidebarMenuAction>
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
								{project ? project.name : "tanpa proyek"}
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

	const visibleProjects = projects.filter(
		(project) => !project.dir || !sessionsDir || project.dir === sessionsDir,
	);

	const toggleProject = (key, open) => {
		setCollapsedProjects((previous) => {
			const next = new Set(previous);
			if (open) next.delete(key);
			else next.add(key);
			saveCollapsedProjects(next);
			return next;
		});
	};

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

	if (visibleProjects.length === 0) {
		return (
			<div className="p-2">
				<SidebarMenu className="gap-0.5">
					{sessions.map((session) => (
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
						/>
					))}
				</SidebarMenu>
			</div>
		);
	}

	const byProject = new Map(visibleProjects.map((project) => [project.id, []]));
	const loose = [];
	for (const session of sessions) {
		const projectId = assignments[session.path];
		if (projectId && byProject.has(projectId)) byProject.get(projectId).push(session);
		else loose.push(session);
	}

	return (
		<div className="flex flex-col gap-1 p-2">
			{visibleProjects.map((project) => (
				<ProjectGroup
					key={project.id}
					project={project}
					sessions={byProject.get(project.id) ?? []}
					collapsed={collapsedProjects.has(project.id)}
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
				/>
			))}
			<ProjectGroup
				project={null}
				sessions={loose}
				collapsed={collapsedProjects.has("__none__")}
				onToggle={toggleProject}
				onAssign={callbacks.assignSession}
				draggingPath={draggingPath}
				setDraggingPath={setDraggingPath}
				onSwitch={callbacks.switchSession}
				onDeleteSession={callbacks.deleteSession}
				selectMode={selectMode}
				selectedPaths={selectedPaths}
				onToggleSelect={onToggleSelect}
			/>
		</div>
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
						<GitBranchIcon className="mt-0.5 size-3 shrink-0 text-primary/70" />
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
						<div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-lg font-bold text-primary-foreground shadow-sm">
							π
						</div>
						<div className="min-w-0 flex-1">
							<div className="truncate text-sm font-semibold">pi gui</div>
							<div className="truncate text-[11px] text-muted-foreground">
								sesi & workspace
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
							sesi
						</TabsTrigger>
						<TabsTrigger className="side-tab" data-tab="tree" value="tree">
							<GitBranchIcon className="size-3.5" />
							tree
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
									{allSelected ? "kosongkan" : "pilih semua"}
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
									hapus ({selectedPaths.size})
								</Button>
								<Button
									id="side-select-cancel"
									variant="ghost"
									size="sm"
									className="text-xs"
									onClick={exitSelectMode}
								>
									batal
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
								+ proyek
							</Button>
							<div
								className={cn(
									"grid gap-1",
									sideTab === "sessions" ? "grid-cols-4" : "grid-cols-3",
								)}
							>
								<Button
									id="side-clone"
									variant="ghost"
									size="sm"
									className="gap-1.5 px-1 text-xs"
									onClick={onClone}
								>
									<CopyIcon className="size-3.5" />
									clone
								</Button>
								<Button
									id="side-rename"
									variant="ghost"
									size="sm"
									className="gap-1.5 px-1 text-xs"
									onClick={onRenameSession}
								>
									<PencilIcon className="size-3.5" />
									rename
								</Button>
								<Button
									id="side-refresh"
									variant="ghost"
									size="sm"
									className="gap-1.5 px-1 text-xs"
									onClick={onRefresh}
								>
									<RefreshCwIcon className="size-3.5" />
									muat
								</Button>
								{sideTab === "sessions" ? (
									<Button
										id="side-select"
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
										pilih
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
