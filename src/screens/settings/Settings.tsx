import { backend, formatBytes } from "@/lib/backend";
import {
	isDesktop,
	isMac,
	isTauri,
	isTouch,
	ownsFrame,
	sharesFrame,
} from "@/lib/env";
import { LANGUAGES, type LanguageSetting, msg, t, tn } from "@/lib/i18n";
import { FULLSCREEN_KEYS, keys } from "@/lib/keys";
import {
	SIGNATURES_KEY,
	STAMPS_KEY,
	loadSignatures,
	loadStamps,
} from "@/lib/signatures";
import type { PageColor, PdfFlow, PdfZoom, ReadingFont } from "@/lib/types";
import { canUpdate, checkForUpdate, useUpdateState } from "@/lib/updates";
import {
	clearBookmarks,
	restoreBookmarks,
	useBookmarkCount,
} from "@/state/bookmarks";
import { useNav } from "@/state/navigation";
import { useRecents } from "@/state/recents";
import { useSettings } from "@/state/settings";
import { Button, Dialog, IconButton, Switch, ThemePicker, toast } from "@/ui";
import {
	ArrowLeft,
	BookOpen,
	Check,
	ChevronDown,
	ChevronUp,
	Copy,
	FolderOpen,
	Info,
	Keyboard,
	Languages,
	Palette,
	RefreshCw,
	ShieldCheck,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useState } from "react";
import s from "./Settings.module.css";

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
	["pdf-lib (Cantoo fork)", "MIT"],
	// The scanner's page finders and the runtime its network runs on.
	["scanic", "MIT"],
	["DocCornerNet (scanic-ml)", "MIT"],
	["ONNX Runtime", "MIT"],
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
const SHORTCUTS: Array<[keys: string, what: string, mac?: string]> = [
	["Ctrl+O", msg("Open a file")],
	["Ctrl+W", msg("Close the document")],
	["Ctrl+F", msg("Find in the document")],
	["F3 · Shift+F3", msg("Next and previous match"), "⌘G · ⇧⌘G"],
	["Ctrl+P", msg("Print")],
	["Ctrl + · Ctrl - · Ctrl 0", msg("Zoom in, zoom out, back to the fit")],
	["F11", msg("Full screen"), FULLSCREEN_KEYS],
	["Space · Page Up · Page Down", msg("Scroll a screen at a time")],
	["Home · End", msg("The start and the end of the document"), "⌘↑ · ⌘↓"],
	["← · →", msg("The previous and the next page or slide")],
	["F5", msg("Start a slide show")],
	["P", msg("Presenter view, in a slide show")],
	["L", msg("Laser pointer, in a slide show")],
	["Ctrl+D", msg("Bookmark this place")],
	["Ctrl+Shift+U", msg("Read aloud")],
	["Ctrl+Tab · Ctrl+Shift+Tab", msg("The next and the previous tab")],
	["Ctrl+] · Ctrl+[", msg("Turn the pages of a PDF")],
	["Ctrl+Page Up · Ctrl+Page Down", msg("The previous and the next sheet")],
	["Alt+←", msg("Back")],
];

