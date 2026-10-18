import { type SavedFile, backend } from "@/lib/backend";
import { copyName } from "@/lib/fileName";
import { locale, t } from "@/lib/i18n";
import {
	type FieldValue,
	type Mark,
	ToolError,
	fillAndSign,
	standardText,
} from "@/lib/pdfTools";
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
	SheetItem,
	Spinner,
	toast,
} from "@/ui";
import { useModalFocus } from "@/ui/Overlay";
import {
	ArrowLeft,
	CalendarDays,
	Check,
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
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { SignaturePad } from "./SignaturePad";
import { StampPad } from "./StampPad";
import s from "./Tools.module.css";

type Tool = "sign" | "initials" | "stamp" | "text" | "date" | "check" | "cross";
/** What is put on a page as a picture the reader made or picked. */
type Kept = "sign" | "initials" | "stamp";

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
	initial: string | boolean;
}

/** Something the reader put on a page. */
interface Item extends Box {
	id: string;
	kind: Tool;
	/** A signature's or a stamp's picture. */
	src?: string;
	text?: string;
}

const INK = "#1a3c8c";
/** The height of a line of text placed on a page, as a share of the
 * page's height (about 12 points on A4). */
const LINE = 0.021;
const ZOOMS = [1, 1.5, 2, 3];

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
}

/** The fields of every page, placed as shown. */
async function readFields(doc: PDFDocumentProxy): Promise<Field[]> {
	const out: Field[] = [];
	for (let n = 1; n <= doc.numPages && out.length < 2000; n++) {
		const page = await doc.getPage(n);
		const view = page.getViewport({ scale: 1 });
		const widgets = (await page.getAnnotations({
			intent: "display",
		})) as Widget[];
		for (const w of widgets) {
			// Fields the file locks, or hides, are shown as it drew them.
			if (
				w.subtype !== "Widget" ||
				!w.fieldName ||
				w.hidden ||
				w.pushButton ||
				w.readOnly
			)
				continue;
			const [a, b, c, d] = view.convertToViewportRectangle(w.rect);
			const box = {
				page: n - 1,
				x: Math.min(a, c) / view.width,
				y: Math.min(b, d) / view.height,
				w: Math.abs(c - a) / view.width,
				h: Math.abs(d - b) / view.height,
			};
			if (box.w <= 0 || box.h <= 0) continue;
			const base = { ...box, name: w.fieldName };
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
		}
	}
	return out;
}

/** A picture of a mark the PDF's standard font cannot write (a tick,
 * text in another script), drawn at a size that prints sharply. */
