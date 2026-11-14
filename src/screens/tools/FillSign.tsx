import { type SavedFile, backend } from "@/lib/backend";
import { isDesktop } from "@/lib/env";
import { copyName } from "@/lib/fileName";
import { locale, t } from "@/lib/i18n";
import {
	type FieldValue,
	type Mark,
	ToolError,
	fillAndSign,
	standardText,
} from "@/lib/pdfTools";
import type { SignBlocker } from "@/lib/sign";
import {
	type Signature,
	forgetSignature,
	forgetStamp,
	loadSignatures,
	loadStamps,
	pngBytes,
} from "@/lib/signatures";
import { useBackClose } from "@/state/navigation";
import {
	Button,
	Dialog,
	IconButton,
	Sheet,
	SheetDivider,
	SheetItem,
	Spinner,
	toast,
} from "@/ui";
import { useModalFocus } from "@/ui/Overlay";
import {
	ArrowLeft,
	CalendarDays,
	Check,
	Ellipsis,
	FileKey,
	Info,
	Minus,
	PenLine,
	Plus,
	Signature as SignatureIcon,
	Stamp,
	Trash2,
	Type,
	X,
} from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
	type CSSProperties,
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { whole } from "../viewer/pdfCrop";
import {
	type Chosen,
	DigitalIdFlow,
	PICTURE_SHARE,
	signatureAppearance,
} from "./DigitalId";
import { SIGNED_WARNING } from "./MarkUp";
import { SignaturePad } from "./SignaturePad";
import { StampPad } from "./StampPad";
import s from "./Tools.module.css";
import { blockerMessage, signatureCaption } from "./certificate";

/** `digital`: the place of a digital signature (a digital ID's), with
 * the picture it shows. */
type Tool =
	| "sign"
	| "initials"
	| "stamp"
	| "text"
	| "date"
	| "check"
	| "cross"
	| "digital";
/** What is put on a page as a picture the reader made or picked. */
type Kept = "sign" | "initials" | "stamp";
/** What a signature's picture is chosen or made for. */
type Signing = "sign" | "initials" | "digital";

/** A box on a page as shown: fractions of its width and height. */
interface Box {
	page: number;
	x: number;
	y: number;
	w: number;
	h: number;
}

/** A form field of the file, where it sits. */
interface Field extends Box {
	name: string;
	kind: "text" | "check" | "radio" | "choice" | "signature";
	multiline?: boolean;
	/** A check box's or radio button's own value when it is on. */
	on?: string;
	options?: Array<[value: string, label: string]>;
	maxLength?: number;
	/** The size the file asks its text to be written at, as a share of
	 * the page's height; none: fitted to the box. */
	size?: number;
	initial: string | boolean;
}

/** Something the reader put on a page. */
interface Item extends Box {
	id: string;
	kind: Tool;
	/** A signature's or a stamp's picture. */
	src?: string;
	text?: string;
	/** A digital signature put in the form's own signature field: its
	 * full name. */
	field?: string;
}

/** The one ink for all that is added, the signature too: blue unless
 * the reader picks black. */
const INKS = { blue: "#1a3c8c", black: "#111111" } as const;
type Ink = keyof typeof INKS;
/** The height of a line of text placed on a page, as a share of the
 * page's height (about 12 points on A4). */
const LINE = 0.021;
const ZOOMS = [1, 1.5, 2, 3];
/** Typing on a phone is at least this size, in CSS pixels (a phone
 * also zooms in on a field any smaller). */
const READABLE = 16;

/** A screen wide enough for every tool in one row. */
const ROOMY = "(min-width: 700px)";
function onRoomyChange(then: () => void) {
	const query = window.matchMedia?.(ROOMY);
	query?.addEventListener("change", then);
	return () => query?.removeEventListener("change", then);
}
const roomyScreen = () => !!window.matchMedia?.(ROOMY).matches;

let made = 0;
const newId = () => `m${++made}`;

/** pdf.js's widget annotations, as far as they are read here. */
interface Widget {
	subtype: string;
	fieldType?: string;
	fieldName?: string;
	fieldValue?: unknown;
	rect: number[];
	readOnly?: boolean;
	hidden?: boolean;
	multiLine?: boolean;
	checkBox?: boolean;
	radioButton?: boolean;
	pushButton?: boolean;
	exportValue?: string;
	buttonValue?: string;
	options?: Array<{ exportValue: string; displayValue: string }>;
	maxLen?: number;
	defaultAppearanceData?: { fontSize?: number };
}

/** pdf.js's `AnnotationMode.ENABLE_FORMS`: the page is drawn without the
 * form's fields, which are laid over it here instead. (pdf.js is loaded
 * later, on its own; only its types are imported here.) */
const ENABLE_FORMS = 2;

/** The fields of every page, and the pages with fields the file locks,
 * which are only seen as the file draws them. */
interface Form {
	fields: Field[];
	locked: Set<number>;
}

/** The fields of every page, placed as shown. */
async function readFields(doc: PDFDocumentProxy): Promise<Form> {
	const out: Field[] = [];
	const locked = new Set<number>();
	for (let n = 1; n <= doc.numPages && out.length < 2000; n++) {
		const page = await doc.getPage(n);
		const view = whole(page, () => page.getViewport({ scale: 1 }));
		const widgets = (await page.getAnnotations({
			intent: "display",
		})) as Widget[];
		for (const w of widgets) {
			if (w.subtype !== "Widget") continue;
			// Fields the file locks, or hides, are shown as it drew them: the
			// page keeps its fields in the picture.
			if (w.readOnly || w.pushButton || !w.fieldName) {
				if (!w.hidden) locked.add(n - 1);
				continue;
			}
			if (w.hidden) continue;
			const [a, b, c, d] = view.convertToViewportRectangle(w.rect);
			const box = {
				page: n - 1,
				x: Math.min(a, c) / view.width,
				y: Math.min(b, d) / view.height,
				w: Math.abs(c - a) / view.width,
				h: Math.abs(d - b) / view.height,
			};
			if (box.w <= 0 || box.h <= 0) continue;
			const pt = w.defaultAppearanceData?.fontSize ?? 0;
			const base = {
				...box,
				name: w.fieldName,
				size: pt > 0 ? pt / view.height : undefined,
			};
			if (w.fieldType === "Tx")
				out.push({
					...base,
					kind: "text",
					multiline: w.multiLine,
					maxLength: w.maxLen || undefined,
					initial: typeof w.fieldValue === "string" ? w.fieldValue : "",
				});
			else if (w.fieldType === "Btn" && w.checkBox)
				out.push({
					...base,
					kind: "check",
					on: w.exportValue ?? "Yes",
					initial: !!w.fieldValue && w.fieldValue !== "Off",
				});
			else if (w.fieldType === "Btn" && w.radioButton)
				out.push({
					...base,
					kind: "radio",
					on: w.buttonValue ?? "",
					initial: typeof w.fieldValue === "string" ? w.fieldValue : "",
				});
			else if (w.fieldType === "Ch")
				out.push({
					...base,
					kind: "choice",
					options: (w.options ?? []).map((o) => [
						o.exportValue,
						o.displayValue,
					]),
					initial: Array.isArray(w.fieldValue)
						? String(w.fieldValue[0] ?? "")
						: String(w.fieldValue ?? ""),
				});
			else if (w.fieldType === "Sig")
				out.push({ ...base, kind: "signature", initial: "" });
			// A kind not filled in here is left to the picture too.
			else locked.add(n - 1);
		}
	}
	return { fields: out, locked };
}

/** A picture of a mark the PDF's standard font cannot write (a tick,
 * text in another script), drawn at a size that prints sharply. */
