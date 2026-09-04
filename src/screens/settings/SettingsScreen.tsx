import {
	Button,
	ConfirmDialog,
	Dialog,
	IconButton,
	Toggle,
	showSnackbar,
} from "@/components/ui";
import { backend, formatBytes } from "@/lib/backend";
import type { RecentsLimit, ThemeSetting, ZoomMode } from "@/lib/types";
import { useRecents } from "@/state/RecentsContext";
import { haptic, useSettings } from "@/state/SettingsContext";
import { layout, motion, radius, space, type as typeScale } from "@/theme";
import {
	ArrowLeft,
	ChevronRight,
	FolderCog,
	Info,
	Moon,
	Palette,
	Shield,
} from "lucide-react";
import { useEffect, useState } from "react";
import styled from "styled-components";

/**
 * Settings (docs/08): five groups, instant-apply, no save buttons.
 * The privacy page is intentionally sparse; it is a brand moment.
 */

type Subpage =
	| null
	| "appearance"
	| "viewer"
	| "files"
	| "privacy"
	| "about"
	| "licenses"
	| "policy";

export function SettingsScreen({ onClose }: { onClose: () => void }) {
	const [subpage, setSubpage] = useState<Subpage>(null);

	const titles: Record<NonNullable<Subpage>, string> = {
		appearance: "Appearance",
		viewer: "Viewer defaults",
		files: "Files & storage",
		privacy: "Privacy & security",
		about: "About",
		licenses: "Open-source licenses",
		policy: "Privacy policy",
	};

	return (
		<Page data-testid="settings">
			<AppBar>
				{subpage ? (
					<IconButton label="Back" onClick={() => setSubpage(null)}>
						<ArrowLeft size={22} />
					</IconButton>
				) : (
					<IconButton label="Back" onClick={onClose}>
						<ArrowLeft size={22} />
					</IconButton>
				)}
				<BarTitle>{subpage ? titles[subpage] : "Settings"}</BarTitle>
			</AppBar>

			<Scroll>
				{!subpage && <RootMenu onOpen={setSubpage} />}
				{subpage === "appearance" && <AppearancePage />}
				{subpage === "viewer" && <ViewerPage />}
				{subpage === "files" && <FilesPage />}
				{subpage === "privacy" && (
					<PrivacyPage onOpenPolicy={() => setSubpage("policy")} />
				)}
				{subpage === "about" && <AboutPage onOpen={setSubpage} />}
				{subpage === "licenses" && <LicensesPage />}
				{subpage === "policy" && <PolicyPage />}
			</Scroll>
		</Page>
	);
}

const Page = styled.div`
	position: fixed;
	inset: 0;
	background: var(--bg);
	display: flex;
	flex-direction: column;
	z-index: 30;
	animation: pw-page-in ${motion.dur.fast} ${motion.ease.enter};
	@keyframes pw-page-in {
		from {
			opacity: 0;
			transform: translateX(12px);
		}
	}
`;

const AppBar = styled.header`
	display: flex;
	align-items: center;
	gap: ${space[1]};
	padding: calc(8px + var(--safe-area-top, 0px)) ${space[2]} 8px;
	border-bottom: 1px solid var(--border);
	background: var(--surface);
`;

const BarTitle = styled.h1`
	${typeScale.titleM};
	color: var(--ink-1);
`;

const Scroll = styled.main`
	flex: 1;
	overflow-y: auto;
	padding: ${space[4]} ${space[4]} 48px;
	max-width: ${layout.contentMaxWidth};
	width: 100%;
	margin: 0 auto;
`;

const Group = styled.section`
	margin-bottom: ${space[6]};
`;

const GroupLabel = styled.h2`
	${typeScale.caption};
	text-transform: uppercase;
	letter-spacing: 0.08em;
	color: var(--ink-3);
	margin: ${space[4]} 0 ${space[2]};
`;

const Card = styled.div`
	background: var(--surface);
	border: 1px solid var(--border);
	border-radius: ${radius.l};
	padding: ${space[2]} ${space[4]};
`;

const Row = styled.button`
	display: flex;
	align-items: center;
	gap: ${space[4]};
	width: 100%;
	min-height: ${layout.minTouch};
	padding: ${space[3]} 0;
	background: none;
	border: none;
	border-bottom: 1px solid var(--border);
	cursor: pointer;
	text-align: left;
	font-family: inherit;

	&:last-child {
		border-bottom: none;
	}
	&:hover {
		background: var(--surface-2);
	}
`;