async function picture(
	item: Item,
	pageW: number,
	pageH: number,
): Promise<Uint8Array> {
	const scale = 4;
	const w = Math.max(8, Math.round(item.w * pageW * scale));
	const h = Math.max(8, Math.round(item.h * pageH * scale));
	const canvas = document.createElement("canvas");
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("no canvas");
	ctx.strokeStyle = INK;
	ctx.fillStyle = INK;
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
	onClose,
	onSaved,
}: {
	doc: PDFDocumentProxy;
	name: string;
	password?: string;
	/** The file's author allows more than its form to be filled. */
	canMark: boolean;
	onClose: () => void;
	onSaved?: (saved: SavedFile) => void;
}) {
	const [fields, setFields] = useState<Field[] | null>(null);
	const [values, setValues] = useState<Record<string, string | boolean>>({});
	const [items, setItems] = useState<Item[]>([]);
	const [tool, setTool] = useState<Tool | null>(null);
	const [selected, setSelected] = useState<string | null>(null);
	const [editing, setEditing] = useState<string | null>(null);
	const [signatures, setSignatures] = useState<Signature[]>([]);
	const [stamps, setStamps] = useState<Signature[]>([]);
	const [chooser, setChooser] = useState<Kept | null>(null);
	const [padFor, setPadFor] = useState<"sign" | "initials" | null>(null);
	const [stampPad, setStampPad] = useState(false);
	const [chosen, setChosen] = useState<Signature | null>(null);
	const [chosenStamp, setChosenStamp] = useState<Signature | null>(null);
	// A signature field tapped: the signature chosen next goes into it.
	const target = useRef<Field | null>(null);
	const [leaving, setLeaving] = useState(false);
	const [saving, setSaving] = useState<"ask" | "busy" | null>(null);
	const [flatten, setFlatten] = useState(false);
	const [zoom, setZoom] = useState(0);
	const [width, setWidth] = useState(0);
	const [sizes, setSizes] = useState<Array<[number, number]>>([]);
	const scroller = useRef<HTMLDivElement>(null);
	const editor = useRef<HTMLDivElement>(null);

	useEffect(() => {
		let alive = true;
		readFields(doc)
			.then((found) => alive && setFields(found))
			.catch(() => alive && setFields([]));
		// Each page's size as shown, in points, for laying the pages out.
		(async () => {
			const out: Array<[number, number]> = [];
			for (let n = 1; n <= doc.numPages; n++) {
				const view = (await doc.getPage(n)).getViewport({ scale: 1 });
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
	const dirty = items.length > 0 || changedFields.length > 0;

	const close = useCallback(() => {
		if (dirty) setLeaving(true);
		else onClose();
	}, [dirty, onClose]);
	useBackClose("fill-sign", true, close);
	useModalFocus(editor, () => {
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

	const pick = (next: Tool) => {
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
	const signWith = (signature: Signature, kind: "sign" | "initials") => {
		setChosen(signature);
		setChooser(null);
		setPadFor(null);
		const into = target.current;
		target.current = null;
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
		setTool(null);
		setSelected(null);
		const kept = signatures.filter((sig) => !sig.initials);
		if (kept.length) setChooser("sign");
		else setPadFor("sign");
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
		setItems((list) => [...list, item]);
		setSelected(item.id);
		if (tool === "text") setEditing(item.id);
		// Signing or stamping again is one more tap; the other tools are one
		// at a time.
		if (tool !== "sign" && tool !== "initials" && tool !== "stamp")
			setTool(null);
	};

	const save = async () => {
		setSaving("busy");
		try {
			const marks: Mark[] = [];
			for (const item of items) {
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
						color: INK,
					});
				else if (
					item.text?.trim() ||
					item.kind === "check" ||
					item.kind === "cross"
				)
					marks.push({
						...box,
						kind: "image",
						png: await picture(item, pw, ph),
					});
			}
			// pdf.js holds the file's bytes (the ones read were handed to it).
			const bytes = await fillAndSign(await doc.getData(), {
				password,
				fields: changedFields,
				marks,
				flatten,
			});
			const signed = items.some(
				(i) => i.kind === "sign" || i.kind === "initials",
			);
			const saved = await backend.saveFile(
				copyName(name, signed ? t("signed") : t("filled in")),
				bytes,
				"application/pdf",
			);
			if (!saved) {
				setSaving("ask");
				return;
			}
			setSaving(null);
			onSaved?.(saved);
			onClose();
		} catch (err) {
			setSaving("ask");
			toast(
				err instanceof ToolError && err.reason === "password"
					? t("This PDF's password is needed to save a copy")
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
	const pageWidth = Math.max(200, width) * ZOOMS[zoom];

	return createPortal(
		<div
			ref={editor}
			tabIndex={-1}
			className={s.fill}
			// biome-ignore lint/a11y/useSemanticElements: a full-screen surface, not a native dialog
			role="dialog"
			aria-modal="true"
			aria-label={t("Fill & sign")}
			data-testid="fill-sign"
			data-can-mark={canMark || undefined}
		>
			<header className={s.fillBar} data-tauri-drag-region="deep">
				<IconButton label={t("Close")} onClick={close} data-testid="fill-close">
					<ArrowLeft size={22} className="pw-flip" />
				</IconButton>
				<div className={s.fillTitle} title={name}>
					<strong>{t("Fill & sign")}</strong>
					<span dir="auto">{name}</span>
				</div>
			</header>
			{canMark && (
				<div
					className={s.toolbar}
					role="toolbar"
					aria-label={t("Add to the page")}
				>
					{tools.map(([kind, label, icon]) => (
						<button
							key={kind}
							type="button"
							className={s.tool}
							title={label}
							aria-pressed={tool === kind}
							onClick={() => pick(kind)}
							data-testid={`fill-tool-${kind}`}
						>
							{icon}
							<span>{label}</span>
						</button>
					))}
				</div>
			)}
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
				<Button
					onClick={() => setSaving("ask")}
					disabled={!dirty || saving === "busy"}
					data-testid="fill-save"
				>
					{t("Save a copy")}
				</Button>
			</div>

			<div className={s.fillHint} data-testid="fill-guidance">
				<Info size={17} aria-hidden="true" />
				<p aria-live="polite" data-testid="fill-hint">
					{tool
						? t("{tool}: select a spot on the page to place it.", {
								tool: tools.find(([kind]) => kind === tool)?.[1] ?? "",
							})
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
				{tool && (
					<button
						type="button"
						className={s.cancelTool}
						onClick={() => setTool(null)}
					>
						{t("Cancel")}
					</button>
				)}
				<p className={s.saveStatus} aria-live="polite">
					{dirty
						? t("Changes ready to save")
						: t("Add your details to get started")}
				</p>
			</div>
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
										canMark && !signedIn(f, items)
											? () => signInto(f)
											: undefined
									}
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
									selected={selected === item.id}
									editing={editing === item.id}
									onSelect={() => {
										setSelected(item.id);
										if (editing !== item.id) setEditing(null);
									}}
									onEdit={() => setEditing(item.id)}
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
					onClose={() => {
						target.current = null;
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
			{saving && (
				<Dialog
					open
					title={t("Save a copy")}
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
								disabled={saving === "busy"}
								data-testid="fill-save-go"
							>
								{saving === "busy" ? t("Saving…") : t("Save")}
							</Button>
						</>
					}
				>
					<p className={s.hint}>
						{t("A new PDF is made; the file you opened stays as it was.")}
					</p>
					{changedFields.length > 0 && (
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
			(i.kind === "sign" || i.kind === "initials") &&
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

/** One page: its picture, drawn once it is near the screen, under the
 * fields and marks laid over it. */
function FillPage({
	doc,
	page,
	width,
	height,
	onTap,
	placing,
	children,
}: {
	doc: PDFDocumentProxy;
	page: number;
	width: number;
	height: number;
	/** A tool is chosen: a tap puts something here. */
	placing: boolean;
	onTap: (u: number, v: number) => void;
	children: React.ReactNode;
}) {
	const box = useRef<HTMLDivElement>(null);
	const canvas = useRef<HTMLCanvasElement>(null);
	const [near, setNear] = useState(false);

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
		if (!near || width < 50) return;
		let alive = true;
		let task: { cancel(): void; promise: Promise<void> } | null = null;
		const timer = window.setTimeout(async () => {
			const proxy = await doc.getPage(page + 1);
			const el = canvas.current;
			const ctx = el?.getContext("2d");
			if (!alive || !el || !ctx) return;
			const density = Math.min(2, window.devicePixelRatio || 1);
			const base = proxy.getViewport({ scale: 1 });
			const viewport = proxy.getViewport({
				scale: (width * density) / base.width,
			});
			el.width = Math.ceil(viewport.width);
			el.height = Math.ceil(viewport.height);
			task = proxy.render({ canvasContext: ctx, viewport });
			await task.promise.catch(() => {});
			if (alive) el.dataset.drawn = "1";
		}, 60);
		return () => {
			alive = false;
			window.clearTimeout(timer);
			task?.cancel();
		};
	}, [doc, page, near, width]);

	return (
		<div
			ref={box}
			className={s.fillPage}
			style={{ width, height }}
			data-testid="fill-page"
			onPointerDown={(e) => {
				if (e.target !== e.currentTarget && e.target !== canvas.current) return;
				// The text placed here takes the keyboard: the tap must not
				// take it back to the page.
				if (placing) e.preventDefault();
				const r = e.currentTarget.getBoundingClientRect();
				onTap((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
			}}
		>
			<canvas ref={canvas} className={s.fillCanvas} />
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
}: {
	field: Field;
	value: string | boolean;
	pageHeight: number;
	onChange: (value: string | boolean) => void;
	onSign?: () => void;
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
	const font = Math.max(8, Math.min(px * 0.62, 18));
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
	pageWidth,
	pageHeight,
	selected,
	editing,
	onSelect,
	onEdit,
	onChange,
	onText,
	onRemove,
}: {
	item: Item;
	pageWidth: number;
	pageHeight: number;
	selected: boolean;
	editing: boolean;
	onSelect: () => void;
	onEdit: () => void;
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
	const input = useRef<HTMLInputElement>(null);
	useEffect(() => {
		if (editing) input.current?.focus();
	}, [editing]);

	const start = (mode: "move" | "size") => (e: React.PointerEvent) => {
		if (editing && mode === "move") return;
		e.stopPropagation();
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
	const end = () => {
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
	return (
		<div
			className={s.item}
			style={at(item)}
			data-selected={selected ? "" : undefined}
			data-kind={item.kind}
			onPointerDown={start("move")}
			onPointerMove={move}
			onPointerUp={end}
			onPointerCancel={end}
			data-testid="fill-item"
		>
			{item.src ? (
				<img
					src={item.src}
					alt={item.kind === "stamp" ? t("Stamp") : t("Your signature")}
					draggable={false}
				/>
			) : item.kind === "check" || item.kind === "cross" ? (
				item.kind === "check" ? (
					<Check width="100%" height="100%" strokeWidth={3} color={INK} />
				) : (
					<X width="100%" height="100%" strokeWidth={3} color={INK} />
				)
			) : editing ? (
				<input
					ref={input}
					className={s.itemInput}
					style={{ fontSize: fontPx }}
					value={item.text ?? ""}
					dir="auto"
					placeholder={t("Type here")}
					onChange={(e) => onText(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
					}}
					onPointerDown={(e) => e.stopPropagation()}
					data-testid="fill-item-text"
				/>
			) : (
				<span className={s.itemText} style={{ fontSize: fontPx }} dir="auto">
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
