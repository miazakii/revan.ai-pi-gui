import { useCallback, useEffect, useRef, useState } from "react";
import { toast as notify } from "sonner";
import { useTheme } from "next-themes";
import {
	BellIcon,
	BracesIcon,
	FileDownIcon,
	FileTextIcon,
	KeyboardIcon,
	Minimize2Icon,
	MonitorIcon,
	MoonIcon,
	PanelLeftIcon,
	PlusIcon,
	SearchIcon,
	SunIcon,
	TerminalIcon,
} from "lucide-react";

import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import AppSidebar from "./components/AppSidebar.jsx";
import Composer from "./components/Composer.jsx";
import DialogHost from "./components/Modal.jsx";
import TopBar from "./components/TopBar.jsx";
import CommandPalette from "./components/CommandPalette.jsx";
import HelpDialog from "./components/HelpDialog.jsx";
import Transcript from "./components/Transcript.jsx";
import { api, apiGet, headers, postJson, token } from "./api/client.js";
import { contentText, fmtNum, truncate } from "./utils/format.js";

let noteSeq = 0;

function readStored(key, fallback) {
	try {
		const value = localStorage.getItem(key);
		return value === null ? fallback : value;
	} catch {
		return fallback;
	}
}

function readStoredJson(key, fallback) {
	try {
		const value = JSON.parse(localStorage.getItem(key) ?? "null");
		return value ?? fallback;
	} catch {
		return fallback;
	}
}

function writeStored(key, value) {
	try {
		if (value === null || value === undefined) localStorage.removeItem(key);
		else localStorage.setItem(key, value);
	} catch {
		/* localStorage diblokir/penuh */
	}
}

const SIDEBAR_KEY = "pi-gui-sidebar";
const SIDETAB_KEY = "pi-gui-sidetab";
const DRAFT_KEY = "pi-gui-draft";
const RECENT_CWD_KEY = "pi-gui-recent-cwds";

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

