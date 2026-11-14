/**
 * What is said about a digital ID before it signs, and why one could
 * not be used, in plain words. Kept apart from the dialogs so the words
 * can be tested without them.
 */

import { formatDate, msg, t } from "@/lib/i18n";
import type {
	DigitalIdProblem,
	DigitalIdSummary,
	SignBlocker,
} from "@/lib/sign";
import { cleanName } from "@/lib/sign/names";

/** Whether a certificate is valid on a day: before its first day, after
 * its last, or in between. */
export type Validity = "valid" | "expired" | "not-yet";

export function validity(summary: DigitalIdSummary, now: Date): Validity {
	if (now.getTime() < summary.validFrom.getTime()) return "not-yet";
	if (now.getTime() > summary.validUntil.getTime()) return "expired";
	return "valid";
}

/** A certificate's day, the way the reader writes dates. */
export function certificateDate(date: Date): string {
	return formatDate(date, { dateStyle: "medium" });
}

/** Who signs: the name, then the organisation and the email when the
 * certificate gives them. */
export function signerLines(summary: DigitalIdSummary): string[] {
	return [summary.name, summary.organisation, summary.email]
		.map((line) => (line === undefined ? undefined : cleanName(line)))
		.filter((line): line is string => !!line?.trim());
}

/** Who issued it, or that its owner made it. */
export function issuerLine(summary: DigitalIdSummary): string {
	if (summary.selfSigned) return t("Made by its owner (self-signed)");
	return [summary.issuer, summary.issuerOrganisation]
		.map((part) => (part === undefined ? undefined : cleanName(part)))
		.filter((part): part is string => !!part?.trim())
		.filter((part, i, all) => all.indexOf(part) === i)
		.join(", ");
}

export function validLine(summary: DigitalIdSummary): string {
	return t("Valid from {from} to {until}", {
		from: certificateDate(summary.validFrom),
		until: certificateDate(summary.validUntil),
	});
}

/** What a reader of the signed copy will think of it, said before
 * signing: none of these stops the signing. */
export function certificateWarnings(
	summary: DigitalIdSummary,
	now: Date,
): string[] {
	const out: string[] = [];
	if (summary.unprotected)
		out.push(
			t(
				"This file has no integrity check, so it can't be told whether it was changed.",
			),
		);
	const when = validity(summary, now);
	if (when === "expired")
		out.push(
			t(
				"This certificate expired on {date}. Readers will show the signature as not valid.",
				{ date: certificateDate(summary.validUntil) },
			),
		);
	else if (when === "not-yet")
		out.push(
			t(
				"This certificate isn't valid until {date}. Readers will show the signature as not valid.",
				{ date: certificateDate(summary.validFrom) },
			),
		);
	if (summary.notForSigning)
		out.push(
			t(
				"This certificate isn't meant for signing documents. Readers may not accept the signature.",
			),
		);
	return out;
}

const PROBLEMS: Record<DigitalIdProblem, string> = {
	password: msg("That password didn't work. Try again."),
	"not-digital-id": msg("This file isn't a digital ID."),
	unsupported: msg(
		"This digital ID is protected in a way Paperwren can't open. Export it again with AES-256 or TripleDES.",
	),
	"no-key": msg(
		"This file has a certificate but no private key, so it can't sign. Export it again with the private key included.",
	),
	"key-type": msg(
		"Paperwren signs with RSA and ECDSA keys (P-256, P-384, P-521). This digital ID uses another kind.",
	),
	mismatch: msg(
		"The key and the certificate in this file don't belong together.",
	),
};

/** Why a digital ID could not be opened. Anything not named (a file
 * that broke the reader) is not a digital ID, as far as the reader can
 * tell. */
export function problemMessage(reason: string | undefined): string {
	const text =
		reason && Object.hasOwn(PROBLEMS, reason)
			? PROBLEMS[reason as DigitalIdProblem]
			: PROBLEMS["not-digital-id"];
	return t(text);
}

const BLOCKERS: Record<SignBlocker, string> = {
	constrained: msg(
		"This signature field has signing rules or locks that Paperwren can't safely follow.",
	),
	encrypted: msg(
		"This PDF is locked with a password. Remove the password first (Remove a password), then sign that copy.",
	),
	certified: msg(
		"This PDF was certified by its author with no changes allowed, so it can't be signed again.",
	),
	damaged: msg(
		"This PDF's structure is damaged or ambiguous, so it can't be signed safely.",
	),
};

/** Why this PDF cannot be signed with a digital ID. */
export function blockerMessage(blocker: SignBlocker): string {
	return t(BLOCKERS[blocker] ?? BLOCKERS.damaged);
}

/** The words under a visible digital signature: who signed, and the
 * day by this device's clock. */
export function signatureCaption(name: string, now: Date): string[] {
	return [
		t("Digitally signed by {name}", { name: cleanName(name) }),
		formatDate(now, { dateStyle: "medium", timeStyle: "short" }),
	];
}
