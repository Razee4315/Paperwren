import { t } from "@/lib/i18n";
import { useBackClose } from "@/state/navigation";
import { X } from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { IconButton } from "./Button";
import s from "./Overlay.module.css";

/** Trap Tab inside `root`, close on Escape, restore focus on unmount. */
function useModalFocus(
	root: React.RefObject<HTMLElement | null>,
	onClose: () => void,
) {
	const closeRef = useRef(onClose);
	closeRef.current = onClose;
	useEffect(() => {
		const opener = document.activeElement as HTMLElement | null;
		root.current?.focus();
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
				if (e.shiftKey && document.activeElement === first) {
					e.preventDefault();
					last.focus();
				} else if (!e.shiftKey && document.activeElement === last) {
					e.preventDefault();
					first.focus();
				}
			}
		};
		window.addEventListener("keydown", onKey, true);
		return () => {
			window.removeEventListener("keydown", onKey, true);
			opener?.focus?.();
		};
	}, [root]);
}

/** Bottom sheet. Dismiss: scrim tap, Escape, system Back, or a
 * downward drag on the handle area. */
export function Sheet({
	open,
	title,
	onClose,
	children,
	testId,
}: {
	open: boolean;
	title: ReactNode;
	onClose: () => void;
	children: ReactNode;
	testId?: string;
}) {
	const id = useId();
	useBackClose(`sheet${id}`, open, onClose);
	if (!open) return null;
	return createPortal(
		<SheetPanel title={title} onClose={onClose} testId={testId}>
			{children}
		</SheetPanel>,
		document.body,
	);
}

function SheetPanel({
	title,
	onClose,
	children,
	testId,
}: {
	title: ReactNode;
	onClose: () => void;
	children: ReactNode;
	testId?: string;
}) {
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

export function SheetItem({
	icon,
	children,
	hint,
	danger,
	onClick,
	disabled,
	testId,
}: {
	icon?: ReactNode;
	children: ReactNode;
	hint?: string;
	danger?: boolean;
	onClick: () => void;
	disabled?: boolean;
	testId?: string;
}) {
	return (
		<button
			type="button"
			className={`${s.item} ${danger ? s.itemDanger : ""}`}
			onClick={onClick}
			disabled={disabled}
			data-testid={testId}
		>
			{icon}
			<span className={s.itemText}>
				{children}
				{hint && <span className={s.itemHint}>{hint}</span>}
			</span>
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
}: {
	open: boolean;
	title: string;
	children?: ReactNode;
	actions: ReactNode;
	onClose: () => void;
	testId?: string;
	/** Optional illustration above the title. */
	art?: ReactNode;
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
}: {
	title: string;
	children?: ReactNode;
	actions: ReactNode;
	onClose: () => void;
	testId?: string;
	art?: ReactNode;
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
					role="alertdialog"
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
