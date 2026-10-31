import { t } from "@/lib/i18n";
import {
	type Signature,
	inkFromPicture,
	keepSignature,
} from "@/lib/signatures";
import { Button, Dialog, toast } from "@/ui";
import { Check, ImageUp, Maximize, Minimize, Redo2, Undo2 } from "lucide-react";
import {
	type CSSProperties,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import s from "./Tools.module.css";
import {
	MAX_WIDTH,
	copyCanvas,
	cut,
	hasInk,
	pickPicture,
	withPixels,
} from "./pictures";

type Way = "draw" | "type" | "photo";
/** A part of a photo: left, top, right, bottom, as fractions of it. */
type Trim = [number, number, number, number];
/** How tall the photo is shown, at most. */
const FRAME_HEIGHT = 220;

/** Faces for a typed signature, as the system has them: no fonts are
 * downloaded. The last of each list is there everywhere. */
const HANDS = [
	'"Segoe Script", "Snell Roundhand", "Brush Script MT", "URW Chancery L", cursive',
	'"Lucida Handwriting", "Apple Chancery", "Comic Sans MS", cursive',
	'Georgia, "Noto Serif", "Times New Roman", serif',
];
const INKS = ["#111111", "#1a3c8c"];
/** Pixels per CSS pixel the pad draws at, for a sharp signature. */
const DENSITY = 2;

type Stroke = { points: Array<[number, number]>; width: number };
type View = { scale: number; x: number; y: number };

/** Draw from the original points, so previews and exports keep the same ink. */
function paint(
	canvas: HTMLCanvasElement,
	strokes: Stroke[],
	ink: string,
	view: View,
) {
	const ctx = canvas.getContext("2d");
	if (!ctx) return;
	ctx.clearRect(0, 0, canvas.width, canvas.height);
	ctx.strokeStyle = ink;
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	for (const { points: line, width } of strokes) {
		ctx.lineWidth = width * view.scale;
		const at = (i: number) =>
			[
				line[i][0] * view.scale + view.x,
				line[i][1] * view.scale + view.y,
			] as const;
		ctx.beginPath();
		const [x0, y0] = at(0);
		ctx.moveTo(x0, y0);
		if (line.length === 1) ctx.lineTo(x0 + 0.01 * view.scale, y0);
		for (let i = 1; i < line.length - 1; i++) {
			const [x, y] = at(i);
			const [nx, ny] = at(i + 1);
			ctx.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2);
		}
		if (line.length > 1) {
			const [x, y] = at(line.length - 1);
			ctx.lineTo(x, y);
		}
		ctx.stroke();
	}
}

/**
 * Make a signature: draw it with a finger, a pen or the mouse; type it
 * in a handwriting face; or take it from a photo of one signed on
 * paper, whose paper is made clear. It can be kept on this device for
 * the next form.
 */
