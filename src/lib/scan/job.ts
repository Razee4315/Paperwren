/**
 * A photo on its way to becoming a scanned page: decoded once at a
 * size worth keeping, then handed to a worker that straightens and
 * cleans it. Nothing here leaves the device.
 */
import { systemDecode } from "@/lib/pictures";
import type { Quad } from "./geometry";
import type { Look } from "./pixels";
import type { ScanAnswer, ScanRequest } from "./scanWorker";

/** The longest side a photo is kept at: past this a phone's 50 MP
 * photo only costs memory, not sharpness on a page. */
export const PHOTO_MAX = 3600;
/** The longest side the editor draws a photo at. */
const VIEW_MAX = 1600;
/** The longest side the page finders look at. */
const FIND_MAX = 1024;

export interface Photo {
	/** The photo, at most PHOTO_MAX on a side, turned the right way up.
	 * Handed over to a ScanJob (and gone from here) once one starts. */
	bitmap: ImageBitmap;
	/** Its size, which a quad's corners are measured in. */
	width: number;
	height: number;
	/** The same photo, small, for the editor to draw. */
	view: HTMLCanvasElement;
	/** Smaller still, for finding the page. */
	find: HTMLCanvasElement;
}

/** A picture's pixels, the right way up (the camera's orientation tag
 * is followed). Decoded off the page's own drawing, so a photo still
 * opens while the app is not on screen. */
const bitmapOf = (blob: Blob) =>
	createImageBitmap(blob, { imageOrientation: "from-image" }).catch(
		(err: unknown) => {
			// An older Chromium knows only "none" and "flipY" and refuses the
			// option outright; left out, it still follows the tag.
			if (err instanceof TypeError) return createImageBitmap(blob);
			throw err;
		},
	);

function drawn(
	from: CanvasImageSource,
	width: number,
	height: number,
	max: number,
): HTMLCanvasElement {
	const by = Math.min(1, max / Math.max(width, height));
	const canvas = document.createElement("canvas");
	canvas.width = Math.max(1, Math.round(width * by));
	canvas.height = Math.max(1, Math.round(height * by));
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("no canvas");
	ctx.imageSmoothingQuality = "high";
	ctx.drawImage(from, 0, 0, canvas.width, canvas.height);
	return canvas;
}

/** A photo, ready to scan. A HEIC photo the webview cannot draw is
 * drawn by the system where it can be. Rejects when the file is no
 * picture. */
export async function decodePhoto(blob: Blob): Promise<Photo> {
	let full: ImageBitmap;
	try {
		full = await bitmapOf(blob);
	} catch (err) {
		const jpeg = await systemDecode(new Uint8Array(await blob.arrayBuffer()));
		if (!jpeg) throw err;
		full = await bitmapOf(jpeg);
	}
	const fits = Math.max(full.width, full.height) <= PHOTO_MAX;
	const keep = fits ? null : drawn(full, full.width, full.height, PHOTO_MAX);
	const from = keep ?? full;
	const view = drawn(from, from.width, from.height, VIEW_MAX);
	const find = drawn(view, view.width, view.height, FIND_MAX);
	const { width, height } = from;
	let bitmap = full;
	if (keep) {
		full.close();
		bitmap = await createImageBitmap(keep);
		// Let the big canvas go now; the bitmap holds the pixels.
		keep.width = 0;
		keep.height = 0;
	}
	return { bitmap, width, height, view, find };
}

/** One photo's worker. Requests run one at a time, in order. */
export class ScanJob {
	private worker: Worker;
	private chain: Promise<unknown> = Promise.resolve();
	readonly width: number;
	readonly height: number;

	constructor(bitmap: ImageBitmap) {
		this.width = bitmap.width;
		this.height = bitmap.height;
		this.worker = new Worker(new URL("./scanWorker.ts", import.meta.url), {
			type: "module",
		});
		this.send({ kind: "load", bitmap }, [bitmap]).catch(() => {});
	}

	private send(
		req: ScanRequest,
		transfer: Transferable[] = [],
	): Promise<ScanAnswer & { ok: true }> {
		const run = () =>
			new Promise<ScanAnswer & { ok: true }>((resolve, reject) => {
				this.worker.onmessage = (e: MessageEvent<ScanAnswer>) =>
					e.data.ok ? resolve(e.data) : reject(new Error(e.data.error));
				this.worker.onerror = (e) => reject(new Error(e.message || "worker"));
				this.worker.postMessage(req, transfer);
			});
		const next = this.chain.then(run, run);
		this.chain = next.catch(() => {});
		return next;
	}

	/** The page in every look, about `size` on its longer side. */
	async looks(
		quad: Quad,
		quarters: number,
		size: number,
	): Promise<Record<Look, ImageBitmap>> {
		const answer = await this.send({ kind: "looks", quad, quarters, size });
		if (answer.kind !== "looks") throw new Error("unexpected answer");
		return answer.looks;
	}

	/** The finished page, as a JPEG, with a small copy to show. */
	async render(quad: Quad, quarters: number, look: Look) {
		const answer = await this.send({
			kind: "render",
			quad,
			quarters,
			look,
			maxSide: 3200,
			quality: look === "bw" ? 0.9 : 0.86,
			thumb: 360,
		});
		if (answer.kind !== "render") throw new Error("unexpected answer");
		return answer;
	}

	close(): void {
		this.worker.terminate();
	}
}

/** What the finders need, sized for them, with where it maps back. */
export function photoScale(photo: Photo) {
	return {
		/** From editor pixels to kept-photo pixels. */
		view: photo.width / photo.view.width,
		/** From finder pixels to kept-photo pixels. */
		find: photo.width / photo.find.width,
	};
}

export type { Look };
