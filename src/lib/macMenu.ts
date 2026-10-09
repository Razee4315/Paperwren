/**
 * The Mac's menu bar.
 *
 * Built from the web layer (the menu commands are in the core set the
 * desktop capability carries), so it reads in the app's language and
 * the Rust shell needs nothing for it.
 *
 * An item that has keys does not act itself: it presses them, and
 * whichever part of the app listens for those keys (App, the viewer on
 * top, its find bar) answers as it does to the keyboard. So a command
 * has one meaning however it is asked for. The webview hears a shortcut
 * before the menu bar does, which leaves the menu the clicks, and the
 * keys the app had no use for (⌘W on Home closes the window).
 */

import { toggleFullscreen } from "./fullscreen";
import { language, t } from "./i18n";

type MenuApi = typeof import("@tauri-apps/api/menu");
type Item = Awaited<ReturnType<MenuApi["MenuItem"]["new"]>>;
type Menu = Awaited<ReturnType<MenuApi["Menu"]["new"]>>;

export interface MenuActions {
	settings(): void;
}

/** Menus are in title case in English; other languages have no such
 * habit. */
const title = (text: string) =>
	language() === "en"
		? text.replace(/(^|\s)([a-z])/g, (_, gap, c) => gap + c.toUpperCase())
		: text;

/** Press ⌘ with a key, as the keyboard would. True when something in
 * the app took it. */
function press(key: string): boolean {
	const target = document.activeElement ?? document.body;
	return !target.dispatchEvent(
		new KeyboardEvent("keydown", {
			key,
			metaKey: true,
			bubbles: true,
			cancelable: true,
		}),
	);
}

function closeWindow() {
	import("@tauri-apps/api/window")
		.then(({ getCurrentWindow }) => getCurrentWindow().close())
		.catch(() => {});
}

async function build(actions: MenuActions) {
	const { Menu, MenuItem, PredefinedMenuItem, Submenu } = await import(
		"@tauri-apps/api/menu"
	);
	type Native = Parameters<MenuApi["PredefinedMenuItem"]["new"]>[0];
	const native = (item: NonNullable<Native>["item"], text?: string) =>
		PredefinedMenuItem.new({ item, text: text && title(text) });
	const line = () => native("Separator");
	const item = (text: string, accelerator: string, action: () => void) =>
		MenuItem.new({ text: title(text), accelerator, action });
	const all = <T>(items: Array<Promise<T>>) => Promise.all(items);

	// What only a document can answer: off while none is open.
	const print = await item(`${t("Print")}…`, "Cmd+P", () => press("p"));
	const zoomIn = await item(t("Zoom in"), "Cmd+=", () => press("="));
	const zoomOut = await item(t("Zoom out"), "Cmd+-", () => press("-"));
	const fit = await item(t("Fit"), "Cmd+0", () => press("0"));

	const app = await Submenu.new({
		text: "Paperwren",
		items: await all([
			native({ About: null }, t("About Paperwren")),
			line(),
			item(`${t("Settings")}…`, "Cmd+,", actions.settings),
			line(),
			native("Services", t("Services")),
			line(),
			native("Hide", t("Hide Paperwren")),
			native("HideOthers", t("Hide others")),
			native("ShowAll", t("Show all")),
			line(),
			native("Quit", t("Quit Paperwren")),
		]),
	});
	const file = await Submenu.new({
		text: title(t("File")),
		items: [
			await item(`${t("Open file")}…`, "Cmd+O", () => press("o")),
			await line(),
			// An open document closes; with none, the window does.
			await item(t("Close"), "Cmd+W", () => {
				if (!press("w")) closeWindow();
			}),
			print,
		],
	});
	const edit = await Submenu.new({
		text: title(t("Edit")),
		items: await all([
			native("Undo", t("Undo")),
			native("Redo", t("Redo")),
			line(),
			native("Cut", t("Cut")),
			native("Copy", t("Copy")),
			native("Paste", t("Paste")),
			// The document, not the app around it; a field selects its own.
			item(t("Select all"), "Cmd+A", () => {
				if (!press("a")) document.execCommand("selectAll");
			}),
			line(),
			item(`${t("Find")}…`, "Cmd+F", () => press("f")),
		]),
	});
	const view = await Submenu.new({
		text: title(t("View")),
		items: [
			zoomIn,
			zoomOut,
			fit,
			await line(),
			await item(t("Full screen"), "Ctrl+Cmd+F", toggleFullscreen),
		],
	});
	const windows = await Submenu.new({
		text: title(t("Window")),
		items: await all([
			native("Minimize", t("Minimize")),
			native("Maximize", t("Zoom")),
		]),
	});

	const menu = await Menu.new({ items: [app, file, edit, view, windows] });
	return { menu, windows, forDocument: [print, zoomIn, zoomOut, fit] };
}

let current: { menu: Menu; forDocument: Item[] } | null = null;
let viewing = false;
let latest = 0;

function apply() {
	for (const item of current?.forDocument ?? [])
		item.setEnabled(viewing).catch(() => {});
}

/** Put the menu bar up, in the language now in use. Call again when the
 * language changes. */
export function installMenu(actions: MenuActions) {
	const mine = ++latest;
	build(actions)
		.then(async (next) => {
			// A newer one is on its way: this one is never shown.
			if (mine !== latest) return next.menu.close();
			await next.menu.setAsAppMenu();
			await next.windows.setAsWindowsMenuForNSApp();
			const old = current;
			current = next;
			apply();
			await old?.menu.close();
		})
		.catch(() => {});
}

/** Whether a document is open, for the items only one can answer. */
export function setMenuViewing(on: boolean) {
	viewing = on;
	apply();
}
