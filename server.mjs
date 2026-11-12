#!/usr/bin/env node
/**
 * pi-gui — jembatan RPC minimal antara browser dan `pi --mode rpc`.
 *
 * Tanpa dependency. Node >= 20.
 *
 *   node server.mjs                 # workspace = $HOME
 *   PI_CWD=~/code node server.mjs   # workspace lain
 *   PORT=5000 node server.mjs
 *
 * Protokol: JSONL di stdin/stdout pi (lihat docs/rpc.md di paket pi).
 */

import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { appendFile, mkdir, open, readdir, readFile, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, gzipSync } from "node:zlib";

const ROOT = dirname(fileURLToPath(import.meta.url));
const REACT_DIST = join(ROOT, "frontend", "dist");
const LEGACY_PUBLIC = join(ROOT, "public");
const PUBLIC = existsSync(join(REACT_DIST, "index.html")) ? REACT_DIST : LEGACY_PUBLIC;
const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT ?? 4789);
const PI_BIN = process.env.PI_BIN ?? "pi";
const START_CWD = resolve(process.env.PI_CWD ?? homedir());
const STATE_DIR = resolve(process.env.PI_GUI_STATE_DIR ?? join(homedir(), ".pi", "pi-gui"));
const TOKEN_FILE = join(STATE_DIR, "token");
const PROJECTS_FILE = join(STATE_DIR, "projects.json");
const PROJECTS_LIMIT = 200;
const PROJECT_NAME_MAX = 80;

/** Token stabil antar-restart supaya URL/refresh tidak mati saat server dinyalakan ulang. */
let tokenSource = "file";
function loadToken() {
	if (process.env.PI_GUI_TOKEN) {
		tokenSource = "env";
		return process.env.PI_GUI_TOKEN;
	}
	try {
		mkdirSync(dirname(TOKEN_FILE), { recursive: true, mode: 0o700 });
		let saved = "";
		try {
			saved = readFileSync(TOKEN_FILE, "utf8").trim();
		} catch {
			/* belum ada */
		}
		if (saved) {
			try {
				chmodSync(TOKEN_FILE, 0o600);
			} catch {
				/* abaikan */
			}
			return saved;
		}

		const fresh = randomBytes(16).toString("hex");
		try {
			writeFileSync(TOKEN_FILE, `${fresh}\n`, { flag: "wx", mode: 0o600 });
			return fresh;
		} catch (error) {
			if (error?.code !== "EEXIST") throw error;
			const raced = readFileSync(TOKEN_FILE, "utf8").trim();
			if (raced) return raced;
			writeFileSync(TOKEN_FILE, `${fresh}\n`, { mode: 0o600 });
			return fresh;
		}
	} catch (error) {
		console.error(`[pi-gui] gagal menyiapkan token file (${TOKEN_FILE}):`, error.message);
		return randomBytes(16).toString("hex");
	}
}

const TOKEN = loadToken();

// ---------------------------------------------------------------- agent state

let child = null;
let cwd = START_CWD;
let seq = 0;
let stdoutBuffer = "";
let agentError = null;
const pending = new Map(); // request id -> { resolve, timer }
const pendingUi = new Map(); // request id -> extension_ui_request yang menunggu jawaban
const sseClients = new Set();
const DIALOG_METHODS = new Set(["select", "confirm", "input", "editor"]);
const CLEAR_UI_COMMANDS = new Set(["abort", "switch_session", "new_session", "fork", "clone"]);

const log = (...args) => console.error("[pi-gui]", ...args);

if (tokenSource === "env" && TOKEN.length < 24) {
	log("peringatan: PI_GUI_TOKEN pendek; gunakan minimal 24 karakter acak");
}

const SECURITY_HEADERS = {
	"content-security-policy": [
		"default-src 'self'",
		"base-uri 'none'",
		"object-src 'none'",
		"frame-ancestors 'none'",
		"form-action 'none'",
		"script-src 'self'",
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: https: http:",
		"connect-src 'self'",
		"font-src 'self'",
	].join("; "),
	"x-content-type-options": "nosniff",
	"x-frame-options": "DENY",
	"referrer-policy": "no-referrer",
	"permissions-policy": "camera=(), microphone=(), geolocation=()",
	"cross-origin-resource-policy": "same-origin",
};

function broadcast(record) {
	const payload = `data: ${JSON.stringify(record)}\n\n`;
	for (const res of sseClients) {
		try {
			res.write(payload);
		} catch {
			sseClients.delete(res);
		}
	}
}

function handleRecord(line) {
	let record;
	try {
		record = JSON.parse(line);
	} catch {
		log("JSON tidak valid dari pi:", line.slice(0, 300));
		return;
	}

	// Respons command dikorelasikan lewat id, bukan urutan.
	if (record.type === "response" && record.id && pending.has(record.id)) {
		const waiter = pending.get(record.id);
		pending.delete(record.id);
		clearTimeout(waiter.timer);
		waiter.resolve(record);
		return;
	}

	// Dialog extension memblokir pi sampai dijawab. Simpan supaya bisa dikirim
	// ulang kalau SSE putus sebelum UI sempat menerimanya.
	if (record.type === "extension_ui_request" && DIALOG_METHODS.has(record.method) && record.id) {
		pendingUi.set(record.id, record);
		if (pendingUi.size > 20) pendingUi.delete(pendingUi.keys().next().value);
	}

	broadcast(record);
}

