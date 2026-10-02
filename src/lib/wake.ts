/**
 * Keeping the screen on while a document is being read.
 *
 * The web's Screen Wake Lock does it where the engine has one (desktop
 * WebView2, browsers). Android's WebView does not, so there the shell
 * sets the window's keep-screen-on flag instead (MainActivity's
 * `keepAwake`). Neither needs a permission, and both end the moment
 * the hold is released or the app is left.
 */

interface Sentinel {
	release(): Promise<void>;
}
interface WakeLockApi {
	request(type: "screen"): Promise<Sentinel>;
}

/** Hold the screen awake until the returned function is called. */
export function holdScreen(): () => void {
	const api = (navigator as { wakeLock?: WakeLockApi }).wakeLock;
	const bridge = window.__paperwrenAndroidExtras;
	let held = true;
	let sentinel: Sentinel | null = null;
	let bridged = false;

	const viaBridge = () => {
		if (!held || bridged || !bridge) return;
		bridged = true;
		bridge.keepAwake(true);
	};
	const acquire = () => {
		if (!held || document.visibilityState !== "visible") return;
		if (!api) {
			viaBridge();
			return;
		}
		api.request("screen").then(
			(lock) => {
				if (held) sentinel = lock;
				else lock.release().catch(() => {});
			},
			// Refused (battery saver, an engine without it): use the shell.
			viaBridge,
		);
	};
	// The system drops a wake lock whenever the page is hidden; take it
	// again when the reader comes back.
	const onVisible = () => {
		if (document.visibilityState === "visible" && !bridged) acquire();
	};
	document.addEventListener("visibilitychange", onVisible);
	acquire();

	return () => {
		held = false;
		document.removeEventListener("visibilitychange", onVisible);
		sentinel?.release().catch(() => {});
		sentinel = null;
		if (bridged) bridge?.keepAwake(false);
	};
}
