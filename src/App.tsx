import { SnackbarProvider, showSnackbar } from "@/components/ui";
import { backend, guessFormat, idForSource } from "@/lib/backend";
import { type FileMeta, type RecentsEntry, STORAGE_KEYS } from "@/lib/types";
import { Home } from "@/screens/Home";
import { Splash } from "@/screens/Splash";
import { Onboarding } from "@/screens/onboarding/Onboarding";
import { SettingsScreen } from "@/screens/settings/SettingsScreen";
import { ViewerScreen } from "@/screens/viewer/ViewerScreen";
import { NavigationProvider, useNavigation } from "@/state/NavigationContext";
import { RecentsProvider, useRecents } from "@/state/RecentsContext";
import { SettingsProvider } from "@/state/SettingsContext";
import {
	ErrorDialog,
	type OpenError,
	validateFileName,
} from "@/state/openFlow";
import { GlobalStyles } from "@/theme";
import { useCallback, useEffect, useRef, useState } from "react";

const SPLASH_MS = 480;

function Root() {
	const { remove, replaceSource } = useRecents();
	const { state, openViewer, openSettings, handleBack } = useNavigation();
	const [phase, setPhase] = useState<"splash" | "onboarding" | "app">("splash");
	const [openError, setOpenError] = useState<OpenError | null>(null);
	const [picking, setPicking] = useState(false);
	const lastBridged = useRef<string | null>(null);
	const bridgeHandled = useRef(false);
	/** Set when a pick should repair an unavailable recent entry. */
	const repairTarget = useRef<string | null>(null);

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

	const openFile = useCallback(
		(file: FileMeta) => {
			setPhase("app");
			openViewer(file);
		},
		[openViewer],
	);

	/** System picker flow: route to the viewer the moment the file
	 * is picked. The viewer reads the bytes once and sniffs the
	 * format there — validation before reading showed an
	 * "unsupported" dialog for every Android picker result, whose
	 * content:// URIs carry no extension. Silent on cancel. */
	const pickAndOpen = useCallback(async () => {
		if (picking) return;
		setPicking(true);
		try {
			const picked = await backend.pickFile();
			if (picked) {
				const format = guessFormat(picked.name);
				// A pick that repairs an unavailable recent updates that
				// entry in place instead of creating a duplicate.
				const repairId = repairTarget.current;
				if (repairId) {
					repairTarget.current = null;
					replaceSource(repairId, {
						name: picked.name,
						format,
						size: picked.size,
						source: picked.source,
						reopen: picked.reopen,
					});
				}
				openFile({
					name: picked.name,
					format,
					size: picked.size,
					ref: picked.ref,
					source: picked.source,
					reopen: picked.reopen,
				});
			}
		} finally {
			setPicking(false);
		}
	}, [picking, openFile, replaceSource]);

	/** Re-open a recent. The durable descriptor resolves inside the
	 * viewer; a typed failure offers repair/remove instead of a
	 * generic "File not found". */
	const openRecent = useCallback(
		(entry: RecentsEntry) => {
			openFile({
				name: entry.name,
				format: entry.format,
				size: entry.size,
				ref: entry.source,
				source: entry.source,
				reopen: entry.reopen,
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
	// copies the file into the managed imports store and evaluates
	// the inline bridge; payloads queue in window.__paperwrenFiles
	// until React drains them here. A cold start via intent bypasses
	// onboarding entirely (docs/06: reading the file is the
	// onboarding). A second intent while file A is open stacks B
	// above A instead of replacing it.
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
				size: next.size,
				ref: next.path,
				source: next.path,
				reopen: { kind: "managed-copy", path: next.path },
			};
			backend.storeSet(STORAGE_KEYS.onboarded, true).catch(() => {});
			setPhase("app");
			openViewer(file);
		};
		drain();
		window.addEventListener("paperwren-file", drain);
		return () => window.removeEventListener("paperwren-file", drain);
	}, [openViewer]);

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

	// Render every screen in the stack so a popped viewer restores
	// with its preserved scroll/zoom instead of remounting cold.
	const screens = state.screens;

	return (
		<>
			{screens.map((screen, i) => {
				const isTop = i === screens.length - 1;
				// Stack position keeps keys unique when the same file is
				// open twice; identity alone is not a valid React key here.
				const stackKey = `${i}`;
				if (screen.kind === "home") {
					return (
						<Home
							key="home"
							onPickFile={pickAndOpen}
							onOpenRecent={openRecent}
							onOpenSettings={() => openSettings()}
						/>
					);
				}
				if (screen.kind === "settings") {
					return (
						<SettingsScreen
							key={`settings-${stackKey}`}
							visible={isTop}
							subpage={screen.subpage}
						/>
					);
				}
				return (
					<div
						key={`viewer-${screen.file.source}-${stackKey}`}
						style={isTop ? undefined : { display: "none" }}
					>
						<ViewerScreen
							file={screen.file}
							onClose={handleBack}
							onMissingFile={handleBack}
							onRemoved={(id) => {
								remove(id);
								showSnackbar({ message: "Removed from recents." });
								handleBack();
							}}
							onRepair={() => {
								repairTarget.current = idForSource(screen.file.source);
								pickAndOpen();
							}}
						/>
					</div>
				);
			})}
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
					<NavigationProvider>
						<SnackbarProvider>
							<Root />
						</SnackbarProvider>
					</NavigationProvider>
				</RecentsProvider>
			</SettingsProvider>
		</>
	);
}
