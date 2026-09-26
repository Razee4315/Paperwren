import { THEMES } from "@/lib/settings";
import type { ThemeSetting } from "@/lib/types";
import { Check } from "lucide-react";
import type { CSSProperties } from "react";
import s from "./Pickers.module.css";

const THEME_NAMES: Record<ThemeSetting, string> = {
	system: "Auto",
	light: "Paper",
	sepia: "Sand",
	dark: "Ink",
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
