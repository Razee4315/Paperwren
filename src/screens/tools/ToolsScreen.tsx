import { formatBytes } from "@/lib/backend";
import { copyName, splitName } from "@/lib/fileName";
import { msg, t, tn } from "@/lib/i18n";
import { drawPage } from "@/lib/pagePicture";
import {
	type NumberSpot,
	type PagePick,
	addPageNumbers,
	addWatermark,
	buildPdf,
	compressPdf,
	imagesToPdf,
	parsePages,
	protect,
	standardText,
	unlock,
} from "@/lib/pdfTools";
import { sniffFormat } from "@/lib/sniff";
import type { OpenRequest } from "@/lib/types";
import { useBackClose, useNav } from "@/state/navigation";
import { Button, IconButton } from "@/ui";
import { zipSync } from "fflate";
import {
	ArrowLeft,
	ArrowRight,
	Camera,
	Check,
	Combine,
	Droplet,
	FileDown,
	FileImage,
	FileText,
	Hash,
	Highlighter,
	Images,
	LayoutGrid,
	LockKeyhole,
	LockKeyholeOpen,
	PenLine,
	RotateCcw,
	RotateCw,
	ScanLine,
	Scissors,
	ShieldCheck,
	Sparkles,
	Trash2,
} from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { FillSign } from "./FillSign";
import { MarkUp } from "./MarkUp";
import s from "./Tools.module.css";
import {
	Choice,
	FileList,
	Go,
	PageThumb,
	type ToolFile,
	usePdf,
	useRun,
	useToolFiles,
} from "./kit";
import { recodePicture, textOfPdf } from "./pdfFiles";
import { announceSaved } from "./saved";
import { ScanTool } from "./scan/ScanTool";

export type ToolId =
	| "sign"
	| "scan"
	| "markup"
	| "compress"
	| "text"
	| "merge"
	| "organize"
	| "extract"
	| "images"
	| "pictures"
	| "numbers"
	| "watermark"
	| "protect"
	| "unlock";

const PDF = "application/pdf";

/** The tools, as the list shows them. */
const TOOLS: Array<{
	id: ToolId;
	icon: ReactNode;
	title: string;
	hint: string;
}> = [
	{
		id: "sign",
		icon: <PenLine size={22} />,
		title: msg("Fill & sign"),
		hint: msg("Fill in a form and sign it"),
	},
	{
		id: "scan",
		icon: <ScanLine size={22} />,
		title: msg("Scan a document"),
		hint: msg("Photos of paper as a clean, straight PDF"),
	},
	{
		id: "markup",
		icon: <Highlighter size={22} />,
		title: msg("Mark up"),
		hint: msg("Write on a PDF, highlight words, add notes"),
	},
	{
		id: "compress",
		icon: <FileDown size={22} />,
		title: msg("Compress PDF"),
		hint: msg("A smaller copy, easier to send"),
	},
	{
		id: "text",
		icon: <FileText size={22} />,
		title: msg("PDF to text"),
		hint: msg("The words of a PDF as a text file"),
	},
	{
		id: "merge",
		icon: <Combine size={22} />,
		title: msg("Merge PDFs"),
		hint: msg("Put several PDFs together, in the order you choose"),
	},
	{
		id: "organize",
		icon: <LayoutGrid size={22} />,
		title: msg("Organize pages"),
		hint: msg("Turn, move or take out pages"),
	},
	{
		id: "extract",
		icon: <Scissors size={22} />,
		title: msg("Split or extract pages"),
		hint: msg("Some pages as a new PDF, or every page as its own"),
	},
	{
		id: "images",
		icon: <Images size={22} />,
		title: msg("Pictures to PDF"),
		hint: msg("Photos or scans as the pages of one PDF"),
	},
	{
		id: "pictures",
		icon: <FileImage size={22} />,
		title: msg("PDF to pictures"),
		hint: msg("Each page as a JPEG picture"),
	},
	{
		id: "numbers",
		icon: <Hash size={22} />,
		title: msg("Page numbers"),
		hint: msg("Number every page"),
	},
	{
		id: "watermark",
		icon: <Droplet size={22} />,
		title: msg("Watermark"),
		hint: msg("A word such as DRAFT across every page"),
	},
	{
		id: "protect",
		icon: <LockKeyhole size={22} />,
		title: msg("Add a password"),
		hint: msg("A copy that asks for a password to open"),
	},
	{
		id: "unlock",
		icon: <LockKeyholeOpen size={22} />,
		title: msg("Remove a password"),
		hint: msg("A copy that opens without one, if you know it"),
	},
];

