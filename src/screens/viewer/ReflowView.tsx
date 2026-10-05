import { isDesktop } from "@/lib/env";
import { t, uiDir } from "@/lib/i18n";
import type { Block } from "@/lib/office/model";
import type { DocResult } from "@/lib/parseWorker";
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
import "@/styles/office-fonts.css";
import d from "./Doc.module.css";
import { RichDocument } from "./RichDocument";
import {
	FindBar,
	Shell,
	type SideTab,
	ZoomControl,
	percentPresets,
	shellStyles,
} from "./Shell";
import { type Heading, HeadingList, readHeadings } from "./headings";
import { useScrollMemory, useZoom, useZoomLevel } from "./hooks";
import { runWorker } from "./runWorker";
import type { ViewerProps } from "./types";
import { useDomFind } from "./useDomFind";

type Result = DocResult;

const TEXT_SIZES = [80, 100, 125, 150, 200];

async function extract(
	props: ViewerProps,
	signal: AbortSignal,
): Promise<Result> {
	const { format, data } = props;
	if (format === "odt") {
		const { parseOdt } = await import("@/lib/office/odf");
		try {
			return { ok: true, doc: parseOdt(new Uint8Array(data)) };
		} catch (err) {
			return {
				ok: false,
				reason: String(err).includes("password") ? "password" : "corrupt",
			};
		}
	}
	return runWorker<Result>(
		{ type: format === "doc" ? "doc" : "rtf", buffer: data },
		signal,
	);
}

function Blocks({ blocks }: { blocks: Block[] }) {
	return (
		<>
			{blocks.map((b, i) => {
				if (b.kind === "heading") {
					const level = Math.min(4, Math.max(1, b.level ?? 1));
					const H = `h${level}` as "h1";
					return <H key={i}>{b.text}</H>;
				}
				return <p key={i}>{b.text}</p>;
			})}
		</>
	);
}

/** Documents that flow to the screen instead of being paginated:
 * legacy Word and OpenDocument text (with their formatting, tables
 * and pictures) and RTF. Honest about what is not shown. */
export default function ReflowView(props: ViewerProps) {
	const { name, format, position, onPosition, onClose, active } = props;
	const scroller = useRef<HTMLDivElement>(null);
	const stage = useRef<HTMLDivElement>(null);
	const hud = useRef<HTMLDivElement>(null);
	const pages = useRef<HTMLDivElement>(null);
	const content = useRef<HTMLDivElement>(null);
	const [result, setResult] = useState<Result | null>(null);
	const [zoom, commit] = useZoomLevel(position);
	const [chromeHidden, setChromeHidden] = useState(false);
	const [headings, setHeadings] = useState<Heading[]>([]);
	const [outlineOpen, setOutlineOpen] = useState(false);
	const find = useDomFind(content, scroller);

	// biome-ignore lint/correctness/useExhaustiveDependencies: extract once per document
	useEffect(() => {
		const abort = new AbortController();
		extract(props, abort.signal)
			.then(setResult)
			.catch(
				(e) =>
					e?.name !== "AbortError" &&
					setResult({ ok: false, reason: "corrupt" }),
			);
		return () => abort.abort();
	}, [props.data]);

	const doc = result?.ok ? result.doc : null;
	// The headings, read from the document once it is on the page.
	useEffect(() => {
		setHeadings(doc && content.current ? readHeadings(content.current) : []);
	}, [doc]);

	const { zoomBy, zoomTo } = useZoom({
		scroller,
		content: pages,
		stage,
		zoom,
		commit,
		hud,
		min: 0.6,
		max: 3,
		enabled: !!doc,
		active,
		onTap: () => setChromeHidden((h) => !h),
	});
	useScrollMemory(scroller, !!result?.ok, position, onPosition, zoom);

	const goToHeading = (heading: Heading) => {
		const el = scroller.current;
		if (!el || !heading.el.isConnected) return;
		el.scrollTop +=
			heading.el.getBoundingClientRect().top -
			el.getBoundingClientRect().top -
			12;
	};
	const pick = useRef(goToHeading);
	pick.current = goToHeading;
	const side = useMemo<SideTab[]>(
		() =>
			doc
				? [
						{
							id: "contents",
							label: t("Contents"),
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
		[doc, headings],
	);

	const note =
		doc?.kind === "rich"
			? format === "doc"
				? t(
						"Older Word format: formatting, tables and pictures are shown; the page layout is not.",
					)
				: t(
						"OpenDocument text: formatting, tables and pictures are shown; the page layout is not.",
					)
			: format === "rtf"
				? t("Showing the text of this RTF document.")
				: t("This file's formatting couldn't be read; showing its text.");

	return (
		<Shell
			name={name}
			format={format}
			onClose={onClose}
			active={active}
			hud={hud}
			progressOf={scroller}
			side={side}
			chromeHidden={chromeHidden && !find.open}
			onFind={doc ? find.start : undefined}
			menu={
				doc && !isDesktop && headings.length
					? (close) => (
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
						)
					: undefined
			}
			onPrint={
				doc
					? (root) => {
							const clone = content.current?.cloneNode(true);
							if (clone) root.appendChild(sheet(clone));
						}
					: undefined
			}
			pager={
				doc ? (
					<>
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
							testId="reflow"
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
					disabled={!doc}
					data-testid="reflow-find"
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
			<div ref={scroller} className={d.scroller} data-testid="reflow-scroll">
				{doc && (
					<div ref={stage} className={`${d.stage} ${d.reflow}`}>
						<div ref={pages} className={d.pages} style={{ zoom }}>
							<p className={d.banner} dir={uiDir()}>
								{note}
							</p>
							<div ref={content}>
								{doc.kind === "rich" ? (
									<RichDocument doc={doc} />
								) : doc.kind === "document" ? (
									<article className={d.paper}>
										<Blocks blocks={doc.blocks} />
									</article>
								) : (
									doc.slides.map((slide, i) => (
										<section key={i}>
											<p className={d.slideNum}>
												{t("Slide {n}", { n: i + 1 })}
											</p>
											<div className={d.slideText}>
												<Blocks blocks={slide} />
											</div>
										</section>
									))
								)}
							</div>
						</div>
					</div>
				)}
			</div>
			{!result && (
				<StateView>
					<Spinner label={t("Opening document")} />
				</StateView>
			)}
			{result && !result.ok && (
				<StateView
					icon={<ErrorArt />}
					title={
						result.reason === "password"
							? t("Password protected")
							: t("Can't open this file")
					}
					action={<Button onClick={onClose}>{t("Close")}</Button>}
				>
					{result.reason === "password"
						? t("This document is locked with a password and can't be opened.")
						: t("The file is damaged or uses a variant Paperwren can't read.")}
				</StateView>
			)}
			{doc &&
				(doc.kind === "slides"
					? doc.slides.length === 0
					: doc.blocks.length === 0) && (
					<StateView title={t("No text found")}>
						{t("This file has no readable text.")}
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
