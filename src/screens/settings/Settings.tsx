import { backend, formatBytes } from "@/lib/backend";
import { LANGUAGES, type LanguageSetting, t, tn } from "@/lib/i18n";
import type { PdfZoom } from "@/lib/types";
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
	Languages,
	Palette,
	ShieldCheck,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useState } from "react";
import s from "./Settings.module.css";

const VERSION = import.meta.env.VITE_APP_VERSION ?? "dev";
const CONTACT = "saqlainrazee@gmail.com";

const LICENSES: Array<[string, string]> = [
	["pdf.js", "Apache-2.0"],
	["docx-preview", "Apache-2.0"],
	["SheetJS Community Edition", "Apache-2.0"],
	["fflate", "MIT"],
	["marked", "MIT"],
	["DOMPurify", "Apache-2.0 / MPL-2.0"],
	["React", "MIT"],
	["Lucide icons", "ISC"],
	["Manrope", "SIL OFL 1.1"],
	// The stand-ins for the fonts Office documents name (office-fonts.css).
	["Carlito", "SIL OFL 1.1"],
	["Caladea", "SIL OFL 1.1"],
	["Arimo", "SIL OFL 1.1"],
	["Tinos", "SIL OFL 1.1"],
	["Cousine", "SIL OFL 1.1"],
	["Tauri", "MIT / Apache-2.0"],
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
	const [showLicenses, setShowLicenses] = useState(false);

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
			<header className={s.bar}>
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
								["page-width", t(t("Fit width"))],
								["page-fit", t(t("Whole page"))],
								["auto", t(t("Automatic"))],
							]}
							testId="pdf-zoom"
						/>
						<Switch
							label={t("Remember where I stopped")}
							hint={t("Reopen files at the same page and zoom")}
							checked={settings.rememberPosition}
							onChange={(v) => update("rememberPosition", v)}
						/>
						<Switch
							label={t("Dark pages")}
							hint={t("Invert PDF pages in the Ink theme for night reading")}
							checked={settings.darkPages}
							onChange={(v) => update("darkPages", v)}
							testId="dark-pages"
						/>
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
								update("keepRecents", v);
								if (!v) toast(t("Recents cleared and turned off"));
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
									label: t(t("Undo")),
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
										: t(t("Copies of files you opened"))}
								</span>
							</span>
						</button>
					</div>

					<Group icon={<ShieldCheck size={15} />}>{t("Privacy")}</Group>
					<div className={s.card}>
						<div className={s.prose}>
							<p>
								{t(
									"Paperwren never connects to the internet. It has no ads, no accounts and no analytics, and it asks for no permissions.",
								)}
							</p>
							<p>
								{t(
									"Files are read on this device. The recent list, your settings and copies of files you open live in private app storage and can be deleted above. Passwords are used once and never saved.",
								)}
							</p>
							<p>
								{t("Full privacy policy: {url}", {
									url: "razee4315.github.io/Paperwren/privacy",
								})}
							</p>
						</div>
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
							onClick={() =>
								navigator.clipboard
									?.writeText(CONTACT)
									.then(() => toast(t("Email address copied")))
									.catch(() => toast(CONTACT))
							}
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
