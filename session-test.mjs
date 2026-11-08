// Tes fitur sidebar: daftar sesi, tree, fork, clone, switch.
import { spawn } from "node:child_process";
import { appendFile, mkdtemp, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const PORT = 4794;
const workspace = await mkdtemp(join(tmpdir(), "pi-gui-session-"));
// State GUI (token + projects.json) diisolasi supaya tes tidak menyentuh ~/.pi.
const stateDir = await mkdtemp(join(tmpdir(), "pi-gui-state-"));
const server = spawn("node", ["server.mjs"], {
	env: { ...process.env, PORT: String(PORT), PI_CWD: workspace, PI_GUI_STATE_DIR: stateDir },
	stdio: ["ignore", "pipe", "pipe"],
});

let token = "";
await new Promise((resolve, reject) => {
	const timer = setTimeout(() => reject(new Error("token tidak muncul")), 15000);
	server.stderr.setEncoding("utf8");
	server.stderr.on("data", (chunk) => {
		const match = chunk.match(/[?#]t=([A-Za-z0-9_-]+)/);
		if (match && !token) {
			token = match[1];
			clearTimeout(timer);
			resolve();
		}
	});
});

const base = `http://127.0.0.1:${PORT}`;
const headers = { "content-type": "application/json", authorization: `Bearer ${token}` };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function command(body) {
	const res = await fetch(`${base}/api/command`, {
		method: "POST",
		headers,
		body: JSON.stringify(body),
	});
	return res.json();
}

async function get(path) {
	const res = await fetch(`${base}${path}`, { headers });
	return res.json();
}

async function post(path, body) {
	const res = await fetch(`${base}${path}`, {
		method: "POST",
		headers,
		body: JSON.stringify(body),
	});
	return { status: res.status, body: await res.json().catch(() => null) };
}

async function fileExists(path) {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

async function waitIdle(timeout = 120_000) {
	await sleep(1200);
	const start = Date.now();
	while (Date.now() - start < timeout) {
		const state = await command({ type: "get_state" });
		if (state.success && !state.data.isStreaming) return;
		await sleep(700);
	}
	throw new Error("timeout menunggu idle");
}

let failures = 0;
function check(label, ok, detail = "") {
	console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
	if (!ok) failures += 1;
}

// 1. isi sesi
await command({ type: "prompt", message: "Balas satu kata: SATU" });
await waitIdle();

const firstState = await command({ type: "get_state" });
const firstSession = firstState.data.sessionFile;
check("sesi punya file", typeof firstSession === "string" && firstSession.endsWith(".jsonl"));

// 2. daftar sesi
const list1 = await get("/api/sessions");
check("GET /api/sessions", !list1.error, list1.dir ?? list1.error);
check("ada 1 sesi", list1.sessions?.length === 1, `jumlah=${list1.sessions?.length}`);
check("sesi aktif ditandai", list1.sessions?.[0]?.current === true);
check("preview terisi", Boolean(list1.sessions?.[0]?.preview), list1.sessions?.[0]?.preview ?? "");

// 3. tree
const tree = await command({ type: "get_tree" });
check("get_tree", tree.success);
const flat = [];
const walk = (nodes) => {
	for (const node of nodes) {
		flat.push(node.entry);
		walk(node.children ?? []);
	}
};
walk(tree.data.tree);
const userEntries = flat.filter((entry) => entry.type === "message" && entry.message.role === "user");
check("ada entry user di tree", userEntries.length > 0, `total entry=${flat.length}`);

// 4. fork
const fork = await command({ type: "fork", entryId: userEntries[0].id });
check("fork", fork.success && fork.data?.cancelled === false, fork.data?.text ?? fork.error);
const forkedState = await command({ type: "get_state" });
check("fork pindah ke sesi baru", forkedState.data.sessionFile !== firstSession);

// Sesi baru ditulis ke disk saat pesan pertama, jadi kirim satu pesan dulu.
await command({ type: "prompt", message: "Balas satu kata: DUA" });
await waitIdle();

const list2 = await get("/api/sessions");
check("daftar sesi jadi 2", list2.sessions?.length === 2, `jumlah=${list2.sessions?.length}`);
check(
	"sesi fork mencatat parent",
	list2.sessions?.some((session) => session.parentSession === firstSession),
);

// 5. switch kembali
const back = await command({ type: "switch_session", sessionPath: firstSession });
check("switch_session", back.success && back.data?.cancelled === false);
const backState = await command({ type: "get_state" });
check("sessionFile kembali", backState.data.sessionFile === firstSession);
const messages = await command({ type: "get_messages" });
check("riwayat lama utuh", (messages.data?.messages?.length ?? 0) >= 3, `${messages.data?.messages?.length} pesan`);

// 6. clone
const clone = await command({ type: "clone" });
check("clone", clone.success && clone.data?.cancelled === false);

// 7. diff (write + edit)
await command({
	type: "prompt",
	message:
		"Buat file hello.txt berisi tiga baris: a, b, c. Lalu edit supaya baris kedua menjadi B. " +
		"Gunakan tool write lalu edit. Setelah selesai balas: DONE",
});
await waitIdle();
const afterDiff = await command({ type: "get_messages" });
const diffResult = (afterDiff.data.messages ?? []).find(
	(message) => message.role === "toolResult" && typeof message.details?.diff === "string",
);
check("tool result punya details.diff", Boolean(diffResult), diffResult?.toolName ?? "tidak ada");
if (diffResult) {
	const lines = diffResult.details.diff.split("\n");
	console.log(
		"      diff:",
		lines.filter((line) => line.startsWith("+") || line.startsWith("-")).join(" | "),
	);
}

// 8. rename sesi aktif
const rename = await command({ type: "set_session_name", name: "uji-rename" });
check("set_session_name", rename.success, rename.error ?? "");
const renamed = await command({ type: "get_state" });
check("sessionName tersimpan", renamed.data?.sessionName === "uji-rename", renamed.data?.sessionName ?? "(kosong)");

// 9. nama sesi besar: session_info berada jauh dari akhir file
const current = await command({ type: "get_state" });
const currentSession = current.data.sessionFile;
const sessionDir = dirname(currentSession);
const largeFile = join(sessionDir, "zz-large-name-test.jsonl");
const largeLines = [
	JSON.stringify({
		type: "session",
		version: 3,
		id: "zz-large-name-test",
		timestamp: "2026-11-08T18:00:00.000Z",
		cwd: workspace,
	}),
	JSON.stringify({ type: "message", message: { role: "user", content: "preview besar" } }),
];
for (let index = 0; index < 20; index += 1) {
	largeLines.push(
		JSON.stringify({
			type: "message",
			id: `filler-${index}`,
			message: { role: "assistant", content: [{ type: "text", text: "x".repeat(20_000) }] },
		}),
	);
}
largeLines.push(JSON.stringify({ type: "session_info", id: "large-name", name: "sesi-besar" }));
await writeFile(largeFile, `${largeLines.join("\n")}\n`);
await sleep(50);
const largeList = await get("/api/sessions");
const largeEntry = largeList.sessions?.find((session) => session.id === "zz-large-name-test");
check("nama sesi besar terbaca", largeEntry?.name === "sesi-besar", largeEntry?.name ?? "(kosong)");

await appendFile(largeFile, `${JSON.stringify({ type: "session_info", id: "large-clear", name: "" })}\n`);
await sleep(50);
const clearedList = await get("/api/sessions");
const clearedEntry = clearedList.sessions?.find((session) => session.id === "zz-large-name-test");
check("nama sesi bisa dikosongkan", clearedEntry?.name === "", JSON.stringify(clearedEntry?.name));

// 10. hapus sesi: current dan path luar harus ditolak, file non-current boleh dihapus
const unauthDelete = await fetch(`${base}/api/sessions/delete`, {
	method: "POST",
	headers: { "content-type": "application/json" },
	body: JSON.stringify({ path: "/etc/passwd" }),
});
check("hapus sesi butuh token", unauthDelete.status === 401, String(unauthDelete.status));
const rejectTraversal = await post("/api/sessions/delete", { path: "/etc/passwd" });
check("tolak hapus di luar folder sesi", rejectTraversal.status === 400, String(rejectTraversal.body?.error ?? ""));
const rejectCurrent = await post("/api/sessions/delete", { path: currentSession });
check("tolak hapus sesi aktif", rejectCurrent.status === 400, String(rejectCurrent.body?.error ?? ""));
const deleteLarge = await post("/api/sessions/delete", { path: largeFile });
check("hapus sesi non-current", deleteLarge.status === 200, String(deleteLarge.body?.error ?? ""));
check("file sesi terhapus", !(await fileExists(largeFile)));

// 10b. hapus massal: paths[] menghapus beberapa file sekaligus, yang gagal dilaporkan
const batchA = join(sessionDir, "zz-batch-a.jsonl");
const batchB = join(sessionDir, "zz-batch-b.jsonl");
for (const [file, id] of [
	[batchA, "zz-batch-a"],
	[batchB, "zz-batch-b"],
]) {
	await writeFile(
		file,
		`${JSON.stringify({ type: "session", version: 3, id, cwd: workspace })}\n`,
	);
}
const deleteBatch = await post("/api/sessions/delete", { paths: [batchA, batchB] });
check(
	"hapus sesi massal",
	deleteBatch.status === 200 && deleteBatch.body?.deleted?.length === 2,
	JSON.stringify(deleteBatch.body?.failed ?? deleteBatch.body?.error ?? "ok"),
);
check(
	"file sesi massal terhapus",
	!(await fileExists(batchA)) && !(await fileExists(batchB)),
);

const batchC = join(sessionDir, "zz-batch-c.jsonl");
await writeFile(
	batchC,
	`${JSON.stringify({ type: "session", version: 3, id: "zz-batch-c", cwd: workspace })}\n`,
);
const partialBatch = await post("/api/sessions/delete", {
	paths: [batchC, currentSession, "/etc/passwd"],
});
check(
	"hapus massal parsial tetap menghapus yang valid",
	partialBatch.body?.deleted?.length === 1 && !(await fileExists(batchC)),
	JSON.stringify(partialBatch.body?.deleted),
);
check(
	"hapus massal melaporkan yang gagal",
	partialBatch.body?.failed?.length === 2,
	JSON.stringify(partialBatch.body?.failed),
);

// 11. proyek: buat, assign, rename, hapus, persistensi
const projects0 = await get("/api/projects");
check("GET /api/projects", Array.isArray(projects0.projects), JSON.stringify(projects0.error ?? "ok"));
check("proyek awal kosong", (projects0.projects ?? []).length === 0);

const created = await post("/api/projects", { action: "create", name: "  proyek   satu  ", dir: sessionDir });
check("buat proyek", created.status === 200 && created.body?.projects?.length === 1, String(created.body?.error ?? ""));
const projectId = created.body?.projects?.[0]?.id;
check("nama proyek dinormalisasi", created.body?.projects?.[0]?.name === "proyek satu", created.body?.projects?.[0]?.name);
check("proyek menyimpan dir", created.body?.projects?.[0]?.dir === resolve(sessionDir), created.body?.projects?.[0]?.dir);

const assigned = await post("/api/projects", { action: "assign", sessionPath: currentSession, projectId });
check(
	"assign sesi ke proyek",
	assigned.status === 200 && assigned.body?.assignments?.[currentSession] === projectId,
	JSON.stringify(assigned.body?.assignments),
);

const badAssign = await post("/api/projects", { action: "assign", sessionPath: "relatif.jsonl", projectId });
check("tolak sessionPath relatif", badAssign.status === 400, String(badAssign.body?.error ?? ""));
const unknownProject = await post("/api/projects", { action: "assign", sessionPath: currentSession, projectId: "tidak-ada" });
check("tolak proyek tak dikenal", unknownProject.status === 404, String(unknownProject.body?.error ?? ""));
const unknownAction = await post("/api/projects", { action: "apa-ini" });
check("tolak action tak dikenal", unknownAction.status === 400, String(unknownAction.body?.error ?? ""));

const renamedProject = await post("/api/projects", { action: "rename", projectId, name: "proyek dua" });
check("rename proyek", renamedProject.body?.projects?.[0]?.name === "proyek dua", renamedProject.body?.projects?.[0]?.name);
const emptyName = await post("/api/projects", { action: "rename", projectId, name: "   " });
check("tolak nama kosong", emptyName.status === 400, String(emptyName.body?.error ?? ""));

const persisted = JSON.parse(await readFile(join(stateDir, "projects.json"), "utf8"));
check("projects.json tersimpan", persisted.projects?.[0]?.name === "proyek dua", JSON.stringify(persisted.projects?.[0] ?? null));
check("assignment tersimpan", persisted.assignments?.[currentSession] === projectId);

// Assignment dibersihkan saat file sesi dihapus.
const extraFile = join(sessionDir, "zz-assign-test.jsonl");
await writeFile(
	extraFile,
	`${JSON.stringify({ type: "session", version: 3, id: "zz-assign-test", cwd: workspace })}\n`,
);
const extraProject = await post("/api/projects", { action: "create", name: "hapus-assign" });
const extraProjectId = extraProject.body?.projects?.at(-1)?.id;
await post("/api/projects", { action: "assign", sessionPath: extraFile, projectId: extraProjectId });
const beforeExtraDelete = await get("/api/projects");
check("assignment sesi extra ada", beforeExtraDelete.assignments?.[extraFile] === extraProjectId);
const deleteExtra = await post("/api/sessions/delete", { path: extraFile });
check("hapus sesi extra", deleteExtra.status === 200, String(deleteExtra.body?.error ?? ""));
const afterExtraDelete = await get("/api/projects");
check("assignment hilang setelah sesi dihapus", !afterExtraDelete.assignments?.[extraFile]);

const removedProject = await post("/api/projects", { action: "delete", projectId });
check("hapus proyek", removedProject.status === 200 && !removedProject.body.projects.some((p) => p.id === projectId));
check("assignment proyek ikut dibersihkan", !removedProject.body.assignments?.[currentSession]);

// 12. sesi lama (di luar 60 terbaru) tetap tampil kalau masuk proyek
const oldFile = join(sessionDir, "zz-old-assigned.jsonl");
await writeFile(
	oldFile,
	`${JSON.stringify({ type: "session", version: 3, id: "zz-old-assigned", cwd: workspace })}\n`,
);
const longAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
await utimes(oldFile, longAgo, longAgo);
for (let index = 0; index < 61; index += 1) {
	await writeFile(
		join(sessionDir, `zz-filler-${String(index).padStart(2, "0")}.jsonl`),
		`${JSON.stringify({ type: "session", version: 3, id: `zz-filler-${index}`, cwd: workspace })}\n`,
	);
}
const listedBefore = await get("/api/sessions");
check(
	"sesi lama di luar 60 terbaru tidak tampil",
	!listedBefore.sessions?.some((session) => session.id === "zz-old-assigned"),
	`jumlah=${listedBefore.sessions?.length}`,
);
const oldProject = await post("/api/projects", { action: "create", name: "sesi lama" });
const oldProjectId = oldProject.body?.projects?.at(-1)?.id;
await post("/api/projects", { action: "assign", sessionPath: oldFile, projectId: oldProjectId });
const listedAfter = await get("/api/sessions");
check(
	"sesi lama yang di-assign tetap tampil",
	listedAfter.sessions?.some((session) => session.id === "zz-old-assigned"),
	`jumlah=${listedAfter.sessions?.length}`,
);

server.kill("SIGTERM");
await sleep(400);
console.log(failures === 0 ? "\nsemua tes lulus" : `\n${failures} tes gagal`);
process.exit(failures === 0 ? 0 : 1);
