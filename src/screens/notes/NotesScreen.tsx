import { backend } from "@/lib/backend";
import { t, tn } from "@/lib/i18n";
import {
	type Note,
	type NoteBlock,
	type NoteStroke,
	type NoteSummary,
	SKETCH_HEIGHT,
	backupNotes,
	blockId,
	deleteNote,
	isEmptyNote,
	loadNote,
	loadNotes,
	matchesNote,
	newNote,
	restoreNotes,
	saveNote,
} from "@/lib/notes";
import { relativeTime } from "@/screens/home/Home";
import { announceSaved } from "@/screens/tools/saved";
import { useBackClose, useNav } from "@/state/navigation";
import {
	Button,
	Dialog,
	IconButton,
	Sheet,
	SheetItem,
	Wren,
	toast,
} from "@/ui";
import {
	ArrowLeft,
	Check,
	Eraser,
	FileDown,
	MoreVertical,
	NotebookPen,
	PenLine,
	Plus,
	Search,
	Trash2,
	Undo2,
	Upload,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import s from "./Notes.module.css";
import { type Pen, Sketch } from "./Sketch";

const COLORS = ["#111111", "#1a3c8c", "#c0392b", "#1f8a4c"];
const WIDTHS = [3, 6, 12];
/** How long after the last change a note is written down. */
const SAVE_AFTER = 500;

const safeName = (title: string) =>
	(title.trim() || t("Note")).replace(/[\\/:*?"<>|]/g, " ").slice(0, 80);

/** Written notes on this device: typed text and handwriting, side by
 * side, found by search, kept without being asked. */
export function NotesScreen() {
	const { back } = useNav();
	const [notes, setNotes] = useState<NoteSummary[] | null>(null);
	const [query, setQuery] = useState("");
	const [open, setOpen] = useState<Note | null>(null);
	const [menu, setMenu] = useState(false);
	const [offerRestore, setOfferRestore] = useState(false);

	useEffect(() => {
		let alive = true;
		loadNotes().then((list) => alive && setNotes(list));
		return () => {
			alive = false;
		};
	}, []);

	const openNote = async (id: string) => {
		const note = await loadNote(id);
		if (note) setOpen(note);
		else toast(t("Couldn't open this note"));
	};

	const backup = async () => {
		setMenu(false);
		try {
			const saved = await backend.saveFile(
				"Paperwren notes.json",
				await backupNotes(),
				"application/json",
			);
			if (saved) announceSaved(saved);
		} catch {
			toast(t("Couldn't save a copy"));
		}
	};

	const restore = async () => {
		setMenu(false);
		setOfferRestore(false);
		try {
			const picked = await backend.pickFile();
			if (!picked) return;
			const added = await restoreNotes(await backend.read(picked.reopen));
			if (added === null) {
				toast(t("This isn't a Paperwren notes backup"));
				return;
			}
			setNotes(await loadNotes());
			toast(tn(added, "{n} note brought back", "{n} notes brought back"));
		} catch {
			toast(t("Couldn't read this file"));
		}
	};

	if (open)
		return (
			<NoteEditor
				key={open.id}
				note={open}
				onClose={() => {
					setOpen(null);
					loadNotes().then(setNotes);
				}}
			/>
		);

	const shown = notes?.filter((n) => matchesNote(n, query)) ?? [];
	return (
		<div className={s.screen} data-testid="notes">
			<header className={s.bar} data-tauri-drag-region="deep">
				<IconButton label={t("Back")} onClick={back} data-testid="notes-back">
					<ArrowLeft size={22} className="pw-flip" />
				</IconButton>
				<h1 className={s.title}>{t("Notes")}</h1>
				<IconButton
					label={t("More")}
					onClick={() => setMenu(true)}
					data-testid="notes-more"
				>
					<MoreVertical size={20} />
				</IconButton>
			</header>
			<main className={s.scroll}>
				<div className={s.column}>
					{!!notes?.length && (
						<label className={s.search}>
							<Search size={18} aria-hidden="true" />
							<input
								type="search"
								placeholder={t("Search your notes")}
								aria-label={t("Search your notes")}
								value={query}
								onChange={(e) => setQuery(e.target.value)}
								data-testid="notes-search"
							/>
						</label>
					)}
					{notes?.length === 0 && (
						<div className={s.empty} data-testid="notes-empty">
							<Wren size={72} />
							<h2>{t("Nothing here yet")}</h2>
							<p>
								{t(
									"Type or write by hand. Notes stay on this device and save themselves.",
								)}
							</p>
						</div>
					)}
					{!!notes?.length && !shown.length && (
						<p className={s.none}>{t("No notes match your search")}</p>
					)}
					{shown.map((note) => (
						<button
							key={note.id}
							type="button"
							className={s.row}
							onClick={() => openNote(note.id)}
							data-testid="note-row"
						>
							<strong dir="auto">
								{note.title || note.text.split("\n")[0] || t("Drawing")}
							</strong>
							{note.title && note.text && (
								<span dir="auto" className={s.snippet}>
									{note.text.split("\n")[0]}
								</span>
							)}
							<span className={s.when}>
								{note.drawn && <PenLine size={13} aria-label={t("Drawing")} />}
								{relativeTime(note.updatedAt)}
							</span>
						</button>
					))}
				</div>
			</main>
			<button
				type="button"
				className={s.add}
				onClick={() => setOpen(newNote())}
				data-testid="note-new"
			>
				<Plus size={20} strokeWidth={2.5} />
				{t("New note")}
			</button>
			<Sheet
				open={menu}
				title={t("Notes")}
				onClose={() => setMenu(false)}
				testId="notes-menu"
			>
				<SheetItem
					icon={<FileDown size={20} />}
					hint={t(
						"Notes go with the app if it is removed. Keep this file somewhere safe.",
					)}
					disabled={!notes?.length}
					onClick={backup}
					testId="notes-backup"
				>
					{t("Back up all notes")}
				</SheetItem>
				<SheetItem
					icon={<Upload size={20} />}
					onClick={() => {
						setMenu(false);
						setOfferRestore(true);
					}}
					testId="notes-restore"
				>
					{t("Bring back from a backup")}
				</SheetItem>
			</Sheet>
			{offerRestore && (
				<Dialog
					open
					title={t("Bring back from a backup")}
					onClose={() => setOfferRestore(false)}
					testId="notes-restore-ask"
					actions={
						<>
							<Button variant="ghost" onClick={() => setOfferRestore(false)}>
								{t("Cancel")}
							</Button>
							<Button onClick={restore} data-testid="notes-restore-go">
								{t("Choose a file")}
							</Button>
						</>
					}
				>
					{t(
						"The notes in the file are added to these. Where a note is in both, the one changed last is kept.",
					)}
				</Dialog>
			)}
		</div>
	);
}

function NoteEditor({
	note: first,
	onClose,
}: {
	note: Note;
	onClose: () => void;
}) {
	const [note, setNote] = useState(first);
	const [drawing, setDrawing] = useState(false);
	const [pen, setPen] = useState<Pen>({
		color: COLORS[0],
		width: WIDTHS[0],
		erase: false,
	});
	const [undoable, setUndoable] = useState<NoteBlock[][]>([]);
	const [menu, setMenu] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const latest = useRef(note);
	latest.current = note;
	/** What was last written down. */
	const stored = useRef(first);
	const timer = useRef(0);
	/** The write under way, so leaving can wait for it. */
	const writing = useRef<Promise<unknown>>(Promise.resolve());

	const store = useCallback(() => {
		window.clearTimeout(timer.current);
		const now = latest.current;
		if (now === stored.current) return writing.current;
		const had = stored.current;
		stored.current = now;
		writing.current = writing.current
			.then(() =>
				// One never kept and still empty leaves nothing behind.
				isEmptyNote(now)
					? deleteNote(now.id)
					: saveNote({ ...now, updatedAt: Date.now() }),
			)
			.catch(() => {
				stored.current = had;
				toast(t("Couldn't save this note"));
			});
		return writing.current;
	}, []);

	const update = (change: Partial<Note>) => {
		setNote((was) => ({ ...was, ...change }));
		window.clearTimeout(timer.current);
		timer.current = window.setTimeout(store, SAVE_AFTER);
	};

	// A note left by the Back button or a closing app is written down.
	const storeRef = useRef(store);
	storeRef.current = store;
	useEffect(() => {
		const leave = () => {
			if (document.hidden) storeRef.current();
		};
		document.addEventListener("visibilitychange", leave);
		return () => {
			document.removeEventListener("visibilitychange", leave);
			storeRef.current();
		};
	}, []);

	const close = useCallback(async () => {
		await store();
		onClose();
	}, [onClose, store]);
	useBackClose("note", true, close);

	const setBlock = (id: string, change: Partial<NoteBlock>) =>
		update({
			blocks: latest.current.blocks.map((block) =>
				block.id === id ? ({ ...block, ...change } as NoteBlock) : block,
			),
		});

	const addDrawing = () => {
		const blocks = latest.current.blocks;
		const sketch: NoteBlock = {
			kind: "sketch",
			id: blockId(),
			height: SKETCH_HEIGHT,
			strokes: [],
		};
		update({
			blocks: [...blocks, sketch, { kind: "text", id: blockId(), text: "" }],
		});
		setDrawing(true);
		setPen((was) => ({ ...was, erase: false }));
	};

	const changeInk = (id: string, strokes: NoteStroke[], height: number) => {
		setUndoable((list) => [...list.slice(-49), latest.current.blocks]);
		setBlock(id, { strokes, height });
	};

	const undo = () => {
		const last = undoable[undoable.length - 1];
		if (!last) return;
		setUndoable(undoable.slice(0, -1));
		update({ blocks: last });
	};

	const exportPdf = async () => {
		setMenu(false);
		try {
			await store();
			const { noteToPdf } = await import("./notePdf");
			const bytes = await noteToPdf(latest.current);
			const saved = await backend.saveFile(
				`${safeName(latest.current.title)}.pdf`,
				bytes,
				"application/pdf",
			);
			if (saved) announceSaved(saved);
		} catch {
			toast(t("Couldn't save a copy"));
		}
	};

	const remove = async () => {
		window.clearTimeout(timer.current);
		// Nothing is left to write down when the editor closes.
		stored.current = latest.current;
		await writing.current;
		await deleteNote(note.id).catch(() => {});
		onClose();
	};

	return (
		<div className={s.screen} data-testid="note-editor">
			<header className={s.bar} data-tauri-drag-region="deep">
				<IconButton label={t("Back")} onClick={close} data-testid="note-back">
					<ArrowLeft size={22} className="pw-flip" />
				</IconButton>
				<input
					className={s.noteTitle}
					dir="auto"
					placeholder={t("Title")}
					aria-label={t("Title")}
					value={note.title}
					onChange={(e) => update({ title: e.target.value })}
					data-testid="note-title"
				/>
				<IconButton
					label={t("More")}
					onClick={() => setMenu(true)}
					data-testid="note-more"
				>
					<MoreVertical size={20} />
				</IconButton>
			</header>
			<div className={s.tools} role="toolbar" aria-label={t("Note")}>
				{drawing ? (
					<>
						<button
							type="button"
							className={s.tool}
							aria-pressed={!pen.erase}
							title={t("Pen")}
							onClick={() => setPen({ ...pen, erase: false })}
							data-testid="note-pen"
						>
							<PenLine size={18} />
						</button>
						<button
							type="button"
							className={s.tool}
							aria-pressed={pen.erase}
							title={t("Eraser")}
							onClick={() => setPen({ ...pen, erase: true })}
							data-testid="note-eraser"
						>
							<Eraser size={18} />
						</button>
						{COLORS.map((color, i) => (
							<button
								key={color}
								type="button"
								className={s.swatch}
								style={{ background: color }}
								aria-pressed={!pen.erase && pen.color === color}
								aria-label={t("Colour {n}", { n: i + 1 })}
								onClick={() => setPen({ ...pen, color, erase: false })}
							/>
						))}
						{WIDTHS.map((width) => (
							<button
								key={width}
								type="button"
								className={s.tool}
								aria-pressed={!pen.erase && pen.width === width}
								aria-label={t("Thickness")}
								onClick={() => setPen({ ...pen, width, erase: false })}
							>
								<i
									className={s.dot}
									style={{ width: width + 3, height: width + 3 }}
								/>
							</button>
						))}
						<IconButton
							label={t("Undo")}
							disabled={!undoable.length}
							onClick={undo}
							data-testid="note-undo"
						>
							<Undo2 size={18} className="pw-flip" />
						</IconButton>
						<Button
							variant="secondary"
							className={s.done}
							onClick={() => setDrawing(false)}
							data-testid="note-draw-done"
						>
							<Check size={16} /> <span>{t("Done")}</span>
						</Button>
					</>
				) : (
					<>
						<Button
							variant="secondary"
							onClick={addDrawing}
							data-testid="note-add-drawing"
						>
							<Plus size={16} /> {t("Add a drawing")}
						</Button>
						{note.blocks.some((b) => b.kind === "sketch") && (
							<Button
								variant="secondary"
								onClick={() => setDrawing(true)}
								data-testid="note-draw"
							>
								<NotebookPen size={16} /> {t("Write by hand")}
							</Button>
						)}
					</>
				)}
			</div>
			<main className={s.scroll} data-drawing={drawing || undefined}>
				<div className={s.page}>
					{note.blocks.map((block, i) =>
						block.kind === "text" ? (
							<textarea
								key={block.id}
								className={s.text}
								dir="auto"
								placeholder={i === 0 ? t("Start writing") : undefined}
								aria-label={t("Note")}
								value={block.text}
								ref={grow}
								onChange={(e) => {
									grow(e.target);
									setBlock(block.id, { text: e.target.value });
								}}
								data-testid="note-text"
							/>
						) : (
							<Sketch
								key={block.id}
								strokes={block.strokes}
								height={block.height}
								drawing={drawing}
								pen={pen}
								onChange={(strokes, height) =>
									changeInk(block.id, strokes, height)
								}
							/>
						),
					)}
				</div>
			</main>
			<Sheet
				open={menu}
				title={note.title || t("Note")}
				onClose={() => setMenu(false)}
				testId="note-menu"
			>
				<SheetItem
					icon={<FileDown size={20} />}
					onClick={exportPdf}
					testId="note-pdf"
				>
					{t("Save as PDF")}
				</SheetItem>
				<SheetItem
					icon={<Trash2 size={20} />}
					onClick={() => {
						setMenu(false);
						setDeleting(true);
					}}
					testId="note-delete"
				>
					{t("Delete")}
				</SheetItem>
			</Sheet>
			{deleting && (
				<Dialog
					open
					alert
					title={t("Delete this note?")}
					onClose={() => setDeleting(false)}
					testId="note-delete-ask"
					actions={
						<>
							<Button variant="ghost" onClick={() => setDeleting(false)}>
								{t("Cancel")}
							</Button>
							<Button
								variant="danger"
								onClick={remove}
								data-testid="note-delete-go"
							>
								{t("Delete")}
							</Button>
						</>
					}
				>
					{t("A deleted note can't be brought back.")}
				</Dialog>
			)}
		</div>
	);
}

/** A text box as tall as what is in it, so the note scrolls as a whole. */
function grow(el: HTMLTextAreaElement | null) {
	if (!el) return;
	el.style.height = "auto";
	el.style.height = `${el.scrollHeight}px`;
}
