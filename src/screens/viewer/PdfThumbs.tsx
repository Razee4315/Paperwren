import { t } from "@/lib/i18n";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useEffect, useRef } from "react";
import s from "./PdfView.module.css";

/** Width a thumbnail is drawn at, in CSS pixels. */
const WIDTH = 132;

/**
 * Every page as a small picture, to find a page by its look. Pages are
 * drawn one at a time as they scroll into view and dropped again when
 * they leave, so a thousand-page file costs no more than a screenful.
 */
export function PdfThumbs({
	doc,
	current,
	rotation,
	onPick,
}: {
	doc: PDFDocumentProxy;
	current: number;
	rotation: number;
	onPick: (page: number) => void;
}) {
	const grid = useRef<HTMLDivElement>(null);
	const start = useRef(current);

	useEffect(() => {
		const root = grid.current;
		if (!root) return;
		let alive = true;
		const wanted = new Set<HTMLElement>();
		let busy = false;
		const density = Math.min(2, window.devicePixelRatio || 1);

		const draw = async (cell: HTMLElement) => {
			const canvas = cell.querySelector("canvas");
			if (!canvas || canvas.dataset.drawn) return;
			const page = await doc.getPage(Number(cell.dataset.page));
			if (!alive || !wanted.has(cell)) return;
			const turn = (page.rotate + rotation) % 360;
			const base = page.getViewport({ scale: 1, rotation: turn });
			const viewport = page.getViewport({
				scale: (WIDTH * density) / base.width,
				rotation: turn,
			});
			canvas.width = Math.ceil(viewport.width);
			canvas.height = Math.ceil(viewport.height);
			cell.style.setProperty("--ratio", String(base.width / base.height));
			const context = canvas.getContext("2d");
			if (!context) return;
			await page.render({ canvasContext: context, viewport }).promise;
			canvas.dataset.drawn = "1";
		};
		const pump = async () => {
			if (busy) return;
			busy = true;
			while (alive && wanted.size) {
				const next = [...wanted].find(
					(cell) => !cell.querySelector("canvas")?.dataset.drawn,
				);
				if (!next) break;
				try {
					await draw(next);
				} catch {
					// A page that cannot be drawn keeps its blank card.
					const canvas = next.querySelector("canvas");
					if (canvas) canvas.dataset.drawn = "1";
				}
			}
			busy = false;
		};
		const seen = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					const cell = entry.target as HTMLElement;
					if (entry.isIntersecting) wanted.add(cell);
					else {
						wanted.delete(cell);
						const canvas = cell.querySelector("canvas");
						if (canvas?.dataset.drawn) {
							canvas.width = canvas.height = 0;
							delete canvas.dataset.drawn;
						}
					}
				}
				pump();
			},
			{ root: root.parentElement, rootMargin: "300px 0px" },
		);
		for (const cell of root.children) seen.observe(cell);
		root
			.querySelector(`[data-page="${start.current}"]`)
			?.scrollIntoView({ block: "center" });
		return () => {
			alive = false;
			seen.disconnect();
		};
	}, [doc, rotation]);

	return (
		<div ref={grid} className={s.thumbs} data-testid="pdf-thumbs">
			{Array.from({ length: doc.numPages }, (_, i) => (
				<button
					type="button"
					key={i}
					data-page={i + 1}
					className={s.thumb}
					aria-current={i + 1 === current ? "page" : undefined}
					aria-label={t("Page {n}", { n: i + 1 })}
					onClick={() => onPick(i + 1)}
				>
					<canvas />
					<span>{i + 1}</span>
				</button>
			))}
		</div>
	);
}
