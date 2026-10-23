/**
 * A browsed folder's documents as the folders they sit in. The platform
 * lists every document once, with the sub-folder it was found in
 * ("Taxes/2026"); the tree is made from those paths, so a folder that
 * holds no documents, however deep, is never shown.
 */

export interface FolderNode<F> {
	/** Its own name ("2026"); the browsed folder's is "". */
	name: string;
	/** Where it is inside the browsed folder ("Taxes/2026"). */
	path: string;
	/** Its sub-folders, by name in the order a person counts. */
	folders: FolderNode<F>[];
	/** The documents right inside it. */
	files: F[];
	/** Every document inside it, its sub-folders' too. */
	total: number;
}

const byName = new Intl.Collator(undefined, {
	numeric: true,
	sensitivity: "base",
});

/** The tree of `files`, each found at `folderOf(file)` ("" at the top,
 * "a/b" two folders down). */
export function folderTree<F>(
	files: readonly F[],
	folderOf: (file: F) => string,
): FolderNode<F> {
	const root: FolderNode<F> = {
		name: "",
		path: "",
		folders: [],
		files: [],
		total: 0,
	};
	const index = new Map<string, FolderNode<F>>([["", root]]);
	const nodeAt = (path: string): FolderNode<F> => {
		const known = index.get(path);
		if (known) return known;
		const cut = path.lastIndexOf("/");
		const parent = nodeAt(cut < 0 ? "" : path.slice(0, cut));
		const node: FolderNode<F> = {
			name: path.slice(cut + 1),
			path,
			folders: [],
			files: [],
			total: 0,
		};
		parent.folders.push(node);
		index.set(path, node);
		return node;
	};
	for (const file of files) {
		const path = folderOf(file).split(/[\\/]/).filter(Boolean).join("/");
		const node = nodeAt(path);
		node.files.push(file);
		// Counted in every folder on the way down.
		for (let at: string | null = path; at !== null; ) {
			const holder = index.get(at);
			if (holder) holder.total++;
			const cut = at.lastIndexOf("/");
			at = at === "" ? null : cut < 0 ? "" : at.slice(0, cut);
		}
	}
	for (const node of index.values())
		node.folders.sort((a, b) => byName.compare(a.name, b.name));
	return root;
}

/** The folder at `path` in a tree, or null once it is gone (the folder
 * was looked through again and it holds no documents any more). */
export function folderAt<F>(
	root: FolderNode<F>,
	path: string,
): FolderNode<F> | null {
	let node: FolderNode<F> | undefined = root;
	for (const name of path.split("/").filter(Boolean)) {
		node = node.folders.find((f) => f.name === name);
		if (!node) return null;
	}
	return node;
}
