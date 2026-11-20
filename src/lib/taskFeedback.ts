import { useSyncExternalStore } from "react";

const pending = new Map<string, Promise<unknown>>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

/** Jobs outlive the menu that started them; repeat presses share the job. */
export function withFeedback<T>(
	key: string,
	action: () => Promise<T>,
): Promise<T> {
	const previous = pending.get(key);
	if (previous) return previous as Promise<T>;
	const job = Promise.resolve()
		.then(action)
		.finally(() => {
			pending.delete(key);
			notify();
		});
	pending.set(key, job);
	notify();
	return job;
}

export function usePendingTasks() {
	return useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		() => pending.size > 0,
	);
}
