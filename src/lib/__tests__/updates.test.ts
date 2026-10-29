import type { Update } from "@tauri-apps/plugin-updater";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	checkForUpdate,
	dismissUpdate,
	getUpdateState,
	installUpdate,
} from "../updates";

type Progress = Parameters<Update["downloadAndInstall"]>[0];

/** A stand-in for what the updater plugin finds: its download reports
 * a 1000-byte file in four pieces. */
function fakeUpdate(fail = false): Update {
	return {
		version: "1.5.0",
		body: "  Faster PDFs.\nFixed the bars.  ",
		downloadAndInstall: vi.fn(async (progress?: Progress) => {
			progress?.({ event: "Started", data: { contentLength: 1000 } });
			for (let i = 0; i < 4; i++)
				progress?.({ event: "Progress", data: { chunkLength: 250 } });
			if (fail) throw new Error("signature mismatch");
			progress?.({ event: "Finished" });
		}),
	} as unknown as Update;
}

beforeEach(() => dismissUpdate());

describe("updates", () => {
	it("offers a newer version with its notes", async () => {
		expect(await checkForUpdate(true, async () => fakeUpdate())).toBe(
			"available",
		);
		expect(getUpdateState()).toEqual({
			phase: "available",
			version: "1.5.0",
			notes: "Faster PDFs.\nFixed the bars.",
		});
	});

	it("says nothing at start when there is nothing new, or no network", async () => {
		expect(await checkForUpdate(true, async () => null)).toBe("idle");
		expect(
			await checkForUpdate(true, async () => {
				throw new Error("offline");
			}),
		).toBe("idle");
	});

	it("answers a check the reader asked for either way", async () => {
		expect(await checkForUpdate(false, async () => null)).toBe("latest");
		expect(
			await checkForUpdate(false, async () => {
				throw new Error("offline");
			}),
		).toBe("failed");
	});

	it("installs, counts the download and restarts", async () => {
		const update = fakeUpdate();
		await checkForUpdate(true, async () => update);
		const seen: Array<number | null> = [];
		const relaunch = vi.fn(async () => {
			const state = getUpdateState();
			if (state.phase === "installing") seen.push(state.percent);
		});
		await installUpdate(relaunch);
		expect(update.downloadAndInstall).toHaveBeenCalledOnce();
		expect(relaunch).toHaveBeenCalledOnce();
		expect(seen).toEqual([100]);
	});

	it("says so when the install fails, and stays put", async () => {
		await checkForUpdate(true, async () => fakeUpdate(true));
		const relaunch = vi.fn(async () => {});
		await installUpdate(relaunch);
		expect(relaunch).not.toHaveBeenCalled();
		expect(getUpdateState()).toEqual({
			phase: "install-failed",
			version: "1.5.0",
		});
	});

	it("lets a version found wait until later", async () => {
		await checkForUpdate(true, async () => fakeUpdate());
		dismissUpdate();
		expect(getUpdateState()).toEqual({ phase: "idle" });
	});
});
