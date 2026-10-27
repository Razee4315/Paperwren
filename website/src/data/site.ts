export const SITE = {
	name: "Paperwren",
	tagline: "Open anything. Instantly.",
	description:
		"Paperwren is a free document viewer for Android, Windows and macOS. Open PDF, Word, Excel, PowerPoint and EPUB files, fill in and sign PDFs, and merge or split them, with no account, no ads and no permissions, all offline.",
	repo: "https://github.com/Razee4315/Paperwren",
	releases: "https://github.com/Razee4315/Paperwren/releases/latest",
	issues: "https://github.com/Razee4315/Paperwren/issues",
	email: "saqlainrazee@gmail.com",
	security: "https://github.com/Razee4315/Paperwren/security/advisories/new",
	/** From the v1.1.4 release assets. */
	androidSize: "30.8 MB",
	windowsSize: "6.7 MB",
	version: "1.2.0",
};

/** Internal link that respects the deploy base path. */
export function url(path: string): string {
	const base = import.meta.env.BASE_URL.replace(/\/$/, "");
	return `${base}${path}`;
}

export const FORMATS = [
	{ ext: "PDF", note: "Fast pages, find, contents, passwords" },
	{ ext: "DOCX", note: "The document's own page layout" },
	{ ext: "XLSX", note: "Frozen headers, merged cells, sheet tabs" },
	{ ext: "PPTX", note: "Real slides, theme colours, speaker notes" },
	{ ext: "XLS · ODS · CSV", note: "Spreadsheets old and open" },
	{ ext: "DOC · ODT · RTF", note: "A clean reading view of the text" },
	{ ext: "PPT · ODP", note: "Slide text, in order" },
	{ ext: "MD · TXT · JSON", note: "Rendered Markdown, plain text, logs" },
	{ ext: "EPUB · CBZ", note: "Books and comics" },
	{ ext: "JPG · PNG · HEIC · TIFF", note: "Photos and scans" },
];
