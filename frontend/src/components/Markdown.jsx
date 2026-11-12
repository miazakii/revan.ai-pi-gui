import { useMemo } from "react";
import { renderMarkdownHtml } from "../utils/markdown.js";

export default function MarkdownBlock({ source, allowAuto = true, className = "md" }) {
	const html = useMemo(
		() => renderMarkdownHtml(source, { allowAuto }),
		[source, allowAuto],
	);
	const loadRemoteImage = (event) => {
		const button = event.target.closest?.("[data-remote-src]");
		if (!button) return;
		const source = button.getAttribute("data-remote-src");
		if (!source) return;
		const image = document.createElement("img");
		image.src = source;
		image.alt = button.textContent.replace(/^Muat gambar eksternal:\s*/, "");
		image.className = "md-remote-loaded";
		image.loading = "lazy";
		image.referrerPolicy = "no-referrer";
		button.replaceWith(image);
	};

	return (
		<div
			className={className}
			onClick={loadRemoteImage}
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	);
}
