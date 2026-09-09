import { BrandMark } from "@/components/BrandMark";
import { Button, IconButton } from "@/components/ui";
import { font, motion, radius, space, type } from "@/theme";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRef, useState } from "react";
import styled from "styled-components";

/**
 * SCR-02..04 Onboarding (docs/06): a welcome brand moment, then
 * three value slides. Skippable in one tap, 20 seconds end to end.
 * The hero is the real launcher tile (BrandMark), each slide gets a
 * tinted stage for its line art, and slides respond to horizontal
 * swipes as well as the buttons. Idle motion and entrances respect
 * reduced-motion via the global rule.
 */

const Container = styled.div`
	position: fixed;
	inset: 0;
	display: flex;
	flex-direction: column;
	overflow: hidden;
	background:
		radial-gradient(
			130% 70% at 50% -14%,
			var(--stage-glow, var(--accent-tint)) 0%,
			transparent 56%
		),
		var(--bg);
`;

const SkipRow = styled.div`
	display: flex;
	justify-content: flex-end;
	padding: calc(12px + var(--safe-area-top, 0px)) 12px 0 12px;
`;

const SkipButton = styled.button`
	background: none;
	border: none;
	${type.bodyStrong};
	color: var(--ink-3);
	padding: 12px 16px;
	border-radius: ${radius.m};
	cursor: pointer;
	transition: color ${motion.dur.instant} ${motion.ease.standard},
		background-color ${motion.dur.instant} ${motion.ease.standard};

	&:hover {
		color: var(--ink-1);
		background: var(--surface-2);
	}
	&:active {
		transform: scale(0.96);
	}
`;

const Body = styled.div`
	flex: 1;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: ${space[5]};
	padding: 0 ${space[6]};
	text-align: center;
	overflow-y: auto;
	touch-action: pan-y;
`;

/* ---------- Welcome: the brand moment ---------- */

const HeroTile = styled.div`
	filter: drop-shadow(0 22px 36px rgba(20, 12, 4, 0.3));
	border-radius: ${radius.xl};
	animation: pw-hero-in ${motion.dur.settle} ${motion.ease.enter} both;
	@keyframes pw-hero-in {
		from {
			opacity: 0;
			transform: translateY(14px) scale(0.9);
		}
	}
`;

const Wordmark = styled.h1`
	font-family: var(--font-display);
	font-size: clamp(2.25rem, 9vw, 2.75rem);
	font-weight: 600;
	letter-spacing: -0.015em;
	color: var(--ink-1);
	animation: pw-rise ${motion.dur.expressive} ${motion.ease.enter} 100ms both;
	@keyframes pw-rise {
		from {
			opacity: 0;
			transform: translateY(12px);
		}
	}

	span {
		color: var(--accent);
	}
`;

const Tagline = styled.p`
	${type.bodyStrong};
	color: var(--ink-2);
	animation: pw-rise ${motion.dur.expressive} ${motion.ease.enter} 180ms both;
`;

const FormatRow = styled.p`
	${type.caption};
	color: var(--ink-3);
	letter-spacing: 0.14em;
	text-transform: uppercase;
	animation: pw-rise ${motion.dur.expressive} ${motion.ease.enter} 260ms both;
`;

/* ---------- Value slides ---------- */

const Stage = styled.div<{ $glow: string }>`
	--stage-glow: ${({ $glow }) => $glow};
	position: relative;
	width: 264px;
	height: 264px;
	display: flex;
	align-items: center;
	justify-content: center;
	border-radius: ${radius.full};
	animation: pw-art-in ${motion.dur.expressive} ${motion.ease.enter} both;
	@keyframes pw-art-in {
		from {
			opacity: 0;
			transform: translateY(16px) scale(0.96);
		}
	}
`;

const Headline = styled.h1`
	${type.display};
	font-size: clamp(1.75rem, 6.5vw, 2.05rem);
	color: var(--ink-1);
	max-width: 420px;
	animation: pw-text-in ${motion.dur.expressive} ${motion.ease.enter} 70ms both;
	@keyframes pw-text-in {
		from {
			opacity: 0;
			transform: translateY(10px);
		}
	}
`;

const Sub = styled.p`
	${type.body};
	color: var(--ink-2);
	max-width: 400px;
	animation: pw-text-in ${motion.dur.expressive} ${motion.ease.enter} 140ms both;
`;

const Footer = styled.div`
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: ${space[4]};
	padding: ${space[4]} ${space[6]} calc(${space[6]} + var(--safe-area-bottom, 0px));
`;

