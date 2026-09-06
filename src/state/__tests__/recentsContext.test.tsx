import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RecentsProvider, useRecents } from "../RecentsContext";
import { SettingsProvider, useSettings } from "../SettingsContext";

/**
 * docs/15 #2 regression: the recents callbacks used to depend on the
 * whole settings object, so ANY appearance change (theme, pure
 * black) replaced recordOpen — and the viewer's read effect, which
 * depends on recordOpen, cancelled and restarted the byte read
 * whenever the theme changed. Appearance changes must leave the
 * recents callbacks alone; only recents-relevant settings may
 * replace them.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom does not implement matchMedia; SettingsProvider reads
// prefers-color-scheme on mount and subscribes to changes.
if (typeof window.matchMedia !== "function") {
	window.matchMedia = ((query: string) => ({
		matches: false,
		media: query,
		onchange: null,
		addEventListener: () => {},
		removeEventListener: () => {},
		addListener: () => {},
		removeListener: () => {},
		dispatchEvent: () => false,
	})) as unknown as typeof window.matchMedia;
}

interface Captured {
	settings: ReturnType<typeof useSettings>;
	recents: ReturnType<typeof useRecents>;
}

function Probe({ captured }: { captured: Captured[] }) {
	const settings = useSettings();
	const recents = useRecents();
	captured.push({ settings, recents });
	return null;
}

describe("RecentsContext callback identity (docs/15 #2)", () => {
	let root: Root;
	let container: HTMLDivElement;

	beforeEach(() => {
		localStorage.clear();
		container = document.createElement("div");
		document.body.appendChild(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
	});

	async function mount() {
		const captured: Captured[] = [];
		root = createRoot(container);
		await act(async () => {
			root.render(
				<SettingsProvider>
					<RecentsProvider>
						<Probe captured={captured} />
					</RecentsProvider>
				</SettingsProvider>,
			);
		});
		// Flush the async storeGet hydration in both providers.
		await act(async () => {
			await Promise.resolve();
		});
		return captured;
	}

	it("keeps recordOpen stable across an appearance (theme) change", async () => {
		const captured = await mount();
		const before = captured[captured.length - 1].recents.recordOpen;
		expect(before).toBeTypeOf("function");

		await act(async () => {
			captured[captured.length - 1].settings.update("appearance.theme", "dark");
		});

		const after = captured[captured.length - 1].recents.recordOpen;
		expect(after).toBe(before);
	});

	it("keeps recordOpen stable across a pure-black toggle", async () => {
		const captured = await mount();
		const before = captured[captured.length - 1].recents.recordOpen;

		await act(async () => {
			captured[captured.length - 1].settings.update(
				"appearance.pure_black",
				true,
			);
		});

		expect(captured[captured.length - 1].recents.recordOpen).toBe(before);
	});

	it("still updates when a recents-relevant setting changes", async () => {
		const captured = await mount();
		const before = captured[captured.length - 1].recents.recordOpen;

		await act(async () => {
			captured[captured.length - 1].settings.update("files.recents_limit", 20);
		});

		const after = captured[captured.length - 1].recents.recordOpen;
		expect(after).not.toBe(before);
	});

	it("recordOpen heals an existing entry in place, keeping position and pin", async () => {
		const captured = await mount();
		const latest = () => captured[captured.length - 1];
		act(() => {
			latest().recents.recordOpen({
				name: "Document.pdf",
				format: "pdf",
				size: 10,
				source: "content://x/1284",
				reopen: { kind: "persisted-uri", uri: "content://x/1284" },
			});
		});
		const id = latest().recents.entries[0].id;
		act(() => {
			latest().recents.togglePin(id);
			latest().recents.updatePosition(id, {
				version: 2,
				kind: "pdf",
				location: {
					pageIndex: 3,
					x: 0,
					y: 0,
					viewportX: 0.5,
					viewportY: 0.5,
				},
				mode: "width",
				rotation: 0,
			});
		});

		// A later open that learned the real name must replace the
		// generic one without resetting the entry's history (docs/15
		// #1 step 5).
		act(() => {
			latest().recents.recordOpen({
				name: "Quarterly budget.pdf",
				format: "pdf",
				size: 10,
				source: "content://x/1284",
				reopen: { kind: "persisted-uri", uri: "content://x/1284" },
			});
		});

		const entries = latest().recents.entries;
		expect(entries).toHaveLength(1);
		expect(entries[0].name).toBe("Quarterly budget.pdf");
		expect(entries[0].pinned).toBe(true);
		expect(entries[0].position).toMatchObject({
			kind: "pdf",
			location: { pageIndex: 3 },
		});
	});
});
