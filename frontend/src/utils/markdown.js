const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ESCAPES[c]);

const markedLib = typeof marked !== "undefined" ? marked : null;
const hljsLib = typeof hljs !== "undefined" ? hljs : null;
const markedCjk = typeof markedCjkFriendly === "function" ? markedCjkFriendly : null;

const highlightCache = new Map();
const HIGHLIGHT_CACHE_LIMIT = 120;
let allowHighlightAuto = true;

export function sanitizeMarkdownUrl(value) {
	if (!value) return null;
	const stripped = String(value).replace(/[\u0000-\u001f\u007f]/g, "").trim();
	if (/^[\\/]{2}/.test(stripped) || stripped.startsWith("\\")) return null;
	if (/^(https?:|mailto:|data:image\/(?:png|jpe?g|gif|webp);base64,)/i.test(stripped)) return stripped;
	if (/^[a-z][a-z0-9+.-]*:/i.test(stripped)) return null;
	return stripped;
}

export function highlightCode(code, lang) {
	if (!hljsLib) return escapeHtml(code);
	const knownLang = Boolean(lang) && Boolean(hljsLib.getLanguage(lang));
	if (knownLang) {
		const key = `${lang}\u0000${code}`;
		const cached = highlightCache.get(key);
		if (cached !== undefined) {
			highlightCache.delete(key);
			highlightCache.set(key, cached);
			return cached;
		}
		try {
			const value = hljsLib.highlight(code, { language: lang }).value;
			highlightCache.set(key, value);
			if (highlightCache.size > HIGHLIGHT_CACHE_LIMIT) {
				highlightCache.delete(highlightCache.keys().next().value);
			}
			return value;
		} catch {
			return escapeHtml(code);
		}
	}
	if (!allowHighlightAuto) return escapeHtml(code);
	try {
		return hljsLib.highlightAuto(code).value;
	} catch {
		return escapeHtml(code);
	}
}

if (markedLib) {
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
	if (markedCjk) tokenizer.emStrong = markedCjk().tokenizer.emStrong;

	markedLib.use({
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
				return `<pre data-lang="${escapeHtml(lang)}"><code class="hljs">${highlightCode(code, lang)}</code></pre>`;
			},
			codespan(token) {
				return `<code>${escapeHtml(token.text)}</code>`;
			},
		},
	});
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

export function renderMarkdownHtml(source, { allowAuto = true } = {}) {
	const previous = allowHighlightAuto;
	allowHighlightAuto = allowAuto;
	try {
		let html;
		if (markedLib) {
			try {
				html = markedLib.parse(String(source ?? ""));
			} catch {
				html = escapeHtml(String(source ?? ""));
			}
		} else {
			html = mdFallback(source);
		}
		const holder = document.createElement("div");
		holder.innerHTML = html;
		decorateCodeBlocks(holder);
		return holder.innerHTML;
	} finally {
		allowHighlightAuto = previous;
	}
}
