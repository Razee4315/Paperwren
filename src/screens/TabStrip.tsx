import { backend } from "@/lib/backend";
import { splitName } from "@/lib/fileName";
import { formatFromName } from "@/lib/formats";
import { t, uiDir } from "@/lib/i18n";
import type { OpenRequest } from "@/lib/types";
import { Sheet, SheetDivider, SheetItem, formatColor, toast } from "@/ui";
import { Columns2, FolderOpen, Plus, X } from "lucide-react";
import { type PointerEvent, useRef, useState } from "react";
import s from "./TabStrip.module.css";

export interface Tab {
	key: number;
	request: OpenRequest;
}

/** `list` with the item of `key` moved to index `to` (kept in range). */
export function moveTab<T extends { key: number }>(
	list: T[],
	key: number,
	to: number,
): T[] {
	const from = list.findIndex((item) => item.key === key);
	if (from < 0) return list;
	const at = Math.max(0, Math.min(list.length - 1, to));
	if (at === from) return list;
	const next = list.slice();
	const [item] = next.splice(from, 1);
	next.splice(at, 0, item);
	return next;
}

/**
 * Where a dragged tab would land: the index it takes among the others
 * once the pointer is at `x`. `mids` are the middles of every tab as
 * they stand, in order, the dragged one (at `from`) included. Right to
 * left, the row runs the other way.
 */
export function dropIndex(
	mids: number[],
	from: number,
	x: number,
	rtl: boolean,
): number {
	let passed = 0;
	mids.forEach((mid, i) => {
		if (i !== from && (rtl ? mid > x : mid < x)) passed++;
	});
	return passed;
}

/** A press on a tab that may become a drag. */
interface Press {
	key: number;
	from: number;
	pointer: number;
	x: number;
	mids: number[];
	/** How far its neighbours step aside: its width and the gap. */
	step: number;
	/** How far it may go either way, staying in the row. */
	least: number;
	most: number;
	dragging: boolean;
}

/** Pixels the pointer moves before a press becomes a drag. */
const DRAG_AFTER = 5;

/**
 * The documents open in a desktop window, one tab each: the window's
 * top row, which also moves it and holds its own buttons. A click
 * shows a document, the cross (or the middle button) closes it, and
 * the plus goes back to Home to open another. A tab drags to another
 * place in the row, and a right click offers to close the others, to
 * show it side by side, or to show it in its folder.
 */