const GROUPS = [
	{ title: msg("Arrange your pages"), ids: ["merge", "organize", "extract"] },
	{
		title: msg("Convert your files"),
		ids: ["compress", "images", "pictures", "text"],
	},
	{
		title: msg("Add the finishing touches"),
		ids: ["markup", "numbers", "watermark", "protect", "unlock"],
	},
];

const GUIDANCE: Record<ToolId, string> = {
	sign: msg(
		"Choose your PDF, add your details and signature, then save a copy.",
	),
	scan: msg(
		"Photograph each page, check its edges and pick a look, then save them all as one PDF.",
	),
	markup: msg(
		"Choose a PDF, write on it or highlight its words, then save a copy.",
	),
	compress: msg(
		"Choose a PDF and how small to make it. Its pictures are stored again at a lower quality.",
	),
	text: msg(
		"Choose a PDF to save its words as a text file. A scan is a picture, so it has none.",
	),
	merge: msg(
		"Add at least two PDFs. Arrange them from top to bottom, then save them as one file.",
	),
	organize: msg(
		"Choose a PDF, select the pages you want to change, then save a copy.",
	),
	extract: msg("Choose a PDF and enter the page numbers you want to keep."),
	images: msg(
		"Add your pictures in the order you want them to appear in the PDF.",
	),
	pictures: msg(
		"Choose a PDF to save its pages as pictures, together in a ZIP file.",
	),
	numbers: msg(
		"Choose a PDF, then choose where and how the page numbers appear.",
	),
	watermark: msg(
		"Choose a PDF and enter a word, such as DRAFT, to put across every page.",
	),
	protect: msg("Choose a PDF and set a password for the new copy."),
	unlock: msg(
		"Choose a locked PDF and enter its current password to save an unlocked copy.",
	),
};

/**
 * The tools people otherwise find a website or another app for, on the
 * device: fill in and sign a form, put PDFs together and apart, turn
 * pictures into a PDF and back, number pages, mark them, lock and
 * unlock them. Each one makes a new file the reader saves where they
 * like; nothing leaves the device and the files picked stay as they are.
 */
