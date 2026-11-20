import { type SavedFile, backend, requestForSaved } from "@/lib/backend";
import { unreadNote } from "@/lib/errors";
import { byName } from "@/lib/fileName";
import { t, tn } from "@/lib/i18n";
import { holdOpen } from "@/lib/openFiles";
import { openPdf } from "@/lib/pdfEngine";
import {
	type Protection,
	ToolError,
	pdfInfo,
	pdfProtection,
} from "@/lib/pdfTools";
import { copyNote } from "@/lib/protection";
import { sniffFormat } from "@/lib/sniff";
import type { OpenRequest, Reopen } from "@/lib/types";
import { PasswordDialog } from "@/screens/viewer/Dialogs";
import { Button, IconButton, toast } from "@/ui";
import {
	ArrowDown,
	ArrowDownAZ,
	ArrowUp,
	Check,
	FilePlus2,
	FileText,
	Image,
	X,
} from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
	type CSSProperties,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import s from "./Tools.module.css";
import { announceSaved } from "./saved";

/** A file a tool works on, read into memory. */
export interface ToolFile {
	key: number;
	name: string;
	bytes: Uint8Array;
	/** PDFs: how many pages, and the password it was opened with. */
	pages?: number;
	password?: string;
	/** PDFs: what a copy of it will not keep, to say before saving one. */
	protection?: Protection | null;
	/** Where it was read from, so a copy is never saved over it. */
	reopen?: Reopen;
}

let keys = 0;
let lists = 0;

/** What the tools take in. */
export type Takes = "pdf" | "image" | "any";

/** The most files one pick adds: a few hundred pictures is a book. */
export const MOST_AT_ONCE = 200;

/** Ask for a PDF's password until it opens or the reader gives up. */
function usePassword() {
	const [asking, setAsking] = useState<{
		name: string;
		wrong: boolean;
		answer: (password: string | null) => void;
	} | null>(null);
	const ask = useCallback(
		(name: string, wrong: boolean) =>
			new Promise<string | null>((answer) =>
				setAsking({ name, wrong, answer }),
			),
		[],
	);
	const dialog = asking ? (
		<PasswordDialog
			open
			name={asking.name}
			wrong={asking.wrong}
			onSubmit={(password) => {
				setAsking(null);
				asking.answer(password);
			}}
			onCancel={() => {
				setAsking(null);
				asking.answer(null);
			}}
			testId="tool"
		/>
	) : null;
	return { ask, dialog };
}

/**
 * The files a tool works on: picked (many at once, for a tool that puts
 * `several` together) or handed in, kept in order, moved up and down,
 * sorted by name, taken away. PDFs are opened to count their pages,
 * asking for a password when one is needed.
 */
