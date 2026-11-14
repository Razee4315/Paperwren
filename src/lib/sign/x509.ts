import { certificate } from "./certificate";
import { type Asn1, expectTag, objectId, sequence } from "./der";
import type { ImportedId, KeyKind } from "./pkcs12";

export interface DigitalIdSummary {
	name: string;
	organisation?: string;
	email?: string;
	issuer: string;
	issuerOrganisation?: string;
	selfSigned: boolean;
	validFrom: Date;
	validUntil: Date;
	notForSigning: boolean;
	key: KeyKind;
	bits: number;
}

function text(node: Asn1): string {
	if (node.tag === 12)
		return new TextDecoder("utf-8", { fatal: true }).decode(node.value);
	if (node.tag === 30 || node.tag === 28) {
		const size = node.tag === 30 ? 2 : 4;
		if (node.value.length % size) throw new Error("certificate");
		let out = "";
		for (let at = 0; at < node.value.length; at += size) {
			let code = 0;
			for (let i = 0; i < size; i++) code = code * 256 + node.value[at + i];
			out += String.fromCodePoint(code);
		}
		return out;
	}
	if (![19, 20, 22, 26].includes(node.tag)) throw new Error("certificate");
	return Array.from(node.value, (n) => String.fromCharCode(n)).join("");
}

function name(node: Asn1) {
	const values = new Map<string, string>();
	for (const rdn of sequence(node))
		for (const attribute of expectTag(rdn, 49).children) {
			const [id, value] = sequence(attribute);
			values.set(objectId(id), text(value));
		}
	return {
		commonName: values.get("2.5.4.3"),
		organisation: values.get("2.5.4.10"),
		email: values.get("1.2.840.113549.1.9.1"),
	};
}

function time(node: Asn1 | undefined): Date {
	if (!node || (node.tag !== 23 && node.tag !== 24))
		throw new Error("certificate");
	const encoded = new TextDecoder().decode(node.value);
	const match = encoded.match(
		node.tag === 23
			? /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/
			: /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/,
	);
	if (!match) throw new Error("certificate");
	const parts = match.slice(1).map(Number);
	if (node.tag === 23) parts[0] += parts[0] < 50 ? 2000 : 1900;
	const [year, month, day, hour, minute, second] = parts;
	const out = new Date(0);
	out.setUTCFullYear(year, month - 1, day);
	out.setUTCHours(hour, minute, second, 0);
	if (
		out.getUTCFullYear() !== year ||
		out.getUTCMonth() !== month - 1 ||
		out.getUTCDate() !== day ||
		out.getUTCHours() !== hour ||
		out.getUTCMinutes() !== minute ||
		out.getUTCSeconds() !== second
	)
		throw new Error("certificate");
	return out;
}

const signingPurposes = new Set([
	"2.5.29.37.0",
	"1.3.6.1.5.5.7.3.4",
	"1.3.6.1.5.5.7.3.36",
	"1.2.840.113583.1.1.5",
	"1.3.6.1.4.1.311.10.3.12",
	"1.3.6.1.5.5.7.3.2",
]);

export function certificateSummary(
	id: Pick<ImportedId, "chain" | "kind" | "bits">,
): DigitalIdSummary {
	const cert = certificate(id.chain[0]);
	const subject = name(cert.subject);
	const issuer = name(cert.issuer);
	const san = cert.extensions.get("2.5.29.17");
	const email = san
		? sequence(san).find((node) => node.tag === 129)
		: undefined;
	const usage = cert.extensions.get("2.5.29.15");
	const extended = cert.extensions.get("2.5.29.37");
	return {
		name: subject.commonName ?? subject.organisation ?? subject.email ?? "",
		organisation: subject.organisation,
		email: email ? new TextDecoder().decode(email.value) : subject.email,
		issuer: issuer.commonName ?? issuer.organisation ?? "",
		issuerOrganisation: issuer.organisation,
		selfSigned: cert.selfSigned,
		validFrom: time(cert.validity[0]),
		validUntil: time(cert.validity[1]),
		notForSigning: !!(
			(usage && !(expectTag(usage, 3).value[1] & 192)) ||
			(extended &&
				!sequence(extended).some((purpose) =>
					signingPurposes.has(objectId(purpose)),
				))
		),
		key: id.kind,
		bits: id.bits,
	};
}

export function validityAt(
	summary: DigitalIdSummary,
	now = new Date(),
): "expired" | "not-yet-valid" | undefined {
	if (now < summary.validFrom) return "not-yet-valid";
	if (now > summary.validUntil) return "expired";
	return undefined;
}
