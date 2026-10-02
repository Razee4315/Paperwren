import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	LANGUAGES,
	type Table,
	isRtl,
	resolveLanguage,
	setLanguage,
	t,
	tn,
} from "../i18n";
import { ar } from "../locales/ar";
import { es } from "../locales/es";
import { fr } from "../locales/fr";
import { hi } from "../locales/hi";
import { ur } from "../locales/ur";
import { zh } from "../locales/zh";

const TABLES: Record<string, Table> = { ar, es, fr, hi, ur, zh };
const STRING = String.raw`"((?:[^"\\]|\\.)*)"`;

/** Every interface string in the source: what `t`, `tn` and `msg`
 * are called with. */
function sourceKeys(): Set<string> {
	const keys = new Set<string>();
	const walk = (dir: string) => {
		for (const name of readdirSync(dir)) {
			const path = join(dir, name);
			if (statSync(path).isDirectory()) {
				if (name !== "locales" && name !== "__tests__") walk(path);
				continue;
			}
			if (!/\.tsx?$/.test(name) || name.includes(".test.")) continue;
			if (name === "i18n.ts") continue;
			const source = readFileSync(path, "utf-8");
			for (const m of source.matchAll(
				new RegExp(String.raw`\b(?:t|msg)\(\s*${STRING}`, "g"),
			))
				keys.add(JSON.parse(`"${m[1]}"`));
			for (const m of source.matchAll(
				new RegExp(String.raw`\btn\(\s*[^,]+,\s*${STRING},\s*${STRING}`, "g"),
			))
				keys.add(JSON.parse(`"${m[2]}"`));
		}
	};
	walk("src");
	return keys;
}

afterEach(() => setLanguage("en"));

describe("translations", () => {
	const keys = sourceKeys();

	it("finds the interface's strings", () => {
		expect(keys.size).toBeGreaterThan(200);
		expect(keys.has("Open file")).toBe(true);
	});

	it.each(Object.keys(TABLES))(
		"%s has every string, and no stale ones",
		(lang) => {
			const table = TABLES[lang];
			const missing = [...keys].filter((key) => !(key in table));
			const stale = Object.keys(table).filter((key) => !keys.has(key));
			expect(missing).toEqual([]);
			expect(stale).toEqual([]);
		},
	);

	it.each(Object.keys(TABLES))("%s keeps every {placeholder}", (lang) => {
		const holes = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();
		for (const [key, entry] of Object.entries(TABLES[lang])) {
			const forms = typeof entry === "string" ? [entry] : Object.values(entry);
			for (const form of forms)
				for (const hole of holes(form)) expect(holes(key)).toContain(hole);
			if (typeof entry === "string") expect(holes(entry)).toEqual(holes(key));
		}
	});

	it("offers each language under its own name", () => {
		expect(LANGUAGES.map(([code]) => code).sort()).toEqual(
			["en", ...Object.keys(TABLES)].sort(),
		);
	});
});

describe("t and tn", () => {
	it("is English until told otherwise, and falls back to English", () => {
		expect(t("Open file")).toBe("Open file");
		setLanguage("es");
		expect(t("Open file")).toBe("Abrir archivo");
		expect(t("A string nobody translated")).toBe("A string nobody translated");
	});

	it("fills placeholders in the translated order", () => {
		setLanguage("ur");
		// Values are isolated, so numbers and names keep their own order.
		expect(t("{n} of {total}", { n: 2, total: 9 })).toBe(
			"\u20689\u2069 میں سے \u20682\u2069",
		);
		setLanguage("zh");
		expect(t("Page {n}", { n: 4 })).toBe("第 4 页");
	});

	it("picks the plural form the language calls for", () => {
		expect(tn(1, "{n} page", "{n} pages")).toBe("1 page");
		expect(tn(3, "{n} page", "{n} pages")).toBe("3 pages");
		setLanguage("ar");
		expect(tn(1, "{n} page", "{n} pages")).toBe("صفحة واحدة");
		expect(tn(2, "{n} page", "{n} pages")).toBe("صفحتان");
		expect(tn(5, "{n} page", "{n} pages")).toBe("\u20685\u2069 صفحات");
		expect(tn(40, "{n} page", "{n} pages")).toBe("\u206840\u2069 صفحة");
		setLanguage("fr");
		expect(tn(1, "{n} page", "{n} pages")).toBe("1 page");
	});

	it("turns the page around for Arabic and Urdu only", () => {
		setLanguage("ar");
		expect(document.documentElement.dir).toBe("rtl");
		expect(document.documentElement.lang).toBe("ar");
		setLanguage("hi");
		expect(document.documentElement.dir).toBe("ltr");
		expect(isRtl("ur")).toBe(true);
		expect(isRtl("zh")).toBe(false);
	});

	it("follows the phone's languages when set to system", () => {
		expect(resolveLanguage("system", ["de-DE", "fr-CA", "en"])).toBe("fr");
		expect(resolveLanguage("system", ["zh-Hans-CN"])).toBe("zh");
		expect(resolveLanguage("system", ["ja"])).toBe("en");
		expect(resolveLanguage("ur", ["en-US"])).toBe("ur");
	});
});