export function useToolFiles(
	takes: Takes,
	initial?: OpenRequest,
	{ several = false }: { several?: boolean } = {},
) {
	const [files, setFiles] = useState<ToolFile[]>([]);
	const [busy, setBusy] = useState(false);
	/** Files of one pick coming in, one after another. */
	const [adding, setAdding] = useState<{ done: number; total: number } | null>(
		null,
	);
	const picking = useRef(false);
	const alive = useRef(true);
	const password = usePassword();

	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
		};
	}, []);

	// What the tool works on is open: a copy it saves never goes over it.
	const [owner] = useState(() => `tool-files-${++lists}`);
	useEffect(() => {
		holdOpen(
			owner,
			files.map((f) => f.reopen),
		);
		return () => holdOpen(owner, []);
	}, [owner, files]);

	const adopt = useCallback(
		async (request: OpenRequest) => {
			setBusy(true);
			try {
				const bytes = new Uint8Array(await backend.read(request.reopen));
				if (!alive.current) return;
				const format = sniffFormat(bytes.buffer as ArrayBuffer, request.name);
				if (takes === "pdf" && format !== "pdf") {
					toast(t("{name} isn't a PDF", { name: request.name }));
					return;
				}
				if (takes === "image" && format !== "image") {
					toast(t("{name} isn't a picture", { name: request.name }));
					return;
				}
				if (takes === "any" && format !== "pdf" && format !== "image") {
					toast(t("{name} isn't a PDF or a picture", { name: request.name }));
					return;
				}
				const file: ToolFile = {
					key: ++keys,
					name: request.name,
					bytes,
					reopen: request.reopen,
				};
				if (format === "pdf" && takes !== "image") {
					let tried: string | undefined;
					let wrong = false;
					for (;;) {
						try {
							const info = await pdfInfo(bytes, tried);
							if (!alive.current) return;
							file.pages = info.pages;
							file.password = tried;
							file.protection = pdfProtection({
								password: tried,
								protected: info.protected,
							});
							break;
						} catch (err) {
							if (!alive.current) return;
							if (!(err instanceof ToolError) || err.reason !== "password") {
								toast(unreadNote(err, request.name));
								return;
							}
							const answer = await password.ask(request.name, wrong);
							if (!alive.current || answer === null) return;
							tried = answer;
							wrong = true;
						}
					}
				}
				if (alive.current) setFiles((list) => [...list, file]);
			} catch (err) {
				if (alive.current) toast(unreadNote(err, request.name));
			} finally {
				if (alive.current) setBusy(false);
			}
		},
		[takes, password.ask],
	);

	const given = useRef(false);
	useEffect(() => {
		if (initial && !given.current) {
			given.current = true;
			adopt(initial);
		}
	}, [initial, adopt]);

	const add = async () => {
		if (picking.current || busy) return;
		picking.current = true;
		try {
			if (!several) {
				const picked = await backend.pickFile();
				if (picked && alive.current) await adopt(picked);
				return;
			}
			const picked = await backend.pickFiles({ pictures: takes === "image" });
			if (!alive.current) return;
			if (picked.length > MOST_AT_ONCE)
				toast(t("Only the first {n} were added", { n: MOST_AT_ONCE }));
			const taken = picked.slice(0, MOST_AT_ONCE);
			// In the order picked; one that can't be read is said and
			// skipped, the others still come in. Those past the most are
			// never made ready, so nothing of them is copied in.
			for (const [i, ready] of taken.entries()) {
				if (!alive.current) return;
				if (taken.length > 1) setAdding({ done: i + 1, total: taken.length });
				const req = await ready();
				if (!alive.current) return;
				await adopt(req);
			}
		} catch {
			if (alive.current) toast(t("Couldn't open the file picker"));
		} finally {
			picking.current = false;
			if (alive.current) setAdding(null);
		}
	};
	const sortByName = () => setFiles((list) => byName(list));
	const move = (key: number, by: -1 | 1) =>
		setFiles((list) => {
			const at = list.findIndex((f) => f.key === key);
			const to = at + by;
			if (at < 0 || to < 0 || to >= list.length) return list;
			const next = [...list];
			[next[at], next[to]] = [next[to], next[at]];
			return next;
		});
	const remove = (key: number) =>
		setFiles((list) => list.filter((f) => f.key !== key));
	return {
		files,
		busy: busy || adding !== null,
		adding,
		takes,
		several,
		add,
		move,
		remove,
		sortByName,
		dialog: password.dialog,
	};
}

/** The files, in order, with a button to add one. */
export function FileList({
	kit,
	several,
	addLabel,
	disabled = false,
}: {
	kit: ReturnType<typeof useToolFiles>;
	/** Several files, in an order the reader sets. */
	several: boolean;
	addLabel: string;
	/** Locked while the tool is running. */
	disabled?: boolean;
}) {
	const { files, busy, add, move, remove, adding, sortByName } = kit;
	const locked = busy || disabled;
	return (
		<div className={s.files} aria-busy={busy}>
			{files.length > 0 && (
				<div className={s.fileHeading}>
					<Check size={16} />
					<span>{t("Selected files")}</span>
					{several && files.length > 2 && (
						<button
							type="button"
							className={s.sortFiles}
							onClick={sortByName}
							disabled={locked}
							data-testid="tool-files-sort"
						>
							<ArrowDownAZ size={15} />
							{t("Sort by name")}
						</button>
					)}
				</div>
			)}
			{files.map((file, i) => (
				<div key={file.key} className={s.fileRow} data-testid="tool-file">
					<span className={s.fileBadge} aria-hidden="true">
						{several ? i + 1 : <FileText size={20} />}
					</span>
					<span className={s.fileName} dir="auto">
						{file.name}
					</span>
					{file.pages !== undefined && (
						<span className={s.fileMeta}>
							{tn(file.pages, "{n} page", "{n} pages")}
						</span>
					)}
					{several && (
						<>
							<IconButton
								label={t("Move up")}
								disabled={i === 0 || locked}
								onClick={() => move(file.key, -1)}
								data-testid="tool-file-up"
							>
								<ArrowUp size={18} />
							</IconButton>
							<IconButton
								label={t("Move down")}
								disabled={i === files.length - 1 || locked}
								onClick={() => move(file.key, 1)}
							>
								<ArrowDown size={18} />
							</IconButton>
						</>
					)}
					<IconButton
						label={t("Remove {name}", { name: file.name })}
						disabled={locked}
						onClick={() => remove(file.key)}
						data-testid="tool-file-remove"
					>
						<X size={18} />
					</IconButton>
				</div>
			))}
			{(several || !files.length) && (
				<div className={!files.length ? s.pickZone : s.addMore}>
					{!files.length && (
						<>
							<span className={s.pickIcon}>
								{kit.takes === "image" ? (
									<Image size={30} />
								) : (
									<FilePlus2 size={30} />
								)}
							</span>
							<h3>
								{kit.takes === "pdf"
									? t("Start with your PDF")
									: kit.takes === "any"
										? t("Start with a PDF or a picture")
										: t("Start with your pictures")}
							</h3>
							<p>{t("Choose a file from your device to get started.")}</p>
						</>
					)}
					<Button
						variant={files.length ? "secondary" : "primary"}
						onClick={add}
						disabled={locked}
						data-testid="tool-add"
					>
						<FilePlus2 size={18} />{" "}
						{adding
							? t("Adding {n} of {total}…", {
									n: adding.done,
									total: adding.total,
								})
							: busy
								? t("Opening…")
								: addLabel}
					</Button>
				</div>
			)}
		</div>
	);
}

