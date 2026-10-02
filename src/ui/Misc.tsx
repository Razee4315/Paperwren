import { type FileFormat, type FormatKind, kindOf } from "@/lib/formats";
import { t, uiDir } from "@/lib/i18n";
import { FileDown } from "lucide-react";
import type { ReactNode } from "react";
import { PageLoader } from "./Art";
import { FileIcon } from "./FileIcon";
import s from "./Misc.module.css";

const KIND_COLOR = {
	pdf: "var(--fmt-pdf)",
	doc: "var(--fmt-doc)",
	sheet: "var(--fmt-sheet)",
	slides: "var(--fmt-slides)",
	text: "var(--fmt-text)",
	image: "var(--fmt-image)",
	other: "var(--fmt-text)",
} as const;

/** A file family's colour; "all" takes the theme's accent. */
export function kindColor(kind: FormatKind | "all"): string {
	return kind === "all" ? "var(--accent)" : KIND_COLOR[kind];
}

export function formatColor(format: FileFormat): string {
	return kindColor(kindOf(format));
}

/** A file's icon at list size, with a playful tilt on hover/press
 * (styled by the parent). */
export function FileBadge({
	format,
	size = 44,
}: {
	format: FileFormat;
	size?: number;
}) {
	return (
		<span className={s.badge} style={{ width: size }}>
			<FileIcon format={format} size={size} />
		</span>
	);
}

/** Shown while files hover over the window. It never takes pointer
 * events, so the drop still reaches the window underneath. */
export function DropHint() {
	return (
		<div className={s.drop} data-testid="drop-hint" aria-hidden="true">
			<div className={s.dropCard}>
				<FileDown size={44} strokeWidth={1.6} />
				<strong>{t("Drop to open")}</strong>
				<span>{t("PDF, Word, Excel, PowerPoint and text files")}</span>
			</div>
		</div>
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

export function Spinner({ label = t("Opening") }: { label?: string }) {
	return <PageLoader label={label} />;
}

/** The opaque full-screen "Opening…" surface. It covers Home the
 * moment a file is chosen, before the viewer code or bytes arrive, so
 * a tap always gets visible feedback. */
export function OpeningView({ name }: { name?: string }) {
	return (
		<div className={s.opening} data-testid="opening">
			<StateView>
				<Spinner label={name ? t("Opening {name}", { name }) : t("Opening")} />
			</StateView>
		</div>
	);
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
		<div className={s.state} dir={uiDir()} data-testid={testId}>
			{icon}
			{title && <p className={s.stateTitle}>{title}</p>}
			{children && <div className={s.stateBody}>{children}</div>}
			{action}
		</div>
	);
}
