import { backend } from "@/lib/backend";
import {
	type DocMark,
	hasWords,
	markText,
	marksToMarkdown,
	sortMarks,
} from "@/lib/docMarks";
import { splitName } from "@/lib/fileName";
import { t, tn } from "@/lib/i18n";
import { blockId, newNote, saveNote } from "@/lib/notes";
import { Button, IconButton, toast } from "@/ui";
import {
	Copy,
	Download,
	FileDown,
	Highlighter,
	NotebookPen,
	Trash2,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import s from "./PdfView.module.css";
import type { MarkStore } from "./useDocMarks";

/** A field that keeps its words after a pause and on leaving it, and
 * leaves what is being typed alone. */
function useDraft(value: string, keep: (text: string) => void) {
	const [draft, setDraft] = useState(value);
	const timer = useRef(0);
	const focused = useRef(false);
	const latest = useRef({ draft, value, keep });
	latest.current = { draft, value, keep };
	useEffect(() => {
		if (!focused.current) setDraft(value);
	}, [value]);
	useEffect(
		() => () => {
			window.clearTimeout(timer.current);
			const now = latest.current;
			if (now.draft !== now.value) now.keep(now.draft);
		},
		[],
	);
	return {
		value: draft,
		onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => {
			const next = e.target.value;
			setDraft(next);
			window.clearTimeout(timer.current);
			timer.current = window.setTimeout(() => keep(next), 500);
		},
		onFocus: () => {
			focused.current = true;
		},
		onBlur: () => {
			focused.current = false;
			window.clearTimeout(timer.current);
			if (draft !== value) keep(draft);
		},
	};
}

/** A text field as tall as its words. */
function Growing(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
	const field = useRef<HTMLTextAreaElement>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: measured again whenever the words change
	useLayoutEffect(() => {
		const el = field.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${el.scrollHeight + 2}px`;
	}, [props.value]);
	return <textarea ref={field} dir="auto" {...props} />;
}

function MarkCard({
	mark,
	label,
	onShow,
	onNote,
	onRemove,
}: {
	mark: DocMark;
	label: string;
	onShow: (mark: DocMark) => void;
	onNote: (mark: DocMark, note: string) => void;
	onRemove: (mark: DocMark) => void;
}) {
	const noted = "boxes" in mark;
	const note = useDraft(noted ? (mark.note ?? "") : "", (text) =>
		onNote(mark, text.trim()),
	);
	const color = mark.kind === "note" ? "#ffd93b" : mark.color;
	return (
		<li
			className={s.markCard}
			style={{ "--mark": color } as React.CSSProperties}
			data-testid="mark-card"
		>
			<button
				type="button"
				className={s.markQuote}
				onClick={() => onShow(mark)}
			>
				<small>{label}</small>
				<span dir="auto">{markText(mark)}</span>
			</button>
			{noted && (
				<Growing
					className={s.markNote}
					rows={1}
					placeholder={t("Add a note")}
					aria-label={t("Note")}
					{...note}
				/>
			)}
			<IconButton
				className={s.markDelete}
				label={t("Remove")}
				onClick={() => onRemove(mark)}
				data-testid="mark-card-remove"
			>
				<Trash2 size={15} />
			</IconButton>
		</li>
	);
}

/**
 * What the reader has marked in this document, in reading order, with a
 * place for a note on the whole of it. Everything here is kept as it is
 * typed; the buttons at the foot take it out of the app.
 */
export function MarksPanel({
	store,
	name,
	label,
	onShow,
	onSaveCopy,
}: {
	store: MarkStore;
	name: string;
	/** How the document names a page, from 0. */
	label: (page: number) => string;
	onShow: (mark: DocMark) => void;
	onSaveCopy: () => void;
}) {
	const note = useDraft(store.note, store.setNote);
	const marks = sortMarks(store.list);
	const written = marks.filter(hasWords);
	const drawn = marks.length - written.length;
	const any = marks.length > 0 || !!store.note.trim();

	const markdown = () =>
		marksToMarkdown(name, { note: store.note, marks: store.list }, label);
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(markdown());
			toast(t("Copied"));
		} catch {
			toast(t("Couldn't copy"));
		}
	};
	const saveText = async () => {
		const [stem] = splitName(name);
		const saved = await backend
			.saveFile(
				`${stem} (${t("notes")}).md`,
				new TextEncoder().encode(markdown()),
				"text/markdown",
			)
			.catch(() => {
				toast(t("Couldn't save a copy"));
				return null;
			});
		if (saved) toast(t("Saved as {name}", { name: saved.name }));
	};
	const toNotes = async () => {
		const made = newNote();
		made.title = splitName(name)[0];
		made.blocks = [{ kind: "text", id: blockId(), text: markdown() }];
		await saveNote(made)
			.then(() => toast(t("Added to Notes")))
			.catch(() => toast(t("Couldn't save a copy")));
	};

	const remove = (mark: DocMark) => {
		store.remove(mark.id);
		toast(t("Mark removed"), { label: t("Undo"), run: store.undo });
	};

	return (
		<div className={s.marksPanel} data-testid="marks-panel">
			<Growing
				className={s.docNote}
				rows={2}
				placeholder={t("Notes about this document")}
				aria-label={t("Notes about this document")}
				data-testid="doc-note"
				{...note}
			/>
			{written.length ? (
				<ul className={s.markList}>
					{written.map((mark) => (
						<MarkCard
							key={mark.id}
							mark={mark}
							label={label(mark.page)}
							onShow={onShow}
							onNote={(target, text) =>
								store.edit(target.id, { note: text || undefined })
							}
							onRemove={remove}
						/>
					))}
				</ul>
			) : (
				<div className={s.marksEmpty} data-testid="marks-empty">
					<Highlighter size={22} aria-hidden="true" />
					<p>
						{t(
							"Select words on a page, then pick a colour. What you mark shows up here and stays with this PDF.",
						)}
					</p>
				</div>
			)}
			{drawn > 0 && (
				<p className={s.marksFoot}>
					{tn(
						drawn,
						"Plus {n} drawing on the pages",
						"Plus {n} drawings on the pages",
					)}
				</p>
			)}
			{any && (
				<div className={s.marksActions}>
					<Button variant="ghost" onClick={copy} data-testid="marks-copy">
						<Copy size={16} /> {t("Copy all")}
					</Button>
					<Button variant="ghost" onClick={saveText} data-testid="marks-save">
						<Download size={16} /> {t("Save as a file")}
					</Button>
					<Button variant="ghost" onClick={toNotes} data-testid="marks-notes">
						<NotebookPen size={16} /> {t("Add to Notes")}
					</Button>
					{store.list.length > 0 && (
						<Button
							variant="ghost"
							onClick={onSaveCopy}
							data-testid="marks-pdf"
						>
							<FileDown size={16} /> {t("Save a copy with them")}
						</Button>
					)}
				</div>
			)}
			<p className={s.marksFoot}>
				{store.persist
					? t("Kept on this device. The PDF itself is not changed.")
					: t(
							"This PDF has a password, so nothing is kept. Save a copy to keep your marks.",
						)}
			</p>
		</div>
	);
}
