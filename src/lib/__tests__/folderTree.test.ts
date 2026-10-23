import { describe, expect, it } from "vitest";
import { folderAt, folderTree } from "../folderTree";

const files = [
	{ name: "lease.pdf", folder: "" },
	{ name: "w2.pdf", folder: "Taxes/2026" },
	{ name: "1099.pdf", folder: "Taxes/2026" },
	{ name: "return.pdf", folder: "Taxes/2025" },
	{ name: "notes.md", folder: "Taxes" },
	{ name: "menu.docx", folder: "Recipes" },
	{ name: "scan.pdf", folder: "Taxes\\10" },
];

describe("folderTree", () => {
	const tree = folderTree(files, (f) => f.folder);

	it("puts each document in the folder it was found in", () => {
		expect(tree.files.map((f) => f.name)).toEqual(["lease.pdf"]);
		const y2026 = folderAt(tree, "Taxes/2026");
		expect(y2026?.files.map((f) => f.name)).toEqual(["w2.pdf", "1099.pdf"]);
		expect(y2026?.name).toBe("2026");
	});

	it("counts every document inside a folder, its sub-folders' too", () => {
		expect(tree.total).toBe(7);
		expect(folderAt(tree, "Taxes")?.total).toBe(5);
		expect(folderAt(tree, "Recipes")?.total).toBe(1);
	});

	it("names sub-folders in the order a person counts", () => {
		expect(tree.folders.map((f) => f.name)).toEqual(["Recipes", "Taxes"]);
		// A Windows separator divides folders too; numbers count up.
		expect(folderAt(tree, "Taxes")?.folders.map((f) => f.name)).toEqual([
			"10",
			"2025",
			"2026",
		]);
	});

	it("says when a folder is no longer there", () => {
		expect(folderAt(tree, "Taxes/2024")).toBeNull();
		expect(folderAt(tree, "")).toBe(tree);
	});
});
