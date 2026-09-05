import { describe, expect, it } from "vitest";
import { type GestureEvent, createGestureController } from "./documentGestures";

/** Run a pointer script against a fresh controller and collect the
 * emitted events. Coordinates/times are synthetic; no DOM involved. */
function run(
	script: Array<{
		op: string;
		id?: number;
		x?: number;
		y?: number;
		t?: number;
	}>,
) {
	const events: GestureEvent[] = [];
	const c = createGestureController((e) => events.push(e));
	for (const s of script) {
		const base = {
			pointerId: s.id ?? 1,
			x: s.x ?? 0,
			y: s.y ?? 0,
			t: s.t ?? 0,
		};
		if (s.op === "down") c.down(base);
		else if (s.op === "move") c.move(base);
		else if (s.op === "up") c.up(base);
		else if (s.op === "cancel") c.cancel(s.id ?? 1);
	}
	return events;
}

describe("tap arbitration (audit PDF-03)", () => {
	it("a short, still contact is a single tap", () => {
		const events = run([
			{ op: "down", x: 100, y: 200, t: 0 },
			{ op: "up", x: 101, y: 202, t: 80 },
		]);
		expect(events).toEqual([{ type: "tap", x: 101, y: 202, double: false }]);
	});

	it("two quick nearby taps produce a double tap", () => {
		const events = run([
			{ op: "down", x: 100, y: 200, t: 0 },
			{ op: "up", x: 100, y: 200, t: 60 },
			{ op: "down", x: 104, y: 204, t: 200 },
			{ op: "up", x: 104, y: 204, t: 260 },
		]);
		expect(events.filter((e) => e.type === "tap")).toHaveLength(2);
		expect(events[1]).toMatchObject({ type: "tap", double: true });
	});

	it("taps too far apart are two singles, not a double", () => {
		const events = run([
			{ op: "down", x: 100, y: 200, t: 0 },
			{ op: "up", x: 100, y: 200, t: 60 },
			{ op: "down", x: 300, y: 400, t: 200 },
			{ op: "up", x: 300, y: 400, t: 260 },
		]);
		expect(events.filter((e) => e.type === "tap" && e.double)).toHaveLength(0);
	});

	it("a long press is not a tap and breaks double-tap history", () => {
		const events = run([
			{ op: "down", x: 100, y: 200, t: 0 },
			{ op: "up", x: 100, y: 200, t: 700 },
			{ op: "down", x: 100, y: 200, t: 800 },
			{ op: "up", x: 100, y: 200, t: 860 },
		]);
		expect(events.filter((e) => e.type === "tap" && e.double)).toHaveLength(0);
		expect(events.filter((e) => e.type === "tap")).toHaveLength(1);
	});

	it("a dragged contact pans and never taps", () => {
		const events = run([
			{ op: "down", x: 100, y: 500, t: 0 },
			{ op: "move", x: 98, y: 488, t: 16 },
			{ op: "move", x: 96, y: 470, t: 32 },
			{ op: "move", x: 96, y: 440, t: 48 },
			{ op: "up", x: 96, y: 440, t: 60 },
		]);
		expect(events[0]).toEqual({ type: "panStart" });
		// The finger moves up the screen (y decreases): pan deltas are
		// negative y, i.e. the content follows the finger downward.
		expect(events.some((e) => e.type === "pan" && e.dy < 0)).toBe(true);
		const end = events.find((e) => e.type === "panEnd");
		expect(end).toBeDefined();
		expect((end as { vy: number }).vy).toBeLessThan(0);
		expect(events.some((e) => e.type === "tap")).toBe(false);
	});
});

