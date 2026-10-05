import { t } from "@/lib/i18n";
import s from "./Shell.module.css";

/** A heading found in a drawn document, to jump to. */
export interface Heading {
	text: string;
	/** 1 (a title or chapter) to 6. */
	level: number;
	el: HTMLElement;
}

const MAX_HEADINGS = 2000;
const MAX_TEXT = 140;

/**
 * The headings of a document as it was drawn: real h1 to h6 elements,
 * and the paragraphs Word styles as headings (docx-preview names their
 * class after the style: docx_heading1, docx_title). A document whose
 * author made headings by hand, with bold text, has none to find.
 */
export function readHeadings(root: HTMLElement): Heading[] {
	const found: Heading[] = [];
	const nodes = root.querySelectorAll<HTMLElement>(
		'h1, h2, h3, h4, h5, h6, p[class*="docx_heading"], p[class*="docx_title"]',
	);
	for (const el of nodes) {
		if (found.length >= MAX_HEADINGS) break;
		const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
		if (!text) continue;
		const named = /docx_heading\s?-?(\d)/.exec(el.className);
		const level = /^H[1-6]$/.test(el.tagName)
			? Number(el.tagName[1])
			: named
				? Number(named[1])
				: 1;
		found.push({
			text: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text,
			level: Math.min(6, Math.max(1, level)),
			el,
		});
	}
	// Indent from the shallowest level present, so a document that
	// starts at "Heading 2" does not sit a step in.
	const top = Math.min(...found.map((h) => h.level), 6);
	return found.map((h) => ({ ...h, level: h.level - top + 1 }));
}

/** The headings as a list to pick from: in the side panel on a
 * desktop (`compact`), in a sheet on a phone. */
export function HeadingList({
	headings,
	onPick,
	compact = false,
}: {
	headings: Heading[];
	onPick: (heading: Heading) => void;
	compact?: boolean;
}) {
	if (!headings.length)
		return <p className={s.sideEmpty}>{t("This document has no headings")}</p>;
	return (
		<>
			{headings.map((heading, i) => (
				<button
					type="button"
					key={i}
					className={compact ? s.sideItem : s.listItem}
					style={{
						paddingInlineStart:
							(compact ? 8 : 12) + (heading.level - 1) * (compact ? 12 : 16),
					}}
					title={compact ? heading.text : undefined}
					dir="auto"
					onClick={() => onPick(heading)}
					data-testid="heading"
				>
					{heading.text}
				</button>
			))}
		</>
	);
}