const WelcomeFooter = styled(Footer)`
	flex-direction: column;
	align-items: stretch;
	gap: ${space[2]};
	animation: pw-text-in ${motion.dur.expressive} ${motion.ease.enter} 240ms both;
`;

const Dots = styled.div`
	display: flex;
	gap: 8px;
	align-items: center;
`;

const Dot = styled.span<{ $active: boolean }>`
	height: 8px;
	border-radius: ${radius.full};
	background: ${({ $active }) => ($active ? "var(--accent)" : "var(--surface-3)")};
	width: ${({ $active }) => ($active ? "16px" : "8px")};
	transition:
		width ${motion.dur.fast} ${motion.ease.standard},
		background-color ${motion.dur.fast} ${motion.ease.standard};
`;

/* ---------- Illustration language (docs/03 section 4):
   line art, one format color each, one idle motion ---------- */

const FloatWrap = styled.g`
	animation: pw-float 4s ${motion.ease.standard} infinite alternate;
	transform-origin: center;
	@keyframes pw-float {
		from {
			transform: translateY(-3px);
		}
		to {
			transform: translateY(3px);
		}
	}
`;

function FoldedSheet({
	x,
	y,
	w,
	h,
	color,
	rotate = 0,
	opacity = 1,
}: {
	x: number;
	y: number;
	w: number;
	h: number;
	color: string;
	rotate?: number;
	opacity?: number;
}) {
	const fold = Math.min(w, h) * 0.22;
	return (
		<g
			transform={`rotate(${rotate} ${x + w / 2} ${y + h / 2})`}
			opacity={opacity}
		>
			<path
				d={`M${x} ${y + 8} Q${x} ${y} ${x + 8} ${y} H${x + w - fold} L${x + w} ${y + fold} V${y + h - 8} Q${x + w} ${y + h} ${x + w - 8} ${y + h} H${x + 8} Q${x} ${y + h} ${x} ${y + h - 8} Z`}
				fill={color}
			/>
			<path
				d={`M${x + w - fold} ${y} V${y + fold - 4} Q${x + w - fold} ${y + fold} ${x + w - fold + 4} ${y + fold} H${x + w}`}
				fill="rgba(250, 247, 242, 0.85)"
			/>
		</g>
	);
}

/** The little wren that ends the tour — tail left, round body,
 * lifted head with a sharp beak, ember breast. */
function LineWren({
	x = 0,
	y = 0,
	scale = 1,
}: { x?: number; y?: number; scale?: number }) {
	return (
		<g transform={`translate(${x} ${y}) scale(${scale})`}>
			<path
				d="M104 106 C104 99 110 94 119 94 C127 94 133 99 134 105 C134.6 108 134 110.6 133 112 L110 112 C106.5 110.5 104 108.5 104 106 Z"
				fill="var(--ink-1)"
			/>
			<path
				d="M105 105 L96 100 M105 108 L95 105"
				stroke="var(--ink-1)"
				strokeWidth="2"
				strokeLinecap="round"
			/>
			<circle cx="128" cy="100" r="1.4" fill="var(--bg)" />
			<path d="M133.4 100 L138.5 101.4 L133.4 102.8 Z" fill="var(--accent)" />
			<path
				d="M117 112 C117.5 105.5 123 102 129.5 104.5 C132.6 105.8 133.8 108.8 133.4 112 Z"
				fill="var(--accent)"
			/>
			<line
				x1="118"
				y1="112"
				x2="118"
				y2="115"
				stroke="var(--ink-1)"
				strokeWidth="1.6"
				strokeLinecap="round"
			/>
			<line
				x1="128"
				y1="112"
				x2="128"
				y2="115"
				stroke="var(--ink-1)"
				strokeWidth="1.6"
				strokeLinecap="round"
			/>
		</g>
	);
}

function FormatsArt() {
	return (
		<svg width="220" height="220" viewBox="0 0 180 180" fill="none" role="img">
			<title>Four document sheets fanned out of a folder</title>
			<FloatWrap>
				<FolderOutline />
				<FoldedSheet
					x={30}
					y={52}
					w={38}
					h={50}
					color="var(--fmt-xlsx)"
					rotate={-14}
					opacity={0.92}
				/>
				<FoldedSheet
					x={62}
					y={44}
					w={38}
					h={50}
					color="var(--fmt-docx)"
					rotate={-5}
					opacity={0.92}
				/>
				<FoldedSheet
					x={96}
					y={40}
					w={38}
					h={50}
					color="var(--fmt-pdf)"
					rotate={6}
				/>
				{/* the wren, perched on the front sheet */}
				<LineWren x={14} y={-72} />
			</FloatWrap>
		</svg>
	);
}

