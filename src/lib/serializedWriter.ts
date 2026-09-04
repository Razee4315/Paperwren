/**
 * Per-key serialized async writes (audit 15.1): rapid open/position/
 * pin events must never complete out of order and let a stale array
 * win the persisted state. Each key has one chained queue.
 */

export function createSerializedWriter(
	write: (key: string, value: unknown) => Promise<void>,
): (key: string, value: unknown) => Promise<void> {
	const queues = new Map<string, Promise<void>>();
	return (key, value) => {
		const previous = queues.get(key) ?? Promise.resolve();
		const next = previous
			.then(() => write(key, value))
			// A failed write must not poison the chain for the key.
			.catch(() => {});
		queues.set(key, next);
		return next;
	};
}
