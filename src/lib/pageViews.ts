/**
 * The ways a PDF's pages can be laid out, as a reader would name them.
 * Settings and the viewer's menu offer the same three, in the same
 * words, so the choice reads the same wherever it is made.
 */

import { msg } from "./i18n";
import type { PdfFlow } from "./types";

export const PAGE_VIEWS: ReadonlyArray<{
	value: PdfFlow;
	name: string;
	hint: string;
}> = [
	{ value: "down", name: msg("Scroll"), hint: msg("One long column of pages") },
	{
		value: "across",
		name: msg("Sideways"),
		hint: msg("Pages in a row, swiped across"),
	},
	{
		value: "one",
		name: msg("One at a time"),
		hint: msg("A single page on screen, nothing to line up"),
	},
];

/** The name of a page view, untranslated (pass it to `t`). */
export const pageViewName = (flow: PdfFlow): string =>
	PAGE_VIEWS.find((view) => view.value === flow)?.name ?? PAGE_VIEWS[0].name;