export function SignaturePad({
	initials = false,
	onDone,
	onClose,
}: {
	initials?: boolean;
	onDone: (signature: Signature) => void;
	onClose: () => void;
}) {
	const [way, setWay] = useState<Way>("draw");
	const [ink, setInk] = useState(INKS[0]);
	const [penWidth, setPenWidth] = useState(2.6);
	const [typed, setTyped] = useState("");
	const [hand, setHand] = useState(0);
	const [keep, setKeep] = useState(true);
	const [drawn, setDrawn] = useState(false);
	const [canRedo, setCanRedo] = useState(false);
	const [fullScreen, setFullScreen] = useState(false);
	// The picture as it was picked, the part of it kept, how dark its ink
	// reads, and what that makes.
	const [raw, setRaw] = useState<HTMLCanvasElement | null>(null);
	const [trim, setTrim] = useState<Trim | null>(null);
	const [depth, setDepth] = useState(0);
	const [photo, setPhoto] = useState<HTMLCanvasElement | null>(null);
	useEffect(() => {
		if (!raw) {
			setPhoto(null);
			return;
		}
		const [x0, y0, x1, y1] = trim ?? [0, 0, 1, 1];
		const out = document.createElement("canvas");
		out.width = Math.max(1, Math.round((x1 - x0) * raw.width));
		out.height = Math.max(1, Math.round((y1 - y0) * raw.height));
		out
			.getContext("2d", { willReadFrequently: true })
			?.drawImage(raw, -x0 * raw.width, -y0 * raw.height);
		withPixels(out, (data) => inkFromPicture(data, depth));
		setPhoto(hasInk(out) ? out : null);
	}, [raw, trim, depth]);
	const pad = useRef<HTMLCanvasElement>(null);
	const strokes = useRef<Stroke[]>([]);
	const undone = useRef<Stroke[]>([]);
	const activePointer = useRef<number | null>(null);
	const baseSize = useRef<{ w: number; h: number } | null>(null);
	const view = useRef({ scale: 1, x: 0, y: 0 });
	const expandButton = useRef<HTMLButtonElement>(null);
	const finishDrawing = () => {
		setFullScreen(false);
		requestAnimationFrame(() => expandButton.current?.focus());
	};

	// The pad draws at a density of its own, whatever its size on screen.
	// biome-ignore lint/correctness/useExhaustiveDependencies: redrawn when the ink changes
	useEffect(() => {
		const canvas = pad.current;
		if (!canvas || way !== "draw") return;
		const fit = () => {
			const box = canvas.getBoundingClientRect();
			if (!box.width || !box.height) return;
			baseSize.current ??= { w: box.width, h: box.height };
			// Fit a stable drawing plane uniformly. Points outside its original
			// bounds (drawn on the expanded pad) also fit when returning to it.
			let left = 0;
			let top = 0;
			let right = baseSize.current.w;
			let bottom = baseSize.current.h;
			for (const line of [...strokes.current, ...undone.current]) {
				const margin = line.width / 2 + 2;
				for (const [x, y] of line.points) {
					left = Math.min(left, x - margin);
					top = Math.min(top, y - margin);
					right = Math.max(right, x + margin);
					bottom = Math.max(bottom, y + margin);
				}
			}
			const scale = Math.min(
				box.width / (right - left),
				box.height / (bottom - top),
			);
			view.current = {
				scale,
				x: (box.width - (right - left) * scale) / 2 - left * scale,
				y: (box.height - (bottom - top) * scale) / 2 - top * scale,
			};
			canvas.width = Math.round(box.width * DENSITY);
			canvas.height = Math.round(box.height * DENSITY);
			redraw();
		};
		fit();
		const ro = new ResizeObserver(fit);
		ro.observe(canvas);
		return () => ro.disconnect();
	}, [way, ink]);

	const redraw = () => {
		const canvas = pad.current;
		if (canvas)
			paint(canvas, strokes.current, ink, {
				scale: view.current.scale * DENSITY,
				x: view.current.x * DENSITY,
				y: view.current.y * DENSITY,
			});
	};

	const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
		const box = e.currentTarget.getBoundingClientRect();
		return [
			(Math.max(0, Math.min(box.width, e.clientX - box.left)) -
				view.current.x) /
				view.current.scale,
			(Math.max(0, Math.min(box.height, e.clientY - box.top)) -
				view.current.y) /
				view.current.scale,
		] as [number, number];
	};

	const fromPhoto = async () => {
		let canvas: HTMLCanvasElement | null;
		try {
			canvas = await pickPicture();
		} catch {
			toast(t("That picture couldn't be read"));
			return;
		}
		if (!canvas) return;
		// A PNG with a clear background is used as it is; a photo of
		// paper has its paper made clear.
		const trial = copyCanvas(canvas);
		withPixels(trial, inkFromPicture);
		if (!hasInk(trial)) {
			toast(t("No signature was found in that picture"));
			return;
		}
		setTrim(null);
		setDepth(0);
		setRaw(canvas);
	};

	/** The signature as made, drawn on a canvas of its own. */
	const made = (): HTMLCanvasElement | null => {
		if (way === "draw") {
			if (!drawn) return null;
			let left = Number.POSITIVE_INFINITY;
			let top = Number.POSITIVE_INFINITY;
			let right = Number.NEGATIVE_INFINITY;
			let bottom = Number.NEGATIVE_INFINITY;
			for (const { points, width } of strokes.current) {
				for (const [x, y] of points) {
					left = Math.min(left, x - width);
					top = Math.min(top, y - width);
					right = Math.max(right, x + width);
					bottom = Math.max(bottom, y + width);
				}
			}
			// Render the original strokes at export resolution, never enlarge
			// a small preview bitmap. Bound both dimensions for tall initials.
			const scale = MAX_WIDTH / Math.max(right - left, bottom - top);
			const canvas = document.createElement("canvas");
			canvas.width = Math.max(1, Math.ceil((right - left) * scale));
			canvas.height = Math.max(1, Math.ceil((bottom - top) * scale));
			paint(canvas, strokes.current, ink, {
				scale,
				x: -left * scale,
				y: -top * scale,
			});
			return canvas;
		}
		if (way === "photo") return photo;
		if (!typed.trim()) return null;
		const canvas = document.createElement("canvas");
		const size = 120;
		const ctx = canvas.getContext("2d");
		if (!ctx) return null;
		const font = `${hand === 2 ? "italic " : ""}${size}px ${HANDS[hand]}`;
		ctx.font = font;
		canvas.width = Math.ceil(ctx.measureText(typed).width + size);
		canvas.height = Math.ceil(size * 1.8);
		ctx.font = font;
		ctx.fillStyle = ink;
		ctx.textBaseline = "middle";
		ctx.fillText(typed, size / 2, canvas.height / 2);
		return canvas;
	};

	const done = async () => {
		const canvas = made();
		const picture = canvas ? cut(canvas) : null;
		if (!picture) {
			toast(t("No signature was found in that picture"));
			return;
		}
		const signature = { ...picture, initials: initials || undefined };
		if (keep) await keepSignature(signature);
		onDone(signature);
	};
	const ready =
		way === "draw" ? drawn : way === "photo" ? !!photo : !!typed.trim();

	return (
		<Dialog
			open
			wide
			title={initials ? t("Your initials") : t("Your signature")}
			onClose={fullScreen ? finishDrawing : onClose}
			fullScreen={fullScreen}
			testId="signature-pad"
			actions={
				fullScreen ? (
					<Button
						onClick={finishDrawing}
						data-testid="signature-fullscreen-done"
					>
						<Check size={18} /> {t("Done")}
					</Button>
				) : (
					<>
						<Button variant="ghost" onClick={onClose}>
							{t("Cancel")}
						</Button>
						<Button
							onClick={done}
							disabled={!ready}
							data-testid="signature-done"
						>
							{t("Use it")}
						</Button>
					</>
				)
			}
		>
			{!fullScreen && (
				<div
					className={s.ways}
					role="tablist"
					style={
						{
							"--n": 3,
							"--i": ["draw", "type", "photo"].indexOf(way),
						} as CSSProperties
					}
				>
					{(
						[
							["draw", t("Draw")],
							["type", t("Type")],
							["photo", t("Upload")],
						] as const
					).map(([value, label]) => (
						<button
							key={value}
							type="button"
							role="tab"
							aria-selected={way === value}
							className={s.way}
							onClick={() => setWay(value)}
							data-testid={`signature-${value}`}
						>
							{label}
						</button>
					))}
				</div>
			)}

			{way === "draw" && (
				<div className={`${s.padBox} ${fullScreen ? s.expandedPad : ""}`}>
					<div className={s.padHeading}>
						<div className={s.inkChoices}>
							{INKS.map((colour) => (
								<button
									key={colour}
									type="button"
									className={s.inkDot}
									aria-pressed={ink === colour}
									aria-label={
										colour === INKS[0] ? t("Black ink") : t("Blue ink")
									}
									onClick={() => setInk(colour)}
								>
									<span style={{ background: colour }} aria-hidden="true">
										{ink === colour && <Check size={14} strokeWidth={2.5} />}
									</span>
								</button>
							))}
						</div>
						<button
							ref={expandButton}
							type="button"
							className={s.expandPad}
							onClick={() =>
								fullScreen ? finishDrawing() : setFullScreen(true)
							}
							data-testid="signature-fullscreen"
							aria-expanded={fullScreen}
						>
							{fullScreen ? <Minimize size={16} /> : <Maximize size={16} />}
							{fullScreen ? t("Exit full screen") : t("Full screen")}
						</button>
					</div>
					<fieldset className={s.penWidths}>
						<legend className="visually-hidden">{t("Pen thickness")}</legend>
						<span className={s.penLabel} aria-hidden="true">
							{t("Pen thickness")}
						</span>
						{[
							{ width: 1.4, label: t("Thin pen") },
							{ width: 2.6, label: t("Medium pen") },
							{ width: 4.5, label: t("Thick pen") },
						].map(({ width, label }) => (
							<button
								key={width}
								type="button"
								className={s.penWidth}
								aria-label={label}
								title={label}
								aria-pressed={penWidth === width}
								onClick={() => setPenWidth(width)}
							>
								<span style={{ height: width }} aria-hidden="true" />
							</button>
						))}
					</fieldset>
					<div className={s.padSurface}>
						<canvas
							ref={pad}
							className={s.pad}
							aria-label={t("Sign here")}
							onPointerDown={(e) => {
								if (activePointer.current !== null || e.button !== 0) return;
								activePointer.current = e.pointerId;
								e.currentTarget.setPointerCapture(e.pointerId);
								undone.current = [];
								setCanRedo(false);
								strokes.current.push({
									points: [point(e)],
									// Width lives in the same drawing plane as the points:
									// expanding the pad must not make new strokes thinner.
									width: penWidth,
								});
								setDrawn(true);
								redraw();
							}}
							onPointerMove={(e) => {
								if (activePointer.current !== e.pointerId) return;
								strokes.current[strokes.current.length - 1]?.points.push(
									point(e),
								);
								redraw();
							}}
							onLostPointerCapture={(e) => {
								if (activePointer.current === e.pointerId)
									activePointer.current = null;
							}}
							data-testid="signature-canvas"
						/>
						<span className={s.padLine} aria-hidden="true" />
					</div>
					<div className={s.padTools}>
						<Button
							variant="ghost"
							disabled={!drawn}
							onClick={() => {
								const line = strokes.current.pop();
								if (line) undone.current.push(line);
								setCanRedo(undone.current.length > 0);
								setDrawn(strokes.current.length > 0);
								redraw();
							}}
							data-testid="signature-undo"
						>
							<Undo2 size={16} /> {t("Undo")}
						</Button>
						<Button
							variant="ghost"
							disabled={!canRedo}
							data-testid="signature-redo"
							onClick={() => {
								const line = undone.current.pop();
								if (line) strokes.current.push(line);
								setCanRedo(undone.current.length > 0);
								setDrawn(strokes.current.length > 0);
								redraw();
							}}
						>
							<Redo2 size={16} /> {t("Redo")}
						</Button>
						<Button
							variant="ghost"
							disabled={!drawn}
							onClick={() => {
								strokes.current = [];
								undone.current = [];
								setCanRedo(false);
								setDrawn(false);
								redraw();
							}}
							data-testid="signature-clear"
						>
							{t("Clear")}
						</Button>
					</div>
				</div>
			)}

			{way === "type" && (
				<div className={s.typed}>
					<input
						className={s.field}
						value={typed}
						onChange={(e) => setTyped(e.target.value)}
						placeholder={initials ? t("Your initials") : t("Your name")}
						aria-label={initials ? t("Your initials") : t("Your name")}
						autoComplete="name"
						data-testid="signature-name"
					/>
					{HANDS.map((family, i) => (
						<button
							key={family}
							type="button"
							className={s.hand}
							aria-pressed={hand === i}
							style={{
								fontFamily: family,
								fontStyle: i === 2 ? "italic" : undefined,
								color: ink,
							}}
							onClick={() => setHand(i)}
						>
							{typed || (initials ? "A.K." : t("Your name"))}
						</button>
					))}
				</div>
			)}

			{way === "photo" && (
				<div className={s.photo}>
					{raw && <PhotoTrim source={raw} trim={trim} onTrim={setTrim} />}
					{raw && (
						// As tall with a signature or without: the dialog must not
						// move under a finger still dragging on the photo.
						<div className={s.photoResult}>
							{photo ? (
								<img
									className={s.photoPreview}
									src={photo.toDataURL("image/png")}
									alt={t("Your signature")}
									data-testid="signature-preview"
								/>
							) : (
								<p className={s.hint} data-testid="signature-missed">
									{t("No signature was found in that picture")}
								</p>
							)}
						</div>
					)}
					{raw && (
						<label className={s.inkDepth}>
							<span>{t("Lighter")}</span>
							<input
								type="range"
								aria-label={t("How dark the ink reads")}
								min={-1}
								max={1}
								step={0.1}
								value={depth}
								onChange={(e) => setDepth(Number(e.target.value))}
								data-testid="signature-depth"
							/>
							<span>{t("Darker")}</span>
						</label>
					)}
					{!raw && (
						<p className={s.hint}>
							{t(
								"Pick a PNG of your signature, or a photo of it signed on white paper. Paper is made clear.",
							)}
						</p>
					)}
					<Button
						variant="secondary"
						onClick={fromPhoto}
						data-testid="signature-pick"
					>
						<ImageUp size={18} />{" "}
						{raw ? t("Pick another") : t("Pick a picture")}
					</Button>
				</div>
			)}

			{!fullScreen && (
				<label className={s.keep}>
					<input
						type="checkbox"
						checked={keep}
						onChange={(e) => setKeep(e.target.checked)}
						data-testid="signature-keep"
					/>
					{t("Keep it on this device for next time")}
				</label>
			)}
			{!fullScreen && (
				<p className={s.hint}>
					{t(
						"This adds a picture of your signature, not a digital certificate.",
					)}
				</p>
			)}
		</Dialog>
	);
}

