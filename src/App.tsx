import { SnackbarProvider, showSnackbar } from "@/components/ui";
import { backend } from "@/lib/backend";
import { type FileMeta, type RecentsEntry, STORAGE_KEYS } from "@/lib/types";
import { Home } from "@/screens/Home";
import { Splash } from "@/screens/Splash";
import { Onboarding } from "@/screens/onboarding/Onboarding";
import { SettingsScreen } from "@/screens/settings/SettingsScreen";
import { ViewerScreen } from "@/screens/viewer/ViewerScreen";
import { RecentsProvider, useRecents } from "@/state/RecentsContext";
import { SettingsProvider } from "@/state/SettingsContext";
import { ErrorDialog, type OpenError, pickAndValidate } from "@/state/openFlow";
import { GlobalStyles } from "@/theme";
import { useCallback, useEffect, useState } from "react";

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

	useEffect(() => {
		let cancelled = false;
		const minSplash = new Promise((r) => window.setTimeout(r, SPLASH_MS));
		Promise.all([backend.storeGet(STORAGE_KEYS.onboarded), minSplash]).then(
			([onboarded]) => {
				if (cancelled) return;
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
