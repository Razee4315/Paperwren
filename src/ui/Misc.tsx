import { type FileFormat, formatLabel, kindOf } from "@/lib/formats";
import { FileSpreadsheet, FileText, Presentation } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { PageLoader } from "./Art";
import s from "./Misc.module.css";

const KIND_COLOR = {
	pdf: "var(--fmt-pdf)",
	doc: "var(--fmt-doc)",
	sheet: "var(--fmt-sheet)",
	slides: "var(--fmt-slides)",
	text: "var(--fmt-text)",
	other: "var(--fmt-text)",
} as const;

export function formatColor(format: FileFormat): string {
	return KIND_COLOR[kindOf(format)];
}

/** Format tile: tinted square, family glyph, and the extension. */
export function FileBadge({
	format,
	size = 44,
}: { format: FileFormat; size?: number }) {
	const kind = kindOf(format);
	const Glyph =
		kind === "sheet"
			? FileSpreadsheet
			: kind === "slides"
				? Presentation
				: FileText;
	const label = formatLabel(format).slice(0, 4);
	return (
		<span
			className={s.badge}
			style={
				{
					"--fmt": KIND_COLOR[kind],
					width: size,
					height: size,
					fontSize: size * 0.22,
				} as CSSProperties
			}
			aria-hidden="true"
		>
			<Glyph size={size * 0.38} strokeWidth={2} />
			<span className={s.badgeLabel}>{label}</span>
		</span>
	);
}

export function Switch({
	label,
	hint,
	checked,
	onChange,
	testId,
}: {
	label: string;
	hint?: string;
	checked: boolean;
	onChange: (value: boolean) => void;
	testId?: string;
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			className={s.switchRow}
			onClick={() => onChange(!checked)}
			data-testid={testId}
		>
			<span className={s.switchText}>
				{label}
				{hint && <span className={s.switchHint}>{hint}</span>}
			</span>
			<span
				className={`${s.track} ${checked ? s.on : ""}`}
				aria-hidden="true"
			/>
		</button>
	);
}

export function Spinner({ label = "Opening" }: { label?: string }) {
	return <PageLoader label={label} />;
}

/** Centered full-area message: loading, empty, or error. */
export function StateView({
	icon,
	title,
	children,
	action,
	testId,
}: {
	icon?: ReactNode;
	title?: string;
	children?: ReactNode;
	action?: ReactNode;
	testId?: string;
}) {
	return (
		<div className={s.state} data-testid={testId}>
			{icon}
			{title && <p className={s.stateTitle}>{title}</p>}
			{children && <div className={s.stateBody}>{children}</div>}
			{action}
		</div>
	);
}
