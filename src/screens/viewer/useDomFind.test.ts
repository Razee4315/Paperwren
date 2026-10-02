import { describe, expect, it } from "vitest";
import { findRanges } from "./useDomFind";

function page(html: string): HTMLElement {
	const root = document.createElement("div");
	root.innerHTML = html;
	document.body.replaceChildren(root);
	return root;
}

describe("findRanges", () => {
	it("finds a word that a document split across formatting runs", () => {
		const root = page(
			"<p><span>The Qua</span><b>rter</b><span>ly report</span></p>",
		);
		const [match, ...rest] = findRanges(root, "quarterly");
		expect(rest).toHaveLength(0);
		expect(match.toString()).toBe("Quarterly");
		expect(match.startContainer.nodeValue).toBe("The Qua");
		expect(match.startOffset).toBe(4);
		expect(match.endContainer.nodeValue).toBe("ly report");
		expect(match.endOffset).toBe(2);
	});

	it("keeps a match inside one text node inside it", () => {
		const root = page("<p><span>alpha beta</span><span> gamma</span></p>");
		const [match] = findRanges(root, "beta");
		expect(match.startContainer).toBe(match.endContainer);
		expect(match.toString()).toBe("beta");
	});

	it("never matches across paragraphs or table cells", () => {
		const root = page(
			"<p>north</p><p>south</p><table><tr><td>ea</td><td>st</td></tr></table>",
		);
		expect(findRanges(root, "thso")).toHaveLength(0);
		expect(findRanges(root, "east")).toHaveLength(0);
		expect(findRanges(root, "south")).toHaveLength(1);
	});

	it("finds every occurrence, whatever the case", () => {
		const root = page("<p>Tea, tea and <i>TE</i><i>A</i>.</p>");
		expect(findRanges(root, "tea").map((r) => r.toString())).toEqual([
			"Tea",
			"tea",
			"TEA",
		]);
		expect(findRanges(root, "")).toHaveLength(0);
	});
});
