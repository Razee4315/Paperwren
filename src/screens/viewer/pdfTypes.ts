/** Shared pdf.js type aliases to keep viewer modules light. */
export type PdfDocument = import("pdfjs-dist").PDFDocumentProxy;
export type OutlineNode = {
	title: string;
	dest: unknown;
	items: OutlineNode[];
};
/** Render tasks are kept so stale renders can be cancelled
 * (audit 10.2). */
export type RenderTaskLike = { cancel: () => void };
