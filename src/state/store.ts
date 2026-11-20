import { useRef, useSyncExternalStore } from "react";

/**
 * A value held outside React that components read a part of. A context
 * draws every reader again whenever any of it changes; a reader of a
 * store is drawn again only when the part it reads does.
 */
export interface Store<T> {
	get(): T;
	set(next: T): void;
	subscribe(listener: () => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
	let value = initial;
	const listeners = new Set<() => void>();
	return {
		get: () => value,
		set(next) {
			if (Object.is(next, value)) return;
			value = next;
			for (const listener of [...listeners]) listener();
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}

/** The part of `store` that `select` picks. It must give the same value
 * (===) while that part is unchanged: a field, a flag, a count. */
export function useSelect<T, S>(store: Store<T>, select: (value: T) => S): S {
	return useSyncExternalStore(store.subscribe, () => select(store.get()));
}

/** Some fields of an object in `store`, as one object that keeps its
 * identity while those fields do. */
export function usePick<T, K extends keyof T>(
	store: Store<T>,
	keys: readonly K[],
): Pick<T, K> {
	const cache = useRef<Pick<T, K> | null>(null);
	const read = () => {
		const value = store.get();
		const last = cache.current;
		if (last && keys.every((key) => Object.is(last[key], value[key])))
			return last;
		const next = {} as Pick<T, K>;
		for (const key of keys) next[key] = value[key];
		cache.current = next;
		return next;
	};
	return useSyncExternalStore(store.subscribe, read);
}
