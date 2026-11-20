/**
 * Reading aloud with the system's own voices. A web page has the Web
 * Speech API (Windows, macOS); an Android webview has none, and its
 * shell lends the system's text-to-speech instead.
 *
 * Paperwren never connects to the internet, and it does not let a voice
 * do it either: only voices that speak on the device are used (some
 * browsers offer voices that send the text to a server). Where there is
 * no such voice, reading aloud is not offered.
 */

/** A voice was told to stop (by the reader, or by a newer request). */
export class Stopped extends Error {}

export interface Speaker {
	/** Say `text`. Resolves once it has been said; rejects with Stopped
	 * when stop() cut it short, or with an error when the voice failed. */
	say(text: string, lang: string | undefined, rate: number): Promise<void>;
	stop(): void;
}

declare global {
	interface Window {
		/** MainActivity's answer to speak(): the token, and "done" or
		 * "error" or "stopped". */
		__paperwrenSpoken?: (token: string, outcome: string) => void;
	}
}

// The speeds offered live with the settings (types.ts).
export { SPEECH_RATES } from "./types";

// ---------- the web's voices ----------

function localVoices(): SpeechSynthesisVoice[] {
	try {
		return window.speechSynthesis
			.getVoices()
			.filter((voice) => voice.localService);
	} catch {
		return [];
	}
}

/** The voice for a language: one of its own region first ("en-GB"),
 * then any of the language ("en"), then the system's default. */
export function pickVoice<T extends { lang: string; default?: boolean }>(
	voices: T[],
	lang: string | undefined,
): T | undefined {
	const want = (lang ?? navigator.language ?? "").toLowerCase();
	const base = want.split(/[-_]/)[0];
	const norm = (v: T) => v.lang.toLowerCase().replace("_", "-");
	return (
		voices.find((v) => norm(v) === want) ??
		voices.find((v) => norm(v).split("-")[0] === base) ??
		voices.find((v) => v.default) ??
		voices[0]
	);
}

function webSpeaker(): Speaker | null {
	if (
		typeof window === "undefined" ||
		!("speechSynthesis" in window) ||
		typeof SpeechSynthesisUtterance === "undefined"
	)
		return null;
	const synth = window.speechSynthesis;
	let current: { reject: (e: Error) => void } | null = null;
	return {
		say(text, lang, rate) {
			current?.reject(new Stopped());
			synth.cancel();
			const voice = pickVoice(localVoices(), lang);
			if (!voice) return Promise.reject(new Error("no voice on this device"));
			return new Promise<void>((resolve, reject) => {
				const said = new SpeechSynthesisUtterance(text);
				said.voice = voice;
				said.lang = voice.lang;
				said.rate = rate;
				const mine = { reject };
				current = mine;
				said.onend = () => {
					if (current === mine) current = null;
					resolve();
				};
				said.onerror = (e) => {
					if (current === mine) current = null;
					reject(
						e.error === "interrupted" || e.error === "canceled"
							? new Stopped()
							: new Error(e.error),
					);
				};
				synth.speak(said);
			});
		},
		stop() {
			current?.reject(new Stopped());
			current = null;
			synth.cancel();
		},
	};
}

// ---------- Android's text-to-speech, through the shell ----------

function androidSpeaker(): Speaker | null {
	const bridge = window.__paperwrenAndroidExtras;
	if (!bridge?.speak || !bridge.stopSpeaking) return null;
	let count = 0;
	const waiting = new Map<
		string,
		{ resolve: () => void; reject: (e: Error) => void }
	>();
	window.__paperwrenSpoken = (token, outcome) => {
		const wait = waiting.get(token);
		if (!wait) return;
		waiting.delete(token);
		if (outcome === "done") wait.resolve();
		else if (outcome === "stopped") wait.reject(new Stopped());
		else wait.reject(new Error(outcome));
	};
	const stopAll = () => {
		for (const wait of waiting.values()) wait.reject(new Stopped());
		waiting.clear();
	};
	return {
		say(text, lang, rate) {
			stopAll();
			const token = `s${++count}`;
			return new Promise<void>((resolve, reject) => {
				waiting.set(token, { resolve, reject });
				if (!bridge.speak?.(text, lang ?? "", rate, token)) {
					waiting.delete(token);
					reject(new Error("no voice on this device"));
				}
			});
		},
		stop() {
			stopAll();
			bridge.stopSpeaking?.();
		},
	};
}

let chosen: Speaker | null | undefined;

