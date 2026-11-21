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
	follow = false,
}: {
	doc: PDFDocumentProxy;
	current: number;
	rotation: number;
	onPick: (page: number) => void;
	/** Keep the page being read in view (the list stays open beside
	 * the document). */
	follow?: boolean;
}) {
	const grid = useRef<HTMLDivElement>(null);
	const start = useRef(current);
	const followMounted = useRef(false);

	useEffect(() => {
		if (!follow) return;
		// Initial positioning is handled by the mount effect below; running
		// scrollIntoView on mount forces a second synchronous layout.
		if (!followMounted.current) {
			followMounted.current = true;
			return;
		}
		const raf = window.requestAnimationFrame(() => {
			grid.current
				?.querySelector(`[data-page="${current}"]`)
				?.scrollIntoView({ block: "nearest" });
		});
		return () => window.cancelAnimationFrame(raf);
	}, [follow, current]);

	useEffect(() => {
		const root = grid.current;
		if (!root) return;
		let alive = true;
		const wanted = new Set<HTMLElement>();
		let busy = false;
		let activeRender: { cell: HTMLElement; cancel: () => void } | null = null;
		const density = Math.min(2, window.devicePixelRatio || 1);

		const releaseCanvas = (canvas: HTMLCanvasElement | null) => {
			if (!canvas) return;
			canvas.width = 0;
			canvas.height = 0;
			delete canvas.dataset.drawn;
		};

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
			if (!context) {
				releaseCanvas(canvas);
				return;
			}
			const task = page.render({ canvasContext: context, viewport });
			activeRender = { cell, cancel: () => task.cancel() };
			try {
				await task.promise;
			} finally {
				if (activeRender?.cell === cell) activeRender = null;
			}
			if (!alive || !wanted.has(cell)) {
				releaseCanvas(canvas);
				return;
			}
			canvas.dataset.drawn = "1";
		};
		const pump = async () => {
			if (busy) return;
			busy = true;
			while (alive && wanted.size) {
				let next: HTMLElement | undefined;
				for (const cell of wanted) {
					if (!cell.querySelector("canvas")?.dataset.drawn) {
						next = cell;
						break;
					}
				}
				if (!next) break;
				try {
					await draw(next);
				} catch {
					// A cancelled render (scrolled out of view) stays undrawn so
					// returning to it renders again; a broken page keeps its blank card.
					if (alive && wanted.has(next)) {
						const canvas = next.querySelector("canvas");
						if (canvas) {
							canvas.width = 0;
							canvas.height = 0;
							canvas.dataset.drawn = "1";
						}
					}
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
						if (activeRender?.cell === cell) activeRender.cancel();
						const canvas = cell.querySelector("canvas");
						if (
							canvas &&
							(canvas.dataset.drawn || canvas.width || canvas.height)
						) {
							releaseCanvas(canvas);
						}
					}
				}
				pump();
			},
			{ root: root.parentElement, rootMargin: "300px 0px" },
		);
		for (const cell of root.children) seen.observe(cell);
		// Page 1 is already at the top of the list; skip forcing layout on open.
		const scrollRaf =
			start.current > 1
				? window.requestAnimationFrame(() => {
						root
							.querySelector(`[data-page="${start.current}"]`)
							?.scrollIntoView({ block: "center" });
					})
				: 0;
		return () => {
			alive = false;
			if (scrollRaf) window.cancelAnimationFrame(scrollRaf);
			activeRender?.cancel();
			activeRender = null;
			wanted.clear();
			seen.disconnect();
			for (const canvas of root.querySelectorAll("canvas")) {
				releaseCanvas(canvas);
			}
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
