import { locale, msg, t } from "@/lib/i18n";
import {
	type Signature,
	clearShare,
	inkFromPaper,
	keepStamp,
} from "@/lib/signatures";
import { Button, Dialog, toast } from "@/ui";
import { Check, ImageUp } from "lucide-react";
import { type CSSProperties, useMemo, useState } from "react";
import s from "./Tools.module.css";
import { copyCanvas, cut, hasInk, pickPicture, withPixels } from "./pictures";

type Way = "make" | "upload";
type Shape = "box" | "round";

const INKS: Array<[colour: string, label: string]> = [
	["#c62828", msg("Red ink")],
	["#1a3c8c", msg("Blue ink")],
	["#2e7d32", msg("Green ink")],
	["#111111", msg("Black ink")],
];
const FACE = '"Helvetica Neue", Helvetica, Arial, "Noto Sans", sans-serif';

/**
 * A stamp, drawn the way a rubber one prints: bold words in a double
 * frame, square or round, with the date under them if asked for.
 */
export function drawStamp(
	words: string,
	date: string | null,
	ink: string,
	shape: Shape,
): HTMLCanvasElement {
	const canvas = document.createElement("canvas");
	const ctx = canvas.getContext("2d");
	const text = words.trim().toLocaleUpperCase(locale());
	if (!ctx || !text) return canvas;
	const size = 96;
	const small = 40;
	const main = `800 ${size}px ${FACE}`;
	const sub = `700 ${small}px ${FACE}`;
	ctx.font = main;
	const textW = ctx.measureText(text).width;
	ctx.font = sub;
	const dateW = date ? ctx.measureText(date).width : 0;
	const inner = Math.max(textW, dateW);
	const lines = size * 1.05 + (date ? small * 1.5 : 0);

	if (shape === "box") {
		canvas.width = Math.ceil(inner + 120);
		canvas.height = Math.ceil(lines + 110);
	} else {
		const d = Math.ceil(Math.max(420, Math.hypot(inner, lines) + 120));
		canvas.width = d;
		canvas.height = d;
	}
	const w = canvas.width;
	const h = canvas.height;
	ctx.globalAlpha = 0.92;
	ctx.strokeStyle = ink;
	ctx.fillStyle = ink;
	if (shape === "box") {
		ctx.lineWidth = 10;
		roundRect(ctx, 8, 8, w - 16, h - 16, 22);
		ctx.stroke();
		ctx.lineWidth = 3;
		roundRect(ctx, 24, 24, w - 48, h - 48, 12);
		ctx.stroke();
	} else {
		ctx.lineWidth = 10;
		ctx.beginPath();
		ctx.arc(w / 2, h / 2, w / 2 - 8, 0, Math.PI * 2);
		ctx.stroke();
		ctx.lineWidth = 3;
		ctx.beginPath();
		ctx.arc(w / 2, h / 2, w / 2 - 26, 0, Math.PI * 2);
		ctx.stroke();
	}
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.direction = "inherit";
	const top = h / 2 - lines / 2;
	// A long word in a round stamp is narrowed to sit inside the ring.
	const room = shape === "round" ? w - 120 : w;
	ctx.font = main;
	ctx.fillText(text, w / 2, top + (size * 1.05) / 2, room);
	if (date) {
		ctx.font = sub;
		ctx.fillText(date, w / 2, top + size * 1.05 + (small * 1.5) / 2, room);
	}
	return canvas;
}

function roundRect(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	r: number,
) {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + w, y, x + w, y + h, r);
	ctx.arcTo(x + w, y + h, x, y + h, r);
	ctx.arcTo(x, y + h, x, y, r);
	ctx.arcTo(x, y, x + w, y, r);
	ctx.closePath();
}

/**
 * Make a stamp: words in a frame, in a colour, square or round, with the
 * date if wanted; or a picture of one (a PNG with a clear background, or
 * a scan whose white paper is made clear). It can be kept on this device.
 */
