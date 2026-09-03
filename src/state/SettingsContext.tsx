import { backend } from "@/lib/backend";
import { isMobileShell } from "@/lib/env";
import { DEFAULT_SETTINGS, STORAGE_KEYS, type Settings } from "@/lib/types";
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
	resolvedTheme: "paper" | "midnight";
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

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

	const resolvedTheme: "paper" | "midnight" = useMemo(() => {
		if (settings["appearance.theme"] === "light") return "paper";
		if (settings["appearance.theme"] === "dark") return "midnight";
		return systemDark ? "midnight" : "paper";
	}, [settings, systemDark]);

	// Theme = one attribute on <html>; components read variables.
	useEffect(() => {
		document.documentElement.setAttribute("data-theme", resolvedTheme);
	}, [resolvedTheme]);

	useEffect(() => {
		document.documentElement.classList.toggle(
			"pure-black",
			settings["appearance.pure_black"] && resolvedTheme === "midnight",
		);
	}, [settings, resolvedTheme]);

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
		() => ({ settings, ready, update, resolvedTheme }),
		[settings, ready, update, resolvedTheme],
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
