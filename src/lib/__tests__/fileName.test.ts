import { describe, expect, it } from "vitest";
import {
	byName,
	copyName,
	joinName,
	nameProblem,
	splitName,
} from "../fileName";

describe("file names", () => {
	it("keeps the extension apart", () => {
		expect(splitName("Report.final.pdf")).toEqual(["Report.final", ".pdf"]);
		expect(splitName("notes")).toEqual(["notes", ""]);
		expect(splitName(".env")).toEqual([".env", ""]);
	});

	it("says what is wrong with a name", () => {
		expect(nameProblem("Quarterly report", ".pdf")).toBeNull();
		expect(nameProblem("Résumé – 2026", ".docx")).toBeNull();
		expect(nameProblem("  ")).toBe("Type a name");
		expect(nameProblem("a/b")).toMatch(/can't contain/);
		expect(nameProblem("what?")).toMatch(/can't contain/);
		expect(nameProblem("CON")).toBe("That name is kept by the system");
		expect(nameProblem("lpt1.backup")).toBe("That name is kept by the system");
		expect(nameProblem("ü".repeat(130), ".pdf")).toBe("That name is too long");
	});

	it("tidies what Windows would drop", () => {
		expect(joinName("  Draft. . ", ".pdf")).toBe("Draft.pdf");
		expect(copyName("Lease.pdf", "signed")).toBe("Lease (signed).pdf");
		expect(copyName("scan.png", "pages", ".pdf")).toBe("scan (pages).pdf");
	});
});

describe("many files put in order of their names (#81)", () => {
	const names = (list: { name: string }[]) => list.map((f) => f.name);
	it("counts numbers as numbers, as a person reads them", () => {
		const picked = ["IMG_10.jpg", "IMG_2.jpg", "IMG_1.jpg", "img_3.JPG"].map(
			(name) => ({ name }),
		);
		expect(names(byName(picked))).toEqual([
			"IMG_1.jpg",
			"IMG_2.jpg",
			"img_3.JPG",
			"IMG_10.jpg",
		]);
	});
	it("leaves the list it was given as it was", () => {
		const picked = [{ name: "b.png" }, { name: "a.png" }];
		byName(picked);
		expect(names(picked)).toEqual(["b.png", "a.png"]);
	});
});
