/**
 * The interface's languages.
 *
 * English is the source: `t("Open file")` is looked up by its English
 * text, and a language that has no entry for it shows the English. So
 * the code reads as it did before, a missing translation is never a
 * blank, and locales.test.ts fails when a string in the code is
 * missing from a table.
 *
 * Only Paperwren's own buttons and messages change. Documents are
 * shown as they are, in their own direction.
 */

import { ar } from "./locales/ar";
import { es } from "./locales/es";
import { fr } from "./locales/fr";
import { hi } from "./locales/hi";
import { ur } from "./locales/ur";
import { zh } from "./locales/zh";

export type Language = "en" | "zh" | "hi" | "es" | "fr" | "ar" | "ur";
export type LanguageSetting = "system" | Language;

type Category = "zero" | "one" | "two" | "few" | "many" | "other";
/** A translation, or one per plural category of the language. */
export type Entry =
	| string
	| (Partial<Record<Category, string>> & { other: string });
export type Table = Record<string, Entry>;

/** Each language under its own name. */
export const LANGUAGES: Array<[Language, string]> = [
	["en", "English"],
	["zh", "中文"],
	["hi", "हिन्दी"],
	["es", "Español"],
	["fr", "Français"],
	["ar", "العربية"],
	["ur", "اردو"],
];

const TABLES: Record<Language, Table | null> = {
	en: null,
	zh,
	hi,
	es,
	fr,
	ar,
	ur,
};
const RTL: Language[] = ["ur", "ar"];
const HINT_KEY = "paperwren.lang";

const supported = (code: string | null | undefined): Language | null =>
	LANGUAGES.find(([lang]) => code?.toLowerCase().startsWith(lang))?.[0] ?? null;

/** The language to use for a setting: the chosen one, or the first of
 * the phone's languages that Paperwren speaks. */
export function resolveLanguage(
	setting: LanguageSetting,
	preferred: readonly string[] = typeof navigator === "undefined"
		? []
		: (navigator.languages ?? [navigator.language]),
): Language {
	if (setting !== "system") return setting;
	for (const code of preferred) {
		const lang = supported(code);
		if (lang) return lang;
	}
	return "en";
}

// Settings load a moment after the first paint; the last language used
// is kept where it can be read at once, so the app does not open in
// English and then switch.
function hinted(): Language {
	try {
		return supported(localStorage.getItem(HINT_KEY)) ?? "en";
	} catch {
		return "en";
	}
}

let current: Language = hinted();
const listeners = new Set<() => void>();

function apply() {
	if (typeof document === "undefined") return;
	document.documentElement.lang = current;
	document.documentElement.dir = RTL.includes(current) ? "rtl" : "ltr";
}
apply();

export const language = (): Language => current;
export const isRtl = (lang: Language = current): boolean => RTL.includes(lang);
/** "rtl" or "ltr", for interface text that sits inside a document's
 * (always left-to-right) frame. */
export const uiDir = () => (isRtl() ? "rtl" : "ltr");
/** For dates and times: the interface language, or the system's own
 * conventions when that is English. */
export const locale = (): string | undefined =>
	current === "en" ? undefined : current;

export function setLanguage(lang: Language) {
	if (lang === current) return;
	current = lang;
	try {
		localStorage.setItem(HINT_KEY, lang);
	} catch {
		// No storage: the next start begins in English, then switches.
	}
	apply();
	for (const listener of listeners) listener();
}

/** For React: re-render when the language changes. */
export function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

type Vars = Record<string, string | number>;

/**
 * In a right-to-left sentence a file name, a size or a count is a
 * left-to-right island: wrapped in Unicode isolates so "9 KB" or
 * "report (2).pdf" keeps its own order and does not drag the
 * punctuation around it.
 */
export const isolate = (text: string | number): string =>
	RTL.includes(current) ? `\u2068${text}\u2069` : String(text);

const fill = (text: string, vars?: Vars) =>
	vars
		? text.replace(/\{(\w+)\}/g, (whole, name) =>
				name in vars ? isolate(vars[name]) : whole,
			)
		: text;

/** `text` in the interface language; `{name}` takes `vars.name`. */
export function t(text: string, vars?: Vars): string {
	const entry = TABLES[current]?.[text];
	return fill(typeof entry === "string" ? entry : (entry?.other ?? text), vars);
}

/**
 * A phrase that depends on a count: "1 page", "3 pages". The plural
 * English form is the key; languages with more forms (Arabic has six)
 * give one per category. `{n}` is the count.
 */
export function tn(count: number, one: string, other: string, vars?: Vars) {
	const all = { n: count, ...vars };
	const entry = TABLES[current]?.[other];
	if (entry === undefined) return fill(count === 1 ? one : other, all);
	if (typeof entry === "string") return fill(entry, all);
	const category = new Intl.PluralRules(current).select(count) as Category;
	return fill(entry[category] ?? entry.other, all);
}

/** Marks a string as interface text where it is defined (a constant, a
 * parser's label); it is translated with `t` where it is shown. */
export const msg = (text: string) => text;
