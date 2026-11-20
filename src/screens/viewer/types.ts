import type { FileFormat } from "@/lib/formats";
import type { PdfStreamSource } from "@/lib/pdfRange";
import type { Position } from "@/lib/types";

export interface ViewerProps {
	/** The file's bytes; empty when a PDF is streamed (`stream`). */
	data: ArrayBuffer;
	/** A large PDF, read a piece at a time instead of whole (PdfView
	 * only). */
	stream?: PdfStreamSource;
	name: string;
	format: FileFormat;
	position?: Position;
	onPosition: (position: Position) => void;
	onClose: () => void;
	/** False while another viewer is stacked above this one. */
	active: boolean;
	/** The file turned out not to open (a damaged PDF). Opened for the
	 * first time, it is then left out of Recent files. */
	onBroken?: () => void;
	/** True when the file was opened with a password. */
	passwordProtected?: boolean;
}
