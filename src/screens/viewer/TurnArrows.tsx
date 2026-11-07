import { t } from "@/lib/i18n";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { type RefObject, useEffect, useRef } from "react";
import s from "./TurnArrows.module.css";

/** How long the arrows stay after the mouse stops. */
const REST_MS = 1800;

/**
 * Previous and next beside pages turned a page at a time, for a mouse.
 * The keys, the wheel and a swipe turn them too, but a reader who knows
 * none of that sees a way on: the arrows come when the mouse moves over
 * the document and step aside when it rests, so they never sit on the
 * page while it is read.
 */
export function TurnArrows({
	of,
	page,
	pages,
	onTurn,
}: {
	/** The document's scroller; the arrows listen on the area around it. */
	of: RefObject<HTMLElement | null>;
	page: number;
	pages: number;
	onTurn: (dir: 1 | -1) => void;
}) {
	const box = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const area = of.current?.parentElement;
		const wrap = box.current;
		if (!area || !wrap) return;
		let timer = 0;
		const rest = () => {
			window.clearTimeout(timer);
			timer = window.setTimeout(() => {
				// Not while the pointer is on an arrow, about to click it.
				if (!wrap.querySelector(":hover")) delete wrap.dataset.on;
				else rest();
			}, REST_MS);
		};
		const onMove = (e: PointerEvent) => {
			if (e.pointerType !== "mouse") return;
			wrap.dataset.on = "";
			rest();
		};
		const onLeave = () => {
			window.clearTimeout(timer);
			delete wrap.dataset.on;
		};
		area.addEventListener("pointermove", onMove, { passive: true });
		area.addEventListener("pointerleave", onLeave);
		return () => {
			window.clearTimeout(timer);
			area.removeEventListener("pointermove", onMove);
			area.removeEventListener("pointerleave", onLeave);
		};
	}, [of]);
	return (
		<div ref={box} className={s.arrows} data-testid="pdf-turn-arrows">
			<button
				type="button"
				className={`${s.arrow} ${s.prev}`}
				disabled={page <= 1}
				onClick={() => onTurn(-1)}
				aria-label={t("Previous page")}
				title={`${t("Previous page")} (←)`}
				data-testid="pdf-prev"
			>
				<ChevronLeft size={22} />
			</button>
			<button
				type="button"
				className={`${s.arrow} ${s.next}`}
				disabled={page >= pages}
				onClick={() => onTurn(1)}
				aria-label={t("Next page")}
				title={`${t("Next page")} (→)`}
				data-testid="pdf-next"
			>
				<ChevronRight size={22} />
			</button>
		</div>
	);
}