function startAgent(nextCwd) {
	stopAgent();
	cwd = resolve(nextCwd);
	stdoutBuffer = "";
	agentError = null;

	let proc;
	try {
		proc = spawn(PI_BIN, ["--mode", "rpc"], {
			cwd,
			env: process.env,
			stdio: ["pipe", "pipe", "pipe"],
		});
	} catch (error) {
		child = null;
		agentError = error.message;
		rejectPending(`gagal menjalankan pi: ${error.message}`);
		broadcast({ type: "pi_error", message: error.message });
		log(`gagal menjalankan pi: ${error.message}`);
		return;
	}
	child = proc;

	// PENTING: pecah record hanya pada LF. Jangan pakai readline:
	// ia juga memecah U+2028 / U+2029 yang legal di dalam string JSON.
	proc.stdout.setEncoding("utf8");
	proc.stdout.on("data", (chunk) => {
		if (child !== proc) return; // buang sisa output proses lama
		stdoutBuffer += chunk;
		let index;
		while ((index = stdoutBuffer.indexOf("\n")) !== -1) {
			let line = stdoutBuffer.slice(0, index);
			stdoutBuffer = stdoutBuffer.slice(index + 1);
			if (line.endsWith("\r")) line = line.slice(0, -1);
			if (line.length > 0) handleRecord(line);
		}
	});

	proc.stderr.setEncoding("utf8");
	proc.stderr.on("data", (chunk) => {
		if (child !== proc) return;
		for (const line of chunk.split("\n")) {
			if (line.trim()) log("pi:", line);
		}
	});

	proc.stdin.on("error", (error) => {
		if (child === proc) log("stdin:", error.message);
	});

	proc.on("spawn", () => {
		if (child !== proc) return;
		agentError = null;
		broadcast({ type: "pi_started", cwd, pid: proc.pid });
		log(`pi berjalan di ${cwd} (pid ${proc.pid})`);
	});

	proc.on("error", (error) => {
		if (child !== proc) return;
		child = null;
		agentError = error.message;
		rejectPending(`gagal menjalankan pi: ${error.message}`);
		broadcast({ type: "pi_error", message: error.message });
		log(`gagal menjalankan pi: ${error.message}`);
	});

	proc.on("exit", (code, signal) => {
		if (child !== proc) return;
		child = null;
		const detail = [code !== null && code !== undefined ? `code=${code}` : "", signal ? `signal=${signal}` : ""]
			.filter(Boolean)
			.join(" ");
		agentError = detail ? `proses pi berhenti (${detail})` : "proses pi berhenti";
		rejectPending("proses pi berhenti");
		broadcast({ type: "pi_exit", code, signal });
		log(`pi berhenti (code=${code} signal=${signal})`);
	});
}

function rejectPending(reason) {
	for (const waiter of pending.values()) {
		clearTimeout(waiter.timer);
		waiter.resolve({ type: "response", success: false, error: reason });
	}
	pending.clear();
}

function stopAgent() {
	const proc = child;
	child = null;
	pendingUi.clear();
	rejectPending("agent di-restart");
	if (!proc) return;

	// Shutdown rapi = tutup stdin, lalu SIGTERM kalau belum keluar, lalu
	// SIGKILL kalau masih bandel. Tanpa tahap terakhir, proses pi yang
	// mengabaikan SIGTERM menggantung dan endpoint restart menumpuk proses.
	try {
		proc.stdin.end();
	} catch {
		/* sudah tertutup */
	}
	const alive = () => proc.exitCode === null && proc.signalCode === null;
	const termTimer = setTimeout(() => {
		if (alive()) proc.kill("SIGTERM");
	}, 1500);
	const killTimer = setTimeout(() => {
		if (!alive()) return;
		log("pi tidak berhenti setelah SIGTERM; kirim SIGKILL");
		proc.kill("SIGKILL");
	}, 6500);
	termTimer.unref();
	killTimer.unref();
	proc.once("exit", () => {
		clearTimeout(termTimer);
		clearTimeout(killTimer);
	});
}

function writeLine(proc, record) {
	const line = JSON.stringify(record) + "\n";
	if (proc.stdin.write(line)) return Promise.resolve();
	// Hormati backpressure stdin.
	return new Promise((done, fail) => {
		proc.stdin.once("drain", done);
		proc.stdin.once("error", fail);
	});
}

async function send(command, timeoutMs = 600_000) {
	const proc = child;
	if (!proc) throw new Error("pi belum berjalan");

	const id = `g${++seq}`;
	let timer;
	const response = new Promise((resolvePromise, rejectPromise) => {
		timer = setTimeout(() => {
			pending.delete(id);
			rejectPromise(new Error(`timeout ${command.type} (${timeoutMs}ms)`));
		}, timeoutMs);
		pending.set(id, { resolve: resolvePromise, timer });
	});

	try {
		await writeLine(proc, { id, ...command });
	} catch (error) {
		pending.delete(id);
		clearTimeout(timer);
		throw error;
	}
	return response;
}

/** Untuk record yang membawa id sendiri (extension_ui_response). */
async function sendRaw(record) {
	const proc = child;
	if (!proc) throw new Error("pi belum berjalan");
	await writeLine(proc, record);
}

function contentText(content) {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((block) => (block.type === "text" ? block.text : ""))
		.filter(Boolean)
		.join("\n");
}

