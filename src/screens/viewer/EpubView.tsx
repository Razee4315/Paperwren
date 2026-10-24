import { isDesktop } from "@/lib/env";
import type { EpubBook, TocEntry } from "@/lib/epub";
import { t, uiDir } from "@/lib/i18n";
import { sheet } from "@/lib/print";
import {
	Button,
	ErrorArt,
	IconButton,
	Sheet,
	SheetItem,
	Spinner,
	StateView,
} from "@/ui";
import { ListTree, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import d from "./Doc.module.css";
import {
	FindBar,
	Shell,
	type SideTab,
	ZoomControl,
	percentPresets,
	shellStyles,
} from "./Shell";
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

const TEXT_SIZES = [80, 100, 125, 150, 200];

type Result =
	| { ok: true; book: EpubBook }
	| { ok: false; reason: "drm" | "corrupt" };

async function read(data: ArrayBuffer): Promise<Result> {
	const { parseEpub, EpubError } = await import("@/lib/epub");
	try {
		return { ok: true, book: parseEpub(new Uint8Array(data)) };
	} catch (err) {
		return {
			ok: false,
			reason: err instanceof EpubError ? err.reason : "corrupt",
		};
	}
}

function Contents({
	items,
	depth,
	onPick,
	compact,
}: {
	items: TocEntry[];
	depth: number;
	onPick: (entry: TocEntry) => void;
	compact?: boolean;
}) {
	return (
		<>
			{items.map((entry, i) => (
				<div key={`${depth}-${i}`}>
					<button
						type="button"
						className={compact ? shellStyles.sideItem : shellStyles.listItem}
						style={{
							paddingInlineStart:
								(compact ? 8 : 12) + depth * (compact ? 12 : 16),
						}}
						title={compact ? entry.label : undefined}
						dir="auto"
						onClick={() => onPick(entry)}
						data-testid="epub-toc"
					>
						{entry.label}
					</button>
					{entry.items.length > 0 && (
						<Contents
							items={entry.items}
							depth={depth + 1}
							onPick={onPick}
							compact={compact}
						/>
					)}
				</div>
			))}
		</>
	);
}

/** A book (EPUB): its chapters as one flowing text, its own contents to
 * jump by, the text size, paper and bookmarks of any document. */
export default function EpubView(props: ViewerProps) {
	const { data, name, format, position, onPosition, onClose, active } = props;
	const scroller = useRef<HTMLDivElement>(null);
	const stage = useRef<HTMLDivElement>(null);
	const hud = useRef<HTMLDivElement>(null);
	const pages = useRef<HTMLDivElement>(null);
	const content = useRef<HTMLDivElement>(null);
	const [result, setResult] = useState<Result | null>(null);
	const [zoom, commit] = useZoomLevel(position);
	const [chromeHidden, setChromeHidden] = useState(false);
	const [tocOpen, setTocOpen] = useState(false);
	const find = useDomFind(content, scroller);

	useEffect(() => {
		let alive = true;
		read(data).then((r) => alive && setResult(r));
		return () => {
			alive = false;
		};
	}, [data]);
	const book = result?.ok ? result.book : null;
	const [sideways] = useSideways();
	const paged = usePaged({
		scroller,
		paper: () => content.current,
		on: sideways && !!book,
		zoom,
		relayout: book,
	});
	const turnPage = paged.pages ? paged.turn : undefined;
	const tapTurn = useTapToTurn(scroller, turnPage);

	// The pictures, from the book's own files; let go when it closes.
	useEffect(() => {
		const root = content.current;
		if (!book || !root) return;
		const urls = new Map<string, string>();
		for (const img of root.querySelectorAll<HTMLImageElement>(
			"img[data-pw-src]",
		)) {
			const key = img.dataset.pwSrc ?? "";
			const file = book.images.get(key);
			if (!file) continue;
			let url = urls.get(key);
			if (!url) {
				url = URL.createObjectURL(
					new Blob([file.bytes as BlobPart], { type: file.type }),
				);
				urls.set(key, url);
			}
			img.src = url;
		}
		return () => {
			for (const url of urls.values()) URL.revokeObjectURL(url);
		};
	}, [book]);

	const { zoomBy, zoomTo } = useZoom({
		scroller,
		content: pages,
		stage,
		zoom,
		commit,
		hud,
		min: 0.6,
		max: 3,
		enabled: !!book,
		active,
		onTap: (_target, x) => tapTurn(x) || setChromeHidden((h) => !h),
	});
	useScrollMemory(scroller, !!book, position, onPosition, zoom);
	const marks = useScrollBookmarks(scroller, content);
	const speech = useMemo(() => domSpeech(scroller, content), []);

	const goTo = (entry: TocEntry) => {
		const el = scroller.current;
		const target = document.getElementById(entry.target);
		if (!el || !target) return;
		jumpTo(el, target);
	};
	const pick = useRef(goTo);
	pick.current = goTo;
	const side = useMemo<SideTab[]>(
		() =>
			book
				? [
						{
							id: "contents",
							label: t("Contents"),
							icon: <ListTree size={16} />,
							content: book.toc.length ? (
								<Contents
									items={book.toc}
									depth={0}
									onPick={(e) => pick.current(e)}
									compact
								/>
							) : (
								<p className={shellStyles.sideEmpty}>
									{t("This book has no contents list")}
								</p>
							),
						},
					]
				: [],
		[book],
	);

	const details = useMemo<Array<[string, string]>>(() => {
		if (!book) return [];
		const rows: Array<[string, string | undefined]> = [
			[t("Title"), book.title],
			[t("Author"), book.author],
			[t("Publisher"), book.publisher],
			[t("Language"), book.language],
			[t("Chapters"), String(book.chapters.length)],
		];
		return rows.filter((row): row is [string, string] => !!row[1]);
	}, [book]);

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
			bookmarks={book ? marks : undefined}
			speech={book ? speech : undefined}
			details={details}
			chromeHidden={chromeHidden && !find.open}
			onFind={book ? find.start : undefined}
			onStep={turnPage}
			turnPages={!!turnPage}
			menu={
				book
					? (close) => (
							<>
								{!isDesktop && book.toc.length > 0 && (
									<SheetItem
										icon={<ListTree size={20} />}
										onClick={() => {
											close();
											setTocOpen(true);
										}}
										testId="epub-contents"
									>
										{t("Contents")}
									</SheetItem>
								)}
								<SidewaysItem close={close} />
							</>
						)
					: undefined
			}
			onPrint={
				book
					? (root) => {
							const clone = content.current?.cloneNode(true);
							if (clone) root.appendChild(sheet(clone));
						}
					: undefined
			}
			pager={
				book ? (
					<>
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
							testId="epub"
						/>
					</>
				) : undefined
			}
			actions={
				<IconButton
					label={t("Find")}
					shortcut="Ctrl+F"
					onClick={() => find.start()}
					active={find.open}
					disabled={!book}
					data-testid="epub-find"
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
			<div ref={scroller} className={d.scroller} data-testid="epub-scroll">
				{book && (
					<div ref={stage} className={`${d.stage} ${d.reflow}`}>
						<div ref={pages} className={d.pages} style={{ zoom }}>
							<article
								ref={content}
								className={`${d.paper} ${d.book} pw-paper pw-reading`}
								lang={book.language}
							>
								{book.chapters.map((chapter) => (
									<section
										key={chapter.id}
										id={chapter.id}
										dir={chapter.dir ?? "auto"}
										className={d.chapter}
										// biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized with DOMPurify in lib/epub.ts
										dangerouslySetInnerHTML={{ __html: chapter.html }}
									/>
								))}
							</article>
						</div>
					</div>
				)}
			</div>
			{!result && (
				<StateView>
					<Spinner label={t("Opening book")} />
				</StateView>
			)}
			{result && !result.ok && (
				<StateView
					icon={<ErrorArt />}
					title={
						result.reason === "drm"
							? t("This book is locked")
							: t("Can't open this book")
					}
					action={<Button onClick={onClose}>{t("Close")}</Button>}
					testId="epub-error"
				>
					<span dir={uiDir()}>
						{result.reason === "drm"
							? t(
									"It is protected by its store (DRM) and can only be read in that store's app.",
								)
							: t("The file is damaged or isn't a valid EPUB book.")}
					</span>
				</StateView>
			)}
			<Sheet
				open={tocOpen}
				title={t("Contents")}
				onClose={() => setTocOpen(false)}
				wide
			>
				{book && (
					<Contents
						items={book.toc}
						depth={0}
						onPick={(entry) => {
							setTocOpen(false);
							goTo(entry);
						}}
					/>
				)}
			</Sheet>
		</Shell>
	);
}
