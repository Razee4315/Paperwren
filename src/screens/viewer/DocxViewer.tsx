import { formatCssVar } from "@/components/FormatBadge";
import { useCallback, useEffect, useRef, useState } from "react";
import styled from "styled-components";
import { ViewerShell } from "./ViewerShell";

/**
 * SCR-08 DOCX reader (docs/07 section 4): docx-preview renders the
 * document's own layout into paginated white "paper" pages, scaled
 * to fit the screen width. Pages stay white in every theme, like
 * PDF pages, so text keeps its document colors and stays readable
 * in dark mode.
 */

const ScrollWrap = styled.div`
	position: absolute;
	inset: 0;
	overflow: auto;
	background: var(--surface-2);
	padding: 16px;
	padding-top: calc(72px + var(--safe-area-top, 0px));
`;

const DocContainer = styled.div<{ $zoom: number }>`
	width: max-content;
	margin: 0 auto;
	zoom: ${({ $zoom }) => $zoom};

	/* docx-preview injects gray chrome and dark defaults; the pages
	   are paper and stay paper in every theme. */
	.docx-wrapper {
		background: transparent !important;
		padding: 0 !important;
	}
	.docx-wrapper > section.docx {
		background: #ffffff !important;
		box-shadow: var(--shadow-1) !important;
		margin-bottom: 12px !important;
	}
	/* Words the document colors as near-black; give it the paper ink. */
	.docx-wrapper > section.docx,
	.docx-wrapper > section.docx p {
		color: #211b15 !important;
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
	const [fitZoom, setFitZoom] = useState(1);
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
					.then(() => {
						if (cancelled) return;
						// Pages render at true document width (Letter is
						// 816 CSS px), far wider than a phone. Scale the
						// whole document to the available width.
						const el = scrollRef.current;
						const section = containerRef.current?.querySelector(
							"section.docx",
						) as HTMLElement | null;
						if (el && section && section.offsetWidth > 0) {
							const available = el.clientWidth - 32;
							setFitZoom(
								Math.max(0.3, Math.min(1.5, available / section.offsetWidth)),
							);
						}
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

	// Refit on rotation / resize.
	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		const ro = new ResizeObserver(() => {
			const section = containerRef.current?.querySelector(
				"section.docx",
			) as HTMLElement | null;
			if (!section || section.offsetWidth === 0) return;
			const available = el.clientWidth - 32;
			setFitZoom(Math.max(0.3, Math.min(1.5, available / section.offsetWidth)));
		});
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

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
				<DocContainer ref={containerRef} $zoom={fitZoom}>
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

const PanelNote = styled.p`
	color: var(--ink-2);
	font-size: 0.9375rem;
	padding: 8px;
`;