function FolderOutline() {
	return (
		<g
			stroke="var(--ink-2)"
			strokeWidth="2.5"
			strokeLinecap="round"
			strokeLinejoin="round"
			fill="none"
		>
			<path d="M28 66 L28 52 Q28 46 34 46 L58 46 L66 56 L118 56 Q124 56 124 62" />
			<path d="M24 74 Q24 68 30 68 L128 68 Q136 68 134 76 L126 118 Q125 124 118 124 L34 124 Q28 124 27 118 Z" />
		</g>
	);
}

function PrivacyArt() {
	return (
		<svg width="220" height="220" viewBox="0 0 180 180" fill="none" role="img">
			<title>A document behind a shield</title>
			<FloatWrap>
				{/* the sheet */}
				<g transform="rotate(-6 90 92)">
					<rect
						x="64"
						y="50"
						width="52"
						height="70"
						rx="8"
						fill="var(--fmt-pdf)"
						opacity="0.92"
					/>
					<g
						stroke="rgba(250, 247, 242, 0.75)"
						strokeWidth="3"
						strokeLinecap="round"
					>
						<line x1="74" y1="68" x2="106" y2="68" />
						<line x1="74" y1="80" x2="106" y2="80" />
						<line x1="74" y1="92" x2="94" y2="92" />
					</g>
				</g>
				{/* the shield, drawn last so it reads in front */}
				<path
					d="M90 44 L126 56 V92 C126 114 112 130 90 138 C68 130 54 114 54 92 V56 Z"
					fill="var(--surface)"
					stroke="var(--ink-1)"
					strokeWidth="3"
					strokeLinejoin="round"
				/>
				<path
					d="M76 90 L87 101 L106 78"
					stroke="var(--accent)"
					strokeWidth="4"
					strokeLinecap="round"
					strokeLinejoin="round"
					fill="none"
				/>
			</FloatWrap>
		</svg>
	);
}

function FeatherArt() {
	return (
		<svg width="220" height="220" viewBox="0 0 180 180" fill="none" role="img">
			<title>A feather resting on a document</title>
			<FloatWrap>
				{/* the sheet */}
				<g transform="rotate(-3 90 110)">
					<rect
						x="46"
						y="70"
						width="88"
						height="72"
						rx="8"
						fill="var(--surface)"
						stroke="var(--ink-1)"
						strokeWidth="2.5"
					/>
					<g
						stroke="var(--ink-2)"
						strokeWidth="2"
						strokeLinecap="round"
						opacity="0.6"
					>
						<line x1="58" y1="88" x2="96" y2="88" />
						<line x1="58" y1="100" x2="110" y2="100" />
						<line x1="58" y1="112" x2="88" y2="112" />
					</g>
				</g>
				{/* the feather: curved spine with a soft vane */}
				<g>
					<path
						d="M132 34 C112 44 92 66 82 92 C76 108 72 122 70 136 C82 128 96 114 108 96 C120 78 130 54 132 34 Z"
						fill="var(--fmt-pdf)"
						stroke="var(--ink-1)"
						strokeWidth="2.5"
						strokeLinejoin="round"
					/>
					<path
						d="M130 40 C114 54 94 82 76 128"
						stroke="#FAF7F2"
						strokeWidth="2"
						strokeLinecap="round"
						opacity="0.8"
						fill="none"
					/>
					{/* barb notches */}
					<g
						stroke="var(--ink-1)"
						strokeWidth="1.6"
						strokeLinecap="round"
						opacity="0.45"
					>
						<line x1="122" y1="56" x2="132" y2="60" />
						<line x1="112" y1="72" x2="124" y2="74" />
						<line x1="100" y1="90" x2="112" y2="90" />
						<line x1="90" y1="106" x2="101" y2="104" />
					</g>
				</g>
			</FloatWrap>
		</svg>
	);
}

const SLIDES = [
	{
		headline: "Every document, one app",
		body: "PDF, Word, Excel, and PowerPoint. Tap a file and it just opens. No accounts, no converters, no waiting.",
		art: <FormatsArt />,
		glow: "var(--fmt-docx-container)",
	},
	{
		headline: "Private by design",
		body: "Paperwren asks for zero permissions and collects zero data. Your files never leave your phone. The app does not even have internet access.",
		art: <PrivacyArt />,
		glow: "var(--fmt-xlsx-container)",
	},
	{
		headline: "Feather-light",
		body: "Small, quick to start, and comfortable on modest phones. That is the whole point.",
		art: <FeatherArt />,
		glow: "var(--fmt-pdf-container)",
	},
];

