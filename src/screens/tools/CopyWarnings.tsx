import { msg, t } from "@/lib/i18n";
import type { Protection } from "@/lib/pdfTools";
import { copyNote } from "@/lib/protection";
import s from "./CopyWarnings.module.css";

const SIGNED_WARNING = msg(
	"This PDF has a digital signature. A changed copy won't keep it valid.",
);

/** What a copy of this file will not keep, said where a copy is about
 * to be saved: a digital signature, a password or limits. Nothing for a
 * file with none of them. */
export function CopyWarnings({
	signed = false,
	protection = null,
}: {
	signed?: boolean;
	protection?: Protection | null;
}) {
	const note = copyNote(protection);
	return (
		<>
			{signed && <p className={s.hint}>{t(SIGNED_WARNING)}</p>}
			{note && (
				<p className={s.hint} data-testid="copy-note">
					{note}
				</p>
			)}
		</>
	);
}
