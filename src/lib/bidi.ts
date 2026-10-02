/**
 * Reading direction from the text itself, for files that do not say
 * (or say it wrongly): the first character with a strong direction
 * decides, as the Unicode bidirectional algorithm does.
 */

// Hebrew, Arabic, Syriac, Thaana, N'Ko and the Arabic presentation forms.
const RTL = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefc]/;
const STRONG =
	/[A-Za-z\u00c0-\u024f\u0370-\u058f\u0590-\u08ff\u0900-\u1fff\u3040-\ud7ff\ufb1d-\ufdff\ufe70-\ufefc]/;

/** True when the first strongly-directional character is right-to-left. */
export function startsRtl(text: string): boolean {
	const first = STRONG.exec(text);
	return first ? RTL.test(first[0]) : false;
}

/** True when the text contains any right-to-left script. */
export function hasRtl(text: string): boolean {
	return RTL.test(text);
}
