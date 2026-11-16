/**
 * Per-key serialized async writes (audit 15.1): rapid open/position/
 * pin events must never complete out of order and let a stale array
 * win the persisted state. Each key has one chained queue.
 */

type Write = (key: string, value: unknown) => Promise<void>;

/** One queue per key; a write that fails is reported to its caller, and
 * the writes after it for that key still run. */
export function createCheckedWriter(write: Write): Write {
	const queues = new Map<string, Promise<void>>();
	return (key, value) => {
		const previous = queues.get(key) ?? Promise.resolve();
		const next = previous.then(() => write(key, value));
		// A failed write must not poison the chain for the key.
		queues.set(
			key,
			next.catch(() => {}),
		);
		return next;
	};
}

/** The same, with failures kept quiet. */
export function createSerializedWriter(write: Write): Write {
	const checked = createCheckedWriter(write);
	return (key, value) => checked(key, value).catch(() => {});
}
