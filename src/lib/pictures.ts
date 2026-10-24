/**
 * A file as a run of pictures to show one at a time: a photo is one,
 * a scanned TIFF holds a page each, a comic book archive (CBZ) a picture
 * each. Each is drawn only when it is asked for, so a long comic is not
 * unpacked into memory whole.
 */

import type { FileFormat } from "./formats";
import { guardedUnzip } from "./safeZip";
import { COMIC_PAGE, isJunk, sniffImageType } from "./sniff";

export interface Pictures {
	count: number;
	/** The type of the file's pictures ("image/tiff", "image/heic"...). */
	type: string;
	/** Picture `i` as something an <img> shows. */
	page(i: number): Promise<Blob>;
}

const byName = new Intl.Collator(undefined, {
	numeric: true,
	sensitivity: "base",
});

/** A comic's pages, in the order their names count up ("page2" before
 * "page10"). */
export function comicPages(names: string[]): string[] {
	return names
		.filter((n) => COMIC_PAGE.test(n) && !isJunk(n))
		.sort(byName.compare);
}

function comic(bytes: Uint8Array): Pictures {
	const entries = guardedUnzip(bytes, {
		filter: (f) => COMIC_PAGE.test(f.name) && !isJunk(f.name),
	});
	const names = comicPages(Object.keys(entries));
	return {
		count: names.length,
		type: "application/vnd.comicbook+zip",
		page: async (i) => {
			const data = entries[names[i]];
			return new Blob([data as BlobPart], {
				type: sniffImageType(data) ?? "image/jpeg",
			});
		},
	};
}

interface Ifd {
	width: number;
	height: number;
	[tag: string]: unknown;
}
interface Utif {
	decode(buffer: ArrayBuffer): Ifd[];
	decodeImage(buffer: ArrayBuffer, ifd: Ifd, ifds?: Ifd[]): void;
	toRGBA8(ifd: Ifd): Uint8Array;
}

/** A TIFF's pages, each drawn when it is shown. Reduced copies a scanner
 * adds as thumbnails (subfile type 1) are not pages. */
async function tiff(buffer: ArrayBuffer): Promise<Pictures> {
	const imported = (await import("utif2")) as unknown as {
		default?: Utif;
	} & Utif;
	const UTIF = imported.default ?? imported;
	const ifds = UTIF.decode(buffer);
	const pages = ifds.filter((ifd) => {
		const kind = (ifd.t254 as number[] | undefined)?.[0] ?? 0;
		return ifd.t256 && ifd.t257 && (kind & 1) === 0;
	});
	const drawn = new Map<number, Promise<Blob>>();
	return {
		count: pages.length,
		type: "image/tiff",
		page: (i) => {
			let blob = drawn.get(i);
			if (!blob) {
				blob = (async () => {
					const ifd = pages[i];
					UTIF.decodeImage(buffer, ifd, ifds);
					const rgba = UTIF.toRGBA8(ifd);
					const canvas = document.createElement("canvas");
					canvas.width = ifd.width;
					canvas.height = ifd.height;
					const ctx = canvas.getContext("2d");
					if (!ctx) throw new Error("no canvas");
					ctx.putImageData(
						new ImageData(
							new Uint8ClampedArray(rgba.buffer as ArrayBuffer),
							ifd.width,
							ifd.height,
						),
						0,
						0,
					);
					// The decoded pixels are the heavy part: let them go.
					(ifd as { data?: unknown }).data = undefined;
					const png = await new Promise<Blob | null>((resolve) =>
						canvas.toBlob(resolve, "image/png"),
					);
					canvas.width = canvas.height = 0;
					if (!png) throw new Error("not drawn");
					return png;
				})();
				drawn.set(i, blob);
			}
			return blob;
		},
	};
}

/** The pictures of a file Paperwren shows as pictures. */
export async function readPictures(
	data: ArrayBuffer,
	format: FileFormat,
): Promise<Pictures> {
	const bytes = new Uint8Array(data);
	if (format === "cbz") return comic(bytes);
	const type = sniffImageType(bytes) ?? "image/png";
	if (type === "image/tiff") return tiff(data);
	const one = new Blob([data], { type });
	return { count: 1, type, page: async () => one };
}

declare global {
	interface Window {
		/** MainActivity's answer to decodePicture: the token, and the
		 * picture as a base64 JPEG, or null. */
		__paperwrenDecoded?: (token: string, jpeg: string | null) => void;
	}
}

/** Above this, a picture is not passed across to be drawn. */
const DECODE_MAX = 40 * 1024 * 1024;
let decodes = 0;

function toBase64(bytes: Uint8Array): string {
	let out = "";
	for (let i = 0; i < bytes.length; i += 0x8000)
		out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(out);
}

/**
 * A picture the webview cannot draw (HEIC, on Android), drawn by the
 * system instead and handed back as a JPEG. Null where nothing can.
 */
export function systemDecode(bytes: Uint8Array): Promise<Blob | null> {
	const bridge = window.__paperwrenAndroidExtras;
	if (!bridge?.decodePicture || bytes.byteLength > DECODE_MAX)
		return Promise.resolve(null);
	const token = `d${++decodes}`;
	return new Promise((resolve) => {
		const previous = window.__paperwrenDecoded;
		window.__paperwrenDecoded = (answered, jpeg) => {
			if (answered !== token) return previous?.(answered, jpeg);
			window.__paperwrenDecoded = previous;
			if (!jpeg) return resolve(null);
			const raw = atob(jpeg);
			const out = new Uint8Array(raw.length);
			for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
			resolve(new Blob([out], { type: "image/jpeg" }));
		};
		if (!bridge.decodePicture?.(toBase64(bytes), token)) {
			window.__paperwrenDecoded = previous;
			resolve(null);
		}
	});
}
