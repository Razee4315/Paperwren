/**
 * Off-main-thread parsing: spreadsheets (SheetJS), legacy binary Word
 * and PowerPoint files, and RTF; and unlocking password-protected
 * Office files. The UI posts bytes and gets plain data back;
 * terminating the worker cancels the work.
 */

import * as XLSX from "xlsx";
import { decryptPackage } from "./office/crypto";
import { textDeck } from "./office/deck";
import { parseDoc } from "./office/doc";
import { extractDoc, extractPpt } from "./office/legacy";
import type { Extracted } from "./office/model";
import { type RawDeck, parsePpt } from "./office/ppt";
import { extractRtf } from "./office/rtf";
import { readXlsxStyles } from "./sheetStyles";
import { parseWorkbook } from "./workbookModel";

export type WorkerRequest =
	| { type: "workbook"; buffer: ArrayBuffer | string }
	| { type: "doc" | "ppt" | "rtf"; buffer: ArrayBuffer }
	| { type: "decrypt"; buffer: ArrayBuffer; password: string };

/** A protected file, unlocked: the bytes of the real one. */
export type DecryptResult =
	| { ok: true; data: ArrayBuffer }
	| { ok: false; reason: "password" | "unsupported" | "corrupt" };

export type DocResult =
	| { ok: true; doc: Extracted }
	| { ok: false; reason: "corrupt" | "password" };

export type DeckResult =
	| { ok: true; deck: RawDeck; textOnly: boolean }
	| { ok: false; reason: "corrupt" | "password" };

function cfbLookup(buffer: ArrayBuffer) {
	const cfb = XLSX.CFB.read(new Uint8Array(buffer), { type: "array" });
	return (name: string): Uint8Array | null => {
		const entry = XLSX.CFB.find(cfb, name);
		if (!entry?.content) return null;
		return entry.content instanceof Uint8Array
			? entry.content
			: Uint8Array.from(entry.content as number[]);
	};
}

const isPassword = (err: unknown) => String(err).includes("password");

/** Run the faithful reader; if the file defeats it (but is not
 * locked), fall back to the plain-text one. */
function withFallback<T>(rich: () => T, plain: () => T): T {
	try {
		return rich();
	} catch (err) {
		if (isPassword(err)) throw err;
		return plain();
	}
}

async function unlock(buffer: ArrayBuffer, password: string) {
	try {
		const data = await decryptPackage(cfbLookup(buffer), password);
		// A copy sized to the file: the plain bytes sit inside a larger buffer.
		const out = data.slice().buffer as ArrayBuffer;
		(self as unknown as Worker).postMessage(
			{ ok: true, data: out } satisfies DecryptResult,
			[out],
		);
	} catch (err) {
		self.postMessage({
			ok: false,
			reason: isPassword(err)
				? "password"
				: String(err).includes("unsupported")
					? "unsupported"
					: "corrupt",
		} satisfies DecryptResult);
	}
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
	const msg = event.data;
	if (msg.type === "decrypt") {
		unlock(msg.buffer, msg.password);
		return;
	}
	try {
		if (msg.type === "workbook") {
			const styles =
				typeof msg.buffer === "string"
					? null
					: readXlsxStyles(new Uint8Array(msg.buffer));
			self.postMessage(parseWorkbook(XLSX, msg.buffer, styles));
		} else if (msg.type === "rtf") {
			self.postMessage({
				ok: true,
				doc: extractRtf(new Uint8Array(msg.buffer)),
			} satisfies DocResult);
		} else if (msg.type === "doc") {
			const lookup = cfbLookup(msg.buffer);
			self.postMessage({
				ok: true,
				doc: withFallback<Extracted>(
					() => parseDoc(lookup),
					() => extractDoc(lookup),
				),
			} satisfies DocResult);
		} else {
			const lookup = cfbLookup(msg.buffer);
			let textOnly = false;
			const deck = withFallback(
				() => parsePpt(lookup),
				() => {
					const text = extractPpt(lookup);
					textOnly = true;
					return textDeck(text.kind === "slides" ? text.slides : []);
				},
			);
			self.postMessage({ ok: true, deck, textOnly } satisfies DeckResult);
		}
	} catch (err) {
		self.postMessage({
			ok: false,
			reason: isPassword(err) ? "password" : "corrupt",
			detail: String(err),
		});
	}
};
