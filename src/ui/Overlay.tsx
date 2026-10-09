import { isDesktop } from "@/lib/env";
import { t } from "@/lib/i18n";
import { keys } from "@/lib/keys";
import { useBackClose } from "@/state/navigation";
import { X } from "lucide-react";
import {
	type CSSProperties,
	type ReactNode,
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { IconButton } from "./Button";
import s from "./Overlay.module.css";

/** Open sheets and dialogs; the app is inert while there is one. */
let modals = 0;

/** True while a sheet, menu or dialog is open over the app. */
export const modalOpen = () => modals > 0;

/** Where the pointer last went down, and whether that was a right
 * click: on a desktop a menu opens there, not at the foot of the
 * window. */
let pointer: { x: number; y: number; context: boolean } | null = null;
if (typeof window !== "undefined") {
	window.addEventListener(
		"pointerdown",
		(e) => {
			pointer = { x: e.clientX, y: e.clientY, context: e.button === 2 };
		},
		true,
	);
	window.addEventListener(
		"contextmenu",
		(e) => {
			pointer = { x: e.clientX, y: e.clientY, context: true };
		},
		true,
	);
}

interface Box {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

/** What a menu opening now hangs from: the point of a right click,
 * else the button that has just been pressed. */
function anchorBox(): Box | null {
	const point = pointer && {
		left: pointer.x,
		right: pointer.x,
		top: pointer.y,
		bottom: pointer.y,
	};
	if (pointer?.context) return point;
	const opener = document.activeElement;
	if (opener instanceof HTMLElement && opener !== document.body) {
		const r = opener.getBoundingClientRect();
		if (r.width || r.height) return r;
	}
	return point;
}

const EDGE = 8;
const GAP = 6;

/** Place a menu `w` by `h` against its anchor, inside the window. */
export function placeMenu(
	anchor: Box | null,
	w: number,
	h: number,
	vw: number,
	vh: number,
): { left: number; top: number } {
	if (!anchor) return { left: (vw - w) / 2, top: Math.max(EDGE, (vh - h) / 3) };
	// Hang towards the middle of the window: a button at the right edge
	// opens its menu leftwards.
	const leftwards = (anchor.left + anchor.right) / 2 > vw / 2;
	let left = leftwards ? anchor.right - w : anchor.left;
	left = Math.max(EDGE, Math.min(left, vw - w - EDGE));
	let top = anchor.bottom + GAP;
	if (top + h > vh - EDGE) top = anchor.top - GAP - h;
	if (top < EDGE) top = Math.max(EDGE, vh - h - EDGE);
	return { left, top };
}

/** Trap Tab inside `root`, close on Escape, restore focus on unmount.
 * A dialog that asks for something (a password, a page number) starts
 * in its field, so typing works at once and a phone shows its keyboard. */
function useModalFocus(
	root: React.RefObject<HTMLElement | null>,
	onClose: () => void,
) {
	const closeRef = useRef(onClose);
	closeRef.current = onClose;
	useEffect(() => {
		const opener = document.activeElement as HTMLElement | null;
		const field = root.current?.querySelector<HTMLElement>("input, textarea");
		(field ?? root.current)?.focus();
		// Overlays are portalled beside the app, so the app itself can be
		// taken out of reach of Tab and assistive tech while one is open.
		const app = document.getElementById("root");
		modals++;
		app?.setAttribute("inert", "");
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.stopPropagation();
				closeRef.current();
			} else if (e.key === "Tab" && root.current) {
				const items = root.current.querySelectorAll<HTMLElement>(
					"button:not(:disabled), input, [href], [tabindex]:not([tabindex='-1'])",
				);
				if (!items.length) return;
				const first = items[0];
				const last = items[items.length - 1];
				const at = document.activeElement;
				if (e.shiftKey && (at === first || at === root.current)) {
					e.preventDefault();
					last.focus();
				} else if (!e.shiftKey && at === last) {
					e.preventDefault();
					first.focus();
				}
			}
		};
		window.addEventListener("keydown", onKey, true);
		return () => {
			window.removeEventListener("keydown", onKey, true);
			if (--modals === 0) app?.removeAttribute("inert");
			opener?.focus?.();
		};
	}, [root]);
}

interface PanelProps {
	title: ReactNode;
	onClose: () => void;
	children: ReactNode;
	testId?: string;
}

