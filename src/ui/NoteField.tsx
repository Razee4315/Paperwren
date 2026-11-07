import { isDesktop } from "@/lib/env";
import { t, uiDir } from "@/lib/i18n";
import { keys } from "@/lib/keys";
import s from "./NoteField.module.css";

/** The words a note is about, set off in the mark's own colour. */
export function NoteQuote({ text, color }: { text: string; color?: string }) {
	return (
		<blockquote
			className={s.quote}
			dir="auto"
			style={color ? { borderInlineStartColor: color } : undefined}
		>
			{text.length > 160 ? `${text.slice(0, 160)}…` : text}
		</blockquote>
	);
}

/**
 * Where a note is written: a roomy box, ready for typing, that keeps
 * the note with Ctrl+Enter on a desktop (Enter makes a new line).
 */
export function NoteField({
	value,
	onChange,
	onSubmit,
	label,
	testId,
	rows = 5,
}: {
	value: string;
	onChange: (value: string) => void;
	onSubmit?: () => void;
	label: string;
	testId?: string;
	rows?: number;
}) {
	return (
		<div className={s.wrap}>
			<textarea
				className={s.field}
				rows={rows}
				// Empty, it reads the interface's way (the hint is in its
				// language); written in, the way its own words go.
				dir={value ? "auto" : uiDir()}
				// biome-ignore lint/a11y/noAutofocus: the dialog exists to take these words
				autoFocus
				aria-label={label}
				placeholder={t("Write your note here")}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				onKeyDown={(e) => {
					if (
						onSubmit &&
						e.key === "Enter" &&
						(e.ctrlKey || e.metaKey) &&
						!e.nativeEvent.isComposing
					) {
						e.preventDefault();
						onSubmit();
					}
				}}
				data-testid={testId}
			/>
			{isDesktop && onSubmit && (
				<span className={s.hint} aria-hidden="true">
					{keys("Ctrl+Enter")}
				</span>
			)}
		</div>
	);
}
