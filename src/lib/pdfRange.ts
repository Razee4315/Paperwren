/**
 * A large PDF read a piece at a time. Read whole, a 350 MB file was held
 * three or four times over (Rust, the IPC message, the page, pdf.js's
 * worker) and the app ended (#97). pdf.js asks only for the pieces it
 * needs to draw what is on show, through a range transport, and the
 * file is never held whole.
 *
 * On a computer, and for a managed copy on a phone, Rust reads the
 * pieces (`read_file_range`, raw bytes). A phone's content:// document
 * is read by MainActivity (`readRange`, base64). Where neither can,
 * the file is read whole as before.
 */

import type { PDFDataRangeTransport } from "pdfjs-dist";
import { isDesktop, isTauri } from "./env";
import type { Reopen } from "./types";

/** What the viewer reads a streamed PDF through. */
export interface PdfStreamSource {
	/** The file's size in bytes. */
	size: number;
	/** `length` bytes from `offset`; fewer only at the end of the file. */
	readRange(offset: number, length: number): Promise<Uint8Array>;
	/** The same bytes `fileSample` in docMarks.ts takes of the whole
	 * file, so the marks of a document keep their key. */
	readSample(): Promise<Uint8Array>;
}

/** A PDF larger than this is streamed: its first page shows before the
 * rest is read, and a file of any size opens. Desktop uses a higher
 * threshold (8 MiB) so small/medium files rebuilt on disk (e.g. LaTeX)
 * keep a consistent in-memory copy while large files stream. */
export const STREAM_OVER = isDesktop ? 8 * 1024 * 1024 : 2 * 1024 * 1024;
/** pdf.js's piece size, and the one asked for here. Desktop uses 256 KiB
 * to cut IPC roundtrips ~4x on large streamed PDFs; mobile stays at 64 KiB
 * to keep per-chunk memory and synchronous bridge calls small. */
export const RANGE_CHUNK = isDesktop ? 256 * 1024 : 65536;
/** As in docMarks.ts: the first and last MiB name a file. */
const SAMPLE = 1 << 20;
/** The most asked of Rust in one call (its own cap is the same). */
const RUST_PIECE = 4 * 1024 * 1024;
/** The most asked of MainActivity in one call. Its answer is
 * synchronous, so each piece is kept short. */
const BRIDGE_PIECE = 1024 * 1024;

/** MainActivity's range reads (after 1.8.1). */
interface RangeBridge {
	readRange?(target: string, offset: number, length: number): string | null;
	fileSize?(target: string): number;
}

const bridge = (): RangeBridge | undefined =>
	typeof window === "undefined"
		? undefined
		: (window.__paperwrenAndroidExtras as unknown as RangeBridge | undefined);

/** Whether this file can be read a piece at a time here. */
export function canStream(reopen: Reopen): boolean {
	if (!isTauri) return false;
	if (reopen.kind === "path" || reopen.kind === "managed") return true;
	if (reopen.kind === "uri") {
		const b = bridge();
		return !!b?.readRange && !!b.fileSize;
	}
	return false;
}

function fromBase64(text: string): Uint8Array {
	const raw = atob(text);
	const out = new Uint8Array(raw.length);
	for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
	return out;
}

const nextTask = () => new Promise<void>((done) => window.setTimeout(done, 0));

/** One read of at most `piece` bytes, and the size of the file. */
type Reader = {
	size: number;
	piece: number;
	read(offset: number, length: number): Promise<Uint8Array>;
	/** Synchronous reads give the page a turn between pieces. */
	yields: boolean;
};

let coreApi: Promise<typeof import("@tauri-apps/api/core")> | null = null;

async function rustReader(path: string): Promise<Reader> {
	if (!coreApi) coreApi = import("@tauri-apps/api/core");
	const { invoke } = await coreApi;
	const size = await invoke<number>("file_size", { path });
	return {
		size,
		piece: RUST_PIECE,
		yields: false,
		async read(offset, length) {
			const bytes = await invoke<ArrayBuffer | number[]>("read_file_range", {
				path,
				offset,
				length,
			});
			return bytes instanceof ArrayBuffer
				? new Uint8Array(bytes)
				: Uint8Array.from(bytes);
		},
	};
}

