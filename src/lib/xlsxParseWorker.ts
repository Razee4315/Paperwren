/**
 * Workbook parse worker (docs/14 audit XLS-05): owns the SheetJS
 * import and the full parse off the UI thread. The main thread posts
 * { id, buffer } and receives a plain JSON payload — never React or
 * DOM objects. A viewer terminates this worker to cancel obsolete
 * work when the document closes or changes.
 */

import * as XLSX from "xlsx";
import { parseWorkbook } from "./workbookModel";

self.onmessage = (e: MessageEvent) => {
	const { id, buffer } = e.data as { id: number; buffer: ArrayBuffer };
	let result: ReturnType<typeof parseWorkbook>;
	try {
		result = parseWorkbook(XLSX, buffer);
	} catch (err) {
		result = {
			ok: false as const,
			reason: "corrupt" as const,
			detail: String(err),
		};
	}
	(self as unknown as Worker).postMessage({ id, ...result });
};