export function ToolsScreen({
	start,
	file,
	onOpen,
}: {
	/** Open straight into one tool... */
	start?: ToolId;
	/** ...with this file in it. */
	file?: OpenRequest;
	onOpen: (request: OpenRequest) => void;
}) {
	const { back } = useNav();
	const [tool, setTool] = useState<ToolId | null>(start ?? null);
	// Back from a tool opened from the list returns to the list.
	useBackClose("tool", !!tool && !start, () => setTool(null));
	const shown = TOOLS.find((x) => x.id === tool);
	const heading = useRef<HTMLHeadingElement>(null);
	const previousTool = useRef(tool);
	useEffect(() => {
		if (previousTool.current === tool) return;
		if (tool) heading.current?.focus();
		else
			document
				.querySelector<HTMLButtonElement>(
					`[data-testid="tool-${previousTool.current}"]`,
				)
				?.focus();
		previousTool.current = tool;
	}, [tool]);
	const card = (x: (typeof TOOLS)[number], featured = false) => (
		<button
			key={x.id}
			type="button"
			className={featured ? s.featured : s.toolCard}
			onClick={() => setTool(x.id)}
			data-testid={`tool-${x.id}`}
		>
			<span className={s.toolIcon}>{x.icon}</span>
			<span className={s.toolText}>
				{featured && (
					<span className={s.eyebrow}>
						{x.id === "scan" ? t("Paper to PDF") : t("Forms made simple")}
					</span>
				)}
				<strong>{t(x.title)}</strong>
				<span>{t(x.hint)}</span>
				{featured && (
					<span className={s.featuredAction}>
						{t("Get started")} <ArrowRight size={16} className="pw-flip" />
					</span>
				)}
			</span>
			{featured ? (
				<span
					className={s.paperArt}
					data-art={x.id === "scan" ? "scan" : undefined}
					aria-hidden="true"
				>
					<span />
					<span />
					{x.id === "scan" ? <Camera size={26} /> : <PenLine size={28} />}
					{x.id === "scan" ? <Sparkles size={18} /> : <Check size={18} />}
				</span>
			) : (
				<ArrowRight className={`${s.cardArrow} pw-flip`} size={18} />
			)}
		</button>
	);

	return (
		<div className={s.screen} data-testid="tools">
			<header className={s.screenBar} data-tauri-drag-region="deep">
				<IconButton
					label={t("Back")}
					onClick={() => (tool && !start ? setTool(null) : back())}
					data-testid="tools-back"
				>
					<ArrowLeft size={22} className="pw-flip" />
				</IconButton>
				<h1 ref={heading} tabIndex={-1} className={s.screenTitle}>
					{shown ? t(shown.title) : t("Tools")}
				</h1>
			</header>
			<main className={s.screenScroll}>
				<div className={`${s.column} ${tool ? s.workspace : ""}`}>
					{!tool && (
						<>
							<div className={s.intro}>
								<div>
									<p className={s.eyebrow}>
										{t("A little help with your paperwork")}
									</p>
									<h2>{t("What would you like to do?")}</h2>
									<p className={s.lead}>
										{t("Choose a tool below. We'll guide you through it.")}
									</p>
								</div>
								<span className={s.privacy}>
									<ShieldCheck size={18} />
									{t("Private. On your device.")}
								</span>
							</div>
							<div className={s.featuredRow}>
								{card(TOOLS[0], true)}
								{card(TOOLS[1], true)}
							</div>
							{GROUPS.map((group) => (
								<section
									className={s.toolGroup}
									key={group.title}
									aria-label={t(group.title)}
								>
									<h3>{t(group.title)}</h3>
									<div className={s.toolList}>
										{TOOLS.filter((x) => group.ids.includes(x.id)).map((x) =>
											card(x),
										)}
									</div>
								</section>
							))}
							<p className={s.safetyNote}>
								<ShieldCheck size={16} />
								{t(
									"Everything happens on this device. The files you pick stay as they are: each tool saves a new one.",
								)}
							</p>
						</>
					)}
					{tool && shown && (
						<div className={s.taskIntro}>
							<span className={s.toolIcon}>{shown.icon}</span>
							<div>
								<h2>{t(shown.hint)}</h2>
								<p>{t(GUIDANCE[tool])}</p>
							</div>
						</div>
					)}
					<div className={tool ? s.taskPanel : undefined}>
						{tool === "sign" && <SignTool file={file} onOpen={onOpen} />}
						{tool === "scan" && <ScanTool file={file} onOpen={onOpen} />}
						{tool === "markup" && <MarkUpTool file={file} onOpen={onOpen} />}
						{tool === "compress" && (
							<CompressTool file={file} onOpen={onOpen} />
						)}
						{tool === "text" && <TextTool file={file} onOpen={onOpen} />}
						{tool === "merge" && <MergeTool file={file} onOpen={onOpen} />}
						{tool === "organize" && (
							<OrganizeTool file={file} onOpen={onOpen} />
						)}
						{tool === "extract" && <ExtractTool file={file} onOpen={onOpen} />}
						{tool === "images" && <ImagesTool file={file} onOpen={onOpen} />}
						{tool === "pictures" && (
							<PicturesTool file={file} onOpen={onOpen} />
						)}
						{tool === "numbers" && <NumbersTool file={file} onOpen={onOpen} />}
						{tool === "watermark" && (
							<WatermarkTool file={file} onOpen={onOpen} />
						)}
						{tool === "protect" && <ProtectTool file={file} onOpen={onOpen} />}
						{tool === "unlock" && <UnlockTool file={file} onOpen={onOpen} />}
					</div>
					{tool && (
						<p className={s.safetyNote}>
							<ShieldCheck size={16} />
							{t("Your original files stay unchanged.")}
						</p>
					)}
				</div>
			</main>
		</div>
	);
}

interface ToolProps {
	file?: OpenRequest;
	onOpen: (request: OpenRequest) => void;
}

function OnePdf({
	kit,
}: {
	kit: ReturnType<typeof useToolFiles>;
}) {
	return (
		<>
			<FileList kit={kit} several={false} addLabel={t("Choose a PDF")} />
			{kit.dialog}
		</>
	);
}

