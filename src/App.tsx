import { SnackbarProvider, showSnackbar } from "@/components/ui";
import { backend, guessFormat } from "@/lib/backend";
import { type FileMeta, type RecentsEntry, STORAGE_KEYS } from "@/lib/types";
import { Home } from "@/screens/Home";
import { Splash } from "@/screens/Splash";
import { Onboarding } from "@/screens/onboarding/Onboarding";
import { SettingsScreen } from "@/screens/settings/SettingsScreen";
import { ViewerScreen } from "@/screens/viewer/ViewerScreen";
import { RecentsProvider, useRecents } from "@/state/RecentsContext";
import { SettingsProvider } from "@/state/SettingsContext";
import {
	ErrorDialog,
	type OpenError,
	pickAndValidate,
	validateFileName,
} from "@/state/openFlow";
import { GlobalStyles } from "@/theme";
import { useCallback, useEffect, useRef, useState } from "react";

type Route =
	| { name: "home" }
	| { name: "viewer"; file: FileMeta }
	| { name: "settings" };

const SPLASH_MS = 480;

function Root() {
	const { recordOpen, remove } = useRecents();
	const [phase, setPhase] = useState<"splash" | "onboarding" | "app">("splash");
	const [route, setRoute] = useState<Route>({ name: "home" });
	const [openError, setOpenError] = useState<OpenError | null>(null);
	const [picking, setPicking] = useState(false);
	const lastBridged = useRef<string | null>(null);
	const bridgeHandled = useRef(false);

	useEffect(() => {
		let cancelled = false;
		const minSplash = new Promise((r) => window.setTimeout(r, SPLASH_MS));
		Promise.all([backend.storeGet(STORAGE_KEYS.onboarded), minSplash]).then(
			([onboarded]) => {
				if (cancelled) return;
				// A cold-start file from the open-with bridge wins over
				// the splash/onboarding flow.
				if (bridgeHandled.current) return;
				setPhase(onboarded ? "app" : "onboarding");
			},
		);
		return () => {
			cancelled = true;
		};
	}, []);

	const openFile = useCallback((file: FileMeta) => {
		setRoute({ name: "viewer", file });
	}, []);

	const goHome = useCallback(() => setRoute({ name: "home" }), []);

	/** System picker flow: validate, record, open. Silent when the
	 * user cancels the picker. */
	const pickAndOpen = useCallback(async () => {
		if (picking) return;
		setPicking(true);
		try {
			const result = await pickAndValidate();
			if (result.ok) {
				recordOpen({
					name: result.file.name,
					format: result.file.format,
					size: result.file.size,
					source: result.file.source,
				});
				openFile(result.file);
			} else if (
				result.error.kind !== "generic" ||
				result.error.detail !== ""
			) {
				setOpenError(result.error);
			}
		} finally {
			setPicking(false);
		}
	}, [picking, recordOpen, openFile]);

	/** Re-open a recent. The recents entry's source is the read
	 * handle; if the file is gone the viewer shows E-06. */
	const openRecent = useCallback(
		(entry: RecentsEntry) => {
			openFile({
				name: entry.name,
				format: entry.format,
				size: entry.size,
				ref: entry.source,
				source: entry.source,
			});
		},
		[openFile],
	);

	const finishOnboarding = useCallback(() => {
		backend.storeSet(STORAGE_KEYS.onboarded, true).catch(() => {});
		setPhase("app");
	}, []);

	const finishOnboardingAndPick = useCallback(() => {
		finishOnboarding();
		pickAndOpen();
	}, [finishOnboarding, pickAndOpen]);

	// Android open-with bridge (docs/10 section 3): MainActivity
	// copies the file into the inbox and evaluates the inline bridge;
	// payloads queue in window.__paperwrenFiles until React drains
	// them here. A cold start via intent bypasses onboarding entirely
	// (docs/06: reading the file is the onboarding).
	useEffect(() => {
		const drain = () => {
			const queue = window.__paperwrenFiles;
			if (!queue || queue.length === 0) return;
			const next = queue.splice(0, queue.length).pop();
			if (!next) return;
			const key = `${next.path}|${next.name}`;
			if (key === lastBridged.current) return; // duplicate delivery
			lastBridged.current = key;
			bridgeHandled.current = true;
			const nameError = validateFileName(next.name);
			if (nameError) {
				setOpenError(nameError);
				return;
			}
			const file: FileMeta = {
				name: next.name,
				format: guessFormat(next.name),
				size: 0,
				ref: next.path,
				source: next.path,
			};
			backend.storeSet(STORAGE_KEYS.onboarded, true).catch(() => {});
			setPhase("app");
			recordOpen({
				name: file.name,
				format: file.format,
				size: file.size,
				source: file.source,
			});
			setRoute({ name: "viewer", file });
		};
		drain();
		window.addEventListener("paperwren-file", drain);
		return () => window.removeEventListener("paperwren-file", drain);
	}, [recordOpen]);

	if (phase === "splash") {
		return <Splash />;
	}

	if (phase === "onboarding") {
		return (
			<>
				<Onboarding
					onFinish={finishOnboarding}
					onOpenPicker={finishOnboardingAndPick}
				/>
				<ErrorDialog
					error={openError}
					onDismiss={() => setOpenError(null)}
					onTryAnyway={openFile}
				/>
			</>
		);
	}

	return (
		<>
			{route.name === "home" && (
				<Home
					onPickFile={pickAndOpen}
					onOpenRecent={openRecent}
					onOpenSettings={() => setRoute({ name: "settings" })}
				/>
			)}
			{route.name === "viewer" && (
				<ViewerScreen
					key={route.file.source}
					file={route.file}
					onClose={goHome}
					onMissingFile={goHome}
					onRemoved={(id) => {
						remove(id);
						showSnackbar({ message: "Removed from recents." });
						goHome();
					}}
				/>
			)}
			{route.name === "settings" && <SettingsScreen onClose={goHome} />}
			<ErrorDialog
				error={openError}
				onDismiss={() => setOpenError(null)}
				onTryAnyway={openFile}
			/>
		</>
	);
}

export default function App() {
	return (
		<>
			<GlobalStyles />
			<SettingsProvider>
				<RecentsProvider>
					<SnackbarProvider>
						<Root />
					</SnackbarProvider>
				</RecentsProvider>
			</SettingsProvider>
		</>
	);
}
