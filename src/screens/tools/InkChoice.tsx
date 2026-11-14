import { t } from "@/lib/i18n";
import { Check } from "lucide-react";
import s from "./Tools.module.css";

/**
 * For a signature or a stamp from a picture: keep the ink's own colours,
 * or make every mark one ink, picked from `inks`.
 */
export function InkChoice({
	oneInk,
	onOneInk,
	inks,
	ink,
	onInk,
	testId,
}: {
	oneInk: boolean;
	onOneInk: (oneInk: boolean) => void;
	/** Each ink's colour and its name. */
	inks: Array<[colour: string, label: string]>;
	ink: string;
	onInk: (ink: string) => void;
	/** The test ids' start: "stamp" or "signature". */
	testId: string;
}) {
	return (
		<div className={s.inkChoice}>
			<fieldset className={s.shapes}>
				<legend className="visually-hidden">{t("Colour")}</legend>
				{(
					[
						[false, t("Keep colours"), "keep"],
						[true, t("One ink"), "one"],
					] as const
				).map(([value, label, id]) => (
					<button
						key={id}
						type="button"
						aria-pressed={oneInk === value}
						className={s.shape}
						onClick={() => onOneInk(value)}
						data-testid={`${testId}-colours-${id}`}
					>
						{label}
					</button>
				))}
			</fieldset>
			{oneInk && (
				<div className={s.inkChoices}>
					{inks.map(([colour, label]) => (
						<button
							key={colour}
							type="button"
							className={s.inkDot}
							aria-pressed={ink === colour}
							aria-label={label}
							title={label}
							onClick={() => onInk(colour)}
						>
							<span style={{ background: colour }} aria-hidden="true">
								{ink === colour && <Check size={14} strokeWidth={2.5} />}
							</span>
						</button>
					))}
				</div>
			)}
		</div>
	);
}
