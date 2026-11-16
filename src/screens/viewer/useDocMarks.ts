import {
	type DocMark,
	type Scales,
	loadMarks,
	saveMarks,
	watchMarks,
} from "@/lib/docMarks";
import { storeFailed } from "@/lib/storedValue";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** A step that can be undone: the marks as they were. */
const MAX_STEPS = 100;
const SAVE_AFTER = 250;

/** One document's marks, while it is open. */
export interface MarkStore {
	/** False until what was kept has been read. */
	ready: boolean;
	/** They are kept on the device (not for a password-protected file). */
	persist: boolean;
	list: DocMark[];
	note: string;
	scales: Scales;
	/** Change the marks, as one step of undo. */
	set: (next: DocMark[]) => void;
	add: (marks: DocMark[]) => void;
	/** Change one mark in place. */
	edit: (id: string, patch: Partial<DocMark>) => void;
	remove: (id: string) => void;
	setNote: (note: string) => void;
	setScales: (scales: Scales) => void;
	undo: () => void;
	redo: () => void;
	canUndo: boolean;
	canRedo: boolean;
}

/**
 * The marks of the document with this content key: read when it opens,
 * and written shortly after every change, and at once when the app goes
 * to the background (a phone may never bring it back).
 */
export function useDocMarks(
	key: string | null,
	name: string,
	persist: boolean,
): MarkStore {
	const [list, setList] = useState<DocMark[]>([]);
	const [note, setNoteState] = useState("");
	const [scales, setScalesState] = useState<Scales>({});
	const [ready, setReady] = useState(false);
	const [steps, setSteps] = useState({ back: 0, forward: 0 });
	const past = useRef<DocMark[][]>([]);
	const future = useRef<DocMark[][]>([]);
	const current = useRef({ key, name, list, note, scales, persist });
	const unsaved = useRef(false);
	const timer = useRef(0);
	/** What was kept has been read for the document now open: nothing is
	 * written before, or it would go over what is stored. */
	const loaded = useRef<string | null>(null);

	/** Write `doc` down. One that cannot be is said, and stays unsaved
	 * (here, while it is the one open) to be written with the next change
	 * or Try again. */
	const write = useCallback((doc: typeof current.current) => {
		if (!doc.key || !doc.persist) return;
		saveMarks(
			{
				key: doc.key,
				name: doc.name,
				note: doc.note,
				marks: doc.list,
				scales: doc.scales,
				updatedAt: Date.now(),
			},
			current,
		).catch(() => {
			const retry = () => {
				if (current.current.key === doc.key) {
					unsaved.current = true;
					flushRef.current();
				} else write(doc);
			};
			if (current.current.key === doc.key) unsaved.current = true;
			storeFailed(retry);
		});
	}, []);

	const flush = useCallback(() => {
		window.clearTimeout(timer.current);
		if (!unsaved.current) return;
		const doc = current.current;
		if (loaded.current !== doc.key) return;
		unsaved.current = false;
		write(doc);
	}, [write]);
	const flushRef = useRef(flush);
	flushRef.current = flush;

	// Another document: what is waiting to be written belongs to the last
	// one, and goes under its key (once drawn, below) before this one's
	// takes over.
	const outgoing = useRef<typeof current.current | null>(null);
	if (current.current.key !== key) {
		if (unsaved.current && loaded.current === current.current.key)
			outgoing.current = current.current;
		unsaved.current = false;
	}
	current.current = { key, name, list, note, scales, persist };
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs when the document changes
	useEffect(() => {
		const doc = outgoing.current;
		outgoing.current = null;
		if (doc) write(doc);
	}, [key, write]);

	const changed = useCallback(() => {
		unsaved.current = true;
		window.clearTimeout(timer.current);
		timer.current = window.setTimeout(flush, SAVE_AFTER);
	}, [flush]);

	useEffect(() => {
		setReady(false);
		setList([]);
		setNoteState("");
		setScalesState({});
		past.current = [];
		future.current = [];
		setSteps({ back: 0, forward: 0 });
		loaded.current = null;
		if (!key) return;
		if (!persist) {
			loaded.current = key;
			setReady(true);
			return;
		}
		let alive = true;
		loadMarks(key).then((doc) => {
			if (!alive) return;
			// Marks made before what was kept came (a stroke as the editor
			// opened) are added to it, and written with it.
			const early = unsaved.current ? current.current : null;
			const kept = doc?.marks ?? [];
			const marks = early
				? [
						...kept,
						...early.list.filter((m) => !kept.some((k) => k.id === m.id)),
					]
				: kept;
			const text = early?.note || (doc?.note ?? "");
			const sizes = { ...doc?.scales, ...early?.scales };
			current.current = {
				...current.current,
				list: marks,
				note: text,
				scales: sizes,
			};
			setList(marks);
			setNoteState(text);
			setScalesState(sizes);
			loaded.current = key;
			setReady(true);
			if (early) changed();
		});
		return () => {
			alive = false;
		};
	}, [key, persist, changed]);

	// Changed elsewhere (Mark up from the tools, another tab or window,
	// Settings): what is shown here follows, or the next save here would
	// put the old marks back. Work not yet written here comes first.
	useEffect(() => {
		if (!key || !persist) return;
		let alive = true;
		const follow = () => {
			if (unsaved.current) return;
			loadMarks(key).then((doc) => {
				if (!alive || unsaved.current) return;
				const marks = doc?.marks ?? [];
				const same =
					JSON.stringify(marks) === JSON.stringify(current.current.list);
				if (!same) {
					past.current = [];
					future.current = [];
					setSteps({ back: 0, forward: 0 });
					current.current.list = marks;
					setList(marks);
				}
				const text = doc?.note ?? "";
				current.current.note = text;
				setNoteState(text);
				const sizes = doc?.scales ?? {};
				current.current.scales = sizes;
				setScalesState(sizes);
			});
		};
		const stop = watchMarks(key, (from) => {
			if (from !== current) follow();
		});
		// A desktop's other windows write to the same store.
		window.addEventListener("focus", follow);
		return () => {
			alive = false;
			stop();
			window.removeEventListener("focus", follow);
		};
	}, [key, persist]);

	// Written before the document goes, and whenever the app is put away.
	useEffect(() => {
		const hide = () => {
			if (document.visibilityState === "hidden") flush();
		};
		document.addEventListener("visibilitychange", hide);
		window.addEventListener("pagehide", flush);
		return () => {
			document.removeEventListener("visibilitychange", hide);
			window.removeEventListener("pagehide", flush);
			flush();
		};
	}, [flush]);

	const step = useCallback(() => {
		setSteps({ back: past.current.length, forward: future.current.length });
		changed();
	}, [changed]);

	const set = useCallback(
		(next: DocMark[]) => {
			past.current = [...past.current, current.current.list].slice(-MAX_STEPS);
			future.current = [];
			current.current.list = next;
			setList(next);
			step();
		},
		[step],
	);

	const undo = useCallback(() => {
		const last = past.current[past.current.length - 1];
		if (!last) return;
		past.current = past.current.slice(0, -1);
		future.current = [current.current.list, ...future.current];
		current.current.list = last;
		setList(last);
		step();
	}, [step]);

	const redo = useCallback(() => {
		const [next, ...rest] = future.current;
		if (!next) return;
		future.current = rest;
		past.current = [...past.current, current.current.list];
		current.current.list = next;
		setList(next);
		step();
	}, [step]);

	const add = useCallback(
		(marks: DocMark[]) => set([...current.current.list, ...marks]),
		[set],
	);
	const edit = useCallback(
		(id: string, patch: Partial<DocMark>) =>
			set(
				current.current.list.map((mark) =>
					mark.id === id ? ({ ...mark, ...patch } as DocMark) : mark,
				),
			),
		[set],
	);
	const remove = useCallback(
		(id: string) => set(current.current.list.filter((mark) => mark.id !== id)),
		[set],
	);
	const setNote = useCallback(
		(text: string) => {
			// Also from a field going away, when state no longer updates.
			current.current.note = text;
			setNoteState(text);
			changed();
		},
		[changed],
	);
	const setScales = useCallback(
		(next: Scales) => {
			current.current.scales = next;
			setScalesState(next);
			changed();
		},
		[changed],
	);

	return useMemo(
		() => ({
			ready,
			persist,
			list,
			note,
			scales,
			set,
			add,
			edit,
			remove,
			setNote,
			setScales,
			undo,
			redo,
			canUndo: steps.back > 0,
			canRedo: steps.forward > 0,
		}),
		[
			ready,
			persist,
			list,
			note,
			scales,
			set,
			add,
			edit,
			remove,
			setNote,
			setScales,
			undo,
			redo,
			steps,
		],
	);
}
