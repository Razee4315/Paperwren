import { formatCssVar } from "@/components/FormatBadge";
import { useCallback, useEffect, useRef, useState } from "react";
import styled from "styled-components";
import { ViewerShell } from "./ViewerShell";

/**
 * SCR-08 DOCX reader (docs/07 section 4): docx-preview renders the
 * document's own layout into a paginated container. The full
 * fidelity tier (headings, body, runs, lists, tables, images,
 * links, page breaks) is what the library produces; the degraded
 * tiers degrade inside it. Reading mode with reflow and text size
 * follows in the reading pass.
 */

const ScrollWrap = styled.div`
	position: absolute;
	inset: 0;
	overflow: auto;
	background: var(--surface-2);
	padding: 16px;
	padding-top: calc(72px + var(--safe-area-top, 0px));
`;

const DocContainer = styled.div<{ $size: number }>`
	max-width: 820px;
	margin: 0 auto;
	background: var(--surface);
	box-shadow: var(--shadow-1);
	font-size: ${({ $size }) => $size}%;

	/* docx-preview injects its own default chrome; bring it back to
	   the Paper and Ink surfaces. */
	.docx-wrapper {
		background: transparent !important;
		padding: 0 !important;
	}
	.docx-wrapper > section.docx {
		background: var(--surface) !important;
		box-shadow: var(--shadow-1) !important;
		margin-bottom: 12px;
	}
`;

const Center = styled.div`
	position: absolute;
	inset: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	color: var(--ink-2);
	padding: 24px;
	text-align: center;
`;

const PanelNote = styled.p`
	color: var(--ink-2);
	font-size: 0.9375rem;
	padding: 8px;
`;

declare global {
	interface Window {
		__PAPERWREN_DOCX_FAIL__?: string;
	}
}

export function DocxViewer({
	data,
	name,
	initialPosition,
	onPosition,
	onClose,
}: {
	data: ArrayBuffer;
	name: string;
	initialPosition?: FilePositionLike;
	onPosition?: (pos: FilePositionLike) => void;
	onClose: () => void;
}) {
	const [failed, setFailed] = useState(false);
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const containerRef = useRef<HTMLDivElement | null>(null);
	const positionTimer = useRef<number | null>(null);
	const restored = useRef(false);

	useEffect(() => {
		let cancelled = false;
		import("docx-preview")
			.then((docx) => {
				if (cancelled || !containerRef.current) return;
				containerRef.current.replaceChildren();
				return docx
					.renderAsync(data, containerRef.current, undefined, {
						inWrapper: true,
						ignoreLastRenderedPageBreak: false,
						useBase64URL: true,
					})
					.catch((e: unknown) => {
						window.__PAPERWREN_DOCX_FAIL__ = String(e);
						setFailed(true);
					});
			})
			.catch(() => setFailed(true));
		return () => {
			cancelled = true;
		};
	}, [data]);

	const onScroll = useCallback(() => {
		const el = scrollRef.current;
		if (!el) return;
		if (positionTimer.current !== null) {
			window.clearTimeout(positionTimer.current);
		}
		positionTimer.current = window.setTimeout(() => {
			positionTimer.current = null;
			onPosition?.({
				scrollRatio:
					el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight),
			});
		}, 500);
	}, [onPosition]);

	// Restore position once content has rendered.
	useEffect(() => {
		if (failed || restored.current) return;
		const el = scrollRef.current;
		if (!el || !containerRef.current) return;
		if (containerRef.current.childElementCount === 0) return;
		restored.current = true;
		if (initialPosition?.scrollRatio && el.scrollHeight > el.clientHeight) {
			el.scrollTop =
				initialPosition.scrollRatio * (el.scrollHeight - el.clientHeight);
		}
	});

	if (failed) {
		return (
			<ViewerShell
				name={name}
				formatColor={formatCssVar("docx").base}
				progress={null}
				onClose={onClose}
				chromeAutohide={false}
			>
				<Center>
					Can't open this file. It seems to be damaged or isn't a valid Word
					document.
				</Center>
			</ViewerShell>
		);
	}

	return (
		<ViewerShell
			name={name}
			formatColor={formatCssVar("docx").base}
			progress={null}
			onClose={onClose}
			chromeAutohide={false}
		>
			<ScrollWrap ref={scrollRef} onScroll={onScroll} data-testid="docx-view">
				<DocContainer ref={containerRef} $size={100}>
					<PanelNote>Opening document...</PanelNote>
				</DocContainer>
			</ScrollWrap>
		</ViewerShell>
	);
}

interface FilePositionLike {
	scrollRatio?: number;
	page?: number;
	zoom?: number;
}
