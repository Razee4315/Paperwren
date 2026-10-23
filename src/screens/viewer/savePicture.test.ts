import { pictureExtension } from "@/lib/pagePicture";
import { describe, expect, it } from "vitest";
import { pageFileName } from "./savePicture";

describe("a page saved as a picture", () => {
	it("is named after its file and page", () => {
		expect(pageFileName("Report.pdf", 3, "image/png")).toBe(
			"Report - page 3.png",
		);
		expect(pageFileName("comic.book.cbz", 12, "image/jpeg")).toBe(
			"comic.book - page 12.jpg",
		);
		expect(pageFileName("scan", 1, "image/tiff")).toBe("scan - page 1.tiff");
	});

	it("takes the extension its picture type calls for", () => {
		expect(pictureExtension("image/jpeg")).toBe(".jpg");
		expect(pictureExtension("image/webp")).toBe(".webp");
		expect(pictureExtension("image/svg+xml")).toBe(".svg");
		expect(pictureExtension("")).toBe(".png");
	});
});
