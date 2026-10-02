/**
 * Bullet characters are often given in a symbol font (Wingdings,
 * Symbol): the character code only means something in that font,
 * which no phone has. This maps the common ones to real Unicode
 * shapes so a tick stays a tick instead of becoming "ü".
 */

const WINGDINGS: Record<string, string> = {
	l: "●",
	n: "■",
	o: "□",
	p: "□",
	q: "❑",
	r: "❒",
	s: "⬧",
	t: "⧫",
	u: "◆",
	v: "❖",
	w: "⬥",
	x: "⌧",
	"¨": "◻",
	à: "➔",
	è: "➔",
	ð: "⇨",
	Ø: "➢",
	Ù: "➢",
	ü: "✓",
	û: "✗",
	þ: "☑",
	ý: "☒",
	J: "☺",
	"¤": "◉",
	"¡": "○",
	"·": "•",
	"\u009f": "•",
};

const SYMBOL: Record<string, string> = {
	"·": "•",
	"¨": "♦",
	"®": "→",
	Þ: "⇒",
	"-": "−",
};

/** The bullet to draw for `char` set in `font`. */
export function bulletGlyph(char: string, font?: string | null): string {
	const name = (font ?? "").toLowerCase();
	// Symbol fonts are addressed through the private-use block F0xx.
	const code = char.charCodeAt(0);
	const plain =
		(code & 0xff00) === 0xf000 ? String.fromCharCode(code & 0xff) : char;
	if (name.includes("wingdings") || name.includes("webdings"))
		return WINGDINGS[plain] ?? "•";
	if (name === "symbol") return SYMBOL[plain] ?? "•";
	// A private-use character without a known font cannot be shown.
	return plain !== char ? "•" : char;
}
