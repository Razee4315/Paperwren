import { backend } from "@/lib/backend";
import { type OpenFailure, classifyError, failureCopy } from "@/lib/errors";
import { type FileFormat, friendlyName, sniffFormat } from "@/lib/formats";
import type { OpenRequest, Position } from "@/lib/types";
import { useRecents } from "@/state/recents";
import { Button, Dialog, ErrorArt, Spinner, StateView } from "@/ui";
import {
	type ComponentType,
	Suspense,
	lazy,
	useCallback,
	useEffect,
	useState,
} from "react";
import type { ViewerProps } from "./types";

// Each engine is its own chunk: opening a spreadsheet never loads pdf.js.
const VIEWERS: Partial<Record<FileFormat, ComponentType<ViewerProps>>> = {};
const pdf = lazy(() => import("./PdfView"));
const docx = lazy(() => import("./DocxView"));
const sheet = lazy(() => import("./SheetView"));
const slides = lazy(() => import("./SlidesView"));
const reflow = lazy(() => import("./ReflowView"));
const text = lazy(() => import("./TextView"));
Object.assign(VIEWERS, {
	pdf,
	docx,
	xlsx: sheet,
	xls: sheet,
	ods: sheet,
	csv: sheet,
	pptx: slides,
	doc: reflow,
	ppt: reflow,
	odt: reflow,
	odp: reflow,
	rtf: reflow,
	md: text,
	txt: text,
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

type Loaded = { data: ArrayBuffer; format: FileFormat; name: string };

export default function ViewerScreen({
	request,
	active,
	onClose,
	onLocate,
}: {
	request: OpenRequest;
	active: boolean;
	onClose: () => void;
	onLocate: () => void;
}) {
	const { entries, record, setPosition, markUnavailable, remove } =
		useRecents();
	const [loaded, setLoaded] = useState<Loaded | null>(null);
	const [failure, setFailure] = useState<OpenFailure | null>(null);
	// Position at open time; later writes must not re-trigger restores.
	const [initialPosition] = useState<Position | undefined>(
		() =>
			request.position ?? entries.find((e) => e.id === request.id)?.position,
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: read once per request
	useEffect(() => {
		let alive = true;
		backend
			.read(request.reopen)
			.then((data) => {
				if (!alive) return;
				if (data.byteLength === 0)
					throw Object.assign(new Error("empty"), { failure: "empty" });
				const format = sniffFormat(data, request.name);
				if (format === "unknown") {
					setFailure("unsupported");
					return;
				}
				const { name, verified } = displayName(request, format);
				record({
					id: request.id,
					name,
					nameVerified: verified ? undefined : false,
					format,
					size: data.byteLength,
					reopen: request.reopen,
					position: request.position,
				});
				setLoaded({ data, format, name });
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
	}, [request]);

	const onPosition = useCallback(
		(p: Position) => setPosition(request.id, p),
		[request.id, setPosition],
	);

	if (failure) {
		const copy = failureCopy(failure, request.name);
		const isRecent = entries.some((e) => e.id === request.id);
		return (
			<Dialog
				open
				title={copy.title}
				onClose={onClose}
				testId="open-error"
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
								Remove
							</Button>
						)}
						{copy.action === "locate" ? (
							<Button onClick={onLocate}>Locate file</Button>
						) : (
							<Button onClick={onClose} data-testid="error-ok">
								OK
							</Button>
						)}
					</>
				}
			>
				{copy.message}
			</Dialog>
		);
	}

	const spinner = (
		<StateView>
			<Spinner label={`Opening ${request.name}`} />
		</StateView>
	);
	if (!loaded)
		return (
			<div
				style={{
					position: "fixed",
					inset: 0,
					zIndex: 30,
					background: "var(--canvas)",
				}}
			>
				{spinner}
			</div>
		);

	const View = VIEWERS[loaded.format];
	if (!View) return null;
	return (
		<Suspense
			fallback={
				<div
					style={{
						position: "fixed",
						inset: 0,
						zIndex: 30,
						background: "var(--canvas)",
					}}
				>
					{spinner}
				</div>
			}
		>
			<View
				data={loaded.data}
				name={loaded.name}
				format={loaded.format}
				position={initialPosition}
				onPosition={onPosition}
				onClose={onClose}
				active={active}
			/>
		</Suspense>
	);
}