const RowIcon = styled.span`
	color: var(--ink-2);
	display: flex;
	flex-shrink: 0;
`;

const RowText = styled.span`
	flex: 1;
	min-width: 0;
`;

const RowTitle = styled.span`
	${typeScale.titleS};
	color: var(--ink-1);
	display: block;
`;

const RowDesc = styled.span`
	${typeScale.small};
	color: var(--ink-2);
	display: block;
	margin-top: 2px;
`;

const RowValue = styled.span`
	${typeScale.small};
	color: var(--ink-3);
	white-space: nowrap;
`;

const RadioGroup = styled.div`
	display: flex;
	flex-direction: column;
`;

const RadioRow = styled.button<{ $active: boolean }>`
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: ${space[4]};
	min-height: 48px;
	padding: ${space[2]} ${space[2]};
	background: none;
	border: none;
	border-radius: ${radius.m};
	cursor: pointer;
	font-family: inherit;
	${typeScale.body};
	color: ${({ $active }) => ($active ? "var(--accent-strong)" : "var(--ink-1)")};

	&:hover {
		background: var(--surface-2);
	}
`;

const RadioDot = styled.span<{ $active: boolean }>`
	width: 20px;
	height: 20px;
	border-radius: 999px;
	border: 2px solid ${({ $active }) => ($active ? "var(--accent)" : "var(--border)")};
	display: inline-flex;
	align-items: center;
	justify-content: center;
	flex-shrink: 0;

	&::after {
		content: "";
		width: 10px;
		height: 10px;
		border-radius: 999px;
		background: var(--accent);
		transform: ${({ $active }) => ($active ? "scale(1)" : "scale(0)")};
		transition: transform ${motion.dur.fast} ${motion.ease.standard};
	}
`;

const StaticText = styled.p`
	${typeScale.body};
	color: var(--ink-2);
	padding: ${space[3]} 0;
	line-height: 1.6;
`;

function RootMenu({
	onOpen,
}: {
	onOpen: (
		page: "appearance" | "viewer" | "files" | "privacy" | "about",
	) => void;
}) {
	const { settings, resolvedTheme } = useSettings();
	const themeNames: Record<string, string> = {
		paper: "Paper",
		sepia: "Sepia",
		midnight: "Midnight",
		moss: "Moss",
		slate: "Slate",
	};
	const themeLabel = settings["appearance.theme"].startsWith("system")
		? `System (${themeNames[resolvedTheme]})`
		: (themeNames[settings["appearance.theme"]] ?? resolvedTheme);

	return (
		<Group>
			<Card>
				<Row
					onClick={() => onOpen("appearance")}
					data-testid="settings-appearance"
				>
					<RowIcon>
						<Palette size={22} />
					</RowIcon>
					<RowText>
						<RowTitle>Appearance</RowTitle>
						<RowDesc>Theme and display</RowDesc>
					</RowText>
					<RowValue>{themeLabel}</RowValue>
					<ChevronRight size={18} color="var(--ink-3)" />
				</Row>
				<Row onClick={() => onOpen("viewer")}>
					<RowIcon>
						<Moon size={22} />
					</RowIcon>
					<RowText>
						<RowTitle>Viewer defaults</RowTitle>
						<RowDesc>Zoom, position, gestures</RowDesc>
					</RowText>
					<ChevronRight size={18} color="var(--ink-3)" />
				</Row>
				<Row onClick={() => onOpen("files")}>
					<RowIcon>
						<FolderCog size={22} />
					</RowIcon>
					<RowText>
						<RowTitle>Files & storage</RowTitle>
						<RowDesc>Recents and cache</RowDesc>
					</RowText>
					<ChevronRight size={18} color="var(--ink-3)" />
				</Row>
				<Row onClick={() => onOpen("privacy")} data-testid="settings-privacy">
					<RowIcon>
						<Shield size={22} />
					</RowIcon>
					<RowText>
						<RowTitle>Privacy & security</RowTitle>
						<RowDesc>What Paperwren does not collect</RowDesc>
					</RowText>
					<ChevronRight size={18} color="var(--ink-3)" />
				</Row>
				<Row onClick={() => onOpen("about")} data-testid="settings-about">
					<RowIcon>
						<Info size={22} />
					</RowIcon>
					<RowText>
						<RowTitle>About</RowTitle>
						<RowDesc>Version, licenses, policy</RowDesc>
					</RowText>
					<ChevronRight size={18} color="var(--ink-3)" />
				</Row>
			</Card>
		</Group>
	);
}

