import { useCallback, useEffect, useRef, useState } from "react";
import { toast as notify } from "sonner";

import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import AppSidebar from "./components/AppSidebar.jsx";
import Composer from "./components/Composer.jsx";
import DialogHost from "./components/Modal.jsx";
import TopBar from "./components/TopBar.jsx";
import Transcript from "./components/Transcript.jsx";
import { api, apiGet, headers, postJson, token } from "./api/client.js";
import { contentText, fmtNum, truncate } from "./utils/format.js";

let noteSeq = 0;

function makeNote(text) {
	return { role: "__note", id: `note-${++noteSeq}`, text };
}

function buildToolResults(messages) {
	const results = {};
	for (const message of messages) {
		if (message.role === "assistant") {
			for (const block of message.content ?? []) {
				if (block.type === "toolCall" && block.id) {
					results[block.id] ??= {
						output: "",
						isError: false,
						details: null,
						status: "…",
					};
				}
			}
		} else if (message.role === "toolResult" && message.toolCallId) {
			results[message.toolCallId] = {
				output: contentText(message.content),
				isError: Boolean(message.isError),
				details: message.details,
				status: message.isError ? "gagal" : "selesai",
			};
		}
	}
	return results;
}

function App() {
	const [messages, setMessages] = useState([]);
	const [live, setLiveState] = useState(null);
	const [toolResults, setToolResults] = useState({});
	const [notice, setNotice] = useState("");

	const [isStreaming, setIsStreamingState] = useState(false);
	const [queue, setQueue] = useState({ steering: [], followUp: [], unknown: 0 });
	const [baseStatus, setBaseStatus] = useState("menyambung…");
	const [extStatus, setExtStatus] = useState({});
	const [extWidgetLines, setExtWidgetLines] = useState([]);
	const [stats, setStats] = useState("");

	const [cwd, setCwd] = useState("");
	const [models, setModels] = useState([]);
	const [thinkingLevels, setThinkingLevels] = useState([]);
	const [modelValue, setModelValue] = useState("");
	const [thinkingValue, setThinkingValue] = useState("");

	const [banner, setBanner] = useState(null);
	const [modal, setModal] = useState(null);
	const [sidebarOpen, setSidebarOpen] = useState(false);

	const [input, setInput] = useState("");
	const [attachments, setAttachments] = useState([]);
	const [behavior, setBehavior] = useState("followUp");
	const [commands, setCommands] = useState([]);
	const [slashItems, setSlashItems] = useState([]);
	const [slashIndex, setSlashIndex] = useState(0);
	const [abortBusy, setAbortBusy] = useState(false);

	const [sideTab, setSideTabState] = useState("sessions");
	const [sidebarLoading, setSidebarLoading] = useState(false);
	const [sidebarError, setSidebarError] = useState("");
	const [sessions, setSessions] = useState([]);
	const [projects, setProjects] = useState([]);
	const [assignments, setAssignments] = useState({});
	const [sessionsDir, setSessionsDir] = useState(null);
	const [tree, setTree] = useState([]);
	const [treeLeafId, setTreeLeafId] = useState(null);

	const inputRef = useRef(null);
	const liveRef = useRef(null);
	const liveTimerRef = useRef(null);
	const isStreamingRef = useRef(false);
	const pendingCountRef = useRef(0);
	const needsHistoryResyncRef = useRef(false);
	const historyRequestRef = useRef(0);
	const sidebarRequestRef = useRef(0);
	const sidebarTimerRef = useRef(null);
	const sidebarDraggingRef = useRef(false);
	const sideTabRef = useRef("sessions");
	const modelRef = useRef(null);
	const thinkingRef = useRef(null);
	const consumingUiRequestsRef = useRef(new Set());
	const modalResolveRef = useRef(null);
	const modalKeyRef = useRef(0);
	const handlersRef = useRef({});
	const stopInFlightRef = useRef(false);
	const lastSlashQueryRef = useRef(null);
	const behaviorRef = useRef("followUp");
	const projectsRef = useRef([]);
	const assignmentsRef = useRef({});
	const projectMutationRef = useRef(0);

	const toast = useCallback((message, type = "info") => {
		if (!message) return;
		const text = String(message);
		if (type === "error") notify.error(text);
		else if (type === "warning") notify.warning(text);
		else notify(text);
	}, []);

	const setStreaming = (value) => {
		isStreamingRef.current = Boolean(value);
		setIsStreamingState(Boolean(value));
	};

	const setSidebarOpenState = (value) => {
		setSidebarOpen(Boolean(value));
	};

	const setBehaviorState = (value) => {
		behaviorRef.current = value;
		setBehavior(value);
	};

	const statusText = [baseStatus, ...Object.values(extStatus)].filter(Boolean).join(" · ");

	const showBanner = useCallback((message, actionLabel, handler) => {
		setBanner({ message, actionLabel, handler });
	}, []);

	const hideBanner = useCallback(() => setBanner(null), []);

	const closeModal = useCallback((value) => {
		setModal(null);
		const resolve = modalResolveRef.current;
		modalResolveRef.current = null;
		resolve?.(value);
	}, []);

	const openModal = useCallback((config) => {
		if (modalResolveRef.current) {
			const previous = modalResolveRef.current;
			modalResolveRef.current = null;
			previous(undefined);
		}
		return new Promise((resolve) => {
			modalResolveRef.current = resolve;
			modalKeyRef.current += 1;
			setModal({ ...config, id: modalKeyRef.current });
		});
	}, []);

	const promptModal = useCallback(
		({ title, value = "", placeholder = "", okLabel = "simpan", label = "Nama" }) =>
			openModal({
				title,
				input: { value, placeholder, multiline: false, label },
				buttons: [
					{
						label: okLabel,
						value: (current) => String(current ?? "").trim(),
						variant: "primary",
					},
					{ label: "batal", value: undefined, variant: "ghost" },
				],
			}),
		[openModal],
	);

	const setStatus = (text) => setBaseStatus(text);

	const setExtStatusValue = (key, text) => {
		setExtStatus((previous) => {
			const next = { ...previous };
			if (text) next[key] = text;
			else delete next[key];
			return next;
		});
	};

	const setExtWidgetValue = (_key, lines) => {
		setExtWidgetLines(Array.isArray(lines) ? lines : []);
	};

	const renderQueue = ({ steering = [], followUp = [], unknown = 0 } = {}) => {
		const pending = steering.length + followUp.length + unknown;
		pendingCountRef.current = pending;
		setQueue({ steering, followUp, unknown });
	};

	const appendMessage = (message) => {
		setMessages((items) => [...items, message]);
	};

	const addNote = (text) => appendMessage(makeNote(text));

	const syncLive = () => {
		const current = liveRef.current;
		if (!current) {
			setLiveState(null);
			return;
		}
		setLiveState({
			thinking: current.thinking,
			blocks: [...current.blocks.entries()]
				.sort(([a], [b]) => a - b)
				.map(([index, block]) => ({ index, text: block.text, final: block.final })),
		});
	};

	const startLiveAssistant = () => {
		if (liveRef.current) return;
		liveRef.current = { thinking: false, blocks: new Map() };
		syncLive();
	};

	const scheduleLiveFlush = ({ final = false } = {}) => {
		const current = liveRef.current;
		if (!current) return;
		if (final) {
			if (liveTimerRef.current) clearTimeout(liveTimerRef.current);
			liveTimerRef.current = null;
			syncLive();
			return;
		}
		if (liveTimerRef.current) return;
		liveTimerRef.current = setTimeout(() => {
			liveTimerRef.current = null;
			syncLive();
		}, 80);
	};

	const stopLive = () => {
		if (liveTimerRef.current) clearTimeout(liveTimerRef.current);
		liveTimerRef.current = null;
		liveRef.current = null;
		setLiveState(null);
	};

	const liveBlock = (index) => {
		startLiveAssistant();
		const current = liveRef.current;
		let block = current.blocks.get(index);
		if (!block) {
			block = { text: "", final: false };
			current.blocks.set(index, block);
		}
		return block;
	};

	const onAssistantEvent = (event) => {
		if (!event) return;
		switch (event.type) {
			case "text_start": {
				const block = liveBlock(event.contentIndex);
				block.text = "";
				block.final = false;
				scheduleLiveFlush();
				break;
			}
			case "text_delta": {
				const block = liveBlock(event.contentIndex);
				block.text += event.delta ?? "";
				block.final = false;
				scheduleLiveFlush();
				break;
			}
			case "text_end": {
				const block = liveBlock(event.contentIndex);
				block.text = event.content ?? block.text;
				block.final = true;
				scheduleLiveFlush({ final: true });
				break;
			}
			case "thinking_start":
			case "thinking_delta":
				startLiveAssistant();
				liveRef.current.thinking = true;
				scheduleLiveFlush({ final: true });
				break;
			case "thinking_end":
			case "toolcall_start":
			case "toolcall_end":
				if (liveRef.current) {
					liveRef.current.thinking = false;
					scheduleLiveFlush({ final: true });
				}
				break;
			default:
				break;
		}
	};

	const updateToolResult = (toolCallId, patch) => {
		if (!toolCallId) return;
		setToolResults((previous) => ({
			...previous,
			[toolCallId]: {
				output: "",
				isError: false,
				details: null,
				status: "…",
				...(previous[toolCallId] ?? {}),
				...patch,
			},
		}));
	};

	const onMessageStart = (message) => {
		if (message.role === "user") appendMessage(message);
		else if (message.role === "assistant") startLiveAssistant();
	};

	const onMessageEnd = (message) => {
		if (message.role === "user") return;
		if (message.role === "assistant") {
			stopLive();
			appendMessage(message);
			return;
		}
		if (message.role === "toolResult") {
			updateToolResult(message.toolCallId, {
				output: contentText(message.content),
				isError: Boolean(message.isError),
				details: message.details,
				status: message.isError ? "gagal" : "selesai",
			});
		}
		appendMessage(message);
	};

	const renderAll = (nextMessages) => {
		stopLive();
		setMessages([...nextMessages]);
		setToolResults(buildToolResults(nextMessages));
	};

	const refreshStats = async () => {
		const response = await api({ type: "get_session_stats" });
		if (!response.success) return;
		const data = response.data;
		const parts = [];
		if (data.contextUsage) {
			parts.push(
				`ctx ${fmtNum(data.contextUsage.tokens)}/${fmtNum(data.contextUsage.contextWindow)} ` +
					`(${Math.round(data.contextUsage.percent ?? 0)}%)`,
			);
		}
		parts.push(`$${(data.cost ?? 0).toFixed(3)}`, `${data.toolCalls ?? 0} tool`);
		setStats(parts.join(" · "));
	};

	const refreshState = async () => {
		const response = await api({ type: "get_state" });
		if (!response.success) {
			toast(response.error ?? "get_state gagal", "error");
			return null;
		}
		const session = response.data;
		setStreaming(session.isStreaming);
		const queued = session.pendingMessageCount ?? 0;
		if (queued !== pendingCountRef.current) renderQueue(queued > 0 ? { unknown: queued } : {});
		pendingCountRef.current = queued;
		modelRef.current = session.model ?? null;
		thinkingRef.current = session.thinkingLevel ?? null;
		if (session.model) setModelValue(`${session.model.provider}/${session.model.id}`);
		if (session.thinkingLevel) setThinkingValue(session.thinkingLevel);
		setStatus(session.isStreaming ? "berjalan" : "siap");
		document.title = session.sessionName ? `${session.sessionName} — pi` : "pi gui";
		return session;
	};

	const refreshModels = async () => {
		const response = await api({ type: "get_available_models" });
		if (!response.success) return;
		const nextModels = response.data.models ?? [];
		setModels(nextModels);
		if (modelRef.current) setModelValue(`${modelRef.current.provider}/${modelRef.current.id}`);
	};

	const refreshThinkingLevels = async () => {
		const response = await api({ type: "get_available_thinking_levels" });
		if (!response.success) return;
		setThinkingLevels(response.data.levels ?? ["off"]);
		if (thinkingRef.current) setThinkingValue(thinkingRef.current);
	};

	const loadHistory = async ({ allowStreaming = false } = {}) => {
		const request = ++historyRequestRef.current;
		const response = await api({ type: "get_messages" });
		if (!response.success || request !== historyRequestRef.current) return;
		if (isStreamingRef.current && !allowStreaming) return;
		renderAll(response.data.messages ?? []);
	};

	const refreshCommands = async () => {
		const response = await api({ type: "get_commands" });
		if (!response.success) return;
		setCommands(response.data.commands ?? []);
	};

	const resetSessionUi = () => {
		stopLive();
		historyRequestRef.current += 1;
		setStreaming(false);
		needsHistoryResyncRef.current = false;
		pendingCountRef.current = 0;
		setMessages([]);
		setToolResults({});
		setQueue({ steering: [], followUp: [], unknown: 0 });
		setExtWidgetLines([]);
		setExtStatus({});
		setStats("");
		setNotice("");
		document.title = "pi gui";
		setStatus("siap");
	};

	const restartAgentFromBanner = () => {
		const next = cwd.trim();
		if (!next) return toast("workspace kosong", "error");
		void restart(next);
	};

	const restart = async (nextCwd) => {
		const { ok, body } = await postJson("/api/restart", { cwd: nextCwd });
		if (!ok) {
			toast(body?.error ?? "gagal pindah workspace", "error");
			return;
		}
		resetSessionUi();
		hideBanner();
		setCwd(body.cwd ?? nextCwd);
		await refreshState();
		await refreshModels();
		await refreshThinkingLevels();
		await loadHistory();
		await refreshStats();
		await refreshSidebar();
	};

	const respondUi = (request, payload) =>
		api({ type: "extension_ui_response", id: request.id, ...payload });

	const handleUiRequest = async (request) => {
		if (!request?.id) return handleUiRequestInner(request);
		if (consumingUiRequestsRef.current.has(request.id)) return;
		consumingUiRequestsRef.current.add(request.id);
		try {
			await handleUiRequestInner(request);
		} finally {
			consumingUiRequestsRef.current.delete(request.id);
		}
	};

	const handleUiRequestInner = async (request) => {
		switch (request.method) {
			case "notify":
				toast(request.message, request.notifyType);
				return;
			case "setStatus":
				setExtStatusValue(request.statusKey, request.statusText);
				return;
			case "setWidget":
				setExtWidgetValue(request.widgetKey, request.widgetLines);
				return;
			case "setTitle":
				if (request.title) document.title = request.title;
				return;
			case "set_editor_text":
				setInputValue(request.text ?? "");
				return;
			case "select": {
				const value = await openModal({
					title: request.title,
					buttons: [
						...(request.options ?? []).map((option) => ({ label: option, value: option })),
						{ label: "batal", value: undefined, variant: "ghost" },
					],
				});
				return respondUi(request, value === undefined ? { cancelled: true } : { value });
			}
			case "confirm": {
				const confirmed = await openModal({
					title: request.title,
					message: request.message ?? "",
					alert: true,
					buttons: [
						{ label: "ya", value: true, variant: "primary" },
						{ label: "tidak", value: false },
					],
				});
				return respondUi(
					request,
					confirmed === undefined ? { cancelled: true } : { confirmed },
				);
			}
			case "input": {
				const value = await openModal({
					title: request.title,
					input: {
						value: "",
						placeholder: request.placeholder ?? "",
						multiline: false,
						label: "Input",
					},
					buttons: [
						{ label: "ok", value: (current) => current, variant: "primary" },
						{ label: "batal", value: undefined },
					],
				});
				return respondUi(request, value === undefined ? { cancelled: true } : { value });
			}
			case "editor": {
				const value = await openModal({
					title: request.title,
					input: {
						value: request.prefill ?? "",
						placeholder: "",
						multiline: true,
						rows: 12,
						label: "Editor",
					},
					buttons: [
						{ label: "ok", value: (current) => current, variant: "primary" },
						{ label: "batal", value: undefined },
					],
				});
				return respondUi(request, value === undefined ? { cancelled: true } : { value });
			}
			default:
				return;
		}
	};

	const scheduleSidebarRefresh = (delay = 400) => {
		if (sidebarTimerRef.current) clearTimeout(sidebarTimerRef.current);
		sidebarTimerRef.current = setTimeout(() => {
			sidebarTimerRef.current = null;
			if (sidebarDraggingRef.current) return scheduleSidebarRefresh(delay);
			void refreshSidebar();
		}, delay);
	};

	const refreshSidebar = async () => {
		if (sidebarDraggingRef.current) return;
		return sideTabRef.current === "tree" ? loadTree() : loadSessions();
	};

	const applyProjectData = (data) => {
		const nextProjects = Array.isArray(data?.projects) ? data.projects : [];
		const nextAssignments =
			data?.assignments && typeof data.assignments === "object" ? data.assignments : {};
		projectsRef.current = nextProjects;
		assignmentsRef.current = nextAssignments;
		setProjects(nextProjects);
		setAssignments(nextAssignments);
	};

	const loadSessions = async () => {
		const request = ++sidebarRequestRef.current;
		const projectMutationAtStart = projectMutationRef.current;
		setSidebarLoading(true);
		setSidebarError("");
		const [data, projectData] = await Promise.all([
			apiGet("/api/sessions"),
			apiGet("/api/projects"),
		]);
		if (request !== sidebarRequestRef.current) return;
		setSidebarLoading(false);

		if (data.error) {
			setSidebarError(data.error);
			return;
		}

		if (projectMutationAtStart === projectMutationRef.current) {
			applyProjectData(projectData);
		}
		const nextDir = data.dir ?? sessionsDir;
		setSessionsDir(nextDir);

		const nextSessions = [...(data.sessions ?? [])];
		if (data.sessionFile && !nextSessions.some((session) => session.current)) {
			nextSessions.unshift({
				path: data.sessionFile,
				id: "baru",
				name: data.sessionName ?? null,
				preview: "(sesi aktif, belum tersimpan)",
				mtime: Date.now(),
				current: true,
			});
		}
		setSessions(nextSessions);
	};

	const loadTree = async () => {
		const request = ++sidebarRequestRef.current;
		setSidebarLoading(true);
		setSidebarError("");
		const response = await api({ type: "get_tree" });
		if (request !== sidebarRequestRef.current) return;
		setSidebarLoading(false);
		if (!response.success) {
			setSidebarError(response.error ?? "get_tree gagal");
			return;
		}
		setTree(response.data.tree ?? []);
		setTreeLeafId(response.data.leafId ?? null);
	};

	const changeSideTab = (tab) => {
		sideTabRef.current = tab;
		setSideTabState(tab);
		void refreshSidebar();
	};

	const handleSidebarOpenChange = (open) => {
		setSidebarOpenState(open);
		if (open) scheduleSidebarRefresh(0);
	};

	const projectRequest = async (body) => {
		const { ok, body: data } = await postJson("/api/projects", body);
		if (!ok) {
			toast(data?.error ?? "operasi proyek gagal", "error");
			return null;
		}
		projectMutationRef.current += 1;
		applyProjectData(data);
		return data;
	};

	const projectName = (projectId) =>
		projectsRef.current.find((project) => project.id === projectId)?.name ?? "proyek";

	const assignSession = async (sessionPath, projectId) => {
		if ((assignmentsRef.current[sessionPath] ?? null) === (projectId ?? null)) return;
		const label = projectId ? projectName(projectId) : "tanpa proyek";
		if (!(await projectRequest({ action: "assign", sessionPath, projectId }))) return;
		setTimeout(() => void refreshSidebar(), 0);
		toast(`sesi dipindah ke ${label}`);
	};

	const createProject = async () => {
		const name = await promptModal({
			title: "Proyek baru",
			placeholder: "mis. refactor auth",
			okLabel: "buat",
			label: "Nama proyek",
		});
		if (!name) return;
		if (!(await projectRequest({ action: "create", name, dir: sessionsDir }))) return;
		await refreshSidebar();
		toast(`proyek “${name}” dibuat`);
	};

	const renameProject = async (project) => {
		const name = await promptModal({
			title: "Ganti nama proyek",
			value: project.name,
			okLabel: "simpan",
			label: "Nama proyek",
		});
		if (!name) return;
		if (!(await projectRequest({ action: "rename", projectId: project.id, name }))) return;
		await refreshSidebar();
	};

	const deleteProject = async (project) => {
		const count = Object.values(assignmentsRef.current).filter((id) => id === project.id).length;
		const confirmed = await openModal({
			title: "Hapus proyek?",
			message: `Proyek “${project.name}” dihapus. ${count > 0 ? `${count} sesi kembali ke “tanpa proyek”. ` : ""}File sesi tidak dihapus.`,
			alert: true,
			buttons: [
				{ label: "hapus proyek", value: true, variant: "danger" },
				{ label: "batal", value: false, variant: "ghost" },
			],
		});
		if (!confirmed) return;
		if (!(await projectRequest({ action: "delete", projectId: project.id }))) return;
		await refreshSidebar();
		toast("proyek dihapus (sesi tetap ada)");
	};

	const deleteSessions = async (list) => {
		const requested = (Array.isArray(list) ? list : [list]).filter(Boolean);
		if (requested.length === 0) return false;

		const hasCurrent = requested.some((session) => session.current);
		const targets = requested.filter((session) => session.path && !session.current);
		if (hasCurrent) toast("Sesi aktif tidak bisa dihapus; buat sesi baru dulu", "error");
		if (targets.length === 0) {
			if (!hasCurrent) toast("Sesi ini belum punya file", "error");
			return false;
		}

		const labelOf = (session) =>
			session.name || session.preview || session.id || "tanpa nama";
		const confirmed = await openModal({
			title: targets.length === 1 ? "Hapus sesi?" : `Hapus ${targets.length} sesi?`,
			message:
				targets.length === 1
					? `Sesi “${labelOf(targets[0])}” akan dihapus permanen dari disk.`
					: `${targets.length} sesi berikut akan dihapus permanen dari disk:\n${targets
							.map((session) => `• ${labelOf(session)}`)
							.join("\n")}`,
			alert: true,
			buttons: [
				{
					label: targets.length === 1 ? "hapus" : `hapus ${targets.length}`,
					value: true,
					variant: "danger",
				},
				{ label: "batal", value: false, variant: "ghost" },
			],
		});
		if (!confirmed) return false;

		const { ok, body } = await postJson("/api/sessions/delete", {
			paths: targets.map((session) => session.path),
		});
		const deleted = Array.isArray(body?.deleted) ? body.deleted : [];
		const failed = Array.isArray(body?.failed) ? body.failed : [];
		if (!ok && deleted.length === 0) {
			toast(body?.error ?? "gagal menghapus sesi", "error");
			return false;
		}
		if (deleted.length > 0) {
			toast(deleted.length === 1 ? "sesi dihapus" : `${deleted.length} sesi dihapus`);
		}
		if (failed.length > 0) {
			toast(
				`${failed.length} sesi gagal dihapus: ${failed[0]?.error ?? "kesalahan"}`,
				"error",
			);
		}
		await refreshSidebar();
		return deleted.length > 0;
	};

	const deleteSession = (session) => deleteSessions([session]);

	const afterSessionChange = async () => {
		resetSessionUi();
		await refreshState();
		await loadHistory({ allowStreaming: true });
		await refreshStats();
		await refreshCommands();
		await refreshSidebar();
	};

	const switchSession = async (session) => {
		if (session.current) return;
		const response = await api({ type: "switch_session", sessionPath: session.path });
		if (!response.success) return toast(response.error ?? "gagal switch sesi", "error");
		if (response.data?.cancelled) return toast("switch dibatalkan extension");
		await afterSessionChange();
	};

	const forkFrom = async (entryId, text) => {
		const confirmed = await openModal({
			title: "Fork dari pesan ini?",
			message: truncate(text, 300),
			alert: true,
			buttons: [
				{ label: "fork", value: true, variant: "primary" },
				{ label: "batal", value: false },
			],
		});
		if (!confirmed) return;

		const response = await api({ type: "fork", entryId });
		if (!response.success) return toast(response.error ?? "fork gagal", "error");
		if (response.data?.cancelled) return toast("fork dibatalkan extension");
		const forkedText = response.data?.text ?? "";
		await afterSessionChange();
		if (forkedText) {
			setInputValue(forkedText);
			inputRef.current?.focus();
		}
		toast("fork dibuat — pesan asli ada di editor");
	};

	const cloneSession = async () => {
		const response = await api({ type: "clone" });
		if (!response.success) return toast(response.error ?? "clone gagal", "error");
		if (response.data?.cancelled) return toast("clone dibatalkan extension");
		await afterSessionChange();
		toast("clone dibuat");
	};

	const renameSession = async () => {
		const current = await api({ type: "get_state" });
		if (!current.success) return toast(current.error ?? "get_state gagal", "error");
		const name = await promptModal({
			title: "Nama sesi aktif",
			value: current.data?.sessionName ?? "",
			placeholder: "mis. refactor auth",
			okLabel: "simpan",
			label: "Nama sesi",
		});
		if (name === undefined) return;
		const response = await api({ type: "set_session_name", name });
		if (!response.success) return toast(response.error ?? "gagal menyimpan nama", "error");
		document.title = name ? `${name} — pi` : "pi gui";
		toast(name ? "nama sesi disimpan" : "nama sesi dihapus");
		await refreshSidebar();
	};

	const handleEvent = (record) => {
		switch (record.type) {
			case "hello":
				if (record.error) {
					setStatus("pi gagal");
					showBanner(
						`Agent pi gagal: ${record.error}`,
						"nyalakan ulang",
						() => handlersRef.current.restartAgentFromBanner(),
					);
				} else if (!record.pid) {
					setStatus("pi berhenti");
					showBanner(
						"Proses pi tidak berjalan.",
						"nyalakan ulang",
						() => handlersRef.current.restartAgentFromBanner(),
					);
				} else {
					hideBanner();
					setStatus(isStreamingRef.current ? "berjalan" : "siap");
				}
				break;
			case "pi_started":
				hideBanner();
				setStatus("siap");
				break;
			case "pi_error":
				setStreaming(false);
				stopLive();
				renderQueue({});
				setStatus("pi gagal");
				showBanner(
					`Gagal menjalankan pi: ${record.message}`,
					"nyalakan ulang",
					() => handlersRef.current.restartAgentFromBanner(),
				);
				break;
			case "pi_exit":
				setStreaming(false);
				stopLive();
				renderQueue({});
				setStatus("pi berhenti");
				showBanner(
					`Proses pi berhenti${record.code !== undefined && record.code !== null ? ` (code=${record.code})` : ""}${record.signal ? ` (signal=${record.signal})` : ""}.`,
					"nyalakan ulang",
					() => handlersRef.current.restartAgentFromBanner(),
				);
				break;
			case "agent_start":
				setStreaming(true);
				setStatus("berjalan");
				break;
			case "agent_end":
				if (record.willRetry) addNote("run berakhir, akan retry…");
				break;
			case "agent_settled":
				setStreaming(false);
				stopLive();
				setStatus("siap");
				if (needsHistoryResyncRef.current) {
					needsHistoryResyncRef.current = false;
					void loadHistory();
				}
				void refreshStats();
				scheduleSidebarRefresh();
				break;
			case "message_start":
				onMessageStart(record.message);
				break;
			case "message_update":
				onAssistantEvent(record.assistantMessageEvent);
				break;
			case "message_end":
				onMessageEnd(record.message);
				break;
			case "tool_execution_start":
				updateToolResult(record.toolCallId, { status: "jalan…" });
				break;
			case "tool_execution_update":
				updateToolResult(record.toolCallId, {
					output: contentText(record.partialResult?.content),
					isError: false,
					details: record.partialResult?.details,
				});
				break;
			case "tool_execution_end":
				updateToolResult(record.toolCallId, {
					output: contentText(record.result?.content),
					isError: Boolean(record.isError),
					details: record.result?.details,
					status: record.isError
						? "gagal"
						: typeof record.durationMs === "number"
							? `${(record.durationMs / 1000).toFixed(1)}s`
							: "selesai",
				});
				break;
			case "queue_update":
				renderQueue(record);
				break;
			case "compaction_start":
				setStatus("compacting");
				addNote(`compaction dimulai (${record.reason})`);
				break;
			case "compaction_end":
				setStatus(isStreamingRef.current ? "berjalan" : "siap");
				addNote(
					record.errorMessage
						? `compaction gagal: ${record.errorMessage}`
						: record.aborted
							? "compaction dibatalkan"
							: `compaction selesai · ${fmtNum(record.result?.tokensBefore)} → ${fmtNum(record.result?.estimatedTokensAfter)}`,
				);
				break;
			case "auto_retry_start":
				addNote(`retry ${record.attempt}/${record.maxAttempts} · ${record.errorMessage}`);
				break;
			case "auto_retry_end":
				addNote(record.success ? "retry berhasil" : `retry gagal: ${record.finalError ?? ""}`);
				break;
			case "thinking_level_changed":
				thinkingRef.current = record.level;
				setThinkingValue(record.level);
				break;
			case "session_info_changed":
				document.title = record.name ? `${record.name} — pi` : "pi gui";
				scheduleSidebarRefresh();
				break;
			case "extension_ui_request":
				void handleUiRequest(record);
				break;
			case "extension_error":
				toast(`extension error: ${record.error}`, "error");
				break;
			default:
				break;
		}
	};

	const submit = async () => {
		const message = String(inputRef.current?.value ?? input).trim();
		if (!message && attachments.length === 0) return;

		const images = attachments.map(({ type, data, mimeType }) => ({ type, data, mimeType }));
		setInputValue("");
		setAttachments([]);
		setSlashItems([]);
		lastSlashQueryRef.current = null;

		const command = { type: "prompt", message };
		if (images.length > 0) command.images = images;
		if (isStreamingRef.current) command.streamingBehavior = behaviorRef.current;

		const response = await api(command);
		if (!response.success) {
			setInputValue(message);
			if (images.length > 0) {
				setAttachments(
					images.map((image) => ({
						...image,
						preview: `data:${image.mimeType};base64,${image.data}`,
					})),
				);
			}
			toast(response.error ?? "prompt ditolak", "error");
			return;
		}
		if (response.data?.disposition === "queued") toast("pesan di-queue");
	};

	const stopRun = async () => {
		if (stopInFlightRef.current) return;
		stopInFlightRef.current = true;
		setAbortBusy(true);
		try {
			let restored = 0;
			const cleared = await api({ type: "clear_queue" });
			if (cleared.success) {
				const texts = [...(cleared.data?.steering ?? []), ...(cleared.data?.followUp ?? [])];
				if (texts.length > 0) {
					const current = String(inputRef.current?.value ?? input).trim();
					setInputValue([current, ...texts].filter(Boolean).join("\n\n"));
					inputRef.current?.focus();
					restored = texts.length;
				}
				renderQueue({});
			}

			const aborted = await api({ type: "abort" });
			if (!aborted.success) toast(aborted.error ?? "abort gagal", "error");
			else if (restored > 0) toast(`${restored} pesan queue dikembalikan ke editor`);
		} finally {
			stopInFlightRef.current = false;
			setAbortBusy(false);
		}
	};

	const setInputValue = (value) => setInput(value);

	const readAsDataUrl = (file) =>
		new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(String(reader.result));
			reader.onerror = () => reject(reader.error ?? new Error("gagal baca file"));
			reader.readAsDataURL(file);
		});

	const addImageFiles = async (files) => {
		const additions = [];
		for (const file of files) {
			if (!file.type.startsWith("image/")) continue;
			const dataUrl = await readAsDataUrl(file).catch(() => null);
			if (!dataUrl) continue;
			const comma = dataUrl.indexOf(",");
			if (comma < 0) continue;
			additions.push({
				type: "image",
				data: dataUrl.slice(comma + 1),
				mimeType: file.type || "image/png",
				preview: dataUrl,
			});
		}
		if (additions.length > 0) setAttachments((items) => [...items, ...additions]);
	};

	const applySlash = (command) => {
		setInputValue(`/${command.name} `);
		setSlashItems([]);
		lastSlashQueryRef.current = null;
		inputRef.current?.focus();
	};

	const onInputKeyDown = (event) => {
		if (slashItems.length > 0) {
			if (event.key === "ArrowDown") {
				event.preventDefault();
				setSlashIndex((slashIndex + 1) % slashItems.length);
				return;
			}
			if (event.key === "ArrowUp") {
				event.preventDefault();
				setSlashIndex((slashIndex - 1 + slashItems.length) % slashItems.length);
				return;
			}
			if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey && !event.isComposing)) {
				event.preventDefault();
				applySlash(slashItems[slashIndex]);
				return;
			}
			if (event.key === "Escape") {
				event.preventDefault();
				setSlashItems([]);
				lastSlashQueryRef.current = null;
				return;
			}
		}

		if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
			event.preventDefault();
			void submit();
			return;
		}
		if (event.key === "Escape" && (isStreamingRef.current || pendingCountRef.current > 0)) {
			event.preventDefault();
			void stopRun();
		}
	};

	const onModelChange = async (value) => {
		setModelValue(value);
		const slash = value.indexOf("/");
		const provider = value.slice(0, slash);
		const modelId = value.slice(slash + 1);
		const response = await api({ type: "set_model", provider, modelId });
		if (!response.success) return toast(response.error ?? "gagal ganti model", "error");
		modelRef.current = response.data;
		await refreshThinkingLevels();
		await refreshState();
	};

	const onThinkingChange = async (level) => {
		setThinkingValue(level);
		const response = await api({ type: "set_thinking_level", level });
		if (!response.success) return toast(response.error ?? "gagal set thinking", "error");
		thinkingRef.current = level;
	};

	const newSession = async () => {
		const response = await api({ type: "new_session" });
		if (!response.success) return toast(response.error ?? "gagal sesi baru", "error");
		if (response.data?.cancelled) return toast("dibatalkan oleh extension");
		await afterSessionChange();
	};

	const compact = async () => {
		toast("compaction dimulai…");
		const response = await api({ type: "compact" });
		if (!response.success) toast(response.error ?? "compaction gagal", "error");
		await refreshStats();
	};

	const exportHtml = async () => {
		const response = await api({ type: "export_html" });
		if (!response.success) return toast(response.error ?? "export gagal", "error");
		toast(`export: ${response.data?.path ?? "selesai"}`);
	};

	handlersRef.current = {
		handleEvent,
		refreshState,
		refreshStats,
		refreshCommands,
		loadHistory,
		setStatus,
		showBanner,
		restartAgentFromBanner,
	};

	useEffect(() => {
		const match = /^\/(\S*)$/.exec(input);
		if (!match) {
			lastSlashQueryRef.current = null;
			setSlashItems([]);
			return;
		}
		const query = match[1].toLowerCase();
		if (query !== lastSlashQueryRef.current) {
			setSlashIndex(0);
			lastSlashQueryRef.current = query;
		}
		const next = commands
			.filter((command) => command.name.toLowerCase().includes(query))
			.slice(0, 8);
		setSlashItems(next);
		setSlashIndex((index) => Math.min(index, Math.max(0, next.length - 1)));
	}, [input, commands]);

	useEffect(() => {
		const element = inputRef.current;
		if (!element) return;
		const syncNativeInput = () => setInput(element.value);
		element.addEventListener("input", syncNativeInput);
		return () => element.removeEventListener("input", syncNativeInput);
	}, []);

	useEffect(() => {
		if (!inputRef.current) return;
		inputRef.current.style.height = "auto";
		inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 320)}px`;
	}, [input]);

	useEffect(() => {
		const events = {
			controller: null,
			reconnectTimer: null,
			reconnectAttempt: 0,
			opened: false,
			disposed: false,
		};

		const handleSseBlock = (block) => {
			const data = block
				.split("\n")
				.filter((line) => line.startsWith("data:"))
				.map((line) => line.slice(5).replace(/^ /, ""))
				.join("\n");
			if (!data) return;
			try {
				handlersRef.current.handleEvent(JSON.parse(data));
			} catch {
				/* record rusak, abaikan */
			}
		};

		const scheduleReconnect = () => {
			if (events.disposed || events.reconnectTimer) return;
			const delay =
				Math.min(8000, 500 * 2 ** events.reconnectAttempt) + Math.floor(Math.random() * 250);
			events.reconnectAttempt = Math.min(events.reconnectAttempt + 1, 5);
			events.reconnectTimer = setTimeout(() => {
				events.reconnectTimer = null;
				void connectEvents();
			}, delay);
		};

		const connectEvents = async () => {
			if (events.disposed) return;
			if (events.controller) events.controller.abort();
			if (events.reconnectTimer) {
				clearTimeout(events.reconnectTimer);
				events.reconnectTimer = null;
			}
			const controller = new AbortController();
			events.controller = controller;
			handlersRef.current.setStatus("menyambung…");

			try {
				const res = await fetch("/api/events", {
					headers: { ...headers, accept: "text/event-stream" },
					signal: controller.signal,
					cache: "no-store",
				});

				if (res.status === 401) {
					await res.body?.cancel().catch(() => {});
					handlersRef.current.setStatus("token ditolak");
					handlersRef.current.showBanner(
						"Token ditolak server. Buka URL terbaru dari terminal, lalu muat ulang halaman.",
						"muat ulang",
						() => location.reload(),
					);
					return;
				}
				if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

				events.reconnectAttempt = 0;
				if (events.opened) {
					const session = await handlersRef.current.refreshState();
					if (session?.isStreaming) {
						needsHistoryResyncRef.current = true;
					} else if (session) {
						needsHistoryResyncRef.current = false;
						await handlersRef.current.loadHistory();
					}
					await handlersRef.current.refreshStats();
					await handlersRef.current.refreshCommands();
					handlersRef.current.setStatus(
						session ? (session.isStreaming ? "berjalan" : "siap") : "tidak tersambung",
					);
				} else {
					events.opened = true;
					handlersRef.current.setStatus(
						isStreamingRef.current ? "berjalan" : "siap",
					);
				}

				const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
				let buffer = "";
				for (;;) {
					const { value, done } = await reader.read();
					if (done) break;
					buffer += value;
					let index;
					while ((index = buffer.indexOf("\n\n")) !== -1) {
						const block = buffer.slice(0, index);
						buffer = buffer.slice(index + 2);
						handleSseBlock(block);
					}
				}
				throw new Error("stream berakhir");
			} catch {
				if (events.disposed || controller.signal.aborted) return;
				handlersRef.current.setStatus("menyambung ulang…");
				scheduleReconnect();
			}
		};

		const boot = async () => {
			if (!token) {
				setNotice("Token tidak ada. Buka URL yang dicetak server (termasuk #t=…).");
				return;
			}
			const infoResponse = await fetch("/api/info", { headers }).catch(() => null);
			if (infoResponse?.status === 401) {
				handlersRef.current.setStatus("token ditolak");
				handlersRef.current.showBanner(
					"Token ditolak server. Buka URL terbaru yang dicetak terminal (termasuk #t=…).",
					"muat ulang",
					() => location.reload(),
				);
				return;
			}
			const info = await infoResponse?.json().catch(() => null);
			if (info?.cwd) setCwd(info.cwd);
			void connectEvents();
			if (info?.error || (info && info.pid === null)) {
				handlersRef.current.setStatus("pi gagal");
				handlersRef.current.showBanner(
					`Agent pi tidak berjalan: ${info.error ?? "pid tidak tersedia"}`,
					"nyalakan ulang",
					() => handlersRef.current.restartAgentFromBanner(),
				);
				inputRef.current?.focus();
				return;
			}
			await handlersRef.current.refreshState();
			await refreshModels();
			await refreshThinkingLevels();
			await handlersRef.current.loadHistory({ allowStreaming: true });
			await handlersRef.current.refreshStats();
			await handlersRef.current.refreshCommands();
			inputRef.current?.focus();
		};

		void boot();
		return () => {
			events.disposed = true;
			if (events.reconnectTimer) clearTimeout(events.reconnectTimer);
			events.controller?.abort();
			if (sidebarTimerRef.current) clearTimeout(sidebarTimerRef.current);
			if (liveTimerRef.current) clearTimeout(liveTimerRef.current);
		};
	}, []);

	const sidebarCallbacks = {
		assignSession,
		deleteSession,
		deleteSessions,
		switchSession,
		renameProject,
		deleteProject,
		forkFrom,
	};

	return (
		<SidebarProvider
			open={sidebarOpen}
			onOpenChange={handleSidebarOpenChange}
			defaultOpen={false}
			style={{ "--sidebar-width": "20rem" }}
			className="h-svh overflow-hidden"
		>
			<AppSidebar
				sideTab={sideTab}
				onSideTab={changeSideTab}
				onClose={() => handleSidebarOpenChange(false)}
				onRefresh={() => void refreshSidebar()}
				onCreateProject={createProject}
				onClone={cloneSession}
				onRenameSession={renameSession}
				sessions={sessions}
				projects={projects}
				assignments={assignments}
				sessionsDir={sessionsDir}
				sidebarLoading={sidebarLoading}
				sidebarError={sidebarError}
				tree={tree}
				treeLeafId={treeLeafId}
				callbacks={sidebarCallbacks}
				onDraggingChange={(dragging) => {
					sidebarDraggingRef.current = dragging;
				}}
			/>
			<SidebarInset className="h-svh min-h-0 overflow-hidden">
				<TopBar
					cwd={cwd}
					onCwdChange={setCwd}
					onRestart={restart}
					models={models}
					modelValue={modelValue}
					onModelChange={onModelChange}
					thinkingLevels={thinkingLevels}
					thinkingValue={thinkingValue}
					onThinkingChange={onThinkingChange}
					status={statusText}
					onNewSession={newSession}
					onCompact={compact}
					onExport={exportHtml}
					onStop={stopRun}
					stopDisabled={abortBusy}
				/>
				<Transcript
					messages={messages}
					live={live}
					toolResults={toolResults}
					notice={notice}
					onCopyError={toast}
				/>
				<Composer
					banner={banner}
					onBannerAction={() => banner?.handler?.()}
					onBannerClose={hideBanner}
					queue={queue}
					extWidgetLines={extWidgetLines}
					attachments={attachments}
					onRemoveAttachment={(index) =>
						setAttachments((items) => items.filter((_, itemIndex) => itemIndex !== index))
					}
					slashItems={slashItems}
					slashIndex={slashIndex}
					onApplySlash={applySlash}
					inputRef={inputRef}
					input={input}
					onInputChange={setInputValue}
					onInputKeyDown={onInputKeyDown}
					onPaste={(event) => {
						const files = [...(event.clipboardData?.files ?? [])].filter((file) =>
							file.type.startsWith("image/"),
						);
						if (files.length === 0) return;
						event.preventDefault();
						void addImageFiles(files);
					}}
					onDropFiles={(files) => void addImageFiles(files)}
					behavior={behavior}
					onBehaviorChange={setBehaviorState}
					stats={stats}
					onSubmit={() => void submit()}
				/>
			</SidebarInset>
			<DialogHost modal={modal} onClose={closeModal} />
			<Toaster theme="dark" position="bottom-right" richColors closeButton />
		</SidebarProvider>
	);
}

export default App;
