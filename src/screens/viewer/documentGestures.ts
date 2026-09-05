/**
 * Document gesture state machine (docs/14 audit PDF-03).
 *
 * A pure pointer controller: it owns pointer bookkeeping, tap
 * arbitration, pan velocity, and pinch lifecycle, and emits
 * high-level events. The PDF viewer wires those to scrolling, zoom
 * transactions, and chrome toggling. No DOM reads here, so the
 * arbitration rules are unit-testable with synthetic pointer
 * sequences.
 *
 * Policy:
 *  - `pending` means one finger is down and has not yet exceeded the
 *    pan slop; it may still become a tap.
 *  - A tap requires short duration, small down-to-up travel, and a
 *    contact sequence that never pinched or was cancelled.
 *  - A second finger turns any pending/panning gesture into a pinch;
 *    extra fingers beyond two are ignored for pinch math.
 *  - pointercancel never produces a tap and invalidates tap history.
 *  - The pinch midpoint is recomputed from live pointers every move;
 *    no stale midpoint survives across gestures.
 */

export interface PointerSample {
	x: number;
	y: number;
	/** Event timestamp (performance.now()). */
	t: number;
}

export type GestureEvent =
	| { type: "panStart" }
	| { type: "pan"; dx: number; dy: number }
	| { type: "panEnd"; vx: number; vy: number }
	| { type: "pinchStart"; x: number; y: number; dist: number }
	| { type: "pinchMove"; x: number; y: number; dist: number; scale: number }
	| { type: "pinchCommit" }
	| { type: "tap"; x: number; y: number; double: boolean }
	| { type: "cancel" };

export type GesturePhase = "idle" | "pending" | "panning" | "pinching";

interface TrackedPointer extends PointerSample {
	pointerId: number;
	startX: number;
	startY: number;
}

/** Movement (px) before a pending touch becomes a pan. */
export const PAN_SLOP = 8;
/** Max down-to-up travel (px) for a tap. */
export const TAP_MAX_TRAVEL = 12;
/** Max contact duration (ms) for a tap. */
export const TAP_MAX_DURATION = 300;
/** Max gap (ms) between the two taps of a double-tap. */
export const DOUBLE_TAP_MS = 320;
/** Max offset (px) between the two taps of a double-tap. */
export const DOUBLE_TAP_SLOP = 24;