export function StampPad({
	onDone,
	onClose,
}: {
	onDone: (stamp: Signature) => void;
	onClose: () => void;
}) {
	const [way, setWay] = useState<Way>("make");
	const [words, setWords] = useState("");
	const [ink, setInk] = useState(INKS[0][0]);
	const [shape, setShape] = useState<Shape>("box");
	const [withDate, setWithDate] = useState(false);
	const [source, setSource] = useState<HTMLCanvasElement | null>(null);
	const [clearPaper, setClearPaper] = useState(true);
	const [keep, setKeep] = useState(true);

	const presets = [t("APPROVED"), t("PAID"), t("RECEIVED"), t("CONFIDENTIAL")];
	const date = withDate
		? new Date().toLocaleDateString(locale(), { dateStyle: "medium" })
		: null;
	const made = useMemo(
		() => (words.trim() ? drawStamp(words, date, ink, shape) : null),
		[words, date, ink, shape],
	);
	// A picture with no clear background is a scan or a photo: its white
	// paper is made clear unless the reader wants it kept.
	const opaque = useMemo(() => !!source && opaqueCanvas(source), [source]);
	const picture = useMemo(() => {
		if (!source) return null;
		const copy = copyCanvas(source);
		return opaque && clearPaper ? withPixels(copy, inkFromPaper) : copy;
	}, [source, opaque, clearPaper]);
	const shown = way === "make" ? made : picture;
	const preview = useMemo(() => shown?.toDataURL("image/png") ?? null, [shown]);

	const upload = async () => {
		let canvas: HTMLCanvasElement | null;
		try {
			canvas = await pickPicture();
		} catch {
			toast(t("That picture couldn't be read"));
			return;
		}
		if (!canvas) return;
		if (!hasInk(canvas)) {
			toast(t("No stamp was found in that picture"));
			return;
		}
		setClearPaper(true);
		setSource(canvas);
	};

	const done = async () => {
		const stamp = shown ? cut(shown) : null;
		if (!stamp) {
			toast(t("No stamp was found in that picture"));
			return;
		}
		if (keep) await keepStamp(stamp);
		onDone(stamp);
	};

	return (
		<Dialog
			open
			wide
			title={t("Your stamp")}
			onClose={onClose}
			testId="stamp-pad"
			actions={
				<>
					<Button variant="ghost" onClick={onClose}>
						{t("Cancel")}
					</Button>
					<Button onClick={done} disabled={!shown} data-testid="stamp-done">
						{t("Use it")}
					</Button>
				</>
			}
		>
			<div
				className={s.ways}
				role="tablist"
				style={{ "--n": 2, "--i": way === "make" ? 0 : 1 } as CSSProperties}
			>
				{(
					[
						["make", t("Make")],
						["upload", t("Upload")],
					] as const
				).map(([value, label]) => (
					<button
						key={value}
						type="button"
						role="tab"
						aria-selected={way === value}
						className={s.way}
						onClick={() => setWay(value)}
						data-testid={`stamp-${value}`}
					>
						{label}
					</button>
				))}
			</div>

			<div className={s.stampStage} data-empty={!preview || undefined}>
				{preview ? (
					<img
						key={preview}
						className={s.stampPreview}
						src={preview}
						alt={t("Stamp")}
						data-testid="stamp-preview"
					/>
				) : (
					<p className={s.hint}>
						{way === "make"
							? t("Type the stamp's words, or pick one below.")
							: t("Pick a PNG of your stamp, or a photo of it on white paper.")}
					</p>
				)}
			</div>

			{way === "make" ? (
				<div className={s.stampMake}>
					<input
						className={s.field}
						value={words}
						maxLength={40}
						onChange={(e) => setWords(e.target.value)}
						placeholder={t("Stamp text")}
						aria-label={t("Stamp text")}
						dir="auto"
						data-testid="stamp-text"
					/>
					<div className={s.presets}>
						{presets.map((word) => (
							<button
								key={word}
								type="button"
								className={s.preset}
								aria-pressed={words === word}
								onClick={() => setWords(word)}
							>
								{word}
							</button>
						))}
					</div>
					<div className={s.stampOptions}>
						<div className={s.inkChoices}>
							{INKS.map(([colour, label]) => (
								<button
									key={colour}
									type="button"
									className={s.inkDot}
									aria-pressed={ink === colour}
									aria-label={t(label)}
									title={t(label)}
									onClick={() => setInk(colour)}
								>
									<span style={{ background: colour }} aria-hidden="true">
										{ink === colour && <Check size={14} strokeWidth={2.5} />}
									</span>
								</button>
							))}
						</div>
						<fieldset className={s.shapes}>
							<legend className="visually-hidden">{t("Shape")}</legend>
							{(
								[
									["box", t("Box")],
									["round", t("Round")],
								] as const
							).map(([value, label]) => (
								<button
									key={value}
									type="button"
									aria-pressed={shape === value}
									className={s.shape}
									onClick={() => setShape(value)}
									data-testid={`stamp-shape-${value}`}
								>
									<span className={s.shapeMark} data-shape={value} />
									{label}
								</button>
							))}
						</fieldset>
					</div>
					<label className={s.keep}>
						<input
							type="checkbox"
							checked={withDate}
							onChange={(e) => setWithDate(e.target.checked)}
							data-testid="stamp-date"
						/>
						{t("Add today's date")}
					</label>
				</div>
			) : (
				<div className={s.photo}>
					{opaque && (
						<label className={s.keep}>
							<input
								type="checkbox"
								checked={clearPaper}
								onChange={(e) => setClearPaper(e.target.checked)}
								data-testid="stamp-clear"
							/>
							{t("Make the white background clear")}
						</label>
					)}
					<Button variant="secondary" onClick={upload} data-testid="stamp-pick">
						<ImageUp size={18} />{" "}
						{source ? t("Pick another") : t("Pick a picture")}
					</Button>
				</div>
			)}

			<label className={s.keep}>
				<input
					type="checkbox"
					checked={keep}
					onChange={(e) => setKeep(e.target.checked)}
					data-testid="stamp-keep"
				/>
				{t("Keep it on this device for next time")}
			</label>
		</Dialog>
	);
}

/** Whether a canvas has no clear background (a scan or a photo). */
function opaqueCanvas(canvas: HTMLCanvasElement): boolean {
	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	if (!ctx) return false;
	return (
		clearShare(ctx.getImageData(0, 0, canvas.width, canvas.height).data) < 0.01
	);
}
