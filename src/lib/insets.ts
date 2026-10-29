/** The room the system bars take at each edge, in CSS pixels. */
export interface Insets {
	top: number;
	right: number;
	bottom: number;
	left: number;
}

const SIDES = ["top", "right", "bottom", "left"] as const;

/** What the Android shell reports, made safe: a missing, negative or
 * non-number side is 0; anything but an object is null. */
export function toInsets(value: unknown): Insets | null {
	if (!value || typeof value !== "object") return null;
	const raw = value as Record<string, unknown>;
	const out = {} as Insets;
	for (const side of SIDES) {
		const n = raw[side];
		out[side] = typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
	}
	return out;
}

export function parseInsets(json: string | null | undefined): Insets | null {
	if (!json) return null;
	try {
		return toInsets(JSON.parse(json));
	} catch {
		return null;
	}
}

/** Hand the bars' sizes to the CSS: --safe-* takes the larger of these
 * and the WebView's own safe area, which many Android WebViews leave
 * at zero for the status and navigation bars. */
export function applyInsets(insets: Insets, root = document.documentElement) {
	for (const side of SIDES)
		root.style.setProperty(`--native-inset-${side}`, `${insets[side]}px`);
}

/** On Android, follow the shell's insets from now on. */
export function followNativeInsets() {
	const extras = window.__paperwrenAndroidExtras;
	if (!extras?.insets) return;
	window.__paperwrenInsets = (value: unknown) => {
		const insets = toInsets(value);
		if (insets) applyInsets(insets);
	};
	const now = parseInsets(extras.insets());
	if (now) applyInsets(now);
}