function SignTool({ file, onOpen }: ToolProps) {
	const kit = useToolFiles("pdf", file);
	const doc = usePdf(kit.files[0]);
	const [open, setOpen] = useState(false);
	const picked = kit.files[0];
	return (
		<>
			<OnePdf kit={kit} />
			<div className={s.signGuide}>
				{doc && (
					<div className={s.previewPage}>
						<PageThumb doc={doc} page={0} width={100} />
						<span>{t("Page {n}", { n: 1 })}</span>
					</div>
				)}
				<div>
					<h3>{picked ? t("Your PDF is ready") : t("How it works")}</h3>
					<ol className={s.steps}>
						<li data-current={!picked || undefined}>
							<span>{picked ? <Check size={13} /> : 1}</span>
							{t("Choose a PDF")}
						</li>
						<li data-current={!!picked || undefined}>
							<span>2</span>
							{t("Add text, dates or your signature")}
						</li>
						<li>
							<span>3</span>
							{t("Save a copy")}
						</li>
					</ol>
				</div>
			</div>
			{picked && (
				<Go
					label={picked && !doc ? t("Opening…") : t("Open editor")}
					disabled={!doc}
					running={false}
					onClick={() => setOpen(true)}
				/>
			)}
			{open && doc && picked && (
				<FillSign
					doc={doc}
					name={picked.name}
					password={picked.password}
					canMark
					onClose={() => setOpen(false)}
					onSaved={(saved) => announceSaved(saved, onOpen)}
				/>
			)}
		</>
	);
}

function MarkUpTool({ file, onOpen }: ToolProps) {
	const kit = useToolFiles("pdf", file);
	const doc = usePdf(kit.files[0]);
	const [open, setOpen] = useState(false);
	const picked = kit.files[0];
	return (
		<>
			<OnePdf kit={kit} />
			{picked && (
				<Go
					label={doc ? t("Open editor") : t("Opening…")}
					disabled={!doc}
					running={false}
					onClick={() => setOpen(true)}
				/>
			)}
			{open && doc && picked && (
				<MarkUp
					doc={doc}
					name={picked.name}
					password={picked.password}
					onClose={() => setOpen(false)}
					onSaved={(saved) => announceSaved(saved, onOpen)}
				/>
			)}
		</>
	);
}

/** How far each choice goes: the longest side a picture may keep, and
 * its JPEG quality. */
const SQUEEZE = {
	light: { side: 2200, quality: 0.8 },
	balanced: { side: 1600, quality: 0.68 },
	small: { side: 1100, quality: 0.5 },
} as const;

function CompressTool({ file, onOpen }: ToolProps) {
	const kit = useToolFiles("pdf", file);
	const { running, run, feedback } = useRun(onOpen);
	const [level, setLevel] = useState<keyof typeof SQUEEZE>("balanced");
	const [outcome, setOutcome] = useState("");
	const picked = kit.files[0];
	return (
		<>
			<OnePdf kit={kit} />
			{picked && (
				<Choice
					label={t("How small")}
					value={level}
					onChange={setLevel}
					options={[
						["light", t("Best quality")],
						["balanced", t("Balanced")],
						["small", t("Smallest file")],
					]}
					testId="compress-level"
				/>
			)}
			{outcome && (
				<p className={s.hint} data-testid="compress-outcome">
					{outcome}
				</p>
			)}
			{feedback}
			<Go
				label={t("Compress")}
				disabled={!picked}
				running={running}
				onClick={() =>
					run(async () => {
						setOutcome("");
						const bytes = await compressPdf(
							picked.bytes,
							(picture) => recodePicture(picture, SQUEEZE[level]),
							{ password: picked.password },
						);
						const was = picked.bytes.length;
						if (bytes.length >= was * 0.97) {
							setOutcome(
								t(
									"This PDF is already about as small as it can be, so no copy was made.",
								),
							);
							return null;
						}
						setOutcome(
							t("{was} down to {now}, {n}% smaller", {
								was: formatBytes(was),
								now: formatBytes(bytes.length),
								n: Math.round((1 - bytes.length / was) * 100),
							}),
						);
						return {
							name: copyName(picked.name, t("compressed")),
							bytes,
							mime: PDF,
						};
					})
				}
			/>
		</>
	);
}

function TextTool({ file, onOpen }: ToolProps) {
	const kit = useToolFiles("pdf", file);
	const doc = usePdf(kit.files[0]);
	const { running, run, feedback } = useRun(onOpen);
	const [empty, setEmpty] = useState(false);
	const picked = kit.files[0];
	return (
		<>
			<OnePdf kit={kit} />
			{empty && (
				<p className={s.hint} data-testid="text-empty">
					{t("This PDF has no text in it. A scan is only pictures of pages.")}
				</p>
			)}
			{feedback}
			<Go
				label={t("Save as text")}
				disabled={!doc}
				running={running}
				onClick={() =>
					run(async () => {
						if (!doc) return null;
						const text = await textOfPdf(doc);
						setEmpty(!text.trim());
						if (!text.trim()) return null;
						return {
							name: `${splitName(picked.name)[0]}.txt`,
							bytes: new TextEncoder().encode(text),
							mime: "text/plain",
						};
					})
				}
			/>
		</>
	);
}