export function TabStrip({
	tabs,
	current,
	beside = null,
	onShow,
	onClose,
	onHome,
	onMove,
	onCloseOthers,
	onCloseAfter,
	onBeside,
}: {
	tabs: Tab[];
	current: number | null;
	/** The tab shown beside the current one, side by side. */
	beside?: number | null;
	onShow: (tab: Tab) => void;
	onClose: (tab: Tab) => void;
	onHome: () => void;
	/** Put the tab at index `to`. */
	onMove: (tab: Tab, to: number) => void;
	onCloseOthers: (tab: Tab) => void;
	onCloseAfter: (tab: Tab) => void;
	/** Show the tab beside the one on show, where the window has room. */
	onBeside?: (tab: Tab) => void;
}) {
	const rtl = uiDir() === "rtl";
	const row = useRef<HTMLDivElement>(null);
	const press = useRef<Press | null>(null);
	const [drag, setDrag] = useState<{
		key: number;
		from: number;
		to: number;
		dx: number;
		step: number;
	} | null>(null);
	const [menuFor, setMenuFor] = useState<Tab | null>(null);

	const down = (e: PointerEvent<HTMLDivElement>, tab: Tab, from: number) => {
		if (e.button !== 0 || (e.target as Element).closest(`.${s.close}`)) return;
		const boxes = [
			...(row.current?.querySelectorAll<HTMLElement>(`.${s.tab}`) ?? []),
		].map((el) => el.getBoundingClientRect());
		const box = boxes[from];
		if (!box) return;
		const gap = boxes[1] ? Math.abs(boxes[1].left - boxes[0].right) : 0;
		press.current = {
			key: tab.key,
			from,
			pointer: e.pointerId,
			x: e.clientX,
			mids: boxes.map((b) => (b.left + b.right) / 2),
			step: box.width + gap,
			least: Math.min(...boxes.map((b) => b.left)) - box.left,
			most: Math.max(...boxes.map((b) => b.right)) - box.right,
			dragging: false,
		};
	};
	const move = (e: PointerEvent<HTMLDivElement>) => {
		const p = press.current;
		if (!p || e.pointerId !== p.pointer) return;
		const dx = e.clientX - p.x;
		if (!p.dragging) {
			if (Math.abs(dx) < DRAG_AFTER || tabs.length < 2) return;
			p.dragging = true;
			e.currentTarget.setPointerCapture(p.pointer);
		}
		const kept = Math.max(p.least, Math.min(p.most, dx));
		setDrag({
			key: p.key,
			from: p.from,
			to: dropIndex(p.mids, p.from, p.mids[p.from] + kept, rtl),
			dx: kept,
			step: p.step,
		});
	};
	const up = (tab: Tab) => {
		const p = press.current;
		press.current = null;
		if (!p?.dragging) return;
		const to = drag?.to ?? p.from;
		setDrag(null);
		if (to !== p.from) onMove(tab, to);
		// The tab taken up is the one looked at, as in a browser.
		if (tab.key !== current) onShow(tab);
	};
	const cancel = () => {
		press.current = null;
		setDrag(null);
	};

	/** How far a tab stands aside while another is dragged past it. */
	const shift = (i: number, key: number) => {
		if (!drag) return 0;
		if (key === drag.key) return drag.dx;
		const way = rtl ? -1 : 1;
		if (drag.from < drag.to && i > drag.from && i <= drag.to)
			return -drag.step * way;
		if (drag.to < drag.from && i >= drag.to && i < drag.from)
			return drag.step * way;
		return 0;
	};

	const menuIndex = menuFor
		? tabs.findIndex((tab) => tab.key === menuFor.key)
		: -1;
	const reveal =
		menuFor &&
		backend.abilities({
			name: menuFor.request.name,
			format: formatFromName(menuFor.request.name),
			reopen: menuFor.request.reopen,
		}).reveal;

	return (
		<nav
			className={s.strip}
			dir={uiDir()}
			aria-label={t("Open documents")}
			data-tauri-drag-region="deep"
			data-dragging={drag ? "" : undefined}
			data-testid="tab-strip"
		>
			<div
				ref={row}
				className={s.tabs}
				role="tablist"
				data-tauri-drag-region="deep"
			>
				{tabs.map((tab, i) => {
					const on = tab.key === current;
					const by = shift(i, tab.key);
					return (
						<div
							key={tab.key}
							className={`${s.tab} ${on ? s.on : ""}`}
							data-beside={tab.key === beside || undefined}
							data-lifted={drag?.key === tab.key || undefined}
							// A press here drags the tab, not the window.
							data-tauri-drag-region="false"
							role="presentation"
							style={by ? { transform: `translateX(${by}px)` } : undefined}
							onPointerDown={(e) => down(e, tab, i)}
							onPointerMove={move}
							onPointerUp={() => up(tab)}
							onPointerCancel={cancel}
							onLostPointerCapture={() => press.current?.dragging && cancel()}
							onAuxClick={(e) => {
								if (e.button === 1) onClose(tab);
							}}
							onContextMenu={(e) => {
								e.preventDefault();
								setMenuFor(tab);
							}}
							data-testid="tab"
						>
							<button
								type="button"
								role="tab"
								aria-selected={on}
								className={s.main}
								title={tab.request.name}
								onClick={() => onShow(tab)}
							>
								<span
									className={s.dot}
									style={{
										background: formatColor(formatFromName(tab.request.name)),
									}}
									aria-hidden="true"
								/>
								<span className={s.name} dir="auto">
									<span className={s.stem}>
										{splitName(tab.request.name)[0]}
									</span>
									<span className={s.ext}>
										{splitName(tab.request.name)[1]}
									</span>
								</span>
							</button>
							<button
								type="button"
								className={s.close}
								aria-label={t("Close {name}", { name: tab.request.name })}
								title={t("Close")}
								onClick={() => onClose(tab)}
								data-testid="tab-close"
							>
								<X size={14} />
							</button>
						</div>
					);
				})}
			</div>
			<button
				type="button"
				className={s.home}
				aria-label={t("Open another file")}
				title={t("Open another file")}
				onClick={onHome}
				data-testid="tab-home"
			>
				<Plus size={18} />
			</button>
			<Sheet
				open={menuFor !== null}
				title={menuFor?.request.name ?? ""}
				onClose={() => setMenuFor(null)}
				testId="tab-menu"
			>
				{menuFor && (
					<>
						<SheetItem
							icon={<X size={20} />}
							onClick={() => {
								setMenuFor(null);
								onClose(menuFor);
							}}
							testId="tab-menu-close"
						>
							{t("Close")}
						</SheetItem>
						{tabs.length > 1 && (
							<SheetItem
								icon={<X size={20} />}
								onClick={() => {
									setMenuFor(null);
									onCloseOthers(menuFor);
								}}
								testId="tab-menu-close-others"
							>
								{t("Close other tabs")}
							</SheetItem>
						)}
						{menuIndex >= 0 && menuIndex < tabs.length - 1 && (
							<SheetItem
								icon={<X size={20} />}
								onClick={() => {
									setMenuFor(null);
									onCloseAfter(menuFor);
								}}
								testId="tab-menu-close-after"
							>
								{t("Close tabs after this one")}
							</SheetItem>
						)}
						{((onBeside && menuFor.key !== current) || reveal) && (
							<SheetDivider />
						)}
						{onBeside && menuFor.key !== current && (
							<SheetItem
								icon={<Columns2 size={20} />}
								onClick={() => {
									setMenuFor(null);
									onBeside(menuFor);
								}}
								testId="tab-menu-beside"
							>
								{t("Show side by side")}
							</SheetItem>
						)}
						{reveal && (
							<SheetItem
								icon={<FolderOpen size={20} />}
								onClick={() => {
									const tab = menuFor;
									setMenuFor(null);
									backend
										.reveal({
											name: tab.request.name,
											format: formatFromName(tab.request.name),
											reopen: tab.request.reopen,
										})
										.catch(() => toast(t("Couldn't show the folder")));
								}}
								testId="tab-menu-reveal"
							>
								{t("Show in folder")}
							</SheetItem>
						)}
					</>
				)}
			</Sheet>
		</nav>
	);
}
