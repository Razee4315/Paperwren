import { describe, expect, it } from "vitest";
import { defaultPage, fillPage } from "../../screens/viewer/docxRender";

const parsed = (props?: object) => ({
	documentPart: { body: { type: "document", children: [], props } },
});

describe("a Word file with no page settings", () => {
	it("gets Word's own page: Letter where Letter is used, A4 elsewhere", () => {
		expect(defaultPage("en-US").pageSize.width).toBe("612.00pt");
		expect(defaultPage("es-MX").pageSize.width).toBe("612.00pt");
		expect(defaultPage("en-GB").pageSize.width).toBe("595.30pt");
		expect(defaultPage("ur-PK").pageSize.height).toBe("841.90pt");
		expect(defaultPage("fr").pageSize.width).toBe("595.30pt");
		expect(defaultPage("de-DE").pageMargins.left).toBe("72.00pt");
	});

	it("is laid out on that page, margins and all", () => {
		const doc = parsed({});
		expect(fillPage(doc, "en-GB")).toBe(true);
		expect(doc.documentPart.body.props).toEqual(defaultPage("en-GB"));
	});

	it("keeps what the file does set", () => {
		const doc = parsed({
			pageSize: {
				width: "842.00pt",
				height: "595.00pt",
				orientation: "landscape",
			},
			pageMargins: {
				left: "36.00pt",
				right: "36.00pt",
				top: "36.00pt",
				bottom: "36.00pt",
			},
		});
		expect(fillPage(doc, "en-US")).toBe(false);
		const props = doc.documentPart.body.props as ReturnType<typeof defaultPage>;
		expect(props.pageSize.width).toBe("842.00pt");
	});

	it("fills in only the part that is missing", () => {
		const doc = parsed({
			pageSize: { width: "612.00pt", height: "792.00pt" },
			pageMargins: { left: "50.00pt" },
		});
		expect(fillPage(doc, "en-GB")).toBe(false);
		const bare = parsed({ pageMargins: { left: "50.00pt", right: "50.00pt" } });
		expect(fillPage(bare, "en-GB")).toBe(true);
		const props = bare.documentPart.body.props as ReturnType<
			typeof defaultPage
		>;
		expect(props.pageSize.width).toBe("595.30pt");
		expect(props.pageMargins.left).toBe("50.00pt");
	});
});
