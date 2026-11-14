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
		// The only permitted detail is an algorithm identifier.
		super(
			detail && /^\d+(\.\d+)+$/.test(detail) ? `${reason}: ${detail}` : reason,
		);
		this.name = "DigitalIdError";
	}
}