function MergeTool({ file, onOpen }: ToolProps) {
	const kit = useToolFiles("pdf", file);
	const { running, run, feedback } = useRun(onOpen);
	const total = kit.files.reduce((n, f) => n + (f.pages ?? 0), 0);
	return (
		<>
			<FileList kit={kit} several addLabel={t("Add a PDF")} />
			{kit.dialog}
			{kit.files.length < 2 && (
				<p className={s.hint}>{t("Add at least two PDFs to continue.")}</p>
			)}
			{kit.files.length > 0 && (
				<p className={s.hint}>
					{tn(total, "{n} page in all", "{n} pages in all")}
				</p>
			)}
			{feedback}
			<Go
				label={t("Merge")}
				disabled={kit.files.length < 2}
				running={running}
				onClick={() =>
					run(async () => {
						const picks: PagePick[] = kit.files.flatMap((f, i) =>
							Array.from({ length: f.pages ?? 0 }, (_, page) => ({
								file: i,
								page,
							})),
						);
						return {
							name: copyName(kit.files[0].name, t("merged")),
							bytes: await buildPdf(kit.files, picks),
							mime: PDF,
						};
					})
				}
			/>
		</>
	);
}

/** Pages to pick from, drawn small: tap to select. */
function PageGrid({
	doc,
	order,
	selected,
	onToggle,
}: {
	doc: PDFDocumentProxy;
	order: Array<{ page: number; turn: number }>;
	selected: Set<number>;
	onToggle: (index: number) => void;
}) {
	return (
		<div className={s.grid} data-testid="tool-pages">
			{order.map((p, i) => (
				<button
					key={`${p.page}-${i}`}
					type="button"
					className={s.cell}
					aria-pressed={selected.has(i)}
					aria-label={t("Page {n}", { n: p.page + 1 })}
					onClick={() => onToggle(i)}
					data-testid="tool-page"
				>
					<PageThumb doc={doc} page={p.page} turn={p.turn} />
					<span className={s.cellNumber}>{p.page + 1}</span>
				</button>
			))}
		</div>
	);
}

function OrganizeTool({ file, onOpen }: ToolProps) {
	const kit = useToolFiles("pdf", file);
	const picked = kit.files[0];
	const doc = usePdf(picked);
	const { running, run, feedback } = useRun(onOpen);
	const [order, setOrder] = useState<Array<{
		page: number;
		turn: number;
	}> | null>(null);
	const [selected, setSelected] = useState<Set<number>>(new Set());
	const fileKey = picked?.key;
	// A replacement file starts with its own pages, never the old selection.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset when the selected file changes
	useEffect(() => {
		setOrder(null);
		setSelected(new Set());
	}, [fileKey]);
	const pages =
		order ??
		Array.from({ length: picked?.pages ?? 0 }, (_, page) => ({
			page,
			turn: 0,
		}));
	const change = (next: Array<{ page: number; turn: number }>) =>
		setOrder(next);
	const sel = [...selected].sort((a, b) => a - b);
	const turn = (by: number) =>
		change(
			pages.map((p, i) =>
				selected.has(i) ? { ...p, turn: (p.turn + by + 360) % 360 } : p,
			),
		);
	const shift = (by: -1 | 1) => {
		if (!sel.length) return;
		const next = [...pages];
		const moving = by < 0 ? sel : [...sel].reverse();
		const edge =
			by < 0 ? sel[0] === 0 : sel[sel.length - 1] === pages.length - 1;
		if (edge) return;
		for (const i of moving) [next[i], next[i + by]] = [next[i + by], next[i]];
		change(next);
		setSelected(new Set(sel.map((i) => i + by)));
	};
	const changed =
		!!order &&
		(order.length !== (picked?.pages ?? 0) ||
			order.some((p, i) => p.page !== i || p.turn !== 0));
	return (
		<>
			<OnePdf kit={kit} />
			{doc && picked && (
				<>
					<div className={s.actions} role="toolbar" aria-label={t("Pages")}>
						<Button
							variant="ghost"
							onClick={() =>
								setSelected(
									selected.size === pages.length
										? new Set()
										: new Set(pages.map((_, i) => i)),
								)
							}
						>
							{selected.size === pages.length
								? t("Select none")
								: t("Select all")}
						</Button>
						<Button
							variant="secondary"
							disabled={!selected.size}
							onClick={() => turn(-90)}
						>
							<RotateCcw size={18} />
							{t("Turn left")}
						</Button>
						<Button
							variant="secondary"
							disabled={!selected.size}
							onClick={() => turn(90)}
							data-testid="tool-turn-right"
						>
							<RotateCw size={18} />
							{t("Turn right")}
						</Button>
						<Button
							variant="ghost"
							disabled={!selected.size || sel[0] === 0}
							onClick={() => shift(-1)}
							data-testid="tool-earlier"
						>
							{t("Earlier")}
						</Button>
						<Button
							variant="ghost"
							disabled={
								!selected.size || sel[sel.length - 1] === pages.length - 1
							}
							onClick={() => shift(1)}
						>
							{t("Later")}
						</Button>
						<Button
							variant="danger"
							disabled={!selected.size || selected.size === pages.length}
							onClick={() => {
								change(pages.filter((_, i) => !selected.has(i)));
								setSelected(new Set());
							}}
							data-testid="tool-delete"
						>
							<Trash2 size={18} />
							{t("Take out")}
						</Button>
						{changed && (
							<Button
								variant="ghost"
								onClick={() => {
									setOrder(null);
									setSelected(new Set());
								}}
							>
								{t("Reset pages")}
							</Button>
						)}
					</div>
					<p className={s.hint}>
						{selected.size
							? tn(selected.size, "{n} page selected", "{n} pages selected")
							: t("Tap pages to select them")}
					</p>
					<PageGrid
						doc={doc}
						order={pages}
						selected={selected}
						onToggle={(i) =>
							setSelected((was) => {
								const next = new Set(was);
								if (next.has(i)) next.delete(i);
								else next.add(i);
								return next;
							})
						}
					/>
				</>
			)}
			{feedback}
			<Go
				label={t("Save a copy")}
				disabled={!changed}
				running={running}
				onClick={() =>
					run(async () => ({
						name: copyName(picked.name, t("organized")),
						bytes: await buildPdf(
							[picked],
							pages.map((p) => ({ file: 0, page: p.page, turn: p.turn })),
						),
						mime: PDF,
					}))
				}
			/>
		</>
	);
}