async function picture(
	item: Item,
	pageW: number,
	pageH: number,
	ink: string,
): Promise<Uint8Array> {
	const scale = 4;
	const w = Math.max(8, Math.round(item.w * pageW * scale));
	const h = Math.max(8, Math.round(item.h * pageH * scale));
	const canvas = document.createElement("canvas");
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("no canvas");
	ctx.strokeStyle = ink;
	ctx.fillStyle = ink;
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	if (item.kind === "check" || item.kind === "cross") {
		ctx.lineWidth = Math.max(2, Math.min(w, h) * 0.12);
		ctx.beginPath();
		if (item.kind === "check") {
			ctx.moveTo(w * 0.16, h * 0.55);
			ctx.lineTo(w * 0.42, h * 0.8);
			ctx.lineTo(w * 0.86, h * 0.2);
		} else {
			ctx.moveTo(w * 0.2, h * 0.2);
			ctx.lineTo(w * 0.8, h * 0.8);
			ctx.moveTo(w * 0.8, h * 0.2);
			ctx.lineTo(w * 0.2, h * 0.8);
		}
		ctx.stroke();
	} else {
		ctx.font = `${h / 1.2}px ${getComputedStyle(document.body).fontFamily}`;
		ctx.textBaseline = "middle";
		ctx.direction = "inherit";
		ctx.fillText(item.text ?? "", 0, h / 2, w);
	}
	return pngBytes(canvas.toDataURL("image/png"));
}

/**
 * Fill in a PDF's form and sign it. The form's own fields can be typed
 * into, ticked and chosen; anywhere on a page the reader can put a
 * signature or initials, a line of text, the date, a tick or a cross,
 * and move, resize or remove them. Saving makes a new copy: the file
 * that was opened is left as it was.
 */
