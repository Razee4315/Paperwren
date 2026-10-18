import { backend } from "@/lib/backend";
import { extensionOf } from "@/lib/formats";
import { MAX_SRC, type Signature, inkBounds } from "@/lib/signatures";

/** The widest a kept signature or stamp is, in pixels. */
export const MAX_WIDTH = 1200;
/** The longest side a picked picture is worked on at. */
const MAX_PICTURE = 1600;

const TYPES: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	webp: "image/webp",
	gif: "image/gif",
	bmp: "image/bmp",
};

/** Draw a picture's bytes, through whichever way the webview can. */
async function decode(
	bytes: ArrayBuffer,
	type: string,
): Promise<CanvasImageSource & { width: number; height: number }> {
	const blob = new Blob([bytes], type ? { type } : undefined);
	try {
		return await createImageBitmap(blob);
	} catch {
		const url = URL.createObjectURL(blob);
		try {
			const img = new Image();
			img.src = url;
			await img.decode();
			return Object.assign(img, {
				width: img.naturalWidth,
				height: img.naturalHeight,
			});
		} finally {
			URL.revokeObjectURL(url);
		}
	}
}

/**
 * Ask for a picture (a PNG of a signature or a stamp, or a photo of one
 * on paper) and draw it on a canvas of its own, not over 1600 pixels a
 * side. Null when nothing was picked; throws when it can't be read.
 */
export async function pickPicture(): Promise<HTMLCanvasElement | null> {
	const picked = await backend.pickFile({ pictures: true }).catch(() => null);
	if (!picked) return null;
	const bytes = await backend.read(picked.reopen);
	const image = await decode(bytes, TYPES[extensionOf(picked.name)] ?? "");
	if (!image.width || !image.height) throw new Error("empty picture");
	const scale = Math.min(1, MAX_PICTURE / Math.max(image.width, image.height));
	const canvas = document.createElement("canvas");
	canvas.width = Math.max(1, Math.round(image.width * scale));
	canvas.height = Math.max(1, Math.round(image.height * scale));
	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	if (!ctx) throw new Error("no canvas");
	ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
	if ("close" in image && typeof image.close === "function") image.close();
	return canvas;
}

/** Work on a canvas's pixels in place. */
export function withPixels(
	canvas: HTMLCanvasElement,
	change: (data: Uint8ClampedArray) => void,
): HTMLCanvasElement {
	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	if (!ctx) return canvas;
	const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
	change(image.data);
	ctx.putImageData(image, 0, 0);
	return canvas;
}

/** Whether anything shows on a canvas. */
export function hasInk(canvas: HTMLCanvasElement): boolean {
	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	if (!ctx) return false;
	const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
	return !!inkBounds(data, canvas.width, canvas.height, 0);
}

/** A copy of a canvas, as a fresh one may be changed without the first. */
export function copyCanvas(canvas: HTMLCanvasElement): HTMLCanvasElement {
	const out = document.createElement("canvas");
	out.width = canvas.width;
	out.height = canvas.height;
	out.getContext("2d")?.drawImage(canvas, 0, 0);
	return out;
}

/**
 * What is drawn on `canvas`, cut to its ink, as a picture to keep: a PNG
 * small enough to be kept. Null when nothing shows.
 */
export function cut(canvas: HTMLCanvasElement): Signature | null {
	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	if (!ctx) return null;
	const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
	const box = inkBounds(data, canvas.width, canvas.height, 8);
	if (!box) return null;
	let scale = Math.min(1, MAX_WIDTH / Math.max(box.w, box.h));
	for (;;) {
		const out = document.createElement("canvas");
		out.width = Math.max(1, Math.round(box.w * scale));
		out.height = Math.max(1, Math.round(box.h * scale));
		out
			.getContext("2d")
			?.drawImage(
				canvas,
				box.x,
				box.y,
				box.w,
				box.h,
				0,
				0,
				out.width,
				out.height,
			);
		const src = out.toDataURL("image/png");
		// A busy picture (a colour scan) is made smaller until it can be kept.
		if (src.length <= MAX_SRC || out.width <= 200) {
			return {
				id: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
				src,
				w: out.width,
				h: out.height,
			};
		}
		scale *= 0.75;
	}
}
