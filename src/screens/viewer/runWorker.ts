import type { WorkerRequest } from "@/lib/parseWorker";

/** Run one parse in a fresh worker; aborting terminates it. */
export function runWorker<T>(
	request: WorkerRequest,
	signal: AbortSignal,
): Promise<T> {
	return new Promise((resolve, reject) => {
		const worker = new Worker(
			new URL("../../lib/parseWorker.ts", import.meta.url),
			{ type: "module" },
		);
		const done = () => worker.terminate();
		signal.addEventListener("abort", () => {
			done();
			reject(new DOMException("aborted", "AbortError"));
		});
		worker.onmessage = (e) => {
			done();
			resolve(e.data as T);
		};
		worker.onerror = (e) => {
			done();
			reject(new Error(e.message || "worker failed"));
		};
		const { buffer } = request;
		if (buffer instanceof ArrayBuffer) {
			const copy = buffer.slice(0);
			worker.postMessage({ ...request, buffer: copy }, [copy]);
		} else {
			worker.postMessage(request);
		}
	});
}
