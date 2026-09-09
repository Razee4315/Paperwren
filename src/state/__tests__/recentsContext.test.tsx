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

	it("keeps recordOpen stable when a recents-relevant setting changes, and honors the new limit", async () => {
		// The whole point of docs/15 #2: recordOpen's identity is what
		// the viewer's read effect depends on. A settings change that
		// replaced it re-read the open document — so the limit now
		// travels through a ref and must take effect WITHOUT an
		// identity change.
		const captured = await mount();
		const latest = () => captured[captured.length - 1];
		const before = latest().recents.recordOpen;

		await act(async () => {
			latest().settings.update("files.recents_limit", 20);
		});

		expect(latest().recents.recordOpen).toBe(before);

		// The new limit is honored on the next open: 21 unpinned
		// entries recorded under limit 20 leave the oldest evicted.
		for (let i = 0; i < 21; i++) {
			act(() => {
				latest().recents.recordOpen({
					name: `file-${i}.pdf`,
					format: "pdf",
					size: 10,
					source: `content://providers/${i}`,
					reopen: { kind: "persisted-uri", uri: `content://providers/${i}` },
				});
			});
		}
		expect(latest().recents.entries).toHaveLength(20);
		// Newest kept, oldest evicted.
		expect(latest().recents.entries.some((e) => e.name === "file-0.pdf")).toBe(
			false,
		);
		expect(latest().recents.entries.some((e) => e.name === "file-20.pdf")).toBe(
			true,
		);

		// Drain the serialized persistence queue so this test's writes
		// land BEFORE the next test clears localStorage — a write
		// flushing after the clear would leak entries into it.
		await act(async () => {
			await new Promise((r) => setTimeout(r, 0));
		});
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

describe("RecentsContext dashboard name healing (docs/15 #1)", () => {
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
		(window as { __paperwrenAndroid?: unknown }).__paperwrenAndroid = undefined;
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
		await act(async () => {
			await Promise.resolve();
		});
		return captured;
	}

	it("heals a generic name from a managed-copy basename without a reopen", async () => {
		const captured = await mount();
		const latest = () => captured[captured.length - 1];
		act(() => {
			latest().recents.recordOpen({
				name: "Document.pdf",
				format: "pdf",
				size: 10,
				source:
					"/data/user/0/app.paperwren.docs/files/imports/Quarterly budget.pdf",
				reopen: {
					kind: "managed-copy",
					path: "/data/user/0/app.paperwren.docs/files/imports/Quarterly budget.pdf",
				},
			});
		});
		await act(async () => {
			await new Promise((r) => setTimeout(r, 0));
		});
		expect(latest().recents.entries[0].name).toBe("Quarterly budget.pdf");
	});

	it("heals a content-URI entry through the Android name bridge", async () => {
		(window as { __paperwrenAndroid?: unknown }).__paperwrenAndroid = {
			displayName: () => "Real provider name.pdf",
			contentSize: () => 0,
		};
		const captured = await mount();
		const latest = () => captured[captured.length - 1];
		act(() => {
			latest().recents.recordOpen({
				name: "Document.pdf",
				format: "pdf",
				size: 10,
				source: "content://providers/1284",
				reopen: { kind: "persisted-uri", uri: "content://providers/1284" },
			});
		});
		await act(async () => {
			await new Promise((r) => setTimeout(r, 0));
		});
		expect(latest().recents.entries[0].name).toBe("Real provider name.pdf");
	});

	it("never overwrites a specific stored name", async () => {
		const captured = await mount();
		const latest = () => captured[captured.length - 1];
		act(() => {
			latest().recents.recordOpen({
				name: "my real notes.txt",
				format: "txt",
				size: 10,
				source: "/imports/other.pdf",
				reopen: { kind: "managed-copy", path: "/imports/other.pdf" },
			});
		});
		await act(async () => {
			await new Promise((r) => setTimeout(r, 0));
		});
		expect(latest().recents.entries[0].name).toBe("my real notes.txt");
	});
});