function bridgeReader(uri: string, b: Required<RangeBridge>): Reader {
	const size = b.fileSize(uri);
	if (!(size >= 0)) throw new Error("size unknown");
	return {
		size,
		piece: BRIDGE_PIECE,
		yields: true,
		async read(offset, length) {
			const text = b.readRange(uri, offset, length);
			if (text == null) throw new Error("unreadable");
			return fromBase64(text);
		},
	};
}

/** A source for the file, or null when it cannot be read in pieces here
 * (the caller reads it whole). Asking costs one size query. */
export async function streamSource(
	reopen: Reopen,
): Promise<PdfStreamSource | null> {
	if (!canStream(reopen)) return null;
	let reader: Reader;
	if (reopen.kind === "uri") {
		const b = bridge();
		if (!b?.readRange || !b.fileSize) return null;
		reader = bridgeReader(reopen.uri, b as Required<RangeBridge>);
	} else if (reopen.kind === "path" || reopen.kind === "managed") {
		reader = await rustReader(reopen.path);
	} else return null;
	const { size } = reader;
	if (!Number.isFinite(size) || size <= 0) return null;

	const readRange = async (offset: number, length: number) => {
		const end = Math.min(size, offset + Math.max(0, length));
		if (end <= offset) return new Uint8Array(0);
		// One piece, as most of pdf.js's asks are: its bytes as they
		// came, with no second buffer to copy them into.
		if (end - offset <= reader.piece) {
			const got = await reader.read(offset, end - offset);
			if (got.byteLength !== end - offset) throw new Error("short read");
			return got;
		}
		const out = new Uint8Array(end - offset);
		let at = offset;
		while (at < end) {
			if (reader.yields && at > offset) await nextTask();
			const want = Math.min(reader.piece, end - at);
			const got = await reader.read(at, want);
			// A short read before the end means the file changed under us.
			if (got.byteLength !== want) throw new Error("short read");
			out.set(got, at - offset);
			at += want;
		}
		return out;
	};

	const readSample = async () => {
		const tail = new TextEncoder().encode(`:${size}`);
		const whole = size <= SAMPLE * 2;
		const body = whole ? size : SAMPLE * 2;
		const out = new Uint8Array(body + tail.length);
		if (whole) out.set(await readRange(0, size));
		else {
			// The head and the tail at once: two waits on the disk, not
			// one after the other.
			const [head, end] = await Promise.all([
				readRange(0, SAMPLE),
				readRange(size - SAMPLE, SAMPLE),
			]);
			out.set(head);
			out.set(end, SAMPLE);
		}
		out.set(tail, body);
		return out;
	};

	return { size, readRange, readSample };
}

/** What `getDocument` is given for a streamed PDF. */
export const STREAM_OPTIONS = {
	rangeChunkSize: RANGE_CHUNK,
	// Only what is drawn is read: no reading ahead of the reader...
	disableAutoFetch: true,
	// ...and no reading of the whole file from the start.
	disableStream: true,
} as const;

/**
 * pdf.js's range transport over a source. Each request is answered once,
 * with all its bytes, at the offset it asked from (pdf.js matches the
 * answer to the request by that). A read that fails is reported through
 * `onError`: pdf.js itself would only wait.
 */
export function createRangeTransport(
	pdfjs: { PDFDataRangeTransport: typeof PDFDataRangeTransport },
	source: PdfStreamSource,
	onError: (err: unknown) => void,
): PDFDataRangeTransport {
	class Transport extends pdfjs.PDFDataRangeTransport {
		private ended = false;

		requestDataRange(begin: number, end: number) {
			source.readRange(begin, end - begin).then(
				(chunk) => {
					if (this.ended) return;
					try {
						this.onDataRange(begin, chunk);
					} catch {
						// The request was given up meanwhile (the page moved on).
					}
				},
				(err) => {
					if (!this.ended) onError(err);
				},
			);
		}

		abort() {
			this.ended = true;
		}
	}
	return new Transport(source.size, null);
}
