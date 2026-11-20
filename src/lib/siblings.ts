/**
 * The pictures of a folder browsed in the app, kept for this run: a
 * picture opened from one can step to the next, on a phone too (where
 * the system hands the app one file, not the folder around it).
 */

import { formatFromName } from "./formats";
import type { OpenRequest } from "./types";

/** Each picture's listing, by its id. */
const around = new Map<string, OpenRequest[]>();
/** The listings kept, least lately used first: a run that browses many
 * folders keeps the last `KEPT` of them, not every one. */
const listings = new Set<OpenRequest[]>();
const KEPT = 20;
const byName = new Intl.Collator(undefined, {
	numeric: true,
	sensitivity: "base",
});

/** Remember the pictures of a folder's listing, in name order. */
export function rememberPictures(list: OpenRequest[]) {
	const pictures = list
		.filter((r) => formatFromName(r.name) === "image")
		.sort((a, b) => byName.compare(a.name, b.name));
	if (!pictures.length) return;
	for (const picture of pictures) around.set(picture.id, pictures);
	listings.add(pictures);
	for (const old of listings) {
		if (listings.size <= KEPT) break;
		listings.delete(old);
		// A picture listed again since keeps its newer listing.
		for (const picture of old)
			if (around.get(picture.id) === old) around.delete(picture.id);
	}
}

/** The pictures beside this one, itself included; empty when it was
 * not opened from a folder browsed in the app. */
export function picturesAround(id: string): OpenRequest[] {
	const list = around.get(id);
	if (!list) return [];
	// Used again: the last to be let go.
	listings.delete(list);
	listings.add(list);
	return list;
}
