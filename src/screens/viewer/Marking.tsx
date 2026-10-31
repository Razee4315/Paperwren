import {
	type DocMark,
	MARKER_COLORS,
	PEN_COLORS,
	newMarkId,
} from "@/lib/docMarks";
import { isDesktop } from "@/lib/env";
import { t, uiDir } from "@/lib/i18n";
import { useBackClose } from "@/state/navigation";
import { Button, Dialog, IconButton, modalOpen, toast } from "@/ui";
import {
	Copy,
	Expand,
	Search,
	StickyNote,
	Strikethrough,
	Trash2,
	Underline,
} from "lucide-react";
import {
	type ReactNode,
	forwardRef,
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import s from "./PdfView.module.css";
import { type PageSpot, pickRange } from "./pdfSelection";
import type { MarkStore } from "./useDocMarks";

/** A place on screen: what a bar hangs from. */
interface Spot {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

interface Selected {
	text: string;
	/** A copy: a phone's keyboard or a tap can clear the selection. */
	range: Range;
	rect: Spot;
}

/** Said once, after the very first mark. */
const TOLD_KEY = "paperwren.marks-told";

function tellOnce(message: string, show: () => void) {
	try {
		if (localStorage.getItem(TOLD_KEY)) return;
		localStorage.setItem(TOLD_KEY, "1");
	} catch {
		return;
	}
	toast(message, { label: t("Show"), run: show });
}

/** What is selected on the pages, once the pointer has let go of it. */
function useSelected(container: HTMLElement | null, enabled: boolean) {
	const [selected, setSelected] = useState<Selected | null>(null);
	useEffect(() => {
		if (!enabled || !container) {
			setSelected(null);
			return;
		}
		let frame = 0;
		let down = false;
		const read = () => {
			frame = 0;
			const selection = window.getSelection();
			if (down || !selection || selection.isCollapsed || !selection.rangeCount)
				return setSelected(null);
			const from = selection.anchorNode;
			const anchor = from instanceof Element ? from : from?.parentElement;
			if (!anchor || !container.contains(anchor)) return setSelected(null);
			if (!anchor.closest(".textLayer")) return setSelected(null);
			const text = selection.toString().trim();
			const range = selection.getRangeAt(0);
			const rects = [...range.getClientRects()].filter((r) => r.width > 0);
			if (!text || !rects.length) return setSelected(null);
			const view = container.getBoundingClientRect();
			setSelected({
				text,
				range: range.cloneRange(),
				rect: {
					left: Math.min(...rects.map((r) => r.left)),
					right: Math.max(...rects.map((r) => r.right)),
					// A selection running off the screen hangs from what is on it.
					top: Math.max(view.top, Math.min(...rects.map((r) => r.top))),
					bottom: Math.min(
						view.bottom,
						Math.max(...rects.map((r) => r.bottom)),
					),
				},
			});
		};
		const soon = () => {
			if (!frame) frame = requestAnimationFrame(read);
		};
		const onDown = (e: PointerEvent) => {
			if (e.pointerType === "mouse" && e.button !== 0) return;
			if (e.pointerType !== "mouse") return;
			down = true;
			setSelected(null);
		};
		const onUp = () => {
			if (!down) return;
			down = false;
			soon();
		};
		document.addEventListener("selectionchange", soon);
		container.addEventListener("pointerdown", onDown);
		window.addEventListener("pointerup", onUp);
		container.addEventListener("scroll", soon, { passive: true });
		window.addEventListener("resize", soon);
		soon();
		return () => {
			cancelAnimationFrame(frame);
			document.removeEventListener("selectionchange", soon);
			container.removeEventListener("pointerdown", onDown);
			window.removeEventListener("pointerup", onUp);
			container.removeEventListener("scroll", soon);
			window.removeEventListener("resize", soon);
		};
	}, [container, enabled]);
	return selected;
}

/**
 * A small bar over the pages. On a desktop it hangs by what it is
 * about; on a phone it sits low on the screen, clear of the system's
 * own bar over a selection and of the reader's thumb.
 */
function FloatBar({
	anchor,
	label,
	testId,
	children,
}: {
	anchor: Spot;
	label: string;
	testId: string;
	children: ReactNode;
}) {
	const bar = useRef<HTMLDivElement>(null);
	const [at, setAt] = useState<{ left: number; top: number } | null>(null);
	const { left, right, top, bottom } = anchor;
	useLayoutEffect(() => {
		const el = bar.current;
		if (!el || !isDesktop) return;
		const width = el.offsetWidth;
		const height = el.offsetHeight;
		const middle = (left + right) / 2;
		const room = top - height - 10;
		setAt({
			left: Math.min(
				Math.max(8, middle - width / 2),
				window.innerWidth - width - 8,
			),
			top:
				room >= 56
					? room
					: Math.min(bottom + 10, window.innerHeight - height - 8),
		});
	}, [left, right, top, bottom]);
	return createPortal(
		<div
			ref={bar}
			className={s.floatBar}
			role="toolbar"
			aria-label={label}
			dir={uiDir()}
			data-docked={isDesktop ? undefined : ""}
			data-testid={testId}
			style={isDesktop ? (at ?? { visibility: "hidden" }) : undefined}
			// The selection stays while its buttons are pressed.
			onMouseDown={(e) => e.preventDefault()}
		>
			{children}
		</div>,
		document.body,
	);
}

function Swatches({
	colors,
	current,
	onPick,
	testId,
}: {
	colors: string[];
	current?: string;
	onPick: (color: string) => void;
	testId: string;
}) {
	return (
		<div className={s.barSwatches}>
			{colors.map((color, i) => (
				<button
					key={color}
					type="button"
					className={s.barSwatch}
					style={{ background: color }}
					aria-label={t("Colour {n}", { n: i + 1 })}
					aria-pressed={current === color}
					onClick={() => onPick(color)}
					data-testid={testId}
				/>
			))}
		</div>
	);
}

/** What a note is being written on. */
type NoteFor =
	| {
			kind: "picked";
			color: string;
			quote: string;
			add: (note: string) => void;
	  }
	| { kind: "mark"; mark: DocMark };

/** A picture found on a page, ready to be opened. */
export interface PictureSpot {
	open: () => void;
}

/** What a tap on the pages can reach. */
export interface MarkingHandle {
	/** Whether a mark took the tap at this place. */
	tap: (x: number, y: number) => boolean;
	/** Note the current selection, from the keyboard. */
	close: () => void;
}

/**
 * Everything marking a document while reading it takes: the bar on
 * selected words, the bar on a mark, and the note on either. Marks made
 * here are kept at once; there is no mode to enter or leave.
 */
export const Marking = forwardRef<
	MarkingHandle,
	{
		container: HTMLElement | null;
		store: MarkStore;
		/** The file's author allows marks. */
		canMark: boolean;
		active: boolean;
		spotOf: (pageNumber: number) => PageSpot | null;
		markAt: (x: number, y: number) => DocMark | null;
		/** A picture under a point of the screen. */
		pictureAt: (x: number, y: number) => Promise<PictureSpot | null>;
		onFind: (text: string) => void;
		/** Show the list of marks. */
		onShowMarks: () => void;
	}
>(function Marking(
	{
		container,
		store,
		canMark,
		active,
		spotOf,
		markAt,
		pictureAt,
		onFind,
		onShowMarks,
	},
	ref,
) {
	const selected = useSelected(container, active && !modalOpen());
	const [color, setColor] = useState(MARKER_COLORS[0]);
	const [menu, setMenu] = useState<{ id: string; at: Spot } | null>(null);
	const [noteFor, setNoteFor] = useState<NoteFor | null>(null);
	const [pictureBar, setPictureBar] = useState<{
		spot: PictureSpot;
		at: Spot;
	} | null>(null);
	const [draft, setDraft] = useState("");
	const onMark = store.list.find((mark) => mark.id === menu?.id);
	useBackClose("mark-menu", !!onMark, () => setMenu(null));

	const clear = () => window.getSelection()?.removeAllRanges();

	/** The selected words, marked. */
	const mark = (
		kind: "highlight" | "underline" | "strike",
		ink: string,
		note?: string,
	) => {
		if (!selected || !container) return;
		const picked = pickRange(selected.range, container, spotOf);
		if (!picked.length) {
			toast(t("Couldn't mark that selection"));
			return;
		}
		store.add(
			picked.map((part) => ({
				id: newMarkId(),
				createdAt: Date.now(),
				kind,
				color: ink,
				note,
				...part,
			})),
		);
		clear();
		tellOnce(t("Kept on this device. Find it under Highlights."), onShowMarks);
	};

	const copy = async () => {
		const text = selected?.text;
		if (!text) return;
		try {
			await navigator.clipboard.writeText(text);
			toast(t("Copied"));
		} catch {
			toast(t("Couldn't copy"));
		}
	};

	const writeNote = () => {
		if (!selected) return;
		setDraft("");
		// The text field takes the selection away: the words are read now.
		const ink = color;
		const words = selected;
		const picked = container ? pickRange(words.range, container, spotOf) : [];
		setNoteFor({
			kind: "picked",
			color: ink,
			quote: words.text,
			add: (note) => {
				if (!picked.length) return;
				store.add(
					picked.map((part) => ({
						id: newMarkId(),
						createdAt: Date.now(),
						kind: "highlight",
						color: ink,
						note,
						...part,
					})),
				);
				tellOnce(
					t("Kept on this device. Find it under Highlights."),
					onShowMarks,
				);
			},
		});
		clear();
	};

	const openNote = (target: DocMark) => {
		setMenu(null);
		setDraft(
			target.kind === "note"
				? target.text
				: "note" in target
					? (target.note ?? "")
					: "",
		);
		setNoteFor({ kind: "mark", mark: target });
	};

	const remove = (id: string) => {
		setMenu(null);
		setNoteFor(null);
		store.remove(id);
		toast(t("Mark removed"), { label: t("Undo"), run: store.undo });
	};

	const keepNote = () => {
		const text = draft.trim();
		if (noteFor?.kind === "picked") noteFor.add(text);
		else if (noteFor?.kind === "mark") {
			const { mark: target } = noteFor;
			if (target.kind === "note") {
				if (text) store.edit(target.id, { text });
				else store.remove(target.id);
			} else store.edit(target.id, { note: text || undefined });
		}
		setNoteFor(null);
	};

	const offerPicture = (x: number, y: number) => {
		pictureAt(x, y)
			.then((spot) => {
				if (spot)
					setPictureBar({
						spot,
						at: { left: x, right: x, top: y, bottom: y },
					});
			})
			.catch(() => {});
	};
	const offerRef = useRef(offerPicture);
	offerRef.current = offerPicture;
	useEffect(() => {
		if (!container || isDesktop) return;
		const onHold = (e: MouseEvent) => {
			if (window.getSelection()?.toString()) return;
			offerRef.current(e.clientX, e.clientY);
		};
		container.addEventListener("contextmenu", onHold);
		return () => container.removeEventListener("contextmenu", onHold);
	}, [container]);

	const latest = useRef({ selected, mark, writeNote, color, menu, remove });
	latest.current = { selected, mark, writeNote, color, menu, remove };

	// biome-ignore lint/correctness/useExhaustiveDependencies: what it reaches for is held in refs and state setters
	useImperativeHandle(
		ref,
		() => ({
			tap: (x, y) => {
				if (window.getSelection()?.toString()) return false;
				setPictureBar(null);
				const hit = markAt(x, y);
				if (!hit) {
					setMenu(null);
					// A click on a picture. On a phone a tap is for the bars, and
					// a long press offers it instead.
					if (isDesktop) offerRef.current(x, y);
					return false;
				}
				// A note on the page has only its words to show.
				if (hit.kind === "note") openNote(hit);
				else
					setMenu({
						id: hit.id,
						at: { left: x, right: x, top: y, bottom: y },
					});
				return true;
			},
			close: () => setMenu(null),
		}),
		[markAt],
	);

	// The keys of marking, on a desktop: H and N on a selection, Delete
	// on a mark, and undo while no field has the keyboard.
	const { undo, redo } = store;
	useEffect(() => {
		if (!active || !isDesktop) return;
		const onKey = (e: KeyboardEvent) => {
			if (modalOpen() || e.altKey) return;
			const at = e.target as HTMLElement | null;
			if (at?.closest?.("input, textarea, select, [contenteditable]")) return;
			const now = latest.current;
			const mod = e.ctrlKey || e.metaKey;
			if (mod) {
				const key = e.code;
				if (key === "KeyZ" && !e.shiftKey) undo();
				else if (key === "KeyY" || (key === "KeyZ" && e.shiftKey)) redo();
				else return;
				e.preventDefault();
				return;
			}
			if (now.selected && canMark && e.code === "KeyH") {
				e.preventDefault();
				now.mark("highlight", now.color);
			} else if (now.selected && canMark && e.code === "KeyN") {
				e.preventDefault();
				now.writeNote();
			} else if (now.menu && (e.key === "Delete" || e.key === "Backspace")) {
				e.preventDefault();
				now.remove(now.menu.id);
			} else if (now.menu && e.key === "Escape") {
				e.preventDefault();
				setMenu(null);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [active, canMark, undo, redo]);

	// A bar left on a mark would point at the wrong place after a scroll.
	useEffect(() => {
		if (!container || (!menu && !pictureBar)) return;
		const close = () => {
			setMenu(null);
			setPictureBar(null);
		};
		container.addEventListener("scroll", close, { passive: true });
		return () => container.removeEventListener("scroll", close);
	}, [container, menu, pictureBar]);

	const noteMark = noteFor?.kind === "mark" ? noteFor.mark : null;
	const quote =
		noteFor?.kind === "picked"
			? noteFor.quote
			: noteMark && "boxes" in noteMark
				? noteMark.text
				: "";

	return (
		<>
			{selected && !noteFor && (
				<FloatBar
					anchor={selected.rect}
					label={t("Selected text")}
					testId="selection-bar"
				>
					{canMark && (
						<>
							<Swatches
								colors={MARKER_COLORS}
								current={color}
								onPick={(ink) => {
									setColor(ink);
									mark("highlight", ink);
								}}
								testId="selection-color"
							/>
							<span className={s.barLine} />
							<IconButton
								label={t("Underline")}
								onClick={() => mark("underline", PEN_COLORS[2])}
								data-testid="selection-underline"
							>
								<Underline size={18} />
							</IconButton>
							<IconButton
								label={t("Strike out")}
								onClick={() => mark("strike", PEN_COLORS[2])}
								data-testid="selection-strike"
							>
								<Strikethrough size={18} />
							</IconButton>
							<IconButton
								label={t("Add a note")}
								shortcut="N"
								onClick={writeNote}
								data-testid="selection-note"
							>
								<StickyNote size={18} />
							</IconButton>
							<span className={s.barLine} />
						</>
					)}
					<IconButton
						label={t("Copy")}
						onClick={copy}
						data-testid="selection-copy"
					>
						<Copy size={18} />
					</IconButton>
					<IconButton
						label={t("Find")}
						onClick={() => {
							onFind(selected.text);
							clear();
						}}
						data-testid="selection-find"
					>
						<Search size={18} />
					</IconButton>
				</FloatBar>
			)}

			{onMark && menu && !noteFor && (
				<FloatBar anchor={menu.at} label={t("Mark")} testId="mark-menu">
					{(onMark.kind === "highlight" ||
						(onMark.kind === "ink" && onMark.marker)) && (
						<Swatches
							colors={MARKER_COLORS}
							current={onMark.color}
							onPick={(ink) => store.edit(onMark.id, { color: ink })}
							testId="mark-menu-color"
						/>
					)}
					{(onMark.kind === "underline" ||
						onMark.kind === "strike" ||
						onMark.kind === "text" ||
						(onMark.kind === "ink" && !onMark.marker)) && (
						<Swatches
							colors={PEN_COLORS}
							current={onMark.color}
							onPick={(ink) => store.edit(onMark.id, { color: ink })}
							testId="mark-menu-color"
						/>
					)}
					{"boxes" in onMark && (
						<>
							<span className={s.barLine} />
							<Button
								variant="ghost"
								onClick={() => openNote(onMark)}
								data-testid="mark-menu-note"
							>
								<StickyNote size={16} />
								{onMark.note ? t("Edit note") : t("Add a note")}
							</Button>
						</>
					)}
					<span className={s.barLine} />
					<IconButton
						label={t("Remove")}
						shortcut="Delete"
						onClick={() => remove(onMark.id)}
						data-testid="mark-menu-remove"
					>
						<Trash2 size={18} />
					</IconButton>
				</FloatBar>
			)}

			{pictureBar && !noteFor && (
				<FloatBar
					anchor={pictureBar.at}
					label={t("Picture")}
					testId="picture-bar"
				>
					<Button
						variant="ghost"
						onClick={() => {
							const { spot } = pictureBar;
							setPictureBar(null);
							spot.open();
						}}
						data-testid="picture-open"
					>
						<Expand size={16} /> {t("View picture")}
					</Button>
				</FloatBar>
			)}

			{noteFor && (
				<Dialog
					open
					title={quote ? t("Add a note") : t("Note")}
					onClose={() => setNoteFor(null)}
					testId="reader-note"
					actions={
						<>
							{noteMark && (
								<IconButton
									label={t("Delete")}
									onClick={() => remove(noteMark.id)}
									data-testid="reader-note-delete"
								>
									<Trash2 size={18} />
								</IconButton>
							)}
							<Button variant="ghost" onClick={() => setNoteFor(null)}>
								{t("Cancel")}
							</Button>
							<Button onClick={keepNote} data-testid="reader-note-keep">
								{t("Done")}
							</Button>
						</>
					}
				>
					{quote && (
						<blockquote className={s.quote} dir="auto">
							{quote.length > 160 ? `${quote.slice(0, 160)}…` : quote}
						</blockquote>
					)}
					<textarea
						className={s.noteField}
						rows={4}
						dir="auto"
						// biome-ignore lint/a11y/noAutofocus: the dialog exists to take these words
						autoFocus
						aria-label={t("Note")}
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
						data-testid="reader-note-text"
					/>
				</Dialog>
			)}
		</>
	);
});
