/**
 * A short PDF to try things on, made on the spot: someone who has just
 * installed the app may have no file to hand, and the app can't ask for
 * their files.
 */

const PAGES = [
	{
		title: "Welcome to Paperwren",
		lines: [
			"This is a sample document. Try things out on it; nothing here can break.",
			"",
			"Select these words, then tap a colour to highlight them.",
			"",
			"Your highlights stay with this document on this device. Open it again",
			"and they are still here. The PDF itself is never changed.",
			"",
			"Tap a highlight to change its colour, add a note or remove it.",
		],
	},
	{
		title: "More to try",
		lines: [
			"Use the pen button at the top to write or draw on a page.",
			"",
			"Press Find to search for a word. Try the word paper.",
			"",
			"Open the menu for more: read this page aloud, change the page colour,",
			"read the text in a scan, or save a copy with your marks in it.",
			"",
			"Everything happens on this device. Nothing is sent anywhere.",
		],
	},
];

/** The sample as a PDF. */
export async function samplePdf(): Promise<Uint8Array> {
	const { PDFDocument, StandardFonts, rgb } = await import("@cantoo/pdf-lib");
	const doc = await PDFDocument.create();
	doc.setTitle("Welcome to Paperwren");
	const body = await doc.embedFont(StandardFonts.Helvetica);
	const bold = await doc.embedFont(StandardFonts.HelveticaBold);
	for (const { title, lines } of PAGES) {
		const page = doc.addPage([595.28, 841.89]);
		page.drawText(title, {
			x: 64,
			y: 740,
			size: 28,
			font: bold,
			color: rgb(0.11, 0.26, 0.24),
		});
		lines.forEach((line, i) => {
			page.drawText(line, { x: 64, y: 690 - i * 24, size: 14, font: body });
		});
	}
	return doc.save();
}