export function createGestureController(emit: (event: GestureEvent) => void) {
	const pointers = new Map<number, TrackedPointer>();
	let phase: GesturePhase = "idle";
	let downT = 0;
	let maxTravel = 0;
	let everPinched = false;
	let panLast: PointerSample | null = null;
	let velocity = { x: 0, y: 0 };
	let pinchBase = 0;
	let lastTap: PointerSample | null = null;

	function firstTwo(): TrackedPointer[] {
		const out: TrackedPointer[] = [];
		for (const p of pointers.values()) {
			out.push(p);
			if (out.length === 2) break;
		}
		return out;
	}

	function distance(a: TrackedPointer, b: TrackedPointer): number {
		return Math.hypot(a.x - b.x, a.y - b.y);
	}

	function beginPinch(t: number) {
		const two = firstTwo();
		if (two.length < 2) return;
		phase = "pinching";
		everPinched = true;
		pinchBase = Math.max(1, distance(two[0], two[1]));
		emit({
			type: "pinchStart",
			x: (two[0].x + two[1].x) / 2,
			y: (two[0].y + two[1].y) / 2,
			dist: pinchBase,
		});
		void t;
	}

	return {
		get phase(): GesturePhase {
			return phase;
		},
		get pointerCount(): number {
			return pointers.size;
		},
		/** Live pinch midpoint, for callers that need the focal point. */
		midpoint(): PointerSample | null {
			const two = firstTwo();
			if (two.length < 2) return null;
			return {
				x: (two[0].x + two[1].x) / 2,
				y: (two[0].y + two[1].y) / 2,
				t: two[0].t,
			};
		},

		down(p: PointerSample & { pointerId: number }) {
			pointers.set(p.pointerId, { ...p, startX: p.x, startY: p.y });
			switch (phase) {
				case "idle":
					phase = "pending";
					downT = p.t;
					maxTravel = 0;
					everPinched = false;
					break;
				case "pending":
				case "panning":
					if (pointers.size === 2) beginPinch(p.t);
					// Three-plus fingers: keep the original pinch pair.
					break;
				default:
					break;
			}
		},

		move(p: PointerSample & { pointerId: number }) {
			const tracked = pointers.get(p.pointerId);
			if (!tracked) return;
			tracked.x = p.x;
			tracked.y = p.y;
			tracked.t = p.t;
			switch (phase) {
				case "pending": {
					maxTravel = Math.max(
						maxTravel,
						Math.hypot(p.x - tracked.startX, p.y - tracked.startY),
					);
					if (maxTravel > PAN_SLOP) {
						phase = "panning";
						panLast = { x: p.x, y: p.y, t: p.t };
						velocity = { x: 0, y: 0 };
						emit({ type: "panStart" });
					}
					break;
				}
				case "panning": {
					if (!panLast) break;
					const dx = p.x - panLast.x;
					const dy = p.y - panLast.y;
					const dt = Math.max(1, p.t - panLast.t);
					velocity = {
						x: velocity.x * 0.8 + (dx / dt) * 0.2,
						y: velocity.y * 0.8 + (dy / dt) * 0.2,
					};
					panLast = { x: p.x, y: p.y, t: p.t };
					if (dx !== 0 || dy !== 0) emit({ type: "pan", dx, dy });
					break;
				}
				case "pinching": {
					const two = firstTwo();
					if (two.length === 2) {
						const dist = distance(two[0], two[1]);
						emit({
							type: "pinchMove",
							x: (two[0].x + two[1].x) / 2,
							y: (two[0].y + two[1].y) / 2,
							dist,
							scale: dist / pinchBase,
						});
					}
					break;
				}
				default:
					break;
			}
		},

		up(p: PointerSample & { pointerId: number }) {
			const tracked = pointers.get(p.pointerId);
			if (!tracked) return;
			pointers.delete(p.pointerId);
			switch (phase) {
				case "pinching": {
					if (pointers.size >= 2) {
						// A non-primary finger lifted (or an extra one): rebase
						// the pinch on the surviving pair so the scale does not
						// jump on the next move.
						const two = firstTwo();
						pinchBase = Math.max(1, distance(two[0], two[1]));
						return;
					}
					emit({ type: "pinchCommit" });
					if (pointers.size === 1) {
						// The remaining finger becomes a plain pan on the
						// committed layout; it is never a tap.
						const rest = firstTwo()[0];
						phase = "panning";
						panLast = { x: rest.x, y: rest.y, t: p.t };
						velocity = { x: 0, y: 0 };
						emit({ type: "panStart" });
					} else {
						phase = "idle";
					}
					break;
				}
				case "pending": {
					const duration = p.t - downT;
					const travel = Math.hypot(p.x - tracked.startX, p.y - tracked.startY);
					phase = "idle";
					if (everPinched) return;
					if (travel > TAP_MAX_TRAVEL) return;
					if (duration > TAP_MAX_DURATION) {
						// Long press: not a tap, and it breaks double-tap
						// history.
						lastTap = null;
						return;
					}
					if (
						lastTap &&
						p.t - lastTap.t <= DOUBLE_TAP_MS &&
						Math.hypot(p.x - lastTap.x, p.y - lastTap.y) <= DOUBLE_TAP_SLOP
					) {
						lastTap = null;
						emit({ type: "tap", x: p.x, y: p.y, double: true });
					} else {
						lastTap = { x: p.x, y: p.y, t: p.t };
						emit({ type: "tap", x: p.x, y: p.y, double: false });
					}
					break;
				}
				case "panning": {
					if (pointers.size === 0) {
						emit({ type: "panEnd", vx: velocity.x, vy: velocity.y });
						velocity = { x: 0, y: 0 };
						phase = "idle";
					} else {
						// Continue panning with the surviving finger.
						const rest = firstTwo()[0];
						panLast = { x: rest.x, y: rest.y, t: p.t };
						velocity = { x: 0, y: 0 };
					}
					break;
				}
				default:
					break;
			}
		},

		cancel(pointerId: number) {
			if (!pointers.delete(pointerId)) return;
			// Cancellation is never a tap and invalidates tap history.
			lastTap = null;
			if (phase === "pinching" && pointers.size >= 2) return;
			if (phase === "pinching") emit({ type: "cancel" });
			else if (phase === "panning") emit({ type: "panEnd", vx: 0, vy: 0 });
			else if (phase === "pending") emit({ type: "cancel" });
			if (pointers.size === 1) {
				const rest = firstTwo()[0];
				phase = "panning";
				panLast = { x: rest.x, y: rest.y, t: rest.t };
				velocity = { x: 0, y: 0 };
			} else if (pointers.size === 0) {
				phase = "idle";
			}
		},

		/** Full reset (document change, unmount): no events, no history. */
		reset() {
			pointers.clear();
			phase = "idle";
			everPinched = false;
			panLast = null;
			velocity = { x: 0, y: 0 };
			lastTap = null;
		},
	};
}

export type GestureController = ReturnType<typeof createGestureController>;
