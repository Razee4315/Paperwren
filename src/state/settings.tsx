import { backend } from "@/lib/backend";
import { isDesktop, isTauri } from "@/lib/env";
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

	// Desktop: each open document is a window of its own, and they share
	// the settings. Coming back to a window, take up what was changed in
	// another (the theme, most of all), so that this one does not write
	// its older copy back over it.
	useEffect(() => {
		if (!ready || !isTauri || !isDesktop) return;
		const refresh = () => {
			loadSettings()
				.then((fresh) =>
					setSettings((mine) =>
						JSON.stringify(mine) === JSON.stringify(fresh) ? mine : fresh,
					),
				)
				.catch(() => {});
		};
		window.addEventListener("focus", refresh);
		return () => window.removeEventListener("focus", refresh);
	}, [ready]);

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
		// Android draws the clock and battery over the app's top bar, and
		// picks their colour from the phone's own light or dark mode. The
		// app's theme need not be the phone's: tell the shell which it is.
		try {
			window.__paperwrenAndroidExtras?.systemBars?.(theme === "dark");
		} catch {
			// A shell from before this was added: the phone's choice stands.
		}
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