const THEME_SWATCHES: Record<string, { bg: string; fg: string }> = {
	system: {
		bg: "linear-gradient(135deg, #FAF7F2 50%, #161310 50%)",
		fg: "#D95430",
	},
	light: { bg: "#FAF7F2", fg: "#D95430" },
	sepia: { bg: "#F4EDE1", fg: "#C0562F" },
	dark: { bg: "#161310", fg: "#F06A45" },
	moss: { bg: "#1B2116", fg: "#D9A03F" },
	slate: { bg: "#1A1C20", fg: "#8AA6C4" },
};

const Swatch = styled.span<{ $bg: string; $fg: string }>`
	width: 28px;
	height: 28px;
	border-radius: 999px;
	background: ${({ $bg }) => $bg};
	border: 1px solid var(--border);
	display: inline-flex;
	align-items: center;
	justify-content: center;
	flex-shrink: 0;

	&::after {
		content: "";
		width: 10px;
		height: 14px;
		border-radius: 2px;
		background: ${({ $fg }) => $fg};
		transform: rotate(8deg);
	}
`;

function AppearancePage() {
	const { settings, update, resolvedTheme } = useSettings();
	return (
		<Group>
			<GroupLabel>Theme</GroupLabel>
			<Card>
				<RadioGroup>
					{(
						[
							["system", "Follow system", "Light or dark, as your device"],
							["light", "Paper", "Warm white, the classic look"],
							["sepia", "Sepia", "Soft cream, easy in bright light"],
							["dark", "Midnight", "Warm near-black"],
							["moss", "Moss", "Deep earthy green"],
							["slate", "Slate", "Cool neutral gray"],
						] as [ThemeSetting, string, string][]
					).map(([value, label, hint]) => (
						<RadioRow
							key={value}
							$active={settings["appearance.theme"] === value}
							onClick={() => {
								haptic(settings);
								update("appearance.theme", value);
							}}
						>
							<span>
								<span style={{ display: "block" }}>{label}</span>
								<span
									style={{
										display: "block",
										fontSize: "0.8125rem",
										color: "var(--ink-3)",
									}}
								>
									{hint}
								</span>
							</span>
							<Swatch
								$bg={THEME_SWATCHES[value].bg}
								$fg={THEME_SWATCHES[value].fg}
							/>
							<RadioDot $active={settings["appearance.theme"] === value} />
						</RadioRow>
					))}
				</RadioGroup>
			</Card>
			{resolvedTheme !== "paper" && resolvedTheme !== "sepia" && (
				<>
					<GroupLabel>Dark display</GroupLabel>
					<Card>
						<Toggle
							label="Pure black"
							hint="True black for OLED screens"
							checked={settings["appearance.pure_black"]}
							onChange={(v) => update("appearance.pure_black", v)}
						/>
					</Card>
				</>
			)}
		</Group>
	);
}

function ViewerPage() {
	const { settings, update } = useSettings();
	return (
		<Group>
			<GroupLabel>PDF</GroupLabel>
			<Card>
				<p
					style={{
						padding: "12px 0 4px",
						fontSize: "0.8125rem",
						color: "var(--ink-2)",
					}}
				>
					Default zoom when a document opens
				</p>
				<RadioGroup>
					{(
						[
							["fit_width", "Fit width"],
							["fit_page", "Fit page"],
							["100", "Actual size"],
						] as [ZoomMode, string][]
					).map(([value, label]) => (
						<RadioRow
							key={value}
							$active={settings["viewer.zoom_mode_pdf"] === value}
							onClick={() => update("viewer.zoom_mode_pdf", value)}
						>
							{label}
							<RadioDot $active={settings["viewer.zoom_mode_pdf"] === value} />
						</RadioRow>
					))}
				</RadioGroup>
			</Card>

			<GroupLabel>Reading</GroupLabel>
			<Card>
				<Toggle
					label="Remember position"
					hint="Reopen files where you stopped"
					checked={settings["viewer.remember_position"]}
					onChange={(v) => update("viewer.remember_position", v)}
				/>
				<Toggle
					label="Hide buttons while reading"
					hint="Toolbars fade after 2.5 seconds. Tap the middle of the page to bring them back."
					checked={settings["viewer.chrome_autohide"]}
					onChange={(v) => update("viewer.chrome_autohide", v)}
				/>
				<Toggle
					label="Darken pages"
					hint="Invert page colors in PDFs for night reading"
					checked={settings["viewer.darken_pages"]}
					onChange={(v) => update("viewer.darken_pages", v)}
				/>
				<Toggle
					label="Haptic feedback"
					hint="Light ticks on page changes"
					checked={settings["viewer.haptics"]}
					onChange={(v) => update("viewer.haptics", v)}
				/>
			</Card>
		</Group>
	);
}

