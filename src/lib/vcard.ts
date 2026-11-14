/** Offline vCard reader. Limits bound damaged exports and embedded pictures. */
import { decodeText } from "./text";

export interface ContactValue {
	kind: "TEL" | "EMAIL" | "ADR" | "ORG" | "TITLE" | "URL" | "BDAY" | "NOTE";
	value: string;
	types: string[];
}
export interface Contact {
	name: string;
	photo?: string;
	values: ContactValue[];
}
export const VCARD_LIMIT = 40 * 1024 * 1024;
const PHOTO_LIMIT = 4 * 1024 * 1024;
const unescapeValue = (s: string) =>
	s.replace(/\\([nN,;\\])/g, (_, c: string) => (/n/i.test(c) ? "\n" : c));
function parts(s: string): string[] {
	const out: string[] = [];
	let start = 0;
	for (let i = 0; i < s.length; i++) {
		if (s[i] === "\\") {
			i++;
			continue;
		}
		if (s[i] === ";") {
			out.push(unescapeValue(s.slice(start, i)));
			start = i + 1;
		}
	}
	out.push(unescapeValue(s.slice(start)));
	return out;
}
function decode(bytes: Uint8Array, charset: string): string {
	try {
		return new TextDecoder(charset).decode(bytes);
	} catch {
		return new TextDecoder().decode(bytes);
	}
}
function binary(s: string): Uint8Array {
	return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
function birthday(s: string): string {
	return s
		.replace(/^(\d{4})(\d{2})(\d{2})(?=T|$)/, "$1-$2-$3")
		.replace(/^--(\d{2})(\d{2})$/, "--$1-$2");
}
/** Read what survives a malformed card, including a final card without END. */
export function parseVCard(input: ArrayBuffer | string): Contact[] {
	let raw: string;
	let bytesMode = false;
	if (typeof input === "string") raw = input.slice(0, VCARD_LIMIT);
	else {
		const bytes = new Uint8Array(
			input,
			0,
			Math.min(input.byteLength, VCARD_LIMIT),
		);
		if (
			(bytes[0] === 255 && bytes[1] === 254) ||
			(bytes[0] === 254 && bytes[1] === 255)
		)
			raw = decodeText(bytes.slice().buffer);
		else {
			bytesMode = true;
			const chunks: string[] = [];
			for (let i = 0; i < bytes.length; i += 8192)
				chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
			raw = chunks.join("").replace(/^\xEF\xBB\xBF/, "");
		}
	}
	const lines: string[] = [];
	for (const line of raw.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/)) {
		const prev = lines[lines.length - 1];
		if (
			prev &&
			/;ENCODING="?QUOTED-PRINTABLE"?[;:]/i.test(prev) &&
			prev.endsWith("=")
		)
			lines[lines.length - 1] = prev.slice(0, -1) + line.replace(/^[ \t]/, "");
		else if (prev && /^[ \t]/.test(line))
			lines[lines.length - 1] += line.slice(1);
		else if (
			prev &&
			/;ENCODING="?(?:BASE64|b)"?[;:]/i.test(prev) &&
			/^[A-Za-z0-9+/=]+$/.test(line)
		)
			lines[lines.length - 1] += line;
		else lines.push(line);
	}
	const contacts: Contact[] = [];
	let card: Contact | null = null;
	let fallback = "";
	let photoBytes = 0;
	const finish = () => {
		if (card && contacts.length < 10000) {
			card.name ||= fallback;
			contacts.push(card);
		}
		card = null;
		fallback = "";
	};
	for (const line of lines) {
		if (/^BEGIN:VCARD\s*$/i.test(line)) {
			finish();
			card = { name: "", values: [] };
			continue;
		}
		if (/^END:VCARD\s*$/i.test(line)) {
			finish();
			continue;
		}
		if (!card || card.values.length >= 1000) continue;
		try {
			const match = /^((?:[^":]|"[^"]*")*):(.*)$/.exec(line);
			if (!match) continue;
			const header = match[1].split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/);
			const key = (header.shift() ?? "").split(".").pop()?.toUpperCase();
			const params: Record<string, string> = {};
			const types: string[] = [];
			for (const p of header) {
				const at = p.indexOf("=");
				if (at < 0) types.push(p.toLowerCase());
				else {
					const k = p.slice(0, at).toUpperCase();
					const v = p.slice(at + 1).replace(/^"|"$/g, "");
					params[k] = v;
					if (k === "TYPE") types.push(...v.toLowerCase().split(","));
				}
			}
			let value = match[2];
			const encoding = params.ENCODING?.toUpperCase();
			if (key === "PHOTO") {
				if (
					value.length > PHOTO_LIMIT ||
					photoBytes + value.length > 16 * 1024 * 1024
				)
					continue;
				const uri = /^data:image\/(png|jpeg)(;base64)?,([\s\S]*)$/i.exec(value);
				if (uri)
					value = uri[2]
						? uri[3]
						: btoa(
								uri[3].replace(/%([0-9a-f]{2})/gi, (_, hex: string) =>
									String.fromCharCode(Number.parseInt(hex, 16)),
								),
							);
				else if (encoding !== "BASE64" && encoding !== "B") continue;
				const b64 = value.replace(/\s/g, "");
				const decoded = atob(b64);
				const mime = decoded.startsWith("\x89PNG\r\n\x1a\n")
					? "png"
					: decoded.startsWith("\xff\xd8\xff")
						? "jpeg"
						: null;
				if (mime) {
					card.photo = `data:image/${mime};base64,${b64}`;
					photoBytes += value.length;
				}
				continue;
			}
			if (encoding === "QUOTED-PRINTABLE") {
				const s = value.replace(/=([0-9a-f]{2})/gi, (_, h: string) =>
					String.fromCharCode(Number.parseInt(h, 16)),
				);
				value = decode(binary(s), params.CHARSET || "utf-8");
			} else if (encoding === "BASE64" || encoding === "B")
				value = decode(binary(atob(value)), params.CHARSET || "utf-8");
			else if (bytesMode)
				value = params.CHARSET
					? decode(binary(value), params.CHARSET)
					: decodeText(binary(value).buffer as ArrayBuffer);
			if (key === "FN") card.name = unescapeValue(value);
			else if (key === "N") {
				const n = parts(value);
				fallback = [n[3], n[1], n[2], n[0], n[4]].filter(Boolean).join(" ");
			} else if (key && /^(TEL|EMAIL|ADR|ORG|TITLE|URL|BDAY|NOTE)$/.test(key)) {
				value =
					key === "ADR"
						? parts(value).filter(Boolean).join("\n")
						: key === "ORG"
							? parts(value).filter(Boolean).join(" · ")
							: unescapeValue(value);
				if (key === "BDAY") value = birthday(value);
				if (key === "TEL") value = value.replace(/^tel:/i, "");
				if (value.trim())
					card.values.push({ kind: key as ContactValue["kind"], value, types });
			}
		} catch {
			/* Keep the rest of a damaged export readable. */
		}
	}
	finish();
	return contacts;
}
