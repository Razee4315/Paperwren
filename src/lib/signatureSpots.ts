/**
 * Whether a page looks like it wants signing. A suggestion, never a
 * promise: a page with a signature field, or a short line of text that
 * says so ("Signature:", "Firma", "دستخط").
 */

const WORDS = new Set([
	"signature",
	"signatures",
	"signatory",
	"signataire",
	"firma",
	"firmado",
	"assinatura",
	"assinado",
	"подпись",
	"توقيع",
	"دستخط",
	"हस्ताक्षर",
]);
const JOINED = ["sign here", "signed by", "firma aquí", "signé par"];
/** Scripts written without spaces. */
const PARTS = ["签名", "签字", "署名"];
/** What talks about signatures rather than asks for one. */
const NOT = /digital|electronic|verified|invalid|certificate/i;
/** A label is short. Longer, it is a sentence about signing. */
const MOST_LETTERS = 40;

export function asksForSignature(line: string): boolean {
	const text = line.trim().toLowerCase();
	if (!text || text.length > MOST_LETTERS || NOT.test(text)) return false;
	if (PARTS.some((part) => text.includes(part))) return true;
	if (JOINED.some((part) => text.includes(part))) return true;
	return text.split(/[^\p{L}\p{M}]+/u).some((word) => WORDS.has(word));
}

/** True when any of a page's lines of text asks for a signature. */
export function pageAsksForSignature(items: Array<{ str?: string }>): boolean {
	return items.some((item) => asksForSignature(item.str ?? ""));
}