function FilesPage() {
	const { settings, update } = useSettings();
	const { clearAll, restore, entries } = useRecents();
	const [cacheBytes, setCacheBytes] = useState<number | null>(null);
	const [confirmClear, setConfirmClear] = useState(false);
	const [confirmRecents, setConfirmRecents] = useState(false);

	useEffect(() => {
		backend
			.cacheStats()
			.then((s) => setCacheBytes(s.bytes))
			.catch(() => setCacheBytes(null));
	}, []);

	return (
		<Group>
			<GroupLabel>Recents</GroupLabel>
			<Card>
				<Toggle
					label="Save recent files"
					hint="When off, the list is cleared and nothing new is recorded"
					checked={settings["files.save_recents"]}
					onChange={(v) => {
						update("files.save_recents", v);
						if (!v) {
							showSnackbar({ message: "Recents cleared and won't be saved." });
						}
					}}
				/>
				<RadioGroup>
					{(
						[
							[20, "Keep 20"],
							[50, "Keep 50"],
							[100, "Keep 100"],
							[-1, "Unlimited"],
						] as [RecentsLimit, string][]
					).map(([value, label]) => (
						<RadioRow
							key={value}
							$active={settings["files.recents_limit"] === value}
							onClick={() => update("files.recents_limit", value)}
						>
							{label}
							<RadioDot $active={settings["files.recents_limit"] === value} />
						</RadioRow>
					))}
				</RadioGroup>
				{entries.length > 0 && (
					<Toggle
						label="Clear recents now"
						hint={`${entries.length} items on this device`}
						checked={false}
						onChange={() => setConfirmRecents(true)}
					/>
				)}
			</Card>

			<GroupLabel>Cache</GroupLabel>
			<Card>
				<Row onClick={() => setConfirmClear(true)}>
					<RowText>
						<RowTitle>Clear cache</RowTitle>
						<RowDesc>
							{cacheBytes === null
								? "Temporary copies of opened files"
								: `${formatBytes(cacheBytes)} of temporary file copies`}
						</RowDesc>
					</RowText>
					<ChevronRight size={18} color="var(--ink-3)" />
				</Row>
			</Card>

			<ConfirmDialog
				open={confirmRecents}
				title="Remove all recents?"
				message="Your recent files list will be cleared. Your files are not touched."
				confirmLabel="Clear"
				variant="destructive"
				onConfirm={() => {
					const previous = clearAll();
					showSnackbar({
						message: "Recents cleared.",
						actionLabel: "Undo",
						onAction: () => restore(previous),
					});
				}}
				onDismiss={() => setConfirmRecents(false)}
			/>

			<ConfirmDialog
				open={confirmClear}
				title="Clear cache?"
				message="Temporary copies of files you opened will be deleted. The originals are not touched."
				confirmLabel="Clear"
				variant="destructive"
				onConfirm={async () => {
					await backend.clearCache();
					const s = await backend.cacheStats();
					setCacheBytes(s.bytes);
					showSnackbar({
						message: `Cache cleared, ${formatBytes(s.bytes)} left.`,
					});
				}}
				onDismiss={() => setConfirmClear(false)}
			/>
		</Group>
	);
}

function PrivacyPage({ onOpenPolicy }: { onOpenPolicy: () => void }) {
	return (
		<Group>
			<Card>
				<StaticText>
					Paperwren has no ads, no accounts, and no analytics. It never connects
					to the internet.
				</StaticText>
				<StaticText>
					Your files are opened on your device, in your device, and stay on your
					device. The recents list and your preferences live in Paperwren's
					private storage, and the cache is deletable from Files & storage.
				</StaticText>
				<StaticText>
					Passwords you type to open protected PDFs are used in memory for that
					session and never saved.
				</StaticText>
				<Row onClick={onOpenPolicy} data-testid="open-policy">
					<RowText>
						<RowTitle>Read the full privacy policy</RowTitle>
					</RowText>
					<ChevronRight size={18} color="var(--ink-3)" />
				</Row>
			</Card>
		</Group>
	);
}

