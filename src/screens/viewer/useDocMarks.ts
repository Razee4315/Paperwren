import {
	type DocMark,
	type Scales,
	loadMarks,
	saveMarks,
} from "@/lib/docMarks";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** A step that can be undone: the marks as they were. */
const MAX_STEPS = 100;
const SAVE_AFTER = 400;

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
	current.current = { key, name, list, note, scales, persist };
	const unsaved = useRef(false);
	const timer = useRef(0);

	const flush = useCallback(() => {
		window.clearTimeout(timer.current);
		if (!unsaved.current) return;
		unsaved.current = false;
		const doc = current.current;
		if (!doc.key || !doc.persist) return;
		saveMarks({
			key: doc.key,
			name: doc.name,
			note: doc.note,
			marks: doc.list,
			scales: doc.scales,
			updatedAt: Date.now(),
		}).catch(() => {});
	}, []);

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
		if (!key) return;
		if (!persist) {
			setReady(true);
			return;
		}
		let alive = true;
		loadMarks(key).then((doc) => {
			if (!alive) return;
			if (doc) {
				setList(doc.marks);
				setNoteState(doc.note);
				setScalesState(doc.scales ?? {});
			}
			setReady(true);
		});
		return () => {
			alive = false;
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
			setNoteState(text);
			changed();
		},
		[changed],
	);
	const setScales = useCallback(
		(next: Scales) => {
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
