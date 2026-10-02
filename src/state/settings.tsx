import { backend } from "@/lib/backend";
import { loadLanguage, resolveLanguage, setLanguage } from "@/lib/i18n";
import {
	migrateLegacySettings,
	normalizeSettings,
	resolveTheme,
} from "@/lib/settings";
import {
	DEFAULT_SETTINGS,
	type ResolvedTheme,
	STORAGE_KEYS,
	type Settings,
} from "@/lib/types";
import {
	type ReactNode,
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";

interface SettingsApi {
	settings: Settings;
	ready: boolean;
	update: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
	theme: ResolvedTheme;
}

const SettingsContext = createContext<SettingsApi | null>(null);

const THEME_COLOR: Record<ResolvedTheme, string> = {
	light: "#f3f1ec",
	sepia: "#ede3d0",
	dark: "#16181b",
};

function systemPrefersDark() {
	return (
		typeof window !== "undefined" &&
		window.matchMedia?.("(prefers-color-scheme: dark)").matches
	);
}

export async function loadSettings(): Promise<Settings> {
	const stored = await backend
		.storeGet(STORAGE_KEYS.settings)
		.catch(() => null);
	if (stored) return normalizeSettings(stored);
	const legacy = await backend
		.storeGet(STORAGE_KEYS.legacySettings)
		.catch(() => null);
	const migrated = legacy
		? migrateLegacySettings(legacy)
		: { ...DEFAULT_SETTINGS };
	if (legacy) backend.storeSet(STORAGE_KEYS.settings, migrated).catch(() => {});
	return migrated;
}

export function SettingsProvider({ children }: { children: ReactNode }) {
	const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
	const [ready, setReady] = useState(false);
	const [systemDark, setSystemDark] = useState(systemPrefersDark);

	useEffect(() => {
		let alive = true;
		loadSettings().then((s) => {
			if (!alive) return;
			setSettings(s);
			setReady(true);
		});
		return () => {
			alive = false;
		};
	}, []);

	useEffect(() => {
		const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
		if (!mq) return;
		const on = (e: MediaQueryListEvent) => setSystemDark(e.matches);
		mq.addEventListener("change", on);
		return () => mq.removeEventListener("change", on);
	}, []);

	const theme = resolveTheme(settings.theme, systemDark);
	useEffect(() => {
		document.documentElement.dataset.theme = theme;
		document
			.querySelector('meta[name="theme-color"]')
			?.setAttribute("content", THEME_COLOR[theme]);
	}, [theme]);

	// The interface language follows the setting as soon as it is known
	// and its table is in. A later choice wins over a slower load.
	useEffect(() => {
		if (!ready) return;
		let alive = true;
		const lang = resolveLanguage(settings.language);
		loadLanguage(lang)
			.then(() => alive && setLanguage(lang))
			.catch(() => {});
		return () => {
			alive = false;
		};
	}, [ready, settings.language]);

	const update = useCallback(
		<K extends keyof Settings>(key: K, value: Settings[K]) => {
			setSettings((prev) => {
				const next = { ...prev, [key]: value };
				backend.storeSet(STORAGE_KEYS.settings, next).catch(() => {});
				return next;
			});
		},
		[],
	);

	const api = useMemo(
		() => ({ settings, ready, update, theme }),
		[settings, ready, update, theme],
	);
	return (
		<SettingsContext.Provider value={api}>{children}</SettingsContext.Provider>
	);
}

export function useSettings(): SettingsApi {
	const ctx = useContext(SettingsContext);
	if (!ctx) throw new Error("useSettings must be used inside SettingsProvider");
	return ctx;
}
