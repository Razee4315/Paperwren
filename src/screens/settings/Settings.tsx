import { backend, formatBytes } from "@/lib/backend";
import { clearAllMarks, loadMarkList, restoreMarks } from "@/lib/docMarks";
import { isDesktop, isTauri, isTouch, ownsFrame, sharesFrame } from "@/lib/env";
import { LANGUAGES, type LanguageSetting, msg, t, tn } from "@/lib/i18n";
import { scrollBehavior } from "@/lib/motion";
import { clearReads, readCount } from "@/lib/ocrStore";
import { PAGE_VIEWS } from "@/lib/pageViews";
import {
	forgetAllSignatures,
	forgetAllStamps,
	loadSignatures,
	loadStamps,
	restoreSignatures,
	restoreStamps,
} from "@/lib/signatures";
import type {
	PageColor,
	PdfFlow,
	PdfZoom,
	ReadingBars,
	ReadingFont,
} from "@/lib/types";
import { canUpdate, checkForUpdate, useUpdateState } from "@/lib/updates";
import {
	clearBookmarks,
	restoreBookmarks,
	useBookmarkCount,
} from "@/state/bookmarks";
import { useNavActions } from "@/state/navigation";
import { useRecents } from "@/state/recents";
import { useSettings } from "@/state/settings";
import {
	Button,
	Dialog,
	IconButton,
	Sheet,
	Switch,
	ThemePicker,
	ownsKeys,
	toast,
} from "@/ui";
import {
	ArrowLeft,
	BookOpen,
	Check,
	ChevronDown,
	ChevronRight,
	ChevronUp,
	Copy,
	FolderOpen,
	Glasses,
	HardDrive,
	Info,
	Keyboard,
	Languages,
	Palette,
	RefreshCw,
	ShieldCheck,
} from "lucide-react";
import type { CSSProperties, ReactNode, RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import s from "./Settings.module.css";
import { ShortcutList } from "./ShortcutList";
import { WhatsNew } from "./WhatsNew";

const VERSION = import.meta.env.VITE_APP_VERSION ?? "dev";
const CONTACT = "saqlainrazee@gmail.com";
const PRIVACY_POLICY = "razee4315.github.io/Paperwren/privacy";

/** Put a value on the clipboard and say so; where there is no
 * clipboard, show the value itself so it can still be read off. */
function copy(value: string, done: string) {
	if (!navigator.clipboard) {
		toast(value);
		return;
	}
	navigator.clipboard
		.writeText(value)
		.then(() => toast(done))
		.catch(() => toast(value));
}

/** What each choice of "Bars while reading" does, said under it. */
const READING_BARS_HINTS: Record<ReadingBars, string> = {
	always: msg("They stay, unless you tap the page"),
	scroll: msg(
		"They go as you read on, and come back when you scroll back or tap",
	),
	tap: msg("They go as you read on, and only a tap brings them back"),
};

const LICENSES: Array<[string, string]> = [
	["pdf.js", "Apache-2.0"],
	["docx-preview", "Apache-2.0"],
	["SheetJS Community Edition", "Apache-2.0"],
	["fflate", "MIT"],
	["marked", "MIT"],
	["DOMPurify", "Apache-2.0 / MPL-2.0"],
	["highlight.js", "BSD-3-Clause"],
	["UTIF.js", "MIT"],
	["KaTeX", "MIT"],
	// 3D models (.glb).
	["three.js", "MIT"],
	["pdf-lib (Cantoo fork)", "MIT"],
	// The scanner's page finders and the runtime its network runs on.
	["scanic", "MIT"],
	["DocCornerNet (scanic-ml)", "MIT"],
	["ONNX Runtime", "MIT"],
	// HEIC photos where the system has no decoder (Windows).
	["libheif, libde265 (libheif-js)", "LGPL-3.0"],
	["pako", "MIT / Zlib"],
	["React", "MIT"],
	["Lucide icons", "ISC"],
	["Manrope", "SIL OFL 1.1"],
	// The stand-ins for the fonts Office documents name (office-fonts.css).
	["Carlito", "SIL OFL 1.1"],
	["Caladea", "SIL OFL 1.1"],
	["Arimo", "SIL OFL 1.1"],
	["Tinos", "SIL OFL 1.1"],
	["Cousine", "SIL OFL 1.1"],
	// What pdf.js draws with when a PDF names a font it does not carry.
	["Liberation Sans", "SIL OFL 1.1"],
	["PDFium base-14 fonts (Foxit)", "BSD-3-Clause"],
	["Adobe CMap resources", "BSD-3-Clause"],
	["Tauri", "MIT / Apache-2.0"],
];

/** What the keyboard does, said once where a reader can find it. The
 * keys are written the Windows way and shown as the machine has them
 * (lib/keys.ts); a third entry is what a Mac presses instead. */
function Segmented<T extends string | number>({
	label,
	hint,
	value,
	options,
	onChange,
	testId,
}: {
	label: string;
	/** A line under the label: what the choice on show does. */
	hint?: string;
	value: T;
	options: Array<[T, string]>;
	onChange: (v: T) => void;
	testId?: string;
}) {
	return (
		<div className={s.field}>
			<span className={s.label} id={`${testId}-label`}>
				{label}
			</span>
			{hint && (
				<span className={s.fieldHint} data-testid={`${testId}-hint`}>
					{hint}
				</span>
			)}
			<div
				className={s.segmented}
				role="radiogroup"
				aria-labelledby={`${testId}-label`}
				style={
					{
						"--n": options.length,
						"--i": Math.max(
							0,
							options.findIndex(([v]) => v === value),
						),
					} as CSSProperties
				}
			>
				<span className={s.thumb} aria-hidden="true" />
				{options.map(([v, text]) => (
					<button
						type="button"
						key={String(v)}
						// biome-ignore lint/a11y/useSemanticElements: segmented control styled as buttons, ARIA radio semantics
						role="radio"
						aria-checked={v === value}
						className={s.segment}
						onClick={() => onChange(v)}
						data-testid={`${testId}-${v}`}
					>
						{text}
					</button>
				))}
			</div>
		</div>
	);
}

function Group({
	icon,
	children,
	id,
}: {
	icon: ReactNode;
	children: ReactNode;
	/** A section the list of sections jumps to (sub-groups have none). */
	id?: SectionId;
}) {
	return (
		<h2
			className={s.group}
			id={id ? `settings-${id}` : undefined}
			data-section={id}
		>
			<span className={s.groupIcon}>{icon}</span>
			{children}
		</h2>
	);
}

type SectionId =
	| "appearance"
	| "language"
	| "reading"
	| "files"
	| "keyboard"
	| "updates"
	| "privacy"
	| "about";

/** Settings is long: its sections, listed beside it on a wide window
 * and as a row of chips above it on a narrow one. The one being read is
 * marked as it scrolls by, and a click goes to any of them. */
function SectionList({
	sections,
	scroller,
}: {
	sections: Array<{ id: SectionId; label: string; icon: ReactNode }>;
	scroller: RefObject<HTMLElement | null>;
}) {
	const [current, setCurrent] = useState<SectionId>(sections[0].id);
	const list = useRef<HTMLElement>(null);
	const scrolledFor = useRef(current);
	// A section chosen by clicking stays highlighted during smooth travel
	// and at the foot of the page until the reader scrolls manually.
	const pinned = useRef<SectionId | null>(null);
	const scrolling = useRef(false);
	const lockTimer = useRef(0);
	useEffect(() => {
		const box = scroller.current;
		if (!box) return;
		let frame = 0;
		const read = () => {
			frame = 0;
			if (scrolling.current || pinned.current !== null) return;
			const top = box.getBoundingClientRect().top;
			const heads = [...box.querySelectorAll<HTMLElement>("h2[data-section]")];
			// At the foot of the page the last one is being read, however
			// short it is.
			const atEnd =
				box.scrollTop + box.clientHeight >= box.scrollHeight - 4 &&
				box.scrollTop > 0;
			let on = heads[0]?.dataset.section;
			for (const head of heads)
				if (head.getBoundingClientRect().top - top < box.clientHeight * 0.3)
					on = head.dataset.section;
			if (atEnd) on = heads[heads.length - 1]?.dataset.section;
			if (on) setCurrent(on as SectionId);
		};
		const onScroll = () => {
			if (scrolling.current || pinned.current !== null) return;
			if (!frame) frame = requestAnimationFrame(read);
		};
		const onScrollEnd = () => {
			window.clearTimeout(lockTimer.current);
			scrolling.current = false;
		};
		const unlockManual = () => {
			if (!scrolling.current && pinned.current === null) return;
			window.clearTimeout(lockTimer.current);
			scrolling.current = false;
			pinned.current = null;
		};
		const onTouchStart = (e: TouchEvent) => {
			if (list.current?.contains(e.target as Node)) return;
			unlockManual();
		};
		const onPointerDown = (e: PointerEvent) => {
			if (list.current?.contains(e.target as Node)) return;
			// Dragging the scroller's scrollbar, touching, or middle-click scrolling.
			if (e.target === box || e.pointerType === "touch" || e.button === 1) {
				unlockManual();
			}
		};
		const onKeyDown = (e: KeyboardEvent) => {
			if (!ownsKeys()) return;
			if (
				e.key !== "ArrowUp" &&
				e.key !== "ArrowDown" &&
				e.key !== "PageUp" &&
				e.key !== "PageDown" &&
				e.key !== "Home" &&
				e.key !== "End" &&
				e.key !== " "
			) {
				return;
			}
			const target = e.target as HTMLElement | null;
			if (target?.closest("input, textarea, select")) return;
			if (
				e.key === " " &&
				target?.closest(
					"button, [role='button'], [role='switch'], [role='radio']",
				)
			) {
				return;
			}
			unlockManual();
		};
		// The first section is the one on show when freshly mounted; only
		// measure section headings once the reader scrolls, avoiding an early
		// synchronous layout on mount.
		box.addEventListener("scroll", onScroll, { passive: true });
		box.addEventListener("scrollend", onScrollEnd);
		box.addEventListener("wheel", unlockManual, { passive: true });
		box.addEventListener("touchstart", onTouchStart, { passive: true });
		box.addEventListener("pointerdown", onPointerDown, { passive: true });
		window.addEventListener("keydown", onKeyDown);
		return () => {
			cancelAnimationFrame(frame);
			window.clearTimeout(lockTimer.current);
			box.removeEventListener("scroll", onScroll);
			box.removeEventListener("scrollend", onScrollEnd);
			box.removeEventListener("wheel", unlockManual);
			box.removeEventListener("touchstart", onTouchStart);
			box.removeEventListener("pointerdown", onPointerDown);
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [scroller]);
	// The chip being read stays in view in the row. Skip the initial mount
	// (the first chip is already in view) so we don't force a layout before
	// Settings paints.
	useEffect(() => {
		if (scrolledFor.current === current) return;
		scrolledFor.current = current;
		const row = list.current;
		const chip = row?.querySelector<HTMLElement>(
			`[data-testid="section-${current}"]`,
		);
		if (!row || !chip || row.scrollWidth <= row.clientWidth) return;
		const left = chip.offsetLeft - (row.clientWidth - chip.offsetWidth) / 2;
		row.scrollTo({ left, behavior: scrollBehavior() });
	}, [current]);
	const go = (id: SectionId) => {
		setCurrent(id);
		pinned.current = id;
		window.clearTimeout(lockTimer.current);
		const behavior = scrollBehavior();
		if (behavior === "smooth") {
			scrolling.current = true;
			lockTimer.current = window.setTimeout(() => {
				scrolling.current = false;
			}, 800);
		} else {
			scrolling.current = false;
		}
		document.getElementById(`settings-${id}`)?.scrollIntoView({
			block: "start",
			behavior,
		});
	};
	return (
		<nav ref={list} className={s.sections} aria-label={t("Settings")}>
			{sections.map(({ id, label, icon }) => (
				<button
					type="button"
					key={id}
					className={s.sectionLink}
					aria-current={id === current}
					onClick={() => go(id)}
					data-testid={`section-${id}`}
				>
					{icon}
					{label}
				</button>
			))}
		</nav>
	);
}

export function SettingsScreen() {
	const { back } = useNavActions();
	const { settings, update } = useSettings();
	const { entries, clear, restore, settle, markUnavailable } = useRecents();
	const [stored, setStored] = useState<{ bytes: number; files: number } | null>(
		null,
	);
	const [confirmCopies, setConfirmCopies] = useState(false);
	const bookmarkCount = useBookmarkCount();
	const [signatureCount, setSignatureCount] = useState(0);
	const [markedCount, setMarkedCount] = useState(0);
	const [stampCount, setStampCount] = useState(0);
	const [newsOpen, setNewsOpen] = useState(false);
	useEffect(() => {
		let alive = true;
		Promise.all([
			loadMarkList().catch(() => []),
			readCount().catch(() => 0),
			loadSignatures().catch(() => []),
			loadStamps().catch(() => []),
			backend.importsStats().catch(() => null),
		]).then(([list, reads, sigs, stamps, stats]) => {
			if (!alive) return;
			setMarkedCount(Math.max(list.length, reads));
			setSignatureCount(sigs.length);
			setStampCount(stamps.length);
			setStored(stats);
		});
		return () => {
			alive = false;
		};
	}, []);
	const [showLicenses, setShowLicenses] = useState(false);
	const [keysOpen, setKeysOpen] = useState(false);
	const updateStatus = useUpdateState();
	const scroller = useRef<HTMLElement>(null);
	// Esc leaves Settings on a computer, as it closes any page laid over
	// another. Nothing is lost: every choice is kept as it is made.
	useEffect(() => {
		if (!isDesktop) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape" || e.defaultPrevented || !ownsKeys()) return;
			e.preventDefault();
			back();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [back]);
	const sections: Array<{ id: SectionId; label: string; icon: ReactNode }> = [
		{ id: "appearance", label: t("Appearance"), icon: <Palette size={16} /> },
		{ id: "language", label: t("Language"), icon: <Languages size={16} /> },
		{ id: "reading", label: t("Reading"), icon: <BookOpen size={16} /> },
		{ id: "files", label: t("Files"), icon: <FolderOpen size={16} /> },
		...(isDesktop
			? [
					{
						id: "keyboard" as const,
						label: t("Keyboard"),
						icon: <Keyboard size={16} />,
					},
				]
			: []),
		...(canUpdate
			? [
					{
						id: "updates" as const,
						label: t("Updates"),
						icon: <RefreshCw size={16} />,
					},
				]
			: []),
		{ id: "privacy", label: t("Privacy"), icon: <ShieldCheck size={16} /> },
		{ id: "about", label: t("About"), icon: <Info size={16} /> },
	];

	const clearing = useRef(false);
	const [clearBusy, setClearBusy] = useState(false);
	const savedAction = async (action: () => Promise<void>) => {
		if (clearing.current) return;
		clearing.current = true;
		setClearBusy(true);
		try {
			await action();
		} catch {
			toast(t("Couldn't change saved data"));
		} finally {
			clearing.current = false;
			setClearBusy(false);
		}
	};
	const clearCopies = () =>
		savedAction(async () => {
			await backend.importsClear();
			setConfirmCopies(false);
			for (const e of entries)
				if (e.reopen.kind === "managed") markUnavailable(e.id);
			setStored({ bytes: 0, files: 0 });
			toast(t("Stored copies deleted"));
		});

	return (
		<div className={s.page} data-testid="settings">
			<header className={s.bar} data-tauri-drag-region="deep">
				<IconButton
					label={t("Back")}
					onClick={back}
					data-testid="settings-back"
				>
					<ArrowLeft size={22} className="pw-flip" />
				</IconButton>
				<h1 className={s.title}>{t("Settings")}</h1>
			</header>
			<main className={s.scroll} ref={scroller}>
				<div className={s.layout}>
					<SectionList sections={sections} scroller={scroller} />
					<div className={s.column}>
						<Group icon={<Palette size={15} />} id="appearance">
							{t("Appearance")}
						</Group>
						<div className={s.card}>
							<div className={s.field}>
								<span className={s.label}>{t("Theme")}</span>
								<span className={s.fieldHint}>
									{t(
										"Each theme has its own calm colour. Auto follows your device: Light by day, Dark at night.",
									)}
								</span>
								<ThemePicker
									value={settings.theme}
									onChange={(v) => update("theme", v)}
								/>
							</div>
						</div>

						<Group icon={<Languages size={15} />} id="language">
							{t("Language")}
						</Group>
						<div className={s.card}>
							<div className={s.field}>
								<span className={s.label} id="language-label">
									{t("Language")}
								</span>
								<span className={s.fieldHint}>
									{t(
										"The language of Paperwren's own buttons and messages. Your documents are shown as they are.",
									)}
								</span>
								<div
									className={s.choices}
									role="radiogroup"
									aria-labelledby="language-label"
								>
									{(
										[
											["system", t("Same as the device")],
											...LANGUAGES,
										] as Array<[LanguageSetting, string]>
									).map(([value, name]) => (
										<button
											type="button"
											key={value}
											// biome-ignore lint/a11y/useSemanticElements: a list of choices styled as rows, ARIA radio semantics
											role="radio"
											aria-checked={settings.language === value}
											className={s.choice}
											// Each language is written in its own script and direction.
											lang={value === "system" ? undefined : value}
											dir="auto"
											onClick={() => update("language", value)}
											data-testid={`language-${value}`}
										>
											{name}
											{settings.language === value && <Check size={18} />}
										</button>
									))}
								</div>
							</div>
						</div>

						<Group icon={<BookOpen size={15} />} id="reading">
							{t("Reading")}
						</Group>
						<div className={s.card}>
							<Segmented<PdfZoom>
								label={t("PDF opens at")}
								value={settings.pdfZoom}
								onChange={(v) => update("pdfZoom", v)}
								options={[
									["page-width", t("Fit width")],
									["page-fit", t("Whole page")],
									["auto", t("Automatic")],
								]}
								testId="pdf-zoom"
							/>
							<Segmented<PdfFlow>
								label={t("Page view")}
								hint={t(
									PAGE_VIEWS.find((view) => view.value === settings.pdfFlow)
										?.hint ?? PAGE_VIEWS[0].hint,
								)}
								value={settings.pdfFlow}
								onChange={(v) => update("pdfFlow", v)}
								options={PAGE_VIEWS.map(({ value, name }) => [value, t(name)])}
								testId="pdf-flow"
							/>
							<Switch
								label={t("Remember where I stopped")}
								hint={t("Reopen files at the same page and zoom")}
								checked={settings.rememberPosition}
								onChange={(v) => update("rememberPosition", v)}
							/>
							<Segmented<PageColor>
								label={t("Page colour")}
								value={settings.pageColor}
								onChange={(v) => update("pageColor", v)}
								options={[
									["original", t("Original")],
									["sepia", t("Sepia")],
									["dark", t("Dark")],
									// Paper's white, Sand's warm page, Ink's dark one.
									["theme", t("Theme")],
								]}
								testId="page-color"
							/>
							<Segmented<ReadingFont>
								label={t("Reading font")}
								value={settings.readingFont}
								onChange={(v) => update("readingFont", v)}
								options={[
									["original", t("As written")],
									["serif", t("Serif")],
									["sans", t("Sans serif")],
								]}
								testId="reading-font"
							/>
						</div>

						<Group icon={<Glasses size={15} />}>{t("While reading")}</Group>
						<div className={s.card}>
							{!!window.__paperwrenAndroidExtras?.volumeKeys && (
								<Switch
									label={t("Turn pages with the volume keys")}
									hint={t("Down for the next page, up for the one before")}
									checked={settings.volumeKeys}
									onChange={(v) => update("volumeKeys", v)}
									testId="volume-keys"
								/>
							)}
							{isTouch && (
								<Switch
									label={t("Tap the sides to turn pages")}
									hint={t("The left edge goes back, the right edge on")}
									checked={settings.tapToTurn}
									onChange={(v) => update("tapToTurn", v)}
									testId="tap-to-turn"
								/>
							)}
							{!isDesktop && (
								<Segmented<ReadingBars>
									label={t("Bars while reading")}
									hint={t(READING_BARS_HINTS[settings.readingBars])}
									value={settings.readingBars}
									onChange={(v) => update("readingBars", v)}
									options={[
										["always", t("Always")],
										["scroll", t("Auto-hide")],
										["tap", t("Tap only")],
									]}
									testId="reading-bars"
								/>
							)}
							<Switch
								label={t("Open the last document at start")}
								hint={t("Go back to what you were reading when the app opens")}
								checked={settings.reopenLast}
								onChange={(v) => update("reopenLast", v)}
								testId="reopen-last"
							/>
							<Switch
								label={t("Keep the screen on")}
								hint={t(
									"While a document is open, the screen won't dim or lock",
								)}
								checked={settings.keepAwake}
								onChange={(v) => update("keepAwake", v)}
								testId="keep-awake"
							/>
						</div>

						<Group icon={<FolderOpen size={15} />} id="files">
							{t("Files")}
						</Group>
						<div className={s.card}>
							<Switch
								label={t("Keep a list of recent files")}
								hint={t("Stored only on this device")}
								checked={settings.keepRecents}
								onChange={(v) => {
									if (v) {
										update("keepRecents", true);
										return;
									}
									// One tap must not cost the whole list: it can be undone.
									const previous = clear();
									update("keepRecents", false);
									toast(t("Recents cleared and turned off"), {
										label: t("Undo"),
										run: () => {
											update("keepRecents", true);
											restore(previous);
										},
										onExpire: () => settle(previous),
									});
								}}
								testId="keep-recents"
							/>
							{settings.keepRecents && (
								<Segmented<number>
									label={t("Keep up to")}
									value={settings.recentsLimit}
									onChange={(v) => update("recentsLimit", v)}
									options={[
										[20, "20"],
										[50, "50"],
										[100, "100"],
										[500, "500"],
									]}
									testId="limit"
								/>
							)}
							<button
								type="button"
								className={s.action}
								disabled={entries.length === 0}
								onClick={() => {
									const previous = clear();
									toast(t("Recents cleared"), {
										label: t("Undo"),
										run: () => restore(previous),
										onExpire: () => settle(previous),
									});
								}}
								data-testid="clear-recents"
							>
								<span className={s.actionText}>
									{t("Clear recent files")}
									<span className={s.hint}>
										{t("{n} on this device. Your files are not touched.", {
											n: entries.length,
										})}
									</span>
								</span>
							</button>
						</div>

						<Group icon={<HardDrive size={15} />}>
							{t("Saved on this device")}
						</Group>
						<div className={s.card}>
							<button
								type="button"
								className={s.action}
								disabled={clearBusy || bookmarkCount === 0}
								onClick={() =>
									savedAction(async () => {
										const previous = await clearBookmarks();
										toast(t("Bookmarks deleted"), {
											label: t("Undo"),
											run: () =>
												savedAction(async () => {
													await restoreBookmarks(previous);
												}),
										});
									})
								}
								data-testid="clear-bookmarks"
							>
								<span className={s.actionText}>
									{t("Delete bookmarks")}
									<span className={s.hint}>
										{tn(
											bookmarkCount,
											"{n} bookmark, kept only on this device",
											"{n} bookmarks, kept only on this device",
										)}
									</span>
								</span>
							</button>
							<button
								type="button"
								className={s.action}
								disabled={clearBusy || markedCount === 0}
								onClick={() =>
									savedAction(async () => {
										const previous = await clearAllMarks();
										await clearReads();
										setMarkedCount(0);
										toast(t("Highlights deleted"), {
											label: t("Undo"),
											run: () =>
												savedAction(async () =>
													restoreMarks(previous).then((count) =>
														setMarkedCount(count),
													),
												),
										});
									})
								}
								data-testid="clear-marks"
							>
								<span className={s.actionText}>
									{t("Delete highlights and notes on documents")}
									<span className={s.hint}>
										{tn(
											markedCount,
											"In {n} document, kept only on this device",
											"In {n} documents, kept only on this device",
										)}
									</span>
								</span>
							</button>
							<button
								type="button"
								className={s.action}
								disabled={clearBusy || signatureCount === 0}
								onClick={() =>
									savedAction(async () => {
										const kept = await forgetAllSignatures();
										setSignatureCount(0);
										toast(t("Signatures forgotten"), {
											label: t("Undo"),
											run: () =>
												savedAction(async () => {
													await restoreSignatures(kept);
													setSignatureCount(kept.length);
												}),
										});
									})
								}
								data-testid="clear-signatures"
							>
								<span className={s.actionText}>
									{t("Forget kept signatures")}
									<span className={s.hint}>
										{tn(
											signatureCount,
											"{n} signature or initials, kept only on this device",
											"{n} signatures and initials, kept only on this device",
										)}
									</span>
								</span>
							</button>
							<button
								type="button"
								className={s.action}
								disabled={clearBusy || stampCount === 0}
								onClick={() =>
									savedAction(async () => {
										const kept = await forgetAllStamps();
										setStampCount(0);
										toast(t("Stamps forgotten"), {
											label: t("Undo"),
											run: () =>
												savedAction(async () => {
													await restoreStamps(kept);
													setStampCount(kept.length);
												}),
										});
									})
								}
								data-testid="clear-stamps"
							>
								<span className={s.actionText}>
									{t("Forget kept stamps")}
									<span className={s.hint}>
										{t("Kept only on this device")}
									</span>
								</span>
							</button>
							<button
								type="button"
								className={s.action}
								disabled={clearBusy || !stored || stored.files === 0}
								onClick={() => setConfirmCopies(true)}
							>
								<span className={s.actionText}>
									{t("Delete stored copies")}
									<span className={s.hint}>
										{stored
											? tn(
													stored.files,
													"{size} in {n} file you opened",
													"{size} in {n} files you opened",
													{ size: formatBytes(stored.bytes) },
												)
											: t("Copies of files you opened")}
									</span>
								</span>
							</button>
						</div>

						{isDesktop && (
							<>
								<Group icon={<Keyboard size={15} />} id="keyboard">
									{t("Keyboard")}
								</Group>
								<div className={s.card}>
									<button
										type="button"
										className={s.action}
										onClick={() => setKeysOpen(true)}
										data-testid="shortcuts-open"
									>
										<span className={s.actionText}>
											{t("Keyboard shortcuts")}
											<span className={s.hint}>
												{t(
													"Change any of them, or press ? while reading to see them",
												)}
											</span>
										</span>
										<ChevronRight size={18} className="pw-flip" />
									</button>
								</div>
								{isTauri && (ownsFrame || sharesFrame) && (
									<div className={s.card}>
										<div className={s.prose}>
											<p>
												{sharesFrame
													? t(
															"To open documents with Paperwren by a double-click, select one in Finder, choose File, then Get Info, and pick Paperwren under Open with.",
														)
													: t(
															"To open documents with Paperwren by a double-click, choose it in Windows Settings, under Apps, Default apps.",
														)}
											</p>
										</div>
									</div>
								)}
							</>
						)}

						{canUpdate && (
							<>
								<Group icon={<RefreshCw size={15} />} id="updates">
									{t("Updates")}
								</Group>
								<div className={s.card}>
									<Switch
										label={t("Check for updates automatically")}
										hint={t(
											"When it starts, Paperwren asks GitHub for a new version.",
										)}
										checked={settings.updates === "auto"}
										onChange={(v) => update("updates", v ? "auto" : "off")}
										testId="updates-auto"
									/>
									<button
										type="button"
										className={s.action}
										onClick={() => checkForUpdate(false)}
										disabled={updateStatus.phase === "checking"}
										data-testid="updates-check"
									>
										<span className={s.actionText}>
											{t("Check for updates")}
											<span className={s.hint} aria-live="polite">
												{updateStatus.phase === "checking"
													? t("Checking for updates")
													: updateStatus.phase === "latest"
														? t("You have the latest version")
														: updateStatus.phase === "failed"
															? t("Couldn't check for updates")
															: `v${VERSION}`}
											</span>
										</span>
									</button>
								</div>
							</>
						)}

						<Group icon={<ShieldCheck size={15} />} id="privacy">
							{t("Privacy")}
						</Group>
						<div className={s.card}>
							<div className={s.prose}>
								<p>
									{canUpdate
										? t(
												"Paperwren goes online only to check for updates, and only if you allow it. It has no ads, no accounts and no analytics, and it asks for no permissions.",
											)
										: t(
												"Paperwren never connects to the internet. It has no ads, no accounts and no analytics, and it asks for no permissions.",
											)}
								</p>
								<p>
									{t(
										"Files are read on this device. The recent list, your highlights and notes, your settings and copies of files you open live in private app storage and can be deleted above. Passwords are used once and never saved.",
									)}
								</p>
							</div>
							{/* The app opens no web pages: the address is there to copy. */}
							<button
								type="button"
								className={s.action}
								onClick={() =>
									copy(`https://${PRIVACY_POLICY}`, t("Link copied"))
								}
								data-testid="privacy-policy"
							>
								<span className={s.actionText}>
									{t("Privacy policy")}
									<span className={s.hint} dir="ltr">
										{PRIVACY_POLICY}
									</span>
								</span>
								<Copy size={18} aria-label={t("Copy link")} />
							</button>
						</div>

						<Group icon={<Info size={15} />} id="about">
							{t("About")}
						</Group>
						<div className={s.card}>
							<div className={s.action}>
								<span className={s.actionText}>Paperwren</span>
								<span className={s.version}>v{VERSION}</span>
							</div>
							<button
								type="button"
								className={s.action}
								onClick={() => setNewsOpen(true)}
								data-testid="whats-new-open"
							>
								<span className={s.actionText}>{t("What's new")}</span>
							</button>
							<button
								type="button"
								className={s.action}
								onClick={() => copy(CONTACT, t("Email address copied"))}
							>
								<span className={s.actionText}>
									{t("Contact")}
									<span className={s.hint}>{CONTACT}</span>
								</span>
								<Copy size={18} aria-label={t("Copy email address")} />
							</button>
							<button
								type="button"
								className={s.action}
								onClick={() => setShowLicenses((v) => !v)}
								aria-expanded={showLicenses}
							>
								<span className={s.actionText}>
									{t("Open-source licenses")}
								</span>
								{showLicenses ? (
									<ChevronUp size={18} />
								) : (
									<ChevronDown size={18} />
								)}
							</button>
							{showLicenses && (
								<ul className={s.licenses}>
									{LICENSES.map(([name, license]) => (
										<li key={name}>
											<span>{name}</span>
											<span>{license}</span>
										</li>
									))}
								</ul>
							)}
						</div>
					</div>
				</div>
			</main>

			<Dialog
				open={confirmCopies}
				alert
				title={t("Delete stored copies?")}
				onClose={() => setConfirmCopies(false)}
				actions={
					confirmCopies ? (
						<>
							<Button variant="ghost" onClick={() => setConfirmCopies(false)}>
								{t("Cancel")}
							</Button>
							<Button
								variant="danger"
								onClick={clearCopies}
								disabled={clearBusy}
								aria-busy={clearBusy}
							>
								{t("Delete")}
							</Button>
						</>
					) : undefined
				}
			>
				{confirmCopies &&
					t(
						"Files you open are kept as private copies so they can be reopened after the app is closed. Deleting them frees space; those recents will ask you to locate the file again.",
					)}
			</Dialog>
			<WhatsNew open={newsOpen} onClose={() => setNewsOpen(false)} />
			<Sheet
				open={keysOpen}
				title={t("Keyboard shortcuts")}
				onClose={() => setKeysOpen(false)}
				wide
				testId="shortcuts-sheet"
			>
				{keysOpen && <ShortcutList editable />}
			</Sheet>
		</div>
	);
}
