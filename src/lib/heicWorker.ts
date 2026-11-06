/**
 * HEIC and HEIF pictures (what an iPhone saves) decoded where the
 * webview has no decoder of its own: Windows, and anywhere else the
 * system cannot. libheif, built to WebAssembly, runs here in a worker
 * so a large photo never holds up the screen, and hands back a JPEG.
 *
 * libheif is LGPL-3.0, so it ships as its own file (libheif.wasm) that
 * can be swapped for another build, and is listed in Settings, About.
 */

import createLibheif from "libheif-js/libheif-wasm/libheif.js";
import wasmUrl from "libheif-js/libheif-wasm/libheif.wasm?url";

interface HeifImage {
	get_width(): number;
	get_height(): number;
	is_primary(): boolean;
	display(target: ImageData, done: (result: ImageData | null) => void): void;
	free(): void;
}
interface Libheif {
	HeifDecoder: new () => { decode(bytes: Uint8Array): HeifImage[] };
}

let ready: Promise<Libheif> | null = null;
const libheif = () => {
	if (ready) return ready;
	ready = new Promise<Libheif>((resolve, reject) => {
		try {
			// Its own types leave out the decoder classes it adds. The
			// options become the module, and can be ready at once.
			const create = createLibheif as unknown as (options: object) => void;
			const options: Record<string, unknown> = {
				locateFile: () => wasmUrl,
				onRuntimeInitialized: () => resolve(options as unknown as Libheif),
				onAbort: (why: unknown) => reject(new Error(String(why))),
			};
			create(options);
		} catch (err) {
			reject(err);
		}
	});
	// A failed start may be tried again with the next picture.
	ready.catch(() => {
		ready = null;
	});
	return ready;
};

/** Pictures over 50 megapixels are not drawn: a canvas that
 * large fails on most devices. */
const MAX_PIXELS = 50_000_000;

async function toJpeg(bytes: Uint8Array): Promise<Blob | null> {
	const lib = await libheif();
	const images = new lib.HeifDecoder().decode(bytes);
	const image = images.find((i) => i.is_primary()) ?? images[0];
	if (!image) return null;
	try {
		const width = image.get_width();
		const height = image.get_height();
		if (!width || !height || width * height > MAX_PIXELS) return null;
		const pixels = await new Promise<ImageData | null>((resolve) =>
			image.display(new ImageData(width, height), resolve),
		);
		if (!pixels) return null;
		const canvas = new OffscreenCanvas(width, height);
		const context = canvas.getContext("2d");
		if (!context) return null;
		context.putImageData(pixels, 0, 0);
		return await canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 });
	} finally {
		for (const i of images) i.free();
	}
}

self.onmessage = async (
	event: MessageEvent<{ id: number; bytes: Uint8Array }>,
) => {
	const { id, bytes } = event.data;
	let jpeg: Blob | null = null;
	try {
		jpeg = await toJpeg(bytes);
	} catch {
		jpeg = null;
	}
	self.postMessage({ id, jpeg });
};
