import { backend, formatBytes } from "@/lib/backend";
import { type OpenFailure, classifyError, failureCopy } from "@/lib/errors";
import { type FileFormat, friendlyName, isLargeFile } from "@/lib/formats";
import { t } from "@/lib/i18n";
import type { DecryptResult } from "@/lib/parseWorker";
import { isEncryptedPackage, sniffFormat } from "@/lib/sniff";
import type { OpenRequest, Position } from "@/lib/types";
import { holdScreen } from "@/lib/wake";
import { useRecents } from "@/state/recents";
import { useSettings } from "@/state/settings";
import { Button, Dialog, ErrorArt, OpeningView } from "@/ui";
import {
	Component,
	type ComponentType,
	type ReactNode,
	Suspense,
	lazy,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { PasswordDialog } from "./Dialogs";
import { FileChangedBar, useFileChanged } from "./FileChanged";
import { ViewerFileContext } from "./FileMenu";
import { runWorker } from "./runWorker";
import type { ViewerProps } from "./types";

// Each engine is its own chunk: opening a spreadsheet never loads pdf.js.
const VIEWERS: Partial<Record<FileFormat, ComponentType<ViewerProps>>> = {};
const pdf = lazy(() => import("./PdfView"));
const docx = lazy(() => import("./DocxView"));
const sheet = lazy(() => import("./SheetView"));
const slides = lazy(() => import("./SlidesView"));
const reflow = lazy(() => import("./ReflowView"));
const epub = lazy(() => import("./EpubView"));
const text = lazy(() => import("./TextView"));
const image = lazy(() => import("./ImageView"));
Object.assign(VIEWERS, {
	pdf,
	docx,
	xlsx: sheet,
	xls: sheet,
	ods: sheet,
	csv: sheet,
	pptx: slides,
	ppt: slides,
	odp: slides,
	doc: reflow,
	odt: reflow,
	rtf: reflow,
	epub,
	md: text,
	txt: text,
	image,
	cbz: image,
});

/** Content URIs often carry no extension; name the file after what
 * the bytes turned out to be. Provider-verified names stay as-is. */
function displayName(
	request: OpenRequest,
	format: FileFormat,
): { name: string; verified: boolean } {
	if (request.nameVerified) return { name: request.name, verified: true };
	// The provider may answer now even if it didn't at pick time.
	if (request.reopen.kind === "uri") {
		const asked = backend.providerName(request.reopen.uri);
		if (asked) return { name: asked, verified: true };
	}
	return { name: friendlyName(request.name, format), verified: false };
}

type Loaded = {
	data: ArrayBuffer;
	format: FileFormat;
	name: string;
	/** Bytes read; kept because a viewer may transfer `data` away. */
	size: number;
};

/** A file can hold something an engine chokes on while drawing. That
 * must end in an honest message, never a blank app. */
class ViewerBoundary extends Component<
	{ name: string; onClose: () => void; children: ReactNode },
	{ failed: boolean }
> {
	state = { failed: false };
	static getDerivedStateFromError() {
		return { failed: true };
	}
	render() {
		if (!this.state.failed) return this.props.children;
		return (
			<Dialog
				open
				title={t("Couldn't show this file")}
				onClose={this.props.onClose}
				testId="viewer-crash"
				alert
				art={<ErrorArt />}
				actions={<Button onClick={this.props.onClose}>{t("OK")}</Button>}
			>
				{t(
					"“{name}” contains something Paperwren can't draw. The file itself is untouched.",
					{ name: this.props.name },
				)}
			</Dialog>
		);
	}
}

export default function ViewerScreen({
	request,
	active,
	onClose,
	onLocate,
	onReplace,
	onOpen,
	onTools,
}: {
	request: OpenRequest;
	active: boolean;
	onClose: () => void;
	onLocate: () => void;
	/** Show another file in place of this one. */
	onReplace: (request: OpenRequest) => void;
	/** Show another file over this one. */
	onOpen: (request: OpenRequest) => void;
	/** Open the tools (or one of them) with this file. */
	onTools?: (tool: string | undefined, file: OpenRequest) => void;
}) {
	const { entries, record, setPosition, markUnavailable, remove } =
		useRecents();
	const [loaded, setLoaded] = useState<Loaded | null>(null);
	const [failure, setFailure] = useState<OpenFailure | null>(null);
	// A very large file is read only once the reader has said so.
	const [allowed, setAllowed] = useState(
		() => !isLargeFile(request.name, request.size),
	);
	// Position at open time; later writes must not re-trigger restores.
	// A reload starts from where the reader had got to.
	const [initialPosition, setInitialPosition] = useState<Position | undefined>(
		() =>
			request.position ?? entries.find((e) => e.id === request.id)?.position,
	);
	// Counts the reads of the file: a reload reads it again.
	const [reads, setReads] = useState(0);

	// A password-protected Office file, waiting for its password.
	const [locked, setLocked] = useState<{
		data: ArrayBuffer;
		wrong: boolean;
		busy: boolean;
	} | null>(null);
	const unlocking = useRef<AbortController | null>(null);
	// Whether this file was new to Recent files when it was opened: one
	// that then fails to open is taken out again, an old one is kept.
	const firstOpen = useRef(false);
	useEffect(() => () => unlocking.current?.abort(), []);

	/** Show what the bytes turned out to be. `size` is the file's own
	 * size, which for a protected file is not that of its contents. */
	const show = (data: ArrayBuffer, size: number) => {
		const format = sniffFormat(data, request.name);
		if (format === "unknown") {
			setFailure("unsupported");
			return;
		}
		const { name, verified } = displayName(request, format);
		firstOpen.current = !entries.some((e) => e.id === request.id);
		// A file inside another one has no place to reopen it from.
		if (request.reopen.kind !== "memory")
			record({
				id: request.id,
				name,
				nameVerified: verified ? undefined : false,
				format,
				size,
				reopen: request.reopen,
				position: request.position,
			});
		setLoaded({ data, format, name, size });
	};

	const unlock = (password: string) => {
		if (!locked) return;
		const { data } = locked;
		setLocked({ data, wrong: false, busy: true });
		unlocking.current = new AbortController();
		runWorker<DecryptResult>(
			{ type: "decrypt", buffer: data, password },
			unlocking.current.signal,
		)
			.then((result) => {
				if (result.ok) {
					setLocked(null);
					show(result.data, data.byteLength);
				} else if (result.reason === "password")
					setLocked({ data, wrong: true, busy: false });
				else setFailure(result.reason === "corrupt" ? "corrupt" : "password");
			})
			.catch((err) => {
				if (err?.name !== "AbortError") setFailure("corrupt");
			});
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: read once per request
	useEffect(() => {
		if (!allowed) return;
		let alive = true;
		backend
			.read(request.reopen)
			.then((data) => {
				if (!alive) return;
				if (data.byteLength === 0)
					throw Object.assign(new Error("empty"), { failure: "empty" });
				if (isEncryptedPackage(data))
					setLocked({ data, wrong: false, busy: false });
				else show(data, data.byteLength);
			})
			.catch((err) => {
				if (!alive) return;
				const kind: OpenFailure =
					err?.failure === "empty" ? "empty" : classifyError(err);
				setFailure(kind);
				if (
					kind === "not_found" ||
					kind === "permission" ||
					kind === "unreadable"
				)
					markUnavailable(request.id);
			});
		return () => {
			alive = false;
		};
	}, [request, allowed, reads]);

	const [changed, keepVersion] = useFileChanged(
		request.reopen,
		!!loaded && active,
		reads,
	);
	const reload = () => {
		setInitialPosition(
			(was) => entries.find((e) => e.id === request.id)?.position ?? was,
		);
		setLoaded(null);
		setReads((n) => n + 1);
	};

	const onPosition = useCallback(
		(p: Position) => setPosition(request.id, p),
		[request.id, setPosition],
	);

	// The screen stays on only while this document is the one on show.
	const { settings } = useSettings();
	const reading = !!loaded && active;
	useEffect(() => {
		if (settings.keepAwake && reading) return holdScreen();
	}, [settings.keepAwake, reading]);

	if (failure) {
		const copy = failureCopy(failure, request.name);
		const isRecent = entries.some((e) => e.id === request.id);
		return (
			<Dialog
				open
				title={copy.title}
				onClose={onClose}
				testId="open-error"
				alert
				art={<ErrorArt />}
				actions={
					<>
						{isRecent && copy.action === "locate" && (
							<Button
								variant="danger"
								onClick={() => {
									remove(request.id);
									onClose();
								}}
							>
								{t("Remove")}
							</Button>
						)}
						{copy.action === "locate" ? (
							<Button onClick={onLocate}>{t("Locate file")}</Button>
						) : (
							<Button onClick={onClose} data-testid="error-ok">
								{t("OK")}
							</Button>
						)}
					</>
				}
			>
				{copy.message}
			</Dialog>
		);
	}

	if (!allowed)
		return (
			<Dialog
				open
				title={t("This is a large file")}
				onClose={onClose}
				testId="large-file"
				actions={
					<>
						<Button variant="ghost" onClick={onClose}>
							{t("Cancel")}
						</Button>
						<Button onClick={() => setAllowed(true)} data-testid="large-open">
							{t("Open anyway")}
						</Button>
					</>
				}
			>
				{t(
					"“{name}” is {size}. It may take a while to open, and a file this size can be more than this device has room for.",
					{ name: request.name, size: formatBytes(request.size) },
				)}
			</Dialog>
		);

	if (locked && !locked.busy)
		return (
			<PasswordDialog
				open
				name={request.name}
				wrong={locked.wrong}
				onSubmit={unlock}
				onCancel={onClose}
				testId="office"
			/>
		);

	if (!loaded) return <OpeningView name={request.name} />;

	const View = VIEWERS[loaded.format];
	if (!View) return null;
	return (
		<ViewerFileContext.Provider
			value={{
				file: {
					name: loaded.name,
					format: loaded.format,
					reopen: request.reopen,
				},
				id: request.id,
				// Shown again under its new name, from where it now is.
				onRenamed:
					request.reopen.kind === "memory"
						? undefined
						: (name, reopen, id) =>
								onReplace({
									...request,
									id,
									name,
									nameVerified: true,
									reopen,
									position:
										entries.find((e) => e.id === request.id)?.position ??
										initialPosition,
								}),
				size: loaded.data.byteLength || loaded.size,
				openOther: onReplace,
				openOver: onOpen,
				openTools:
					onTools && request.reopen.kind !== "memory"
						? (tool) => onTools(tool, request)
						: undefined,
			}}
		>
			<ViewerBoundary name={loaded.name} onClose={onClose}>
				<Suspense fallback={<OpeningView name={request.name} />}>
					<View
						data={loaded.data}
						name={loaded.name}
						format={loaded.format}
						position={initialPosition}
						onPosition={onPosition}
						onClose={onClose}
						active={active}
						onBroken={() => {
							if (firstOpen.current) remove(request.id);
						}}
					/>
				</Suspense>
			</ViewerBoundary>
			{changed && active && (
				<FileChangedBar onReload={reload} onDismiss={keepVersion} />
			)}
		</ViewerFileContext.Provider>
	);
}
