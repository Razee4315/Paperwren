import type React from "react";
import styled from "styled-components";

/**
 * The format glyph family (docs/03-iconography.md section 2).
 * A folded-sheet silhouette holding one minimal motif. No letters:
 * color plus motif carries recognition. Strokes use currentColor so
 * the badge decides ink (light theme) or format tint (dark theme).
 */

export type FileFormat = "pdf" | "docx" | "xlsx" | "pptx" | "csv" | "txt" | "unknown";

const SHEET_PATH =
	"M6.5 2.5 H16.8 L20.5 6.2 V18.5 C20.5 20.2 19.2 21.5 17.5 21.5 H6.5 C4.8 21.5 3.5 20.2 3.5 18.5 V5.5 C3.5 3.8 4.8 2.5 6.5 2.5 Z";

const FOLD_PATH = "M16.8 2.5 V4.2 C16.8 5.3 17.7 6.2 18.8 6.2 H20.5";

function PdfMotif() {
	return (
		<g>
			<circle cx="15" cy="10" r="1.1" fill="currentColor" stroke="none" />
			<path d="M7.5 16.5 L11 12 L13.2 14.5" />
			<path d="M7.5 19 H16.5" />
		</g>
	);
}

function DocxMotif() {
	return (
		<g>
			<path d="M7.5 9.5 H16.5" />
			<path d="M7.5 12.5 H14" />
			<path d="M7.5 15.5 H10.5" />
		</g>
	);
}

function XlsxMotif() {
	return (
		<g>
			<rect x="7.5" y="9.5" width="3.8" height="3.8" rx="0.6" fill="currentColor" stroke="none" />
			<rect x="12.7" y="9.5" width="3.8" height="3.8" rx="0.6" />
			<rect x="7.5" y="14.7" width="3.8" height="3.8" rx="0.6" />
			<rect x="12.7" y="14.7" width="3.8" height="3.8" rx="0.6" />
		</g>
	);
}

function PptxMotif() {
	return (
		<g>
			<path d="M10 9 L15.5 12.25 L10 15.5 Z" fill="currentColor" stroke="none" />
			<path d="M7.5 18.5 H16.5" />
		</g>
	);
}

function CsvMotif() {
	return (
		<g>
			<rect x="7.5" y="9.5" width="3.8" height="3.8" rx="0.6" fill="currentColor" stroke="none" />
			<rect x="12.7" y="9.5" width="3.8" height="3.8" rx="0.6" />
			<rect x="7.5" y="14.7" width="3.8" height="3.8" rx="0.6" />
			<path d="M14.6 14.9 C14.2 15.8 13.6 16.4 12.9 16.6" />
		</g>
	);
}

function TxtMotif() {
	return <g />;
}

function UnknownMotif() {
	return (
		<g>
			<path d="M11 11 C11 9.8 12 9 13 9 C14.1 9 15 9.8 15 10.8 C15 11.8 14.4 12.2 13.6 12.7 C13.2 12.95 13 13.2 13 13.6" />
			<circle cx="13" cy="15.6" r="0.9" fill="currentColor" stroke="none" />
		</g>
	);
}

const MOTIFS: Record<FileFormat, () => React.ReactElement> = {
	pdf: PdfMotif,
	docx: DocxMotif,
	xlsx: XlsxMotif,
	pptx: PptxMotif,
	csv: CsvMotif,
	txt: TxtMotif,
	unknown: UnknownMotif,
};

const GlyphSvg = styled.svg`
	display: block;
`;

export function FormatGlyph({
	format,
	size = 24,
}: {
	format: FileFormat;
	size?: number;
}) {
	const Motif = MOTIFS[format] ?? UnknownMotif;
	return (
		<GlyphSvg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.75}
			strokeLinecap="round"
			strokeLinejoin="round"
			role="img"
			aria-label={`${format.toUpperCase()} file`}
		>
			<path d={SHEET_PATH} />
			<path d={FOLD_PATH} />
			<Motif />
		</GlyphSvg>
	);
}

/** Badge background per format, from the design token names. */
export function formatCssVar(format: FileFormat): { base: string; container: string } {
	switch (format) {
		case "pdf":
			return { base: "var(--fmt-pdf)", container: "var(--fmt-pdf-container)" };
		case "docx":
			return { base: "var(--fmt-docx)", container: "var(--fmt-docx-container)" };
		case "xlsx":
		case "csv":
			return { base: "var(--fmt-xlsx)", container: "var(--fmt-xlsx-container)" };
		case "pptx":
			return { base: "var(--fmt-pptx)", container: "var(--fmt-pptx-container)" };
		default:
			return { base: "var(--ink-3)", container: "var(--surface-2)" };
	}
}

const Badge = styled.div<{ $format: FileFormat; $size: number }>`
	width: ${({ $size }) => $size}px;
	height: ${({ $size }) => $size}px;
	border-radius: 8px;
	background: ${({ $format }) => formatCssVar($format).container};
	color: ${({ $format }) => formatCssVar($format).base};
	display: flex;
	align-items: center;
	justify-content: center;
	flex-shrink: 0;
	position: relative;
`;

export function FormatBadge({
	format,
	size = 40,
}: {
	format: FileFormat;
	size?: number;
}) {
	return (
		<Badge $format={format} $size={size}>
			<FormatGlyph format={format} size={Math.round(size * 0.66)} />
		</Badge>
	);
}

/** Map a file name to a format. Extension-first, then refined by
 * magic-byte sniffing on the Rust side where available. */
export function formatFromName(name: string): FileFormat {
	const ext = name.split(".").pop()?.toLowerCase() ?? "";
	switch (ext) {
		case "pdf":
			return "pdf";
		case "docx":
			return "docx";
		case "xlsx":
		case "xlsm":
		case "xlsb":
			return "xlsx";
		case "pptx":
			return "pptx";
		case "csv":
			return "csv";
		case "txt":
		case "md":
			return "txt";
		default:
			return "unknown";
	}
}