describe("pinch lifecycle", () => {
	it("two fingers start a pinch around their midpoint", () => {
		const events = run([
			{ op: "down", id: 1, x: 100, y: 300, t: 0 },
			{ op: "down", id: 2, x: 200, y: 300, t: 10 },
		]);
		expect(events).toEqual([{ type: "pinchStart", x: 150, y: 300, dist: 100 }]);
	});

	it("pinchMove tracks the live midpoint of both fingers", () => {
		const events = run([
			{ op: "down", id: 1, x: 100, y: 300, t: 0 },
			{ op: "down", id: 2, x: 200, y: 300, t: 10 },
			{ op: "move", id: 1, x: 80, y: 280, t: 20 },
			{ op: "move", id: 2, x: 240, y: 340, t: 20 },
		]);
		const move = events.filter((e) => e.type === "pinchMove").pop() as {
			x: number;
			y: number;
			dist: number;
			scale: number;
		};
		expect(move.x).toBe(160);
		expect(move.y).toBe(310);
		// dist((80,280),(240,340)) = sqrt(160^2 + 60^2) ≈ 170.88.
		expect(move.scale).toBeCloseTo(170.88 / 100, 2);
	});

	it("pinch then second-finger release never creates a tap", () => {
		const events = run([
			{ op: "down", id: 1, x: 100, y: 300, t: 0 },
			{ op: "down", id: 2, x: 200, y: 300, t: 10 },
			{ op: "up", id: 1, x: 100, y: 300, t: 400 },
			{ op: "up", id: 2, x: 200, y: 300, t: 420 },
		]);
		expect(events).toContainEqual({ type: "pinchCommit" });
		expect(events.some((e) => e.type === "tap")).toBe(false);
	});

	it("a third finger does not disturb the pinch pair", () => {
		const events = run([
			{ op: "down", id: 1, x: 100, y: 300, t: 0 },
			{ op: "down", id: 2, x: 200, y: 300, t: 10 },
			{ op: "down", id: 3, x: 500, y: 900, t: 20 },
			{ op: "move", id: 2, x: 220, y: 300, t: 30 },
		]);
		const move = events.filter((e) => e.type === "pinchMove").pop() as {
			scale: number;
		};
		// Pair is fingers 1 and 2: dist went 100 -> 120.
		expect(move.scale).toBeCloseTo(1.2, 6);
	});

	it("a surviving finger after the pinch becomes a pan, not a tap", () => {
		const events = run([
			{ op: "down", id: 1, x: 100, y: 300, t: 0 },
			{ op: "down", id: 2, x: 200, y: 300, t: 10 },
			{ op: "up", id: 2, x: 200, y: 300, t: 300 },
			{ op: "move", id: 1, x: 90, y: 300, t: 320 },
			{ op: "up", id: 1, x: 90, y: 300, t: 340 },
		]);
		expect(events).toContainEqual({ type: "pinchCommit" });
		expect(events.some((e) => e.type === "panStart")).toBe(true);
		expect(events.some((e) => e.type === "pan")).toBe(true);
		expect(events.some((e) => e.type === "tap")).toBe(false);
	});
});

describe("cancellation", () => {
	it("pointercancel of a tap candidate emits cancel, never a tap", () => {
		const events = run([
			{ op: "down", x: 100, y: 200, t: 0 },
			{ op: "cancel", id: 1 },
		]);
		expect(events).toEqual([{ type: "cancel" }]);
	});

	it("cancellation invalidates double-tap history", () => {
		const events = run([
			{ op: "down", x: 100, y: 200, t: 0 },
			{ op: "up", x: 100, y: 200, t: 50 },
			{ op: "down", x: 102, y: 202, t: 150 },
			{ op: "cancel", id: 1 },
			{ op: "down", x: 102, y: 202, t: 200 },
			{ op: "up", x: 102, y: 202, t: 250 },
		]);
		expect(events.filter((e) => e.type === "tap" && e.double)).toHaveLength(0);
	});

	it("cancelling one finger of a pinch rolls the whole pinch back", () => {
		const events = run([
			{ op: "down", id: 1, x: 100, y: 300, t: 0 },
			{ op: "down", id: 2, x: 200, y: 300, t: 10 },
			{ op: "cancel", id: 2 },
		]);
		expect(events).toEqual([
			{ type: "pinchStart", x: 150, y: 300, dist: 100 },
			{ type: "cancel" },
		]);
		expect(events.some((e) => e.type === "pinchCommit")).toBe(false);
	});
});
