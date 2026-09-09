import { BrandMark } from "@/components/BrandMark";
import { type FileFormat, FormatBadge } from "@/components/FormatBadge";
import { InkProgress } from "@/components/ui";
import { radius, space, type } from "@/theme";
import { useEffect, useState } from "react";
import styled from "styled-components";

/**
 * The document-opening screen (docs/04: chrome never waits for
 * content — and content that takes time gets a real page, not a
 * blank void). Used for the byte-read phase in the viewer dispatcher
 * and the parse phases of the PDF and DOCX viewers, with real
 * progress whenever the loader under the hood reports one.
 *
 * Fast local files parse in under ~150ms; showing a loader for them
 * reads as a flash. So the stage holds off for SHOW_DELAY_MS and
 * only appears if work is still ongoing — unless real progress has
 * already been reported, which means a genuinely slow read is
 * underway and the page shows instantly.
 */

const SHOW_DELAY_MS = 150;

const Stage = styled.div<{ $elevated: boolean }>`
	position: fixed;
	inset: 0;
	background: var(--bg);
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: ${space[5]};
	padding: ${space[6]};
	text-align: center;
	/* Above page content, below the viewer toolbar (20) so Back
	   stays reachable, and far below sheets (1100) and dialogs. */
	/* Standalone mode rises above the previous screen's FAB (500) and
	   coach bubble (900) but stays below Sheets (1100) and Dialogs
	   (1200) so failure recovery always lands on top. */
	z-index: ${({ $elevated }) => ($elevated ? 950 : 10)};
	/* No entrance animation: a loading page must be visible the
	   instant it mounts — an opacity-0 start freezes invisible when
	   the Android WebView pauses CSS animations around the native
	   picker (the "screen appears only after a theme change" bug). */
`;

const MarkWrap = styled.div`
	border-radius: ${radius.xl};
	filter: drop-shadow(0 14px 26px rgba(20, 12, 4, 0.26));
	animation: pw-wren-float 2.6s ease-in-out infinite alternate;
	@keyframes pw-wren-float {
		from {
			transform: translateY(-3px);
		}
		to {
			transform: translateY(3px);
		}
	}
`;

const NameCol = styled.div`
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: ${space[2]};
	min-width: 0;
	max-width: min(420px, 86vw);
`;

const OpeningLabel = styled.span`
	${type.caption};
	color: var(--ink-3);
	text-transform: uppercase;
	letter-spacing: 0.08em;
`;

const FileName = styled.span`
	${type.titleM};
	color: var(--ink-1);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	max-width: 100%;
`;

const ProgressCol = styled.div`
	width: min(260px, 70vw);
	display: flex;
	flex-direction: column;
	gap: ${space[2]};
`;

const ProgressMeta = styled.span`
	${type.small};
	color: var(--ink-3);
	font-variant-numeric: tabular-nums;
`;

/** The document taking shape: one sheet card with two fanned behind,
 * shimmering like the Home empty state's stack. */
const Sheets = styled.div`
	position: relative;
	width: 150px;
	height: 104px;
	margin-top: ${space[2]};
`;

const Sheet = styled.div<{ $color: string; $rot: string; $op?: number }>`
	position: absolute;
	left: 33px;
	top: 8px;
	width: 84px;
	height: 88px;
	border-radius: ${radius.m};
	background: ${({ $color }) => $color};
	opacity: ${({ $op }) => $op ?? 1};
	transform: rotate(${({ $rot }) => $rot});
	overflow: hidden;

	&::after {
		content: "";
		position: absolute;
		inset: 0;
		transform: translateX(-100%);
		background: linear-gradient(
			90deg,
			transparent,
			color-mix(in srgb, var(--accent) 10%, transparent),
			transparent
		);
		animation: pw-opening-shimmer 1.6s ease infinite;
	}
	@keyframes pw-opening-shimmer {
		to {
			transform: translateX(100%);
		}
	}
`;

export function OpeningScreen({
	name,
	format,
	progress,
	elevated = false,
	delay = true,
}: {
	name: string;
	format: FileFormat;
	/** Fraction when the loader reports one; null while indeterminate. */
	progress: number | null;
	/** Standalone mode (before the viewer shell mounts): raised above
	 * the previous screen's floating chrome so nothing pokes through. */
	elevated?: boolean;
	/** False skips the anti-flash hold — for mounts that ARE the
	 * immediate feedback (e.g. the lazy-viewer Suspense fallback). */
	delay?: boolean;
}) {
	const [pastDelay, setPastDelay] = useState(false);
	useEffect(() => {
		if (!delay) {
			setPastDelay(true);
			return;
		}
		const t = window.setTimeout(() => setPastDelay(true), SHOW_DELAY_MS);
		return () => window.clearTimeout(t);
	}, [delay]);
	// A slow read already in progress skips the hold: the page is
	// there to explain real waiting, never to flash on fast opens.
	const slowUnderway = progress !== null && progress > 0.2;
	if (!pastDelay && !slowUnderway) {
		return null;
	}
	return (
		<Stage
			data-testid="opening-screen"
			aria-live="polite"
			aria-busy="true"
			$elevated={elevated}
		>
			<MarkWrap>
				<BrandMark size={104} title="" />
			</MarkWrap>
			<NameCol>
				<FormatBadge format={format} size={44} />
				<OpeningLabel>Opening</OpeningLabel>
				<FileName>{name}</FileName>
			</NameCol>
			<ProgressCol>
				<InkProgress progress={progress} />
				<ProgressMeta>
					{progress !== null && progress > 0
						? `${Math.min(99, Math.round(progress * 100))}%`
						: "Preparing…"}
				</ProgressMeta>
			</ProgressCol>
			<Sheets aria-hidden="true">
				<Sheet $color="var(--surface-3)" $rot="-10deg" $op={0.7} />
				<Sheet $color="var(--surface-2)" $rot="-2deg" $op={0.85} />
				<Sheet $color="var(--surface)" $rot="7deg" />
			</Sheets>
		</Stage>
	);
}
