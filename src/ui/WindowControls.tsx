import { isTauri, ownsFrame } from "@/lib/env";
import { t } from "@/lib/i18n";
import { afterQuiet } from "@/lib/settle";
import { Copy, Minus, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import s from "./WindowControls.module.css";

type Command = "minimize" | "toggleMaximize" | "close";

let windowApi: Promise<typeof import("@tauri-apps/api/window")> | null = null;
const loadWindow = () => {
	if (!windowApi) windowApi = import("@tauri-apps/api/window");
	return windowApi;
};

function run(command: Command, after?: () => void) {
	if (!isTauri) return;
	loadWindow()
		.then(({ getCurrentWindow }) => getCurrentWindow()[command]())
		.then(() => after?.())
		.catch(() => {});
}

/**
 * Minimise, maximise and close, where the app draws the window's frame
 * itself (Windows). They sit over the right end of whichever bar is on
 * top, which leaves room for them (--win-controls). Rendered beside the
 * app, not inside it: the app is made inert while a dialog is open, and
 * the window must still close then.
 */
export function WindowControls() {
	const [maximized, setMaximized] = useState(false);
	const syncRef = useRef<() => void>(() => {});

	useEffect(() => {
		if (!ownsFrame || !isTauri) return;
		let alive = true;
		let stop = () => {};
		let settled: ReturnType<typeof afterQuiet> | null = null;
		loadWindow()
			.then(({ getCurrentWindow }) => {
				const win = getCurrentWindow();
				const sync = () =>
					win
						.isMaximized()
						.then((is) => alive && setMaximized(is))
						.catch(() => {});
				syncRef.current = sync;
				sync();
				// Asked once a resize burst settles, not at every drag step.
				settled = afterQuiet(sync, 200);
				return win.onResized(settled);
			})
			.then((unlisten) => {
				if (alive) stop = unlisten;
				else unlisten();
			})
			.catch(() => {});
		return () => {
			alive = false;
			syncRef.current = () => {};
			stop();
			settled?.cancel();
		};
	}, []);

	if (!ownsFrame) return null;
	return createPortal(
		// Always at the physical right, as the system puts them.
		<div className={s.controls} dir="ltr" data-testid="window-controls">
			<button
				type="button"
				tabIndex={-1}
				aria-label={t("Minimise")}
				title={t("Minimise")}
				onClick={() => run("minimize")}
			>
				<Minus size={16} strokeWidth={1.5} />
			</button>
			<button
				type="button"
				tabIndex={-1}
				aria-label={maximized ? t("Restore") : t("Maximise")}
				title={maximized ? t("Restore") : t("Maximise")}
				onClick={() => run("toggleMaximize", () => syncRef.current())}
			>
				{maximized ? (
					<Copy size={13} strokeWidth={1.5} className={s.restore} />
				) : (
					<Square size={13} strokeWidth={1.5} />
				)}
			</button>
			<button
				type="button"
				tabIndex={-1}
				className={s.close}
				aria-label={t("Close window")}
				title={t("Close window")}
				onClick={() => run("close")}
				data-testid="window-close"
			>
				<X size={17} strokeWidth={1.5} />
			</button>
		</div>,
		document.body,
	);
}
