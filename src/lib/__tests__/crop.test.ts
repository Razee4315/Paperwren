import { describe, expect, it } from "vitest";
import {
	type CropChoice,
	type Share,
	boxByHand,
	cleanCrop,
	clearBoxes,
	cropOn,
	setBox,
} from "../crop";
import { cleanPosition } from "../recents";

const A: Share = [0.1, 0.1, 0.9, 0.9];
const B: Share = [0.2, 0.2, 0.8, 0.8];
const C: Share = [0.3, 0.3, 0.7, 0.7];

describe("a stored crop", () => {
	it("reads crop margins as kept before boxes by hand: the app's crop", () => {
		expect(cleanCrop(true)).toEqual({ auto: true });
		const pos = cleanPosition({
			kind: "pdf",
			page: 3,
			scale: "page-width",
			top: 0,
			left: 0,
			rotation: 0,
			crop: true,
		});
		expect(pos?.kind === "pdf" && pos.crop).toEqual({ auto: true });
	});

	it("keeps boxes by hand, and drops what is not one", () => {
		expect(
			cleanCrop({
				auto: false,
				bare: true,
				odd: A,
				even: [0.5, 0.5, 0.4, 0.9],
				all: "x",
				pages: { 7: B, 0: C, x: C, 8: [2, 0, 1, 1] },
			}),
		).toEqual({ auto: false, bare: true, odd: A, pages: { 7: B } });
	});

	it("is no crop when it crops nothing", () => {
		expect(cleanCrop({ auto: false })).toBeUndefined();
		expect(cleanCrop(false)).toBeUndefined();
		expect(cleanCrop(null)).toBeUndefined();
		expect(cropOn({ auto: false, bare: true })).toBe(false);
		expect(cropOn({ auto: false, pages: { 2: A } })).toBe(true);
	});
});

describe("which box a page takes", () => {
	const choice: CropChoice = {
		auto: true,
		all: A,
		odd: B,
		pages: { 7: C },
	};
	it("takes its own, then its side's, then every page's", () => {
		expect(boxByHand(choice, 7)).toEqual(C);
		expect(boxByHand(choice, 5)).toEqual(B);
		expect(boxByHand(choice, 8)).toEqual(A);
	});
	it("has none by hand when none is set (the app's crop then)", () => {
		expect(boxByHand({ auto: true }, 3)).toBeUndefined();
	});
});

describe("setting a box", () => {
	it("for odd pages, then even pages, as a book's crop", () => {
		let choice: CropChoice = { auto: false };
		choice = setBox(choice, "odd", 7, A);
		expect(boxByHand(choice, 7)).toEqual(A);
		expect(boxByHand(choice, 8)).toBeUndefined();
		choice = setBox(choice, "even", 8, B);
		expect(boxByHand(choice, 9)).toEqual(A);
		expect(boxByHand(choice, 8)).toEqual(B);
	});

	it("for all pages overrides every narrower box", () => {
		const choice = setBox(
			{ auto: true, odd: A, even: B, pages: { 3: C } },
			"all",
			3,
			C,
		);
		expect(choice).toEqual({ auto: true, all: C });
	});

	it("for one side drops that side's single pages, not the other's", () => {
		const choice = setBox({ auto: true, pages: { 3: C, 4: C } }, "odd", 5, A);
		expect(choice).toEqual({ auto: true, odd: A, pages: { 4: C } });
	});

	it("for this page keeps the rest", () => {
		const choice = setBox({ auto: true, all: A }, "page", 2, B);
		expect(boxByHand(choice, 2)).toEqual(B);
		expect(boxByHand(choice, 3)).toEqual(A);
	});
});

describe("Auto for some pages", () => {
	it("hands them back to the app's crop, and keeps the rest by hand", () => {
		const choice: CropChoice = {
			auto: false,
			all: A,
			odd: B,
			pages: { 4: C, 5: C },
		};
		expect(clearBoxes(choice, "odd", 5)).toEqual({
			auto: true,
			all: A,
			pages: { 4: C },
		});
		expect(clearBoxes(choice, "page", 4)).toEqual({
			auto: true,
			all: A,
			odd: B,
			pages: { 5: C },
		});
		expect(clearBoxes(choice, "all", 1)).toEqual({ auto: true });
	});
});
