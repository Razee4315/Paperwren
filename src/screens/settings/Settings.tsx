import { backend, formatBytes } from "@/lib/backend";
import type { PdfZoom } from "@/lib/types";
import { useNav } from "@/state/navigation";
import { useRecents } from "@/state/recents";
import { useSettings } from "@/state/settings";
import { Button, Dialog, IconButton, Switch, ThemePicker, toast } from "@/ui";
import {
	ArrowLeft,
	BookOpen,
	ChevronDown,
	ChevronUp,
	Copy,
	FolderOpen,
	Info,
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
		toast("Stored copies deleted");
	};

	return (
		<div className={s.page} data-testid="settings">
			<header className={s.bar}>
				<IconButton label="Back" onClick={back} data-testid="settings-back">
					<ArrowLeft size={22} />
				</IconButton>
				<h1 className={s.title}>Settings</h1>
			</header>
			<main className={s.scroll}>
				<div className={s.column}>
					<Group icon={<Palette size={15} />}>Appearance</Group>
					<div className={s.card}>
						<div className={s.field}>
							<span className={s.label}>Theme</span>
							<span className={s.fieldHint}>
								Each theme has its own calm colour. Auto follows your phone:
								Paper by day, Ink at night.
							</span>
							<ThemePicker
								value={settings.theme}
								onChange={(v) => update("theme", v)}
							/>
						</div>
					</div>

					<Group icon={<BookOpen size={15} />}>Reading</Group>
					<div className={s.card}>
						<Segmented<PdfZoom>
							label="PDF opens at"
							value={settings.pdfZoom}
							onChange={(v) => update("pdfZoom", v)}
							options={[
								["page-width", "Fit width"],
								["page-fit", "Whole page"],
								["auto", "Automatic"],
							]}
							testId="pdf-zoom"
						/>
						<Switch
							label="Remember where I stopped"
							hint="Reopen files at the same page and zoom"
							checked={settings.rememberPosition}
							onChange={(v) => update("rememberPosition", v)}
						/>
						<Switch
							label="Dark pages"
							hint="Invert PDF pages in the Ink theme for night reading"
							checked={settings.darkPages}
							onChange={(v) => update("darkPages", v)}
							testId="dark-pages"
						/>
					</div>

					<Group icon={<FolderOpen size={15} />}>Files</Group>
					<div className={s.card}>
						<Switch
							label="Keep a list of recent files"
							hint="Stored only on this device"
							checked={settings.keepRecents}
							onChange={(v) => {
								update("keepRecents", v);
								if (!v) toast("Recents cleared and turned off");
							}}
							testId="keep-recents"
						/>
						{settings.keepRecents && (
							<Segmented<number>
								label="Keep up to"
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
								toast("Recents cleared", {
									label: "Undo",
									run: () => restore(previous),
								});
							}}
							data-testid="clear-recents"
						>
							<span className={s.actionText}>
								Clear recent files
								<span className={s.hint}>
									{entries.length} on this device. Your files are not touched.
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
								Delete stored copies
								<span className={s.hint}>
									{stored
										? `${formatBytes(stored.bytes)} in ${stored.files} ${stored.files === 1 ? "file" : "files"} you opened`
										: "Copies of files you opened"}
								</span>
							</span>
						</button>
					</div>

					<Group icon={<ShieldCheck size={15} />}>Privacy</Group>
					<div className={s.card}>
						<div className={s.prose}>
							<p>
								Paperwren never connects to the internet. It has no ads, no
								accounts and no analytics, and it asks for no permissions.
							</p>
							<p>
								Files are read on this device. The recent list, your settings
								and copies of files you open live in private app storage and can
								be deleted above. PDF passwords are used once and never saved.
							</p>
							<p>Full privacy policy: razee4315.github.io/Paperwren/privacy</p>
						</div>
					</div>

					<Group icon={<Info size={15} />}>About</Group>
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
									.then(() => toast("Email address copied"))
									.catch(() => toast(CONTACT))
							}
						>
							<span className={s.actionText}>
								Contact
								<span className={s.hint}>{CONTACT}</span>
							</span>
							<Copy size={18} aria-label="Copy email address" />
						</button>
						<button
							type="button"
							className={s.action}
							onClick={() => setShowLicenses((v) => !v)}
							aria-expanded={showLicenses}
						>
							<span className={s.actionText}>Open-source licenses</span>
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
				title="Delete stored copies?"
				onClose={() => setConfirmCopies(false)}
				actions={
					<>
						<Button variant="ghost" onClick={() => setConfirmCopies(false)}>
							Cancel
						</Button>
						<Button variant="danger" onClick={clearCopies}>
							Delete
						</Button>
					</>
				}
			>
				Files you open are kept as private copies so they can be reopened after
				the app is closed. Deleting them frees space; those recents will ask you
				to locate the file again.
			</Dialog>
		</div>
	);
}
