import { Button, Dialog } from "@/components/ui";
import { backend, idForSource } from "@/lib/backend";
import type { FileMeta, FilePosition } from "@/lib/types";
import { useRecents } from "@/state/RecentsContext";
import { useSettings } from "@/state/SettingsContext";
import { useEffect, useState } from "react";
import styled from "styled-components";
import { DocxViewer } from "./DocxViewer";
import { PdfViewer } from "./PdfViewer";
import { ViewerShell } from "./ViewerShell";
import { XlsxViewer } from "./XlsxViewer";

/**
 * SCR-07..10 viewer dispatcher (docs/05): loads the bytes through
 * the backend, restores position memory, and routes to the format
 * viewer. Formats scheduled for later phases show the honest
 * dialogs from docs/09 instead of a broken attempt.
 */

const Center = styled.div`
	position: fixed;
	inset: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	background: var(--bg);
	color: var(--ink-2);
`;

export function ViewerScreen({
	file,
	onClose,
	onMissingFile,
	onRemoved,
}: {
	file: FileMeta;
	onClose: () => void;
	onMissingFile: () => void;
	onRemoved: (id: string) => void;
}) {
	const { settings } = useSettings();
	const { entries, updatePosition } = useRecents();
	const [data, setData] = useState<ArrayBuffer | null>(null);
	const [loadFailed, setLoadFailed] = useState(false);
	const recentsId = idForSource(file.source);

	const entry = entries.find((e) => e.id === recentsId);

	useEffect(() => {
		let cancelled = false;
		backend
			.readBytes(file.ref)
			.then((buf) => {
				if (cancelled) return;
				if (buf.byteLength === 0) {
					setLoadFailed(true);
					return;
				}
				setData(buf);
			})
			.catch(() => {
				if (!cancelled) setLoadFailed(true);
			});
		return () => {
			cancelled = true;
		};
	}, [file.ref]);

	const handlePosition = (pos: FilePosition) => {
		updatePosition(recentsId, pos);
	};

	if (loadFailed) {
		return (
			<Dialog
				open
				title="File not found"
				onDismiss={onMissingFile}
				actions={
					<>
						<Button
							variant="destructive"
							onClick={() => {
								onRemoved(recentsId);
								onClose();
							}}
						>
							Remove from recents
						</Button>
						<Button onClick={onMissingFile}>OK</Button>
					</>
				}
			>
				{`'${file.name}' is not where it was. It may have been moved or deleted.`}
			</Dialog>
		);
	}

	if (!data) {
		return <Center>Opening {file.name}...</Center>;
	}

	if (file.format === "pptx") {
		return (
			<Dialog
				open
				title="PowerPoint files"
				onDismiss={onClose}
				actions={<Button onClick={onClose}>OK</Button>}
			>
				PowerPoint viewing arrives in the v1.2 update. This build reads PDF,
				Word, Excel, CSV, and text files.
			</Dialog>
		);
	}

	if (file.format === "docx") {
		return (
			<DocxViewer
				data={data}
				name={file.name}
				initialPosition={entry?.position}
				onPosition={handlePosition}
				onClose={onClose}
			/>
		);
	}

	if (file.format === "pdf") {
		return (
			<PdfViewer
				data={data}
				name={file.name}
				initialPosition={entry?.position}
				onPosition={handlePosition}
				onClose={onClose}
				darkenPages={settings["viewer.darken_pages"]}
			/>
		);
	}

	if (file.format === "xlsx" || file.format === "csv") {
		return <XlsxViewer data={data} name={file.name} onClose={onClose} />;
	}

	if (file.format === "txt") {
		return <TextPlainView data={data} name={file.name} onClose={onClose} />;
	}

	return (
		<Dialog
			open
			title="Unsupported file type"
			onDismiss={onClose}
			actions={<Button onClick={onClose}>OK</Button>}
		>
			Paperwren reads PDF, Word, Excel, and PowerPoint files.
		</Dialog>
	);
}

function TextPlainView({
	data,
	name,
	onClose,
}: {
	data: ArrayBuffer;
	name: string;
	onClose: () => void;
}) {
	const text = new TextDecoder().decode(data);
	return (
		<ViewerShell
			name={name}
			formatColor="var(--ink-3)"
			progress={null}
			onClose={onClose}
			chromeAutohide={false}
		>
			<Pre>{text}</Pre>
		</ViewerShell>
	);
}

const Pre = styled.pre`
	position: absolute;
	inset: 0;
	overflow: auto;
	padding: 16px;
	white-space: pre-wrap;
	word-break: break-word;
	font-size: 0.9375rem;
	color: var(--ink-1);
	font-family: ui-monospace, "Cascadia Mono", Menlo, monospace;
`;