function ExtractTool({ file, onOpen }: ToolProps) {
	const kit = useToolFiles("pdf", file);
	const picked = kit.files[0];
	const { running, run, feedback } = useRun(onOpen);
	const [which, setWhich] = useState("");
	const [each, setEach] = useState(false);
	const pages = picked?.pages ?? 0;
	const list = picked
		? parsePages(which || (each ? `1-${pages}` : ""), pages)
		: null;
	return (
		<>
			<OnePdf kit={kit} />
			{picked && (
				<>
					<label className={s.label} htmlFor="tool-pages-field">
						{t("Pages")}
					</label>
					<input
						id="tool-pages-field"
						className={s.field}
						value={which}
						onChange={(e) => setWhich(e.target.value)}
						placeholder={t("For example 1-3, 5")}
						dir="ltr"
						data-testid="tool-pages-field"
					/>
					<p className={s.hint}>
						{which && !list
							? t("The document has {n} pages", { n: pages })
							: each
								? t(
										"Each page is saved as a PDF of its own, together in a ZIP file.",
									)
								: t(
										"The pages you name are saved, in that order, as a new PDF.",
									)}
					</p>
					<label className={s.keep}>
						<input
							type="checkbox"
							checked={each}
							onChange={(e) => setEach(e.target.checked)}
							data-testid="tool-each"
						/>
						{t("Every page as its own PDF")}
					</label>
				</>
			)}
			{feedback}
			<Go
				label={each ? t("Split") : t("Extract")}
				disabled={!list}
				running={running}
				onClick={() =>
					run(async () => {
						if (!list) throw new Error("no pages");
						if (!each)
							return {
								name: copyName(picked.name, t("pages")),
								bytes: await buildPdf(
									[picked],
									list.map((page) => ({ file: 0, page })),
								),
								mime: PDF,
							};
						const [stem] = splitName(picked.name);
						const parts: Record<string, Uint8Array> = {};
						for (const page of list)
							parts[`${stem} - ${t("page {n}", { n: page + 1 })}.pdf`] =
								await buildPdf([picked], [{ file: 0, page }]);
						return {
							name: copyName(picked.name, t("pages"), ".zip"),
							bytes: zipSync(parts, { level: 0 }),
							mime: "application/zip",
						};
					})
				}
			/>
		</>
	);
}

/** A picture's pixels as a JPEG or a PNG, the two a PDF can hold: a
 * JPEG or PNG is kept as it is; anything else is drawn into a JPEG. */
