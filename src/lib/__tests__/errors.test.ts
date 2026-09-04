import { describe, expect, it } from "vitest";
import { classifyOpenError, failureCopy } from "../errors";
import { normalizeRecents, reopenFromSource } from "../recents";

describe("classifyOpenError", () => {
	it("maps platform messages onto the taxonomy", () => {
		expect(
			classifyOpenError(new Error("path not found: /a.pdf (enoent)")),
		).toBe("not_found");
		expect(classifyOpenError("Permission denied: content://x")).toBe(
			"permission_revoked",
		);
		expect(classifyOpenError("provider for content://x is unavailable")).toBe(
			"provider_unavailable",
		);
		expect(classifyOpenError("out of memory")).toBe("out_of_memory");
		expect(classifyOpenError("user cancelled")).toBe("cancelled");
		expect(classifyOpenError("something odd")).toBe("read_failed");
	});

	it("gives every failure exactly one recovery path", () => {
		for (const kind of [
			"not_found",
			"permission_revoked",
			"provider_unavailable",
			"read_failed",
			"unsupported",
			"corrupt",
			"out_of_memory",
			"cancelled",
		] as const) {
			const copy = failureCopy(kind, "x.pdf");
			expect(copy.title.length).toBeGreaterThan(0);
			expect(copy.message.length).toBeGreaterThan(0);
		}
		// Unavailable sources offer "choose again", not a dead end.
		expect(failureCopy("not_found", "x.pdf").action).toBe("locate");
		expect(failureCopy("corrupt", "x.pdf").action).toBeNull();
	});
});

describe("reopenFromSource migration", () => {
	it("derives the mechanism from the legacy source scheme", () => {
		expect(reopenFromSource("content://provider/docs/12")).toEqual({
			kind: "persisted-uri",
			uri: "content://provider/docs/12",
		});
		expect(reopenFromSource("/home/user/report.pdf")).toEqual({
			kind: "desktop-path",
			path: "/home/user/report.pdf",
		});
		expect(
			reopenFromSource("/data/user/0/app.paperwren.docs/files/imports/a.pdf"),
		).toEqual({
			kind: "managed-copy",
			path: "/data/user/0/app.paperwren.docs/files/imports/a.pdf",
		});
	});

	it("normalizes legacy entries and keeps their ids stable", () => {
		const [entry] = normalizeRecents([
			{
				source: "content://provider/1284",
				name: "1284",
				format: "pdf",
				lastOpenedAt: 5,
			},
		]);
		expect(entry.reopen).toEqual({
			kind: "persisted-uri",
			uri: "content://provider/1284",
		});
		// Same source always migrates to the same stable id.
		const [again] = normalizeRecents([
			{ source: "content://provider/1284", name: "x", format: "pdf" },
		]);
		expect(entry.id).toBe(again.id);
	});

	it("preserves unavailable flags through migration", () => {
		const [entry] = normalizeRecents([
			{
				source: "/x/a.pdf",
				name: "a.pdf",
				format: "pdf",
				unavailable: true,
			},
		]);
		expect(entry.unavailable).toBe(true);
	});
});
