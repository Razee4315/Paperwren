import { type FormatKind, kindLabel } from "@/lib/formats";
import { t } from "@/lib/i18n";
import { IconButton, kindColor } from "@/ui";
import { Search, X } from "lucide-react";
import type { CSSProperties } from "react";
import s from "./Home.module.css";

/** A file family to show, or all of them. */
export type KindFilter = FormatKind | "all";

const FILTERS: KindFilter[] = [
	"all",
	"pdf",
	"doc",
	"sheet",
	"slides",
	"text",
	"image",
];

/** How many files of each family a list holds ("all" is the total). */
export function countKinds(kinds: FormatKind[]): Record<string, number> {
	const counts: Record<string, number> = { all: kinds.length };
	for (const kind of kinds) counts[kind] = (counts[kind] ?? 0) + 1;
	return counts;
}

/** The filter in force: a family with no files left has no chip any
 * more, so the list goes back to showing all. */
export const filterInForce = (
	filter: KindFilter,
	counts: Record<string, number>,
): KindFilter => (filter !== "all" && !counts[filter] ? "all" : filter);

/** The search box above a list of files. */
export function SearchField({
	value,
	onChange,
	placeholder,
	label,
	testId,
}: {
	value: string;
	onChange: (value: string) => void;
	placeholder: string;
	label: string;
	testId: string;
}) {
	return (
		<label className={s.search}>
			<Search size={18} />
			<input
				type="search"
				placeholder={placeholder}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				aria-label={label}
				data-testid={testId}
			/>
			{value && (
				<IconButton label={t("Clear search")} onClick={() => onChange("")}>
					<X size={18} />
				</IconButton>
			)}
		</label>
	);
}

/** One chip per file family that has files, with its count. */
export function TypeChips({
	counts,
	value,
	onChange,
}: {
	counts: Record<string, number>;
	value: KindFilter;
	onChange: (filter: KindFilter) => void;
}) {
	return (
		<div className={s.chips} role="toolbar" aria-label={t("Filter by type")}>
			{FILTERS.filter((f) => f === "all" || counts[f]).map((f) => (
				<button
					type="button"
					key={f}
					className={s.chip}
					aria-pressed={value === f}
					onClick={() => onChange(f)}
					style={{ "--c": kindColor(f) } as CSSProperties}
					data-testid={`filter-${f}`}
				>
					{f !== "all" && <span className={s.dot} />}
					{f === "all" ? t("All") : kindLabel(f)}
					<span className={s.count}>{counts[f] ?? 0}</span>
				</button>
			))}
		</div>
	);
}