/** Bottom sheet. Dismiss: scrim tap, Escape, system Back, or a
 * downward drag on the handle area. On a desktop a sheet of actions is
 * a menu beside the button that opened it; `wide` keeps the sheet, for
 * content that needs the room (a grid of pages). */
export function Sheet({
	open,
	title,
	onClose,
	children,
	testId,
	wide = false,
}: PanelProps & { open: boolean; wide?: boolean }) {
	const id = useId();
	useBackClose(`sheet${id}`, open, onClose);
	if (!open) return null;
	const Panel = isDesktop && !wide ? MenuPanel : SheetPanel;
	return createPortal(
		<Panel title={title} onClose={onClose} testId={testId}>
			{children}
		</Panel>,
		document.body,
	);
}

function SheetPanel({ title, onClose, children, testId }: PanelProps) {
	const ref = useRef<HTMLDivElement>(null);
	const [drag, setDrag] = useState(0);
	const start = useRef<number | null>(null);
	useModalFocus(ref, onClose);

	const onDown = (e: React.PointerEvent) => {
		start.current = e.clientY;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	};
	const onMove = (e: React.PointerEvent) => {
		if (start.current !== null) setDrag(Math.max(0, e.clientY - start.current));
	};
	const onUp = () => {
		if (start.current === null) return;
		start.current = null;
		if (drag > 90) onClose();
		else setDrag(0);
	};

	return (
		<>
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: pointer shortcut; Escape and Back close it from the keyboard */}
			<div className={s.scrim} onClick={onClose} aria-hidden="true" />
			<div
				ref={ref}
				className={s.sheet}
				// biome-ignore lint/a11y/useSemanticElements: custom modal; native <dialog> can't do drag-to-dismiss
				role="dialog"
				aria-modal="true"
				aria-label={typeof title === "string" ? title : undefined}
				tabIndex={-1}
				data-testid={testId}
				style={
					drag
						? { transform: `translateY(${drag}px)`, transition: "none" }
						: undefined
				}
			>
				<div
					onPointerDown={onDown}
					onPointerMove={onMove}
					onPointerUp={onUp}
					onPointerCancel={onUp}
				>
					<div className={s.handle} />
					<div className={s.sheetHead}>
						<h2 className={s.sheetTitle}>{title}</h2>
						<IconButton label={t("Close")} onClick={onClose}>
							<X size={20} />
						</IconButton>
					</div>
				</div>
				<div className={s.sheetBody}>{children}</div>
			</div>
		</>
	);
}

/** The desktop form of a sheet of actions: a menu at the pointer. */
function MenuPanel({ title, onClose, children, testId }: PanelProps) {
	const ref = useRef<HTMLDivElement>(null);
	// Read before the menu takes the focus from the button it hangs on.
	const [anchor] = useState(anchorBox);
	const [at, setAt] = useState<CSSProperties>({ visibility: "hidden" });
	useModalFocus(ref, onClose);

	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const place = () =>
			setAt(
				placeMenu(
					anchor,
					el.offsetWidth,
					el.offsetHeight,
					window.innerWidth,
					window.innerHeight,
				),
			);
		place();
		window.addEventListener("resize", place);
		return () => window.removeEventListener("resize", place);
	}, [anchor]);

	/** Up and Down walk the items, as in any menu. */
	const onKey = (e: React.KeyboardEvent) => {
		if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
		const items = [
			...(ref.current?.querySelectorAll<HTMLElement>(
				"button:not(:disabled), input",
			) ?? []),
		];
		if (!items.length) return;
		e.preventDefault();
		const from = items.indexOf(document.activeElement as HTMLElement);
		const step = e.key === "ArrowDown" ? 1 : -1;
		const to = from < 0 ? (step > 0 ? 0 : -1) : from + step;
		items[(to + items.length) % items.length].focus();
	};

	return (
		<>
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: pointer shortcut; Escape closes it from the keyboard */}
			<div
				className={s.veil}
				onClick={onClose}
				onContextMenu={(e) => {
					e.preventDefault();
					onClose();
				}}
				aria-hidden="true"
			/>
			<div
				ref={ref}
				className={s.menu}
				// biome-ignore lint/a11y/useSemanticElements: the same items the sheet holds, as a menu
				role="dialog"
				aria-modal="true"
				aria-label={typeof title === "string" ? title : undefined}
				tabIndex={-1}
				data-testid={testId}
				style={at}
				onKeyDown={onKey}
			>
				{children}
			</div>
		</>
	);
}