/**
 * A photo to drag a box on, to leave out its edges and shadows. Places
 * are fractions of the picture.
 */
function PhotoTrim({
	source,
	trim,
	onTrim,
}: {
	source: HTMLCanvasElement;
	trim: Trim | null;
	onTrim: (trim: Trim | null) => void;
}) {
	const box = useRef<HTMLDivElement>(null);
	const from = useRef<[number, number] | null>(null);
	// The box being dragged: the picture is only worked on once it is let go.
	const [dragging, setDragging] = useState<Trim | null>(null);
	const url = useMemo(() => source.toDataURL("image/jpeg", 0.7), [source]);
	const place = (e: React.PointerEvent): [number, number] => {
		const r = box.current?.getBoundingClientRect();
		if (!r) return [0, 0];
		return [
			Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
			Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
		];
	};
	const [x0, y0, x1, y1] = dragging ?? trim ?? [0, 0, 1, 1];
	const letGo = (keep: boolean) => {
		from.current = null;
		if (keep && dragging) onTrim(dragging);
		setDragging(null);
	};
	return (
		<div className={s.photoTrim}>
			<div
				ref={box}
				className={s.photoFrame}
				style={{
					aspectRatio: `${source.width} / ${source.height}`,
					width: `min(100%, ${(FRAME_HEIGHT * source.width) / source.height}px)`,
				}}
				data-testid="signature-trim"
				onPointerDown={(e) => {
					e.preventDefault();
					from.current = place(e);
					e.currentTarget.setPointerCapture(e.pointerId);
				}}
				onPointerMove={(e) => {
					const start = from.current;
					if (!start) return;
					const [x, y] = place(e);
					const wide = Math.abs(x - start[0]) > 0.02;
					const tall = Math.abs(y - start[1]) > 0.02;
					if (wide && tall)
						setDragging([
							Math.min(x, start[0]),
							Math.min(y, start[1]),
							Math.max(x, start[0]),
							Math.max(y, start[1]),
						]);
				}}
				onPointerUp={() => letGo(true)}
				onPointerCancel={() => letGo(false)}
			>
				<img src={url} alt="" draggable={false} />
				<span
					className={s.photoKeep}
					style={{
						left: `${x0 * 100}%`,
						top: `${y0 * 100}%`,
						width: `${(x1 - x0) * 100}%`,
						height: `${(y1 - y0) * 100}%`,
					}}
				/>
			</div>
			<p className={s.hint}>
				{t("Drag around your signature to leave out the rest.")}
			</p>
		</div>
	);
}