function Segmented<T extends string | number>({
	label,
	value,
	options,
	onChange,
	testId,
}: {
	label: string;
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

function Group({ icon, children }: { icon: ReactNode; children: ReactNode }) {
	return (
		<h2 className={s.group}>
			<span className={s.groupIcon}>{icon}</span>
			{children}
		</h2>
	);
}

export function SettingsScreen() {
	const { back } = useNav();
	const { settings, update } = useSettings();
	const { entries, clear, restore, markUnavailable } = useRecents();
	const [stored, setStored] = useState<{ bytes: number; files: number } | null>(
		null,
	);
	const [confirmCopies, setConfirmCopies] = useState(false);
	const bookmarkCount = useBookmarkCount();
	const [signatureCount, setSignatureCount] = useState(0);
	const [stampCount, setStampCount] = useState(0);
	useEffect(() => {
		loadSignatures().then((list) => setSignatureCount(list.length));
		loadStamps().then((list) => setStampCount(list.length));
	}, []);
	const [showLicenses, setShowLicenses] = useState(false);
	const updateStatus = useUpdateState();

	useEffect(() => {
		backend
			.importsStats()
			.then(setStored)
			.catch(() => setStored(null));
	}, []);

	const clearCopies = async () => {
		setConfirmCopies(false);
		await backend.importsClear().catch(() => {});
		for (const e of entries)
			if (e.reopen.kind === "managed") markUnavailable(e.id);
		setStored({ bytes: 0, files: 0 });
		toast(t("Stored copies deleted"));
	};

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
			<main className={s.scroll}>
				<div className={s.column}>
					<Group icon={<Palette size={15} />}>{t("Appearance")}</Group>
					<div className={s.card}>
						<div className={s.field}>
							<span className={s.label}>{t("Theme")}</span>
							<span className={s.fieldHint}>
								{t(
									"Each theme has its own calm colour. Auto follows your device: Paper by day, Ink at night.",
								)}
							</span>
							<ThemePicker
								value={settings.theme}
								onChange={(v) => update("theme", v)}
							/>
						</div>
					</div>

					<Group icon={<Languages size={15} />}>{t("Language")}</Group>
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
									[["system", t("Same as the device")], ...LANGUAGES] as Array<
										[LanguageSetting, string]
									>
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

					<Group icon={<BookOpen size={15} />}>{t("Reading")}</Group>
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
							label={t("Pages scroll")}
							value={settings.pdfFlow}
							onChange={(v) => update("pdfFlow", v)}
							options={[
								["down", t("Down")],
								["across", t("Sideways")],
							]}
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
							<Switch
								label={t("Hide the bars while reading")}
								hint={t("They come back when you scroll back or tap")}
								checked={settings.autoHideBars}
								onChange={(v) => update("autoHideBars", v)}
								testId="auto-hide-bars"
							/>
						)}
						<Switch
							label={t("Keep the screen on")}
							hint={t("While a document is open, the screen won't dim or lock")}
							checked={settings.keepAwake}
							onChange={(v) => update("keepAwake", v)}
							testId="keep-awake"
						/>
					</div>

					<Group icon={<FolderOpen size={15} />}>{t("Files")}</Group>
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
						<button
							type="button"
							className={s.action}
							disabled={bookmarkCount === 0}
							onClick={async () => {
								const previous = await clearBookmarks();
								toast(t("Bookmarks deleted"), {
									label: t("Undo"),
									run: () => restoreBookmarks(previous),
								});
							}}
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
							disabled={signatureCount === 0}
							onClick={async () => {
								const kept = await loadSignatures();
								await backend.storeSet(SIGNATURES_KEY, []).catch(() => {});
								setSignatureCount(0);
								toast(t("Signatures forgotten"), {
									label: t("Undo"),
									run: () =>
										backend
											.storeSet(SIGNATURES_KEY, kept)
											.then(() => setSignatureCount(kept.length))
											.catch(() => {}),
								});
							}}
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
							disabled={stampCount === 0}
							onClick={async () => {
								const kept = await loadStamps();
								await backend.storeSet(STAMPS_KEY, []).catch(() => {});
								setStampCount(0);
								toast(t("Stamps forgotten"), {
									label: t("Undo"),
									run: () =>
										backend
											.storeSet(STAMPS_KEY, kept)
											.then(() => setStampCount(kept.length))
											.catch(() => {}),
								});
							}}
							data-testid="clear-stamps"
						>
							<span className={s.actionText}>
								{t("Forget kept stamps")}
								<span className={s.hint}>{t("Kept only on this device")}</span>
							</span>
						</button>
						<button
							type="button"
							className={s.action}
							disabled={!stored || stored.files === 0}
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
							<Group icon={<Keyboard size={15} />}>{t("Keyboard")}</Group>
							<div className={s.card}>
								<dl className={s.keys} data-testid="shortcuts">
									{SHORTCUTS.map(([combo, what, mac]) => (
										<div key={combo}>
											<dt dir="ltr">{(isMac && mac) || keys(combo)}</dt>
											<dd>{t(what)}</dd>
										</div>
									))}
								</dl>
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
							<Group icon={<RefreshCw size={15} />}>{t("Updates")}</Group>
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

					<Group icon={<ShieldCheck size={15} />}>{t("Privacy")}</Group>
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
									"Files are read on this device. The recent list, your settings and copies of files you open live in private app storage and can be deleted above. Passwords are used once and never saved.",
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

					<Group icon={<Info size={15} />}>{t("About")}</Group>
					<div className={s.card}>
						<div className={s.action}>
							<span className={s.actionText}>Paperwren</span>
							<span className={s.version}>v{VERSION}</span>
						</div>
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
							<span className={s.actionText}>{t("Open-source licenses")}</span>
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
			</main>

			<Dialog
				open={confirmCopies}
				alert
				title={t("Delete stored copies?")}
				onClose={() => setConfirmCopies(false)}
				actions={
					<>
						<Button variant="ghost" onClick={() => setConfirmCopies(false)}>
							{t("Cancel")}
						</Button>
						<Button variant="danger" onClick={clearCopies}>
							{t("Delete")}
						</Button>
					</>
				}
			>
				{t(
					"Files you open are kept as private copies so they can be reopened after the app is closed. Deleting them frees space; those recents will ask you to locate the file again.",
				)}
			</Dialog>
		</div>
	);
}
