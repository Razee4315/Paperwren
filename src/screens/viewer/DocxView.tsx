import { isDesktop } from "@/lib/env";
import { t } from "@/lib/i18n";
import { fitted } from "@/lib/print";
import { useSettings } from "@/state/settings";
import {
	Button,
	ErrorArt,
	IconButton,
	Sheet,
	SheetItem,
	Spinner,
	StateView,
} from "@/ui";
import {
	BookOpenText,
	ListTree,
	MessageSquareText,
	Search,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import "@/styles/office-fonts.css";
import { PageJump } from "./Dialogs";
import s from "./Doc.module.css";
import { Scrubber } from "./Scrubber";
import {
	FindBar,
	Shell,
	type SideTab,
	ZoomControl,
	percentPresets,
	shellStyles,
} from "./Shell";
import { seedListCounters } from "./docxLists";
import { type Heading, HeadingList, readHeadings } from "./headings";
import {
	useOfficeDetails,
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

/** A page is never opened larger than this: on a wide window it sits
 * at a comfortable reading size instead of being stretched to fill it
 * (the same ceiling a PDF opens at). */
const MAX_FIT = 1.25;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 5;
const ZOOM_LEVELS = [50, 75, 100, 125, 150, 200];

/** True when the package carries comments (word/comments.xml): a ZIP
 * lists its entries by name, uncompressed, in its directory. */
function hasComments(data: ArrayBuffer): boolean {
	const bytes = new Uint8Array(data);
	const needle = "word/comments.xml";
	// The directory is at the end of the file; a megabyte of it is ample.
	const from = Math.max(0, bytes.length - 1_000_000);
	outer: for (let i = bytes.length - needle.length; i >= from; i--) {
		for (let j = 0; j < needle.length; j++)
			if (bytes[i + j] !== needle.charCodeAt(j)) continue outer;
		return true;
	}
	return false;
}

/** Word (.docx) with docx-preview: the document's own page layout,
 * fitted to the screen width, pinch-zoomable. "Reading view" lets the
 * text flow to the width of the screen instead, for a phone. */
export default function DocxView({
	data,
	name,
	format,
	position,
	onPosition,
	onClose,
	active,
}: ViewerProps) {
	const { settings, update } = useSettings();
	const details = useOfficeDetails(data, format);
	const reading = settings.readingView;
	const scroller = useRef<HTMLDivElement>(null);
	const stage = useRef<HTMLDivElement>(null);
	const hud = useRef<HTMLDivElement>(null);
	const pages = useRef<HTMLDivElement>(null);
	const host = useRef<HTMLDivElement>(null);
	const [status, setStatus] = useState<"loading" | "ready" | "error">(
		"loading",
	);
	const [zoom, commit] = useZoomLevel(position);
	const [fit, setFit] = useState(1);
	const [pageCount, setPageCount] = useState(0);
	const [page, setPage] = useState(1);
	const sheets = useRef<HTMLElement[]>([]);
	const [chromeHidden, setChromeHidden] = useState(false);
	const [headings, setHeadings] = useState<Heading[]>([]);
	const [outlineOpen, setOutlineOpen] = useState(false);
	const [comments, setComments] = useState(false);
	const commented = useMemo(() => hasComments(data), [data]);
	const find = useDomFind(host, scroller);

	useEffect(() => {
		let cancelled = false;
		const staging = document.createElement("div");
		setStatus("loading");
		(async () => {
			try {
				const docx = await import("docx-preview");
				await docx.renderAsync(data.slice(0), staging, staging, {
					inWrapper: true,
					// Reading view: one flowing column, no paper to keep to.
					breakPages: !reading,
					ignoreWidth: reading,
					ignoreHeight: reading,
					ignoreLastRenderedPageBreak: false,
					experimental: true,
					useBase64URL: true,
					renderComments: comments,
				});
				if (cancelled || !host.current) return;
				const count = staging.querySelectorAll("section.docx").length;
				if (!count) throw new Error("empty");
				host.current.replaceChildren(...staging.childNodes);
				seedListCounters(host.current);
				sheets.current = [
					...host.current.querySelectorAll<HTMLElement>("section.docx"),
				];
				setHeadings(readHeadings(host.current));
				setPageCount(count);
				setStatus("ready");
			} catch {
				if (!cancelled) setStatus("error");
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [data, reading, comments]);

	// Fit the widest page to the viewport; follow rotation/resizes. In
	// reading view the text takes the width itself: nothing to fit.
	useLayoutEffect(() => {
		const el = scroller.current;
		if (status !== "ready" || !el || !host.current) return;
		if (reading) {
			setFit(1);
			return;
		}
		const measure = () => {
			let widest = 0;
			for (const sec of host.current?.querySelectorAll<HTMLElement>(
				"section.docx",
			) ?? []) {
				widest = Math.max(widest, sec.offsetWidth);
			}
			// The 12px side padding sits inside the zoomed box and scales too.
			if (widest > 0)
				setFit(
					Math.min(
						MAX_FIT,
						Math.floor((el.clientWidth / (widest + 24)) * 1e3) / 1e3,
					),
				);
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	}, [status, reading]);

	// Reading view can be turned page by page, as a book is.
	const [sideways] = useSideways();
	const turning = usePaged({
		scroller,
		paper: () =>
			host.current?.querySelector<HTMLElement>(".docx-wrapper") ?? null,
		on: sideways && reading && status === "ready",
		zoom,
		relayout: `${status}|${comments}`,
	});

	const scale = fit * zoom;
	const { zoomBy, zoomTo } = useZoom({
		scroller,
		content: pages,
		stage,
		zoom,
		commit,
		hud,
		label: (z) => `${Math.round(fit * z * 100)}%`,
		min: MIN_ZOOM,
		max: MAX_ZOOM,
		active,
		onTap: (_target, x) => tapTurn(x) || setChromeHidden((h) => !h),
	});
	useScrollMemory(scroller, status === "ready", position, onPosition, zoom);
	const marks = useScrollBookmarks(scroller, host);
	const speech = useMemo(() => domSpeech(scroller, host), []);

	// Which page the reader is on: the one under a line a third of the
	// way down the screen (the last one, at the very end).
	// biome-ignore lint/correctness/useExhaustiveDependencies: a new scale moves every page
	useEffect(() => {
		const el = scroller.current;
		if (status !== "ready" || !el) return;
		let raf = 0;
		const update = () => {
			raf = 0;
			const list = sheets.current;
			let at = list.length - 1;
			if (el.scrollTop + el.clientHeight < el.scrollHeight - 2) {
				const line = el.getBoundingClientRect().top + el.clientHeight / 3;
				let lo = 0;
				let hi = at;
				while (lo < hi) {
					const mid = (lo + hi + 1) >> 1;
					if (list[mid].getBoundingClientRect().top <= line) lo = mid;
					else hi = mid - 1;
				}
				at = lo;
			}
			setPage(at + 1);
		};
		const onScroll = () => {
			if (!raf) raf = requestAnimationFrame(update);
		};
		update();
		el.addEventListener("scroll", onScroll, { passive: true });
		return () => {
			cancelAnimationFrame(raf);
			el.removeEventListener("scroll", onScroll);
		};
	}, [status, scale]);

	const goTo = (n: number) => {
		const el = scroller.current;
		const target = sheets.current[n - 1];
		if (!el || !target) return;
		el.scrollTop +=
			target.getBoundingClientRect().top - el.getBoundingClientRect().top - 8;
	};
	const goToHeading = (heading: Heading) => {
		const el = scroller.current;
		if (!el || !heading.el.isConnected) return;
		jumpTo(el, heading.el);
	};

	const paged = !reading && pageCount > 0;
	// A tap on a side turns a page of paper, a page of the flowing text
	// when it is turned sideways, or scrolls it.
	const step = paged
		? (dir: 1 | -1) => goTo(page + dir)
		: turning.pages
			? turning.turn
			: undefined;
	const tapTurn = useTapToTurn(scroller, step);
	const side = useMemo<SideTab[]>(
		() =>
			status === "ready"
				? [
						{
							id: "contents",
							label: t("Contents"),
							icon: <ListTree size={16} />,
							content: (
								<HeadingList
									headings={headings}
									onPick={(h) => {
										const el = scroller.current;
										if (!el || !h.el.isConnected) return;
										jumpTo(el, h.el);
									}}
									compact
								/>
							),
						},
					]
				: [],
		[status, headings],
	);

	return (
		<Shell
			name={name}
			format={format}
			onClose={onClose}
			active={active}
			hud={hud}
			progressOf={scroller}
			side={side}
			paper
			bookmarks={status === "ready" ? marks : undefined}
			details={details}
			speech={status === "ready" ? speech : undefined}
			onStep={step}
			turnPages={!!turning.pages}
			chromeHidden={chromeHidden && !find.open}
			onFind={status === "ready" ? find.start : undefined}
			menu={
				status === "ready"
					? (close) => (
							<>
								<SheetItem
									icon={<BookOpenText size={20} />}
									checked={reading}
									hint={t("Text flows to the width of the screen")}
									onClick={() => {
										close();
										update("readingView", !reading);
									}}
									testId="doc-reading"
								>
									{t("Reading view")}
								</SheetItem>
								<SidewaysItem
									close={close}
									disabled={!reading}
									hint={reading ? undefined : t("Turn on Reading view first")}
								/>
								{!isDesktop && (
									<SheetItem
										icon={<ListTree size={20} />}
										disabled={!headings.length}
										hint={
											headings.length
												? undefined
												: t("This document has no headings")
										}
										onClick={() => {
											close();
											setOutlineOpen(true);
										}}
										testId="doc-contents"
									>
										{t("Contents")}
									</SheetItem>
								)}
								{commented && (
									<SheetItem
										icon={<MessageSquareText size={20} />}
										checked={comments}
										onClick={() => {
											close();
											setComments((v) => !v);
										}}
										testId="doc-comments"
									>
										{t("Show comments")}
									</SheetItem>
								)}
							</>
						)
					: undefined
			}
			onPrint={
				status === "ready"
					? async (root) => {
							// Re-render with the file's paper dimensions even in Reading view.
							const source = document.createElement("div");
							source.className = s.docx;
							root.appendChild(source);
							const docx = await import("docx-preview");
							await docx.renderAsync(data.slice(0), source, source, {
								inWrapper: true,
								breakPages: true,
								ignoreWidth: false,
								ignoreHeight: false,
								ignoreLastRenderedPageBreak: false,
								experimental: true,
								useBase64URL: true,
								renderComments: comments,
							});
							let widest = 1;
							for (const page of source.querySelectorAll<HTMLElement>(
								"section.docx",
							))
								widest = Math.max(
									widest,
									page.offsetWidth,
									Number.parseFloat(getComputedStyle(page).width) || 0,
								);
							root.appendChild(fitted(source, widest, s.docx));
						}
					: undefined
			}
			actions={
				<IconButton
					label={t("Find")}
					shortcut="Ctrl+F"
					onClick={() => find.start()}
					active={find.open}
					disabled={status !== "ready"}
					data-testid="doc-find"
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
			pager={
				status === "ready" ? (
					<>
						{paged ? (
							<PageJump
								page={Math.min(page, pageCount)}
								pages={pageCount}
								onGo={goTo}
								testId="doc"
							/>
						) : turning.pages ? (
							<PageCount paged={turning} />
						) : (
							<span className={shellStyles.meta}>{t("Reading view")}</span>
						)}
						<ZoomControl
							label={
								Math.abs(zoom - 1) < 0.005 && !reading
									? t("Fit width")
									: `${Math.round(scale * 100)}%`
							}
							onOut={() => zoomBy(1 / 1.25)}
							onIn={() => zoomBy(1.25)}
							onReset={() => zoomTo(1)}
							resetLabel={reading ? t("Reset text size") : t("Fit width")}
							presets={[
								...(reading
									? []
									: [
											{
												label: t("Fit width"),
												run: () => zoomTo(1),
												on: Math.abs(zoom - 1) < 0.005,
											},
										]),
								...percentPresets(ZOOM_LEVELS, scale, (to) => zoomTo(to / fit)),
							]}
							testId="doc"
						/>
					</>
				) : undefined
			}
		>
			<div ref={scroller} className={s.scroller} data-testid="doc-scroll">
				{status === "ready" && !reading && (
					<p className={s.banner} data-testid="doc-layout-notice">
						{t("Page breaks may differ from Word.")}
					</p>
				)}
				<div ref={stage} className={`${s.stage} ${reading ? s.reflow : ""}`}>
					<div
						ref={pages}
						className={`${s.pages} ${s.docx} ${reading ? `${s.reading} pw-reading` : ""}`}
						style={{ zoom: scale }}
					>
						<div ref={host} />
					</div>
				</div>
			</div>
			{paged && (
				<Scrubber
					of={scroller}
					label={`${Math.min(page, pageCount)} / ${pageCount}`}
					enabled={status === "ready"}
				/>
			)}
			{status === "loading" && (
				<StateView>
					<Spinner label={t("Opening document")} />
				</StateView>
			)}
			{status === "error" && (
				<StateView
					icon={<ErrorArt />}
					title={t("Can't open this document")}
					action={<Button onClick={onClose}>{t("Close")}</Button>}
				>
					{t("The file is damaged or isn't a valid Word document.")}
				</StateView>
			)}
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
		</Shell>
	);
}