export function FillSign({
	doc,
	name,
	password,
	canMark,
	signed = false,
	startPage = 0,
	onClose,
	onSaved,
}: {
	doc: PDFDocumentProxy;
	name: string;
	password?: string;
	/** The file's author allows more than its form to be filled. */
	canMark: boolean;
	/** The file has a digital signature, which a copy will not keep. */
	signed?: boolean;
	/** The page to open at, from 0. */
	startPage?: number;
	onClose: () => void;
	onSaved?: (saved: SavedFile) => void;
}) {
	const [form, setForm] = useState<Form | null>(null);
	const fields = form?.fields ?? null;
	const [values, setValues] = useState<Record<string, string | boolean>>({});
	const [items, setItems] = useState<Item[]>([]);
	const [tool, setTool] = useState<Tool | null>(null);
	// A signature, initials or a stamp was just placed: the same one can
	// be placed again from the hint.
	const [again, setAgain] = useState<Kept | null>(null);
	const [selected, setSelected] = useState<string | null>(null);
	const [editing, setEditing] = useState<string | null>(null);
	const [signatures, setSignatures] = useState<Signature[]>([]);
	const [stamps, setStamps] = useState<Signature[]>([]);
	const [chooser, setChooser] = useState<Kept | "digital" | null>(null);
	const [padFor, setPadFor] = useState<Signing | null>(null);
	// The digital ID chosen to sign with: held here only, for this
	// session, and forgotten when it is saved, dropped or left.
	const [digital, setDigital] = useState<Chosen | null>(null);
	const heldId = useRef<Chosen | null>(null);
	const [idFlow, setIdFlow] = useState<"new" | "held" | null>(null);
	// Why this PDF can't be signed with a digital ID; one opened with a
	// password is known to be locked from the start.
	const [blocker, setBlocker] = useState<SignBlocker | null>(
		password ? "encrypted" : null,
	);
	const [stampPad, setStampPad] = useState(false);
	const [chosen, setChosen] = useState<Signature | null>(null);
	const [chosenStamp, setChosenStamp] = useState<Signature | null>(null);
	// A signature field tapped: the signature chosen next goes into it.
	const target = useRef<Field | null>(null);
	const [leaving, setLeaving] = useState(false);
	const [saving, setSaving] = useState<"ask" | "busy" | null>(null);
	const [flatten, setFlatten] = useState(false);
	const [ink, setInk] = useState<Ink>("blue");
	const [moreOpen, setMoreOpen] = useState(false);
	// A phone's narrow screen: Save on top, four tools at the foot.
	const roomy = useSyncExternalStore(onRoomyChange, roomyScreen);
	const compact = !isDesktop && !roomy;
	const [zoom, setZoom] = useState(0);
	const [width, setWidth] = useState(0);
	const [sizes, setSizes] = useState<Array<[number, number]>>([]);
	const scroller = useRef<HTMLDivElement>(null);
	const editor = useRef<HTMLDivElement>(null);

	useEffect(() => {
		let alive = true;
		readFields(doc)
			.then((found) => alive && setForm(found))
			.catch(() => alive && setForm({ fields: [], locked: new Set() }));
		// Each page's size as shown, in points, for laying the pages out.
		(async () => {
			const out: Array<[number, number]> = [];
			for (let n = 1; n <= doc.numPages; n++) {
				const page = await doc.getPage(n);
				const view = whole(page, () => page.getViewport({ scale: 1 }));
				out.push([view.width, view.height]);
			}
			if (alive) setSizes(out);
		})().catch(() => {});
		loadSignatures().then((list) => alive && setSignatures(list));
		loadStamps().then((list) => alive && setStamps(list));
		return () => {
			alive = false;
		};
	}, [doc]);

	// Opened from a page: that page, once the pages are laid out.
	const placed = useRef(false);
	useEffect(() => {
		if (placed.current || !sizes.length || !width) return;
		placed.current = true;
		if (startPage > 0)
			scroller.current
				?.querySelector(`[data-page="${startPage}"]`)
				?.scrollIntoView({ block: "start" });
	}, [sizes, width, startPage]);

	useLayoutEffect(() => {
		const el = scroller.current;
		if (!el) return;
		const fit = () => setWidth(Math.min(900, el.clientWidth - 24));
		fit();
		const ro = new ResizeObserver(fit);
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	const value = (f: Field) => values[f.name] ?? f.initial;
	const changedFields = useMemo<FieldValue[]>(() => {
		if (!fields) return [];
		const seen = new Set<string>();
		const out: FieldValue[] = [];
		for (const f of fields) {
			if (seen.has(f.name) || !(f.name in values)) continue;
			seen.add(f.name);
			if (values[f.name] !== f.initial)
				out.push({ name: f.name, value: values[f.name] });
		}
		return out;
	}, [fields, values]);
	const digitalItem = items.find((item) => item.kind === "digital");
	// A digital signature to add when saving: one that shows has its
	// place on a page.
	const signing = !!digital && (!digital.visible || !!digitalItem);
	// A PDF already signed takes the digital signature alone, so the
	// earlier one stays valid.
	const onlyDigital = !!digital && (digital.signed || signed);
	const othersPending =
		onlyDigital &&
		(items.some((item) => item.kind !== "digital") || changedFields.length > 0);
	const dirty = items.length > 0 || changedFields.length > 0 || signing;

	/** Hold this digital ID, letting go of the one held before. */
	const holdDigital = useCallback((next: Chosen | null) => {
		if (heldId.current && heldId.current.id !== next?.id)
			heldId.current.id.forget();
		heldId.current = next;
		setDigital(next);
	}, []);
	// Fill & sign closing lets go of it too.
	useEffect(
		() => () => {
			heldId.current?.id.forget();
			heldId.current = null;
		},
		[],
	);
	const dropDigital = () => {
		holdDigital(null);
		setItems((list) => list.filter((item) => item.kind !== "digital"));
	};

	const close = useCallback(() => {
		if (dirty) setLeaving(true);
		else onClose();
	}, [dirty, onClose]);
	useBackClose("fill-sign", true, close);
	useModalFocus(editor, () => {
		if (tool === "digital" && !items.some((item) => item.kind === "digital"))
			holdDigital(null);
		if (tool || selected) {
			setTool(null);
			setSelected(null);
			setEditing(null);
		} else close();
	});

	const update = (id: string, change: Partial<Item>) =>
		setItems((list) =>
			list.map((item) => (item.id === id ? { ...item, ...change } : item)),
		);
	const remove = (id: string) => {
		// Without its mark, a digital signature that shows is not wanted.
		if (items.some((item) => item.id === id && item.kind === "digital"))
			holdDigital(null);
		setItems((list) => list.filter((item) => item.id !== id));
		setSelected(null);
		setEditing(null);
	};

	// Delete takes away what is picked; Escape lets go of it.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (!editor.current?.contains(e.target as Node)) return;
			if (
				(e.target as Element | null)?.closest(
					"input, textarea, select, [contenteditable='true']",
				)
			)
				return;
			if (editing || !selected) return;
			if (e.key === "Delete" || e.key === "Backspace") {
				e.preventDefault();
				remove(selected);
			} else if (e.key === "Escape") {
				e.stopPropagation();
				setSelected(null);
			}
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	});

	// A tool chosen from the keyboard has no spot tapped for it: it is put
	// in the middle of the page on screen, to be moved with the arrows.
	const byKeys = useRef(false);
	/** The page most in view, and the middle of what is seen of it. */
	const spotInView = () => {
		const box = scroller.current;
		if (!box) return null;
		const view = box.getBoundingClientRect();
		let best: { page: number; v: number } | null = null;
		let most = 0;
		for (const el of box.querySelectorAll<HTMLElement>("[data-page]")) {
			const r = el.getBoundingClientRect();
			const top = Math.max(r.top, view.top);
			const bottom = Math.min(r.bottom, view.bottom);
			if (bottom - top <= most || !r.height) continue;
			most = bottom - top;
			best = {
				page: Number(el.dataset.page),
				v: ((top + bottom) / 2 - r.top) / r.height,
			};
		}
		return best;
	};
	// biome-ignore lint/correctness/useExhaustiveDependencies: placed once, when the tool chosen from the keyboard is ready
	useEffect(() => {
		if (!tool || !byKeys.current) return;
		byKeys.current = false;
		const spot = spotInView();
		if (spot) place(spot.page, tool === "text" ? 0.3 : 0.5, spot.v);
	}, [tool]);

	const pick = (next: Tool, keyboard = false) => {
		byKeys.current = keyboard;
		setAgain(null);
		setSelected(null);
		setEditing(null);
		if (tool === next) {
			setTool(null);
			return;
		}
		// A signature or a stamp is made or chosen first; the tool in hand
		// is put down meanwhile.
		if (next === "sign" || next === "initials" || next === "stamp")
			setTool(null);
		if (next === "sign" || next === "initials") {
			const kept = signatures.filter(
				(sig) => !!sig.initials === (next === "initials"),
			);
			if (kept.length) setChooser(next);
			else setPadFor(next);
			return;
		}
		if (next === "stamp") {
			if (stamps.length) setChooser("stamp");
			else setStampPad(true);
			return;
		}
		setTool(next);
	};
	const stampWith = (stamp: Signature) => {
		setChosenStamp(stamp);
		setChooser(null);
		setStampPad(false);
		setTool("stamp");
	};
	const signWith = (signature: Signature, kind: Signing) => {
		setChosen(signature);
		setChooser(null);
		setPadFor(null);
		const into = target.current;
		target.current = null;
		if (into && kind === "digital") {
			// The field itself is its place: the picture and its caption
			// share the box.
			const item: Item = {
				id: newId(),
				page: into.page,
				kind,
				src: signature.src,
				x: into.x,
				y: into.y,
				w: into.w,
				h: into.h,
				field: into.name,
			};
			setItems((list) => [
				...list.filter((other) => other.kind !== "digital"),
				item,
			]);
			setSelected(item.id);
			setTool(null);
			return;
		}
		if (into) {
			// As large as fits the field, keeping its shape, in its middle.
			const [pw, ph] = sizes[into.page] ?? [600, 800];
			const ratio = signature.w / signature.h;
			let w = into.w;
			let h = (w * pw) / ratio / ph;
			if (h > into.h) {
				h = into.h;
				w = (h * ph * ratio) / pw;
			}
			const item: Item = {
				id: newId(),
				page: into.page,
				kind,
				src: signature.src,
				w,
				h,
				x: into.x + (into.w - w) / 2,
				y: into.y + (into.h - h) / 2,
			};
			setItems((list) => [...list, item]);
			setSelected(item.id);
			setTool(null);
			return;
		}
		setTool(kind);
	};
	const signInto = (field: Field) => {
		target.current = field;
		setSelected(null);
		// The digital signature in hand goes into the field tapped.
		if (tool === "digital" && chosen) {
			signWith(chosen, "digital");
			return;
		}
		setTool(null);
		const kept = signatures.filter((sig) => !sig.initials);
		if (kept.length) setChooser("sign");
		else setPadFor("sign");
	};

	/** Sign with a digital ID: chosen, or its summary again. */
	const startDigital = () => {
		if (blocker) {
			toast(blockerMessage(blocker));
			return;
		}
		setTool(null);
		setAgain(null);
		setSelected(null);
		setEditing(null);
		setIdFlow(digital ? "held" : "new");
	};
	/** A digital ID was chosen; one that shows needs its picture. */
	const chooseDigital = (next: Chosen) => {
		holdDigital(next);
		if (!next.visible) {
			setItems((list) => list.filter((item) => item.kind !== "digital"));
			return;
		}
		// Its mark is already on the page: the new ID signs there.
		if (items.some((item) => item.kind === "digital")) return;
		if (signatures.some((sig) => !sig.initials)) setChooser("digital");
		else setPadFor("digital");
	};

	/** Put the chosen thing where the page was tapped. */
	const place = (page: number, u: number, v: number) => {
		if (!tool) return;
		const [pw, ph] = sizes[page] ?? [600, 800];
		const ratio = pw / ph;
		let w = 0.04;
		let h = 0.04 * ratio;
		let text: string | undefined;
		let src: string | undefined;
		if (tool === "sign" || tool === "initials") {
			if (!chosen) return;
			src = chosen.src;
			w = tool === "sign" ? 0.3 : 0.12;
			h = (w * pw) / (chosen.w / chosen.h) / ph;
		} else if (tool === "digital") {
			if (!chosen) return;
			src = chosen.src;
			// The picture as a signature's, with room for the caption under
			// it.
			w = 0.3;
			h = Math.min(0.5, (w * pw) / (chosen.w / chosen.h) / ph / PICTURE_SHARE);
		} else if (tool === "stamp") {
			if (!chosenStamp) return;
			src = chosenStamp.src;
			// About 5 cm across on A4; a tall stamp no taller than that.
			const ratio = chosenStamp.w / chosenStamp.h;
			w = Math.min(0.26, (0.2 * ph * ratio) / pw);
			h = (w * pw) / ratio / ph;
		} else if (tool === "text" || tool === "date") {
			text =
				tool === "date"
					? new Date().toLocaleDateString(locale(), { dateStyle: "medium" })
					: "";
			h = LINE;
			w = Math.max(0.12, textWidth(text, h, pw, ph));
		}
		const item: Item = {
			id: newId(),
			page,
			kind: tool,
			src,
			text,
			w,
			h,
			// Centred on the tap, inside the page.
			x: Math.min(1 - w, Math.max(0, u - (tool === "text" ? 0 : w / 2))),
			y: Math.min(1 - h, Math.max(0, v - h / 2)),
		};
		// One digital signature at most.
		setItems((list) => [
			...list.filter((other) => tool !== "digital" || other.kind !== "digital"),
			item,
		]);
		setSelected(item.id);
		if (tool === "text") setEditing(item.id);
		// One at a time, so a later touch on the page can't add another by
		// mistake; signing more pages is one tap on "Place another".
		setTool(null);
		setAgain(
			tool === "sign" || tool === "initials" || tool === "stamp" ? tool : null,
		);
	};

	/** What was put on the pages, as the PDF tools take it. */
	const marksOf = async (list: Item[]): Promise<Mark[]> => {
		const marks: Mark[] = [];
		for (const item of list) {
			const [pw, ph] = sizes[item.page] ?? [600, 800];
			const box = {
				page: item.page,
				x: item.x,
				y: item.y,
				w: item.w,
				h: item.h,
			};
			if (item.src)
				marks.push({ ...box, kind: "image", png: pngBytes(item.src) });
			else if (
				(item.kind === "text" || item.kind === "date") &&
				standardText(item.text ?? "")
			)
				marks.push({
					...box,
					kind: "text",
					text: item.text ?? "",
					color: INKS[ink],
				});
			else if (
				item.text?.trim() ||
				item.kind === "check" ||
				item.kind === "cross"
			)
				marks.push({
					...box,
					kind: "image",
					png: await picture(item, pw, ph, INKS[ink]),
				});
		}
		return marks;
	};

	/** The copy signed with the digital ID. A PDF not signed yet is
	 * filled in and marked as usual first; one already signed keeps its
	 * bytes as they are, and the signature is added after them, so the
	 * earlier one stays valid. */
	const signCopy = async (held: Chosen, original: Uint8Array) => {
		const { signPdf } = await import("@/lib/sign");
		// One time for the caption and the signature.
		const now = new Date();
		let appearance = null;
		if (held.visible && digitalItem?.src) {
			const [pw, ph] = sizes[digitalItem.page] ?? [600, 800];
			const look = await signatureAppearance(
				digitalItem.src,
				signatureCaption(held.id.summary.name, now),
				digitalItem.w * pw,
				digitalItem.h * ph,
				INKS[ink],
			);
			appearance = {
				placement: {
					page: digitalItem.page,
					x: digitalItem.x,
					y: digitalItem.y,
					w: digitalItem.w,
					h: digitalItem.h,
				},
				png: pngBytes(look),
			};
		}
		const earlier = held.signed || signed;
		const base = earlier
			? original
			: await fillAndSign(original, {
					password,
					fields: changedFields,
					marks: await marksOf(items.filter((item) => item.kind !== "digital")),
					flatten,
				});
		return signPdf(base, held.id, {
			appearance,
			// A form made flat has no fields left to sign in.
			field: earlier || !flatten ? digitalItem?.field : undefined,
			now,
		});
	};

	const save = async () => {
		setSaving("busy");
		const held = signing ? heldId.current : null;
		try {
			// pdf.js holds the file's bytes (the ones read were handed to it).
			const original = await doc.getData();
			const bytes = held
				? await signCopy(held, original)
				: await fillAndSign(original, {
						password,
						fields: changedFields,
						marks: await marksOf(items),
						flatten,
					});
			const signedCopy =
				!!held || items.some((i) => i.kind === "sign" || i.kind === "initials");
			const saved = await backend.saveFile(
				copyName(name, signedCopy ? t("signed") : t("filled in")),
				bytes,
				"application/pdf",
			);
			if (!saved) {
				setSaving("ask");
				return;
			}
			// Signed: the ID is let go at once.
			if (held) holdDigital(null);
			setSaving(null);
			onSaved?.(saved);
			onClose();
		} catch (err) {
			setSaving("ask");
			toast(
				err instanceof ToolError && err.reason === "password"
					? t("This PDF's password is needed to save a copy")
					: held
						? t("Couldn't sign the copy")
						: t("Couldn't save a copy"),
			);
		}
	};

	const shownKind = chooser ?? padFor;
	const keptForChooser =
		chooser === "stamp"
			? stamps
			: signatures.filter((sig) => !!sig.initials === (chooser === "initials"));
	const tools: Array<[Tool, string, JSX.Element]> = [
		["sign", t("Signature"), <PenLine key="s" size={20} />],
		["initials", t("Initials"), <SignatureIcon key="i" size={20} />],
		["stamp", t("Stamp"), <Stamp key="st" size={20} />],
		["text", t("Text"), <Type key="t" size={20} />],
		["date", t("Date"), <CalendarDays key="d" size={20} />],
		["check", t("Tick"), <Check key="c" size={20} />],
		["cross", t("Cross"), <X key="x" size={20} />],
	];
	/** On a phone, the tools few forms need wait in More. */
	const rare: Tool[] = ["initials", "stamp", "cross"];
	const atHand = compact
		? tools.filter(([kind]) => !rare.includes(kind))
		: tools;
	const pageWidth = Math.max(200, width) * ZOOMS[zoom];
	const keysHint = useId();
	const toolName = (kind: Tool) =>
		kind === "digital"
			? t("Digital ID")
			: (tools.find(([other]) => other === kind)?.[1] ?? "");
	const saveWord = signing ? t("Save a signed copy") : t("Save a copy");
	const saveButton = (
		<Button
			onClick={() => setSaving("ask")}
			disabled={!dirty || saving === "busy"}
			data-testid="fill-save"
		>
			{/* A phone's bar beside the title has no room for the longer
			 * words in most languages; the hint, the mark and the save
			 * dialog's title say that it signs. */}
			{compact && signing ? t("Save") : saveWord}
		</Button>
	);
	// Signing with a digital ID: a rare tool, in More on a phone.
	const digitalHint = blocker ? blockerMessage(blocker) : undefined;
	const digitalTool = (
		<button
			type="button"
			className={s.tool}
			title={digitalHint ?? t("Sign with a digital ID")}
			aria-pressed={!!digital || tool === "digital"}
			aria-disabled={!!blocker || undefined}
			data-blocked={blocker ?? undefined}
			onClick={startDigital}
			data-testid="fill-tool-digital"
		>
			<FileKey size={20} />
			<span>{t("Digital ID")}</span>
		</button>
	);

	return createPortal(
		<div
			ref={editor}
			tabIndex={-1}
			className={`${s.fill} ${s.signFill}`}
			// biome-ignore lint/a11y/useSemanticElements: a full-screen surface, not a native dialog
			role="dialog"
			aria-modal="true"
			aria-label={t("Fill & sign")}
			data-testid="fill-sign"
			data-can-mark={canMark || undefined}
			data-compact={compact || undefined}
		>
			<header className={s.fillBar} data-tauri-drag-region="deep">
				<IconButton label={t("Close")} onClick={close} data-testid="fill-close">
					<ArrowLeft size={22} className="pw-flip" />
				</IconButton>
				<div className={s.fillTitle} title={name}>
					<strong>{t("Fill & sign")}</strong>
					<span dir="auto">{name}</span>
				</div>
				{compact && saveButton}
			</header>
			{canMark && (
				<div
					className={s.toolbar}
					role="toolbar"
					aria-label={t("Add to the page")}
				>
					{atHand.map(([kind, label, icon]) => (
						<button
							key={kind}
							type="button"
							className={s.tool}
							title={label}
							aria-pressed={tool === kind}
							// An already signed PDF takes the digital signature alone.
							disabled={onlyDigital}
							// From the keyboard (no pointer: detail 0) it is placed at once.
							onClick={(e) => pick(kind, e.detail === 0)}
							data-testid={`fill-tool-${kind}`}
						>
							{icon}
							<span>{label}</span>
						</button>
					))}
					{!compact && digitalTool}
					{compact && (
						<button
							type="button"
							className={s.tool}
							title={t("More")}
							aria-haspopup="dialog"
							aria-pressed={
								(!!tool && rare.includes(tool)) ||
								tool === "digital" ||
								!!digital
							}
							onClick={() => setMoreOpen(true)}
							data-testid="fill-tool-more"
						>
							<Ellipsis size={20} />
							<span>{t("More")}</span>
						</button>
					)}
				</div>
			)}
			{!compact && (
				<div className={s.fillActions} data-testid="fill-actions">
					<div className={s.zoom}>
						<IconButton
							label={t("Zoom out")}
							disabled={zoom === 0}
							onClick={() => setZoom((z) => Math.max(0, z - 1))}
						>
							<Minus size={18} />
						</IconButton>
						<span>{Math.round(ZOOMS[zoom] * 100)}%</span>
						<IconButton
							label={t("Zoom in")}
							disabled={zoom === ZOOMS.length - 1}
							onClick={() => setZoom((z) => Math.min(ZOOMS.length - 1, z + 1))}
						>
							<Plus size={18} />
						</IconButton>
					</div>
					{saveButton}
				</div>
			)}

			<p id={keysHint} className="visually-hidden">
				{t(
					"Move it with the arrow keys, change its size with + and −, or remove it with Delete.",
				)}
			</p>
			{(!compact ||
				tool ||
				again ||
				othersPending ||
				(digital && !digital.visible)) && (
				<div
					className={s.fillHint}
					data-testid="fill-guidance"
					data-warning={othersPending || undefined}
				>
					<Info size={17} aria-hidden="true" />
					<p aria-live="polite" data-testid="fill-hint">
						{othersPending
							? t(
									"In a PDF that's already signed, only the digital signature can be added, so the earlier signature stays valid. Remove your other changes first.",
								)
							: selected && !editing && isDesktop
								? t(
										"Move it with the arrow keys, change its size with + and −, or remove it with Delete.",
									)
								: tool
									? t("{tool}: select a spot on the page to place it.", {
											tool: toolName(tool),
										})
									: digital && !digital.visible
										? t("Your digital signature will be added when you save.")
										: fields?.length
											? t(
													"Type into the form's fields, or add to the page from the tools",
												)
											: canMark
												? t(
														"Choose Text or Signature above, then select a spot on the page.",
													)
												: t("Type into the form's fields")}
					</p>
					{/* Here rather than in the tool bar: the ink for everything
					 * added, the signature too. A phone has it in More. */}
					{canMark && !compact && (
						<div className={s.fillInk} role="radiogroup" aria-label={t("Ink")}>
							{(["blue", "black"] as const).map((colour) => (
								<button
									key={colour}
									type="button"
									// biome-ignore lint/a11y/useSemanticElements: a pair of buttons with radio semantics
									role="radio"
									aria-checked={ink === colour}
									aria-label={
										colour === "blue" ? t("Blue ink") : t("Black ink")
									}
									title={colour === "blue" ? t("Blue ink") : t("Black ink")}
									// One stop for the pair; the arrows switch between them.
									tabIndex={ink === colour ? 0 : -1}
									onClick={() => setInk(colour)}
									onKeyDown={(e) => {
										if (!/^Arrow(Left|Right|Up|Down)$/.test(e.key)) return;
										e.preventDefault();
										const next = colour === "blue" ? "black" : "blue";
										setInk(next);
										(
											e.currentTarget.parentElement?.querySelector(
												`[data-testid="fill-ink-${next}"]`,
											) as HTMLElement | null
										)?.focus();
									}}
									data-testid={`fill-ink-${colour}`}
								>
									<span
										style={{ background: INKS[colour] }}
										aria-hidden="true"
									/>
								</button>
							))}
						</div>
					)}
					{tool && (
						<button
							type="button"
							className={s.cancelTool}
							onClick={() => {
								// A digital signature that shows is not wanted without
								// its place.
								if (tool === "digital" && !digitalItem) holdDigital(null);
								setTool(null);
							}}
						>
							{t("Cancel")}
						</button>
					)}
					{!tool && digital && !compact && (
						<button
							type="button"
							className={s.cancelTool}
							onClick={() => {
								// The mark stays where it is, for the next ID to sign.
								holdDigital(null);
								setIdFlow("new");
							}}
							data-testid="fill-digital-other"
						>
							{t("Use a different digital ID")}
						</button>
					)}
					{!tool && digital && !digital.visible && (
						<button
							type="button"
							className={s.cancelTool}
							onClick={dropDigital}
							data-testid="fill-digital-remove"
						>
							{t("Remove")}
						</button>
					)}
					{!tool && again && (
						<button
							type="button"
							className={s.cancelTool}
							onClick={() => {
								setSelected(null);
								setEditing(null);
								setTool(again);
								setAgain(null);
							}}
							data-testid="fill-again"
						>
							{t("Place another")}
						</button>
					)}
					{!compact && (
						<p className={s.saveStatus} aria-live="polite">
							{dirty
								? t("Changes ready to save")
								: t("Add your details to get started")}
						</p>
					)}
				</div>
			)}
			<div
				ref={scroller}
				className={s.fillPages}
				data-tool={tool ?? undefined}
				data-testid="fill-pages"
			>
				{!sizes.length && <Spinner label={t("Opening")} />}
				{sizes.map(([pw, ph], page) => (
					<FillPage
						key={page}
						doc={doc}
						page={page}
						width={pageWidth}
						height={(pageWidth * ph) / pw}
						placing={!!tool}
						forms={form ? !form.locked.has(page) : null}
						label={t("Page {n}: place it here", { n: page + 1 })}
						onTap={(u, v) => {
							if (tool) place(page, u, v);
							else {
								setSelected(null);
								setEditing(null);
							}
						}}
					>
						{fields
							?.filter((f) => f.page === page)
							.map((f, i) => (
								<FieldInput
									key={`${f.name}-${i}`}
									onSign={
										canMark &&
										!signedIn(f, items) &&
										(!onlyDigital || tool === "digital")
											? () => signInto(f)
											: undefined
									}
									locked={onlyDigital}
									field={f}
									value={value(f)}
									pageHeight={(pageWidth * ph) / pw}
									onChange={(v) =>
										setValues((all) => ({ ...all, [f.name]: v }))
									}
								/>
							))}
						{items
							.filter((item) => item.page === page)
							.map((item) => (
								<PlacedItem
									key={item.id}
									item={item}
									pageWidth={pageWidth}
									pageHeight={(pageWidth * ph) / pw}
									ink={INKS[ink]}
									label={
										item.kind === "text"
											? item.text || t("Text")
											: toolName(item.kind)
									}
									caption={
										item.kind === "digital" && digital
											? signatureCaption(digital.id.summary.name, new Date())
											: undefined
									}
									describedBy={keysHint}
									selected={selected === item.id}
									editing={editing === item.id}
									readable={compact}
									onSelect={() => {
										setSelected(item.id);
										if (editing !== item.id) setEditing(null);
									}}
									onEdit={() => setEditing(item.id)}
									onEdited={() => setEditing(null)}
									onChange={(change) => update(item.id, change)}
									onText={(text) =>
										update(item.id, {
											text,
											w: Math.min(
												1 - item.x,
												Math.max(0.06, textWidth(text, item.h, pw, ph)),
											),
										})
									}
									onRemove={() => remove(item.id)}
								/>
							))}
					</FillPage>
				))}
			</div>

			<Sheet
				open={moreOpen}
				title={t("More")}
				onClose={() => setMoreOpen(false)}
				testId="fill-more"
			>
				{tools
					.filter(([kind]) => rare.includes(kind))
					.map(([kind, label, icon]) => (
						<SheetItem
							key={kind}
							icon={icon}
							checked={tool === kind}
							disabled={onlyDigital}
							onClick={() => {
								setMoreOpen(false);
								pick(kind, false);
							}}
							testId={`fill-tool-${kind}`}
						>
							{label}
						</SheetItem>
					))}
				<SheetItem
					icon={<FileKey size={20} />}
					hint={digitalHint}
					checked={!!digital || tool === "digital"}
					onClick={() => {
						setMoreOpen(false);
						startDigital();
					}}
					testId="fill-tool-digital"
				>
					{t("Sign with a digital ID")}
				</SheetItem>
				<SheetDivider />
				{(["blue", "black"] as const).map((colour) => (
					<SheetItem
						key={colour}
						icon={
							<svg viewBox="0 0 20 20" aria-hidden="true">
								<circle
									cx="10"
									cy="10"
									r="8"
									fill={INKS[colour]}
									className={s.inkSwatch}
								/>
							</svg>
						}
						checked={ink === colour}
						onClick={() => {
							setInk(colour);
							setMoreOpen(false);
						}}
						testId={`fill-ink-${colour}`}
					>
						{colour === "blue" ? t("Blue ink") : t("Black ink")}
					</SheetItem>
				))}
				<SheetDivider />
				<SheetItem
					icon={<Plus size={20} />}
					hint={`${Math.round(ZOOMS[zoom] * 100)}%`}
					disabled={zoom === ZOOMS.length - 1}
					onClick={() => setZoom((z) => Math.min(ZOOMS.length - 1, z + 1))}
					testId="fill-zoom-in"
				>
					{t("Zoom in")}
				</SheetItem>
				<SheetItem
					icon={<Minus size={20} />}
					disabled={zoom === 0}
					onClick={() => setZoom((z) => Math.max(0, z - 1))}
					testId="fill-zoom-out"
				>
					{t("Zoom out")}
				</SheetItem>
			</Sheet>

			{chooser && (
				<Sheet
					open
					title={
						chooser === "stamp"
							? t("Your stamp")
							: chooser === "initials"
								? t("Your initials")
								: t("Your signature")
					}
					onClose={() => {
						target.current = null;
						// No picture for the digital signature: it is not wanted.
						if (chooser === "digital" && !digitalItem) holdDigital(null);
						setChooser(null);
					}}
					testId="signature-chooser"
				>
					{keptForChooser.map((sig) => (
						<div key={sig.id} className={s.kept}>
							<button
								type="button"
								className={s.keptPick}
								onClick={() =>
									chooser === "stamp" ? stampWith(sig) : signWith(sig, chooser)
								}
								data-testid={
									chooser === "stamp" ? "stamp-kept" : "signature-kept"
								}
							>
								<img
									src={sig.src}
									alt={chooser === "stamp" ? t("Stamp") : t("Your signature")}
								/>
							</button>
							<IconButton
								label={
									chooser === "stamp"
										? t("Forget this stamp")
										: t("Forget this signature")
								}
								onClick={async () => {
									if (chooser === "stamp") {
										const list = await forgetStamp(sig.id);
										setStamps(list);
										if (!list.length) setChooser(null);
										return;
									}
									const list = await forgetSignature(sig.id);
									setSignatures(list);
									if (
										!list.some((x) => !!x.initials === (chooser === "initials"))
									)
										setChooser(null);
								}}
							>
								<Trash2 size={18} />
							</IconButton>
						</div>
					))}
					<SheetItem
						icon={<Plus size={20} />}
						onClick={() => {
							// The field waits for the new signature.
							if (chooser === "stamp") setStampPad(true);
							else setPadFor(chooser);
							setChooser(null);
						}}
						testId={chooser === "stamp" ? "stamp-new" : "signature-new"}
					>
						{chooser === "stamp"
							? t("New stamp")
							: chooser === "initials"
								? t("New initials")
								: t("New signature")}
					</SheetItem>
				</Sheet>
			)}
			{padFor && (
				<SignaturePad
					initials={shownKind === "initials"}
					ink={INKS[ink]}
					onInk={(hex) => setInk(hex === INKS.black ? "black" : "blue")}
					onClose={() => {
						target.current = null;
						if (padFor === "digital" && !digitalItem) holdDigital(null);
						setPadFor(null);
					}}
					onDone={(sig) => {
						setSignatures((list) => [
							sig,
							...list.filter((x) => x.src !== sig.src),
						]);
						signWith(sig, padFor);
					}}
				/>
			)}
			{stampPad && (
				<StampPad
					onClose={() => setStampPad(false)}
					onDone={(stamp) => {
						setStamps((list) => [
							stamp,
							...list.filter((x) => x.src !== stamp.src),
						]);
						stampWith(stamp);
					}}
				/>
			)}
			{idFlow && (
				<DigitalIdFlow
					name={name}
					pdf={() => doc.getData()}
					held={idFlow === "held" ? digital : null}
					onBlocked={setBlocker}
					onDrop={() => holdDigital(null)}
					onReady={(next) => {
						setIdFlow(null);
						chooseDigital(next);
					}}
					onClose={() => {
						setIdFlow(null);
						// No ID now (none chosen, or the held one put aside): no
						// mark of one either.
						if (!heldId.current)
							setItems((list) =>
								list.filter((item) => item.kind !== "digital"),
							);
					}}
				/>
			)}
			{saving && (
				<Dialog
					open
					title={saveWord}
					onClose={() => saving !== "busy" && setSaving(null)}
					testId="fill-save-ask"
					actions={
						<>
							<Button
								variant="ghost"
								disabled={saving === "busy"}
								onClick={() => setSaving(null)}
							>
								{t("Cancel")}
							</Button>
							<Button
								onClick={save}
								disabled={saving === "busy" || (signing && othersPending)}
								data-testid="fill-save-go"
							>
								{saving !== "busy"
									? t("Save")
									: signing
										? t("Signing…")
										: t("Saving…")}
							</Button>
						</>
					}
				>
					<p className={s.hint}>
						{t("A new PDF is made; the file you opened stays as it was.")}
					</p>
					{signing && digital ? (
						<>
							<p className={s.hint} data-testid="fill-signed-as">
								{t(
									"Signed as {name}. There's no timestamp: the time comes from this device's clock.",
									{ name: digital.id.summary.name },
								)}
							</p>
							{onlyDigital && (
								<p className={s.hint}>
									{othersPending
										? t(
												"In a PDF that's already signed, only the digital signature can be added, so the earlier signature stays valid. Remove your other changes first.",
											)
										: t(
												"The earlier signature stays valid: only your digital signature is added.",
											)}
								</p>
							)}
						</>
					) : (
						signed && <p className={s.hint}>{t(SIGNED_WARNING)}</p>
					)}
					{changedFields.length > 0 && !onlyDigital && (
						<label className={s.keep}>
							<input
								type="checkbox"
								checked={flatten}
								onChange={(e) => setFlatten(e.target.checked)}
								data-testid="fill-flatten"
							/>
							{t(
								"Make the form's answers part of the page, so they can't be changed",
							)}
						</label>
					)}
				</Dialog>
			)}
			{leaving && (
				<Dialog
					open
					title={t("Leave without saving?")}
					onClose={() => setLeaving(false)}
					alert
					testId="fill-leave"
					actions={
						<>
							<Button variant="ghost" onClick={() => setLeaving(false)}>
								{t("Keep editing")}
							</Button>
							<Button
								variant="danger"
								onClick={onClose}
								data-testid="fill-discard"
							>
								{t("Discard")}
							</Button>
						</>
					}
				>
					{t("What you added is lost unless you save a copy.")}
				</Dialog>
			)}
		</div>,
		document.body,
	);
}

