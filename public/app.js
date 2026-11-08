// pi-gui frontend — RPC bridge client.
// Semua state otoritatif ada di proses pi; file ini hanya cermin + buffer stream.

// Token dibaca dari fragment (#t=) supaya tidak ikut terkirim ke server/Referer.
// Query ?t= tetap diterima untuk kompatibilitas URL lama.
const hashToken = new URLSearchParams(location.hash.replace(/^#/, "")).get("t");
const queryToken = new URLSearchParams(location.search).get("t");
const token = hashToken || queryToken || sessionStorage.getItem("pi-gui-token") || "";
if (token) sessionStorage.setItem("pi-gui-token", token);

const headers = { "content-type": "application/json" };
if (token) headers.authorization = `Bearer ${token}`;

async function api(command) {
	try {
		const res = await fetch("/api/command", {
			method: "POST",
			headers,
			body: JSON.stringify(command),
		});
		const body = await res.json().catch(() => null);
		if (!body) return { success: false, error: `HTTP ${res.status}` };
		return body;
	} catch (error) {
		return { success: false, error: String(error?.message ?? error) };
	}
}

// ------------------------------------------------------------------- dom refs

const $ = (selector) => document.querySelector(selector);
const transcript = $("#transcript");
const input = $("#input");
const queueEl = $("#queue");
const widgetEl = $("#ext-widget");
const statusEl = $("#status");
const statsEl = $("#stats");
const modelSelect = $("#model");
const thinkingSelect = $("#thinking");
const behaviorSelect = $("#behavior");
const cwdInput = $("#cwd");
const toastsEl = $("#toasts");
const attachmentsEl = $("#attachments");
const slashEl = $("#slash");
const sidebar = $("#sidebar");
const sideBody = $("#side-body");
const bannerEl = $("#banner");
const bannerText = $("#banner-text");
const bannerAction = $("#banner-action");

// --------------------------------------------------------------------- utils

async function apiGet(path) {
	try {
		const res = await fetch(path, { headers });
		const body = await res.json().catch(() => null);
		if (!res.ok) return { error: body?.error ?? `HTTP ${res.status}` };
		return body ?? { error: "respons kosong" };
	} catch (error) {
		return { error: String(error?.message ?? error) };
	}
}

function relativeTime(ms) {
	const minutes = Math.round((Date.now() - ms) / 60_000);
	if (minutes < 1) return "baru saja";
	if (minutes < 60) return `${minutes} menit lalu`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours} jam lalu`;
	const days = Math.round(hours / 24);
	if (days < 30) return `${days} hari lalu`;
	return new Date(ms).toLocaleDateString("id-ID");
}

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ESCAPES[c]);

function div(className, text) {
	const node = document.createElement("div");
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}

function pre(text, className = "tool-output") {
	const node = document.createElement("pre");
	node.className = className;
	node.textContent = text;
	return node;
}

function fmtNum(value) {
	if (value === null || value === undefined) return "?";
	if (value < 1000) return String(value);
	if (value < 1_000_000) return `${(value / 1000).toFixed(1)}k`;
	return `${(value / 1_000_000).toFixed(2)}M`;
}

function truncate(text, max) {
	const value = String(text ?? "");
	if (value.length <= max) return value;
	return `${value.slice(0, max)}\n… dipotong (${value.length - max} karakter lagi)`;
}

function contentText(content) {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((block) =>
			block.type === "text" ? block.text : block.type === "image" ? "[gambar]" : "",
		)
		.filter(Boolean)
		.join("\n");
}

// ------------------------------------------------------------- markdown
// marked + highlight.js di-vendor dari paket pi (public/vendor). Konfigurasi
// tokenizer/renderer mengikuti export HTML pi: HTML mentah diperlakukan sebagai
// teks, URL disaring, blok kode di-highlight. `mdFallback` dipakai kalau vendor
// gagal dimuat.

const hasMarked = typeof marked !== "undefined";
const hasHljs = typeof hljs !== "undefined";

function sanitizeMarkdownUrl(value) {
	if (!value) return null;
	const stripped = String(value).replace(/[\u0000-\u001f\u007f]/g, "").trim();
	// Tolak URL protocol-relative dan varian backslash (\\host, //host, /\host).
	// Browser menormalkannya menjadi http(s)://host, jadi ini bukan URL relatif.
	if (/^[\\/]{2}/.test(stripped) || stripped.startsWith("\\")) return null;
	if (/^(https?:|mailto:|data:image\/(?:png|jpe?g|gif|webp);base64,)/i.test(stripped)) return stripped;
	if (/^[a-z][a-z0-9+.-]*:/i.test(stripped)) return null;
	return stripped;
}

if (hasMarked) {
	const strictStrikethrough = /^(~~)(?=[^\s~])((?:\\.|[^\\])*?(?:\\.|[^\s~\\]))\1(?=[^~]|$)/;
	const tokenizer = {
		html() {
			return undefined;
		},
		tag() {
			return undefined;
		},
		del(src) {
			const match = strictStrikethrough.exec(src);
			if (!match) return undefined;
			return {
				type: "del",
				raw: match[0],
				text: match[2],
				tokens: this.lexer.inlineTokens(match[2]),
			};
		},
	};
	if (typeof markedCjkFriendly === "function") {
		tokenizer.emStrong = markedCjkFriendly().tokenizer.emStrong;
	}

	marked.use({
		breaks: true,
		gfm: true,
		tokenizer,
		renderer: {
			link(token) {
				const href = sanitizeMarkdownUrl(token.href);
				if (href === null) return this.parser.parseInline(token.tokens);
				let out = `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer noopener"`;
				if (token.title) out += ` title="${escapeHtml(token.title)}"`;
				return `${out}>${this.parser.parseInline(token.tokens)}</a>`;
			},
			image(token) {
				const href = sanitizeMarkdownUrl(token.href);
				if (href === null) return escapeHtml(token.text || "");
				let out = `<img src="${escapeHtml(href)}" alt="${escapeHtml(token.text || "")}"`;
				if (token.title) out += ` title="${escapeHtml(token.title)}"`;
				return `${out}>`;
			},
			code(token) {
				const code = token.text;
				const lang = token.lang ?? "";
				const highlighted = highlightCode(code, lang);
				return `<pre data-lang="${escapeHtml(lang)}"><code class="hljs">${highlighted}</code></pre>`;
			},
			codespan(token) {
				return `<code>${escapeHtml(token.text)}</code>`;
			},
		},
	});
}

function decorateCodeBlocks(root) {
	for (const pre of root.querySelectorAll("pre")) {
		if (pre.parentElement?.classList.contains("code")) continue;
		const wrap = document.createElement("div");
		wrap.className = "code";
		const head = document.createElement("div");
		head.className = "code-head";
		const label = document.createElement("span");
		label.textContent = pre.dataset.lang || "code";
		const copy = document.createElement("button");
		copy.className = "copy";
		copy.dataset.copy = "";
		copy.textContent = "copy";
		head.append(label, copy);
		pre.replaceWith(wrap);
		wrap.append(head, pre);
	}
}

