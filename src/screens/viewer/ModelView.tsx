import { isDesktop } from "@/lib/env";
import { explainFailure } from "@/lib/errors";
import { fitWhenSettled } from "@/lib/fullscreen";
import { type GlbRefusal, readGlb } from "@/lib/glb";
import { formatNumber, t } from "@/lib/i18n";
import { matches } from "@/lib/shortcuts";
import {
	Button,
	ErrorArt,
	IconButton,
	Spinner,
	StateView,
	modalOpen,
} from "@/ui";
import { Pause, Play, Rotate3d } from "lucide-react";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import s from "./Model.module.css";
import { Shell, ZoomControl } from "./Shell";
import { ModelFailure, type ModelScene, openModel } from "./modelScene";
import { PaneContext, onShow } from "./pane";
import type { ViewerProps } from "./types";

/** An arrow key turns the model this far (radians), 12 degrees. */
const TURN = 0.21;
const ZOOM_STEP = 1.25;

/** A tap this short and this still is a tap, not a turn. */
const TAP_MS = 400;
const TAP_PX = 10;

function refusal(reason: GlbRefusal): string {
	switch (reason) {
		case "version":
			return t(
				"This is an older kind of binary glTF. Paperwren shows glTF 2.0 models.",
			);
		case "compressed":
			return t(
				"This model is squeezed with Draco, meshopt or KTX2, which Paperwren can't unpack. Open it in another app from the menu.",
			);
		case "external":
			return t(
				"This model keeps parts of itself in other files or on the web. Paperwren shows .glb files that hold everything inside them, and it never fetches anything.",
			);
		case "tooLarge":
			return t("This model is too large for Paperwren to show.");
		default:
			return t(
				"The file is damaged or isn't a binary glTF (.glb) model Paperwren shows.",
			);
	}
}

/** 3D models: a binary glTF (.glb), drawn with WebGL. Turned with a
 * finger or the mouse, zoomed by pinching or the wheel, moved with two
 * fingers or the right button; animations play and pause. */
