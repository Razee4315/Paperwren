import { Button, Dialog } from "@/components/ui";
import { backend, idForSource } from "@/lib/backend";
import type { FileMeta, FilePosition } from "@/lib/types";
import { useRecents } from "@/state/RecentsContext";
import { useSettings } from "@/state/SettingsContext";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { useEffect, useMemo, useState } from "react";
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
				Word, Excel, CSV, Markdown, and text files.
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
		const lower = file.name.toLowerCase();
		if (lower.endsWith(".md") || lower.endsWith(".markdown")) {
			return <MarkdownView data={data} name={file.name} onClose={onClose} />;
		}
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

function MarkdownView({
	data,
	name,
	onClose,
}: {
	data: ArrayBuffer;
	name: string;
	onClose: () => void;
}) {
	const html = useMemo(() => {
		const text = new TextDecoder().decode(data);
		const parsed = marked.parse(text, { async: false });
		// File content is untrusted input; sanitize before it can
		// touch the DOM of a webview with IPC access.
		return DOMPurify.sanitize(parsed, {
			FORBID_TAGS: ["style", "script", "iframe", "form"],
		});
	}, [data]);
	return (
		<ViewerShell
			name={name}
			formatColor="var(--ink-3)"
			progress={null}
			onClose={onClose}
			chromeAutohide={false}
		>
			<MarkdownBody>
				{/* biome-ignore lint/security/noDangerouslySetInnerHtml: content is DOMPurify-sanitized two lines above */}
				<article dangerouslySetInnerHTML={{ __html: html }} />
			</MarkdownBody>
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

/* Markdown reading typography, mapped onto Paper and Ink tokens. */
const MarkdownBody = styled.div`
	position: absolute;
	inset: 0;
	overflow: auto;
	padding: 24px 20px calc(48px + var(--safe-area-bottom, 0px));
	max-width: 760px;
	margin: 0 auto;

	article {
		line-height: 1.65;
		font-size: 1rem;
		color: var(--ink-1);
	}
	h1,
	h2,
	h3,
	h4 {
		font-family: var(--font-display);
		color: var(--ink-1);
		margin: 1.4em 0 0.5em;
		line-height: 1.25;
	}
	h1 {
		font-size: 1.9em;
		border-bottom: 1px solid var(--border);
		padding-bottom: 0.3em;
	}
	h2 {
		font-size: 1.5em;
	}
	h3 {
		font-size: 1.2em;
	}
	p {
		margin: 0.8em 0;
	}
	a {
		color: var(--accent-strong);
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	code {
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 0.1em 0.4em;
		font-family: ui-monospace, "Cascadia Mono", Menlo, monospace;
		font-size: 0.9em;
	}
	pre {
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 12px;
		padding: 14px 16px;
		overflow-x: auto;
	}
	pre code {
		background: none;
		border: none;
		padding: 0;
	}
	blockquote {
		border-left: 3px solid var(--accent);
		margin: 1em 0;
		padding: 0.2em 0 0.2em 1em;
		color: var(--ink-2);
	}
	ul,
	ol {
		padding-left: 1.5em;
		margin: 0.8em 0;
	}
	li {
		margin: 0.3em 0;
	}
	table {
		border-collapse: collapse;
		margin: 1em 0;
		width: 100%;
		font-variant-numeric: tabular-nums;
	}
	th,
	td {
		border: 1px solid var(--border);
		padding: 8px 12px;
		text-align: left;
	}
	th {
		background: var(--surface-2);
		font-weight: 700;
	}
	img {
		max-width: 100%;
		border-radius: 8px;
	}
	hr {
		border: none;
		border-top: 1px solid var(--border);
		margin: 2em 0;
	}
`;
