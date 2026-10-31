import { type SavedFile, backend } from "@/lib/backend";
import { copyName, splitName } from "@/lib/fileName";
import { LANGUAGES, type Language, language, t, tn } from "@/lib/i18n";
import { blockId, newNote, saveNote } from "@/lib/notes";
import {
	DOUBTFUL,
	OcrReader,
	type ReadLine,
	linesOfTable,
	textOfLines,
} from "@/lib/ocr";
import { loadRead, saveRead } from "@/lib/ocrStore";
import { addTextLayer } from "@/lib/pdfTools";
import { holdScreen } from "@/lib/wake";
import { useBackClose } from "@/state/navigation";
import { Button, IconButton, toast } from "@/ui";
import { useModalFocus } from "@/ui/Overlay";
import {
	ArrowLeft,
	Check,
	Copy,
	Download,
	FileSearch,
	NotebookPen,
	Play,
	ScanText,
	Square,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import s from "./ReadText.module.css";
import { LOOKING_DPI, READING_DPI, type ReadSource } from "./readSource";

interface PageRead {
	lines: ReadLine[];
	/** The page had these words of its own: nothing was worked out. */
	own: boolean;
}

type Phase = "ready" | "reading" | "done";

/** The engine spends this share of its count on the page's layout,
 * before the first word. */
const LAYOUT_SHARE = 0.3;
/** Words lit one after another, and how long the last may wait. */
const WORD_STEP_MS = 5;
const WORDS_MAX_MS = 900;

const wordCount = (reads: Record<number, PageRead>) =>
	Object.values(reads).reduce(
		(sum, read) =>
			sum + read.lines.reduce((n, line) => n + line.words.length, 0),
		0,
	);

/** Every page's text in page order. */
function allText(reads: Record<number, PageRead>, numbered: boolean) {
	return Object.keys(reads)
		.map(Number)
		.sort((a, b) => a - b)
		.map((page) => {
			const text = textOfLines(reads[page].lines);
			return numbered ? `[Page ${page + 1}]\n${text}` : text;
		})
		.filter(Boolean)
		.join("\n\n");
}

/**
 * Read the words off the pages, where the reader can watch it happen:
 * the page, a line sweeping down it as the engine works through it, the
 * words lighting up where they were found, and the text gathering
 * beside it. A page with words of its own gives them straight away. The
 * text is the result; saving it anywhere is the reader's choice.
 */
export function ReadText({
	source,
	docKey,
	start = 0,
	onClose,
	onSaved,
}: {
	source: ReadSource;
	/** Where what is read is kept; none for a password-protected file. */
	docKey?: string | null;
	/** The page to begin from, when opened from a page. */
	start?: number;
	onClose: () => void;
	onSaved?: (saved: SavedFile) => void;
}) {
	const [phase, setPhase] = useState<Phase>("ready");
	const [lang, setLang] = useState<Language>(language);
	const [scope, setScope] = useState<"all" | "this">("all");
	const [reads, setReads] = useState<Record<number, PageRead>>({});
	const readsRef = useRef(reads);
	readsRef.current = reads;
	const [shown, setShown] = useState(start);
	const [working, setWorking] = useState<number | null>(null);
	const [share, setShare] = useState(0);
	const [loading, setLoading] = useState(false);
	const [picture, setPicture] = useState<{
		page: number;
		url: string;
		ratio: number;
	} | null>(null);
	const [lit, setLit] = useState<{ page: number; line: number } | null>(null);
	const [saving, setSaving] = useState(false);
	const reader = useRef<OcrReader | null>(null);
	const screen = useRef<HTMLDivElement>(null);
	const textBox = useRef<HTMLDivElement>(null);
	const followText = useRef(true);
	const alive = useRef(true);

	const stop = useCallback(() => {
		reader.current?.stop();
		reader.current = null;
	}, []);
	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
			stop();
		};
	}, [stop]);
	const close = useCallback(() => {
		stop();
		onClose();
	}, [stop, onClose]);
	useBackClose("read-text", true, close);
	useModalFocus(screen, close);

	// What was read before: a page is only ever read once.
	useEffect(() => {
		if (!docKey) return;
		let live = true;
		loadRead(docKey).then((kept) => {
			if (!live || !kept) return;
			const pages: Record<number, PageRead> = {};
			for (const [page, lines] of Object.entries(kept.pages))
				pages[Number(page)] = { lines, own: false };
			if (!Object.keys(pages).length) return;
			setLang(kept.language);
			setReads(pages);
			setPhase("done");
		});
		return () => {
			live = false;
		};
	}, [docKey]);

	const showPicture = (page: number, bytes: Uint8Array, ratio: number) => {
		const url = URL.createObjectURL(
			new Blob([bytes as BlobPart], { type: "image/jpeg" }),
		);
		setPicture((was) => {
			if (was) URL.revokeObjectURL(was.url);
			return { page, url, ratio };
		});
	};
	// biome-ignore lint/correctness/useExhaustiveDependencies: let go of the last picture on leaving
	useEffect(
		() => () => {
			setPicture((was) => {
				if (was) URL.revokeObjectURL(was.url);
				return null;
			});
		},
		[],
	);

	// The page on show, drawn to look at. While reading, the picture
	// being read is the one shown.
	useEffect(() => {
		if (working !== null || picture?.page === shown) return;
		let live = true;
		source
			.picture(shown, LOOKING_DPI)
			.then(({ bytes, width, height }) => {
				if (live) showPicture(shown, bytes, width / height);
			})
			.catch(() => {});
		return () => {
			live = false;
		};
	}, [source, shown, working, picture?.page]);

	const pagesWanted = useMemo(
		() =>
			scope === "this"
				? [start]
				: Array.from({ length: source.pages }, (_, i) => i),
		[scope, start, source.pages],
	);
	const missing = pagesWanted.filter((page) => !reads[page]);

	const keep = (next: Record<number, PageRead>, language: Language) => {
		if (!docKey) return;
		const pages: Record<string, ReadLine[]> = {};
		for (const [page, read] of Object.entries(next))
			if (!read.own) pages[page] = read.lines;
		saveRead(docKey, Object.keys(pages).length ? { language, pages } : null);
	};

	const run = async () => {
		const todo = pagesWanted.filter((page) => !readsRef.current[page]);
		if (!todo.length) return;
		const job = new OcrReader(lang);
		reader.current = job;
		const release = holdScreen();
		setPhase("reading");
		followText.current = true;
		try {
			for (const page of todo) {
				if (reader.current !== job) return;
				setWorking(page);
				setShown(page);
				setShare(0);
				const own = await source.ownLines(page);
				let read: PageRead;
				if (own) read = { lines: own, own: true };
				else {
					const { bytes, width, height } = await source.picture(
						page,
						READING_DPI,
					);
					if (!alive.current) return;
					showPicture(page, bytes, width / height);
					setLoading(true);
					const table = await job.read(bytes, (now) => {
						setLoading(false);
						setShare(Math.max(0, (now - LAYOUT_SHARE) / (1 - LAYOUT_SHARE)));
					});
					setLoading(false);
					read = { lines: linesOfTable(table, width, height), own: false };
				}
				if (!alive.current) return;
				const next = { ...readsRef.current, [page]: read };
				readsRef.current = next;
				setReads(next);
				keep(next, lang);
			}
		} catch {
			// Stopped, which keeps what was read: anything else says so.
			if (reader.current === job) toast(t("Couldn't read this page"));
		} finally {
			release();
			job.stop();
			if (reader.current === job) reader.current = null;
			if (alive.current) {
				setWorking(null);
				setLoading(false);
				setShare(0);
				setPhase("done");
			}
		}
	};

	const changeLanguage = (next: Language) => {
		setLang(next);
		if (phase !== "done") return;
		// Read in the wrong language, the words are wrong: start over.
		const kept: Record<number, PageRead> = {};
		for (const [page, read] of Object.entries(reads))
			if (read.own) kept[Number(page)] = read;
		setReads(kept);
		keep(kept, next);
		setPhase("ready");
	};

	// The text follows the reading, until the reader scrolls it themself.
	const lastPage = Object.keys(reads).length;
	// biome-ignore lint/correctness/useExhaustiveDependencies: a new page has come in
	useEffect(() => {
		if (phase !== "reading" || !followText.current) return;
		const box = textBox.current;
		box?.lastElementChild?.scrollIntoView({
			block: "start",
			behavior: "smooth",
		});
	}, [lastPage, phase]);

	const light = (page: number, line: number) => {
		setLit({ page, line });
		if (working === null) setShown(page);
	};
	const fromPicture = (page: number, line: number) => {
		setLit({ page, line });
		textBox.current
			?.querySelector(`[data-line="${page}-${line}"]`)
			?.scrollIntoView({ block: "nearest", behavior: "smooth" });
	};

	const copy = async (numbered: boolean) => {
		try {
			await navigator.clipboard.writeText(allText(reads, numbered));
			toast(t("Copied"));
		} catch {
			toast(t("Couldn't copy"));
		}
	};
	const saveText = async () => {
		const saved = await backend
			.saveFile(
				`${splitName(source.name)[0]}.txt`,
				new TextEncoder().encode(allText(reads, false)),
				"text/plain",
			)
			.catch(() => {
				toast(t("Couldn't save a copy"));
				return null;
			});
		if (saved) onSaved?.(saved);
	};
	const toNotes = async () => {
		const made = newNote();
		made.title = splitName(source.name)[0];
		made.blocks = [
			{ kind: "text", id: blockId(), text: allText(reads, false) },
		];
		await saveNote(made)
			.then(() => toast(t("Added to Notes")))
			.catch(() => toast(t("Couldn't save a copy")));
	};
	const scanned = Object.entries(reads).filter(([, read]) => !read.own);
	const saveSearchable = async () => {
		if (!source.pdf) return;
		setSaving(true);
		try {
			const bytes = await addTextLayer(
				await source.pdf(),
				scanned.map(([page, read]) => ({
					page: Number(page),
					words: read.lines.flatMap((line) => line.words),
				})),
				{ password: source.password },
			);
			const saved = await backend.saveFile(
				copyName(source.name, t("searchable")),
				bytes,
				"application/pdf",
			);
			if (saved) onSaved?.(saved);
		} catch {
			toast(t("Couldn't save a copy"));
		} finally {
			setSaving(false);
		}
	};

	const words = wordCount(reads);
	const readPages = Object.keys(reads).map(Number);
	const onShown = reads[shown];
	const total = pagesWanted.length;
	const doneCount = total - missing.length;
	const overall = total ? (doneCount + share) / total : 0;
	const sweep = working === shown && !onShown;

	const status =
		phase === "reading"
			? loading
				? t("Getting ready…")
				: t("Reading page {n} of {total}", {
						n: (working ?? 0) + 1,
						total: source.pages,
					})
			: phase === "done"
				? words
					? tn(words, "{n} word found", "{n} words found")
					: t("No words were found")
				: "";

	const languagePicker = (
		<label className={s.language}>
			<span>{t("Language of the document")}</span>
			<select
				value={lang}
				disabled={phase === "reading"}
				onChange={(e) => changeLanguage(e.target.value as Language)}
				data-testid="read-language"
			>
				{LANGUAGES.map(([code, name]) => (
					<option key={code} value={code}>
						{name}
					</option>
				))}
			</select>
		</label>
	);

	return createPortal(
		<div
			ref={screen}
			tabIndex={-1}
			className={s.screen}
			// biome-ignore lint/a11y/useSemanticElements: a full-screen surface, not a native dialog
			role="dialog"
			aria-modal="true"
			aria-label={t("Read text")}
			data-testid="read-text"
			data-phase={phase}
		>
			<header className={s.bar} data-tauri-drag-region="deep">
				<IconButton label={t("Close")} onClick={close} data-testid="read-close">
					<ArrowLeft size={22} className="pw-flip" />
				</IconButton>
				<div className={s.title}>
					<strong>{t("Read text")}</strong>
					<span dir="auto">{source.name}</span>
				</div>
			</header>

			<div className={s.body}>
				<section
					className={s.stage}
					aria-label={t("Page {n}", { n: shown + 1 })}
				>
					<div className={s.room}>
						{picture ? (
							<div
								className={s.paper}
								style={{ "--ratio": picture.ratio } as React.CSSProperties}
								data-sweep={sweep || undefined}
								data-finding={(sweep && share === 0) || undefined}
							>
								<img src={picture.url} alt="" draggable={false} />
								{sweep && (
									<>
										<div
											className={s.swept}
											style={{ height: `${share * 100}%` }}
										/>
										<div
											className={s.beam}
											style={{ top: `${share * 100}%` }}
											data-testid="read-beam"
										/>
									</>
								)}
								{onShown?.lines.map((line, index) => (
									// biome-ignore lint/a11y/useKeyWithClickEvents: the same lines are buttons in the text beside it
									// biome-ignore lint/a11y/noStaticElementInteractions: as above
									<div
										key={`${index}-${line.y}`}
										className={s.lineBox}
										data-lit={
											(lit?.page === shown && lit.line === index) || undefined
										}
										style={{
											left: `${line.x * 100}%`,
											top: `${line.y * 100}%`,
											width: `${line.w * 100}%`,
											height: `${line.h * 100}%`,
											animationDelay: `${Math.min(
												WORDS_MAX_MS,
												index * WORD_STEP_MS * 8,
											)}ms`,
										}}
										onClick={() => fromPicture(shown, index)}
									/>
								))}
							</div>
						) : (
							<div className={s.waiting} />
						)}
					</div>
					{source.pages > 1 && (
						<div className={s.strip} data-testid="read-pages">
							{Array.from({ length: source.pages }, (_, page) => (
								<button
									// biome-ignore lint/suspicious/noArrayIndexKey: pages keep their order
									key={page}
									type="button"
									className={s.chip}
									aria-current={page === shown ? "page" : undefined}
									aria-label={t("Page {n}", { n: page + 1 })}
									data-done={reads[page] ? "" : undefined}
									data-now={working === page ? "" : undefined}
									disabled={working !== null}
									onClick={() => setShown(page)}
								>
									{reads[page] ? <Check size={12} /> : page + 1}
								</button>
							))}
						</div>
					)}
				</section>

				<section className={s.panel}>
					{phase === "ready" ? (
						<div className={s.start}>
							<span className={s.startIcon}>
								<ScanText size={26} />
							</span>
							<h2>{t("Get the words from these pages")}</h2>
							<p>
								{t(
									"You'll see each page being read, and its text will appear here to copy. Nothing leaves this device.",
								)}
							</p>
							{languagePicker}
							{source.pages > 1 && (
								<div className={s.scope}>
									<button
										type="button"
										aria-pressed={scope === "all"}
										onClick={() => setScope("all")}
										data-testid="read-scope-all"
									>
										{tn(source.pages, "All {n} page", "All {n} pages")}
									</button>
									<button
										type="button"
										aria-pressed={scope === "this"}
										onClick={() => setScope("this")}
										data-testid="read-scope-this"
									>
										{t("Only page {n}", { n: start + 1 })}
									</button>
								</div>
							)}
							<Button block onClick={run} data-testid="read-start">
								<Play size={18} /> {t("Start reading")}
							</Button>
							<p className={s.fine}>
								{t(
									"Clear print reads best. Handwriting, faint scans and Nastaliq Urdu can come out with mistakes.",
								)}
							</p>
						</div>
					) : (
						<>
							<div className={s.head}>
								<output aria-live="polite" data-testid="read-status">
									{status}
								</output>
								{phase === "done" && languagePicker}
							</div>
							{phase === "reading" && (
								<div className={s.track} aria-hidden="true">
									<div style={{ transform: `scaleX(${overall})` }} />
								</div>
							)}
							<div
								ref={textBox}
								className={s.text}
								data-testid="read-result"
								onWheel={() => {
									followText.current = false;
								}}
								onTouchMove={() => {
									followText.current = false;
								}}
							>
								{!readPages.length && phase === "reading" && (
									<div className={s.ghost} aria-hidden="true">
										<span />
										<span />
										<span />
										<p>{t("The words will appear here.")}</p>
									</div>
								)}
								{readPages
									.sort((a, b) => a - b)
									.map((page) => (
										<article key={page} data-page={page}>
											<h3>
												{t("Page {n}", { n: page + 1 })}
												{reads[page].own && <small>{t("Its own text")}</small>}
											</h3>
											{reads[page].lines.length === 0 && (
												<p className={s.none}>{t("No words on this page.")}</p>
											)}
											{reads[page].lines.map((line, index) => (
												// biome-ignore lint/a11y/useKeyWithClickEvents: selecting the words comes first; this only points at them on the page
												// biome-ignore lint/a11y/noNoninteractiveElementInteractions: as above
												<p
													key={`${index}-${line.y}`}
													className={s.line}
													dir="auto"
													data-opens={line.opens || undefined}
													data-line={`${page}-${index}`}
													data-lit={
														(lit?.page === page && lit.line === index) ||
														undefined
													}
													style={
														{
															"--at": `${Math.min(
																WORDS_MAX_MS,
																index * WORD_STEP_MS * 8,
															)}ms`,
														} as React.CSSProperties
													}
													onClick={() => light(page, index)}
												>
													{line.words.map((word, i) => (
														<span
															// biome-ignore lint/suspicious/noArrayIndexKey: words keep their order
															key={i}
															className={
																word.sure !== undefined && word.sure < DOUBTFUL
																	? s.doubtful
																	: undefined
															}
														>
															{i ? " " : ""}
															{word.text}
														</span>
													))}
												</p>
											))}
										</article>
									))}
							</div>
						</>
					)}
				</section>
			</div>

			{phase === "reading" && (
				<footer className={s.actions}>
					<span className={s.hint}>
						{t("You can stop at any time and keep what's been read.")}
					</span>
					<Button variant="secondary" onClick={stop} data-testid="read-stop">
						<Square size={16} /> {t("Stop")}
					</Button>
				</footer>
			)}
			{phase === "done" && words > 0 && (
				<footer className={s.actions}>
					{missing.length > 0 && (
						<Button onClick={run} data-testid="read-more">
							<Play size={16} />
							{tn(missing.length, "Read {n} more page", "Read {n} more pages")}
						</Button>
					)}
					<Button
						variant={missing.length ? "secondary" : "primary"}
						onClick={() => copy(false)}
						data-testid="read-copy"
					>
						<Copy size={16} /> {t("Copy all")}
					</Button>
					<Button
						variant="secondary"
						onClick={saveText}
						data-testid="read-save-text"
					>
						<Download size={16} /> {t("Save as text")}
					</Button>
					<Button
						variant="secondary"
						onClick={toNotes}
						data-testid="read-notes"
					>
						<NotebookPen size={16} /> {t("Add to Notes")}
					</Button>
					{source.pdf && scanned.length > 0 && (
						<Button
							variant="secondary"
							onClick={saveSearchable}
							disabled={saving}
							data-testid="read-save-pdf"
						>
							<FileSearch size={16} />
							{saving ? t("Saving…") : t("Save a searchable PDF")}
						</Button>
					)}
					<button
						type="button"
						className={s.link}
						onClick={() => copy(true)}
						data-testid="read-copy-ai"
					>
						{t("Copy with page numbers, for an AI assistant")}
					</button>
				</footer>
			)}
			{phase === "done" && !words && missing.length > 0 && (
				<footer className={s.actions}>
					<Button onClick={run} data-testid="read-more">
						<Play size={16} />
						{tn(missing.length, "Read {n} more page", "Read {n} more pages")}
					</Button>
				</footer>
			)}
		</div>,
		document.body,
	);
}