/** Whether a signature already sits in a signature field. */
function signedIn(field: Field, items: Item[]): boolean {
	return items.some(
		(i) =>
			i.page === field.page &&
			(i.kind === "sign" || i.kind === "initials" || i.kind === "digital") &&
			i.x + i.w / 2 > field.x &&
			i.x + i.w / 2 < field.x + field.w &&
			i.y + i.h / 2 > field.y &&
			i.y + i.h / 2 < field.y + field.h,
	);
}

/** How wide a line of text is, as a share of the page's width. */
function textWidth(text: string, h: number, pw: number, ph: number): number {
	const ctx = document.createElement("canvas").getContext("2d");
	if (!ctx) return 0.3;
	const size = (h * ph) / 1.2;
	ctx.font = `${size}px Helvetica, Arial, sans-serif`;
	return (ctx.measureText(text || "M").width + size * 0.4) / pw;
}

/** Where and when a press on a page began. */
export interface Press {
	id: number;
	x: number;
	y: number;
	at: number;
}

/** Whether a press that ended here was a tap: it hardly moved and was
 * short. A press that scrolled ends in `pointercancel` instead, or moves
 * further than this. */
export function isTap(
	from: Press,
	to: { clientX: number; clientY: number; timeStamp: number },
): boolean {
	return (
		Math.hypot(to.clientX - from.x, to.clientY - from.y) < 8 &&
		to.timeStamp - from.at < 500
	);
}

