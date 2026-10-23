import { backend } from "@/lib/backend";
import { splitName } from "@/lib/fileName";
import { t } from "@/lib/i18n";
import { pictureExtension } from "@/lib/pagePicture";
import type { OpenRequest } from "@/lib/types";
import { announceSaved } from "@/screens/tools/saved";
import { toast } from "@/ui";

/** "Report - page 3.png": a page of `name` saved on its own. */
export function pageFileName(name: string, page: number, type: string) {
	const [stem] = splitName(name);
	return `${stem} - ${t("page {n}", { n: page })}${pictureExtension(type)}`;
}

/** Save a picture made from what the reader is looking at as a new
 * file, where they say, and offer to open it. The file on show is never
 * touched. Resolves false when it could not be saved; a cancel is not a
 * failure. */
export async function savePicture(
	make: () => Promise<{ bytes: Uint8Array; type: string; name: string }>,
	open?: (request: OpenRequest) => void,
): Promise<boolean> {
	try {
		const { bytes, type, name } = await make();
		const saved = await backend.saveFile(name, bytes, type);
		if (saved) announceSaved(saved, open, bytes.length);
		return true;
	} catch {
		toast(t("Couldn't save the picture"));
		return false;
	}
}
