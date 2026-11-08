import { useMemo } from "react";
import { renderMarkdownHtml } from "../utils/markdown.js";

export default function MarkdownBlock({ source, allowAuto = true, className = "md" }) {
	const html = useMemo(
		() => renderMarkdownHtml(source, { allowAuto }),
		[source, allowAuto],
	);
	return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