export default function ModelView({
	data,
	name,
	format,
	onClose,
	active,
}: ViewerProps) {
	const reading = useMemo(() => readGlb(data), [data]);
	const host = useRef<HTMLDivElement>(null);
	const model = useRef<ModelScene | null>(null);
	const [phase, setPhase] = useState<"loading" | "ready" | "webgl" | "damaged">(
		"loading",
	);
	const [fault, setFault] = useState<unknown>(null);
	const [lost, setLost] = useState(false);
	const [animated, setAnimated] = useState(false);
	// Motion starts only for a reader who has not asked for less of it.
	const [playing, setPlaying] = useState(
		() => !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
	);
	const [zoom, setZoom] = useState(100);
	const [chromeHidden, setChromeHidden] = useState(false);

	// A tab behind another keeps its model, and draws nothing.
	const pane = useContext(PaneContext);
	const shown = onShow(active, pane);
	const shownRef = useRef(shown);
	shownRef.current = shown;
	const playingRef = useRef(playing);
	playingRef.current = playing;

	const ok = reading.ok;
	useEffect(() => {
		const box = host.current;
		if (!box || !ok) return;
		// A fresh canvas for each scene: one whose context was given up
		// cannot be drawn on again.
		const canvas = document.createElement("canvas");
		canvas.className = s.canvas;
		canvas.setAttribute("aria-hidden", "true");
		canvas.dataset.testid = "model-canvas";
		box.appendChild(canvas);
		let alive = true;
		let made: ModelScene | null = null;
		setPhase("loading");
		setFault(null);
		setLost(false);
		openModel(canvas, box, data, { onZoom: setZoom, onLost: setLost })
			.then((scene) => {
				if (!alive) return scene.dispose();
				made = model.current = scene;
				scene.setShown(shownRef.current);
				scene.setPlaying(playingRef.current && scene.animated);
				setAnimated(scene.animated);
				setPhase("ready");
			})
			.catch((err) => {
				if (!alive) return;
				setFault(err);
				setPhase(
					err instanceof ModelFailure && err.reason === "webgl"
						? "webgl"
						: "damaged",
				);
			});
		const fit = fitWhenSettled(() => model.current?.resize());
		const watch = new ResizeObserver(fit.run);
		watch.observe(box);
		return () => {
			alive = false;
			watch.disconnect();
			fit.stop();
			made?.dispose();
			model.current = null;
			canvas.remove();
		};
	}, [data, ok]);

	useEffect(() => {
		if (phase === "ready") model.current?.setShown(shown);
	}, [shown, phase]);
	useEffect(() => {
		if (phase === "ready") model.current?.setPlaying(playing && animated);
	}, [playing, animated, phase]);

	// A tap on a phone shows or hides the bars; a drag turns the model.
	useEffect(() => {
		const box = host.current;
		if (!box || isDesktop || !ok) return;
		const pointers = new Set<number>();
		let start: { x: number; y: number; at: number } | null = null;
		let several = false;
		const onDown = (e: PointerEvent) => {
			pointers.add(e.pointerId);
			if (pointers.size > 1) several = true;
			start = several ? null : { x: e.clientX, y: e.clientY, at: e.timeStamp };
		};
		const onUp = (e: PointerEvent) => {
			pointers.delete(e.pointerId);
			const from = start;
			start = null;
			const tapped =
				from &&
				!several &&
				e.type === "pointerup" &&
				e.timeStamp - from.at < TAP_MS &&
				Math.hypot(e.clientX - from.x, e.clientY - from.y) < TAP_PX;
			if (!pointers.size) several = false;
			if (tapped) setChromeHidden((hidden) => !hidden);
		};
		box.addEventListener("pointerdown", onDown);
		box.addEventListener("pointerup", onUp);
		box.addEventListener("pointercancel", onUp);
		return () => {
			box.removeEventListener("pointerdown", onDown);
			box.removeEventListener("pointerup", onUp);
			box.removeEventListener("pointercancel", onUp);
		};
	}, [ok]);

	// The keyboard: arrows turn, + and - zoom, 0 or Home go back to the
	// first view.
	useEffect(() => {
		if (!active || phase !== "ready") return;
		const onKey = (e: KeyboardEvent) => {
			if (e.defaultPrevented || modalOpen()) return;
			const at = document.activeElement;
			if (at instanceof HTMLElement && at.matches("input, textarea, select"))
				return;
			const scene = model.current;
			if (!scene) return;
			const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
			if (matches(e, "zoomIn") || (plain && (e.key === "+" || e.key === "=")))
				scene.zoom(ZOOM_STEP);
			else if (
				matches(e, "zoomOut") ||
				(plain && (e.key === "-" || e.key === "_"))
			)
				scene.zoom(1 / ZOOM_STEP);
			else if (
				matches(e, "zoomReset") ||
				(plain && (e.key === "0" || e.key === "Home"))
			)
				scene.reset();
			else if (plain && e.key === "ArrowLeft") scene.turn(-TURN, 0);
			else if (plain && e.key === "ArrowRight") scene.turn(TURN, 0);
			else if (plain && e.key === "ArrowUp") scene.turn(0, -TURN);
			else if (plain && e.key === "ArrowDown") scene.turn(0, TURN);
			else return;
			e.preventDefault();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [active, phase]);

	const details = useMemo<Array<[string, string]>>(
		() =>
			reading.ok
				? [
						[t("Triangles"), formatNumber(reading.facts.triangles)],
						[t("Vertices"), formatNumber(reading.facts.vertices)],
						...(reading.facts.animations
							? ([
									[t("Animations"), formatNumber(reading.facts.animations)],
								] as Array<[string, string]>)
							: []),
					]
				: [],
		[reading],
	);

	const failed = !reading.ok || phase === "webgl" || phase === "damaged";
	const ready = phase === "ready" && !failed;
	const label = zoom === 100 ? t("Fit") : `${zoom}%`;
	const resetView = () => model.current?.reset();

	return (
		<Shell
			name={name}
			format={format}
			onClose={onClose}
			active={active}
			chromeHidden={chromeHidden}
			details={details}
			actions={
				ready && (
					<>
						{animated && (
							<IconButton
								label={playing ? t("Pause animation") : t("Play animation")}
								onClick={() => setPlaying((on) => !on)}
								data-testid="model-play"
								data-playing={playing ? "" : undefined}
							>
								{playing ? <Pause size={18} /> : <Play size={18} />}
							</IconButton>
						)}
						<IconButton
							label={t("Reset view")}
							shortcut="0"
							onClick={resetView}
							data-testid="model-reset"
						>
							<Rotate3d size={18} />
						</IconButton>
					</>
				)
			}
			pager={
				ready ? (
					<ZoomControl
						label={label}
						onOut={() => model.current?.zoom(1 / ZOOM_STEP)}
						onIn={() => model.current?.zoom(ZOOM_STEP)}
						onReset={resetView}
						resetLabel={t("Reset view")}
						testId="model"
					/>
				) : undefined
			}
		>
			{reading.ok && !failed && (
				<div
					ref={host}
					className={s.stage}
					role="img"
					aria-label={t(
						"3D model: {name}. Drag to turn it, pinch or scroll to zoom.",
						{ name },
					)}
					data-testid="model-stage"
					data-phase={phase}
				/>
			)}
			{phase === "loading" && reading.ok && (
				<StateView>
					<Spinner label={t("Opening")} />
				</StateView>
			)}
			{lost && !failed && (
				<StateView testId="model-lost">
					{t(
						"The device took back the 3D view. It will return in a moment, or close the model and open it again.",
					)}
				</StateView>
			)}
			{failed && (
				<StateView
					icon={<ErrorArt />}
					title={t("Can't show this model")}
					action={<Button onClick={onClose}>{t("Close")}</Button>}
					testId="model-error"
				>
					{!reading.ok
						? refusal(reading.reason)
						: phase === "webgl"
							? t(
									"This device can't draw 3D graphics (WebGL), so the model can't be shown.",
								)
							: explainFailure(fault, refusal("notGlb"))}
				</StateView>
			)}
		</Shell>
	);
}
