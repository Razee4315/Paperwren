import { backend } from "@/lib/backend";
import { isDesktop, isTauri } from "@/lib/env";
import { t } from "@/lib/i18n";
import type { Reopen } from "@/lib/types";
import { Button, IconButton } from "@/ui";
import { RefreshCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import s from "./FileChanged.module.css";

/** How often an open file is looked at while it is on show. */
const LOOK_MS = 2000;

let windowApi: Promise<typeof import("@tauri-apps/api/window")> | null = null;

function canWatch(reopen: Reopen): boolean {
	if (reopen.kind === "path") return !window.__paperwrenAndroid;
	return !isTauri && window.__paperwrenTestStamp !== undefined;
}

/**
 * Whether the file on show was changed by another app since it was
 * read: its modified time is looked at every couple of seconds while it
 * is on show and the window is in front, and when the window comes
 * back. `read` counts up each time the file is (re)read.
 */
export function useFileChanged(
	reopen: Reopen,
	watching: boolean,
	read: number,
): [changed: boolean, dismiss: () => void] {
	const base = useRef<number | null>(null);
	const generation = useRef(0);
	const [changed, setChanged] = useState(false);
	const watchable = canWatch(reopen);
	// biome-ignore lint/correctness/useExhaustiveDependencies: a new read sets a new base
	useEffect(() => {
		const mine = ++generation.current;
		base.current = null;
		setChanged(false);
		if (!watchable) return;
		backend
			.stamp(reopen)
			.then((at) => {
				if (mine === generation.current) base.current = at;
			})
			.catch(() => {});
		return () => {
			generation.current++;
		};
	}, [reopen, read, watchable]);
	useEffect(() => {
		if (!watching || !watchable) return;
		let alive = true;
		let id = 0;
		let nativeFocused = document.hasFocus();
		let unlistenFocus: (() => void) | null = null;
		const look = () => {
			if (
				document.visibilityState !== "visible" ||
				!nativeFocused ||
				base.current === null
			)
				return;
			const mine = generation.current;
			backend
				.stamp(reopen)
				.then((at) => {
					if (
						alive &&
						mine === generation.current &&
						at !== null &&
						base.current !== null &&
						at !== base.current
					)
						setChanged(true);
				})
				.catch(() => {});
		};
		const stop = () => {
			if (!id) return;
			window.clearInterval(id);
			id = 0;
		};
		const sync = (checkNow: boolean) => {
			if (
				document.visibilityState === "visible" &&
				document.hasFocus() &&
				nativeFocused
			) {
				if (checkNow) look();
				if (!id) id = window.setInterval(look, LOOK_MS);
			} else {
				stop();
			}
		};
		const onFocus = () => {
			nativeFocused = true;
			sync(true);
		};
		const onBlur = () => {
			nativeFocused = false;
			stop();
		};
		const onVisibility = () => sync(true);
		sync(false);
		window.addEventListener("focus", onFocus);
		window.addEventListener("blur", onBlur);
		document.addEventListener("visibilitychange", onVisibility);
		// Windows WebView2 can keep document.hasFocus() true after another app
		// takes focus; follow the native window focus event as well.
		if (isTauri && isDesktop) {
			windowApi ??= import("@tauri-apps/api/window");
			windowApi
				.then(({ getCurrentWindow }) =>
					getCurrentWindow().onFocusChanged(({ payload }) => {
						if (!alive) return;
						nativeFocused = payload;
						if (payload) sync(true);
						else stop();
					}),
				)
				.then((fn) => {
					if (alive) unlistenFocus = fn;
					else fn();
				})
				.catch(() => {});
		}
		return () => {
			alive = false;
			stop();
			unlistenFocus?.();
			window.removeEventListener("focus", onFocus);
			window.removeEventListener("blur", onBlur);
			document.removeEventListener("visibilitychange", onVisibility);
		};
	}, [reopen, watching, watchable]);
	const dismiss = () => {
		// Asked again only if it changes once more.
		const mine = ++generation.current;
		backend
			.stamp(reopen)
			.then((at) => {
				if (mine === generation.current) base.current = at;
			})
			.catch(() => {});
		setChanged(false);
	};
	return [changed, dismiss];
}

/** Says the file changed on disk, and offers to read it again. */
export function FileChangedBar({
	onReload,
	onDismiss,
}: {
	onReload: () => void;
	onDismiss: () => void;
}) {
	return (
		// biome-ignore lint/a11y/useSemanticElements: a live region, not form output
		<div className={s.bar} role="status" data-testid="file-changed">
			<RefreshCw size={18} className={s.icon} aria-hidden="true" />
			<span className={s.text}>
				{t("This file was changed by another app")}
			</span>
			<Button onClick={onReload} data-testid="file-changed-reload">
				{t("Reload")}
			</Button>
			<IconButton
				label={t("Keep showing this version")}
				onClick={onDismiss}
				data-testid="file-changed-dismiss"
			>
				<X size={18} />
			</IconButton>
		</div>
	);
}