const APP_VERSION = "0.9.0";

function AboutPage({
	onOpen,
}: {
	onOpen: (page: "licenses" | "policy") => void;
}) {
	const [aboutOpen, setAboutOpen] = useState(false);
	return (
		<Group>
			<Card>
				<Row>
					<RowText>
						<RowTitle>Version</RowTitle>
					</RowText>
					<RowValue>{APP_VERSION}</RowValue>
				</Row>
				<Row onClick={() => onOpen("policy")}>
					<RowText>
						<RowTitle>Privacy policy</RowTitle>
					</RowText>
					<ChevronRight size={18} color="var(--ink-3)" />
				</Row>
				<Row onClick={() => onOpen("licenses")} data-testid="open-licenses">
					<RowText>
						<RowTitle>Open-source licenses</RowTitle>
					</RowText>
					<ChevronRight size={18} color="var(--ink-3)" />
				</Row>
				<Row onClick={() => setAboutOpen(true)}>
					<RowText>
						<RowTitle>About Paperwren</RowTitle>
						<RowDesc>A feather-light document viewer</RowDesc>
					</RowText>
				</Row>
			</Card>
			<Dialog
				open={aboutOpen}
				title="Paperwren"
				onDismiss={() => setAboutOpen(false)}
				actions={<Button onClick={() => setAboutOpen(false)}>OK</Button>}
			>
				{`Open anything. Instantly.

Paperwren is the fastest, calmest way to open a document. It does one job, showing you your files, and does it with respect: no ads, no accounts, no tracking, no waiting.`}
			</Dialog>
		</Group>
	);
}

const LICENSES: [string, string][] = [
	["pdf.js", "Apache-2.0 (c) Mozilla and contributors"],
	["SheetJS Community Edition", "Apache-2.0 (c) SheetJS LLC"],
	["Lucide icons", "ISC (c) Lucide Contributors"],
	["Manrope font", "SIL Open Font License 1.1"],
	["Fraunces font", "SIL Open Font License 1.1"],
	["React", "MIT (c) Meta Platforms, Inc. and affiliates"],
	["styled-components", "MIT"],
	["Vite", "MIT (c) Evan You and Vite Contributors"],
	["TypeScript", "Apache-2.0"],
	["Tauri", "MIT or Apache-2.0"],
];

function LicensesPage() {
	return (
		<Group>
			<Card>
				{LICENSES.map(([name, license]) => (
					<Row key={name} onClick={undefined} style={{ cursor: "default" }}>
						<RowText>
							<RowTitle>{name}</RowTitle>
							<RowDesc>{license}</RowDesc>
						</RowText>
					</Row>
				))}
			</Card>
		</Group>
	);
}

function PolicyPage() {
	return (
		<Group>
			<Card>
				<StaticText>
					<strong>
						Paperwren Privacy Policy. Last updated: September 2026.
					</strong>
				</StaticText>
				<StaticText>
					Paperwren is a document viewer. This policy is short because Paperwren
					collects almost nothing.
				</StaticText>
				<StaticText>
					What Paperwren collects: nothing. Paperwren does not collect,
					transmit, sell, or share any personal data. It has no analytics, no
					advertising, no trackers, and it does not connect to the internet.
				</StaticText>
				<StaticText>
					What stays on your device: the recent files list, so the app can show
					it and resume where you stopped. Your settings choices. Temporary
					cache copies of files you open, stored where only Paperwren can read
					them, deleted automatically or by you anytime. Passwords you type to
					open protected PDFs are used in memory for that session and never
					saved.
				</StaticText>
				<StaticText>
					Files you open are read and displayed on your device only. Paperwren
					never uploads them anywhere because it never talks to any server.
				</StaticText>
				<StaticText>
					Permissions: Paperwren requests none. It sees only files you open
					directly or share to it from other apps.
				</StaticText>
				<StaticText>
					Changes: if a future version ever changes any of the above, this
					policy will be updated and the app will tell you before the change
					takes effect.
				</StaticText>
			</Card>
		</Group>
	);
}
