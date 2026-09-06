/**
 * Open-flow diagnostics (docs/15 #2): a timestamped ring buffer over
 * the boundaries of the open pipeline — picker launch/result,
 * metadata resolution, navigation push, byte read, sniff, recents
 * record — so a device-side "nothing opens" stall can be located
 * from a bug report without a debugger attached. Never logs document
 * contents; names appear only where the user already sees them.
 *
 * On-device inspection: the Android WebView console, or evaluate
 * `window.__paperwrenOpenTrace()` from the app's remote debugging
 * console to dump the buffer.
 */

interface TraceEvent {
	/** Milliseconds since the epoch. */
	t: number;
	/** Per-open request ID (docs/15 #2 step 2): assigns every event of
	 * one open attempt to that attempt, so a stale completion from a
	 * closed or superseded open is diagnosable instead of misleading. */
	open?: number;
	event: string;
	detail?: string;
}

const MAX_EVENTS = 200;
const events: TraceEvent[] = [];

let lastOpenId = 0;

/** A fresh per-open request ID. App's openFile funnel — picker,
 * recents, and bridge opens all pass through it — stamps each open
 * attempt; downstream boundaries (viewer mount, byte read, PDF
 * parse, first paint) tag their events with the id they received. */
export function nextOpenId(): number {
	return ++lastOpenId;
}

export function traceOpen(event: string, detail?: string, open?: number): void {
	events.push({ t: Date.now(), event, detail, open });
	if (events.length > MAX_EVENTS) events.shift();
}

declare global {
	interface Window {
		/** Dump of the most recent open-flow events, oldest last. */
		__paperwrenOpenTrace?: () => TraceEvent[];
	}
}

if (typeof window !== "undefined") {
	window.__paperwrenOpenTrace = () => [...events];
}