/** One page: its picture, drawn once it is near the screen, under the
 * fields and marks laid over it. */
export function FillPage({
	doc,
	page,
	width,
	height,
	onTap,
	placing,
	forms,
	label,
	children,
}: {
	doc: PDFDocumentProxy;
	page: number;
	width: number;
	height: number;
	/** A tool is chosen: a tap puts something here. */
	placing: boolean;
	/** The form's fields are laid over the page, so it is drawn without
	 * them; null: not known yet, so not drawn yet. Left out, the page is
	 * drawn as the file shows it. */
	forms?: boolean | null;
	/** What Enter does on the page while placing, said aloud. */
	label?: string;
	onTap: (u: number, v: number) => void;
	children: React.ReactNode;
}) {
	const box = useRef<HTMLDivElement>(null);
	const canvas = useRef<HTMLCanvasElement>(null);
	const [near, setNear] = useState(false);
	// Where a press began: a mark is placed when it ends as a tap, so a
	// finger that scrolls the page puts nothing on it.
	const down = useRef<Press | null>(null);

	useEffect(() => {
		const el = box.current;
		if (!el) return;
		const io = new IntersectionObserver(
			([entry]) => setNear(entry.isIntersecting),
			{ rootMargin: "800px 0px" },
		);
		io.observe(el);
		return () => io.disconnect();
	}, []);

	useEffect(() => {
		if (!near || width < 50 || forms === null) return;
		let alive = true;
		let task: { cancel(): void; promise: Promise<void> } | null = null;
		const timer = window.setTimeout(async () => {
			const proxy = await doc.getPage(page + 1);
			const el = canvas.current;
			const ctx = el?.getContext("2d");
			if (!alive || !el || !ctx) return;
			const density = Math.min(2, window.devicePixelRatio || 1);
			// The whole page, whatever the reader has cropped on screen.
			const base = whole(proxy, () => proxy.getViewport({ scale: 1 }));
			const viewport = whole(proxy, () =>
				proxy.getViewport({ scale: (width * density) / base.width }),
			);
			el.width = Math.ceil(viewport.width);
			el.height = Math.ceil(viewport.height);
			task = proxy.render({
				canvasContext: ctx,
				viewport,
				annotationMode: forms ? ENABLE_FORMS : undefined,
			});
			await task.promise.catch(() => {});
			if (alive) el.dataset.drawn = "1";
		}, 60);
		return () => {
			alive = false;
			window.clearTimeout(timer);
			task?.cancel();
		};
	}, [doc, page, near, width, forms]);

	return (
		<div
			ref={box}
			className={s.fillPage}
			style={{ width, height }}
			data-testid="fill-page"
			data-page={page}
			// The file's own fields show under ours: ours hide them.
			data-ghosts={forms === false || undefined}
			// While a tool is in hand, Enter puts it on the page, in the
			// middle of what is seen of it.
			tabIndex={placing ? 0 : undefined}
			role={placing ? "button" : undefined}
			aria-label={placing ? label : undefined}
			onKeyDown={(e) => {
				if (!placing || e.target !== e.currentTarget) return;
				if (e.key !== "Enter" && e.key !== " ") return;
				e.preventDefault();
				const r = e.currentTarget.getBoundingClientRect();
				const top = Math.max(r.top, 0);
				const bottom = Math.min(r.bottom, window.innerHeight);
				onTap(0.5, ((top + bottom) / 2 - r.top) / r.height);
			}}
			onPointerDown={(e) => {
				// A second finger: the two of them scroll, nothing is placed.
				if (
					down.current &&
					down.current.id !== e.pointerId &&
					e.timeStamp - down.current.at < 500
				) {
					down.current = null;
					return;
				}
				if (e.target !== e.currentTarget && e.target !== canvas.current) return;
				if (e.pointerType === "mouse" && e.button !== 0) return;
				// The text placed here takes the keyboard: the tap must not
				// take it back to the page.
				if (placing) e.preventDefault();
				down.current = {
					id: e.pointerId,
					x: e.clientX,
					y: e.clientY,
					at: e.timeStamp,
				};
			}}
			onPointerUp={(e) => {
				const d = down.current;
				if (!d || d.id !== e.pointerId) return;
				down.current = null;
				if (!isTap(d, e)) return;
				const r = e.currentTarget.getBoundingClientRect();
				onTap((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
			}}
			// The browser took the touch over to scroll.
			onPointerCancel={() => {
				down.current = null;
			}}
		>
			{/* The page's own text is drawn left to right whatever the app's
			 * language: pdf.js places each letter, and a right-to-left
			 * canvas would anchor each one at its right edge. */}
			<canvas ref={canvas} dir="ltr" className={s.fillCanvas} />
			{children}
		</div>
	);
}

const at = (b: Box): CSSProperties => ({
	left: `${b.x * 100}%`,
	top: `${b.y * 100}%`,
	width: `${b.w * 100}%`,
	height: `${b.h * 100}%`,
});

function FieldInput({
	field,
	value,
	pageHeight,
	onChange,
	onSign,
	locked = false,
}: {
	field: Field;
	value: string | boolean;
	pageHeight: number;
	onChange: (value: string | boolean) => void;
	onSign?: () => void;
	/** Not to be changed now (a signed PDF takes the digital signature
	 * alone). */
	locked?: boolean;
}) {
	const px = field.h * pageHeight;
	if (field.kind === "signature")
		return onSign ? (
			<button
				type="button"
				className={s.fieldSign}
				style={at(field)}
				onClick={onSign}
				data-testid="fill-sign-here"
			>
				<PenLine size={Math.max(10, Math.min(px * 0.5, 18))} />
				{px > 18 && <span>{t("Sign here")}</span>}
			</button>
		) : null;
	// As large as the file asks, or as fits the box, at any zoom.
	const font = Math.max(
		8,
		field.size
			? field.size * pageHeight
			: field.multiline
				? Math.min(px * 0.62, pageHeight * 0.016)
				: px * 0.62,
	);
	const label = field.name;
	if (field.kind === "check" || field.kind === "radio") {
		const on =
			field.kind === "check"
				? value === true
				: value === field.on && !!field.on;
		return (
			<button
				type="button"
				role={field.kind === "check" ? "checkbox" : "radio"}
				aria-checked={on}
				aria-label={label}
				className={`${s.fieldBox} ${field.kind === "radio" ? s.fieldRadio : ""}`}
				style={at(field)}
				disabled={locked}
				onClick={() =>
					onChange(field.kind === "check" ? !on : on ? "" : (field.on ?? ""))
				}
				data-testid="fill-field"
			>
				{on && (
					<Check
						size={Math.max(8, Math.min(px, field.w * pageHeight) * 0.8)}
						strokeWidth={3}
					/>
				)}
			</button>
		);
	}
	if (field.kind === "choice")
		return (
			<select
				className={s.fieldText}
				style={{ ...at(field), fontSize: font }}
				value={String(value)}
				aria-label={label}
				disabled={locked}
				onChange={(e) => onChange(e.target.value)}
				data-testid="fill-field"
			>
				<option value="" />
				{field.options?.map(([v, text]) => (
					<option key={v} value={v}>
						{text}
					</option>
				))}
			</select>
		);
	const Tag = field.multiline ? "textarea" : "input";
	return (
		<Tag
			className={s.fieldText}
			style={{ ...at(field), fontSize: font }}
			value={String(value)}
			maxLength={field.maxLength}
			aria-label={label}
			readOnly={locked}
			dir="auto"
			onChange={(
				e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
			) => onChange(e.target.value)}
			data-testid="fill-field"
		/>
	);
}

/** A mark on a page: dragged to move, by its corner to resize. */
function PlacedItem({
	item,
	label,
	caption,
	describedBy,
	pageWidth,
	pageHeight,
	ink,
	selected,
	editing,
	readable = false,
	onSelect,
	onEdit,
	onEdited,
	onChange,
	onText,
	onRemove,
}: {
	item: Item;
	/** What it is, said aloud ("Signature", the words typed). */
	label: string;
	/** A digital signature's words under its picture. */
	caption?: string[];
	/** The keys that move it, said aloud. */
	describedBy: string;
	pageWidth: number;
	pageHeight: number;
	/** The colour of typed text and marks. */
	ink: string;
	selected: boolean;
	editing: boolean;
	/** Typed at a size that reads (a phone): the mark itself may be
	 * smaller than that on the screen. */
	readable?: boolean;
	onSelect: () => void;
	onEdit: () => void;
	/** Typing is over (Enter or Esc in the text). */
	onEdited: () => void;
	onChange: (change: Partial<Item>) => void;
	onText: (text: string) => void;
	onRemove: () => void;
}) {
	const drag = useRef<{
		mode: "move" | "size";
		x: number;
		y: number;
		from: Item;
		moved: boolean;
	} | null>(null);
	const tap = useRef<Press | null>(null);
	const input = useRef<HTMLInputElement>(null);
	const self = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (editing) input.current?.focus();
	}, [editing]);
	// Picked, it takes the keyboard, so the arrows move it at once.
	useEffect(() => {
		if (selected && !editing && !self.current?.contains(document.activeElement))
			self.current?.focus({ preventScroll: true });
	}, [selected, editing]);

	/** The arrows move it (Shift: further); + and - resize it, keeping
	 * its shape; Enter edits typed text. Delete and Escape are the
	 * editor's (they work on whatever is picked). */
	const onKey = (e: React.KeyboardEvent) => {
		if (editing || e.target !== e.currentTarget) return;
		const step = e.shiftKey ? 0.05 : 0.005;
		const by: Record<string, [number, number]> = {
			ArrowLeft: [-step, 0],
			ArrowRight: [step, 0],
			ArrowUp: [0, -step * (pageWidth / pageHeight)],
			ArrowDown: [0, step * (pageWidth / pageHeight)],
		};
		if (e.key in by) {
			const [du, dv] = by[e.key];
			onChange({
				x: Math.min(1 - item.w, Math.max(0, item.x + du)),
				y: Math.min(1 - item.h, Math.max(0, item.y + dv)),
			});
		} else if (["+", "=", "-", "_"].includes(e.key)) {
			const want = e.key === "+" || e.key === "=" ? 1.1 : 1 / 1.1;
			const grow = Math.max(
				0.02 / item.w,
				Math.min(want, (1 - item.x) / item.w, (1 - item.y) / item.h),
			);
			onChange({ w: item.w * grow, h: item.h * grow });
		} else if (
			(e.key === "Enter" || e.key === "F2") &&
			(item.kind === "text" || item.kind === "date")
		)
			onEdit();
		else return;
		e.preventDefault();
	};

	const start = (mode: "move" | "size") => (e: React.PointerEvent) => {
		if (editing && mode === "move") return;
		e.stopPropagation();
		// One finger at a time moves it; a second one is the page's.
		if (drag.current || tap.current) {
			drag.current = null;
			tap.current = null;
			return;
		}
		// A finger on a mark not picked yet may be scrolling the page: it
		// is picked if the press ends as a tap, and only then can be dragged.
		if (e.pointerType === "touch" && !selected && mode === "move") {
			tap.current = {
				id: e.pointerId,
				x: e.clientX,
				y: e.clientY,
				at: e.timeStamp,
			};
			return;
		}
		e.preventDefault();
		e.currentTarget.setPointerCapture(e.pointerId);
		drag.current = {
			mode,
			x: e.clientX,
			y: e.clientY,
			from: item,
			moved: false,
		};
		onSelect();
	};
	const move = (e: React.PointerEvent) => {
		const d = drag.current;
		if (!d) return;
		const du = (e.clientX - d.x) / pageWidth;
		const dv = (e.clientY - d.y) / pageHeight;
		if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 3) return;
		d.moved = true;
		const f = d.from;
		if (d.mode === "move")
			onChange({
				x: Math.min(1 - f.w, Math.max(0, f.x + du)),
				y: Math.min(1 - f.h, Math.max(0, f.y + dv)),
			});
		else {
			// Larger or smaller, keeping its shape.
			const grow = Math.max(
				0.2,
				Math.min((f.w + du) / f.w, (1 - f.x) / f.w, (1 - f.y) / f.h),
			);
			onChange({ w: f.w * grow, h: f.h * grow });
		}
	};
	const end = (e: React.PointerEvent) => {
		const pressed = tap.current;
		tap.current = null;
		if (pressed) {
			if (e.type === "pointerup" && isTap(pressed, e)) onSelect();
			return;
		}
		const d = drag.current;
		drag.current = null;
		// A tap on placed text edits it.
		if (
			d &&
			!d.moved &&
			d.mode === "move" &&
			(item.kind === "text" || item.kind === "date")
		)
			onEdit();
	};

	const fontPx = (item.h * pageHeight) / 1.2;
	// Text too small to read as it is typed grows while it is typed.
	const enlarged = readable && fontPx < READABLE;
	// The field widens after each letter, once the browser has already
	// slid the words along to keep the caret in view: slide them back.
	// biome-ignore lint/correctness/useExhaustiveDependencies: again as the words change
	useLayoutEffect(() => {
		const el = input.current;
		if (enlarged && el && el.scrollWidth <= el.clientWidth + 1)
			el.scrollLeft = 0;
	}, [enlarged, item.text]);
	return (
		<div
			ref={self}
			className={s.item}
			style={at(item)}
			data-selected={selected ? "" : undefined}
			data-kind={item.kind}
			// biome-ignore lint/a11y/noNoninteractiveTabindex: a mark is moved and sized from the keyboard
			tabIndex={0}
			// biome-ignore lint/a11y/useSemanticElements: a mark on the page, not a form group
			role="group"
			aria-label={label}
			aria-describedby={describedBy}
			onFocus={(e) => {
				if (e.target === e.currentTarget && !selected) onSelect();
			}}
			onKeyDown={onKey}
			onPointerDown={start("move")}
			onPointerMove={move}
			onPointerUp={end}
			onPointerCancel={end}
			data-testid="fill-item"
		>
			{item.kind === "digital" ? (
				<>
					{/* Picked, it has its remove button there instead. */}
					{!selected && (
						<span className={s.digitalBadge} aria-hidden="true">
							<FileKey size={12} />
							{t("Digital ID")}
						</span>
					)}
					<span
						className={s.digitalMark}
						style={
							{
								// Two lines in the share of the box under the picture.
								"--caption": `${Math.max(4, ((item.h * pageHeight * (1 - PICTURE_SHARE)) / 2) * 0.72)}px`,
								color: ink,
							} as CSSProperties
						}
					>
						<img src={item.src} alt={t("Your signature")} draggable={false} />
						<span
							className={s.digitalCaption}
							data-testid="fill-digital-caption"
						>
							{caption?.map((line) => (
								<span key={line}>{line}</span>
							))}
						</span>
					</span>
				</>
			) : item.src ? (
				<img
					src={item.src}
					alt={item.kind === "stamp" ? t("Stamp") : t("Your signature")}
					draggable={false}
				/>
			) : item.kind === "check" || item.kind === "cross" ? (
				item.kind === "check" ? (
					<Check width="100%" height="100%" strokeWidth={3} color={ink} />
				) : (
					<X width="100%" height="100%" strokeWidth={3} color={ink} />
				)
			) : editing ? (
				<input
					ref={input}
					className={`${s.itemInput} ${enlarged ? s.itemInputLarge : ""}`}
					style={{
						fontSize: enlarged ? READABLE : fontPx,
						color: ink,
						// Wide enough for what is typed, at the size it is typed.
						...(enlarged
							? { width: `max(100%, ${(item.text?.length ?? 0) + 3}ch)` }
							: {}),
					}}
					value={item.text ?? ""}
					dir="auto"
					placeholder={t("Type here")}
					onChange={(e) => onText(e.target.value)}
					onKeyDown={(e) => {
						if (e.key !== "Enter" && e.key !== "Escape") return;
						e.preventDefault();
						e.stopPropagation();
						// Typing is over; the mark keeps the keyboard, to be moved
						// on with the arrows.
						self.current?.focus({ preventScroll: true });
						onEdited();
					}}
					onPointerDown={(e) => e.stopPropagation()}
					data-testid="fill-item-text"
				/>
			) : (
				<span
					className={s.itemText}
					style={{ fontSize: fontPx, color: ink }}
					dir="auto"
				>
					{item.text || t("Type here")}
				</span>
			)}
			{selected && (
				<>
					<button
						type="button"
						className={s.itemRemove}
						aria-label={t("Remove")}
						onPointerDown={(e) => e.stopPropagation()}
						onClick={onRemove}
						data-testid="fill-item-remove"
					>
						<Trash2 size={14} />
					</button>
					<span
						className={s.itemSize}
						onPointerDown={start("size")}
						onPointerMove={move}
						onPointerUp={end}
						aria-hidden="true"
						data-testid="fill-item-size"
					/>
				</>
			)}
		</div>
	);
}
