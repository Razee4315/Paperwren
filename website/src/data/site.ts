export const SITE = {
	name: "Paperwren",
	tagline: "Open anything. Instantly.",
	description:
		"Paperwren is a free document viewer for Android and Windows. Open PDF, Word, Excel and PowerPoint files with no account, no ads, no internet access and no permissions.",
	repo: "https://github.com/Razee4315/Paperwren",
	releases: "https://github.com/Razee4315/Paperwren/releases/latest",
	issues: "https://github.com/Razee4315/Paperwren/issues",
	security: "https://github.com/Razee4315/Paperwren/security/advisories/new",
	/** From the v0.10.3 release assets. */
	androidSize: "7.3 MB",
	windowsSize: "2.2 MB",
	version: "0.10.3",
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
];
