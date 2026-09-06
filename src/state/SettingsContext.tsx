import { backend } from "@/lib/backend";
import { isMobileShell } from "@/lib/env";
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

interface SettingsContextValue {
	settings: Settings;
	ready: boolean;
	update: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
	resolvedTheme: ResolvedTheme;
	isDarkTheme: boolean;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

declare global {
	interface Window {
		/** Dev test hook: applies a settings update through the exact
		 * same update() path the settings screens use. Lets automated
		 * browser tests change a setting while a viewer is open — the
		 * settings UI itself is only reachable from Home (docs/15 #2).
		 * Undefined unless a test sets it up via the provider. */
		__paperwrenTestUpdate?: (key: string, value: unknown) => void;
	}
}

export function SettingsProvider({ children }: { children: ReactNode }) {
	const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
	const [ready, setReady] = useState(false);
	const [systemDark, setSystemDark] = useState(
		() =>
			typeof window !== "undefined" &&
			window.matchMedia("(prefers-color-scheme: dark)").matches,
	);

	useEffect(() => {
		let cancelled = false;
		backend
			.storeGet(STORAGE_KEYS.settings)
			.then((stored) => {
				if (cancelled) return;
				if (stored && typeof stored === "object") {
					setSettings({
						...DEFAULT_SETTINGS,
						...(stored as Partial<Settings>),
					});
				}
				setReady(true);
			})
			.catch(() => setReady(true));
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		const mq = window.matchMedia("(prefers-color-scheme: dark)");
		const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
		mq.addEventListener("change", onChange);
		return () => mq.removeEventListener("change", onChange);
	}, []);

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

	// Dev test hook (docs/15 #2): publish the real update() so tests
	// can change a setting while a viewer is open, exercising the
	// identical state path as the settings UI. No-op for normal use.
	useEffect(() => {
		window.__paperwrenTestUpdate = (key: string, value: unknown) =>
			update(key as never, value as never);
		return () => {
			window.__paperwrenTestUpdate = undefined;
		};
	}, [update]);

	const resolvedTheme: ResolvedTheme = useMemo(() => {
		switch (settings["appearance.theme"]) {
			case "light":
				return "paper";
			case "dark":
				return "midnight";
			case "sepia":
			case "moss":
			case "slate":
				return settings["appearance.theme"];
			default:
				return systemDark ? "midnight" : "paper";
		}
	}, [settings, systemDark]);

	const isDarkTheme = resolvedTheme !== "paper" && resolvedTheme !== "sepia";
	const pureBlack = settings["appearance.pure_black"];

	// Theme = one attribute on <html>; components read variables.
	useEffect(() => {
		document.documentElement.setAttribute("data-theme", resolvedTheme);
	}, [resolvedTheme]);

	useEffect(() => {
		document.documentElement.classList.toggle(
			"pure-black",
			pureBlack && isDarkTheme,
		);
	}, [pureBlack, isDarkTheme]);

	// Keyboard inset tracking (mobile lesson: measure the difference
	// between layout and visual viewports and apply it as padding,
	// never as height).
	useEffect(() => {
		if (!isMobileShell) return;
		const update = () => {
			const vv = window.visualViewport;
			if (!vv) return;
			if (vv.scale > 1.01) return; // pinch zoom, not a keyboard
			const covered =
				document.documentElement.clientHeight - (vv.height + vv.offsetTop);
			const inset = covered > 1 ? Math.round(covered) : 0;
			document.documentElement.style.setProperty(
				"--keyboard-inset",
				`${inset}px`,
			);
		};
		window.visualViewport?.addEventListener("resize", update);
		window.addEventListener("resize", update);
		update();
		return () => {
			window.visualViewport?.removeEventListener("resize", update);
			window.removeEventListener("resize", update);
		};
	}, []);

	const value = useMemo(
		() => ({ settings, ready, update, resolvedTheme, isDarkTheme }),
		[settings, ready, update, resolvedTheme, isDarkTheme],
	);

	return (
		<SettingsContext.Provider value={value}>
			{children}
		</SettingsContext.Provider>
	);
}

export function useSettings(): SettingsContextValue {
	const ctx = useContext(SettingsContext);
	if (!ctx) throw new Error("useSettings must be used inside SettingsProvider");
	return ctx;
}

/** Light haptic tick where the platform supports it. */
export function haptic(settings: Settings, ms = 8) {
	if (!settings["viewer.haptics"]) return;
	if (typeof navigator !== "undefined" && "vibrate" in navigator) {
		try {
			navigator.vibrate(ms);
		} catch {
			// Haptics are best-effort everywhere.
		}
	}
}