/** The device's speaker, or null where nothing can read aloud. */
export function speaker(): Speaker | null {
	if (chosen === undefined) chosen = androidSpeaker() ?? webSpeaker();
	return chosen;
}

/**
 * Whether a voice is there to read. On the web the list of voices can
 * arrive a moment after the page; `onChange` hears when it does.
 */
export function canSpeak(onChange?: () => void): boolean {
	if (window.__paperwrenAndroidExtras?.speak) return true;
	if (!speaker()) return false;
	if (onChange && "speechSynthesis" in window)
		window.speechSynthesis.addEventListener?.("voiceschanged", onChange, {
			once: true,
		});
	return localVoices().length > 0;
}

// ---------- what is said, a piece at a time ----------

/** The longest piece given to a voice at once: some stop part way
 * through a long one, and a short one lets Pause and Next answer fast. */
export const PIECE = 240;

const SENTENCE = /[^.!?…。！？؟]+(?:[.!?…。！？؟]+["'”’)\]]*\s*|$)/g;

/** The sentences of a text, as [start, end) offsets into it. */
export function sentences(text: string): Array<[number, number]> {
	const out: Array<[number, number]> = [];
	const Segmenter = (
		Intl as unknown as {
			Segmenter?: new (
				lang?: string,
				o?: { granularity: string },
			) => {
				segment(t: string): Iterable<{ index: number; segment: string }>;
			};
		}
	).Segmenter;
	if (Segmenter) {
		for (const { index, segment } of new Segmenter(undefined, {
			granularity: "sentence",
		}).segment(text))
			out.push([index, index + segment.length]);
	} else {
		for (const m of text.matchAll(SENTENCE))
			if (m[0]) out.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
	}
	return out;
}

/**
 * A text cut into pieces to read: whole sentences, several to a piece
 * while they fit, and a sentence longer than a piece cut between words.
 * Offsets are into `text`; pieces with nothing to say are left out.
 */
export function pieces(text: string, max = PIECE): Array<[number, number]> {
	const out: Array<[number, number]> = [];
	let from = -1;
	let to = -1;
	const flush = () => {
		if (from >= 0 && text.slice(from, to).trim()) out.push([from, to]);
		from = to = -1;
	};
	for (const [start, end] of sentences(text)) {
		if (end - start > max) {
			flush();
			let at = start;
			while (at < end) {
				let cut = Math.min(end, at + max);
				if (cut < end) {
					const space = text.lastIndexOf(" ", cut);
					if (space > at + max / 2) cut = space + 1;
				}
				if (text.slice(at, cut).trim()) out.push([at, cut]);
				at = cut;
			}
			continue;
		}
		if (from >= 0 && end - from > max) flush();
		if (from < 0) from = start;
		to = end;
	}
	flush();
	return out;
}

/** A PDF page's lines as running text: a word broken across a line
 * end ("exam-" / "ple") is joined again, other line ends are spaces. */
export function runningText(lines: string[]): string {
	let out = "";
	for (const raw of lines) {
		const line = raw.trim();
		if (!line) {
			out += "\n\n";
			continue;
		}
		if (/\p{L}-$/u.test(out)) out = out.slice(0, -1) + line;
		else out += (out && !out.endsWith("\n") ? " " : "") + line;
	}
	return out.trim();
}

/** The language a text is written in, from its script, for a document
 * that does not say: an Urdu text is not read by an English voice.
 * Latin script says nothing (it is many languages): null. */
export function guessLang(text: string, ui?: string): string | null {
	const counts: Array<[string, RegExp]> = [
		[ui === "ur" ? "ur" : "ar", /\p{Script=Arabic}/gu],
		["hi", /\p{Script=Devanagari}/gu],
		["zh", /\p{Script=Han}/gu],
		["ja", /[\p{Script=Hiragana}\p{Script=Katakana}]/gu],
		["ko", /\p{Script=Hangul}/gu],
		["ru", /\p{Script=Cyrillic}/gu],
		["he", /\p{Script=Hebrew}/gu],
		["el", /\p{Script=Greek}/gu],
		["th", /\p{Script=Thai}/gu],
	];
	const letters = text.match(/\p{L}/gu)?.length ?? 0;
	if (!letters) return null;
	let best: [string, number] = ["", 0];
	for (const [lang, re] of counts) {
		const n = text.match(re)?.length ?? 0;
		if (n > best[1]) best = [lang, n];
	}
	// Japanese is written with Han characters too.
	if (
		best[0] === "zh" &&
		/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)
	)
		return "ja";
	return best[1] / letters > 0.3 ? best[0] : null;
}
