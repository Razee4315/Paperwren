/**
 * Tesseract in a worker of its own, so a page being read never holds up
 * the screen. It works on files in the module's own memory and has no
 * way of reaching the network.
 */

// @ts-expect-error the core ships no types
import TesseractCore from "tesseract.js-core/tesseract-core-simd-lstm.js";
import coreWasm from "tesseract.js-core/tesseract-core-simd-lstm.wasm?url";
import { type OcrReply, type OcrRequest, cleanPage } from "./ocr";

interface Api {
	Init(path: null, language: string, engine: number): number;
	SetVariable(name: string, value: string): boolean;
	SetImageFile(exif: number, angle: number): number;
	Recognize(monitor: null): number;
	GetTSVText(page: number): string;
}

interface Core {
	FS: { writeFile(path: string, data: Uint8Array): void };
	TessBaseAPI: new () => Api;
}

/** Tesseract's neural network engine, the only one in this build. */
const LSTM = 1;
/** Find the page's own layout: blocks, columns and lines. */
const AUTO_LAYOUT = "3";

let core: Core | null = null;
let api: Api | null = null;

const post = (reply: OcrReply) => self.postMessage(reply);

async function start(language: string, data: ArrayBuffer) {
	core = (await TesseractCore({
		locateFile: () => coreWasm,
		// The engine says how far through a page it is as it reads.
		TesseractProgress: (percent: number) => post({ kind: "progress", percent }),
	})) as Core;
	core.FS.writeFile(`./${language}.traineddata`, new Uint8Array(data));
	api = new core.TessBaseAPI();
	if (api.Init(null, language, LSTM)) throw new Error("language not loaded");
	api.SetVariable("tessedit_pageseg_mode", AUTO_LAYOUT);
}

/** The picture with its shading and speckle cleaned away, as a JPEG. */
async function cleaned(picture: Uint8Array): Promise<Uint8Array> {
	const bitmap = await createImageBitmap(
		new Blob([picture as BlobPart], { type: "image/jpeg" }),
	);
	const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
	const context = canvas.getContext("2d", { willReadFrequently: true });
	if (!context) throw new Error("no canvas");
	context.drawImage(bitmap, 0, 0);
	bitmap.close();
	const image = context.getImageData(0, 0, canvas.width, canvas.height);
	cleanPage(image.data, image.width, image.height);
	context.putImageData(image, 0, 0);
	const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
	return new Uint8Array(await blob.arrayBuffer());
}

async function read(picture: Uint8Array): Promise<string> {
	if (!core || !api) throw new Error("not started");
	core.FS.writeFile("/input", await cleaned(picture));
	if (api.SetImageFile(1, 0) === 1) throw new Error("picture not read");
	api.Recognize(null);
	return api.GetTSVText(0);
}

self.onmessage = async ({ data: request }: MessageEvent<OcrRequest>) => {
	if (request.kind === "start") {
		try {
			await start(request.language, request.data);
			post({ kind: "ready" });
		} catch (err) {
			post({ kind: "failed", message: String(err) });
		}
		return;
	}
	try {
		post({ kind: "read", id: request.id, table: await read(request.picture) });
	} catch (err) {
		post({ kind: "failed", id: request.id, message: String(err) });
	}
};
