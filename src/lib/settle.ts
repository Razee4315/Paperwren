/**
 * `run` at the first call of a burst, and once more when the calls have
 * stopped for `quiet` milliseconds. A window being resized sends an
 * event for every step of the drag; asking the shell about the window
 * on each one is a call into it every time, for the same answer.
 */
export function atEdges(run: () => void, quiet = 150) {
	let timer = 0;
	let burst = false;
	const call = () => {
		if (!burst) {
			burst = true;
			run();
		}
		window.clearTimeout(timer);
		timer = window.setTimeout(() => {
			burst = false;
			run();
		}, quiet);
	};
	call.cancel = () => window.clearTimeout(timer);
	return call;
}

/** `run` once the calls have stopped for `quiet` milliseconds (trailing
 * edge only). Avoids leading-edge IPC storms during window resize drags
 * when explicit clicks already sync immediately. */
export function afterQuiet(run: () => void, quiet = 200) {
	let timer = 0;
	const call = () => {
		window.clearTimeout(timer);
		timer = window.setTimeout(run, quiet);
	};
	call.cancel = () => window.clearTimeout(timer);
	return call;
}
