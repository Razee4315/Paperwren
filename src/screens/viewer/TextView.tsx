import { isDesktop } from "@/lib/env";
import { extensionOf } from "@/lib/formats";
import { t } from "@/lib/i18n";
import { sheet } from "@/lib/print";
import { decodeText } from "@/lib/text";
import { prettyXml } from "@/lib/xml";
import { useSettings } from "@/state/settings";
import { Button, IconButton, SheetItem } from "@/ui";
import DOMPurify from "dompurify";
import { Code, ListOrdered, Search, WrapText } from "lucide-react";
import { marked } from "marked";
import { useMemo, useRef, useState } from "react";
import {
	FindBar,
	Shell,
	ZoomControl,
	percentPresets,
	shellStyles,
} from "./Shell";
import s from "./Text.module.css";
import { useScrollMemory, useZoom, useZoomLevel } from "./hooks";
import type { ViewerProps } from "./types";
import { useDomFind } from "./useDomFind";

/** First chunk shown for very large text files; the rest on demand. */
const CHUNK = 1_000_000;
/** JSON and XML up to this many characters are laid out for reading. */
const PRETTY_MAX = 2_000_000;
/** Line numbers are drawn a line at a time; past this many lines the
 * page would be too heavy to scroll. */
const NUMBERED_MAX = 20_000;
const TEXT_SIZES = [80, 100, 125, 150, 200];

export default function TextView({
	data,
	name,
	format,
	position,
	onPosition,
	onClose,
	active,
}: ViewerProps) {
	const { settings, update } = useSettings();
	const scroller = useRef<HTMLDivElement>(null);
	const stage = useRef<HTMLDivElement>(null);
	const hud = useRef<HTMLDivElement>(null);
	const content = useRef<HTMLDivElement>(null);
	const [chromeHidden, setChromeHidden] = useState(false);
	const text = useMemo(() => {
		const raw = decodeText(data);
		// JSON and XML usually arrive on one line, written for machines:
		// lay them out for reading. Anything that does not parse is shown
		// as it is.
		const kind = extensionOf(name);
		if (raw.length > PRETTY_MAX) return raw;
		if (kind === "xml") return prettyXml(raw);
		if (kind !== "json") return raw;
		try {
			return JSON.stringify(JSON.parse(raw), null, 2);
		} catch {
			return raw;
		}
	}, [data, name]);
	const [all, setAll] = useState(text.length <= CHUNK);
	const [zoom, commit] = useZoomLevel(position);
	// Markdown can be read as it was written, too.
	const [source, setSource] = useState(false);
	const [numbered, setNumbered] = useState(false);
	const find = useDomFind(content, scroller);
	// Find looks through what is on the page: put all of it there first.
	const startFind = (query?: string) => {
		setAll(true);
		find.start(query);
	};

	const html = useMemo(() => {
		if (format !== "md" || source) return null;
		// File content is untrusted: sanitize before it reaches the DOM.
		return DOMPurify.sanitize(marked.parse(text, { async: false }) as string, {
			FORBID_TAGS: ["style", "script", "iframe", "form", "object", "embed"],
			FORBID_ATTR: ["style"],
		});
	}, [format, text, source]);

	const shown = all ? text : text.slice(0, CHUNK);
	const lines = useMemo(
		() => (numbered && html === null ? shown.split(/\r?\n/) : null),
		[numbered, html, shown],
	);
	const canNumber = useMemo(() => {
		let count = 1;
		for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1))
			if (++count > NUMBERED_MAX) return false;
		return true;
	}, [text]);

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

	const wrap = settings.wrapText;
	return (
		<Shell
			name={name}
			format={format}
			onClose={onClose}
			active={active}
			hud={hud}
			progressOf={scroller}
			chromeHidden={chromeHidden && !find.open}
			onFind={startFind}
			menu={(close) => (
				<>
					{format === "md" && (
						<SheetItem
							icon={<Code size={20} />}
							checked={source}
							onClick={() => {
								close();
								setSource((v) => !v);
							}}
							testId="text-source"
						>
							{t("Show source")}
						</SheetItem>
					)}
					{html === null && (
						<>
							<SheetItem
								icon={<WrapText size={20} />}
								checked={wrap}
								onClick={() => {
									close();
									update("wrapText", !wrap);
								}}
								testId="text-wrap"
							>
								{t("Wrap lines")}
							</SheetItem>
							<SheetItem
								icon={<ListOrdered size={20} />}
								checked={numbered}
								disabled={!canNumber}
								hint={
									canNumber
										? undefined
										: t("This file has too many lines to number")
								}
								onClick={() => {
									close();
									setNumbered((v) => !v);
								}}
								testId="text-lines"
							>
								{t("Line numbers")}
							</SheetItem>
						</>
					)}
				</>
			)}
			onPrint={(root) => {
				const clone = content.current?.cloneNode(true) as HTMLElement | null;
				if (!clone) return;
				clone.style.zoom = "";
				root.appendChild(sheet(clone, s.printed));
			}}
			pager={
				<>
					{/* The bar of a desktop has no room to spare for a label. */}
					{!isDesktop && (
						<span className={shellStyles.meta}>{t("Text size")}</span>
					)}
					<ZoomControl
						label={`${Math.round(zoom * 100)}%`}
						onOut={() => zoomBy(1 / 1.15)}
						onIn={() => zoomBy(1.15)}
						onReset={() => zoomTo(1)}
						resetLabel={t("Reset text size")}
						presets={percentPresets(TEXT_SIZES, zoom, zoomTo)}
						testId="text"
					/>
				</>
			}
			actions={
				<IconButton
					label={t("Find")}
					shortcut="Ctrl+F"
					onClick={() => startFind()}
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
				<div ref={stage} className={`${s.stage} ${wrap ? "" : s.wide}`}>
					<div ref={content} style={{ zoom }}>
						{html !== null ? (
							<article
								className={s.md}
								// biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized with DOMPurify above
								dangerouslySetInnerHTML={{ __html: html }}
							/>
						) : lines ? (
							<pre
								className={`${s.plain} ${s.numbered} ${wrap ? "" : s.nowrap}`}
								data-testid="text-numbered"
							>
								{lines.map((line, i) => (
									<div key={i}>{line || "​"}</div>
								))}
							</pre>
						) : (
							<pre className={`${s.plain} ${wrap ? "" : s.nowrap}`}>
								{shown}
							</pre>
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