const PREVIEW_LIMIT = 120;
const SUMMARY_BYTES = 256 * 1024;
const NAME_SCAN_BYTES = 4 * 1024 * 1024;
const NAME_SCAN_CHUNK = 128 * 1024;
const summaryCache = new Map();

/**
 * Baca header + preview dari awal file, lalu nama sesi dari akhir file.
 * Pi menambahkan `session_info` di akhir, jadi sesi besar tidak boleh hanya
 * dibaca 256 KB pertamanya.
 */
async function readSessionSummary(file, size, mtimeMs) {
	const cached = summaryCache.get(file);
	if (cached && cached.size === size && cached.mtimeMs === mtimeMs) return cached.summary;

	const handle = await open(file, "r");
	try {
		const readRange = async (length, position) => {
			const buffer = Buffer.alloc(length);
			let offset = 0;
			while (offset < length) {
				const { bytesRead } = await handle.read(buffer, offset, length - offset, position + offset);
				if (!bytesRead) break;
				offset += bytesRead;
			}
			return buffer.subarray(0, offset).toString("utf8");
		};

		const head = await readRange(Math.min(size, SUMMARY_BYTES), 0);
		let header = null;
		let name = null;
		let preview = null;
		let messageCount = 0;
		let model = null;

		const apply = (line, fromTail) => {
			if (!line) return;
			let entry;
			try {
				entry = JSON.parse(line);
			} catch {
				return; // baris terpotong di batas chunk
			}
			if (entry.type === "session" && !header && !fromTail) {
				header = entry;
				return;
			}
			if (entry.type === "session_info") {
				// Nama kosong adalah perintah menghapus nama, jadi jangan diabaikan.
				name = typeof entry.name === "string" ? entry.name : "";
			}
			if (!fromTail && entry.type === "model_change") {
				model = `${entry.provider}/${entry.modelId}`;
			}
			if (!fromTail && entry.type === "message" && entry.message?.role !== "system") {
				messageCount += 1;
				if (entry.message?.model) model = entry.message.model;
			}
			if (!fromTail && !preview && entry.type === "message" && entry.message?.role === "user") {
				preview =
					contentText(entry.message.content).replace(/\s+/g, " ").slice(0, PREVIEW_LIMIT) || null;
			}
		};

		for (const line of head.split("\n")) apply(line, false);

		if (size > SUMMARY_BYTES) {
			// Nama sesi ditambahkan sebagai entry baru, jadi bisa berada jauh dari
			// akhir file kalau setelah rename masih banyak pesan. Scan mundur
			// per chunk dan berhenti pada session_info terbaru.
			const maxStart = Math.max(0, size - NAME_SCAN_BYTES);
			let end = size;
			let text = "";
			let found = false;
			while (end > maxStart && !found) {
				const start = Math.max(maxStart, end - NAME_SCAN_CHUNK);
				text = (await readRange(end - start, start)) + text;
				const lines = text.split("\n");
				for (let index = lines.length - 1; index >= 0; index -= 1) {
					let entry;
					try {
						entry = JSON.parse(lines[index]);
					} catch {
						continue;
					}
					if (entry.type === "session_info") {
						name = typeof entry.name === "string" ? entry.name : "";
						found = true;
						break;
					}
				}
				end = start;
			}
		}

		const summary = {
			header,
			name,
			preview,
			messageCount,
			model,
			partial: size > SUMMARY_BYTES,
		};
		summaryCache.set(file, { size, mtimeMs, summary });
		if (summaryCache.size > 200) summaryCache.delete(summaryCache.keys().next().value);
		return summary;
	} finally {
		await handle.close();
	}
}

const TRASH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function cleanupTrash(dir) {
	try {
		const names = await readdir(dir);
		for (const name of names) {
			if (!name.includes(".jsonl.trash-")) continue;
			const full = join(dir, name);
			const info = await stat(full).catch(() => null);
			if (!info || Date.now() - info.mtimeMs < TRASH_TTL_MS) continue;
			await unlink(full).catch(() => {});
		}
	} catch {
		/* folder sesi belum ada */
	}
}

async function listSessions() {
	const state = await send({ type: "get_state" }, 15_000);
	const sessionFile = state?.data?.sessionFile ?? null;
	const currentName = state?.data?.sessionName ?? null;
	const dir = sessionFile ? dirname(sessionFile) : null;
	if (!dir) return { dir: null, sessionName: currentName, sessions: [] };

	let names = [];
	try {
		names = await readdir(dir);
	} catch {
		return { dir, sessions: [] };
	}
	if (names.some((name) => name.includes(".jsonl.trash-"))) {
		void cleanupTrash(dir);
	}

	const files = await Promise.all(
		names
			.filter((name) => name.endsWith(".jsonl"))
			.map(async (name) => {
				const full = join(dir, name);
				try {
					const info = await stat(full);
					return { full, mtime: info.mtimeMs, size: info.size };
				} catch {
					return null;
				}
			}),
	);

	const sorted = files.filter(Boolean).sort((a, b) => b.mtime - a.mtime);
	const recent = sorted.slice(0, 60);
	// Sesi lama yang sudah masuk proyek tetap ditampilkan; kalau tidak, proyek
	// terlihat kosong hanya karena sesinya di luar 60 sesi terbaru.
	const projectsState = await loadProjects();
	const assigned = sorted
		.slice(60)
		.filter((item) => projectsState.assignments[item.full])
		.slice(0, 120);
	const selected =
		assigned.length > 0 ? [...recent, ...assigned].sort((a, b) => b.mtime - a.mtime) : recent;

	const sessions = await Promise.all(
		selected.map(async ({ full, mtime, size }) => {
			try {
				const { header, name, preview, messageCount, model, partial } = await readSessionSummary(
					full,
					size,
					mtime,
				);
				if (!header) return null; // bukan file sesi pi yang valid
				return {
					path: full,
					id: header?.id ?? basename(full, ".jsonl"),
					cwd: header?.cwd ?? null,
					parentSession: header?.parentSession ?? null,
					name: full === sessionFile ? (currentName ?? name ?? null) : (name ?? null),
					preview: preview ?? null,
					messageCount,
					messageCountPartial: Boolean(partial),
					model: model ?? null,
					size,
					mtime,
					current: full === sessionFile,
				};
			} catch {
				return null;
			}
		}),
	);

	return { dir, sessionFile, sessionName: currentName, sessions: sessions.filter(Boolean) };
}