async function asPageImage(
	file: ToolFile,
): Promise<{ bytes: Uint8Array; type: "jpg" | "png" }> {
	const b = file.bytes;
	if (b[0] === 0xff && b[1] === 0xd8) return { bytes: b, type: "jpg" };
	if (b[0] === 0x89 && b[1] === 0x50) return { bytes: b, type: "png" };
	const bitmap = await createImageBitmap(new Blob([b as BlobPart]));
	const canvas = document.createElement("canvas");
	canvas.width = bitmap.width;
	canvas.height = bitmap.height;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("no canvas");
	ctx.fillStyle = "#fff";
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.drawImage(bitmap, 0, 0);
	const blob = await new Promise<Blob | null>((done) =>
		canvas.toBlob(done, "image/jpeg", 0.92),
	);
	if (!blob) throw new Error("no picture");
	return { bytes: new Uint8Array(await blob.arrayBuffer()), type: "jpg" };
}

function ImagesTool({ file, onOpen }: ToolProps) {
	const kit = useToolFiles("image", file);
	const { running, run, feedback } = useRun(onOpen);
	const [paper, setPaper] = useState<"fit" | "a4" | "letter">("a4");
	return (
		<>
			<FileList kit={kit} several addLabel={t("Add a picture")} />
			<Choice
				label={t("Page size")}
				value={paper}
				onChange={setPaper}
				options={[
					["a4", "A4"],
					["letter", "Letter"],
					["fit", t("Each picture's own size")],
				]}
				testId="tool-paper"
			/>
			{feedback}
			<Go
				label={t("Make a PDF")}
				disabled={!kit.files.length}
				running={running}
				onClick={() =>
					run(async () => ({
						name: copyName(kit.files[0].name, t("pictures"), ".pdf"),
						bytes: await imagesToPdf(
							await Promise.all(kit.files.map(asPageImage)),
							paper,
						),
						mime: PDF,
					}))
				}
			/>
		</>
	);
}

function PicturesTool({ file, onOpen }: ToolProps) {
	const kit = useToolFiles("pdf", file);
	const picked = kit.files[0];
	const doc = usePdf(picked);
	const { running, run, feedback } = useRun(onOpen);
	const [which, setWhich] = useState("");
	const pages = picked?.pages ?? 0;
	const list = picked ? parsePages(which || `1-${pages}`, pages) : null;
	return (
		<>
			<OnePdf kit={kit} />
			{picked && (
				<>
					<label className={s.label} htmlFor="tool-pictures-field">
						{t("Pages")}
					</label>
					<input
						id="tool-pictures-field"
						className={s.field}
						value={which}
						onChange={(e) => setWhich(e.target.value)}
						placeholder={t("All of them")}
						dir="ltr"
						data-testid="tool-pages-field"
					/>
					<p className={s.hint}>
						{list && list.length > 1
							? t("The pictures are saved together in a ZIP file.")
							: t("Pages are drawn at 150 dots to the inch.")}
					</p>
				</>
			)}
			{feedback}
			<Go
				label={t("Make pictures")}
				disabled={!doc || !list}
				running={running}
				onClick={() =>
					run(async () => {
						if (!doc || !list) throw new Error("no pages");
						const [stem] = splitName(picked.name);
						const shots: Record<string, Uint8Array> = {};
						for (const page of list) {
							const { bytes } = await drawPage(await doc.getPage(page + 1), {
								dpi: 150,
								type: "image/jpeg",
							});
							shots[`${stem} - ${t("page {n}", { n: page + 1 })}.jpg`] = bytes;
						}
						const names = Object.keys(shots);
						if (names.length === 1)
							return {
								name: names[0],
								bytes: shots[names[0]],
								mime: "image/jpeg",
							};
						return {
							name: copyName(picked.name, t("pictures"), ".zip"),
							bytes: zipSync(shots, { level: 0 }),
							mime: "application/zip",
						};
					})
				}
			/>
		</>
	);
}

