/**
 * The part of the PDF tools that needs the browser: storing a picture
 * again through a canvas.
 */

import type { StoredPicture } from "@/lib/pdfTools";

/** A picture at most `side` pixels long as a JPEG, or null where it
 * cannot be drawn. A picture's see-through parts are its PDF mask's
 * business, so a solid white behind it does no harm. */
export async function recodePicture(
	picture: StoredPicture,
	{ side, quality }: { side: number; quality: number },
): Promise<{ bytes: Uint8Array; width: number; height: number } | null> {
	const scale = Math.min(1, side / Math.max(picture.width, picture.height));
	const width = Math.max(1, Math.round(picture.width * scale));
	const height = Math.max(1, Math.round(picture.height * scale));
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext("2d");
	if (!ctx) return null;
	ctx.imageSmoothingQuality = "high";
	const source = picture.raw
		? await rawBitmap(picture)
		: await createImageBitmap(
				new Blob([picture.bytes as BlobPart], { type: "image/jpeg" }),
			);
	ctx.drawImage(source, 0, 0, width, height);
	source.close();
	const blob = await new Promise<Blob | null>((done) =>
		canvas.toBlob(done, "image/jpeg", quality),
	);
	return blob
		? { bytes: new Uint8Array(await blob.arrayBuffer()), width, height }
		: null;
}

function rawBitmap({ bytes, width, height, channels }: StoredPicture) {
	const rgba = new Uint8ClampedArray(width * height * 4);
	for (let i = 0, from = 0; i < rgba.length; i += 4, from += channels) {
		rgba[i] = bytes[from];
		rgba[i + 1] = bytes[channels === 3 ? from + 1 : from];
		rgba[i + 2] = bytes[channels === 3 ? from + 2 : from];
		rgba[i + 3] = 255;
	}
	return createImageBitmap(new ImageData(rgba, width, height));
}
