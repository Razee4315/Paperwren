import { formatBytes } from "@/lib/backend";
import { contentKey, fileSample } from "@/lib/docMarks";
import { unreadNote } from "@/lib/errors";
import { copyName, splitName } from "@/lib/fileName";
import { msg, t, tn } from "@/lib/i18n";
import { drawPage } from "@/lib/pagePicture";
import {
	type Fitted,
	type SizeLimit,
	compressToSize,
	pageSetting,
	parseSize,
	pictureSetting,
	picturesToSize,
	sizeLimit,
} from "@/lib/pdfCompress";
import { openPdf } from "@/lib/pdfEngine";
import { losslessPdf } from "@/lib/pdfLossless";
import {
	MARK_COLORS,
	type MarkSize,
	type NumberSpot,
	type PAPER,
	type PagePick,
	type PaperTurn,
	addPageNumbers,
	addWatermark,
	buildPdf,
	compressPdf,
	digitallySigned,
	imagesToPdf,
	parsePages,
	protect,
	standardText,
	unlock,
} from "@/lib/pdfTools";
import { sniffFormat } from "@/lib/sniff";
import type { OpenRequest } from "@/lib/types";
import { useBackClose, useNav } from "@/state/navigation";
import { Button, IconButton, toast } from "@/ui";
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
	TextSearch,
	Trash2,
} from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useDocMarks } from "../viewer/useDocMarks";
import { FillSign } from "./FillSign";
import { MarkUp } from "./MarkUp";
import { ReadText } from "./ReadText";
import s from "./Tools.module.css";
import {
	Choice,
	CopyNote,
	FileList,
	Go,
	PageThumb,
	type ToolFile,
	usePdf,
	useRun,
	useToolFiles,
} from "./kit";
import { drawPages, recodePicture } from "./pdfFiles";
import { type ReadSource, bytesSource, pdfSource } from "./readSource";
import { announceSaved } from "./saved";
import { ScanTool } from "./scan/ScanTool";