export function SheetItem({
	icon,
	children,
	hint,
	shortcut,
	checked,
	danger,
	onClick,
	disabled,
	testId,
}: {
	icon?: ReactNode;
	children: ReactNode;
	hint?: string;
	/** The keys that do the same, shown beside the item on a desktop. */
	shortcut?: string;
	/** A choice that is on (a view mode, a toggle). */
	checked?: boolean;
	danger?: boolean;
	onClick: () => void;
	disabled?: boolean;
	testId?: string;
}) {
	return (
		<button
			type="button"
			className={`${s.item} ${danger ? s.itemDanger : ""} ${checked ? s.itemOn : ""}`}
			onClick={onClick}
			disabled={disabled}
			aria-pressed={checked}
			data-testid={testId}
		>
			{icon}
			<span className={s.itemText}>
				{children}
				{hint && <span className={s.itemHint}>{hint}</span>}
			</span>
			{shortcut && isDesktop && (
				<kbd className={s.itemKeys}>{keys(shortcut)}</kbd>
			)}
		</button>
	);
}

export function Dialog({
	open,
	title,
	children,
	actions,
	onClose,
	testId,
	art,
	alert = false,
}: {
	open: boolean;
	title: string;
	children?: ReactNode;
	actions: ReactNode;
	onClose: () => void;
	testId?: string;
	/** Optional illustration above the title. */
	art?: ReactNode;
	/** An error or a destructive confirmation: announced at once. */
	alert?: boolean;
}) {
	const id = useId();
	useBackClose(`dialog${id}`, open, onClose);
	if (!open) return null;
	return createPortal(
		<DialogPanel
			title={title}
			actions={actions}
			onClose={onClose}
			testId={testId}
			art={art}
			alert={alert}
		>
			{children}
		</DialogPanel>,
		document.body,
	);
}

function DialogPanel({
	title,
	children,
	actions,
	onClose,
	testId,
	art,
	alert,
}: {
	title: string;
	children?: ReactNode;
	actions: ReactNode;
	onClose: () => void;
	testId?: string;
	art?: ReactNode;
	alert: boolean;
}) {
	const ref = useRef<HTMLDivElement>(null);
	useModalFocus(ref, onClose);
	return (
		<>
			<div className={s.scrim} aria-hidden="true" />
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: pointer shortcut; Escape and Back close it from the keyboard */}
			<div className={s.dialogWrap} onClick={onClose}>
				{/* biome-ignore lint/a11y/useKeyWithClickEvents: only stops the click reaching the backdrop */}
				<div
					ref={ref}
					className={s.dialog}
					role={alert ? "alertdialog" : "dialog"}
					aria-modal="true"
					aria-label={title}
					tabIndex={-1}
					onClick={(e) => e.stopPropagation()}
					data-testid={testId}
				>
					{art && <div className={s.dialogArt}>{art}</div>}
					<h2 className={s.dialogTitle}>{title}</h2>
					{children && <div className={s.dialogBody}>{children}</div>}
					<div className={s.dialogActions}>{actions}</div>
				</div>
			</div>
		</>
	);
}

// ---------- Toasts ----------

interface ToastState {
	message: string;
	action?: { label: string; run: () => void };
	key: number;
}

let pushToast: ((t: Omit<ToastState, "key">) => void) | null = null;

/** Show a short message, optionally with one action (e.g. Undo). */
export function toast(message: string, action?: ToastState["action"]) {
	pushToast?.({ message, action });
}

export function ToastHost() {
	const [current, setCurrent] = useState<ToastState | null>(null);
	const show = useCallback(
		(t: Omit<ToastState, "key">) => setCurrent({ ...t, key: Date.now() }),
		[],
	);
	useEffect(() => {
		pushToast = show;
		return () => {
			pushToast = null;
		};
	}, [show]);
	useEffect(() => {
		if (!current) return;
		const t = window.setTimeout(
			() => setCurrent(null),
			current.action ? 5000 : 3000,
		);
		return () => window.clearTimeout(t);
	}, [current]);
	if (!current) return null;
	return (
		// biome-ignore lint/a11y/useSemanticElements: a live region, not form output
		<div className={s.toast} role="status" key={current.key}>
			<span>{current.message}</span>
			{current.action && (
				<button
					type="button"
					className={s.toastAction}
					onClick={() => {
						current.action?.run();
						setCurrent(null);
					}}
				>
					{current.action.label}
				</button>
			)}
		</div>
	);
}
