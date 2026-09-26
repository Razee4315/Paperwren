/**
 * Off-main-thread parsing: spreadsheets (SheetJS) and text from
 * legacy binary Office files / RTF. The UI posts bytes and gets plain
 * JSON back; terminating the worker cancels the work.
 */

import * as XLSX from "xlsx";
import { extractDoc, extractPpt } from "./office/legacy";
import { extractRtf } from "./office/rtf";
import { parseWorkbook } from "./workbookModel";

export type WorkerRequest =
	| { type: "workbook"; buffer: ArrayBuffer | string }
	| { type: "doc" | "ppt" | "rtf"; buffer: ArrayBuffer };

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

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
	const msg = event.data;
	try {
		if (msg.type === "workbook") {
			self.postMessage(parseWorkbook(XLSX, msg.buffer));
		} else if (msg.type === "rtf") {
			self.postMessage({
				ok: true,
				doc: extractRtf(new Uint8Array(msg.buffer)),
			});
		} else {
			const lookup = cfbLookup(msg.buffer);
			const doc = msg.type === "doc" ? extractDoc(lookup) : extractPpt(lookup);
			self.postMessage({ ok: true, doc });
		}
	} catch (err) {
		const text = String(err);
		self.postMessage({
			ok: false,
			reason: text.includes("password") ? "password" : "corrupt",
			detail: text,
		});
	}
};
