const hashToken = new URLSearchParams(location.hash.replace(/^#/, "")).get("t");
export const token =
	hashToken || sessionStorage.getItem("pi-gui-token") || "";

if (token) sessionStorage.setItem("pi-gui-token", token);

export const headers = { "content-type": "application/json" };
if (token) headers.authorization = `Bearer ${token}`;

export async function api(command) {
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

export async function apiGet(path) {
	try {
		const res = await fetch(path, { headers });
		const body = await res.json().catch(() => null);
		if (!res.ok) return { error: body?.error ?? `HTTP ${res.status}` };
		return body ?? { error: "respons kosong" };
	} catch (error) {
		return { error: String(error?.message ?? error) };
	}
}

export async function postJson(path, payload) {
	try {
		const res = await fetch(path, {
			method: "POST",
			headers,
			body: JSON.stringify(payload ?? {}),
		});
		const body = await res.json().catch(() => null);
		return {
			ok: res.ok,
			status: res.status,
			body: body ?? {},
		};
	} catch (error) {
		return { ok: false, status: 0, body: { error: String(error?.message ?? error) } };
	}
}
