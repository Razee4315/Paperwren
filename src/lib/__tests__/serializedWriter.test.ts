import { describe, expect, it } from "vitest";
import { createSerializedWriter } from "../serializedWriter";

describe("createSerializedWriter", () => {
	it("runs writes for one key in submission order even when slow", async () => {
		const seen: string[] = [];
		const write = async (_key: string, value: unknown) => {
			if (value === "stale") {
				// the first write is slower than the second
				await new Promise((r) => setTimeout(r, 20));
			}
			seen.push(String(value));
		};
		const serialized = createSerializedWriter(write);
		serialized("recents", "stale");
		await serialized("recents", "fresh");
		expect(seen).toEqual(["stale", "fresh"]);
	});

	it("does not let a failed write poison the chain", async () => {
		const seen: unknown[] = [];
		const write = async (_key: string, value: unknown) => {
			if (value === "boom") throw new Error("boom");
			seen.push(value);
		};
		const serialized = createSerializedWriter(write);
		await serialized("k", "boom");
		await serialized("k", "after");
		expect(seen).toEqual(["after"]);
	});

	it("runs independent keys concurrently", async () => {
		let running = 0;
		let maxRunning = 0;
		const write = async () => {
			running++;
			maxRunning = Math.max(maxRunning, running);
			await new Promise((r) => setTimeout(r, 5));
			running--;
		};
		const serialized = createSerializedWriter(write);
		await Promise.all([serialized("a", 1), serialized("b", 2)]);
		expect(maxRunning).toBe(2);
	});
});