/** Run a tool and save what it made, saying how it went. */
export function useRun(onOpen?: (request: OpenRequest) => void) {
	const [running, setRunning] = useState(false);
	const inFlight = useRef(false);
	const alive = useRef(true);
	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
		};
	}, []);
	const [result, setResult] = useState<(SavedFile & { size: number }) | null>(
		null,
	);
	const [error, setError] = useState("");
	const run = async (
		make: () => Promise<{
			name: string;
			bytes: Uint8Array;
			mime: string;
		} | null>,
	): Promise<SavedFile | null> => {
		if (inFlight.current) return null;
		inFlight.current = true;
		setRunning(true);
		setResult(null);
		setError("");
		try {
			const made = await make();
			// The tool found nothing to save, and says so itself.
			if (!made || !alive.current) return null;
			const saved = await backend.saveFile(made.name, made.bytes, made.mime);
			if (!alive.current) return saved;
			setResult(saved ? { ...saved, size: made.bytes.length } : null);
			if (saved) announceSaved(saved, onOpen, made.bytes.length);
			return saved;
		} catch (err) {
			if (!alive.current) return null;
			const message =
				err instanceof ToolError && err.reason === "password"
					? t("This PDF's password is needed to save a copy")
					: t("Couldn't save a copy");
			setError(message);
			toast(message);
			return null;
		} finally {
			inFlight.current = false;
			if (alive.current) setRunning(false);
		}
	};
	const request = result ? requestForSaved(result, result.size) : null;
	const feedback = result ? (
		<output className={s.result}>
			<Check size={20} />
			<span>{t("Saved as {name}", { name: result.name })}</span>
			{request && onOpen && (
				<Button variant="secondary" onClick={() => onOpen(request)}>
					{t("Open")}
				</Button>
			)}
		</output>
	) : error ? (
		<p className={s.error} role="alert">
			{error}
		</p>
	) : null;
	return { running, run, feedback };
}

/** A PDF opened for drawing its pages, while it is in use. */
export function usePdf(file: ToolFile | undefined) {
	const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
	useEffect(() => {
		setDoc(null);
		if (!file) {
			return;
		}
		let alive = true;
		let opened: PDFDocumentProxy | null = null;
		openPdf(file.bytes, file.password)
			.then((d) => {
				opened = d;
				if (alive) setDoc(d);
				else d.destroy();
			})
			.catch((err) => {
				if (alive) toast(unreadNote(err, file.name));
			});
		return () => {
			alive = false;
			opened?.destroy();
		};
	}, [file]);
	return doc;
}

const thumbListeners = new Map<Element, (near: boolean) => void>();
let thumbObserver: IntersectionObserver | null = null;

function observeThumb(
	el: Element,
	onChange: (near: boolean) => void,
): () => void {
	if (!thumbObserver) {
		thumbObserver = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					thumbListeners.get(entry.target)?.(entry.isIntersecting);
				}
			},
			{ rootMargin: "300px 0px" },
		);
	}
	thumbListeners.set(el, onChange);
	thumbObserver.observe(el);
	return () => {
		thumbObserver?.unobserve(el);
		thumbListeners.delete(el);
		if (thumbListeners.size === 0) {
			thumbObserver?.disconnect();
			thumbObserver = null;
		}
	};
}

const MAX_THUMB_RENDERS = 4;
interface ThumbJob {
	cancelled: boolean;
	start: () => Promise<void>;
}
const thumbQueue: ThumbJob[] = [];
let activeThumbRenders = 0;

function pumpThumbQueue() {
	while (activeThumbRenders < MAX_THUMB_RENDERS && thumbQueue.length > 0) {
		const job = thumbQueue.shift();
		if (!job || job.cancelled) continue;
		activeThumbRenders++;
		job
			.start()
			.catch(() => {})
			.finally(() => {
				activeThumbRenders--;
				pumpThumbQueue();
			});
	}
}

