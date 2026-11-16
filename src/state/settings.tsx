import { backend } from "@/lib/backend";
import { isDesktop, isTauri } from "@/lib/env";
import { loadLanguage, resolveLanguage, setLanguage } from "@/lib/i18n";
import {
	hintTheme,
	hintedTheme,
	isDarkTheme,
	migrateLegacySettings,
	normalizeSettings,
	resolveTheme,
} from "@/lib/settings";
import { setCustomShortcuts } from "@/lib/shortcuts";
import {
	DEFAULT_SETTINGS,
	type ResolvedTheme,
	STORAGE_KEYS,
	type Settings,
} from "@/lib/types";
import { paintWindowBackground } from "@/lib/windowBackground";
import {
	type ReactNode,
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
	useSyncExternalStore,
} from "react";
import { type Store, createStore, usePick, useSelect } from "./store";

interface SettingsApi {
	settings: Settings;
	ready: boolean;
	update: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
	theme: ResolvedTheme;
}

const SettingsContext = createContext<SettingsApi | null>(null);

interface SettingsStores {
	values: Store<Settings>;
	ready: Store<boolean>;
	/** The device is in dark mode (for the theme "system"). */
	systemDark: Store<boolean>;
}
/** The stores and `update`, which never change: no reader is drawn again
 * through this context. */
const SettingsStoresContext = createContext<
	(SettingsStores & { update: SettingsApi["update"] }) | null
>(null);

const THEME_COLOR: Record<ResolvedTheme, string> = {
	light: "#f3f1ec",
	sepia: "#ede3d0",
	dark: "#16181b",
	"plain-light": "#ffffff",
	"plain-dark": "#0e0e10",
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
	// Held in stores, so that a reader of one setting is not drawn again
	// when another changes (useSetting); useSettings still hears them all.
	const [stores] = useState<SettingsStores>(() => {
		// Until the settings are read, the theme last used (index.html has
		// already applied it), so the first render does not switch it back
		// to the default.
		const theme = hintedTheme();
		const values = createStore(
			theme ? { ...DEFAULT_SETTINGS, theme } : DEFAULT_SETTINGS,
		);
		// The keys every handler checks: set as the settings are read, so
		// a change applies to the very next key press.
		setCustomShortcuts(values.get().shortcuts);
		values.subscribe(() => setCustomShortcuts(values.get().shortcuts));
		return {
			values,
			ready: createStore(false),
			systemDark: createStore(!!systemPrefersDark()),
		};
	});
	const settings = useSyncExternalStore(
		stores.values.subscribe,
		stores.values.get,
	);
	const ready = useSyncExternalStore(stores.ready.subscribe, stores.ready.get);
	const systemDark = useSyncExternalStore(
		stores.systemDark.subscribe,
		stores.systemDark.get,
	);

	useEffect(() => {
		let alive = true;
		loadSettings().then((s) => {
			if (!alive) return;
			stores.values.set(s);
			stores.ready.set(true);
		});
		return () => {
			alive = false;
		};
	}, [stores]);

	// Desktop: each open document is a window of its own, and they share
	// the settings. Coming back to a window, take up what was changed in
	// another (the theme, most of all), so that this one does not write
	// its older copy back over it.
	useEffect(() => {
		if (!ready || !isTauri || !isDesktop) return;
		const refresh = () => {
			loadSettings()
				.then((fresh) => {
					const mine = stores.values.get();
					if (JSON.stringify(mine) !== JSON.stringify(fresh))
						stores.values.set(fresh);
				})
				.catch(() => {});
		};
		window.addEventListener("focus", refresh);
		return () => window.removeEventListener("focus", refresh);
	}, [ready, stores]);

	useEffect(() => {
		const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
		if (!mq) return;
		const on = (e: MediaQueryListEvent) => stores.systemDark.set(e.matches);
		mq.addEventListener("change", on);
		return () => mq.removeEventListener("change", on);
	}, [stores]);

	useEffect(() => {
		if (ready) hintTheme(settings.theme);
	}, [ready, settings.theme]);

	const theme = resolveTheme(settings.theme, systemDark);
	// Books, Markdown and reading view take the face the reader picked.
	useEffect(() => {
		const root = document.documentElement;
		if (settings.readingFont === "original") delete root.dataset.readingFont;
		else root.dataset.readingFont = settings.readingFont;
	}, [settings.readingFont]);
	useEffect(() => {
		document.documentElement.dataset.theme = theme;
		document
			.querySelector('meta[name="theme-color"]')
			?.setAttribute("content", THEME_COLOR[theme]);
		// Android draws the clock and battery over the app's top bar, and
		// picks their colour from the phone's own light or dark mode. The
		// app's theme need not be the phone's: tell the shell which it is.
		try {
			window.__paperwrenAndroidExtras?.systemBars?.(isDarkTheme(theme));
		} catch {
			// A shell from before this was added: the phone's choice stands.
		}
		// On Windows the window shows its own colour wherever a resize is
		// ahead of the page's painting: the theme's canvas, not a blank.
		paintWindowBackground();
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
			const next = { ...stores.values.get(), [key]: value };
			backend.storeSet(STORAGE_KEYS.settings, next).catch(() => {});
			stores.values.set(next);
		},
		[stores],
	);

	const api = useMemo(
		() => ({ settings, ready, update, theme }),
		[settings, ready, update, theme],
	);
	const fixed = useMemo(() => ({ ...stores, update }), [stores, update]);
	return (
		<SettingsStoresContext.Provider value={fixed}>
			<SettingsContext.Provider value={api}>
				{children}
			</SettingsContext.Provider>
		</SettingsStoresContext.Provider>
	);
}

/** Every setting, the theme and `update`: the reader is drawn again
 * whenever any setting changes. Hot screens read single settings with
 * useSetting / useSettingsOf instead. */
export function useSettings(): SettingsApi {
	const ctx = useContext(SettingsContext);
	if (!ctx) throw new Error("useSettings must be used inside SettingsProvider");
	return ctx;
}

function useStores(): SettingsStores & { update: SettingsApi["update"] } {
	const ctx = useContext(SettingsStoresContext);
	if (!ctx) throw new Error("settings read outside SettingsProvider");
	return ctx;
}

/** One setting; the reader is drawn again only when it changes. */
export function useSetting<K extends keyof Settings>(key: K): Settings[K] {
	return useSelect(useStores().values, (settings) => settings[key]);
}

/** Some settings, as one object that keeps its identity while they do. */
export function useSettingsOf<K extends keyof Settings>(
	...keys: K[]
): Pick<Settings, K> {
	return usePick(useStores().values, keys);
}

/** The theme as drawn ("system" resolved); the reader is drawn again
 * only when it changes. */
export function useTheme(): ResolvedTheme {
	const { values, systemDark } = useStores();
	const theme = useSelect(values, (settings) => settings.theme);
	return resolveTheme(
		theme,
		useSelect(systemDark, (dark) => dark),
	);
}

/** Whether the settings have been read from storage. */
export function useSettingsReady(): boolean {
	return useSelect(useStores().ready, (ready) => ready);
}

/** Change one setting (and save it). The same function at every render. */
export function useUpdateSetting(): SettingsApi["update"] {
	return useStores().update;
}
