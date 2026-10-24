import { isDesktop } from "@/lib/env";
import { extensionOf } from "@/lib/formats";
import {
	highlight,
	highlightBlocks,
	languageOf,
	splitLines,
} from "@/lib/highlight";
import { t } from "@/lib/i18n";
import { prettyJson } from "@/lib/json";
import { jsonTree } from "@/lib/jsonTree";
import { drawMaths, markdownMath } from "@/lib/markdownMath";
import { sheet } from "@/lib/print";
import { ENCODINGS, decodeText } from "@/lib/text";
import { prettyXml } from "@/lib/xml";
import { useSettings } from "@/state/settings";
import { Button, IconButton, Sheet, SheetItem } from "@/ui";
import DOMPurify from "dompurify";
import {
	ChevronsDownUp,
	ChevronsUpDown,
	Code,
	Languages,
	ListOrdered,
	ListTree,
	Network,
	Search,
	WrapText,
} from "lucide-react";
import { Marked } from "marked";
import { useEffect, useMemo, useRef, useState } from "react";
import { JsonTree, foldAll } from "./JsonTree";
import {
	FindBar,
	Shell,
	type SideTab,
	ZoomControl,
	percentPresets,
	shellStyles,
	usePageColor,
} from "./Shell";
import s from "./Text.module.css";
import { type Heading, HeadingList, readHeadings } from "./headings";
import {
	useScrollBookmarks,
	useScrollMemory,
	useTapToTurn,
	useZoom,
	useZoomLevel,
} from "./hooks";
import {
	PageCount,
	SidewaysItem,
	jumpTo,
	usePaged,
	useSideways,
} from "./paged";
import { domSpeech } from "./speechSources";
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

