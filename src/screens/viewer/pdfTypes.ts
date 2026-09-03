/** Shared pdf.js type aliases to keep viewer modules light. */
export type PdfDocument = import("pdfjs-dist").PDFDocumentProxy;
export type OutlineNode = {
	title: string;
	dest: unknown;
	items: OutlineNode[];
};
