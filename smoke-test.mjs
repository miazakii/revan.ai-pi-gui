// Smoke test untuk pi-gui: start server, cek command RPC, stream satu prompt.
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 4790;
const cwd = await mkdtemp(join(tmpdir(), "pi-gui-test-"));
const server = spawn("node", ["server.mjs"], {
	env: { ...process.env, PORT: String(PORT), PI_CWD: cwd },
	stdio: ["ignore", "pipe", "pipe"],
});

let failures = 0;
function check(label, ok, detail = "") {
	console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
	if (!ok) failures += 1;
}

process.on("exit", () => {
	try {
		server.kill("SIGTERM");
	} catch {
		/* sudah mati */
	}
});

let token = "";
const waitToken = new Promise((resolve, reject) => {
	const timer = setTimeout(() => reject(new Error("token tidak muncul")), 15000);
	server.stderr.setEncoding("utf8");
	server.stderr.on("data", (chunk) => {
		process.stderr.write(chunk);
		const match = chunk.match(/[?#]t=([A-Za-z0-9_-]+)/);
		if (match && !token) {
			token = match[1];
			clearTimeout(timer);
			resolve();
		}
	});
});

await waitToken;
const base = `http://127.0.0.1:${PORT}`;
const auth = { "content-type": "application/json", authorization: `Bearer ${token}` };

async function command(body) {
	const res = await fetch(`${base}/api/command`, {
		method: "POST",
		headers: auth,
		body: JSON.stringify(body),
	});
	return res.json();
}

// 1. command dasar
for (const cmd of [
	{ type: "get_state" },
	{ type: "get_available_models" },
	{ type: "get_available_thinking_levels" },
	{ type: "get_session_stats" },
	{ type: "get_commands" },
	{ type: "get_messages" },
]) {
	const response = await command(cmd);
	check(cmd.type, response.success, response.success ? "" : response.error);
}

const state = await command({ type: "get_state" });
check("model terpilih", Boolean(state.data?.model), state.data?.model ? `${state.data.model.provider}/${state.data.model.id}` : "(none)");

// 2. SSE + satu prompt
const events = [];
const controller = new AbortController();
const stream = fetch(`${base}/api/events`, {
	headers: { authorization: `Bearer ${token}` },
	signal: controller.signal,
});
const reader = (await stream).body.getReader();
const decoder = new TextDecoder();
let buffer = "";
const settled = new Promise((resolve) => {
	(async () => {
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			let index;
			while ((index = buffer.indexOf("\n\n")) !== -1) {
				const chunk = buffer.slice(0, index);
				buffer = buffer.slice(index + 2);
				const data = chunk.split("\n").find((l) => l.startsWith("data: "));
				if (!data) continue;
				const record = JSON.parse(data.slice(6));
				events.push(record);
				if (record.type === "message_update" && record.assistantMessageEvent.type === "text_delta") {
					process.stdout.write(record.assistantMessageEvent.delta);
				}
				if (record.type === "agent_settled") return resolve();
			}
		}
	})().catch(() => {});
});

const userPrompt = process.argv[2] ?? "Balas dengan satu kata: OK";
const prompt = await command({ type: "prompt", message: userPrompt });
console.log("\nprompt →", JSON.stringify(prompt));

await Promise.race([settled, new Promise((r) => setTimeout(r, 90000))]);
controller.abort();

const counts = {};
for (const event of events) counts[event.type] = (counts[event.type] ?? 0) + 1;
console.log("\nevent types:", counts);
check("agent_settled diterima", events.some((e) => e.type === "agent_settled"));
check(
	"ada text delta",
	events.some(
		(event) =>
			event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta",
	),
);

const stats = await command({ type: "get_session_stats" });
check("get_session_stats setelah prompt", stats.success, JSON.stringify(stats.data?.tokens ?? {}));

const messages = await command({ type: "get_messages" });
check("jumlah message >= 3", (messages.data?.messages?.length ?? 0) >= 3, `${messages.data?.messages?.length ?? 0} pesan`);

server.kill("SIGTERM");
await rm(cwd, { recursive: true, force: true });
console.log(failures === 0 ? "\nsemua tes lulus" : `\n${failures} tes gagal`);
setTimeout(() => process.exit(failures === 0 ? 0 : 1), 300);
