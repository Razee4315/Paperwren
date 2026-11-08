import { msg, t } from "@/lib/i18n";
import {
	FIXED,
	type FixedId,
	SHORTCUTS,
	type ShortcutId,
	comboOf,
	fixedLabel,
	isReserved,
	keysFor,
	shortcutLabel,
	whoHas,
} from "@/lib/shortcuts";
import { useSettings } from "@/state/settings";
import { IconButton, toast } from "@/ui";
import { RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import s from "./Settings.module.css";

/** A shortcut the reader can change, or keys that stay as they are. */
type Row = ShortcutId | { fixed: FixedId };

/** Every shortcut, by what it is for. */
const GROUPS: Array<[title: string, rows: Row[]]> = [
	[
		msg("Documents"),
		["open", "close", { fixed: "tabs" }, "print", "fullscreen", "keys"],
	],
	[
		msg("Moving around"),
		[
			"nextPage",
			"prevPage",
			{ fixed: "scroll" },
			{ fixed: "ends" },
			"goToPage",
			"find",
			{ fixed: "findNext" },
			"zoomIn",
			"zoomOut",
			"zoomReset",
			{ fixed: "back" },
		],
	],
	[
		msg("Reading and marking"),
		[
			"highlight",
			"note",
			"draw",
			"addText",
			{ fixed: "undo" },
			{ fixed: "remove" },
			"rotate",
			"rotateLeft",
			"twoPages",
			"bookmark",
			"readAloud",
		],
	],
	[
		msg("Slides and sheets"),
		["slideShow", "presenter", "laser", { fixed: "sheets" }],
	],
];

/** Keys as small key caps. */
function Caps({ list }: { list: string[] }) {
	if (!list.length) return <span className={s.noKeys}>{t("No keys")}</span>;
	return (
		<span className={s.caps} dir="ltr">
			{list.map((combo) => (
				<kbd key={combo}>{shortcutLabel(combo)}</kbd>
			))}
		</span>
	);
}

/**
 * The keyboard shortcuts, as they are now. In Settings (`editable`) a
 * shortcut is changed by clicking it and pressing the new keys; keys
 * another shortcut had move over (with Undo), and keys kept for typing
 * or scrolling are refused. A changed one can be reset, or left with no
 * keys at all (a tool that sends them for something else).
 */
export function ShortcutList({ editable = false }: { editable?: boolean }) {
	const { settings, update } = useSettings();
	const custom = settings.shortcuts;
	const [recording, setRecording] = useState<ShortcutId | null>(null);
	const recorder = useRef<HTMLButtonElement>(null);

	const save = (next: typeof custom, before: typeof custom, said?: string) => {
		update("shortcuts", next);
		if (said)
			toast(said, { label: t("Undo"), run: () => update("shortcuts", before) });
	};

	// While a shortcut listens, the next keys pressed are its: nothing
	// else in the app hears them.
	useEffect(() => {
		if (!recording) return;
		recorder.current?.focus();
		const onKey = (e: KeyboardEvent) => {
			e.preventDefault();
			e.stopPropagation();
			if (e.key === "Escape" || e.key === "Tab") {
				setRecording(null);
				return;
			}
			const combo = comboOf(e);
			if (!combo) return;
			if (isReserved(combo)) {
				toast(
					t(
						"{keys} is kept for scrolling, typing or closing. Try other keys.",
						{
							keys: shortcutLabel(combo),
						},
					),
				);
				return;
			}
			const before = custom;
			const next = { ...before, [recording]: [combo] };
			const other = whoHas(combo, before, recording);
			if (other)
				next[other] = keysFor(other, before).filter((k) => k !== combo);
			setRecording(null);
			save(
				next,
				before,
				other
					? t("{keys} now does this instead of: {what}", {
							keys: shortcutLabel(combo),
							what: t(SHORTCUTS[other].what),
						})
					: undefined,
			);
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	});

	const changed = Object.keys(custom).length > 0;

	return (
		<div className={s.keyGroups} data-testid="shortcuts">
			{editable && (
				<p className={s.keysHelp}>
					{t(
						"Click a shortcut, then press the keys you want for it. Keys in dashed boxes stay as they are.",
					)}
				</p>
			)}
			{GROUPS.map(([title, rows]) => (
				<section key={title}>
					<h3 className={s.keyGroup}>{t(title)}</h3>
					<dl className={s.keys}>
						{rows.map((row) => {
							if (typeof row !== "string")
								return (
									<div key={row.fixed}>
										<dt>{t(FIXED[row.fixed].what)}</dt>
										<dd>
											<span className={s.caps} dir="ltr">
												<kbd className={s.fixedCaps}>
													{fixedLabel(row.fixed)}
												</kbd>
											</span>
										</dd>
									</div>
								);
							const id = row;
							const what = t(SHORTCUTS[id].what);
							const list = keysFor(id, custom);
							const own = id in custom;
							// Full screen also has a key of its own (F11, ⌃⌘F).
							const also =
								id === "fullscreen" ? fixedLabel("fullscreenKey") : null;
							return (
								<div key={id} data-testid={`shortcut-${id}`}>
									<dt>{what}</dt>
									<dd>
										{also && (
											<span className={s.caps} dir="ltr">
												<kbd className={s.fixedCaps}>{also}</kbd>
											</span>
										)}
										{editable ? (
											<>
												<button
													ref={recording === id ? recorder : undefined}
													type="button"
													className={s.combo}
													data-recording={recording === id ? "" : undefined}
													data-records-keys={recording === id ? "" : undefined}
													aria-label={t("Change the keys for {what}", { what })}
													aria-live="polite"
													onClick={() =>
														setRecording(recording === id ? null : id)
													}
													onBlur={() => {
														if (recording === id) setRecording(null);
													}}
													data-testid={`shortcut-${id}-change`}
												>
													{recording === id ? (
														<span className={s.listening}>
															{t("Press the new keys")}
														</span>
													) : (
														<Caps list={list} />
													)}
												</button>
												{list.length > 0 && (
													<IconButton
														label={t("Remove the keys for {what}", { what })}
														onClick={() =>
															save({ ...custom, [id]: [] }, custom)
														}
														data-testid={`shortcut-${id}-remove`}
													>
														<X size={15} />
													</IconButton>
												)}
												{own && (
													<IconButton
														label={t("Reset {what}", { what })}
														onClick={() => {
															const { [id]: _, ...rest } = custom;
															save(rest, custom);
														}}
														data-testid={`shortcut-${id}-reset`}
													>
														<RotateCcw size={15} />
													</IconButton>
												)}
											</>
										) : (
											<Caps list={list} />
										)}
									</dd>
								</div>
							);
						})}
					</dl>
				</section>
			))}
			{editable && changed && (
				<button
					type="button"
					className={s.keysReset}
					onClick={() =>
						save({}, custom, t("Every shortcut has its own keys again"))
					}
					data-testid="shortcuts-reset-all"
				>
					<RotateCcw size={16} />
					{t("Reset all shortcuts")}
				</button>
			)}
		</div>
	);
}
