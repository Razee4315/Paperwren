import { DigitalIdError } from "./errors";
import { PdfSignError, canSign, type SignOptions, signWithId } from "./pades";
import { type ImportedId, readPkcs12 } from "./pkcs12";
import { type DigitalIdSummary, certificateSummary } from "./x509";

export { DigitalIdError } from "./errors";
export type { DigitalIdProblem } from "./errors";
export { canSign, PdfSignError } from "./pades";
export type { SignBlocker } from "./pades";
export type { DigitalIdSummary } from "./x509";

export interface DigitalId {
	summary: DigitalIdSummary;
	forget(): void;
}

const sessions = new WeakMap<DigitalId, ImportedId>();

/** Check the original before a full rewrite can hide a repaired object graph. */
export async function prepareSigningCopy(
	pdf: Uint8Array,
	rewrite: () => Promise<Uint8Array>,
): Promise<Uint8Array> {
	const checked = await canSign(pdf);
	if (checked.blocker) throw new PdfSignError(checked.blocker);
	return rewrite();
}

export async function readDigitalId(
	file: Uint8Array,
	password: string,
): Promise<DigitalId> {
	const imported = await readPkcs12(file, password);
	try {
		const id: DigitalId = {
			summary: certificateSummary(imported),
			forget() {
				sessions.delete(id);
			},
		};
		sessions.set(id, imported);
		return id;
	} catch {
		throw new DigitalIdError("not-digital-id");
	}
}

export async function signPdf(
	pdf: Uint8Array,
	id: DigitalId,
	options: SignOptions,
): Promise<Uint8Array> {
	const imported = sessions.get(id);
	if (!imported) throw new DigitalIdError("no-key");
	return signWithId(pdf, imported, id.summary.name, options);
}