function NumbersTool({ file, onOpen }: ToolProps) {
	const kit = useToolFiles("pdf", file);
	const picked = kit.files[0];
	const { running, run, feedback } = useRun(onOpen);
	const [spot, setSpot] = useState<NumberSpot>("bottom-center");
	const [style, setStyle] = useState<"n" | "of">("n");
	// "Page 1 of 9" in the reader's language, where Helvetica can write it.
	const words = t("Page {n} of {total}");
	const fullPattern = standardText(words) ? words : "{n} / {total}";
	const pattern = style === "n" ? "{n}" : fullPattern;
	return (
		<>
			<OnePdf kit={kit} />
			<Choice
				label={t("Where")}
				value={spot}
				onChange={setSpot}
				options={[
					["bottom-center", t("Foot, middle")],
					["bottom-right", t("Foot, right")],
					["top-right", t("Top, right")],
				]}
				testId="tool-spot"
			/>
			<Choice
				label={t("How")}
				value={style}
				onChange={setStyle}
				options={[
					["n", "1, 2, 3"],
					["of", fullPattern.replace("{n}", "1").replace("{total}", "9")],
				]}
				testId="tool-style"
			/>
			{feedback}
			<Go
				label={t("Number the pages")}
				disabled={!picked}
				running={running}
				onClick={() =>
					run(async () => ({
						name: copyName(picked.name, t("numbered")),
						bytes: await addPageNumbers(picked.bytes, {
							password: picked.password,
							spot,
							pattern,
						}),
						mime: PDF,
					}))
				}
			/>
		</>
	);
}

function WatermarkTool({ file, onOpen }: ToolProps) {
	const kit = useToolFiles("pdf", file);
	const picked = kit.files[0];
	const { running, run, feedback } = useRun(onOpen);
	const [text, setText] = useState(t("DRAFT"));
	const usable = !!text.trim() && standardText(text);
	return (
		<>
			<OnePdf kit={kit} />
			<label className={s.label} htmlFor="tool-mark">
				{t("Words")}
			</label>
			<input
				id="tool-mark"
				className={s.field}
				value={text}
				maxLength={40}
				onChange={(e) => setText(e.target.value)}
				data-testid="tool-mark"
			/>
			{!usable && text.trim() && (
				<p className={s.hint}>
					{t("Use Latin letters: a PDF's standard fonts have no others.")}
				</p>
			)}
			{feedback}
			<Go
				label={t("Add the watermark")}
				disabled={!picked || !usable}
				running={running}
				onClick={() =>
					run(async () => ({
						name: copyName(picked.name, t("watermarked")),
						bytes: await addWatermark(picked.bytes, {
							text: text.trim(),
							password: picked.password,
						}),
						mime: PDF,
					}))
				}
			/>
		</>
	);
}

function ProtectTool({ file, onOpen }: ToolProps) {
	const kit = useToolFiles("pdf", file);
	const picked = kit.files[0];
	const { running, run, feedback } = useRun(onOpen);
	const [one, setOne] = useState("");
	const [two, setTwo] = useState("");
	const same = one === two;
	return (
		<>
			<OnePdf kit={kit} />
			<label className={s.label} htmlFor="tool-password">
				{t("Password")}
			</label>
			<input
				id="tool-password"
				className={s.field}
				type="password"
				autoComplete="new-password"
				value={one}
				onChange={(e) => setOne(e.target.value)}
				data-testid="tool-new-password"
			/>
			<label className={s.label} htmlFor="tool-password-again">
				{t("The same password again")}
			</label>
			<input
				id="tool-password-again"
				className={s.field}
				type="password"
				autoComplete="new-password"
				value={two}
				onChange={(e) => setTwo(e.target.value)}
				data-testid="tool-new-password-again"
			/>
			<p className={s.hint}>
				{!same && two
					? t("The two passwords are not the same")
					: t(
							"Keep it somewhere safe: without it the copy cannot be opened. Paperwren does not keep it.",
						)}
			</p>
			{feedback}
			<Go
				label={t("Save a locked copy")}
				disabled={!picked || !one || !same}
				running={running}
				onClick={() =>
					run(async () => ({
						name: copyName(picked.name, t("locked")),
						bytes: await protect(picked.bytes, one, {
							password: picked.password,
						}),
						mime: PDF,
					}))
				}
			/>
		</>
	);
}

function UnlockTool({ file, onOpen }: ToolProps) {
	const kit = useToolFiles("pdf", file);
	const picked = kit.files[0];
	const { running, run, feedback } = useRun(onOpen);
	return (
		<>
			<OnePdf kit={kit} />
			<p className={s.hint}>
				{picked && !picked.password
					? t("This PDF has no password to remove.")
					: t("Pick the PDF and type its password; the copy opens without it.")}
			</p>
			{feedback}
			<Go
				label={t("Save an unlocked copy")}
				disabled={!picked?.password}
				running={running}
				onClick={() =>
					run(async () => {
						const password = picked.password ?? "";
						const bytes = await unlock(picked.bytes, password);
						if (sniffFormat(bytes.buffer as ArrayBuffer) !== "pdf")
							throw new Error("bad");
						return {
							name: copyName(picked.name, t("unlocked")),
							bytes,
							mime: PDF,
						};
					})
				}
			/>
		</>
	);
}
