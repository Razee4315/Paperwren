import { backend } from "@/lib/backend";
import { t } from "@/lib/i18n";
import type { Reopen } from "@/lib/types";
import { Button, IconButton } from "@/ui";
import { RefreshCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import s from "./FileChanged.module.css";

/** How often an open file is looked at while it is on show. */
const LOOK_MS = 2000;

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
	// biome-ignore lint/correctness/useExhaustiveDependencies: a new read sets a new base
	useEffect(() => {
		const mine = ++generation.current;
		base.current = null;
		setChanged(false);
		backend
			.stamp(reopen)
			.then((at) => {
				if (mine === generation.current) base.current = at;
			})
			.catch(() => {});
		return () => {
			generation.current++;
		};
	}, [reopen, read]);
	useEffect(() => {
		if (!watching) return;
		let alive = true;
		const look = () => {
			if (document.visibilityState !== "visible" || base.current === null)
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
		const id = window.setInterval(look, LOOK_MS);
		window.addEventListener("focus", look);
		document.addEventListener("visibilitychange", look);
		return () => {
			alive = false;
			window.clearInterval(id);
			window.removeEventListener("focus", look);
			document.removeEventListener("visibilitychange", look);
		};
	}, [reopen, watching]);
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
