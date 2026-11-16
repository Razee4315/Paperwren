import { backend } from "./backend";

/**
 * A value the app keeps in its store under one key (the settings, the
 * bookmarks, the saved folders, kept signatures), with the same rules
 * for every one:
 *
 * - Nothing is written before the stored value has been read: a change
 *   made sooner waits, and is then made to what was read, so an early
 *   change never writes defaults over what is stored.
 * - Changes are written one at a time, and a burst of them (a slider
 *   dragged through ten steps) as one write after the last.
 * - A write that fails is said (onStoreFailed: the app shows "Couldn't
 *   change saved data" with Try again), and its changes are kept to be
 *   written with the next one, not dropped.
 * - What waits is written at once when the app is put away or the page
 *   goes.
 *
 * The value shown changes at once; the store follows.
 */

/** A change: a new value from the one before. It may be run more than
 * once (on what is shown, then on what is stored), so it must not do
 * anything else. */
export type Change<T> = (value: T) => T;

/** A value outside React and who is told when it changes (the shape of
 * state/store's Store, for useSelect and useSyncExternalStore). */
export interface Readable<T> {
	get(): T;
	set(next: T): void;
	subscribe(listener: () => void): () => void;
}

export interface StoredValue<T> {
	/** The value as shown: what was read, with every change since. */
	value: Readable<T>;
	/** Whether the first read has come back. */
	ready: Readable<boolean>;
	/** Read it, once; later calls wait for that read. */
	load(): Promise<void>;
	/** Change it; written shortly, with any other changes. */
	edit(change: Change<T>): void;
	/** Change it and write it now: rejects, with the change taken back,
	 * when it could not be kept (for a caller that says so itself). */
	commit(change: Change<T>): Promise<void>;
	/** Write what waits now; true once it is kept. */
	flush(): Promise<boolean>;
	/** Take up what another window wrote, unless a change made here is
	 * still on its way (its write is made onto the store as it is). */
	refresh(): void;
}

interface Options<T> {
	key: string;
	initial: T;
	/** The value from what the store holds (the store may hold anything). */
	normalize: (stored: unknown) => T;
	/** The first read, when it is more than the key (an older key moved
	 * over). By default the key, normalized. */
	read?: () => Promise<T>;
	/** What is written for a value (default: the value). */
	stored?: (value: T) => unknown;
	/** Each write makes its changes to the value as it is in the store
	 * then, not as this window last read it: a desktop's windows share
	 * one store. */
	shared?: boolean;
	/** Changes this close together (ms) are written once, after the last. */
	delay?: number;
}

function readable<T>(initial: T): Readable<T> {
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

const failureListeners = new Set<(retry: () => void) => void>();
/** Hear of a write that failed; `retry` writes it again. */
export function onStoreFailed(listener: (retry: () => void) => void) {
	failureListeners.add(listener);
	return () => {
		failureListeners.delete(listener);
	};
}
/** Say that a write failed (for stores kept their own way: recents,
 * document marks); `retry` writes it again. */
export function storeFailed(retry: () => void) {
	for (const listener of [...failureListeners]) listener(retry);
}

interface Flushable {
	flush(): Promise<boolean>;
	waiting(): boolean;
}
const all = new Set<Flushable>();
if (typeof window !== "undefined") {
	// Put away (a phone's home screen, another app) or going: what waits
	// is written now. Back again, what could not be written is tried
	// again, and said if it still cannot.
	const writeAll = () => {
		for (const one of all) void one.flush();
	};
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "hidden") writeAll();
		else
			for (const one of all)
				if (one.waiting())
					void one.flush().then((ok) => {
						if (!ok) storeFailed(() => void one.flush());
					});
	});
	window.addEventListener("pagehide", writeAll);
}

const same = (a: unknown, b: unknown) =>
	a === b || JSON.stringify(a) === JSON.stringify(b);

export function createStoredValue<T>(options: Options<T>): StoredValue<T> {
	const { key, normalize, delay = 0 } = options;
	const value = readable(options.initial);
	const ready = readable(false);
	/** The value as last read or written. */
	let kept = options.initial;
	/** Changes not yet written, and those being written. */
	let waiting: Change<T>[] = [];
	let writing: Change<T>[] = [];
	let loading: Promise<void> | null = null;
	let timer = 0;
	/** Reads and writes, one after another. */
	let chain: Promise<unknown> = Promise.resolve();
	/** Changes made so far: a read begun before one is out of date. */
	let made = 0;

	const apply = (base: T, changes: Change<T>[]) =>
		changes.reduce((next, change) => change(next), base);
	/** Show what is kept with what is on its way, keeping the value shown
	 * as it is when that comes to the same. */
	const show = () => {
		const next = apply(kept, [...writing, ...waiting]);
		if (!same(next, value.get())) value.set(next);
	};

	const flush = (): Promise<boolean> => {
		window.clearTimeout(timer);
		if (!ready.get()) return Promise.resolve(!waiting.length);
		const run = chain.then(async () => {
			if (!waiting.length) return true;
			writing = waiting;
			waiting = [];
			try {
				let base = kept;
				if (options.shared) {
					const there = await backend.storeGet(key);
					if (there != null) base = normalize(there);
				}
				const next = apply(base, writing);
				await backend.storeSet(
					key,
					options.stored ? options.stored(next) : next,
				);
				kept = next;
				writing = [];
				show();
				return true;
			} catch {
				// Not kept: the changes wait for the next write.
				waiting = [...writing, ...waiting];
				writing = [];
				return false;
			}
		});
		chain = run;
		return run;
	};

	const later = () => {
		window.clearTimeout(timer);
		timer = window.setTimeout(() => {
			void flush().then((ok) => {
				if (!ok) storeFailed(() => void flush());
			});
		}, delay);
	};

	const load = () => {
		loading ??= (
			options.read
				? options.read()
				: backend.storeGet(key).then(normalize, () => options.initial)
		)
			.catch(() => options.initial)
			.then((read) => {
				kept = read;
				show();
				ready.set(true);
				if (waiting.length) later();
			});
		return loading;
	};

	const edit = (change: Change<T>) => {
		made++;
		waiting.push(change);
		value.set(change(value.get()));
		if (ready.get()) later();
	};

	const commit = async (change: Change<T>) => {
		await load();
		edit(change);
		if (await flush()) return;
		waiting = waiting.filter((one) => one !== change);
		show();
		// Other changes that were in the same write are tried again.
		if (waiting.length) later();
		throw new Error(`${key} not kept`);
	};

	const refresh = () => {
		if (!ready.get()) return;
		const before = made;
		chain = chain
			.then(async () => {
				if (waiting.length || made !== before) return;
				const there = await backend.storeGet(key);
				// Nothing there to take up, or a change made here since: its
				// write is made onto the store as it is.
				if (there == null || waiting.length || made !== before) return;
				kept = normalize(there);
				show();
			})
			.catch(() => {});
	};

	all.add({ flush, waiting: () => waiting.length > 0 });
	return { value, ready, load, edit, commit, flush, refresh };
}
