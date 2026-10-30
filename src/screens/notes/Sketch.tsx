import { t } from "@/lib/i18n";
import { type NoteStroke, SKETCH_WIDTH } from "@/lib/notes";
import { curve, pushPoint, strokeDistance } from "@/screens/tools/ink";
import { type PointerEvent, useRef, useState } from "react";
import s from "./Notes.module.css";

/** How near the foot a stroke ends before the sheet grows, and by how
 * much, on a sheet SKETCH_WIDTH across. */
const NEAR_FOOT = 140;
const GROW = 320;
/** An eraser's reach, in the same units. */
const REACH = 16;

export interface Pen {
	color: string;
	width: number;
	erase: boolean;
}

/**
 * A sheet to write on in a note. While `drawing`, a finger, stylus or
 * mouse puts ink on it, and two fingers scroll; otherwise it scrolls by
 * like the rest of the note.
 */
export function Sketch({
	strokes,
	height,
	drawing,
	pen,
	onChange,
}: {
	strokes: NoteStroke[];
	height: number;
	drawing: boolean;
	pen: Pen;
	onChange: (strokes: NoteStroke[], height: number) => void;
}) {
	const sheet = useRef<SVGSVGElement>(null);
	const [live, setLive] = useState<NoteStroke | null>(null);
	const stroke = useRef<NoteStroke | null>(null);
	const fingers = useRef(new Map<number, number>());

	const at = (e: { clientX: number; clientY: number }): [number, number] => {
		const r = sheet.current?.getBoundingClientRect();
		if (!r) return [0, 0];
		return [
			Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
			Math.max(0, (e.clientY - r.top) / r.width),
		];
	};

	const eraseAt = ([u, v]: [number, number]) => {
		const kept = strokes.filter(
			(one) =>
				strokeDistance(one.points, u, v, SKETCH_WIDTH, SKETCH_WIDTH) >
				one.width / 2 + REACH,
		);
		if (kept.length !== strokes.length) onChange(kept, height);
	};

	const onDown = (e: PointerEvent<SVGSVGElement>) => {
		if (!drawing || (e.pointerType === "mouse" && e.button !== 0)) return;
		if (e.pointerType === "touch") {
			fingers.current.set(e.pointerId, e.clientY);
			if (fingers.current.size > 1) {
				stroke.current = null;
				setLive(null);
				return;
			}
		}
		e.preventDefault();
		e.currentTarget.setPointerCapture(e.pointerId);
		if (pen.erase) {
			stroke.current = { points: [], color: "", width: 0 };
			eraseAt(at(e));
			return;
		}
		stroke.current = {
			points: [at(e)],
			color: pen.color,
			width: pen.width,
		};
		setLive({ ...stroke.current });
	};

	const onMove = (e: PointerEvent<SVGSVGElement>) => {
		const was = fingers.current.get(e.pointerId);
		if (was !== undefined && fingers.current.size === 2) {
			sheet.current?.closest("main")?.scrollBy(0, (was - e.clientY) / 2);
			fingers.current.set(e.pointerId, e.clientY);
			return;
		}
		const now = stroke.current;
		if (!now) return;
		if (pen.erase) {
			eraseAt(at(e));
			return;
		}
		const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
		for (const event of events.length ? events : [e.nativeEvent])
			pushPoint(now.points, at(event));
		setLive({ ...now });
	};

	const onUp = (e: PointerEvent<SVGSVGElement>) => {
		fingers.current.delete(e.pointerId);
		const now = stroke.current;
		stroke.current = null;
		setLive(null);
		if (!now?.points.length) return;
		const lowest = Math.max(...now.points.map((p) => p[1])) * SKETCH_WIDTH;
		onChange(
			[...strokes, now],
			lowest > height - NEAR_FOOT ? height + GROW : height,
		);
	};

	return (
		<svg
			ref={sheet}
			className={s.sketch}
			viewBox={`0 0 ${SKETCH_WIDTH} ${height}`}
			data-drawing={drawing || undefined}
			data-testid="note-sketch"
			onPointerDown={onDown}
			onPointerMove={onMove}
			onPointerUp={onUp}
			onPointerCancel={(e) => {
				fingers.current.delete(e.pointerId);
				stroke.current = null;
				setLive(null);
			}}
		>
			<title>{t("Drawing")}</title>
			{(live ? [...strokes, live] : strokes).map((one, i) => (
				<path
					// Strokes are only added at the end or taken out.
					key={i}
					d={curve(one.points, SKETCH_WIDTH, SKETCH_WIDTH)}
					fill="none"
					stroke={one.color}
					strokeWidth={one.width}
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			))}
		</svg>
	);
}