/** Markdown as GitHub reads it, with maths in TeX. */
const markdown = new Marked(markdownMath);

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
	const [encoding, setEncoding] = useState("auto");
	const [encodingOpen, setEncodingOpen] = useState(false);
	const text = useMemo(() => {
		const raw = decodeText(data, encoding);
		// JSON and XML usually arrive on one line, written for machines:
		// lay them out for reading. Anything that does not parse is shown
		// as it is.
		const kind = extensionOf(name);
		if (raw.length > PRETTY_MAX) return raw;
		if (kind === "xml") return prettyXml(raw);
		if (kind !== "json") return raw;
		return prettyJson(raw);
	}, [data, name, encoding]);
	const [all, setAll] = useState(text.length <= CHUNK);
	const [zoom, commit] = useZoomLevel(position);
	// Markdown can be read as it was written, too.
	const [source, setSource] = useState(false);
	const [numbered, setNumbered] = useState(false);
	// JSON reads as a tree to fold, as browsers show it; or as text.
	const [asTree, setAsTree] = useState(true);
	const tree = useMemo(
		() =>
			extensionOf(name) === "json" && text.length <= PRETTY_MAX
				? jsonTree(text)
				: null,
		[name, text],
	);
	const treeShown = asTree && tree !== null && tree !== "big" ? tree : null;
	const [outlineOpen, setOutlineOpen] = useState(false);
	const [headings, setHeadings] = useState<Heading[]>([]);
	const find = useDomFind(content, scroller);
	// Find looks through what is on the page: put all of it there first.
	const startFind = (query?: string) => {
		setAll(true);
		foldAll(content.current, true);
		find.start(query);
	};

	const html = useMemo(() => {
		if (format !== "md" || source) return null;
		// File content is untrusted: sanitize before it reaches the DOM.
		return DOMPurify.sanitize(
			markdown.parse(text, { async: false }) as string,
			{
				FORBID_TAGS: ["style", "script", "iframe", "form", "object", "embed"],
				FORBID_ATTR: ["style"],
			},
		);
	}, [format, text, source]);

	const shown = all ? text : text.slice(0, CHUNK);
	// Source code, with its syntax coloured.
	const language = useMemo(
		() => (format === "md" || treeShown ? null : languageOf(name)),
		[format, name, treeShown],
	);
	const [code, setCode] = useState<string | null>(null);
	useEffect(() => {
		let alive = true;
		setCode(null);
		if (language && html === null)
			highlight(shown, language)
				.then((coloured) => alive && setCode(coloured))
				.catch(() => {});
		return () => {
			alive = false;
		};
	}, [language, html, shown]);
	const lines = useMemo(
		() =>
			numbered && html === null && !treeShown
				? code !== null
					? splitLines(code)
					: shown.split(/\r?\n/)
				: null,
		[numbered, html, shown, code, treeShown],
	);
	// A Markdown file's code blocks, coloured once they are on the page.
	const article = useRef<HTMLElement>(null);
	// Its headings, to jump to, and its maths, drawn once KaTeX is in.
	useEffect(() => {
		const root = article.current;
		setHeadings(html !== null && root ? readHeadings(root) : []);
		if (html === null || !root) return;
		highlightBlocks(root);
		drawMaths(root).catch(() => {});
	}, [html]);
	// Pages turned sideways: text that flows, all of it on the page (a
	// tree folds and unfolds, and scrolls down).
	const [sideways] = useSideways();
	const canTurn = !treeShown && all;
	const paged = usePaged({
		scroller,
		paper: () => content.current?.firstElementChild as HTMLElement | null,
		on: sideways && canTurn,
		zoom,
		relayout: `${html?.length}|${code?.length}|${lines?.length}|${shown.length}|${settings.wrapText}|${source}`,
	});
	const turnPage = paged.pages ? paged.turn : undefined;
	const tapTurn = useTapToTurn(scroller, turnPage);
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
		onTap: (_target, x) => tapTurn(x) || setChromeHidden((h) => !h),
	});
	useScrollMemory(scroller, true, position, onPosition, zoom);
	const marks = useScrollBookmarks(scroller, content);
	const speech = useMemo(() => domSpeech(scroller, content), []);

	const goToHeading = (heading: Heading) => {
		const el = scroller.current;
		if (!el || !heading.el.isConnected) return;
		jumpTo(el, heading.el);
	};
	const pick = useRef(goToHeading);
	pick.current = goToHeading;
	const side = useMemo<SideTab[]>(
		() =>
			html !== null
				? [
						{
							id: "contents",
							label: t("Contents"),
							icon: <ListTree size={16} />,
							content: (
								<HeadingList
									headings={headings}
									onPick={(h) => pick.current(h)}
									compact
								/>
							),
						},
					]
				: [],
		[html, headings],
	);

	const wrap = settings.wrapText;
	// Text is drawn in the app's own colours; a page colour of its own
	// lends it those of the theme that has it.
	const paper = usePageColor();
	return (
		<Shell
			name={name}
			format={format}
			onClose={onClose}
			active={active}
			hud={hud}
			progressOf={scroller}
			paper
			side={side}
			bookmarks={marks}
			speech={speech}
			chromeHidden={chromeHidden && !find.open}
			onFind={startFind}
			onStep={turnPage}
			turnPages={!!turnPage}
			menu={(close) => (
				<>
					<SidewaysItem
						close={close}
						disabled={!canTurn}
						hint={
							treeShown
								? t("A tree scrolls down")
								: !all
									? t("Show the whole file first")
									: undefined
						}
					/>
					{html !== null && !isDesktop && headings.length > 0 && (
						<SheetItem
							icon={<ListTree size={20} />}
							onClick={() => {
								close();
								setOutlineOpen(true);
							}}
							testId="doc-contents"
						>
							{t("Contents")}
						</SheetItem>
					)}
					{tree !== null && (
						<SheetItem
							icon={<Network size={20} />}
							checked={treeShown !== null}
							disabled={tree === "big"}
							hint={
								tree === "big"
									? t("This file is too big to show as a tree")
									: undefined
							}
							onClick={() => {
								close();
								setAsTree((v) => !v);
							}}
							testId="text-tree"
						>
							{t("Show as a tree")}
						</SheetItem>
					)}
					{treeShown && (
						<>
							<SheetItem
								icon={<ChevronsDownUp size={20} />}
								onClick={() => {
									close();
									foldAll(content.current, false);
								}}
								testId="tree-fold"
							>
								{t("Fold everything")}
							</SheetItem>
							<SheetItem
								icon={<ChevronsUpDown size={20} />}
								onClick={() => {
									close();
									foldAll(content.current, true);
								}}
								testId="tree-unfold"
							>
								{t("Unfold everything")}
							</SheetItem>
						</>
					)}
					<SheetItem
						icon={<Languages size={20} />}
						onClick={() => {
							close();
							setEncodingOpen(true);
						}}
						testId="text-encoding"
					>
						{t("Text encoding")}
					</SheetItem>
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
					{html === null && !treeShown && (
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
					{paged.pages ? (
						<PageCount paged={paged} />
					) : (
						!isDesktop && (
							<span className={shellStyles.meta}>{t("Text size")}</span>
						)
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
						options={find.options}
						onOptions={find.setOptions}
					/>
				) : undefined
			}
		>
			<div
				ref={scroller}
				className={s.wrap}
				data-theme={paper === "original" ? undefined : paper}
				data-testid="text-scroll"
			>
				<div ref={stage} className={`${s.stage} ${wrap ? "" : s.wide}`}>
					<div ref={content} style={{ zoom }}>
						{html !== null ? (
							<article
								ref={article}
								className={`${s.md} pw-reading`}
								// biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized with DOMPurify above
								dangerouslySetInnerHTML={{ __html: html }}
							/>
						) : treeShown ? (
							<JsonTree root={treeShown} />
						) : lines ? (
							<pre
								className={`${s.plain} ${s.numbered} ${wrap ? "" : s.nowrap}`}
								data-testid="text-numbered"
							>
								{code !== null
									? lines.map((line, i) => (
											<div
												key={i}
												// biome-ignore lint/security/noDangerouslySetInnerHtml: highlight.js escapes the text it colours
												dangerouslySetInnerHTML={{ __html: line || "​" }}
											/>
										))
									: lines.map((line, i) => <div key={i}>{line || "​"}</div>)}
							</pre>
						) : code !== null ? (
							<pre
								className={`${s.plain} ${s.code} ${wrap ? "" : s.nowrap}`}
								data-testid="text-code"
							>
								<code
									className="hljs"
									// biome-ignore lint/security/noDangerouslySetInnerHtml: highlight.js escapes the text it colours
									dangerouslySetInnerHTML={{ __html: code }}
								/>
							</pre>
						) : (
							<pre className={`${s.plain} ${wrap ? "" : s.nowrap}`}>
								{shown}
							</pre>
						)}
					</div>
				</div>
				{!all && !treeShown && (
					<div className={s.more}>
						<Button variant="secondary" onClick={() => setAll(true)}>
							{t("Show the rest ({n}k more characters)", {
								n: Math.round((text.length - CHUNK) / 1000),
							})}
						</Button>
					</div>
				)}
			</div>
			<Sheet
				open={outlineOpen}
				title={t("Contents")}
				onClose={() => setOutlineOpen(false)}
				wide
			>
				<HeadingList
					headings={headings}
					onPick={(h) => {
						setOutlineOpen(false);
						goToHeading(h);
					}}
				/>
			</Sheet>
			<Sheet
				open={encodingOpen}
				title={t("Text encoding")}
				onClose={() => setEncodingOpen(false)}
			>
				{ENCODINGS.map((value) => (
					<SheetItem
						key={value}
						checked={encoding === value}
						onClick={() => {
							setEncoding(value);
							setEncodingOpen(false);
						}}
					>
						{value === "auto" ? t("Automatic") : value.toUpperCase()}
					</SheetItem>
				))}
			</Sheet>
		</Shell>
	);
}
