/**
 * pdf.js, loaded once when a PDF is first shown or a tool needs to
 * draw one, with the files it reads shipped inside the app.
 */

import type { PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "./pdfWorker?worker&url";

/** Where pdf.js finds its character maps and standard fonts: beside
 * the app (see vite.config.ts), never on the network. */
export const pdfAsset = (dir: string) =>
	new URL(`pdfjs/${dir}/`, document.baseURI).toString();

/**
 * How every PDF is opened, by the viewer and by the tools alike.
 *
 * pdf.js hands JPEG pictures to the browser's ImageDecoder wherever it
 * finds no `window.chrome`, which is the case in Android's WebView (a
 * desktop WebView2 has it). That decoder turns a picture by its EXIF
 * orientation, which a PDF must ignore: a page that is a phone photo
 * came out turned on its side on Android only (#80). pdf.js's own
 * decoder draws the picture as stored, as every other reader does.
 */
export function documentOptions() {
	return {
		isEvalSupported: false,
		isImageDecoderSupported: false,
		cMapUrl: pdfAsset("cmaps"),
		cMapPacked: true,
		standardFontDataUrl: pdfAsset("standard_fonts"),
	};
}

/**
 * The legacy build, not the modern one: the modern build needs a
 * Chromium from late 2023 (Promise.withResolvers and more), and phones
 * whose WebView is not kept up to date, Huawei's among them, could open
 * no PDF at all. Its worker is built by Vite (pdfWorker.ts) so it is
 * lowered and filled in the same way as the app.
 */
export async function loadEngine() {
	const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
	pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
	startSpare();
	// pdf_viewer.mjs reads the core library from this global.
	(globalThis as { pdfjsLib?: unknown }).pdfjsLib = pdfjs;
	const viewer = await import("pdfjs-dist/legacy/web/pdf_viewer.mjs");
	return { pdfjs, viewer };
}

/**
 * A worker started before it is needed. Starting one (fetching and
 * compiling pdf.js's worker script) is a good part of the wait for a
 * first page; with one ready, the document chosen next skips it. Each
 * document still has a worker of its own, ended with it.
 */
let spare: Worker | null = null;
let refill = 0;
function startSpare() {
	if (spare || typeof Worker === "undefined") return;
	try {
		spare = new Worker(workerUrl, { type: "module" });
	} catch {
		spare = null;
	}
}

type Engine = Awaited<ReturnType<typeof loadEngine>>["pdfjs"];
type PdfWorker = InstanceType<Engine["PDFWorker"]>;

/** The worker for a document the viewer opens: the spare when there is
 * one (`worker` for getDocument; `release` ends it with the document),
 * else nothing, and pdf.js starts its own as usual. */
export function documentWorker(pdfjs: Engine): {
	worker?: PdfWorker;
	release: () => void;
} {
	const port = spare;
	spare = null;
	// The next one, once this document has had the computer to itself.
	window.clearTimeout(refill);
	refill = window.setTimeout(startSpare, SPARE_AFTER);
	if (!port) return { release: () => {} };
	let worker: PdfWorker;
	try {
		// (pdf.js types the port as never given; it takes a Worker.)
		worker = new pdfjs.PDFWorker({ port: port as never });
	} catch {
		port.terminate();
		return { release: () => {} };
	}
	return {
		worker,
		release: () => {
			worker.destroy();
			port.terminate();
		},
	};
}
const SPARE_AFTER = 5000;

/** A PDF opened for drawing its pages (a tool's thumbnails, Fill &
 * sign from a tool). pdf.js is handed a copy: the bytes stay usable. */
export async function openPdf(
	bytes: Uint8Array,
	password?: string,
): Promise<PDFDocumentProxy> {
	const { pdfjs } = await loadEngine();
	return pdfjs.getDocument({
		...documentOptions(),
		data: bytes.slice(),
		password,
	}).promise;
}
