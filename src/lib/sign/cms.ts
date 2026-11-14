import { certificate } from "./certificate";
import {
	buffer,
	der,
	equal,
	expectTag,
	integer,
	objectId,
	octet,
	oid,
	read,
	seq,
	sequence,
	set,
} from "./der";
import { DigitalIdError } from "./errors";
import { OID } from "./oids";
import type { ImportedId } from "./pkcs12";

const digestId = (id: ImportedId) =>
	id.hash === "SHA-384"
		? OID.sha384
		: id.hash === "SHA-512"
			? OID.sha512
			: OID.sha256;
const signatureId = (id: ImportedId) =>
	id.kind === "RSA"
		? seq(oid(OID.rsa), der(5, new Uint8Array()))
		: seq(
				oid(
					id.hash === "SHA-384"
						? OID.ecdsaSha384
						: id.hash === "SHA-512"
							? OID.ecdsaSha512
							: OID.ecdsaSha256,
				),
			);
const algorithm = (id: ImportedId) =>
	id.kind === "RSA" ? "RSASSA-PKCS1-v1_5" : { name: "ECDSA", hash: id.hash };

export function ecdsaDer(signature: Uint8Array): Uint8Array {
	if (!signature.length || signature.length % 2) throw new Error("signature");
	const half = signature.length / 2;
	return seq(
		integer(signature.subarray(0, half)),
		integer(signature.subarray(half)),
	);
}

export function ecdsaRaw(
	signature: Uint8Array,
	coordinate: number,
): Uint8Array {
	const parts = sequence(read(signature));
	if (parts.length !== 2) throw new Error("signature");
	const out = new Uint8Array(coordinate * 2);
	parts.forEach((part, i) => {
		const bytes = expectTag(part, 2).value;
		if (!bytes.length || bytes[0] & 128) throw new Error("signature");
		const value = bytes[0] === 0 ? bytes.subarray(1) : bytes;
		if (value.length > coordinate) throw new Error("signature");
		out.set(value, (i + 1) * coordinate - value.length);
	});
	return out;
}

async function attributes(
	digest: Uint8Array,
	id: ImportedId,
): Promise<Uint8Array> {
	const cert = certificate(id.chain[0]);
	const certHash = new Uint8Array(
		await crypto.subtle.digest(id.hash, buffer(id.chain[0])),
	);
	const attribute = (name: string, value: Uint8Array) =>
		seq(oid(name), set(value));
	const ess = seq(
		...(id.hash === "SHA-256" ? [] : [seq(oid(digestId(id)))]),
		octet(certHash),
		seq(seq(der(164, cert.issuer.raw)), cert.serial.raw),
	);
	return set(
		attribute(OID.contentType, oid(OID.data)),
		attribute(OID.messageDigest, octet(digest)),
		attribute(OID.signingCertificateV2, seq(seq(ess))),
	);
}

/** Detached CMS with exactly the three PAdES B-B signed attributes. */
export async function createCms(
	digest: Uint8Array,
	id: ImportedId,
): Promise<Uint8Array> {
	const expected = id.hash === "SHA-384" ? 48 : id.hash === "SHA-512" ? 64 : 32;
	if (digest.length !== expected) throw new DigitalIdError("not-digital-id");
	const cert = certificate(id.chain[0]);
	const attrs = await attributes(digest, id);
	const raw = new Uint8Array(
		await crypto.subtle.sign(algorithm(id), id.key, buffer(attrs)),
	);
	const signature = id.kind === "RSA" ? raw : ecdsaDer(raw);
	const hash = seq(oid(digestId(id)));
	const signer = seq(
		integer(1),
		seq(cert.issuer.raw, cert.serial.raw),
		hash,
		der(160, read(attrs).value),
		signatureId(id),
		octet(signature),
	);
	const cms = seq(
		oid(OID.signedData),
		der(
			160,
			seq(
				integer(1),
				set(hash),
				seq(oid(OID.data)),
				der(160, read(set(...id.chain)).value),
				set(signer),
			),
		),
	);
	if (!(await verifyCms(cms, digest, id))) throw new DigitalIdError("mismatch");
	return cms;
}

/** Verify the bytes read back from the PDF against this session's certificate. */
export async function verifyCms(
	cms: Uint8Array,
	digest: Uint8Array,
	id: ImportedId,
): Promise<boolean> {
	try {
		const content = sequence(read(cms));
		if (objectId(content[0]) !== OID.signedData) return false;
		const signed = sequence(expectTag(content[1], 160).children[0]);
		const signer = sequence(expectTag(signed[4], 49).children[0]);
		const attrs = expectTag(signer[3], 160);
		const canonical = await attributes(digest, id);
		if (!equal(der(49, attrs.value), canonical)) return false;
		if (
			!equal(signer[2].raw, seq(oid(digestId(id)))) ||
			!equal(signer[4].raw, signatureId(id))
		)
			return false;
		const pub = await crypto.subtle.importKey(
			"spki",
			buffer(certificate(id.chain[0]).spki.raw),
			id.kind === "RSA"
				? { name: "RSASSA-PKCS1-v1_5", hash: id.hash }
				: { name: "ECDSA", namedCurve: id.kind },
			false,
			["verify"],
		);
		const signature = expectTag(signer[5], 4).value;
		return await crypto.subtle.verify(
			algorithm(id),
			pub,
			buffer(
				id.kind === "RSA"
					? signature
					: ecdsaRaw(signature, Math.ceil(id.bits / 8)),
			),
			buffer(canonical),
		);
	} catch {
		return false;
	}
}