export type ToolId =
	| "sign"
	| "scan"
	| "markup"
	| "compress"
	| "ocr"
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
		id: "ocr",
		icon: <TextSearch size={22} />,
		title: msg("Read text"),
		hint: msg("Get the words from a PDF, a scan or a photo"),
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
		hint: msg("Each page as a JPEG or PNG picture"),
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
		ids: ["ocr", "compress", "images", "pictures"],
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
	ocr: msg(
		"Choose a PDF or a picture. You'll watch it being read, and its text will appear on the screen.",
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
						{tool === "ocr" && <ReadTool file={file} onOpen={onOpen} />}
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

/** `copy` is false for a tool whose result is not a copy of the PDF
 * (pictures of its pages), or that is about its password itself. */
function OnePdf({
	kit,
	copy = true,
}: {
	kit: ReturnType<typeof useToolFiles>;
	copy?: boolean;
}) {
	return (
		<>
			<FileList kit={kit} several={false} addLabel={t("Choose a PDF")} />
			{kit.dialog}
			{copy && <CopyNote files={kit.files} />}
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
					signed={digitallySigned(picked.bytes)}
					protection={picked.protection}
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
	const key = useMemo(
		() => (picked ? contentKey(fileSample(picked.bytes)) : null),
		[picked],
	);
	const store = useDocMarks(key, picked?.name ?? "", !picked?.password);
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
					store={store}
					signed={digitallySigned(picked.bytes)}
					protection={picked.protection}
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

/** Sizes upload forms often ask a PDF to be under. */
const LIMITS = {
	"200k": [200, "kb"],
	"500k": [500, "kb"],
	"1m": [1, "mb"],
	"2m": [2, "mb"],
} as const;

/** A size as a limit is said: "200 KB", "1.5 MB". */
const limitLabel = (n: number, unit: "kb" | "mb") =>
	unit === "kb" ? t("{n} KB", { n }) : t("{n} MB", { n });

/** How the copy is made: a level, a size to fit under, or no picture
 * changed at all. */
type Squeeze =
	| keyof typeof SQUEEZE
	| keyof typeof LIMITS
	| "typed"
	| "lossless";

/** How much smaller, as said after each way. */
function downTo(was: number, now: number) {
	return t("{was} down to {now}, {n}% smaller", {
		was: formatBytes(was),
		now: formatBytes(now),
		// Never "100%": the copy still has something in it.
		n: Math.min(99, Math.round((1 - now / was) * 100)),
	});
}

const ALREADY_SMALL = msg(
	"This PDF is already about as small as it can be, so no copy was made.",
);

function CompressTool({ file, onOpen }: ToolProps) {
	const kit = useToolFiles("pdf", file);
	const { running, run, feedback } = useRun(onOpen);
	const [way, setWay] = useState<Squeeze>("balanced");
	const [typed, setTyped] = useState("");
	const [unit, setUnit] = useState<"kb" | "mb">("kb");
	const [grey, setGrey] = useState(false);
	const [outcome, setOutcome] = useState("");
	const [progress, setProgress] = useState("");
	/** The smallest copy with its text kept, when that is still over the
	 * size aimed for: pages as pictures are offered instead. */
	const [tooBig, setTooBig] = useState<{
		smallest: number;
		limit: SizeLimit;
		/** The file it was found for. */
		of: number;
	} | null>(null);
	const picked = kit.files[0];
	const choose = (next: Squeeze) => {
		setWay(next);
		setOutcome("");
		setTooBig(null);
	};
	const preset = way in LIMITS ? LIMITS[way as keyof typeof LIMITS] : null;
	const limit =
		way === "typed"
			? parseSize(typed, unit)
			: preset && sizeLimit(preset[0], preset[1]);
	// The size as chosen, to say it back.
	const limitUnit = way === "typed" ? unit : (preset?.[1] ?? "kb");
	const limitText = limit
		? limitLabel(limit.aim / (limitUnit === "kb" ? 1e3 : 1e6), limitUnit)
		: "";
	const level = (way in SQUEEZE ? way : null) as keyof typeof SQUEEZE | null;

	const compress = async () => {
		setOutcome("");
		setTooBig(null);
		const was = picked.bytes.length;
		const copy = (bytes: Uint8Array) => ({
			name: copyName(picked.name, t("compressed")),
			bytes,
			mime: PDF,
		});
		if (way === "lossless") {
			const bytes = await losslessPdf(picked.bytes, {
				password: picked.password,
			});
			const saved = Math.round((1 - bytes.length / was) * 100);
			if (bytes.length >= was * 0.97) {
				setOutcome(
					saved >= 1
						? t(
								"Without changing a picture this PDF gets only {n}% smaller, so no copy was made.",
								{ n: saved },
							)
						: t(ALREADY_SMALL),
				);
				return null;
			}
			setOutcome(
				`${downTo(was, bytes.length)}\n${t("No picture was changed.")}`,
			);
			return copy(bytes);
		}
		if (limit) {
			const fitted = await compressToSize(
				picked.bytes,
				limit,
				(at) => (picture) => recodePicture(picture, pictureSetting(at)),
				{
					password: picked.password,
					onTry: (n, most) =>
						setProgress(
							t("Trying settings, {n} of up to {total}…", { n, total: most }),
						),
				},
			);
			if (fitted.kind === "fits") {
				setOutcome(
					t("This PDF is already under {size}, so no copy was made.", {
						size: limitText,
					}),
				);
				return null;
			}
			if (fitted.kind === "too big") {
				setTooBig({ smallest: fitted.smallest, limit, of: picked.key });
				return null;
			}
			setOutcome(downTo(was, fitted.bytes.length));
			return copy(fitted.bytes);
		}
		if (!level) return null;
		const bytes = await compressPdf(
			picked.bytes,
			(picture) => recodePicture(picture, SQUEEZE[level]),
			{ password: picked.password },
		);
		if (bytes.length >= was * 0.97) {
			setOutcome(t(ALREADY_SMALL));
			return null;
		}
		setOutcome(downTo(was, bytes.length));
		return copy(bytes);
	};

	const asPictures = async () => {
		if (!tooBig || tooBig.of !== picked.key) return null;
		const was = picked.bytes.length;
		setOutcome("");
		const doc = await openPdf(picked.bytes, picked.password);
		let fitted: Fitted;
		try {
			let attempt = { n: 1, most: 1 };
			fitted = await picturesToSize(
				tooBig.limit,
				(at) =>
					drawPages(doc, { ...pageSetting(at), grey }, (page, pages) =>
						setProgress(
							t("Drawing page {page} of {pages}, try {n} of up to {total}…", {
								page,
								pages,
								n: attempt.n,
								total: attempt.most,
							}),
						),
					),
				{
					onTry: (n, most) => {
						attempt = { n, most };
					},
				},
			);
		} finally {
			doc.destroy();
		}
		if (fitted.kind !== "made") {
			setOutcome(
				t(
					"Even as pictures, the smallest this PDF can be is {size}, so no copy was made.",
					{
						size: formatBytes(
							fitted.kind === "too big" ? fitted.smallest : was,
						),
					},
				),
			);
			return null;
		}
		setTooBig(null);
		setOutcome(
			`${downTo(was, fitted.bytes.length)}\n${t("Its pages are now pictures: their text can't be selected or searched.")}`,
		);
		return {
			name: copyName(picked.name, t("compressed")),
			bytes: fitted.bytes,
			mime: PDF,
		};
	};
	const go = async (make: typeof compress) => {
		await run(make);
		setProgress("");
	};

	return (
		<>
			<OnePdf kit={kit} />
			{picked && (
				<>
					<Choice
						label={t("How small")}
						value={way}
						onChange={choose}
						options={[
							["light", t("Best quality")],
							["balanced", t("Balanced")],
							["small", t("Smallest file")],
						]}
						testId="compress-level"
					/>
					<Choice
						label={t("Or aim for a size")}
						value={way}
						onChange={choose}
						options={
							Object.entries(LIMITS).map(
								([id, [n, u]]) => [id as Squeeze, limitLabel(n, u)] as const,
							) as Array<[Squeeze, string]>
						}
						testId="compress-size"
					/>
					<div
						className={s.typedSize}
						data-chosen={way === "typed" || undefined}
					>
						<input
							className={s.field}
							value={typed}
							onChange={(e) => {
								setTyped(e.target.value);
								choose("typed");
							}}
							onFocus={() => way !== "typed" && typed && choose("typed")}
							inputMode="decimal"
							placeholder={t("Or type a size")}
							aria-label={t("Or type a size")}
							dir="ltr"
							data-testid="compress-typed"
						/>
						<select
							className={s.field}
							value={unit}
							onChange={(e) => {
								setUnit(e.target.value as "kb" | "mb");
								if (typed) choose("typed");
							}}
							aria-label={t("Unit")}
							data-testid="compress-unit"
						>
							<option value="kb">{t("KB")}</option>
							<option value="mb">{t("MB")}</option>
						</select>
					</div>
					<Choice
						label={t("Or keep every picture as it is")}
						value={way}
						onChange={choose}
						options={[["lossless", t("Keep quality (lossless)")]]}
						testId="compress-way"
					/>
					{way === "lossless" && (
						<p className={s.hint}>
							{t(
								"No picture is changed: only what nothing uses is taken out, and the rest is packed tighter.",
							)}
						</p>
					)}
				</>
			)}
			{running && progress && (
				<p
					className={s.hint}
					aria-live="polite"
					data-testid="compress-progress"
				>
					{progress}
				</p>
			)}
			{outcome && (
				<p className={`${s.hint} ${s.outcome}`} data-testid="compress-outcome">
					{outcome}
				</p>
			)}
			{tooBig && tooBig.of === picked?.key && (
				<div className={s.tooBig} data-testid="compress-too-big">
					<p>
						{t("The smallest this PDF can be with its text kept is {size}.", {
							size: formatBytes(tooBig.smallest),
						})}
					</p>
					<p className={s.hint}>
						{t(
							"As pictures its pages can be smaller, but their text can no longer be selected or searched.",
						)}
					</p>
					<label className={s.keep}>
						<input
							type="checkbox"
							checked={grey}
							onChange={(e) => setGrey(e.target.checked)}
							data-testid="compress-grey"
						/>
						{t("In grey, for a smaller file")}
					</label>
					<Button
						variant="secondary"
						disabled={running}
						onClick={() => go(asPictures)}
						data-testid="compress-pictures"
					>
						<Images size={18} /> {t("Turn pages into pictures")}
					</Button>
				</div>
			)}
			{feedback}
			<Go
				label={t("Compress")}
				disabled={!picked || (way === "typed" && !limit)}
				running={running}
				onClick={() => go(compress)}
			/>
		</>
	);
}

function ReadTool({ file, onOpen }: ToolProps) {
	const kit = useToolFiles("any", file);
	const picked = kit.files[0];
	const isPdf = picked?.pages !== undefined;
	const doc = usePdf(isPdf ? picked : undefined);
	const [source, setSource] = useState<ReadSource | null>(null);
	useEffect(() => {
		setSource(null);
		if (!picked) return;
		if (isPdf) {
			if (doc)
				setSource(
					pdfSource(doc, picked.name, picked.password, picked.protection),
				);
			return;
		}
		let alive = true;
		bytesSource(picked.bytes, picked.name)
			.then((made) => alive && setSource(made))
			.catch((err) => toast(unreadNote(err, picked.name)));
		return () => {
			alive = false;
		};
	}, [picked, isPdf, doc]);
	const key = useMemo(
		() =>
			picked && !picked.password ? contentKey(fileSample(picked.bytes)) : null,
		[picked],
	);
	return (
		<>
			<FileList kit={kit} several={false} addLabel={t("Choose a file")} />
			{kit.dialog}
			{source && picked && (
				<ReadText
					source={source}
					docKey={key}
					onClose={() => {
						setSource(null);
						kit.remove(picked.key);
					}}
					onSaved={(saved) => announceSaved(saved, onOpen)}
				/>
			)}
		</>
	);
}

function MergeTool({ file, onOpen }: ToolProps) {
	const kit = useToolFiles("pdf", file, { several: true });
	const { running, run, feedback } = useRun(onOpen);
	const total = kit.files.reduce((n, f) => n + (f.pages ?? 0), 0);
	return (
		<>
			<FileList kit={kit} several addLabel={t("Add PDFs")} />
			{kit.dialog}
			<CopyNote files={kit.files} />
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
	const kit = useToolFiles("image", file, { several: true });
	const { running, run, feedback } = useRun(onOpen);
	const [paper, setPaper] = useState<"fit" | keyof typeof PAPER>("a4");
	const [turn, setTurn] = useState<PaperTurn>("auto");
	const [margin, setMargin] = useState<"0" | "12" | "24">("24");
	return (
		<>
			<FileList kit={kit} several addLabel={t("Add pictures")} />
			<Choice
				label={t("Page size")}
				value={paper}
				onChange={setPaper}
				options={[
					["a4", "A4"],
					["letter", "Letter"],
					["legal", "Legal"],
					["fit", t("Picture size")],
				]}
				testId="tool-paper"
			/>
			{paper !== "fit" && (
				<>
					<Choice
						label={t("Orientation")}
						value={turn}
						onChange={setTurn}
						options={[
							["auto", t("Auto")],
							["portrait", t("Portrait")],
							["landscape", t("Landscape")],
						]}
						testId="tool-turn"
					/>
					<Choice
						label={t("Margin")}
						value={margin}
						onChange={setMargin}
						options={[
							["0", t("None")],
							["12", t("Narrow")],
							["24", t("Normal")],
						]}
						testId="tool-margin"
					/>
				</>
			)}
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
							{ turn, margin: Number(margin) },
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
	const [format, setFormat] = useState<"jpg" | "png">("jpg");
	const [dpi, setDpi] = useState<"96" | "150" | "300">("150");
	const pages = picked?.pages ?? 0;
	const list = picked ? parsePages(which || `1-${pages}`, pages) : null;
	return (
		<>
			<OnePdf kit={kit} copy={false} />
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
					{list && list.length > 1 && (
						<p className={s.hint}>
							{t("The pictures are saved together in a ZIP file.")}
						</p>
					)}
					<Choice
						label={t("Format")}
						value={format}
						onChange={setFormat}
						options={[
							["jpg", "JPEG"],
							["png", "PNG"],
						]}
						testId="tool-format"
					/>
					<Choice
						label={t("Quality")}
						value={dpi}
						onChange={setDpi}
						options={[
							["96", t("For screens")],
							["150", t("Standard")],
							["300", t("For printing")],
						]}
						testId="tool-dpi"
					/>
					<p className={s.hint}>
						{t("Pages are drawn at {n} dots to the inch.", { n: dpi })}
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
						const type = format === "png" ? "image/png" : "image/jpeg";
						const shots: Record<string, Uint8Array> = {};
						for (const page of list) {
							const sheet = await doc.getPage(page + 1);
							const { width, height } = sheet.getViewport({ scale: 1 });
							// No more than about 16 million pixels, which a phone can
							// still draw: a large page at print sharpness is drawn
							// less sharply.
							const most = 72 * Math.sqrt(16e6 / Math.max(1, width * height));
							const { bytes } = await drawPage(sheet, {
								dpi: Math.min(Number(dpi), most),
								type,
							});
							shots[`${stem} - ${t("page {n}", { n: page + 1 })}.${format}`] =
								bytes;
						}
						const names = Object.keys(shots);
						if (names.length === 1)
							return {
								name: names[0],
								bytes: shots[names[0]],
								mime: type,
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
	const [edge, side] = spot.split("-") as [
		"top" | "bottom",
		"left" | "center" | "right",
	];
	const [style, setStyle] = useState<"n" | "of">("n");
	const [size, setSize] = useState<"8" | "10" | "14">("10");
	const [start, setStart] = useState("1");
	const [skipFirst, setSkipFirst] = useState(false);
	// "Page 1 of 9" in the reader's language, where Helvetica can write it.
	const words = t("Page {n} of {total}");
	const fullPattern = standardText(words) ? words : "{n} / {total}";
	const pattern = style === "n" ? "{n}" : fullPattern;
	// A whole number from 1, as typed.
	const first = /^\d{1,6}$/.test(start.trim()) ? Number(start) : 0;
	return (
		<>
			<OnePdf kit={kit} />
			{/* Two short rows, not six cramped buttons on a phone. */}
			<Choice
				label={t("Where")}
				value={edge}
				onChange={(next) => setSpot(`${next}-${side}` as NumberSpot)}
				options={[
					["top", t("Top")],
					["bottom", t("Foot")],
				]}
				testId="tool-spot-edge"
			/>
			<Choice
				label={t("Align")}
				value={side}
				onChange={(next) => setSpot(`${edge}-${next}` as NumberSpot)}
				options={[
					["left", t("Left")],
					["center", t("Middle")],
					["right", t("Right")],
				]}
				testId="tool-spot-side"
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
			<Choice
				label={t("Size")}
				value={size}
				onChange={setSize}
				options={[
					["8", t("Small")],
					["10", t("Medium")],
					["14", t("Large")],
				]}
				testId="tool-number-size"
			/>
			<label className={s.label} htmlFor="tool-start">
				{t("Start at")}
			</label>
			<input
				id="tool-start"
				className={s.field}
				value={start}
				inputMode="numeric"
				maxLength={6}
				onChange={(e) => setStart(e.target.value)}
				dir="ltr"
				data-testid="tool-start"
			/>
			{first < 1 && (
				<p className={s.hint}>{t("Use a whole number, 1 or more.")}</p>
			)}
			<label className={s.keep}>
				<input
					type="checkbox"
					checked={skipFirst}
					onChange={(e) => setSkipFirst(e.target.checked)}
					data-testid="tool-skip-first"
				/>
				{t("No number on the first page")}
			</label>
			{feedback}
			<Go
				label={t("Number the pages")}
				disabled={!picked || first < 1}
				running={running}
				onClick={() =>
					run(async () => ({
						name: copyName(picked.name, t("numbered")),
						bytes: await addPageNumbers(picked.bytes, {
							password: picked.password,
							spot,
							pattern,
							first,
							size: Number(size),
							skipFirst,
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
	const [size, setSize] = useState<MarkSize>("large");
	const [tiled, setTiled] = useState<"one" | "tiled">("one");
	const [opacity, setOpacity] = useState<"0.12" | "0.18" | "0.35">("0.18");
	const [color, setColor] = useState<keyof typeof MARK_COLORS>("red");
	const [slant, setSlant] = useState<"slant" | "level">("slant");
	const [which, setWhich] = useState("");
	const pages = picked?.pages ?? 0;
	// Every page, unless some are named.
	const list = which.trim() ? parsePages(which, pages) : undefined;
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
			<Choice
				label={t("How many")}
				value={tiled}
				onChange={setTiled}
				options={[
					["one", t("One")],
					["tiled", t("Repeated")],
				]}
				testId="tool-mark-layout"
			/>
			<Choice
				label={t("Size")}
				value={size}
				onChange={setSize}
				options={[
					["small", t("Small")],
					["medium", t("Medium")],
					["large", t("Large")],
				]}
				testId="tool-mark-size"
			/>
			<Choice
				label={t("Strength")}
				value={opacity}
				onChange={setOpacity}
				options={[
					["0.12", t("Faint")],
					["0.18", t("Medium")],
					["0.35", t("Strong")],
				]}
				testId="tool-mark-strength"
			/>
			<Choice
				label={t("Colour")}
				value={color}
				onChange={setColor}
				options={[
					["grey", t("Grey")],
					["red", t("Red")],
					["blue", t("Blue")],
				]}
				testId="tool-mark-colour"
			/>
			<Choice
				label={t("Angle")}
				value={slant}
				onChange={setSlant}
				options={[
					["slant", t("Slanted")],
					["level", t("Straight")],
				]}
				testId="tool-mark-angle"
			/>
			{picked && (
				<>
					<label className={s.label} htmlFor="tool-mark-pages">
						{t("Pages")}
					</label>
					<input
						id="tool-mark-pages"
						className={s.field}
						value={which}
						onChange={(e) => setWhich(e.target.value)}
						placeholder={t("All of them")}
						dir="ltr"
						data-testid="tool-mark-pages"
					/>
					{list === null && (
						<p className={s.hint}>
							{t("The document has {n} pages", { n: pages })}
						</p>
					)}
				</>
			)}
			{feedback}
			<Go
				label={t("Add the watermark")}
				disabled={!picked || !usable || list === null}
				running={running}
				onClick={() =>
					run(async () => ({
						name: copyName(picked.name, t("watermarked")),
						bytes: await addWatermark(picked.bytes, {
							text: text.trim(),
							password: picked.password,
							size,
							tiled: tiled === "tiled",
							opacity: Number(opacity),
							color: MARK_COLORS[color],
							slant: slant === "slant",
							pages: list ?? undefined,
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
	const [printing, setPrinting] = useState(true);
	const [copying, setCopying] = useState(true);
	const [changes, setChanges] = useState(true);
	const same = one === two;
	const allows: Array<[string, boolean, (on: boolean) => void, string]> = [
		[t("Allow printing"), printing, setPrinting, "tool-allow-print"],
		[t("Allow copying text"), copying, setCopying, "tool-allow-copy"],
		[t("Allow changes"), changes, setChanges, "tool-allow-change"],
	];
	return (
		<>
			<OnePdf kit={kit} copy={false} />
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
			{allows.map(([label, on, set, testId]) => (
				<label key={testId} className={s.keep}>
					<input
						type="checkbox"
						checked={on}
						onChange={(e) => set(e.target.checked)}
						data-testid={testId}
					/>
					{label}
				</label>
			))}
			{!(printing && copying && changes) && (
				<p className={s.hint}>
					{t(
						"Most PDF readers keep to these limits, but a reader can choose to ignore them.",
					)}
				</p>
			)}
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
							allow: { printing, copying, changes },
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
			<OnePdf kit={kit} copy={false} />
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
