// Headless render check via Chrome DevTools Protocol (tanpa dependency).
// Pakai: node render-check.mjs "http://127.0.0.1:4791/?t=..."

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url = process.argv[2];
if (!url) throw new Error("URL wajib");
const t0 = Date.now();
const step = (label) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${label}`);
step("mulai");

const CHROME =
	process.env.CHROME_BIN ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

async function freePort() {
	return new Promise((resolve, reject) => {
		const probe = createServer();
		probe.once("error", reject);
		probe.listen(0, "127.0.0.1", () => {
			const { port } = probe.address();
			probe.close(() => resolve(port));
		});
	});
}

const PORT = await freePort();
const profile = mkdtempSync(join(tmpdir(), "pi-gui-cdp-"));

let failures = 0;
function check(label, ok, detail = "") {
	console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
	if (!ok) failures += 1;
}

const chrome = spawn(
	CHROME,
	[
		"--headless=new",
		"--disable-gpu",
		"--window-size=1280,900",
		"--no-first-run",
		"--no-default-browser-check",
		`--user-data-dir=${profile}`,
		`--remote-debugging-port=${PORT}`,
		"about:blank",
	],
	{ stdio: "ignore" },
);

process.on("exit", () => {
	try {
		chrome.kill("SIGTERM");
	} catch {
		/* sudah mati */
	}
	rmSync(profile, { recursive: true, force: true });
});

async function targets() {
	for (let i = 0; i < 60; i++) {
		try {
			const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
			return await response.json();
		} catch {
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
	}
	throw new Error("chrome tidak siap");
}

step("chrome siap");
const list = await targets();
const page = list.find((target) => target.type === "page");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
	socket.onopen = resolve;
	socket.onerror = reject;
});

let seq = 0;
const waiters = new Map();
const logs = [];

socket.onmessage = (event) => {
	const message = JSON.parse(event.data);
	if (message.id && waiters.has(message.id)) {
		waiters.get(message.id)(message);
		waiters.delete(message.id);
		return;
	}
	if (message.method === "Runtime.consoleAPICalled") {
		logs.push([
			"console",
			message.params.type,
			message.params.args.map((arg) => arg.value ?? arg.description).join(" "),
		]);
	}
	if (message.method === "Runtime.exceptionThrown") {
		logs.push([
			"exception",
			message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text,
		]);
	}
	if (message.method === "Log.entryAdded") {
		logs.push(["log", message.params.entry.level, message.params.entry.text]);
	}
};

function send(method, params = {}) {
	const id = ++seq;
	socket.send(JSON.stringify({ id, method, params }));
	return new Promise((resolve) => waiters.set(id, resolve));
}

await send("Runtime.enable");
await send("Log.enable");
await send("Page.enable");
await send("Page.navigate", { url });
step("navigasi");

const evaluate = async (expression) =>
	(await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }))
		.result?.result?.value;

async function waitFor(expression, timeout = 15000) {
	const started = Date.now();
	while (Date.now() - started < timeout) {
		if (await evaluate(expression)) return true;
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	return false;
}


async function clickTab(tab) {
	const label = JSON.stringify(tab);
	return evaluate(`(() => {
		const el = document.querySelector('.side-tab[data-tab=' + ${label} + ']');
		if (!el) return false;
		el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
		el.click();
		return true;
	})()`);
}

const bootReady = await waitFor(
	"document.querySelector('#model option') && document.querySelector('#status')?.textContent === 'siap'",
	25000,
);
check("UI siap", bootReady);
step("dom siap");

step("cek sidebar");
const userPrompt = process.argv[3];
if (userPrompt) {
	const beforeAssistant = await evaluate("document.querySelectorAll('.msg.assistant:not(.live)').length");
	await evaluate(`(() => {
		const input = document.querySelector('#input');
		input.value = ${JSON.stringify(userPrompt)};
		input.dispatchEvent(new Event('input'));
		document.querySelector('#send').click();
		return true;
	})()`);
	const answered = await waitFor(
		`document.querySelectorAll('.msg.assistant:not(.live)').length > ${beforeAssistant} && document.querySelector('#status')?.textContent === 'siap'`,
		60000,
	);
	check("prompt dari UI selesai", answered);

	const toolCount = await evaluate("document.querySelectorAll('.tool').length");
	if (toolCount > 0) {
		await evaluate("document.querySelector('.tool button')?.click()");
		await new Promise((resolve) => setTimeout(resolve, 400));
		const toolOutput = await evaluate("document.querySelector('.tool-output')?.textContent");
		check("output tool tampil setelah dibuka", Boolean(toolOutput), String(toolOutput ?? "").slice(0, 80));
	}
}

console.log("status     :", await evaluate("document.querySelector('#status')?.textContent"));
console.log("banner     :", await evaluate("document.querySelector('#banner')?.classList.contains('hidden') ? '(hidden)' : document.querySelector('#banner-text')?.textContent"));
console.log("cwd        :", await evaluate("document.querySelector('#cwd')?.value"));
console.log("models     :", await evaluate("document.querySelectorAll('#model option').length"));
console.log("thinking   :", await evaluate("document.querySelectorAll('#thinking option').length"));
console.log("messages   :", await evaluate("document.querySelectorAll('.msg').length"));
console.log("tool cards :", await evaluate("document.querySelectorAll('.tool').length"));
console.log("tool output:", JSON.stringify((await evaluate("document.querySelector('.tool-output')?.textContent"))?.slice(0, 120)));
console.log("queue      :", await evaluate("document.querySelector('#queue')?.innerText"));
console.log("diff lines :", await evaluate("document.querySelectorAll('.diff-line').length"));
console.log("diffstat   :", await evaluate("document.querySelector('.tool-diffstat')?.textContent"));
console.log("md tables  :", await evaluate("document.querySelectorAll('.md table').length"));
console.log("md code    :", await evaluate("document.querySelectorAll('.md pre code.hljs').length"));
console.log("copy btn   :", await evaluate("document.querySelectorAll('.code-head [data-copy]').length"));

// sidebar: sesi + tree
await evaluate("document.querySelector('#sidebar-toggle').click()");
await new Promise((resolve) => setTimeout(resolve, 1600));
console.log("sessions   :", await evaluate("document.querySelectorAll('.session-item').length"));
console.log("session cur:", await evaluate("document.querySelectorAll('.session-item.current').length"));
await clickTab("tree");
await new Promise((resolve) => setTimeout(resolve, 1600));
console.log("tree nodes :", await evaluate("document.querySelectorAll('.tree-node').length"));
console.log("tree active:", await evaluate("document.querySelectorAll('.tree-node.active').length"));
console.log("tree forks :", await evaluate("document.querySelectorAll('.tree-node.forkable').length"));

if (process.env.PI_GUI_TEST_FORK) {
	await evaluate("document.querySelector('.tree-node.forkable').click()");
	await new Promise((resolve) => setTimeout(resolve, 700));
	console.log(
		"modal      :",
		JSON.stringify(await evaluate("[...document.querySelectorAll('#modal button')].map((b) => b.textContent)")),
	);
	await evaluate(
		"[...document.querySelectorAll('#modal button')].find((b) => b.textContent === 'fork').click()",
	);
	await new Promise((resolve) => setTimeout(resolve, 2500));
	await clickTab("sessions");
	await new Promise((resolve) => setTimeout(resolve, 1500));
	console.log("after fork :", await evaluate("document.querySelectorAll('.session-item').length"));
	console.log("fork status:", await evaluate("document.querySelector('#status')?.textContent"));
	console.log("editor     :", JSON.stringify(await evaluate("document.querySelector('#input')?.value")));
}
console.log("stats      :", await evaluate("document.querySelector('#stats')?.textContent"));

const treeCount = await evaluate("document.querySelectorAll('.tree-node').length");
// Kembali ke tab sesi sebelum memeriksa daftar (sebelumnya tab tree aktif).
await clickTab("sessions");
await waitFor("document.querySelectorAll('.session-item').length > 0", 8000);
const finalStatus = await evaluate("document.querySelector('#status')?.textContent");
const bannerHidden = await evaluate("document.querySelector('#banner')?.classList.contains('hidden')");
const modelCount = await evaluate("document.querySelectorAll('#model option').length");
const sessionCount = await evaluate("document.querySelectorAll('.session-item').length");
const currentCount = await evaluate("document.querySelectorAll('.session-item.current').length");
const currentDelete = await evaluate("document.querySelectorAll('.session-item.current .session-delete').length");
check("status siap", finalStatus === "siap", finalStatus);
check("banner tidak menutupi UI", bannerHidden === true);
check("model termuat", modelCount > 0, String(modelCount));
const tailwindApplied = await evaluate(
	"getComputedStyle(document.querySelector('.brand')).userSelect === 'none'",
);
check("utility Tailwind aktif", tailwindApplied === true, String(tailwindApplied));
check("daftar sesi termuat", sessionCount > 0, String(sessionCount));
check("sesi aktif ditandai", currentCount === 1, String(currentCount));
check("sesi aktif tanpa tombol hapus", currentDelete === 0, String(currentDelete));
check("tree sesi termuat", process.env.PI_GUI_TEST_FORK ? true : treeCount > 0, String(treeCount));
if (userPrompt) {
	check(
		"pesan user tampil",
		process.env.PI_GUI_TEST_FORK
			? true
			: (await evaluate("document.querySelectorAll('.msg.user').length")) > 0,
	);
}
step("selesai cek utama");

if (process.env.PI_GUI_TEST_UI) {
	// slash menu
	await evaluate(`(() => {
		const i = document.querySelector('#input');
		i.value = '/';
		i.dispatchEvent(new Event('input'));
		return true;
	})()`);
	await new Promise((resolve) => setTimeout(resolve, 600));
	const slashCount = await evaluate("document.querySelectorAll('.slash-item').length");
	const slashFirst = await evaluate("document.querySelector('.slash-item .cmd')?.textContent");
	check("slash menu tampil", slashCount > 0, String(slashCount));
	check("slash item berisi command", String(slashFirst ?? "").startsWith("/"), String(slashFirst));
	await evaluate(`(() => {
		const i = document.querySelector('#input');
		i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		i.value = '';
		i.dispatchEvent(new Event('input'));
		return true;
	})()`);
	await new Promise((resolve) => setTimeout(resolve, 400));
	const slashHidden = await evaluate("document.querySelector('#slash')?.classList.contains('hidden')");
	check("slash menu tertutup dengan Esc", slashHidden === true);

	// tempel gambar 1x1 PNG
	await evaluate(`(async () => {
		const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
		const file = new File([bytes], 'dot.png', { type: 'image/png' });
		const transfer = new DataTransfer();
		transfer.items.add(file);
		document.querySelector('#input').dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
		return true;
	})()`);
	await new Promise((resolve) => setTimeout(resolve, 900));
	const pastedAttachments = await evaluate("document.querySelectorAll('.attachment').length");
	check("paste gambar jadi lampiran", pastedAttachments === 1, String(pastedAttachments));

	// kirim dengan gambar
	await evaluate(`(() => {
		const i = document.querySelector('#input');
		i.value = 'Balas satu kata: GAMBAR';
		i.dispatchEvent(new Event('input'));
		document.querySelector('#send').click();
		return true;
	})()`);
	await new Promise((resolve) => setTimeout(resolve, 15000));
	const userImages = await evaluate("document.querySelectorAll('.msg.user .msg-image').length");
	const attachmentsAfter = await evaluate("document.querySelectorAll('.attachment').length");
	check("gambar terkirim di pesan user", userImages > 0, String(userImages));
	check("lampiran dibersihkan setelah kirim", attachmentsAfter === 0, String(attachmentsAfter));
}

if (process.env.PI_GUI_TEST_STOP) {
	await evaluate(`(() => {
		const input = document.querySelector('#input');
		input.value = 'Jalankan tool bash: sleep 30. Jangan balas apa pun sebelum tool selesai.';
		input.dispatchEvent(new Event('input'));
		document.querySelector('#send').click();
		return true;
	})()`);
	const runStarted = await waitFor("document.querySelector('#status')?.textContent.includes('berjalan')", 20000);
	check("run mulai", runStarted);

	await evaluate(`(() => {
		document.querySelector('#behavior').value = 'followUp';
		const input = document.querySelector('#input');
		input.value = 'PESAN-QUEUE-UI';
		input.dispatchEvent(new Event('input'));
		document.querySelector('#send').click();
		return true;
	})()`);
	await new Promise((resolve) => setTimeout(resolve, 1500));
	const queued = await evaluate("document.querySelectorAll('#queue .chip').length");
	check("queue tampil", queued > 0, String(queued));

	await evaluate("document.querySelector('#abort').click()");
	await waitFor("document.querySelectorAll('#queue .chip').length === 0", 15000);
	await waitFor("document.querySelector('#status')?.textContent === 'siap'", 15000);
	const restoredValue = await evaluate("document.querySelector('#input')?.value");
	const queueAfter = await evaluate("document.querySelectorAll('#queue .chip').length");
	const statusAfter = await evaluate("document.querySelector('#status')?.textContent");
	check("queue kosong setelah stop", queueAfter === 0, String(queueAfter));
	check("teks queue kembali ke editor", restoredValue.includes("PESAN-QUEUE-UI"), JSON.stringify(restoredValue));
	check("status siap setelah stop", statusAfter === "siap", statusAfter);
}

if (process.env.PI_GUI_TEST_RENAME) {
	await evaluate("document.querySelector('#side-rename').click()");
	await new Promise((resolve) => setTimeout(resolve, 500));
	await evaluate(`(() => {
		const field = document.querySelector('#modal input');
		field.value = 'uji-ui';
		document.querySelector('#modal .primary').click();
		return true;
	})()`);
	await new Promise((resolve) => setTimeout(resolve, 1500));
	const titleAfter = await evaluate("document.title");
	const modalHidden = await evaluate("!document.querySelector('#modal')");
	await clickTab("sessions");
	await waitFor("document.querySelector('#side-body')?.innerText.includes('uji-ui')", 8000);
	const currentName = await evaluate("document.querySelector('.session-item.current .s-preview')?.textContent");
	const listHasName = await evaluate("document.querySelector('#side-body')?.innerText.includes('uji-ui')");
	check("judul tab rename", titleAfter.includes("uji-ui"), titleAfter);
	check("modal rename tertutup", modalHidden === true);
	check("preview sesi aktif rename", currentName === "uji-ui", JSON.stringify(currentName));
	check("daftar sesi memuat nama", listHasName === true);
}

if (process.env.PI_GUI_TEST_DELETE) {
	const targetName = process.env.PI_GUI_TEST_DELETE_NAME ?? "sesi-hapus-ui";
	const clicked = await evaluate(`(() => {
		const rows = [...document.querySelectorAll('.session-row')];
		const row = rows.find((item) => item.querySelector('.s-preview')?.textContent === ${JSON.stringify(targetName)});
		if (!row) return false;
		row.querySelector('.session-delete')?.click();
		return true;
	})()`);
	check("tombol hapus sesi ditemukan", clicked === true);
	const modalOpen = await waitFor("Boolean(document.querySelector('#modal'))", 4000);
	check("konfirmasi hapus tampil", modalOpen);
	await evaluate("[...document.querySelectorAll('#modal button')].find((button) => button.textContent === 'hapus')?.click()");
	const gone = await waitFor(
		`![...document.querySelectorAll('.session-row .s-preview')].some((item) => item.textContent === ${JSON.stringify(targetName)})`,
		8000,
	);
	check("sesi hilang dari sidebar", gone);
}

if (process.env.PI_GUI_TEST_MULTI_DELETE) {
	await clickTab("sessions");
	await waitFor("document.querySelectorAll('.session-row').length > 1", 8000);
	const before = await evaluate("document.querySelectorAll('.session-row').length");
	const selectable = await evaluate(
		"document.querySelectorAll('.session-row:not(:has(.session-item.current))').length",
	);
	check("ada sesi non-aktif untuk dipilih", selectable > 0, String(selectable));

	await evaluate("document.querySelector('#side-select')?.click()");
	const modeOn = await waitFor("Boolean(document.querySelector('#side-selection'))", 4000);
	check("mode pilih aktif", modeOn);

	await evaluate("document.querySelector('#side-select-all')?.click()");
	await new Promise((resolve) => setTimeout(resolve, 200));
	const countLabel = await evaluate("document.querySelector('#side-selected-count')?.textContent");
	check("pilih semua mengisi pilihan", /[1-9]/.test(countLabel ?? ""), JSON.stringify(countLabel));

	await evaluate("document.querySelector('#side-delete-selected')?.click()");
	const modalOpen = await waitFor("Boolean(document.querySelector('#modal'))", 4000);
	check("konfirmasi hapus massal tampil", modalOpen);
	await evaluate("document.querySelector('#modal .danger')?.click()");

	const modeClosed = await waitFor("!document.querySelector('#side-selection')", 8000);
	check("mode pilih tertutup setelah hapus", modeClosed);
	const reduced = await waitFor(
		`document.querySelectorAll('.session-row').length < ${before}`,
		8000,
	);
	const after = await evaluate("document.querySelectorAll('.session-row').length");
	check("jumlah sesi berkurang", reduced === true, `${before} → ${after}`);
}

if (process.env.PI_GUI_TEST_PROJECTS) {
	const projectName = "proyek-ui";
	await clickTab("sessions");
	await waitFor("document.querySelectorAll('.session-row').length > 0", 8000);
	const totalRows = await evaluate("document.querySelectorAll('.session-row').length");

	// Buat proyek lewat tombol di bawah sidebar.
	await evaluate("document.querySelector('#side-new-project')?.click()");
	await new Promise((resolve) => setTimeout(resolve, 400));
	await evaluate(`(() => {
		const field = document.querySelector('#modal input');
		if (!field) return false;
		field.value = ${JSON.stringify(projectName)};
		document.querySelector('#modal .primary')?.click();
		return true;
	})()`);
	const projectShown = await waitFor(
		`[...document.querySelectorAll('.project-name')].some((node) => node.textContent === ${JSON.stringify(projectName)})`,
		8000,
	);
	check("proyek baru tampil", projectShown);

	// Drag sesi dari grup "tanpa proyek" ke proyek (DragEvent sintetis).
	const dragResult = await evaluate(`(() => {
		const group = [...document.querySelectorAll('.project')].find(
			(node) => node.querySelector('.project-name')?.textContent === ${JSON.stringify(projectName)},
		);
		const row = document.querySelector('.project.loose .session-row') ?? document.querySelector('.session-row');
		if (!group || !row) return 'tidak ada target';
		const sessionPath = row.dataset.path;
		const transfer = new DataTransfer();
		row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }));
		group.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
		group.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
		row.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: transfer }));
		return sessionPath ?? 'tanpa path';
	})()`);
	check(
		"drag-drop dijalankan",
		typeof dragResult === "string" && dragResult.endsWith(".jsonl"),
		String(dragResult),
	);

	const movedIntoProject = await waitFor(
		`[...document.querySelectorAll('.project')].find((node) => node.querySelector('.project-name')?.textContent === ${JSON.stringify(projectName)})?.querySelectorAll('.session-row').length === 1`,
		8000,
	);
	check("sesi pindah ke proyek", movedIntoProject);
	check(
		"jumlah sesi tidak berubah",
		(await evaluate("document.querySelectorAll('.session-row').length")) === totalRows,
		String(totalRows),
	);

	// Persistensi: reload halaman, buka sidebar lagi.
	await send("Page.reload", { ignoreCache: true });
	await new Promise((resolve) => setTimeout(resolve, 1200));
	await waitFor("document.querySelector('#status')?.textContent === 'siap'", 25000);
	await evaluate("document.querySelector('#sidebar-toggle')?.click()");
	const survived = await waitFor(
		`[...document.querySelectorAll('.project')].find((node) => node.querySelector('.project-name')?.textContent === ${JSON.stringify(projectName)})?.querySelectorAll('.session-row').length === 1`,
		12000,
	);
	check("pengelompokan bertahan setelah reload", survived);

	// Rename proyek.
	await evaluate(`(() => {
		const group = [...document.querySelectorAll('.project')].find(
			(node) => node.querySelector('.project-name')?.textContent === ${JSON.stringify(projectName)},
		);
		group?.querySelector('.project-action')?.click();
		return Boolean(group);
	})()`);
	await new Promise((resolve) => setTimeout(resolve, 400));
	await evaluate(`(() => {
		const field = document.querySelector('#modal input');
		if (!field) return false;
		field.value = 'proyek-ui-2';
		document.querySelector('#modal .primary')?.click();
		return true;
	})()`);
	check(
		"rename proyek dari sidebar",
		await waitFor("[...document.querySelectorAll('.project-name')].some((node) => node.textContent === 'proyek-ui-2')", 8000),
	);

	// Hapus proyek: sesi kembali ke "tanpa proyek", file sesi tidak dihapus.
	await evaluate(`(() => {
		const group = [...document.querySelectorAll('.project')].find(
			(node) => node.querySelector('.project-name')?.textContent === 'proyek-ui-2',
		);
		group?.querySelector('.project-action.danger')?.click();
		return Boolean(group);
	})()`);
	await new Promise((resolve) => setTimeout(resolve, 400));
	await evaluate(
		"[...document.querySelectorAll('#modal button')].find((button) => button.textContent === 'hapus proyek')?.click()",
	);
	check(
		"hapus proyek dari sidebar",
		await waitFor("![...document.querySelectorAll('.project-name')].some((node) => node.textContent === 'proyek-ui-2')", 8000),
	);
	check(
		"sesi tetap ada setelah proyek dihapus",
		(await evaluate("document.querySelectorAll('.session-row').length")) === totalRows,
	);
	check(
		"sesi kembali ke daftar tanpa proyek",
		(await evaluate("document.querySelectorAll('.project').length")) === 0 &&
			(await evaluate("document.querySelectorAll('.session-row').length")) === totalRows,
	);
}

console.log("text       :", JSON.stringify((await evaluate("document.querySelector('#transcript')?.innerText"))?.slice(0, 400)));
console.log("logs       :", JSON.stringify(logs, null, 2));

if (process.env.PI_GUI_TEST_XSS) {
	const xssImg = await evaluate("marked.parse('<img src=x onerror=alert(1)>')");
	const xssScript = await evaluate("marked.parse('<script>alert(1)</script>')");
	const xssLink = await evaluate("marked.parse('[x](javascript:alert(1))')");
	const xssData = await evaluate("marked.parse('![x](data:text/html;base64,PHNjcmlwdD4=)')");
	const xssRel = await evaluate("marked.parse('[x](//evil.com/path)')");
	const xssImgRel = await evaluate("marked.parse('![x](//evil.com/i.png)')");
	const xssBackslash = await evaluate(
		"marked.parse('[x](' + String.fromCharCode(92) + 'evil.com/path)')",
	);
	check("XSS raw html di-escape", !xssImg.includes("<img") && !xssScript.includes("<script"));
	check("XSS javascript: ditolak", !xssLink.includes("javascript:"), JSON.stringify(xssLink));
	check("XSS data:text/html ditolak", !xssData.includes("data:text/html"), JSON.stringify(xssData));
	check(
		"XSS protocol-relative ditolak",
		!xssRel.includes("href") && !xssImgRel.includes("src"),
		JSON.stringify([xssRel, xssImgRel]),
	);
	check("XSS backslash ditolak", !xssBackslash.includes("href"), JSON.stringify(xssBackslash));
}

const badLogs = logs.filter(
	([kind, level]) =>
		kind === "exception" ||
		(kind === "log" && level === "error") ||
		(kind === "console" && level === "error"),
);
check("tidak ada error console/CSP", badLogs.length === 0, JSON.stringify(badLogs));

step("selesai");
socket.close();
chrome.kill("SIGTERM");
console.log(failures === 0 ? "\nsemua cek lulus" : `\n${failures} cek gagal`);
process.exitCode = failures === 0 ? 0 : 1;