function toolSummaryText(args) {
	if (!args || typeof args !== "object") return "";
	const value = args.command ?? args.path ?? args.pattern ?? Object.keys(args).slice(0, 3).join(", ");
	return String(value).replace(/\s+/g, " ").slice(0, 120);
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
	const [contextPercent, setContextPercent] = useState(0);
	const [paletteOpen, setPaletteOpen] = useState(false);
	const [helpOpen, setHelpOpen] = useState(false);
	const [otherTabs, setOtherTabs] = useState(false);
	const { setTheme } = useTheme();
	const [notificationPermission, setNotificationPermission] = useState(() => {
		try {
			return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
		} catch {
			return "unsupported";
		}
	});

	const [cwd, setCwd] = useState("");
	const [sessionFile, setSessionFile] = useState(null);
	const [models, setModels] = useState([]);
	const [thinkingLevels, setThinkingLevels] = useState([]);
	const [modelValue, setModelValue] = useState("");
	const [thinkingValue, setThinkingValue] = useState("");

	const [banner, setBanner] = useState(null);
	const [modal, setModal] = useState(null);
	const [sidebarOpen, setSidebarOpen] = useState(
		() => readStored(SIDEBAR_KEY, "0") === "1",
	);

	const [input, setInput] = useState(() => readStored(DRAFT_KEY, ""));
	const [attachments, setAttachments] = useState([]);
	const [behavior, setBehavior] = useState("followUp");
	const [commands, setCommands] = useState([]);
	const [slashItems, setSlashItems] = useState([]);
	const [slashIndex, setSlashIndex] = useState(0);
	const [abortBusy, setAbortBusy] = useState(false);

	const [sideTab, setSideTabState] = useState(() =>
		readStored(SIDETAB_KEY, "sessions"),
	);
	const [sidebarLoading, setSidebarLoading] = useState(false);
	const [sidebarError, setSidebarError] = useState("");
	const [sessions, setSessions] = useState([]);
	const [projects, setProjects] = useState([]);
	const [assignments, setAssignments] = useState({});
	const [sessionsDir, setSessionsDir] = useState(null);
	const [tree, setTree] = useState([]);
	const [treeLeafId, setTreeLeafId] = useState(null);
	const [recentCwds, setRecentCwds] = useState(() =>
		readStoredJson(RECENT_CWD_KEY, []),
	);

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
	const lastAssistantTextRef = useRef("");

	const toast = useCallback((message, type = "info") => {
		if (!message) return;
		const text = String(message);
		if (type === "error") notify.error(text);
		else if (type === "warning") notify.warning(text);
		else notify(text);
	}, []);

	const requestNotifications = async () => {
		if (typeof Notification === "undefined") {
			return toast("Browser ini tidak mendukung notifikasi", "warning");
		}
		try {
			const permission = await Notification.requestPermission();
			setNotificationPermission(permission);
			if (permission === "granted") toast("notifikasi selesai run diaktifkan");
			else toast("izinkan notifikasi di pengaturan browser", "warning");
		} catch {
			toast("gagal meminta izin notifikasi", "error");
		}
	};

	const notifyRunFinished = () => {
		if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
		if (!document.hidden) return;
		try {
			const title = document.title.replace(/ — pi$/, "").replace(/^✓ /, "") || "pi";
			const notification = new Notification(`pi · ${title}`, {
				body: truncate(lastAssistantTextRef.current || "Run selesai.", 180),
				tag: "pi-gui-settled",
			});
			notification.onclick = () => {
				window.focus();
				notification.close();
			};
			document.title = `✓ ${document.title.replace(/^✓ /, "")}`;
		} catch {
			/* notifikasi diblokir */
		}
	};

	const setStreaming = (value) => {
		isStreamingRef.current = Boolean(value);
		setIsStreamingState(Boolean(value));
	};

	const setSidebarOpenState = (value) => {
		setSidebarOpen(Boolean(value));
		writeStored(SIDEBAR_KEY, value ? "1" : "0");
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
		({ title, value = "", placeholder = "", okLabel = "Simpan", label = "Nama" }) =>
			openModal({
				title,
				input: { value, placeholder, multiline: false, label },
				buttons: [
					{
						label: okLabel,
						value: (current) => String(current ?? "").trim(),
						variant: "primary",
					},
					{ label: "Batal", value: undefined, variant: "ghost" },
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
			thinkingText: current.thinkingText,
			blocks: [...current.blocks.entries()]
				.sort(([a], [b]) => a - b)
				.map(([index, block]) => ({ index, text: block.text, final: block.final })),
		});
	};

	const startLiveAssistant = () => {
		if (liveRef.current) return;
		liveRef.current = { thinking: false, thinkingText: "", blocks: new Map() };
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
				startLiveAssistant();
				liveRef.current.thinking = true;
				liveRef.current.thinkingText = "";
				scheduleLiveFlush({ final: true });
				break;
			case "thinking_delta":
				startLiveAssistant();
				liveRef.current.thinking = true;
				liveRef.current.thinkingText += event.delta ?? "";
				scheduleLiveFlush();
				break;
			case "thinking_end":
				scheduleLiveFlush({ final: true });
				if (liveRef.current) liveRef.current.thinking = false;
				break;
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
			const text = (message.content ?? [])
				.filter((block) => block.type === "text")
				.map((block) => block.text)
				.join("\n")
				.trim();
			if (text) lastAssistantTextRef.current = text;
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
			setContextPercent(Number(data.contextUsage.percent ?? 0));
			parts.push(
				`ctx ${fmtNum(data.contextUsage.tokens)}/${fmtNum(data.contextUsage.contextWindow)} ` +
					`(${Math.round(data.contextUsage.percent ?? 0)}%)`,
			);
		} else {
			setContextPercent(0);
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
		setSessionFile(session.sessionFile ?? null);
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
		if (request !== historyRequestRef.current) return;
		if (!response.success) {
			setNotice(`Gagal memuat riwayat: ${response.error ?? "respons tidak valid"}`);
			toast(response.error ?? "gagal memuat riwayat", "error");
			return;
		}
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
		setContextPercent(0);
		setSessionFile(null);
		needsHistoryResyncRef.current = false;
		pendingCountRef.current = 0;
		setMessages([]);
		setToolResults({});
		setQueue({ steering: [], followUp: [], unknown: 0 });
		setExtWidgetLines([]);
		setExtStatus({});
		setStats("");
		setNotice("");
		setInputValue("");
		setAttachments([]);
		document.title = "pi gui";
		setStatus("siap");
	};

	const restartAgentFromBanner = () => {
		const next = cwd.trim();
		if (!next) return toast("workspace kosong", "error");
		void restart(next);
	};

	const confirmBusy = async (title) => {
		if (!isStreamingRef.current && pendingCountRef.current === 0) return true;
		return Boolean(
			await openModal({
				title,
				message:
					"Agent masih berjalan dan queue mungkin belum kosong. Tindakan ini akan menghentikan atau meninggalkan run tersebut.",
				alert: true,
				buttons: [
					{ label: "Lanjut", value: true, variant: "danger" },
					{ label: "Batal", value: false, variant: "ghost" },
				],
			}),
		);
	};

	const restart = async (nextCwd) => {
		if (!(await confirmBusy("Pindah workspace saat agent berjalan?"))) return;
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
						{ label: "Batal", value: undefined, variant: "ghost" },
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
						{ label: "Ya", value: true, variant: "primary" },
						{ label: "Tidak", value: false },
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
						{ label: "OK", value: (current) => current, variant: "primary" },
						{ label: "Batal", value: undefined },
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
						{ label: "OK", value: (current) => current, variant: "primary" },
						{ label: "Batal", value: undefined },
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
		writeStored(SIDETAB_KEY, tab);
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
			okLabel: "Buat",
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
			okLabel: "Simpan",
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
				{ label: "Hapus Proyek", value: true, variant: "danger" },
				{ label: "Batal", value: false, variant: "ghost" },
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
					? `Sesi “${labelOf(targets[0])}” akan dipindahkan ke trash dan bisa diurungkan.`
					: `${targets.length} sesi berikut akan dipindahkan ke trash (bisa diurungkan):\n${targets
							.map((session) => `• ${labelOf(session)}`)
							.join("\n")}`,
			alert: true,
			buttons: [
				{
					label: targets.length === 1 ? "Hapus" : `Hapus ${targets.length}`,
					value: true,
					variant: "danger",
				},
				{ label: "Batal", value: false, variant: "ghost" },
			],
		});
		if (!confirmed) return false;

		const { ok, body } = await postJson("/api/sessions/delete", {
			paths: targets.map((session) => session.path),
		});
		const deleted = Array.isArray(body?.deleted) ? body.deleted : [];
		const trashed = Array.isArray(body?.trashed) ? body.trashed : [];
		const failed = Array.isArray(body?.failed) ? body.failed : [];
		if (!ok && deleted.length === 0) {
			toast(body?.error ?? "gagal menghapus sesi", "error");
			return false;
		}
		if (deleted.length > 0) {
			const message = deleted.length === 1 ? "sesi dipindahkan ke trash" : `${deleted.length} sesi dipindahkan ke trash`;
			if (trashed.length > 0) {
				notify.success(message, {
					duration: 9000,
					action: {
						label: "Urungkan",
						onClick: () => void restoreTrashed(trashed),
					},
				});
			} else {
				toast(message);
			}
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

	const restoreTrashed = async (items) => {
		const paths = items.map((item) => item?.trashPath).filter(Boolean);
		if (paths.length === 0) return;
		const { ok, body } = await postJson("/api/sessions/restore", { paths });
		const restored = Array.isArray(body?.restored) ? body.restored : [];
		if (!ok || restored.length === 0) {
			toast(body?.error ?? body?.failed?.[0]?.error ?? "gagal mengurungkan hapus", "error");
			return;
		}
		toast(restored.length === 1 ? "sesi dipulihkan" : `${restored.length} sesi dipulihkan`);
		await refreshSidebar();
	};

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
		if (!(await confirmBusy("Pindah sesi saat agent berjalan?"))) return;
		const response = await api({ type: "switch_session", sessionPath: session.path });
		if (!response.success) return toast(response.error ?? "gagal switch sesi", "error");
		if (response.data?.cancelled) return toast("switch dibatalkan extension");
		await afterSessionChange();
	};

	const forkFrom = async (entryId, text, { autoSend = false } = {}) => {
		const busy = isStreamingRef.current || pendingCountRef.current > 0;
		const confirmed = await openModal({
			title: "Fork dari pesan ini?",
			message:
				truncate(text, 300) +
				(busy ? "\n\nAgent masih berjalan; fork akan meninggalkan run yang aktif." : ""),
			alert: true,
			buttons: [
				{ label: "Fork", value: true, variant: "primary" },
				{ label: "Batal", value: false },
			],
		});
		if (!confirmed) return;

		const response = await api({ type: "fork", entryId });
		if (!response.success) return toast(response.error ?? "fork gagal", "error");
		if (response.data?.cancelled) return toast("fork dibatalkan extension");
		const forkedText = response.data?.text ?? "";
		await afterSessionChange();
		if (forkedText) {
			if (autoSend) {
				const sent = await api({ type: "prompt", message: forkedText });
				if (!sent.success) {
					setInputValue(forkedText);
					inputRef.current?.focus();
					toast(sent.error ?? "gagal mengirim ulang", "error");
					return;
				}
				toast("fork dibuat — prompt dikirim ulang");
			} else {
				setInputValue(forkedText);
				inputRef.current?.focus();
				toast("fork dibuat — pesan asli ada di editor");
			}
		} else {
			toast("fork dibuat");
		}
	};

	const cloneSession = async () => {
		if (!(await confirmBusy("Duplikat sesi saat agent berjalan?"))) return;
		const response = await api({ type: "clone" });
		if (!response.success) return toast(response.error ?? "clone gagal", "error");
		if (response.data?.cancelled) return toast("clone dibatalkan extension");
		await afterSessionChange();
		toast("clone dibuat");
	};

	const renameSession = async (session = null) => {
		let current = null;
		if (!session) {
			current = await api({ type: "get_state" });
			if (!current.success) return toast(current.error ?? "get_state gagal", "error");
		}
		const isCurrent = !session || session.current;
		const name = await promptModal({
			title: session ? "Ganti nama sesi" : "Nama sesi aktif",
			value: session ? (session.name ?? "") : (current.data?.sessionName ?? ""),
			placeholder: "mis. refactor auth",
			okLabel: "Simpan",
			label: "Nama sesi",
		});
		if (name === undefined) return;

		if (!isCurrent) {
			const { ok, body } = await postJson("/api/sessions/rename", {
				path: session.path,
				name,
			});
			if (!ok) return toast(body?.error ?? "gagal menyimpan nama", "error");
		} else {
			const response = await api({ type: "set_session_name", name });
			if (!response.success) return toast(response.error ?? "gagal menyimpan nama", "error");
			document.title = name ? `${name} — pi` : "pi gui";
		}
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
						"Nyalakan Ulang",
						() => handlersRef.current.restartAgentFromBanner(),
					);
				} else if (!record.pid) {
					setStatus("pi berhenti");
					showBanner(
						"Proses pi tidak berjalan.",
						"Nyalakan Ulang",
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
					"Nyalakan Ulang",
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
					"Nyalakan Ulang",
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
				notifyRunFinished();
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
				updateToolResult(record.toolCallId, { status: "jalan…", startedAt: Date.now() });
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

	const prepareImage = async (file) => {
		const MAX_DIMENSION = 2000;
		const MAX_BYTES = 4.5 * 1024 * 1024;
		const originalUrl = await readAsDataUrl(file).catch(() => null);
		if (!originalUrl) return null;

		let dataUrl = originalUrl;
		let mimeType = file.type || "image/png";
		let size = file.size;

		// GIF dilewati agar animasinya tidak hilang; format lain aman dikompresi.
		const needsResize = file.type !== "image/gif";
		if (needsResize && typeof createImageBitmap === "function") {
			const bitmap = await createImageBitmap(file).catch(() => null);
			if (bitmap) {
				const scale = Math.min(
					1,
					MAX_DIMENSION / Math.max(bitmap.width, bitmap.height),
				);
				const width = Math.max(1, Math.round(bitmap.width * scale));
				const height = Math.max(1, Math.round(bitmap.height * scale));
				const canvas = document.createElement("canvas");
				canvas.width = width;
				canvas.height = height;
				const context = canvas.getContext("2d");
				context?.drawImage(bitmap, 0, 0, width, height);
				bitmap.close?.();

				if (file.size > MAX_BYTES || scale < 1) {
					const blob = await new Promise((resolve) =>
						canvas.toBlob(resolve, "image/jpeg", 0.82),
					);
					if (blob && blob.size < file.size) {
						const converted = await readAsDataUrl(blob).catch(() => null);
						if (converted) {
							dataUrl = converted;
							mimeType = "image/jpeg";
							size = blob.size;
						}
					}
				}
			}
		}

		const comma = dataUrl.indexOf(",");
		if (comma < 0) return null;
		return {
			type: "image",
			data: dataUrl.slice(comma + 1),
			mimeType,
			preview: dataUrl,
			size,
		};
	};

	const addImageFiles = async (files) => {
		const additions = [];
		for (const file of files) {
			if (!file.type.startsWith("image/")) continue;
			const image = await prepareImage(file);
			if (image) additions.push(image);
		}
		if (additions.length === 0) return;
		if (attachments.length + additions.length > 12) {
			toast("maksimal 12 gambar", "warning");
		}
		setAttachments((items) => [...items, ...additions].slice(0, 12));
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
		if (!(await confirmBusy("Mulai sesi baru saat agent berjalan?"))) return;
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

	const downloadFile = (filename, content, mime) => {
		const url = URL.createObjectURL(new Blob([content], { type: mime }));
		const link = document.createElement("a");
		link.href = url;
		link.download = filename;
		link.click();
		setTimeout(() => URL.revokeObjectURL(url), 1500);
	};

	const exportBaseName = () => {
		const title = document.title
			.replace(/ — pi$/, "")
			.replace(/^✓ /, "")
			.replace(/[^a-zA-Z0-9-_]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 50);
		return `pi-${title || "transcript"}-${new Date().toISOString().slice(0, 10)}`;
	};

	const exportMarkdown = () => {
		if (messages.length === 0) return toast("transcript masih kosong", "warning");
		const lines = ["# pi transcript", "", `- diexport: ${new Date().toISOString()}`, ""];
		for (const message of messages) {
			if (message.role === "user") {
				lines.push("## You", "", contentText(message.content), "");
			} else if (message.role === "assistant") {
				const text = (message.content ?? [])
					.filter((block) => block.type === "text")
					.map((block) => block.text)
					.join("\n\n")
					.trim();
				const thinking = (message.content ?? [])
					.filter((block) => block.type === "thinking")
					.map((block) => block.thinking)
					.join("\n\n")
					.trim();
				if (text) lines.push("## Assistant", "", text, "");
				if (thinking) {
					lines.push("<details>", "<summary>thinking</summary>", "", thinking, "", "</details>", "");
				}
				for (const block of message.content ?? []) {
					if (block.type !== "toolCall") continue;
					lines.push(`> tool: \`${block.name}\` ${toolSummaryText(block.arguments)}`, "");
				}
			} else if (message.role === "__note") {
				lines.push(`> ${message.text}`, "");
			}
		}
		downloadFile(`${exportBaseName()}.md`, lines.join("\n"), "text/markdown;charset=utf-8");
		toast("transcript diexport sebagai Markdown");
	};

	const exportJson = () => {
		if (messages.length === 0) return toast("transcript masih kosong", "warning");
		downloadFile(
			`${exportBaseName()}.json`,
			JSON.stringify({ exportedAt: new Date().toISOString(), messages }, null, 2),
			"application/json;charset=utf-8",
		);
		toast("transcript diexport sebagai JSON");
	};

	const exportHtml = async () => {
		const response = await api({ type: "export_html" });
		if (!response.success) return toast(response.error ?? "export gagal", "error");
		const path = response.data?.path ?? "";
		if (!path) return toast("export selesai");
		const action = await openModal({
			title: "Export HTML selesai",
			message: path,
			buttons: [
				{ label: "Salin Path", value: "copy", variant: "primary" },
				{ label: "Tutup", value: undefined, variant: "ghost" },
			],
		});
		if (action === "copy") {
			try {
				await navigator.clipboard.writeText(path);
				toast("path export disalin");
			} catch {
				toast("clipboard ditolak browser", "error");
			}
		}
	};

	handlersRef.current = {
		handleEvent,
		refreshState,
		refreshStats,
		refreshCommands,
		stopRun,
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
		const timer = setTimeout(() => writeStored(DRAFT_KEY, input || null), 250);
		return () => clearTimeout(timer);
	}, [input]);

	useEffect(() => {
		if (!cwd) return;
		setRecentCwds((previous) => {
			if (previous[0] === cwd) return previous;
			const next = [cwd, ...previous.filter((item) => item !== cwd)].slice(0, 8);
			writeStored(RECENT_CWD_KEY, JSON.stringify(next));
			return next;
		});
	}, [cwd]);

	useEffect(() => {
		if (typeof BroadcastChannel === "undefined") return;
		const myId = Math.random().toString(36).slice(2);
		const tabs = new Set([myId]);
		const channel = new BroadcastChannel("pi-gui-tabs");
		const sync = () => setOtherTabs(tabs.size > 1);
		channel.onmessage = (event) => {
			const data = event.data;
			if (!data || data.id === myId) return;
			if (data.type === "hello") {
				tabs.add(data.id);
				sync();
				channel.postMessage({ type: "here", id: myId, to: data.id });
			} else if (data.type === "here" && data.to === myId) {
				tabs.add(data.id);
				sync();
			} else if (data.type === "bye") {
				tabs.delete(data.id);
				sync();
			}
		};
		channel.postMessage({ type: "hello", id: myId });
		const bye = () => channel.postMessage({ type: "bye", id: myId });
		window.addEventListener("pagehide", bye);
		return () => {
			bye();
			window.removeEventListener("pagehide", bye);
			channel.close();
		};
	}, []);

	useEffect(() => {
		const restoreTitle = () => {
			document.title = document.title.replace(/^✓ /, "");
		};
		const onVisibility = () => {
			if (!document.hidden) restoreTitle();
		};
		window.addEventListener("focus", restoreTitle);
		document.addEventListener("visibilitychange", onVisibility);
		return () => {
			window.removeEventListener("focus", restoreTitle);
			document.removeEventListener("visibilitychange", onVisibility);
		};
	}, []);

	useEffect(() => {
		const onKey = (event) => {
			const target = event.target;
			const typing =
				target instanceof HTMLElement &&
				(Boolean(target.closest("input, textarea, select")) || target.isContentEditable);
			const modifier = event.metaKey || event.ctrlKey;

			if (modifier && event.key.toLowerCase() === "k") {
				event.preventDefault();
				setPaletteOpen(true);
				return;
			}
			if (
				event.key === "?" &&
				!modifier &&
				!typing &&
				!document.querySelector('[role="dialog"]')
			) {
				event.preventDefault();
				setHelpOpen(true);
				return;
			}
			if (modifier && event.key.toLowerCase() === "b" && !typing) {
				event.preventDefault();
				setSidebarOpenState(!sidebarOpen);
				return;
			}
			if (event.key !== "Escape" || event.defaultPrevented) return;
			if (document.querySelector('[role="dialog"], [role="menu"]')) return;
			if (isStreamingRef.current || pendingCountRef.current > 0) {
				event.preventDefault();
				void handlersRef.current.stopRun?.();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [sidebarOpen]);

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
						"Muat Ulang",
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
				handlersRef.current.showBanner(
					"Koneksi ke server terputus. Mencoba menyambung ulang…",
					"Muat Ulang",
					() => location.reload(),
				);
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
					"Muat Ulang",
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
					"Nyalakan Ulang",
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

	const forkFromRef = useRef(null);
	forkFromRef.current = forkFrom;
	const forkAction = useCallback(
		(entryId, text) => forkFromRef.current?.(entryId, text),
		[],
	);
	const regenerateRef = useRef(null);
	regenerateRef.current = (entryId, text) =>
		forkFrom(entryId, text, { autoSend: true });
	const regenerateAction = useCallback(
		(entryId, text) => regenerateRef.current?.(entryId, text),
		[],
	);

	const queueTotal =
		(queue.steering?.length ?? 0) + (queue.followUp?.length ?? 0) + (queue.unknown ?? 0);
	const stopDisabled = abortBusy || (!isStreaming && queueTotal === 0);

	const focusSessionSearch = () => {
		handleSidebarOpenChange(true);
		setTimeout(() => {
			document
				.querySelector('#side-body input[aria-label="Cari sesi"]')
				?.focus();
		}, 250);
	};

	const paletteItems = [
		{
			id: "new-session",
			label: "Sesi Baru",
			icon: PlusIcon,
			run: () => void newSession(),
		},
		{
			id: "compact",
			label: "Ringkas Konteks (Compact)",
			icon: Minimize2Icon,
			run: () => void compact(),
		},
		{
			id: "search-session",
			label: "Cari Sesi di Sidebar",
			icon: SearchIcon,
			run: focusSessionSearch,
		},
		{
			id: "focus-composer",
			label: "Fokus ke Kotak Pesan",
			icon: TerminalIcon,
			run: () => inputRef.current?.focus(),
		},
		{
			id: "toggle-sidebar",
			label: sidebarOpen ? "Tutup sidebar" : "Buka sidebar",
			icon: PanelLeftIcon,
			run: () => setSidebarOpenState(!sidebarOpen),
		},
		{
			id: "export-html",
			label: "Export Transcript ke HTML",
			icon: FileDownIcon,
			run: () => void exportHtml(),
		},
		{
			id: "export-markdown",
			label: "Export Transcript ke Markdown",
			icon: FileTextIcon,
			run: exportMarkdown,
		},
		{
			id: "export-json",
			label: "Export Transcript ke JSON",
			icon: BracesIcon,
			run: exportJson,
		},
		{
			id: "notifications",
			label:
				notificationPermission === "granted"
					? "Notifikasi selesai sudah aktif"
					: "Aktifkan notifikasi selesai run",
			icon: BellIcon,
			run: () => void requestNotifications(),
		},
		{
			id: "theme-light",
			label: "Tema Terang",
			icon: SunIcon,
			run: () => setTheme("light"),
		},
		{
			id: "theme-dark",
			label: "Tema Gelap",
			icon: MoonIcon,
			run: () => setTheme("dark"),
		},
		{
			id: "theme-system",
			label: "Tema Ikuti Sistem",
			icon: MonitorIcon,
			run: () => setTheme("system"),
		},
		{
			id: "help",
			label: "Shortcut & Bantuan",
			icon: KeyboardIcon,
			shortcut: "?",
			run: () => setHelpOpen(true),
		},
	];

	const sidebarCallbacks = {
		assignSession,
		deleteSession,
		deleteSessions,
		switchSession,
		renameProject,
		deleteProject,
		forkFrom,
		renameSession,
		copyPath: async (path) => {
			try {
				await navigator.clipboard.writeText(path);
				toast("path sesi disalin");
			} catch {
				toast("clipboard ditolak browser", "error");
			}
		},
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
				<a
					href="#input"
					className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground"
				>
					Lompat ke kotak pesan
				</a>
				<h1 className="sr-only">pi gui — antarmuka percakapan pi</h1>
				<TopBar
					cwd={cwd}
					onCwdChange={setCwd}
					onRestart={restart}
					recentCwds={recentCwds}
					models={models}
					modelValue={modelValue}
					onModelChange={onModelChange}
					thinkingLevels={thinkingLevels}
					thinkingValue={thinkingValue}
					onThinkingChange={onThinkingChange}
					status={statusText}
					isStreaming={isStreaming}
					queueCount={queueTotal}
					onNewSession={newSession}
					onCompact={compact}
					onExport={exportHtml}
					onExportMarkdown={exportMarkdown}
					onExportJson={exportJson}
					onOpenHelp={() => setHelpOpen(true)}
					onEnableNotifications={requestNotifications}
					notificationPermission={notificationPermission}
					otherTabs={otherTabs}
					onStop={stopRun}
					stopDisabled={stopDisabled}
					sidebarOpen={sidebarOpen}
				/>
				<Transcript
					messages={messages}
					live={live}
					toolResults={toolResults}
					notice={notice}
					onCopyError={toast}
					onNotify={toast}
					onFork={forkAction}
					onRegenerate={regenerateAction}
					isStreaming={isStreaming}
					sessionKey={sessionFile}
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
					isStreaming={isStreaming}
					queueCount={queueTotal}
					contextPercent={contextPercent}
					onStop={() => void stopRun()}
					onCompact={compact}
					stopBusy={abortBusy}
				/>
			</SidebarInset>
			<DialogHost modal={modal} onClose={closeModal} />
			<CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} items={paletteItems} />
			<HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
			<Toaster
				position="bottom-right"
				offset={{ bottom: 180, right: 16 }}
				richColors
				closeButton
			/>
		</SidebarProvider>
	);
}

export default App;
