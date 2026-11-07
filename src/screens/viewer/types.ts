import type { FileFormat } from "@/lib/formats";
import type { Position } from "@/lib/types";

export interface ViewerProps {
	data: ArrayBuffer;
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
}