function inlineMd(text) {
	let out = escapeHtml(text);
	out = out.replace(/`([^`\n]+)`/g, "<code>$1</code>");
	out = out.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
	out = out.replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>");
	out = out.replace(
		/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,
		'<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>',
	);
	return out;
}

function mdFallback(text) {
	const lines = String(text ?? "").split("\n");
	const out = [];
	let i = 0;

	while (i < lines.length) {
		const line = lines[i];

		const fence = line.match(/^\s*```(\S*)\s*$/);
		if (fence) {
			const language = fence[1] || "text";
			const body = [];
			i += 1;
			while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
				body.push(lines[i]);
				i += 1;
			}
			i += 1;
			out.push(
				`<div class="code"><div class="code-head"><span>${escapeHtml(language)}</span>` +
					`<button class="copy" data-copy>copy</button></div>` +
					`<pre><code>${escapeHtml(body.join("\n"))}</code></pre></div>`,
			);
			continue;
		}

		if (/^\s*$/.test(line)) {
			i += 1;
			continue;
		}

		const heading = line.match(/^(#{1,6})\s+(.*)$/);
		if (heading) {
			const level = heading[1].length;
			out.push(`<h${level}>${inlineMd(heading[2])}</h${level}>`);
			i += 1;
			continue;
		}

		if (/^>\s?/.test(line)) {
			const quote = [];
			while (i < lines.length && /^>\s?/.test(lines[i])) {
				quote.push(lines[i].replace(/^>\s?/, ""));
				i += 1;
			}
			out.push(`<blockquote>${mdFallback(quote.join("\n"))}</blockquote>`);
			continue;
		}

		const item = line.match(/^\s*([-*]|\d+\.)\s+(.*)$/);
		if (item) {
			const ordered = /\d/.test(item[1]);
			const items = [];
			while (i < lines.length) {
				const match = lines[i].match(/^\s*([-*]|\d+\.)\s+(.*)$/);
				if (!match) break;
				items.push(`<li>${inlineMd(match[2])}</li>`);
				i += 1;
			}
			out.push(`<${ordered ? "ol" : "ul"}>${items.join("")}</${ordered ? "ol" : "ul"}>`);
			continue;
		}

		const paragraph = [];
		while (
			i < lines.length &&
			!/^\s*$/.test(lines[i]) &&
			!/^\s*```/.test(lines[i]) &&
			!/^#{1,6}\s/.test(lines[i]) &&
			!/^>\s?/.test(lines[i]) &&
			!/^\s*([-*]|\d+\.)\s+/.test(lines[i])
		) {
			paragraph.push(lines[i]);
			i += 1;
		}
		out.push(`<p>${inlineMd(paragraph.join("\n")).replace(/\n/g, "<br>")}</p>`);
	}

	return out.join("\n");
}

// --------------------------------------------------------------------- state

const state = {
	messages: [],
	isStreaming: false,
	pendingCount: 0,
	model: null,
	thinkingLevel: null,
	toolCards: new Map(), // toolCallId -> { card, status, result }
	live: null,
	needsHistoryResync: false,
	baseStatus: "siap",
	extStatus: new Map(),
};

const attachments = [];
let commands = [];
let slashItems = [];
let slashIndex = 0;
let lastSlashQuery = null;
let historyRequest = 0;

// ---------------------------------------------------------------- transcript

function atBottom() {
	return transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 120;
}

function scrollDown(force = false) {
	if (force || atBottom()) transcript.scrollTop = transcript.scrollHeight;
}

function addNode(node) {
	const stick = atBottom();
	transcript.append(node);
	if (stick) scrollDown(true);
}

function addNote(text) {
	addNode(div("note", text));
}

function renderMarkdown(node, source) {
	node.textContent = "";
	if (hasMarked) {
		try {
			node.innerHTML = marked.parse(String(source ?? ""));
		} catch {
			node.textContent = String(source ?? "");
		}
	} else {
		node.innerHTML = mdFallback(source);
	}
	decorateCodeBlocks(node);
}

function mdBlock(text) {
	const node = div("md");
	renderMarkdown(node, text);
	return node;
}

// Cache hasil highlight: blok kode yang sama di-highlight ulang tiap flush
// streaming kalau tidak di-cache.
const highlightCache = new Map();
const HIGHLIGHT_CACHE_LIMIT = 120;
let allowHighlightAuto = true;

function highlightCode(code, lang) {
	if (!hasHljs) return escapeHtml(code);
	const knownLang = Boolean(lang) && Boolean(hljs.getLanguage(lang));
	if (knownLang) {
		const key = `${lang}\u0000${code}`;
		const cached = highlightCache.get(key);
		if (cached !== undefined) {
			highlightCache.delete(key);
			highlightCache.set(key, cached);
			return cached;
		}
		try {
			const value = hljs.highlight(code, { language: lang }).value;
			highlightCache.set(key, value);
			if (highlightCache.size > HIGHLIGHT_CACHE_LIMIT) {
				highlightCache.delete(highlightCache.keys().next().value);
			}
			return value;
		} catch {
			return escapeHtml(code);
		}
	}
	// highlightAuto mahal dan hasilnya berubah tiap delta, jadi hanya dipakai
	// saat render final (bukan saat streaming).
	if (!allowHighlightAuto) return escapeHtml(code);
	try {
		return hljs.highlightAuto(code).value;
	} catch {
		return escapeHtml(code);
	}
}

function thinkingBlock(text) {
	const details = document.createElement("details");
	details.className = "thinking";
	const summary = document.createElement("summary");
	summary.textContent = `thinking (${text.length} char)`;
	details.append(summary, div("think-body", text));
	return details;
}

function imgNode(block) {
	const img = document.createElement("img");
	img.className = "msg-image";
	img.src = `data:${block.mimeType};base64,${block.data}`;
	img.alt = "gambar";
	return img;
}

function contentBlock(content) {
	const wrap = div("content");
	if (typeof content === "string") {
		wrap.append(mdBlock(content));
		return wrap;
	}
	for (const block of content ?? []) {
		if (block.type === "text") wrap.append(mdBlock(block.text));
		else if (block.type === "image") wrap.append(imgNode(block));
	}
	return wrap;
}

function toolSummary(name, args) {
	if (!args || typeof args !== "object") return "";
	if (name === "bash") return args.command ?? "";
	if (typeof args.path === "string") return args.path;
	if (typeof args.pattern === "string") return args.pattern;
	if (typeof args.command === "string") return args.command;
	return Object.keys(args).slice(0, 3).join(", ");
}

function toolCard(call) {
	const card = document.createElement("details");
	card.className = "tool";
	card.dataset.callId = call.id;

	const summary = document.createElement("summary");
	const name = document.createElement("span");
	name.className = "tool-name";
	name.textContent = call.name;
	const arg = document.createElement("code");
	arg.className = "tool-arg";
	arg.textContent = toolSummary(call.name, call.arguments);
	const status = document.createElement("span");
	status.className = "tool-state";
	status.textContent = "…";
	const diffstat = document.createElement("span");
	diffstat.className = "tool-diffstat";
	summary.append(name, arg, diffstat, status);

	const body = div("tool-body");
	body.append(pre(JSON.stringify(call.arguments ?? {}, null, 2), "tool-args"));
	const result = div("tool-result");
	body.append(result);
	card.append(summary, body);

	state.toolCards.set(call.id, { card, status, result, diffstat });
	return card;
}

function diffBlock(diffText) {
	const wrap = div("diff");
	for (const line of String(diffText).split("\n")) {
		const kind = line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : "ctx";
		wrap.append(div(`diff-line ${kind}`, line || " "));
	}
	return wrap;
}

function setToolOutput(entry, text, isError, details) {
	entry.result.textContent = "";
	entry.diffstat.textContent = "";

	const diff = typeof details?.diff === "string" ? details.diff : null;
	if (diff) {
		entry.result.append(diffBlock(diff));
		const lines = diff.split("\n");
		const added = lines.filter((line) => line.startsWith("+")).length;
		const removed = lines.filter((line) => line.startsWith("-")).length;
		const add = document.createElement("span");
		add.className = "add";
		add.textContent = `+${added}`;
		const del = document.createElement("span");
		del.className = "del";
		del.textContent = ` −${removed}`;
		entry.diffstat.append(add, del);
	}

	if (text) {
		if (diff) {
			const raw = document.createElement("details");
			raw.className = "raw-output";
			const rawSummary = document.createElement("summary");
			rawSummary.textContent = "output mentah";
			raw.append(rawSummary, pre(truncate(text, 20_000)));
			entry.result.append(raw);
		} else {
			entry.result.append(pre(truncate(text, 20_000)));
		}
	}

	if (isError) entry.card.classList.add("error");
}

function attachToolResult(message) {
	const entry = state.toolCards.get(message.toolCallId);
	if (!entry) return false;
	setToolOutput(entry, contentText(message.content), message.isError, message.details);
	entry.status.textContent = message.isError ? "gagal" : "selesai";
	return true;
}

function messageNode(message) {
	switch (message.role) {
		case "user": {
			const wrap = div("msg user");
			wrap.append(div("role", "you"), contentBlock(message.content));
			return wrap;
		}
		case "assistant": {
			const wrap = div("msg assistant");
			const body = div("body");
			for (const block of message.content ?? []) {
				if (block.type === "text") body.append(mdBlock(block.text));
				else if (block.type === "thinking") body.append(thinkingBlock(block.thinking));
				else if (block.type === "toolCall") body.append(toolCard(block));
			}
			if (message.errorMessage) body.append(div("error-text", message.errorMessage));
			const meta = div(
				"meta",
				[message.model, message.stopReason === "error" ? "error" : ""].filter(Boolean).join(" · "),
			);
			wrap.append(body, meta);
			return wrap;
		}
		case "toolResult": {
			if (attachToolResult(message)) return null;
			const card = toolCard({ id: message.toolCallId, name: message.toolName, arguments: {} });
			attachToolResult(message);
			return card;
		}
		case "bashExecution": {
			const wrap = div(`msg bash${message.exitCode ? " error" : ""}`);
			wrap.append(div("bash-head", `$ ${message.command}`), pre(message.output || "(tanpa output)"));
			return wrap;
		}
		case "compactionSummary":
			return div("note", `konteks diringkas · ${fmtNum(message.tokensBefore)} token`);
		case "branchSummary":
			return div("note", "ringkasan branch");
		case "custom":
			return message.display ? div("note", contentText(message.content)) : null;
		case "system":
			return null;
		default:
			return null;
	}
}

function renderAll(messages) {
	transcript.textContent = "";
	state.toolCards.clear();
	state.live = null;
	state.messages = [...messages];
	for (const message of messages) {
		if (message.role === "assistant" && message.stopReason === "pending") continue;
		const node = messageNode(message);
		if (node) transcript.append(node);
	}
	scrollDown(true);
}

// ------------------------------------------------------------- live streaming

function startLiveAssistant() {
	if (state.live) return;
	const wrap = div("msg assistant live");
	const body = div("body");
	const indicator = div("thinking-indicator", "thinking…");
	indicator.hidden = true;
	body.append(indicator);
	wrap.append(body);
	addNode(wrap);
	// blocks: contentIndex -> { text, rendered, node }. Tiap blok hidup dalam
	// simpul `.md` sendiri dan di-render progresif (throttled), jadi markdown
	// sudah terformat saat run masih berjalan.
	state.live = { wrap, body, indicator, blocks: new Map(), timer: null };
}

function liveBlock(index) {
	const live = state.live;
	if (!live) return null;
	let block = live.blocks.get(index);
	if (!block) {
		block = { text: "", rendered: null, node: null };
		live.blocks.set(index, block);
	}
	return block;
}

function flushLive({ final = false } = {}) {
	const live = state.live;
	if (!live) return;
	if (live.timer) {
		clearTimeout(live.timer);
		live.timer = null;
	}
	const indexes = [...live.blocks.keys()].sort((a, b) => a - b);
	// Saat streaming, `highlightAuto` dimatikan: mahal dan hasilnya berubah tiap
	// delta. Blok dengan bahasa eksplisit tetap di-highlight (di-cache).
	allowHighlightAuto = final;
	try {
		for (const index of indexes) {
			const block = live.blocks.get(index);
			if (!block.node) {
				block.node = div("md");
				live.body.append(block.node);
			}
			if (block.rendered === block.text) continue;
			block.rendered = block.text;
			renderMarkdown(block.node, block.text);
		}
	} finally {
		allowHighlightAuto = true;
	}
	scrollDown();
}

function scheduleFlush() {
	const live = state.live;
	if (!live || live.timer) return;
	live.timer = setTimeout(() => flushLive(), 80);
}

function stopLive() {
	const live = state.live;
	if (!live) return;
	if (live.timer) clearTimeout(live.timer);
	live.wrap.remove();
	state.live = null;
}

function onAssistantEvent(event) {
	if (!state.live) startLiveAssistant();
	const live = state.live;

	switch (event.type) {
		case "text_start": {
			const block = liveBlock(event.contentIndex);
			if (!block) break;
			block.text = "";
			block.rendered = null;
			break;
		}
		case "text_delta": {
			const block = liveBlock(event.contentIndex);
			if (!block) break;
			block.text += event.delta;
			scheduleFlush();
			break;
		}
		case "text_end": {
			// `content` di text_end otoritatif; render markdown final seketika
			// (dengan highlightAuto) supaya tidak ada “snap” di akhir.
			const block = liveBlock(event.contentIndex);
			if (!block) break;
			block.text = event.content ?? block.text;
			flushLive({ final: true });
			break;
		}
		case "thinking_start":
		case "thinking_delta":
			live.indicator.hidden = false;
			break;
		case "thinking_end":
			live.indicator.hidden = true;
			break;
		case "toolcall_start":
		case "toolcall_end":
			live.indicator.hidden = true;
			break;
		default:
			break;
	}
}

// ------------------------------------------------------------------- messages

function onMessageStart(message) {
	if (message.role === "user") {
		state.messages.push(message);
		addNode(messageNode(message));
	} else if (message.role === "assistant") {
		startLiveAssistant();
	}
}

function onMessageEnd(message) {
	if (message.role === "user") return;

	if (message.role === "assistant") {
		stopLive();
		state.messages.push(message);
		const node = messageNode(message);
		if (node) addNode(node);
		return;
	}

	state.messages.push(message);
	const node = messageNode(message);
	if (node) addNode(node);
}

// --------------------------------------------------------------------- events

function handleEvent(record) {
	switch (record.type) {
		case "hello":
			if (record.error) {
				setStatus("pi gagal");
				showBanner(`Agent pi gagal: ${record.error}`, "nyalakan ulang", restartAgentFromBanner);
			} else if (!record.pid) {
				setStatus("pi berhenti");
				showBanner("Proses pi tidak berjalan.", "nyalakan ulang", restartAgentFromBanner);
			} else {
				hideBanner();
				setStatus(state.isStreaming ? "berjalan" : "siap");
			}
			break;
		case "pi_started":
			hideBanner();
			setStatus("siap");
			break;
		case "pi_error":
			state.isStreaming = false;
			stopLive();
			renderQueue({});
			setStatus("pi gagal");
			showBanner(`Gagal menjalankan pi: ${record.message}`, "nyalakan ulang", restartAgentFromBanner);
			break;
		case "pi_exit":
			state.isStreaming = false;
			stopLive();
			renderQueue({});
			setStatus("pi berhenti");
			showBanner(
				`Proses pi berhenti${record.code !== undefined && record.code !== null ? ` (code=${record.code})` : ""}${record.signal ? ` (signal=${record.signal})` : ""}.`,
				"nyalakan ulang",
				restartAgentFromBanner,
			);
			break;
		case "agent_start":
			state.isStreaming = true;
			setStatus("berjalan");
			break;
		case "agent_end":
			if (record.willRetry) addNote("run berakhir, akan retry…");
			break;
		case "agent_settled":
			state.isStreaming = false;
			stopLive();
			setStatus("siap");
			if (state.needsHistoryResync) {
				state.needsHistoryResync = false;
				void loadHistory();
			}
			refreshStats();
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
		case "tool_execution_start": {
			const entry = state.toolCards.get(record.toolCallId);
			if (entry) entry.status.textContent = "jalan…";
			break;
		}
		case "tool_execution_update": {
			const entry = state.toolCards.get(record.toolCallId);
			if (entry)
				setToolOutput(
					entry,
					contentText(record.partialResult?.content),
					false,
					record.partialResult?.details,
				);
			break;
		}
		case "tool_execution_end": {
			const entry = state.toolCards.get(record.toolCallId);
			if (!entry) break;
			setToolOutput(
				entry,
				contentText(record.result?.content),
				Boolean(record.isError),
				record.result?.details,
			);
			entry.status.textContent = record.isError
				? "gagal"
				: typeof record.durationMs === "number"
					? `${(record.durationMs / 1000).toFixed(1)}s`
					: "selesai";
			break;
		}
		case "queue_update":
			renderQueue(record);
			break;
		case "compaction_start":
			setStatus("compacting");
			addNote(`compaction dimulai (${record.reason})`);
			break;
		case "compaction_end":
			setStatus(state.isStreaming ? "berjalan" : "siap");
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
			state.thinkingLevel = record.level;
			thinkingSelect.value = record.level;
			break;
		case "session_info_changed":
			document.title = record.name ? `${record.name} — pi` : "pi gui";
			scheduleSidebarRefresh();
			break;
		case "extension_ui_request":
			handleUiRequest(record);
			break;
		case "extension_error":
			toast(`extension error: ${record.error}`, "error");
			break;
		default:
			break;
	}
}

function renderQueue({ steering = [], followUp = [], unknown = 0 } = {}) {
	state.pendingCount = steering.length + followUp.length + unknown;
	queueEl.textContent = "";
	for (const text of steering) queueEl.append(div("chip steer", `steer · ${truncate(text, 90)}`));
	for (const text of followUp) queueEl.append(div("chip", `follow-up · ${truncate(text, 90)}`));
	// `get_state` hanya memberi jumlah, bukan isi queue (mis. sesudah reload
	// atau SSE putus). Tampilkan placeholder daripada chip lama yang mungkin basi.
	if (unknown > 0) queueEl.append(div("chip", `${unknown} pesan di queue`));
}

// ---------------------------------------------------------------- status bar

function renderStatus() {
	const extras = [...state.extStatus.values()];
	statusEl.textContent = [state.baseStatus, ...extras].filter(Boolean).join(" · ");
}

function setStatus(text) {
	state.baseStatus = text;
	renderStatus();
}

function setExtStatus(key, text) {
	if (text) state.extStatus.set(key, text);
	else state.extStatus.delete(key);
	renderStatus();
}

function setExtWidget(key, lines) {
	if (!Array.isArray(lines) || lines.length === 0) {
		widgetEl.textContent = "";
		return;
	}
	widgetEl.textContent = "";
	for (const line of lines) widgetEl.append(pre(line, "widget-line"));
}

function toast(message, type = "info") {
	if (!message) return;
	const node = div(`toast ${type}`, String(message));
	toastsEl.append(node);
	setTimeout(() => node.remove(), 6000);
}

let bannerHandler = null;

function showBanner(message, actionLabel, handler) {
	if (!bannerEl) return;
	bannerText.textContent = message;
	bannerAction.textContent = actionLabel ?? "";
	bannerAction.hidden = !actionLabel;
	bannerHandler = handler ?? null;
	bannerEl.classList.remove("hidden");
}

function hideBanner() {
	if (!bannerEl) return;
	bannerEl.classList.add("hidden");
	bannerHandler = null;
}

if (bannerEl) {
	bannerAction.onclick = () => bannerHandler?.();
	$("#banner-close").onclick = hideBanner;
}

// ------------------------------------------------------------------ modal UI

function modal({ title, body, buttons }) {
	return new Promise((resolve) => {
		const root = $("#modal");
		const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		root.textContent = "";
		root.classList.remove("hidden");
		root.setAttribute("role", "dialog");
		root.setAttribute("aria-modal", "true");
		root.setAttribute("aria-label", title || "dialog");

		const box = div("modal-box");
		box.append(div("modal-title", title ?? ""));
		if (body) box.append(body);

		const row = div("modal-actions");
		for (const spec of buttons) {
			const button = document.createElement("button");
			button.textContent = spec.label;
			if (spec.variant) button.className = spec.variant;
			button.onclick = () => finish(typeof spec.value === "function" ? spec.value() : spec.value);
			row.append(button);
		}
		box.append(row);
		root.append(box);
		box.querySelector("input, textarea, button")?.focus();

		const focusables = () =>
			[...root.querySelectorAll("input, textarea, select, button, [href], [tabindex]:not([tabindex='-1'])")]
				.filter((node) => !node.disabled);

		const onKey = (event) => {
			if (event.key === "Escape") {
				event.preventDefault();
				finish(undefined);
				return;
			}
			if (event.key !== "Tab") return;
			const nodes = focusables();
			if (nodes.length === 0) return;
			const first = nodes[0];
			const last = nodes[nodes.length - 1];
			if (!root.contains(document.activeElement)) {
				event.preventDefault();
				first.focus();
				return;
			}
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus();
			}
		};
		document.addEventListener("keydown", onKey);

		function finish(value) {
			document.removeEventListener("keydown", onKey);
			root.classList.add("hidden");
			root.textContent = "";
			root.removeAttribute("role");
			root.removeAttribute("aria-modal");
			root.removeAttribute("aria-label");
			resolve(value);
			previousFocus?.focus?.();
		}
	});
}

function promptModal({ title, value = "", placeholder = "", okLabel = "simpan" }) {
	const field = document.createElement("input");
	field.type = "text";
	field.value = value;
	field.placeholder = placeholder;
	field.spellcheck = false;
	field.className = "modal-input";
	field.setAttribute("aria-label", title || "nama");

	const body = div("modal-field");
	body.append(field);

	field.addEventListener("keydown", (event) => {
		if (event.key !== "Enter") return;
		event.preventDefault();
		document.querySelector("#modal .modal-actions .primary")?.click();
	});

	const result = modal({
		title,
		body,
		buttons: [
			{ label: okLabel, value: () => field.value.trim(), variant: "primary" },
			{ label: "batal", value: undefined, variant: "ghost" },
		],
	});
	field.focus();
	field.select();
	return result;
}

function respondUi(request, payload) {
	return api({ type: "extension_ui_response", id: request.id, ...payload });
}

const consumingUiRequests = new Set();

async function handleUiRequest(request) {
	if (!request?.id) return handleUiRequestInner(request);
	if (consumingUiRequests.has(request.id)) return;
	consumingUiRequests.add(request.id);
	try {
		await handleUiRequestInner(request);
	} finally {
		consumingUiRequests.delete(request.id);
	}
}

async function handleUiRequestInner(request) {
	switch (request.method) {
		case "notify":
			toast(request.message, request.notifyType);
			return;
		case "setStatus":
			setExtStatus(request.statusKey, request.statusText);
			return;
		case "setWidget":
			setExtWidget(request.widgetKey, request.widgetLines);
			return;
		case "setTitle":
			if (request.title) document.title = request.title;
			return;
		case "set_editor_text":
			input.value = request.text ?? "";
			autosize();
			return;
		case "select": {
			const value = await modal({
				title: request.title,
				buttons: [
					...(request.options ?? []).map((option) => ({ label: option, value: option })),
					{ label: "batal", value: undefined, variant: "ghost" },
				],
			});
			return respondUi(request, value === undefined ? { cancelled: true } : { value });
		}
		case "confirm": {
			const confirmed = await modal({
				title: request.title,
				body: request.message ? div("modal-message", request.message) : null,
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
			const field = document.createElement("input");
			field.className = "modal-input";
			field.placeholder = request.placeholder ?? "";
			const body = div("modal-field");
			body.append(field);
			const value = await modal({
				title: request.title,
				body,
				buttons: [
					{ label: "ok", value: () => field.value, variant: "primary" },
					{ label: "batal", value: undefined },
				],
			});
			return respondUi(request, value === undefined ? { cancelled: true } : { value });
		}
		case "editor": {
			const field = document.createElement("textarea");
			field.className = "modal-input";
			field.rows = 12;
			field.value = request.prefill ?? "";
			const body = div("modal-field");
			body.append(field);
			const value = await modal({
				title: request.title,
				body,
				buttons: [
					{ label: "ok", value: () => field.value, variant: "primary" },
					{ label: "batal", value: undefined },
				],
			});
			return respondUi(request, value === undefined ? { cancelled: true } : { value });
		}
		default:
			return;
	}
}

// --------------------------------------------------------------- agent state

async function refreshState() {
	const response = await api({ type: "get_state" });
	if (!response.success) {
		toast(response.error ?? "get_state gagal", "error");
		return null;
	}
	const session = response.data;
	state.isStreaming = Boolean(session.isStreaming);
	const queued = session.pendingMessageCount ?? 0;
	// Isi queue tidak bisa dibaca ulang dari pi; kalau jumlahnya beda dengan
	// yang tampil di layar, buang chip lama dan ganti placeholder yang jujur.
	if (queued !== state.pendingCount) renderQueue(queued > 0 ? { unknown: queued } : {});
	state.pendingCount = queued;
	state.model = session.model ?? null;
	state.thinkingLevel = session.thinkingLevel ?? null;
	setStatus(state.isStreaming ? "berjalan" : "siap");
	if (session.model) modelSelect.value = `${session.model.provider}/${session.model.id}`;
	if (session.thinkingLevel) thinkingSelect.value = session.thinkingLevel;
	document.title = session.sessionName ? `${session.sessionName} — pi` : "pi gui";
	return session;
}

async function refreshModels() {
	const response = await api({ type: "get_available_models" });
	if (!response.success) return;
	const models = response.data.models ?? [];
	modelSelect.textContent = "";
	for (const model of models) {
		const option = document.createElement("option");
		option.value = `${model.provider}/${model.id}`;
		option.textContent = `${model.provider}/${model.id}`;
		modelSelect.append(option);
	}
	if (state.model) modelSelect.value = `${state.model.provider}/${state.model.id}`;
}

async function refreshThinkingLevels() {
	const response = await api({ type: "get_available_thinking_levels" });
	if (!response.success) return;
	const levels = response.data.levels ?? ["off"];
	thinkingSelect.textContent = "";
	for (const level of levels) {
		const option = document.createElement("option");
		option.value = level;
		option.textContent = level;
		thinkingSelect.append(option);
	}
	if (state.thinkingLevel) thinkingSelect.value = state.thinkingLevel;
}

async function refreshStats() {
	const response = await api({ type: "get_session_stats" });
	if (!response.success) return;
	const stats = response.data;
	const parts = [];
	if (stats.contextUsage) {
		parts.push(
			`ctx ${fmtNum(stats.contextUsage.tokens)}/${fmtNum(stats.contextUsage.contextWindow)} ` +
				`(${Math.round(stats.contextUsage.percent ?? 0)}%)`,
		);
	}
	parts.push(`$${(stats.cost ?? 0).toFixed(3)}`, `${stats.toolCalls ?? 0} tool`);
	statsEl.textContent = parts.join(" · ");
}

async function loadHistory({ allowStreaming = false } = {}) {
	const request = ++historyRequest;
	const response = await api({ type: "get_messages" });
	if (!response.success || request !== historyRequest) return;
	if (state.isStreaming && !allowStreaming) return;
	renderAll(response.data.messages ?? []);
}

// ------------------------------------------------------------------ commands

function autosize() {
	input.style.height = "auto";
	input.style.height = `${Math.min(input.scrollHeight, 320)}px`;
}

// --------------------------------------------------------------- attachments

function renderAttachments() {
	attachmentsEl.textContent = "";
	attachments.forEach((item, index) => {
		const box = div("attachment");
		const image = document.createElement("img");
		image.src = item.preview;
		image.alt = item.mimeType;
		const remove = document.createElement("button");
		remove.textContent = "✕";
		remove.title = "Hapus gambar";
		remove.onclick = () => {
			attachments.splice(index, 1);
			renderAttachments();
		};
		box.append(image, remove);
		attachmentsEl.append(box);
	});
}

function readAsDataUrl(file) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () => reject(reader.error ?? new Error("gagal baca file"));
		reader.readAsDataURL(file);
	});
}

async function addImageFiles(files) {
	for (const file of files) {
		if (!file.type.startsWith("image/")) continue;
		const dataUrl = await readAsDataUrl(file).catch(() => null);
		if (!dataUrl) continue;
		const comma = dataUrl.indexOf(",");
		if (comma < 0) continue;
		attachments.push({
			type: "image",
			data: dataUrl.slice(comma + 1),
			mimeType: file.type || "image/png",
			preview: dataUrl,
		});
	}
	renderAttachments();
}

// ------------------------------------------------------------- slash command

function hideSlash() {
	slashItems = [];
	lastSlashQuery = null;
	slashEl.classList.add("hidden");
	slashEl.textContent = "";
}

function renderSlash() {
	slashEl.textContent = "";
	slashEl.classList.remove("hidden");
	slashItems.forEach((command, index) => {
		const item = div(`slash-item${index === slashIndex ? " active" : ""}`);
		item.append(
			div("cmd", `/${command.name}`),
			div("desc", command.description ?? ""),
			div("src", command.source ?? ""),
		);
		item.onclick = () => applySlash(command);
		slashEl.append(item);
	});
}

function applySlash(command) {
	input.value = `/${command.name} `;
	hideSlash();
	autosize();
	input.focus();
}

function updateSlash() {
	const match = /^\/(\S*)$/.exec(input.value);
	if (!match) return hideSlash();
	const query = match[1].toLowerCase();
	if (query !== lastSlashQuery) {
		slashIndex = 0;
		lastSlashQuery = query;
	}
	slashItems = commands
		.filter((command) => command.name.toLowerCase().includes(query))
		.slice(0, 8);
	if (slashItems.length === 0) return hideSlash();
	slashIndex = Math.min(slashIndex, slashItems.length - 1);
	renderSlash();
}

async function refreshCommands() {
	const response = await api({ type: "get_commands" });
	if (!response.success) return;
	commands = response.data.commands ?? [];
}

async function submit() {
	const message = input.value.trim();
	if (!message && attachments.length === 0) return;

	const images = attachments.map(({ type, data, mimeType }) => ({ type, data, mimeType }));

	input.value = "";
	attachments.splice(0, attachments.length);
	renderAttachments();
	hideSlash();
	autosize();

	const command = { type: "prompt", message };
	if (images.length > 0) command.images = images;
	if (state.isStreaming) command.streamingBehavior = behaviorSelect.value;

	const response = await api(command);
	if (!response.success) {
		input.value = message;
		if (images.length > 0) {
			attachments.push(...images.map((image) => ({ ...image, preview: `data:${image.mimeType};base64,${image.data}` })));
			renderAttachments();
		}
		autosize();
		toast(response.error ?? "prompt ditolak", "error");
		return;
	}
	if (response.data?.disposition === "queued") toast("pesan di-queue");
}

let stopInFlight = false;

async function stopRun() {
	if (stopInFlight) return;
	stopInFlight = true;
	const abortButton = $("#abort");
	const wasDisabled = abortButton?.disabled ?? false;
	if (abortButton) abortButton.disabled = true;
	try {
		let restored = 0;
		const cleared = await api({ type: "clear_queue" });
		if (cleared.success) {
			const texts = [...(cleared.data?.steering ?? []), ...(cleared.data?.followUp ?? [])];
			if (texts.length > 0) {
				input.value = [input.value.trim(), ...texts].filter(Boolean).join("\n\n");
				autosize();
				input.focus();
				restored = texts.length;
			}
			renderQueue({});
		}

		const aborted = await api({ type: "abort" });
		if (!aborted.success) toast(aborted.error ?? "abort gagal", "error");
		else if (restored > 0) toast(`${restored} pesan queue dikembalikan ke editor`);
	} finally {
		stopInFlight = false;
		if (abortButton) abortButton.disabled = wasDisabled;
	}
}

function resetSessionUi() {
	stopLive();
	hideSlash();
	historyRequest += 1;
	state.isStreaming = false;
	state.needsHistoryResync = false;
	state.pendingCount = 0;
	state.messages = [];
	state.toolCards.clear();
	state.extStatus.clear();
	transcript.textContent = "";
	queueEl.textContent = "";
	widgetEl.textContent = "";
	statsEl.textContent = "";
	document.title = "pi gui";
	setStatus("siap");
}

function restartAgentFromBanner() {
	const next = cwdInput.value.trim();
	if (!next) return toast("workspace kosong", "error");
	void restart(next);
}

async function restart(cwd) {
	let res;
	try {
		res = await fetch("/api/restart", {
			method: "POST",
			headers,
			body: JSON.stringify({ cwd }),
		});
	} catch (error) {
		toast(`gagal menghubungi server: ${error?.message ?? error}`, "error");
		return;
	}
	const body = await res.json().catch(() => null);
	if (!res.ok) {
		toast(body?.error ?? "gagal pindah workspace", "error");
		return;
	}
	resetSessionUi();
	hideBanner();
	cwdInput.value = body.cwd ?? cwd;
	await refreshState();
	await refreshModels();
	await refreshThinkingLevels();
	await loadHistory();
	await refreshStats();
	await refreshSidebar();
}

// -------------------------------------------------------------------- events

let eventsOpened = false;
let eventsController = null;
let reconnectTimer = null;
let reconnectAttempt = 0;

function handleSseBlock(block) {
	const data = block
		.split("\n")
		.filter((line) => line.startsWith("data:"))
		.map((line) => line.slice(5).replace(/^ /, ""))
		.join("\n");
	if (!data) return;
	try {
		handleEvent(JSON.parse(data));
	} catch {
		/* record rusak, abaikan */
	}
}

function scheduleReconnect() {
	if (reconnectTimer) return;
	const delay = Math.min(8000, 500 * 2 ** reconnectAttempt) + Math.floor(Math.random() * 250);
	reconnectAttempt = Math.min(reconnectAttempt + 1, 5);
	reconnectTimer = setTimeout(() => {
		reconnectTimer = null;
		connectEvents();
	}, delay);
}

function connectEvents() {
	if (eventsController) eventsController.abort();
	if (reconnectTimer) {
		clearTimeout(reconnectTimer);
		reconnectTimer = null;
	}

	const controller = new AbortController();
	eventsController = controller;
	setStatus("menyambung…");

	(async () => {
		try {
			const res = await fetch("/api/events", {
				headers: { ...headers, accept: "text/event-stream" },
				signal: controller.signal,
				cache: "no-store",
			});

			if (res.status === 401) {
				await res.body?.cancel().catch(() => {});
				setStatus("token ditolak");
				showBanner(
					"Token ditolak server. Buka URL terbaru dari terminal, lalu muat ulang halaman.",
					"muat ulang",
					() => location.reload(),
				);
				return;
			}
			if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

			reconnectAttempt = 0;
			if (eventsOpened) {
				// Setelah putus, sinkronkan state otoritatif pi. Kalau run masih
				// berjalan, jangan render ulang history: itu akan menghapus prefix
				// live yang tidak bisa direkonstruksi dari event delta. Resync penuh
				// dilakukan saat agent_settled.
				const session = await refreshState();
				if (session?.isStreaming) {
					state.needsHistoryResync = true;
				} else if (session) {
					state.needsHistoryResync = false;
					await loadHistory();
				}
				await refreshStats();
				await refreshCommands();
				setStatus(session ? (state.isStreaming ? "berjalan" : "siap") : "tidak tersambung");
			} else {
				eventsOpened = true;
				setStatus(state.isStreaming ? "berjalan" : "siap");
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
			if (controller.signal.aborted) return;
			setStatus("menyambung ulang…");
			scheduleReconnect();
		}
	})();
}

// --------------------------------------------------------------- sidebar

let sideTab = "sessions";
let sidebarTimer = null;

function scheduleSidebarRefresh(delay = 400) {
	if (sidebar.classList.contains("hidden")) return;
	if (sidebarTimer) clearTimeout(sidebarTimer);
	sidebarTimer = setTimeout(() => {
		sidebarTimer = null;
		// Jangan rebuild DOM di tengah drag: target drop akan hilang.
		if (draggingSession) return scheduleSidebarRefresh(delay);
		refreshSidebar();
	}, delay);
}

function refreshSidebar() {
	if (sidebar.classList.contains("hidden")) return;
	if (draggingSession) return;
	return sideTab === "tree" ? loadTree() : loadSessions();
}

function setSideTab(tab) {
	sideTab = tab;
	for (const button of document.querySelectorAll(".side-tab")) {
		button.classList.toggle("active", button.dataset.tab === tab);
	}
	refreshSidebar();
}

let sidebarRequest = 0;

// -------------------------------------------------------------------- proyek
// Proyek hanya metadata GUI (server menyimpannya di ~/.pi/pi-gui/projects.json).
// Sesi tetap file .jsonl milik pi; memindahkan sesi = mengubah assignment.

const COLLAPSE_KEY = "pi-gui-collapsed-projects";
let projects = [];
let assignments = {};
let sessionsDir = null;
let draggingSession = null;
let collapsedProjects = loadCollapsedProjects();

function loadCollapsedProjects() {
	try {
		const raw = JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? "[]");
		return new Set(Array.isArray(raw) ? raw.filter((item) => typeof item === "string") : []);
	} catch {
		return new Set();
	}
}

function saveCollapsedProjects() {
	try {
		localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...collapsedProjects]));
	} catch {
		/* localStorage diblokir/penuh */
	}
}

function projectName(projectId) {
	return projects.find((project) => project.id === projectId)?.name ?? "proyek";
}

async function projectRequest(body) {
	let response;
	try {
		response = await fetch("/api/projects", {
			method: "POST",
			headers,
			body: JSON.stringify(body),
		});
	} catch (error) {
		toast(`gagal menghubungi server: ${error?.message ?? error}`, "error");
		return null;
	}
	const data = await response.json().catch(() => null);
	if (!response.ok) {
		toast(data?.error ?? "operasi proyek gagal", "error");
		return null;
	}
	projects = Array.isArray(data?.projects) ? data.projects : projects;
	assignments = data?.assignments && typeof data.assignments === "object" ? data.assignments : assignments;
	return data;
}

function bindDropTarget(group, projectId) {
	group.addEventListener("dragover", (event) => {
		if (!draggingSession) return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
		group.classList.add("drop-target");
	});
	group.addEventListener("dragleave", (event) => {
		if (group.contains(event.relatedTarget)) return;
		group.classList.remove("drop-target");
	});
	group.addEventListener("drop", (event) => {
		if (!draggingSession) return;
		event.preventDefault();
		group.classList.remove("drop-target");
		const sessionPath = draggingSession;
		draggingSession = null;
		void assignSession(sessionPath, projectId);
	});
}

async function assignSession(sessionPath, projectId) {
	if ((assignments[sessionPath] ?? null) === (projectId ?? null)) return;
	const label = projectId ? projectName(projectId) : "tanpa proyek";
	if (!(await projectRequest({ action: "assign", sessionPath, projectId }))) return;
	await refreshSidebar();
	toast(`sesi dipindah ke ${label}`);
}

async function createProject() {
	const name = await promptModal({
		title: "Proyek baru",
		placeholder: "mis. refactor auth",
		okLabel: "buat",
	});
	if (!name) return;
	if (!(await projectRequest({ action: "create", name, dir: sessionsDir }))) return;
	await refreshSidebar();
	toast(`proyek “${name}” dibuat`);
}

async function renameProject(project) {
	const name = await promptModal({
		title: "Ganti nama proyek",
		value: project.name,
		okLabel: "simpan",
	});
	if (!name) return;
	if (!(await projectRequest({ action: "rename", projectId: project.id, name }))) return;
	await refreshSidebar();
}

async function deleteProject(project) {
	const count = Object.values(assignments).filter((id) => id === project.id).length;
	const confirmed = await modal({
		title: "Hapus proyek?",
		body: div(
			"modal-message",
			`Proyek “${project.name}” dihapus. ${count > 0 ? `${count} sesi kembali ke “tanpa proyek”. ` : ""}File sesi tidak dihapus.`,
		),
		buttons: [
			{ label: "hapus proyek", value: true, variant: "danger" },
			{ label: "batal", value: false, variant: "ghost" },
		],
	});
	if (!confirmed) return;
	if (!(await projectRequest({ action: "delete", projectId: project.id }))) return;
	await refreshSidebar();
	toast("proyek dihapus (sesi tetap ada)");
}

function toggleProjectCollapsed(key) {
	if (collapsedProjects.has(key)) collapsedProjects.delete(key);
	else collapsedProjects.add(key);
	saveCollapsedProjects();
	const collapsed = collapsedProjects.has(key);
	for (const group of sideBody.querySelectorAll(".project")) {
		if (group.dataset.projectKey !== key) continue;
		group.classList.toggle("collapsed", collapsed);
		const toggle = group.querySelector(".project-toggle");
		if (!toggle) continue;
		toggle.textContent = collapsed ? "▸" : "▾";
		toggle.setAttribute("aria-expanded", String(!collapsed));
	}
}

function sessionRow(session) {
	const row = div("session-row");
	row.dataset.path = session.path ?? "";

	if (session.path) {
		row.draggable = true;
		row.addEventListener("dragstart", (event) => {
			draggingSession = session.path;
			row.classList.add("dragging");
			if (event.dataTransfer) {
				event.dataTransfer.effectAllowed = "move";
				event.dataTransfer.setData("text/plain", session.path);
			}
		});
		row.addEventListener("dragend", () => {
			draggingSession = null;
			row.classList.remove("dragging");
			for (const target of sideBody.querySelectorAll(".drop-target")) {
				target.classList.remove("drop-target");
			}
		});
	}

	const grip = document.createElement("span");
	grip.className = "drag-grip";
	grip.textContent = "⠿";
	grip.title = "Tarik ke proyek lain";
	grip.setAttribute("aria-hidden", "true");

	const item = document.createElement("button");
	item.className = `session-item${session.current ? " current" : ""}`;
	item.title = session.path;

	const preview = div("s-preview", session.name || session.preview || "(kosong)");
	const meta = div("s-meta");
	meta.textContent = `${relativeTime(session.mtime)} · ${session.id.slice(0, 8)}`;
	if (session.parentSession) {
		const fork = document.createElement("span");
		fork.className = "fork";
		fork.textContent = " · fork";
		meta.append(fork);
	}

	item.append(preview, meta);
	item.onclick = () => switchSession(session);
	row.append(grip, item);

	if (!session.current) {
		const remove = document.createElement("button");
		remove.className = "session-delete";
		remove.title = "Hapus sesi";
		remove.draggable = false;
		remove.setAttribute("aria-label", `Hapus sesi ${session.name || session.preview || session.id}`);
		remove.textContent = "×";
		remove.onclick = (event) => {
			event.stopPropagation();
			void deleteSession(session);
		};
		row.append(remove);
	}

	return row;
}

function projectGroup(project, sessions) {
	const key = project?.id ?? "__none__";
	const collapsed = collapsedProjects.has(key);
	const group = div(`project${project ? "" : " loose"}${collapsed ? " collapsed" : ""}`);
	group.dataset.projectKey = key;

	const head = div("project-head");
	const toggle = document.createElement("button");
	toggle.className = "project-toggle";
	toggle.textContent = collapsed ? "▸" : "▾";
	toggle.title = collapsed ? "Buka grup" : "Tutup grup";
	toggle.setAttribute("aria-expanded", String(!collapsed));
	toggle.onclick = (event) => {
		event.stopPropagation();
		toggleProjectCollapsed(key);
	};

	const name = div("project-name", project ? project.name : "tanpa proyek");
	name.title = project
		? `${project.name} — tarik sesi ke sini untuk memindahkan`
		: "Sesi yang belum masuk proyek (tarik ke sini untuk melepas)";
	head.append(toggle, name, div("project-count", String(sessions.length)));

	if (project) {
		const rename = document.createElement("button");
		rename.className = "project-action";
		rename.textContent = "✎";
		rename.title = "Ganti nama proyek";
		rename.setAttribute("aria-label", `Ganti nama proyek ${project.name}`);
		rename.onclick = (event) => {
			event.stopPropagation();
			void renameProject(project);
		};
		const remove = document.createElement("button");
		remove.className = "project-action danger";
		remove.textContent = "×";
		remove.title = "Hapus proyek (sesi tidak dihapus)";
		remove.setAttribute("aria-label", `Hapus proyek ${project.name}`);
		remove.onclick = (event) => {
			event.stopPropagation();
			void deleteProject(project);
		};
		head.append(rename, remove);
	}

	const body = div("project-body");
	body.id = `project-body-${key}`;
	body.setAttribute("role", "group");
	toggle.setAttribute("aria-controls", body.id);
	for (const session of sessions) body.append(sessionRow(session));
	if (sessions.length === 0) body.append(div("project-empty", "tarik sesi ke sini"));

	group.append(head, body);
	bindDropTarget(group, project?.id ?? null);
	return group;
}

async function loadSessions() {
	const request = ++sidebarRequest;
	sideBody.textContent = "";
	sideBody.append(div("side-empty", "memuat…"));

	const [data, projectData] = await Promise.all([
		apiGet("/api/sessions"),
		apiGet("/api/projects"),
	]);
	if (request !== sidebarRequest) return;
	sideBody.textContent = "";

	if (data.error) {
		sideBody.append(div("side-empty", data.error));
		return;
	}

	projects = Array.isArray(projectData.projects) ? projectData.projects : [];
	assignments =
		projectData.assignments && typeof projectData.assignments === "object"
			? projectData.assignments
			: {};
	sessionsDir = data.dir ?? sessionsDir;

	const sessions = data.sessions ?? [];

	// Fork / sesi baru belum menulis file sampai pesan pertama.
	if (data.sessionFile && !sessions.some((session) => session.current)) {
		sessions.unshift({
			path: data.sessionFile,
			id: "baru",
			name: data.sessionName ?? null,
			preview: "(sesi aktif, belum tersimpan)",
			mtime: Date.now(),
			current: true,
		});
	}

	// Proyek di-scope ke folder sesi workspace aktif (proyek lama tanpa dir
	// tetap tampil di mana saja).
	const visibleProjects = projects.filter(
		(project) => !project.dir || !sessionsDir || project.dir === sessionsDir,
	);

	if (sessions.length === 0 && visibleProjects.length === 0) {
		sideBody.append(
			div("side-empty", data.dir ? "belum ada sesi di workspace ini" : "sesi tidak persisten"),
		);
		return;
	}

	if (visibleProjects.length === 0) {
		for (const session of sessions) sideBody.append(sessionRow(session));
		return;
	}

	const byProject = new Map(visibleProjects.map((project) => [project.id, []]));
	const loose = [];
	for (const session of sessions) {
		const projectId = assignments[session.path];
		if (projectId && byProject.has(projectId)) byProject.get(projectId).push(session);
		else loose.push(session);
	}

	for (const project of visibleProjects) {
		sideBody.append(projectGroup(project, byProject.get(project.id)));
	}
	sideBody.append(projectGroup(null, loose));
}

async function deleteSession(session) {
	if (session.current) return toast("Sesi aktif tidak bisa dihapus; buat sesi baru dulu", "error");
	if (!session.path) return toast("Sesi ini belum punya file", "error");

	const label = session.name || session.preview || session.id || "tanpa nama";
	const confirmed = await modal({
		title: "Hapus sesi?",
		body: div("modal-message", `Sesi “${label}” akan dihapus permanen dari disk.`),
		buttons: [
			{ label: "hapus", value: true, variant: "danger" },
			{ label: "batal", value: false, variant: "ghost" },
		],
	});
	if (!confirmed) return;

	let response;
	try {
		response = await fetch("/api/sessions/delete", {
			method: "POST",
			headers,
			body: JSON.stringify({ path: session.path }),
		});
	} catch (error) {
		return toast(`gagal menghapus sesi: ${error?.message ?? error}`, "error");
	}
	const body = await response.json().catch(() => null);
	if (!response.ok) return toast(body?.error ?? "gagal menghapus sesi", "error");

	toast("sesi dihapus");
	await refreshSidebar();
}

async function switchSession(session) {
	if (session.current) return;
	const response = await api({ type: "switch_session", sessionPath: session.path });
	if (!response.success) return toast(response.error ?? "gagal switch sesi", "error");
	if (response.data?.cancelled) return toast("switch dibatalkan extension");
	await afterSessionChange();
}

async function afterSessionChange() {
	resetSessionUi();
	await refreshState();
	await loadHistory({ allowStreaming: true });
	await refreshStats();
	await refreshCommands();
	await refreshSidebar();
}

async function loadTree() {
	const request = ++sidebarRequest;
	sideBody.textContent = "";
	sideBody.append(div("side-empty", "memuat…"));

	const response = await api({ type: "get_tree" });
	if (request !== sidebarRequest) return;
	sideBody.textContent = "";

	if (!response.success) {
		sideBody.append(div("side-empty", response.error ?? "get_tree gagal"));
		return;
	}

	const flat = [];
	const walk = (nodes, depth) => {
		for (const node of nodes) {
			flat.push({ node, depth });
			walk(node.children ?? [], depth + 1);
		}
	};
	walk(response.data.tree ?? [], 0);

	const byId = new Map(flat.map(({ node }) => [node.entry.id, node]));
	const active = new Set();
	const guard = new Set();
	let cursor = response.data.leafId;
	while (cursor && byId.has(cursor) && !guard.has(cursor)) {
		guard.add(cursor);
		active.add(cursor);
		cursor = byId.get(cursor).entry.parentId;
	}

	let shown = 0;
	for (const { node, depth } of flat) {
		const row = treeRow(node, depth, active.has(node.entry.id));
		if (!row) continue;
		sideBody.append(row);
		shown += 1;
	}
	if (shown === 0) sideBody.append(div("side-empty", "tree kosong"));
}

function treeRow(node, depth, isActive) {
	const entry = node.entry;
	if (entry.type === "usage" || entry.type === "label" || entry.type === "session_info") return null;
	if (entry.type === "context_edit") return null;

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

	const row = div(
		`tree-node${isActive ? " active" : ""}${forkable ? " forkable" : ""}` +
			(role === "tool" ? " muted" : ""),
	);
	row.style.paddingLeft = `${6 + depth * 12}px`;
	row.append(div("t-role", node.label ? `${role}*` : role), div("t-text", text || "(kosong)"));
	if (forkable) {
		row.title = "Klik untuk fork dari pesan ini";
		row.onclick = () => forkFrom(entry.id, text);
	}
	return row;
}

async function forkFrom(entryId, text) {
	const confirmed = await modal({
		title: "Fork dari pesan ini?",
		body: div("modal-message", truncate(text, 300)),
		buttons: [
			{ label: "fork", value: true, variant: "primary" },
			{ label: "batal", value: false },
		],
	});
	if (!confirmed) return;

	const response = await api({ type: "fork", entryId });
	if (!response.success) return toast(response.error ?? "fork gagal", "error");
	if (response.data?.cancelled) return toast("fork dibatalkan extension");

	// Pi mengembalikan teks pesan yang di-fork agar klien bisa mengisinya ke editor.
	const forkedText = response.data?.text ?? "";
	await afterSessionChange();
	if (forkedText) {
		input.value = forkedText;
		autosize();
		input.focus();
	}
	toast("fork dibuat — pesan asli ada di editor");
}

async function cloneSession() {
	const response = await api({ type: "clone" });
	if (!response.success) return toast(response.error ?? "clone gagal", "error");
	if (response.data?.cancelled) return toast("clone dibatalkan extension");
	await afterSessionChange();
	toast("clone dibuat");
}

async function renameSession() {
	const current = await api({ type: "get_state" });
	if (!current.success) return toast(current.error ?? "get_state gagal", "error");
	const name = await promptModal({
		title: "Nama sesi aktif",
		value: current.data?.sessionName ?? "",
		placeholder: "mis. refactor auth",
		okLabel: "simpan",
	});
	if (name === undefined) return;

	const response = await api({ type: "set_session_name", name });
	if (!response.success) return toast(response.error ?? "gagal menyimpan nama", "error");
	document.title = name ? `${name} — pi` : "pi gui";
	const currentPreview = sideBody.querySelector(".session-item.current .s-preview");
	if (currentPreview) currentPreview.textContent = name || "(kosong)";
	toast(name ? "nama sesi disimpan" : "nama sesi dihapus");
	await refreshSidebar();
}

// ---------------------------------------------------------------------- wiring

$("#send").onclick = submit;
$("#abort").onclick = () => stopRun();

$("#sidebar-toggle").onclick = () => {
	sidebar.classList.toggle("hidden");
	refreshSidebar();
};
$("#sidebar-close").onclick = () => sidebar.classList.add("hidden");
const sideRefresh = $("#side-refresh");
if (sideRefresh) sideRefresh.onclick = () => refreshSidebar();
const sideNewProject = $("#side-new-project");
if (sideNewProject) sideNewProject.onclick = () => createProject();
$("#side-clone").onclick = () => cloneSession();
$("#side-rename").onclick = () => renameSession();
for (const button of document.querySelectorAll(".side-tab")) {
	button.onclick = () => setSideTab(button.dataset.tab);
}

$("#new-session").onclick = async () => {
	const response = await api({ type: "new_session" });
	if (!response.success) return toast(response.error ?? "gagal sesi baru", "error");
	if (response.data?.cancelled) return toast("dibatalkan oleh extension");
	await afterSessionChange();
};

$("#compact").onclick = async () => {
	toast("compaction dimulai…");
	const response = await api({ type: "compact" });
	if (!response.success) toast(response.error ?? "compaction gagal", "error");
	await refreshStats();
};

$("#export").onclick = async () => {
	const response = await api({ type: "export_html" });
	if (!response.success) return toast(response.error ?? "export gagal", "error");
	toast(`export: ${response.data?.path ?? "selesai"}`);
};

modelSelect.onchange = async () => {
	const value = modelSelect.value;
	const slash = value.indexOf("/");
	const provider = value.slice(0, slash);
	const modelId = value.slice(slash + 1);
	const response = await api({ type: "set_model", provider, modelId });
	if (!response.success) return toast(response.error ?? "gagal ganti model", "error");
	state.model = response.data;
	await refreshThinkingLevels();
	await refreshState();
};

thinkingSelect.onchange = async () => {
	const response = await api({ type: "set_thinking_level", level: thinkingSelect.value });
	if (!response.success) return toast(response.error ?? "gagal set thinking", "error");
	state.thinkingLevel = thinkingSelect.value;
};

cwdInput.onkeydown = (event) => {
	if (event.key !== "Enter") return;
	event.preventDefault();
	const next = cwdInput.value.trim();
	if (next) restart(next);
};

input.addEventListener("keydown", (event) => {
	if (slashItems.length > 0) {
		if (event.key === "ArrowDown") {
			event.preventDefault();
			slashIndex = (slashIndex + 1) % slashItems.length;
			renderSlash();
			return;
		}
		if (event.key === "ArrowUp") {
			event.preventDefault();
			slashIndex = (slashIndex - 1 + slashItems.length) % slashItems.length;
			renderSlash();
			return;
		}
		if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey && !event.isComposing)) {
			event.preventDefault();
			applySlash(slashItems[slashIndex]);
			return;
		}
		if (event.key === "Escape") {
			event.preventDefault();
			hideSlash();
			return;
		}
	}

	if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
		event.preventDefault();
		submit();
		return;
	}
	if (event.key === "Escape" && (state.isStreaming || state.pendingCount > 0)) {
		event.preventDefault();
		void stopRun();
	}
});
input.addEventListener("input", () => {
	autosize();
	updateSlash();
});

input.addEventListener("paste", (event) => {
	const files = [...(event.clipboardData?.files ?? [])].filter((file) =>
		file.type.startsWith("image/"),
	);
	if (files.length === 0) return;
	event.preventDefault();
	addImageFiles(files);
});

const composer = $(".composer");
composer.addEventListener("dragover", (event) => {
	if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
});
composer.addEventListener("drop", (event) => {
	const files = [...(event.dataTransfer?.files ?? [])];
	if (files.length === 0) return;
	event.preventDefault();
	addImageFiles(files);
});

transcript.addEventListener("click", async (event) => {
	const button = event.target.closest("[data-copy]");
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
		toast("clipboard ditolak browser", "error");
	}
});

// ------------------------------------------------------------------------ boot

async function boot() {
	if (!token) {
		transcript.append(
			div("note", "Token tidak ada. Buka URL yang dicetak server (termasuk #t=…)."),
		);
		return;
	}
	const infoResponse = await fetch("/api/info", { headers }).catch(() => null);
	if (infoResponse?.status === 401) {
		setStatus("token ditolak");
		showBanner(
			"Token ditolak server. Buka URL terbaru yang dicetak terminal (termasuk #t=…).",
			"muat ulang",
			() => location.reload(),
		);
		return;
	}
	const info = await infoResponse?.json().catch(() => null);
	if (info?.cwd) cwdInput.value = info.cwd;
	connectEvents();
	if (info?.error || (info && info.pid === null)) {
		setStatus("pi gagal");
		showBanner(
			`Agent pi tidak berjalan: ${info.error ?? "pid tidak tersedia"}`,
			"nyalakan ulang",
			restartAgentFromBanner,
		);
		input.focus();
		return;
	}
	await refreshState();
	await refreshModels();
	await refreshThinkingLevels();
	await loadHistory({ allowStreaming: true });
	await refreshStats();
	await refreshCommands();
	autosize();
	input.focus();
}

boot();