// ------------------------------------------------------------------ projects
// Proyek adalah metadata milik GUI, bukan pi: pi tetap cuma menyimpan file
// .jsonl. Disimpan di ~/.pi/pi-gui/projects.json (ditulis atomik: tmp + rename).

let projectsCache = null;
let projectsWrite = Promise.resolve();

const emptyProjects = () => ({ version: 1, projects: [], assignments: {} });

function cleanProjectName(value) {
	return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, PROJECT_NAME_MAX) : "";
}

function cleanSessionName(value) {
	return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, PROJECT_NAME_MAX) : "";
}

function normalizeProjects(raw) {
	const projects = [];
	if (Array.isArray(raw?.projects)) {
		for (const item of raw.projects) {
			if (!item || typeof item.id !== "string" || !/^[a-f0-9]{4,32}$/i.test(item.id)) continue;
			const name = cleanProjectName(item.name);
			if (!name) continue;
			projects.push({
				id: item.id,
				name,
				// Folder sesi tempat proyek dibuat; null = berlaku lintas workspace.
				dir: typeof item.dir === "string" && isAbsolute(item.dir) ? resolve(item.dir) : null,
				createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
				order: Number.isFinite(item.order) ? item.order : projects.length,
			});
		}
	}
	projects.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);

	const ids = new Set(projects.map((project) => project.id));
	const assignments = {};
	if (raw?.assignments && typeof raw.assignments === "object") {
		for (const [sessionPath, projectId] of Object.entries(raw.assignments)) {
			if (typeof sessionPath === "string" && ids.has(projectId)) assignments[sessionPath] = projectId;
		}
	}
	return { version: 1, projects, assignments };
}

async function loadProjects() {
	if (projectsCache) return projectsCache;
	try {
		projectsCache = normalizeProjects(JSON.parse(await readFile(PROJECTS_FILE, "utf8")));
	} catch (error) {
		if (error?.code !== "ENOENT") {
			log(`projects.json tidak terbaca (${error?.message ?? error}); mulai dari kosong`);
		}
		projectsCache = emptyProjects();
	}
	return projectsCache;
}

/** Serialkan penulisan supaya dua request beruntun tidak saling menimpa. */
function saveProjects() {
	const snapshot = `${JSON.stringify(projectsCache ?? emptyProjects(), null, 2)}\n`;
	projectsWrite = projectsWrite
		.then(async () => {
			await mkdir(dirname(PROJECTS_FILE), { recursive: true, mode: 0o700 });
			const tmp = `${PROJECTS_FILE}.${process.pid}.tmp`;
			await writeFile(tmp, snapshot, { mode: 0o600 });
			await rename(tmp, PROJECTS_FILE);
		})
		.catch((error) => log(`gagal menyimpan projects.json: ${error?.message ?? error}`));
	return projectsWrite;
}

/** Buang assignment yang file sesinya sudah tidak ada. */
async function pruneAssignments(state) {
	let changed = false;
	for (const sessionPath of Object.keys(state.assignments)) {
		const info = await stat(sessionPath).catch(() => null);
		if (info?.isFile()) continue;
		delete state.assignments[sessionPath];
		changed = true;
	}
	if (changed) await saveProjects();
}

const projectsResponse = (state) => ({ projects: state.projects, assignments: state.assignments });

function sendJson(res, status, body) {
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
	});
	res.end(JSON.stringify(body));
}

async function readBody(req, limit = 32 * 1024 * 1024) {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		size += chunk.length;
		if (size > limit) throw new Error("body terlalu besar");
		chunks.push(chunk);
	}
	return Buffer.concat(chunks).toString("utf8");
}

function tokenMatches(value) {
	if (typeof value !== "string") return false;
	const actual = Buffer.from(value);
	const expected = Buffer.from(TOKEN);
	if (actual.length !== expected.length) return false;
	return timingSafeEqual(actual, expected);
}

function authorized(req) {
	const header = req.headers.authorization ?? "";
	const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
	return tokenMatches(bearer);
}

/** Hanya izinkan POST dari origin loopback; Host juga harus loopback (anti DNS rebinding). */
function sameOrigin(req) {
	const origin = req.headers.origin;
	if (!origin) return true; // klien non-browser (curl)
	try {
		const url = new URL(origin);
		if (url.protocol !== "http:" && url.protocol !== "https:") return false;
		if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return false;

		// Origin port boleh beda saat diakses lewat SSH tunnel, tetapi Host request
		// tetap harus loopback. Halaman evil.com yang resolve ke 127.0.0.1 ditolak.
		const host = (req.headers.host ?? "").toLowerCase();
		const hostname = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
		return hostname === "127.0.0.1" || hostname === "localhost";
	} catch {
		return false;
	}
}