function enqueueThumb(start: () => Promise<void>): () => void {
	const job: ThumbJob = { cancelled: false, start };
	thumbQueue.push(job);
	pumpThumbQueue();
	return () => {
		job.cancelled = true;
		const at = thumbQueue.indexOf(job);
		if (at >= 0) thumbQueue.splice(at, 1);
	};
}

/** A page drawn small, turned by `turn` degrees. */
export function PageThumb({
	doc,
	page,
	turn = 0,
	width = 120,
}: {
	doc: PDFDocumentProxy;
	page: number;
	turn?: number;
	width?: number;
}) {
	const canvas = useRef<HTMLCanvasElement>(null);
	const [shape, setShape] = useState(1 / 1.41);
	const [near, setNear] = useState(false);

	useEffect(() => {
		const el = canvas.current;
		if (!el) return;
		return observeThumb(el, setNear);
	}, []);

	useEffect(() => {
		const el = canvas.current;
		if (!near) {
			if (el && (el.width || el.height)) {
				el.width = 0;
				el.height = 0;
			}
			return;
		}
		let alive = true;
		let task: { cancel(): void; promise: Promise<void> } | null = null;
		const cancelQueued = enqueueThumb(async () => {
			if (!alive) return;
			const proxy = await doc.getPage(page + 1);
			const target = canvas.current;
			const ctx = target?.getContext("2d");
			if (!alive || !target || !ctx) return;
			const base = proxy.getViewport({
				scale: 1,
				rotation: (proxy.rotate + turn) % 360,
			});
			setShape(base.width / base.height);
			const density = Math.min(2, window.devicePixelRatio || 1);
			const viewport = proxy.getViewport({
				scale: (width * density) / base.width,
				rotation: (proxy.rotate + turn) % 360,
			});
			target.width = Math.ceil(viewport.width);
			target.height = Math.ceil(viewport.height);
			task = proxy.render({ canvasContext: ctx, viewport });
			await task.promise.catch(() => {});
		});
		return () => {
			alive = false;
			cancelQueued();
			task?.cancel();
		};
	}, [doc, page, turn, width, near]);

	// Release GPU/RAM backing store on unmount.
	useEffect(() => {
		const el = canvas.current;
		return () => {
			if (el) {
				el.width = 0;
				el.height = 0;
			}
		};
	}, []);

	return (
		<canvas
			ref={canvas}
			className={s.thumb}
			style={{ width, height: width / shape }}
		/>
	);
}

/** What a copy of the files picked will not keep (a password, limits on
 * what a reader may do), said once each. Nothing for files that are not
 * protected. */
export function CopyNote({ files }: { files: ToolFile[] }) {
	const notes = [...new Set(files.map((f) => copyNote(f.protection)))].filter(
		(note): note is string => note !== null,
	);
	return (
		<>
			{notes.map((note) => (
				<p key={note} className={s.copyNote} data-testid="copy-note">
					{note}
				</p>
			))}
		</>
	);
}

/** The button that runs a tool, at the foot of its panel. */
export function Go({
	label,
	disabled,
	running,
	onClick,
}: {
	label: string;
	disabled: boolean;
	running: boolean;
	onClick: () => void;
}) {
	return (
		<div className={s.go}>
			<Button
				onClick={onClick}
				disabled={disabled || running}
				aria-busy={running || undefined}
				data-testid="tool-go"
			>
				{running ? t("Working…") : label}
			</Button>
		</div>
	);
}

/** A choice of a few, as a row of buttons. */
export function Choice<T extends string>({
	label,
	value,
	onChange,
	options,
	testId,
}: {
	label: string;
	value: T;
	onChange: (value: T) => void;
	options: Array<[T, string]>;
	testId: string;
}) {
	const at = options.findIndex(([v]) => v === value);
	return (
		<>
			<span className={s.label}>{label}</span>
			<div
				className={s.ways}
				role="radiogroup"
				aria-label={label}
				// None of these is chosen: the choice is in another row.
				data-none={at < 0 || undefined}
				// The sliding pill behind the chosen one: how many, and which.
				style={
					{
						"--n": options.length,
						"--i": Math.max(0, at),
					} as CSSProperties
				}
			>
				{options.map(([v, text]) => (
					<button
						key={v}
						type="button"
						// biome-ignore lint/a11y/useSemanticElements: a row of buttons with radio semantics
						role="radio"
						aria-checked={value === v}
						aria-selected={value === v}
						className={s.way}
						onClick={() => onChange(v)}
						data-testid={`${testId}-${v}`}
					>
						{text}
					</button>
				))}
			</div>
		</>
	);
}
