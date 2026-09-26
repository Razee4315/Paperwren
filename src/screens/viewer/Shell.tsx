import type { FileFormat } from "@/lib/formats";
import { IconButton, formatColor } from "@/ui";
import { ArrowLeft, ChevronDown, ChevronUp, X } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import s from "./Shell.module.css";

export { s as shellStyles };

/** React 18 has no typed `inert` prop; an empty attribute enables it. */
const inert = (on: boolean) => (on ? ({ inert: "" } as object) : {});

/** Split so the extension stays visible when the name is truncated. */
function Title({ name, format }: { name: string; format: FileFormat }) {
	const dot = name.lastIndexOf(".");
	const hasExt = dot > 0 && name.length - dot <= 6;
	return (
		<span className={s.title} title={name}>
			<span
				className={s.dot}
				style={{ background: formatColor(format) }}
				aria-hidden="true"
			/>
			<span className={s.stem}>{hasExt ? name.slice(0, dot) : name}</span>
			{hasExt && <span className={s.ext}>{name.slice(dot)}</span>}
		</span>
	);
}

export function Shell({
	name,
	format,
	onClose,
	actions,
	bottom,
	find,
	chromeHidden = false,
	children,
	active,
}: {
	name: string;
	format: FileFormat;
	onClose: () => void;
	actions?: ReactNode;
	bottom?: ReactNode;
	find?: ReactNode;
	chromeHidden?: boolean;
	children: ReactNode;
	active: boolean;
}) {
	return (
		<div
			className={s.shell}
			data-testid="viewer"
			style={active ? undefined : { display: "none" }}
		>
			<header
				className={`${s.top} ${chromeHidden ? s.hiddenTop : ""}`}
				{...inert(chromeHidden)}
			>
				<div className={s.row}>
					<IconButton label="Back" onClick={onClose} data-testid="viewer-back">
						<ArrowLeft size={22} />
					</IconButton>
					<Title name={name} format={format} />
					{actions}
				</div>
				{find}
			</header>
			<div className={s.body}>{children}</div>
			{bottom && (
				<footer
					className={`${s.bottom} ${chromeHidden ? s.hiddenBottom : ""}`}
					{...inert(chromeHidden)}
				>
					{bottom}
				</footer>
			)}
		</div>
	);
}

export interface FindState {
	query: string;
	total: number;
	current: number; // 0-based, -1 when none
	busy?: boolean;
}

export function FindBar({
	state,
	onQuery,
	onStep,
	onClose,
}: {
	state: FindState;
	onQuery: (q: string) => void;
	onStep: (dir: 1 | -1) => void;
	onClose: () => void;
}) {
	const input = useRef<HTMLInputElement>(null);
	useEffect(() => input.current?.focus(), []);
	const label = state.busy
		? "…"
		: state.query
			? state.total
				? `${state.current + 1} of ${state.total}`
				: "No results"
			: "";
	return (
		// biome-ignore lint/a11y/useSemanticElements: <search> is not yet in the React DOM typings
		<div className={s.find} role="search">
			<input
				ref={input}
				type="search"
				placeholder="Find in document"
				value={state.query}
				onChange={(e) => onQuery(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter") onStep(e.shiftKey ? -1 : 1);
					if (e.key === "Escape") onClose();
				}}
				aria-label="Find in document"
				data-testid="find-input"
			/>
			<span className={s.findCount} aria-live="polite" data-testid="find-count">
				{label}
			</span>
			<IconButton
				label="Previous match"
				disabled={!state.total}
				onClick={() => onStep(-1)}
			>
				<ChevronUp size={20} />
			</IconButton>
			<IconButton
				label="Next match"
				disabled={!state.total}
				onClick={() => onStep(1)}
				data-testid="find-next"
			>
				<ChevronDown size={20} />
			</IconButton>
			<IconButton label="Close find" onClick={onClose}>
				<X size={20} />
			</IconButton>
		</div>
	);
}
