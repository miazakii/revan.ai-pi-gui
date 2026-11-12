export function relativeTime(ms) {
	const minutes = Math.round((Date.now() - ms) / 60_000);
	if (minutes < 1) return "baru saja";
	if (minutes < 60) return `${minutes} menit lalu`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours} jam lalu`;
	const days = Math.round(hours / 24);
	if (days < 30) return `${days} hari lalu`;
	return new Date(ms).toLocaleDateString("id-ID");
}

export function fmtNum(value) {
	if (value === null || value === undefined) return "?";
	if (value < 1000) return String(value);
	if (value < 1_000_000) return `${(value / 1000).toFixed(1)}k`;
	return `${(value / 1_000_000).toFixed(2)}M`;
}

export function truncate(text, max) {
	const value = String(text ?? "");
	if (value.length <= max) return value;
	return `${value.slice(0, max)}\n… dipotong (${value.length - max} karakter lagi)`;
}

export function contentText(content) {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((block) =>
			block.type === "text" ? block.text : block.type === "image" ? "[gambar]" : "",
		)
		.filter(Boolean)
		.join("\n");
}

export function clockTime(value) {
	if (!value) return "";
	const numeric = typeof value === "number" ? value : Date.parse(value);
	if (!Number.isFinite(numeric)) return "";
	return new Date(numeric).toLocaleTimeString("id-ID", {
		hour: "2-digit",
		minute: "2-digit",
	});
}
