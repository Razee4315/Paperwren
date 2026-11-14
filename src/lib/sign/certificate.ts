import { type Asn1, equal, expectTag, objectId, read, sequence } from "./der";

/** Raw certificate fields are copied unchanged into CMS. */
export function certificate(bytes: Uint8Array) {
	const outer = sequence(read(bytes));
	const tbs = sequence(outer[0]);
	const at = tbs[0]?.tag === 160 ? 1 : 0;
	const serial = expectTag(tbs[at], 2);
	const issuer = expectTag(tbs[at + 2], 48);
	const validity = sequence(tbs[at + 3]);
	const subject = expectTag(tbs[at + 4], 48);
	const spki = expectTag(tbs[at + 5], 48);
	const extensions = tbs.find((part) => part.tag === 163)?.children[0];
	const values = new Map<string, Asn1>();
	if (extensions)
		for (const extension of sequence(extensions)) {
			const parts = sequence(extension);
			const value = parts[parts.length - 1];
			values.set(objectId(parts[0]), read(expectTag(value, 4).value));
		}
	const constraints = values.get("2.5.29.19");
	return {
		serial,
		issuer,
		subject,
		spki,
		validity,
		extensions: values,
		selfSigned: equal(issuer.raw, subject.raw),
		ca: !!(
			constraints &&
			sequence(constraints)[0]?.tag === 1 &&
			sequence(constraints)[0].value[0]
		),
	};
}
