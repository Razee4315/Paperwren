import { afterEach, describe, expect, it } from "vitest";
import {
	OPEN_FILE_NOTE,
	holdOpen,
	openHeader,
	openPaths,
	pathsOf,
	saveAsking,
} from "../openFiles";

afterEach(() => {
	holdOpen("documents", []);
	holdOpen("tool", []);
});

describe("the files open in a window", () => {
	it("are the desktop paths of what the tabs and tools hold, each once", () => {
		holdOpen("documents", [
			{ kind: "path", path: "C:\\Docs\\a.pdf" },
			{ kind: "path", path: "C:\\Docs\\b.pdf" },
			{ kind: "managed", path: "/imports/ab/c.pdf" },
			{ kind: "browser", key: "k" },
			undefined,
		]);
		holdOpen("tool", [
			{ kind: "path", path: "C:\\Docs\\a.pdf" },
			{ kind: "path", path: "/home/me/d.pdf" },
		]);
		expect(openPaths()).toEqual([
			"C:\\Docs\\a.pdf",
			"C:\\Docs\\b.pdf",
			"/home/me/d.pdf",
		]);
		// A tool closed lets its files go; the tabs' stay.
		holdOpen("tool", []);
		expect(openPaths()).toEqual(["C:\\Docs\\a.pdf", "C:\\Docs\\b.pdf"]);
	});

	it("never include a phone's copies or documents", () => {
		expect(
			pathsOf([
				{ kind: "uri", uri: "content://x/document/1" },
				{ kind: "managed", path: "/imports/1/a.pdf", origin: "content://y" },
				{ kind: "memory", key: "1:a.pdf" },
			]),
		).toEqual([]);
	});

	it("go to the desktop side one a line, whatever they are written in", () => {
		const header = openHeader(["C:\\Résumé\\a b.pdf", "/home/me/d.pdf"]);
		expect(header).toMatch(/^[\x21-\x7e]*$/);
		expect(decodeURIComponent(header).split("\n")).toEqual([
			"C:\\Résumé\\a b.pdf",
			"/home/me/d.pdf",
		]);
		expect(openHeader([])).toBe("");
	});
});

describe("a save pointed at an open file", () => {
	const refusal = { kind: "is_open", message: "that is a file you have open" };

	it("is refused, said, and asked again until another place is picked", async () => {
		holdOpen("documents", [{ kind: "path", path: "C:\\Docs\\a.pdf" }]);
		const asked: string[][] = [];
		const said: string[] = [];
		let picks = 0;
		const saved = await saveAsking(
			async (open) => {
				asked.push(open);
				if (++picks < 3) throw refusal;
				return { name: "a (copy).pdf" };
			},
			(note) => said.push(note),
		);
		expect(saved).toEqual({ name: "a (copy).pdf" });
		expect(asked).toEqual([
			["C:\\Docs\\a.pdf"],
			["C:\\Docs\\a.pdf"],
			["C:\\Docs\\a.pdf"],
		]);
		expect(said).toEqual([OPEN_FILE_NOTE, OPEN_FILE_NOTE]);
		expect(OPEN_FILE_NOTE).toBe(
			"That's the file you have open. Choose another name.",
		);
	});

	it("ends as a cancel when the reader cancels, or keeps picking it", async () => {
		const said: string[] = [];
		expect(
			await saveAsking(
				async () => null,
				(note) => said.push(note),
			),
		).toBeNull();
		expect(said).toEqual([]);
		let tries = 0;
		expect(
			await saveAsking(
				async () => {
					tries++;
					throw refusal;
				},
				(note) => said.push(note),
				() => [],
				3,
			),
		).toBeNull();
		expect(tries).toBe(3);
		expect(said).toHaveLength(3);
	});

	it("leaves any other failure to the caller, said as before", async () => {
		const said: string[] = [];
		await expect(
			saveAsking(
				async () => {
					throw { kind: "io", message: "disk full" };
				},
				(note) => said.push(note),
			),
		).rejects.toMatchObject({ kind: "io" });
		expect(said).toEqual([]);
	});
});
