import { backend, requestForManagedCopy } from "@/lib/backend";
import type { OpenRequest, RecentEntry } from "@/lib/types";
import { Home } from "@/screens/home/Home";
import { SettingsScreen } from "@/screens/settings/Settings";
import { NavigationProvider, useNav } from "@/state/navigation";
import { RecentsProvider, useRecents } from "@/state/recents";
import { SettingsProvider } from "@/state/settings";
import { Spinner, StateView, ToastHost, toast } from "@/ui";
import { Suspense, lazy, useCallback, useEffect, useRef } from "react";

// The viewer engines (pdf.js, docx-preview, the grid) are the bulk of
// the code; Home must not pay for them at cold start.
const ViewerScreen = lazy(() => import("@/screens/viewer/ViewerScreen"));

declare global {
	interface Window {
		__paperwrenFiles?: Array<{ path: string; name: string; size: number }>;
	}
}

function Root() {
	const { state, push, back } = useNav();
	const { entries, remove } = useRecents();
	const nextKey = useRef(1);
	const picking = useRef(false);

	const open = useCallback(
		(request: OpenRequest) =>
			push({ kind: "viewer", request, key: nextKey.current++ }),
		[push],
	);

	const pick = useCallback(
		async (replacing?: RecentEntry) => {
			if (picking.current) return;
			picking.current = true;
			try {
				const request = await backend.pickFile();
				if (!request) return;
				if (replacing && replacing.id !== request.id) remove(replacing.id);
				open(
					replacing?.position
						? { ...request, position: replacing.position }
						: request,
				);
			} catch {
				toast("Couldn't open the file picker");
			} finally {
				picking.current = false;
			}
		},
		[open, remove],
	);

	const openRecent = useCallback(
		(e: RecentEntry) =>
			open({
				id: e.id,
				name: e.name,
				nameVerified: true,
				size: e.size,
				reopen: e.reopen,
			}),
		[open],
	);

	// Android "Open with": MainActivity copies the file into private
	// storage and calls window.__paperwrenOpenFile (see index.html);
	// payloads queue until this effect drains them.
	useEffect(() => {
		const drain = () => {
			const queue = window.__paperwrenFiles ?? [];
			for (const f of queue.splice(0, queue.length)) {
				open(requestForManagedCopy(f.path, f.name, f.size));
			}
		};
		drain();
		window.addEventListener("paperwren-file", drain);
		return () => window.removeEventListener("paperwren-file", drain);
	}, [open]);

	const entriesRef = useRef(entries);
	entriesRef.current = entries;

	return (
		<>
			<Home
				onOpenFile={() => pick()}
				onOpenRecent={openRecent}
				onSettings={() => push({ kind: "settings" })}
			/>
			{state.screens.map((screen, i) => {
				const top = i === state.screens.length - 1;
				if (screen.kind === "settings")
					return <SettingsScreen key="settings" />;
				if (screen.kind !== "viewer") return null;
				return (
					<Suspense
						key={screen.key}
						fallback={
							<StateView>
								<Spinner />
							</StateView>
						}
					>
						<ViewerScreen
							request={screen.request}
							active={top}
							onClose={back}
							onLocate={() => {
								const entry = entriesRef.current.find(
									(e) => e.id === screen.request.id,
								);
								back();
								pick(entry);
							}}
						/>
					</Suspense>
				);
			})}
			<ToastHost />
		</>
	);
}

export default function App() {
	return (
		<SettingsProvider>
			<RecentsProvider>
				<NavigationProvider>
					<Root />
				</NavigationProvider>
			</RecentsProvider>
		</SettingsProvider>
	);
}
