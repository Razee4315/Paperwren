import type { Update } from "@tauri-apps/plugin-updater";
import { useSyncExternalStore } from "react";
import { isDesktop, isTauri } from "./env";

/** A computer updates the app itself, from the GitHub release feed in
 * tauri.conf.json; a phone updates through its store. ?updates shows
 * the controls in the dev server, where a check always fails. */
export const canUpdate =
	isDesktop &&
	(isTauri ||
		(typeof window !== "undefined" &&
			new URLSearchParams(window.location.search).has("updates")));

export type UpdateState =
	| { phase: "idle" }
	| { phase: "checking" }
	/** Asked for, and there is nothing newer. */
	| { phase: "latest" }
	/** Asked for, and the feed could not be reached or read. */
	| { phase: "failed" }
	| { phase: "available"; version: string; notes: string }
	/** Downloading; percent is null while the size is unknown. */
	| { phase: "installing"; version: string; percent: number | null }
	| { phase: "install-failed"; version: string };

let state: UpdateState = { phase: "idle" };
let found: Update | null = null;
const listeners = new Set<() => void>();

function set(next: UpdateState) {
	state = next;
	for (const listener of listeners) listener();
}

export function getUpdateState(): UpdateState {
	return state;
}

export function subscribeUpdates(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function useUpdateState(): UpdateState {
	return useSyncExternalStore(subscribeUpdates, getUpdateState);
}

type Check = () => Promise<Update | null>;
const feed: Check = async () =>
	(await import("@tauri-apps/plugin-updater")).check();

/** Ask the release feed for a newer version. A quiet check (the one at
 * start) says nothing unless there is one; a check the reader asked
 * for ends in "latest" or "failed" too. Answers the phase it ended in. */
export async function checkForUpdate(
	quiet: boolean,
	check: Check = feed,
): Promise<UpdateState["phase"]> {
	if (state.phase === "checking" || state.phase === "installing")
		return state.phase;
	set({ phase: "checking" });
	try {
		found = await check();
		if (found)
			set({
				phase: "available",
				version: found.version,
				notes: found.body?.trim() ?? "",
			});
		else set(quiet ? { phase: "idle" } : { phase: "latest" });
	} catch {
		found = null;
		set(quiet ? { phase: "idle" } : { phase: "failed" });
	}
	return state.phase;
}

type Restart = () => Promise<void>;
const restart: Restart = async () =>
	(await import("@tauri-apps/plugin-process")).relaunch();

/** Download the version found, install it and start it. On Windows the
 * installer closes the app itself; elsewhere it restarts here. */
export async function installUpdate(relaunch: Restart = restart) {
	const update = found;
	if (!update || state.phase === "installing") return;
	const version = update.version;
	set({ phase: "installing", version, percent: null });
	try {
		let total = 0;
		let done = 0;
		await update.downloadAndInstall((event) => {
			if (event.event === "Started") total = event.data.contentLength ?? 0;
			else if (event.event === "Progress" && total > 0) {
				done += event.data.chunkLength;
				const percent = Math.min(100, Math.floor((done / total) * 100));
				if (state.phase === "installing" && state.percent !== percent)
					set({ phase: "installing", version, percent });
			}
		});
		await relaunch();
		// Still here: the new version runs at the next start.
		found = null;
		set({ phase: "idle" });
	} catch {
		set({ phase: "install-failed", version });
	}
}

/** "Later": the version found waits for the next check. */
export function dismissUpdate() {
	if (state.phase !== "installing") set({ phase: "idle" });
}
