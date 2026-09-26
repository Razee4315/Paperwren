import { ACCENTS, THEMES } from "@/lib/settings";
import type { Accent, ThemeSetting } from "@/lib/types";
import { Check } from "lucide-react";
import type { CSSProperties } from "react";
import s from "./Pickers.module.css";

const THEME_NAMES: Record<ThemeSetting, string> = {
	system: "Auto",
	light: "Light",
	dark: "Dark",
	black: "Black",
	paper: "Paper",
	sepia: "Sepia",
	glass: "Glass",
	aurora: "Aurora",
};

const ACCENT_NAMES: Record<Accent, string> = {
	sunset: "Sunset",
	ocean: "Ocean",
	forest: "Forest",
	berry: "Berry",
	mono: "Mono",
};

/** A tiny Home screen drawn with the theme's own variables. */
function Mock() {
	return (
		<div className={s.mock}>
			<span className={s.mockTitle} />
			{["var(--fmt-pdf)", "var(--fmt-doc)", "var(--fmt-sheet)"].map((c) => (
				<span
					key={c}
					className={s.mockRow}
					style={{ "--c": c } as CSSProperties}
				>
					<i />
					<b />
				</span>
			))}
			<span className={s.mockFab} />
		</div>
	);
}

export function ThemePicker({
	value,
	onChange,
}: {
	value: ThemeSetting;
	onChange: (t: ThemeSetting) => void;
}) {
	return (
		<div className={s.themes} role="radiogroup" aria-label="Theme">
			{THEMES.map((t) => (
				<button
					type="button"
					key={t}
					// biome-ignore lint/a11y/useSemanticElements: visual previews with ARIA radio semantics
					role="radio"
					aria-checked={t === value}
					className={s.theme}
					onClick={() => onChange(t)}
					data-testid={`theme-${t}`}
				>
					<span className={s.preview}>
						{t === "system" ? (
							<>
								<span className={s.half} data-theme="light">
									<Mock />
								</span>
								<span className={s.half} data-theme="dark">
									<Mock />
								</span>
							</>
						) : (
							<span className={s.half} data-theme={t}>
								<Mock />
							</span>
						)}
						{t === value && (
							<span className={s.check}>
								<Check size={13} strokeWidth={3.5} />
							</span>
						)}
					</span>
					{THEME_NAMES[t]}
				</button>
			))}
		</div>
	);
}

export function AccentPicker({
	value,
	onChange,
}: {
	value: Accent;
	onChange: (a: Accent) => void;
}) {
	return (
		<div className={s.swatches} role="radiogroup" aria-label="Colour">
			{ACCENTS.map((a) => (
				<button
					type="button"
					key={a}
					// biome-ignore lint/a11y/useSemanticElements: colour swatches with ARIA radio semantics
					role="radio"
					aria-checked={a === value}
					aria-label={ACCENT_NAMES[a]}
					className={s.swatch}
					data-sw={a}
					onClick={() => onChange(a)}
					data-testid={`accent-${a}`}
				>
					<span className={s.dot}>
						{a === value && <Check size={18} strokeWidth={3} />}
					</span>
					{ACCENT_NAMES[a]}
				</button>
			))}
		</div>
	);
}
