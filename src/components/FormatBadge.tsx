import {
	File as FileIcon,
	FilePenLine as FilePenLineIcon,
	FileSpreadsheet as FileSpreadsheetIcon,
	FileText as FileTextIcon,
	Presentation as PresentationIcon,
} from "lucide-react";
import type React from "react";
import styled from "styled-components";

/**
 * The format glyph family (docs/03-iconography.md section 2), drawn
 * with the app's Lucide set so every badge matches the icon language
 * of the toolbars. One glyph family per format family — FileText for
 * PDF, FilePenLine for editable Word documents, FileSpreadsheet for
 * the sheet world, Presentation for slides, plain File for text —
 * with the format ink carrying the distinction inside its tinted
 * container.
 */

export type FileFormat =
	| "pdf"
	| "docx"
	| "xlsx"
	| "pptx"
	| "csv"
	| "txt"
	| "unknown";

const GLYPHS: Record<
	FileFormat,
	React.ComponentType<{ size?: number | string; strokeWidth?: number | string }>
> = {
	pdf: FileTextIcon,
	docx: FilePenLineIcon,
	xlsx: FileSpreadsheetIcon,
	csv: FileSpreadsheetIcon,
	pptx: PresentationIcon,
	txt: FileIcon,
	unknown: FileIcon,
};

export function FormatGlyph({
	format,
	size = 24,
}: {
	format: FileFormat;
	size?: number;
}) {
	const Glyph = GLYPHS[format] ?? FileIcon;
	return (
		<Glyph
			size={size}
			strokeWidth={1.75}
			aria-label={`${format.toUpperCase()} file`}
		/>
	);
}

/** Badge background per format, from the design token names. */
export function formatCssVar(format: FileFormat): {
	base: string;
	container: string;
} {
	switch (format) {
		case "pdf":
			return { base: "var(--fmt-pdf)", container: "var(--fmt-pdf-container)" };
		case "docx":
			return {
				base: "var(--fmt-docx)",
				container: "var(--fmt-docx-container)",
			};
		case "xlsx":
		case "csv":
			return {
				base: "var(--fmt-xlsx)",
				container: "var(--fmt-xlsx-container)",
			};
		case "pptx":
			return {
				base: "var(--fmt-pptx)",
				container: "var(--fmt-pptx-container)",
			};
		default:
			return { base: "var(--ink-3)", container: "var(--surface-2)" };
	}
}

const Badge = styled.div<{ $format: FileFormat; $size: number }>`
	width: ${({ $size }) => $size}px;
	height: ${({ $size }) => $size}px;
	border-radius: 12px;
	background: ${({ $format }) => formatCssVar($format).container};
	color: ${({ $format }) => formatCssVar($format).base};
	display: flex;
	align-items: center;
	justify-content: center;
	flex-shrink: 0;
	position: relative;

	/* Soft ring in the format ink (the container tint alone
	 disappears against light surfaces); a pseudo-element keeps the
	 ring at low opacity without color-mix support. */
	&::after {
		content: "";
		position: absolute;
		inset: 0;
		border-radius: inherit;
		border: 1px solid currentColor;
		opacity: 0.24;
		pointer-events: none;
	}
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
			<FormatGlyph format={format} size={Math.round(size * 0.58)} />
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
