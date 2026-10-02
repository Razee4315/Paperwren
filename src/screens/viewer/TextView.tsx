import { t } from "@/lib/i18n";
import { sheet } from "@/lib/print";
import { decodeText } from "@/lib/text";
import { Button, IconButton } from "@/ui";
import DOMPurify from "dompurify";
import { Search } from "lucide-react";
import { marked } from "marked";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { FindBar, Shell, ZoomControl, shellStyles } from "./Shell";
import s from "./Text.module.css";
import { useScrollMemory, useZoom } from "./hooks";
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
	const stage = useRef<HTMLDivElement>(null);
	const hud = useRef<HTMLDivElement>(null);
	const content = useRef<HTMLDivElement>(null);
	const [chromeHidden, setChromeHidden] = useState(false);
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

	useEffect(() => {
		if (position?.kind === "scroll" && position.zoom) setZoom(position.zoom);
	}, [position]);
	const commit = useCallback((z: number) => flushSync(() => setZoom(z)), []);
	const { zoomBy, zoomTo } = useZoom({
		scroller,
		content,
		stage,
		zoom,
		commit,
		hud,
		min: 0.6,
		max: 3,
		active,
		onTap: () => setChromeHidden((h) => !h),
	});
	useScrollMemory(scroller, true, position, onPosition, zoom);

	return (
		<Shell
			name={name}
			format={format}
			onClose={onClose}
			active={active}
			hud={hud}
			progressOf={scroller}
			chromeHidden={chromeHidden && !find.open}
			onFind={find.start}
			onPrint={(root) => {
				const clone = content.current?.cloneNode(true) as HTMLElement | null;
				if (!clone) return;
				clone.style.zoom = "";
				root.appendChild(sheet(clone, s.printed));
			}}
			bottom={
				<div className={shellStyles.pager}>
					<span className={shellStyles.meta}>{t("Text size")}</span>
					<ZoomControl
						label={`${Math.round(zoom * 100)}%`}
						onOut={() => zoomBy(1 / 1.15)}
						onIn={() => zoomBy(1.15)}
						onReset={() => zoomTo(1)}
						resetLabel={t("Reset text size")}
						testId="text"
					/>
				</div>
			}
			actions={
				<IconButton
					label={t("Find")}
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
				<div ref={stage} className={s.stage}>
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
				</div>
				{!all && (
					<div className={s.more}>
						<Button variant="secondary" onClick={() => setAll(true)}>
							{t("Show the rest ({n}k more characters)", {
								n: Math.round((text.length - CHUNK) / 1000),
							})}
						</Button>
					</div>
				)}
			</div>
		</Shell>
	);
}
