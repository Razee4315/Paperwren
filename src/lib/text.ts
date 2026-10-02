/** Decode text bytes: BOM-aware UTF-16/UTF-8, then strict UTF-8, then
 * Windows-1252 (the usual encoding of older .txt/.csv files). */
export function decodeText(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	if (bytes[0] === 0xff && bytes[1] === 0xfe)
		return new TextDecoder("utf-16le").decode(bytes.subarray(2));
	if (bytes[0] === 0xfe && bytes[1] === 0xff)
		return new TextDecoder("utf-16be").decode(bytes.subarray(2));
	if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
		return new TextDecoder().decode(bytes.subarray(3));
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		return new TextDecoder("windows-1252").decode(bytes);
	}
}
