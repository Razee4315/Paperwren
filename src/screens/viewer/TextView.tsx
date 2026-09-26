import { decodeText } from "@/lib/text";
import { Button, IconButton } from "@/ui";
import DOMPurify from "dompurify";
import { Search } from "lucide-react";
import { marked } from "marked";
import { useMemo, useRef, useState } from "react";
import { FindBar, Shell } from "./Shell";
import s from "./Text.module.css";
import { usePinchZoom, useScrollMemory } from "./hooks";
import type { ViewerProps } from "./types";
import { useDomFind } from "./useDomFind";

/** First chunk shown for very large text files; the rest on demand. */
const CHUNK = 1_000_000;

export default function TextView({
	data,
	name,
	format,
	position,
	onPosition,
	onClose,
	active,
}: ViewerProps) {
	const scroller = useRef<HTMLDivElement>(null);
	const content = useRef<HTMLDivElement>(null);
	const text = useMemo(() => decodeText(data), [data]);
	const [all, setAll] = useState(text.length <= CHUNK);
	const [zoom, setZoom] = useState(1);
	const find = useDomFind(content, scroller);

	const html = useMemo(() => {
		if (format !== "md") return null;
		// File content is untrusted: sanitize before it reaches the DOM.
		return DOMPurify.sanitize(marked.parse(text, { async: false }) as string, {
			FORBID_TAGS: ["style", "script", "iframe", "form", "object", "embed"],
			FORBID_ATTR: ["style"],
		});
	}, [format, text]);

	usePinchZoom(scroller, zoom, setZoom, 0.6, 3);
	useScrollMemory(scroller, true, position, onPosition);

	return (
		<Shell
			name={name}
			format={format}
			onClose={onClose}
			active={active}
			actions={
				<IconButton
					label="Find"
					onClick={find.start}
					active={find.open}
					data-testid="text-find"
				>
					<Search size={20} />
				</IconButton>
			}
			find={
				find.open ? (
					<FindBar
						state={find.state}
						onQuery={find.setQuery}
						onStep={find.step}
						onClose={find.close}
					/>
				) : undefined
			}
		>
			<div ref={scroller} className={s.wrap} data-testid="text-scroll">
				<div ref={content} style={{ zoom }}>
					{html !== null ? (
						<article
							className={s.md}
							// biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized with DOMPurify above
							dangerouslySetInnerHTML={{ __html: html }}
						/>
					) : (
						<pre className={s.plain}>{all ? text : text.slice(0, CHUNK)}</pre>
					)}
				</div>
				{!all && (
					<div className={s.more}>
						<Button variant="secondary" onClick={() => setAll(true)}>
							Show the rest ({Math.round((text.length - CHUNK) / 1000)}k more
							characters)
						</Button>
					</div>
				)}
			</div>
		</Shell>
	);
}
