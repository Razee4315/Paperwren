// Placeholder: replaced by the real module from the digital-id branch.
import type { Placement } from "../pdfTools";

export type DigitalIdProblem =
	| "password"
	| "not-digital-id"
	| "unsupported"
	| "no-key"
	| "key-type"
	| "mismatch";

export class DigitalIdError extends Error {
	constructor(
		readonly reason: DigitalIdProblem,
		detail?: string,
	) {
		super(detail ?? reason);
	}
}

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
	key: "RSA" | "P-256" | "P-384" | "P-521";
	bits: number;
}

export interface DigitalId {
	summary: DigitalIdSummary;
	forget(): void;
}

export function readDigitalId(
	_file: Uint8Array,
	_password: string,
): Promise<DigitalId> {
	throw new Error("not built yet");
}

export type SignBlocker = "encrypted" | "certified" | "damaged";

export function canSign(
	_pdf: Uint8Array,
): Promise<{ signed: boolean; blocker?: SignBlocker }> {
	throw new Error("not built yet");
}

export function signPdf(
	_pdf: Uint8Array,
	_id: DigitalId,
	_options: {
		appearance: {
			placement: Placement;
			png: Uint8Array;
			caption?: string;
		} | null;
		field?: string;
		now?: Date;
	},
): Promise<Uint8Array> {
	throw new Error("not built yet");
}