function isJson(req) {
	return (req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json");
}

const MIME = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".ico": "image/x-icon",
	".woff2": "font/woff2",
};

const COMPRESSIBLE = new Set([".html", ".js", ".css", ".json", ".svg", ".txt", ".map"]);
const compressedCache = new Map();

function compressed(body, encoding, key) {
	const cacheKey = `${key}:${encoding}`;
	const cached = compressedCache.get(cacheKey);
	if (cached) {
		compressedCache.delete(cacheKey);
		compressedCache.set(cacheKey, cached);
		return cached;
	}
	const value = encoding === "br" ? brotliCompressSync(body) : gzipSync(body);
	compressedCache.set(cacheKey, value);
	if (compressedCache.size > 80) compressedCache.delete(compressedCache.keys().next().value);
	return value;
}

async function serveStatic(req, res, pathname) {
	const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
	const file = resolve(PUBLIC, rel);
	if (file !== PUBLIC && !file.startsWith(PUBLIC + sep)) {
		sendJson(res, 403, { error: "forbidden" });
		return;
	}
	try {
		const info = await stat(file);
		const etag = `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
		const hashed = rel.startsWith("assets/");
		const cacheControl = hashed
			? "public, max-age=31536000, immutable"
			: rel.startsWith("vendor/")
				? "public, max-age=86400"
				: "no-cache";
		if (req.headers["if-none-match"] === etag) {
			res.writeHead(304, { etag, "cache-control": cacheControl });
			res.end();
			return;
		}

		let body = await readFile(file);
		const ext = extname(file).toLowerCase();
		const accept = String(req.headers["accept-encoding"] ?? "").toLowerCase();
		const encoding = COMPRESSIBLE.has(ext) && body.length > 1024
			? accept.includes("br")
				? "br"
				: accept.includes("gzip")
					? "gzip"
					: null
			: null;
		if (encoding) {
			body = compressed(body, encoding, `${file}:${info.size}:${Math.floor(info.mtimeMs)}`);
		}

		res.writeHead(200, {
			"content-type": MIME[ext] ?? "application/octet-stream",
			"cache-control": cacheControl,
			etag,
			vary: "accept-encoding",
			"content-length": body.length,
			...(encoding ? { "content-encoding": encoding } : {}),
		});
		res.end(req.method === "HEAD" ? undefined : body);
	} catch {
		res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("not found");
	}
}

// ----------------------------------------------------------------------- server

const server = createServer(async (req, res) => {
	for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
	let url;
	try {
		url = new URL(req.url ?? "/", `http://${req.headers.host ?? `${HOST}:${PORT}`}`);
	} catch {
		res.writeHead(400, { "content-type": "text/plain; charset=utf-8" }).end("bad request");
		return;
	}
	const { pathname } = url;

	try {
		// Event stream (SSE). Klien memakai fetch + Authorization header, bukan
		// EventSource, supaya token tidak perlu muncul di query string.
		if (pathname === "/api/events" && req.method === "GET") {
			if (!authorized(req, url)) return sendJson(res, 401, { error: "unauthorized" });
			res.writeHead(200, {
				"content-type": "text/event-stream; charset=utf-8",
				"cache-control": "no-cache, no-transform",
				connection: "keep-alive",
				"x-accel-buffering": "no",
			});
			res.write("retry: 1000\n\n");
			sseClients.add(res);
			res.write(
				`data: ${JSON.stringify({ type: "hello", cwd, pid: child?.pid ?? null, error: agentError })}\n\n`,
			);
			for (const request of pendingUi.values()) {
				res.write(`data: ${JSON.stringify(request)}\n\n`);
			}
			const heartbeat = setInterval(() => {
				try {
					res.write(": ping\n\n");
				} catch {
					/* ditutup */
				}
			}, 15_000);
			req.on("close", () => {
				clearInterval(heartbeat);
				sseClients.delete(res);
			});
			return;
		}

		if (pathname === "/api/command" && req.method === "POST") {
			if (!authorized(req, url)) return sendJson(res, 401, { error: "unauthorized" });
			if (!sameOrigin(req)) return sendJson(res, 403, { error: "origin ditolak" });
			if (!isJson(req)) return sendJson(res, 415, { error: "content-type harus application/json" });
			let command;
			try {
				command = JSON.parse(await readBody(req));
			} catch {
				return sendJson(res, 400, { error: "JSON tidak valid" });
			}
			if (!command || typeof command.type !== "string") {
				return sendJson(res, 400, { error: "field type wajib" });
			}
			if (command.type === "extension_ui_response") {
				if (typeof command.id === "string") pendingUi.delete(command.id);
				await sendRaw(command);
				return sendJson(res, 200, { ok: true });
			}
			if (CLEAR_UI_COMMANDS.has(command.type)) pendingUi.clear();
			const response = await send(command);
			return sendJson(res, 200, response);
		}

		if (pathname === "/api/restart" && req.method === "POST") {
			if (!authorized(req, url)) return sendJson(res, 401, { error: "unauthorized" });
			if (!sameOrigin(req)) return sendJson(res, 403, { error: "origin ditolak" });
			if (!isJson(req)) return sendJson(res, 415, { error: "content-type harus application/json" });
			let body;
			try {
				body = JSON.parse((await readBody(req)) || "{}");
			} catch {
				return sendJson(res, 400, { error: "JSON tidak valid" });
			}
			const { cwd: nextCwd } = body;
			if (typeof nextCwd !== "string" || !nextCwd.trim()) {
				return sendJson(res, 400, { error: "cwd wajib" });
			}
			const rawCwd = nextCwd.trim();
			const expandedCwd =
				rawCwd === "~" ? homedir() : rawCwd.startsWith("~/") ? join(homedir(), rawCwd.slice(2)) : rawCwd;
			const target = resolve(expandedCwd);
			try {
				const info = await stat(target);
				if (!info.isDirectory()) return sendJson(res, 400, { error: "cwd bukan folder" });
			} catch {
				return sendJson(res, 400, { error: `folder tidak ditemukan: ${target}` });
			}
			startAgent(target);
			return sendJson(res, 200, { ok: true, cwd });
		}

		if (pathname === "/api/projects" && req.method === "GET") {
			if (!authorized(req, url)) return sendJson(res, 401, { error: "unauthorized" });
			const state = await loadProjects();
			await pruneAssignments(state);
			return sendJson(res, 200, projectsResponse(state));
		}

		if (pathname === "/api/projects" && req.method === "POST") {
			if (!authorized(req, url)) return sendJson(res, 401, { error: "unauthorized" });
			if (!sameOrigin(req)) return sendJson(res, 403, { error: "origin ditolak" });
			if (!isJson(req)) return sendJson(res, 415, { error: "content-type harus application/json" });
			let body;
			try {
				body = JSON.parse(await readBody(req));
			} catch {
				return sendJson(res, 400, { error: "JSON tidak valid" });
			}

			const state = await loadProjects();
			const action = typeof body?.action === "string" ? body.action : "";

			if (action === "create") {
				const name = cleanProjectName(body.name);
				if (!name) return sendJson(res, 400, { error: "nama proyek wajib" });
				if (state.projects.length >= PROJECTS_LIMIT) {
					return sendJson(res, 400, { error: `maksimal ${PROJECTS_LIMIT} proyek` });
				}
				state.projects.push({
					id: randomBytes(6).toString("hex"),
					name,
					dir: typeof body.dir === "string" && isAbsolute(body.dir) ? resolve(body.dir) : null,
					createdAt: Date.now(),
					order: state.projects.reduce((max, item) => Math.max(max, item.order + 1), 0),
				});
				await saveProjects();
				return sendJson(res, 200, projectsResponse(state));
			}

			if (action === "rename") {
				const project = state.projects.find((item) => item.id === body.projectId);
				if (!project) return sendJson(res, 404, { error: "proyek tidak ditemukan" });
				const name = cleanProjectName(body.name);
				if (!name) return sendJson(res, 400, { error: "nama proyek wajib" });
				project.name = name;
				await saveProjects();
				return sendJson(res, 200, projectsResponse(state));
			}

			if (action === "delete") {
				const index = state.projects.findIndex((item) => item.id === body.projectId);
				if (index === -1) return sendJson(res, 404, { error: "proyek tidak ditemukan" });
				const [removed] = state.projects.splice(index, 1);
				for (const [sessionPath, projectId] of Object.entries(state.assignments)) {
					if (projectId === removed.id) delete state.assignments[sessionPath];
				}
				await saveProjects();
				return sendJson(res, 200, projectsResponse(state));
			}

			if (action === "assign") {
				const rawPath = typeof body.sessionPath === "string" ? body.sessionPath.trim() : "";
				if (!rawPath || !isAbsolute(rawPath) || extname(rawPath) !== ".jsonl") {
					return sendJson(res, 400, { error: "sessionPath harus path .jsonl absolut" });
				}
				const sessionPath = resolve(rawPath);
				const projectId = body.projectId ?? null;
				if (projectId !== null && !state.projects.some((item) => item.id === projectId)) {
					return sendJson(res, 404, { error: "proyek tidak ditemukan" });
				}
				if (projectId === null) delete state.assignments[sessionPath];
				else state.assignments[sessionPath] = projectId;
				await saveProjects();
				return sendJson(res, 200, projectsResponse(state));
			}

			return sendJson(res, 400, { error: "action tidak dikenal" });
		}

		if (pathname === "/api/sessions" && req.method === "GET") {
			if (!authorized(req, url)) return sendJson(res, 401, { error: "unauthorized" });
			return sendJson(res, 200, await listSessions());
		}

		if (pathname === "/api/sessions/delete" && req.method === "POST") {
			if (!authorized(req, url)) return sendJson(res, 401, { error: "unauthorized" });
			if (!sameOrigin(req)) return sendJson(res, 403, { error: "origin ditolak" });
			if (!isJson(req)) return sendJson(res, 415, { error: "content-type harus application/json" });

			let body;
			try {
				body = JSON.parse(await readBody(req));
			} catch {
				return sendJson(res, 400, { error: "JSON tidak valid" });
			}
			// Kompatibel dengan dua bentuk: `{ path }` (satu sesi) dan
			// `{ paths: [...] }` (hapus massal dari sidebar).
			const rawList = Array.isArray(body?.paths)
				? body.paths
				: typeof body?.path === "string"
					? [body.path]
					: [];
			const requested = [
				...new Set(
					rawList
						.filter((item) => typeof item === "string")
						.map((item) => item.trim())
						.filter(Boolean),
				),
			];
			if (requested.length === 0) return sendJson(res, 400, { error: "path sesi wajib" });
			if (requested.length > 200) {
				return sendJson(res, 400, { error: "maksimal 200 sesi per permintaan" });
			}

			let sessionFile;
			try {
				const state = await send({ type: "get_state" }, 15_000);
				sessionFile = state?.data?.sessionFile ?? null;
			} catch {
				return sendJson(res, 503, { error: "agent pi tidak tersedia" });
			}
			if (!sessionFile) return sendJson(res, 400, { error: "sesi aktif belum punya file" });

			const dir = resolve(dirname(sessionFile));
			const currentTarget = resolve(sessionFile);
			const realDir = await realpath(dir).catch(() => null);
			const realCurrent = await realpath(sessionFile).catch(() => null);

			const failed = [];
			const prepared = [];
			for (const requestedPath of requested) {
				const target = resolve(requestedPath);
				if (dirname(target) !== dir) {
					failed.push({ path: requestedPath, error: "path di luar folder sesi" });
					continue;
				}
				if (extname(target) !== ".jsonl") {
					failed.push({ path: requestedPath, error: "bukan file sesi" });
					continue;
				}
				if (target === currentTarget) {
					failed.push({ path: requestedPath, error: "sesi aktif tidak bisa dihapus" });
					continue;
				}

				let realTarget;
				try {
					realTarget = await realpath(target);
				} catch (error) {
					failed.push({
						path: requestedPath,
						error:
							error?.code === "ENOENT" ? "sesi tidak ditemukan" : String(error?.message ?? error),
					});
					continue;
				}
				if (realDir && dirname(realTarget) !== realDir) {
					failed.push({ path: requestedPath, error: "path di luar folder sesi" });
					continue;
				}
				if (realCurrent && realTarget === realCurrent) {
					failed.push({ path: requestedPath, error: "sesi aktif tidak bisa dihapus" });
					continue;
				}

				const info = await stat(realTarget).catch(() => null);
				if (!info || !info.isFile()) {
					failed.push({ path: requestedPath, error: "bukan file sesi" });
					continue;
				}
				prepared.push({ target, realTarget });
			}

			const deleted = [];
			const trashed = [];
			for (const { target, realTarget } of prepared) {
				const trashPath = `${target}.trash-${Date.now()}-${randomBytes(3).toString("hex")}`;
				try {
					// Soft delete: file dipindah ke samping agar bisa diurungkan.
					await rename(target, trashPath);
				} catch (error) {
					failed.push({
						path: target,
						error:
							error?.code === "ENOENT" ? "sesi tidak ditemukan" : String(error?.message ?? error),
					});
					continue;
				}
				summaryCache.delete(target);
				summaryCache.delete(realTarget);
				deleted.push(target);
				trashed.push({ path: target, trashPath });
			}

			const batch = Array.isArray(body?.paths);
			if (!batch && deleted.length === 0) {
				const error = failed[0]?.error ?? "gagal menghapus sesi";
				const status = error === "sesi tidak ditemukan" ? 404 : 400;
				return sendJson(res, status, { error });
			}
			return sendJson(res, 200, {
				ok: deleted.length > 0,
				deleted,
				trashed,
				failed,
				...(deleted.length === 1 ? { path: deleted[0] } : {}),
			});
		}

		if (pathname === "/api/sessions/restore" && req.method === "POST") {
			if (!authorized(req)) return sendJson(res, 401, { error: "unauthorized" });
			if (!sameOrigin(req)) return sendJson(res, 403, { error: "origin ditolak" });
			if (!isJson(req)) return sendJson(res, 415, { error: "content-type harus application/json" });
			let body;
			try {
				body = JSON.parse(await readBody(req));
			} catch {
				return sendJson(res, 400, { error: "JSON tidak valid" });
			}
			const rawList = Array.isArray(body?.paths)
				? body.paths
				: typeof body?.trashPath === "string"
					? [body.trashPath]
					: [];
			const requested = [
				...new Set(
					rawList
						.filter((item) => typeof item === "string")
						.map((item) => item.trim())
						.filter(Boolean),
				),
			];
			if (requested.length === 0) return sendJson(res, 400, { error: "trashPath wajib" });

			let sessionFile;
			try {
				const state = await send({ type: "get_state" }, 15_000);
				sessionFile = state?.data?.sessionFile ?? null;
			} catch {
				return sendJson(res, 503, { error: "agent pi tidak tersedia" });
			}
			if (!sessionFile) return sendJson(res, 400, { error: "sesi aktif belum punya file" });

			const dir = resolve(dirname(sessionFile));
			const failed = [];
			const restored = [];
			for (const requestedPath of requested) {
				const trashPath = resolve(requestedPath);
				const match = /^(.*\.jsonl)\.trash-\d+-[a-f0-9]+$/.exec(trashPath);
				if (!match || dirname(trashPath) !== dir) {
					failed.push({ path: requestedPath, error: "bukan file trash sesi" });
					continue;
				}
				const target = resolve(match[1]);
				if (dirname(target) !== dir) {
					failed.push({ path: requestedPath, error: "path di luar folder sesi" });
					continue;
				}
				try {
					await stat(target);
					failed.push({ path: requestedPath, error: "file tujuan sudah ada" });
					continue;
				} catch {
					/* target belum ada, lanjut */
				}
				try {
					await rename(trashPath, target);
				} catch (error) {
					failed.push({
						path: requestedPath,
						error: error?.code === "ENOENT" ? "trash tidak ditemukan" : String(error?.message ?? error),
					});
					continue;
				}
				summaryCache.delete(target);
				restored.push(target);
			}
			return sendJson(res, 200, { ok: restored.length > 0, restored, failed });
		}

		if (pathname === "/api/sessions/rename" && req.method === "POST") {
			if (!authorized(req)) return sendJson(res, 401, { error: "unauthorized" });
			if (!sameOrigin(req)) return sendJson(res, 403, { error: "origin ditolak" });
			if (!isJson(req)) return sendJson(res, 415, { error: "content-type harus application/json" });
			let body;
			try {
				body = JSON.parse(await readBody(req));
			} catch {
				return sendJson(res, 400, { error: "JSON tidak valid" });
			}
			const rawPath = typeof body?.path === "string" ? body.path.trim() : "";
			const name = cleanSessionName(body?.name ?? "");
			if (!rawPath) return sendJson(res, 400, { error: "path sesi wajib" });

			let sessionFile;
			try {
				const state = await send({ type: "get_state" }, 15_000);
				sessionFile = state?.data?.sessionFile ?? null;
			} catch {
				return sendJson(res, 503, { error: "agent pi tidak tersedia" });
			}
			if (!sessionFile) return sendJson(res, 400, { error: "sesi aktif belum punya file" });

			const dir = resolve(dirname(sessionFile));
			const target = resolve(rawPath);
			if (dirname(target) !== dir || extname(target) !== ".jsonl") {
				return sendJson(res, 400, { error: "path sesi tidak valid" });
			}
			const realTarget = await realpath(target).catch(() => null);
			if (!realTarget) return sendJson(res, 404, { error: "sesi tidak ditemukan" });
			const realDir = await realpath(dir).catch(() => null);
			if (realDir && dirname(realTarget) !== realDir) {
				return sendJson(res, 400, { error: "path di luar folder sesi" });
			}

			if (target === resolve(sessionFile)) {
				try {
					const response = await send({ type: "set_session_name", name }, 15_000);
					if (!response?.success) {
						return sendJson(res, 400, { error: response?.error ?? "rename gagal" });
					}
				} catch (error) {
					return sendJson(res, 503, { error: String(error?.message ?? error) });
				}
			} else {
				let lastId = null;
				try {
					const text = await readFile(realTarget, "utf8");
					const lines = text.split("\n").filter(Boolean);
					for (let index = lines.length - 1; index >= 0; index -= 1) {
						try {
							const entry = JSON.parse(lines[index]);
							if (entry?.id) {
								lastId = entry.id;
								break;
							}
						} catch {
							/* baris terpotong */
						}
					}
					const entry = {
						type: "session_info",
						id: randomBytes(4).toString("hex"),
						parentId: lastId,
						timestamp: new Date().toISOString(),
						name,
					};
					await appendFile(realTarget, `${JSON.stringify(entry)}\n`);
				} catch (error) {
					return sendJson(res, 500, { error: String(error?.message ?? error) });
				}
				summaryCache.delete(target);
				summaryCache.delete(realTarget);
			}
			return sendJson(res, 200, { ok: true, path: target, name });
		}

		if (pathname === "/api/dirs" && req.method === "GET") {
			if (!authorized(req)) return sendJson(res, 401, { error: "unauthorized" });
			const requested = url.searchParams.get("path") || cwd;
			const dir = resolve(requested);
			const info = await stat(dir).catch(() => null);
			if (!info?.isDirectory()) return sendJson(res, 400, { error: "bukan folder" });
			let entries = [];
			try {
				entries = await readdir(dir, { withFileTypes: true });
			} catch (error) {
				return sendJson(res, 400, { error: String(error?.message ?? error) });
			}
			const dirs = entries
				.filter((entry) => entry.isDirectory())
				.map((entry) => entry.name)
				.sort((a, b) => a.localeCompare(b, "id", { sensitivity: "base" }))
				.slice(0, 300);
			return sendJson(res, 200, { path: dir, parent: dirname(dir), dirs });
		}

		if (pathname === "/api/info" && req.method === "GET") {
			if (!authorized(req, url)) return sendJson(res, 401, { error: "unauthorized" });
			return sendJson(res, 200, { cwd, pid: child?.pid ?? null, error: agentError });
		}

		if (req.method !== "GET" && req.method !== "HEAD") return sendJson(res, 405, { error: "method" });
		// Aset statis publik: tidak berisi rahasia. Token hanya menjaga /api/*.
		// Token dibaca frontend React dari fragment (#t=).
		return serveStatic(req, res, pathname);
	} catch (error) {
		log("request gagal:", error);
		if (!res.headersSent) sendJson(res, 500, { error: String(error?.message ?? error) });
		else res.end();
	}
});

server.listen(PORT, HOST, () => {
	startAgent(START_CWD);
	if (tokenSource === "env") log("token dari PI_GUI_TOKEN (env) — pastikan nilainya kuat");
	log(`siap → http://${HOST}:${PORT}/#t=${TOKEN}`);
	log(`workspace: ${cwd}`);
});

server.on("error", (error) => {
	log(
		error?.code === "EADDRINUSE"
			? `port ${PORT} sudah dipakai; jalankan dengan PORT lain`
			: `server gagal: ${error?.message ?? error}`,
	);
	process.exit(1);
});

const shutdown = () => {
	stopAgent();
	server.close(() => process.exit(0));
	setTimeout(() => process.exit(0), 2000).unref();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