const SWIPE_THRESHOLD = 48;

export function Onboarding({
	onFinish,
	onOpenPicker,
}: {
	onFinish: () => void;
	onOpenPicker: () => void;
}) {
	const [slide, setSlide] = useState(-1); // -1 = welcome screen
	const isWelcome = slide === -1;
	const touchStart = useRef<{ x: number; y: number } | null>(null);

	const skip = () => onFinish();

	const next = () => {
		if (slide >= SLIDES.length - 1) {
			onFinish();
		} else {
			setSlide((s) => s + 1);
		}
	};

	const back = () => setSlide((s) => Math.max(-1, s - 1));

	// Horizontal swipes move between slides; mostly-vertical scrolls
	// stay untouched so the body keeps its own scrolling.
	const onTouchStart = (e: React.TouchEvent) => {
		const t = e.touches[0];
		touchStart.current = { x: t.clientX, y: t.clientY };
	};
	const onTouchEnd = (e: React.TouchEvent) => {
		const start = touchStart.current;
		touchStart.current = null;
		if (!start || isWelcome) return;
		const t = e.changedTouches[0];
		const dx = t.clientX - start.x;
		const dy = t.clientY - start.y;
		if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) < Math.abs(dy) * 1.4) {
			return;
		}
		if (dx < 0) {
			next();
		} else {
			back();
		}
	};

	if (isWelcome) {
		return (
			<Container data-testid="welcome">
				<SkipRow>
					<SkipButton onClick={skip}>Skip</SkipButton>
				</SkipRow>
				<Body onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
					<HeroTile>
						<BrandMark size={112} title="" />
					</HeroTile>
					<Wordmark>
						Paper<span>wren</span>
					</Wordmark>
					<Tagline>Open anything. Instantly.</Tagline>
					<FormatRow>PDF · Word · Excel · Slides</FormatRow>
				</Body>
				<WelcomeFooter>
					<Button
						variant="filled"
						fullWidth
						onClick={() => {
							onFinish();
							onOpenPicker();
						}}
						data-testid="welcome-open"
					>
						Open a file
					</Button>
					<StyledGhost onClick={() => setSlide(0)}>
						See what Paperwren does
					</StyledGhost>
				</WelcomeFooter>
			</Container>
		);
	}

	const current = SLIDES[slide];
	const isFirst = slide === 0;
	const isLast = slide === SLIDES.length - 1;

	return (
		<Container data-testid="onboarding-slide">
			<SkipRow>
				<SkipButton onClick={skip}>Skip</SkipButton>
			</SkipRow>
			<Body onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
				{/* key remounts replay the entrance on every slide change */}
				<Stage key={`art-${slide}`} $glow={current.glow}>
					{current.art}
				</Stage>
				<Headline key={`h-${slide}`}>{current.headline}</Headline>
				<Sub key={`b-${slide}`}>{current.body}</Sub>
			</Body>
			<Footer>
				{!isFirst ? (
					<IconButton label="Back" onClick={back}>
						<ChevronLeft size={24} />
					</IconButton>
				) : (
					<span style={{ width: 48 }} />
				)}
				<Dots>
					{SLIDES.map((_, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: static slide list
						<Dot key={`slide-${i}`} $active={i === slide} />
					))}
				</Dots>
				{!isFirst && !isLast ? (
					<IconButton label="Next" onClick={next}>
						<ChevronRight size={24} />
					</IconButton>
				) : (
					<Button variant={isLast ? "filled" : "tonal"} onClick={next}>
						{isLast ? "Get started" : "Next"}
					</Button>
				)}
			</Footer>
		</Container>
	);
}

const StyledGhost = styled.button`
	background: none;
	border: none;
	width: 100%;
	${type.bodyStrong};
	font-family: ${font.ui};
	color: var(--ink-2);
	padding: 14px;
	border-radius: ${radius.m};
	cursor: pointer;
	transition: color ${motion.dur.instant} ${motion.ease.standard},
		background-color ${motion.dur.instant} ${motion.ease.standard},
		transform ${motion.dur.instant} ${motion.ease.standard};

	&:hover {
		color: var(--ink-1);
		background: var(--surface-2);
	}
	&:active {
		transform: scale(0.97);
	}
`;
