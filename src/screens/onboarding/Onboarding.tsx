import { Button, IconButton } from "@/components/ui";
import { font, motion, radius, space, type } from "@/theme";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import styled from "styled-components";

/**
 * SCR-02..04 Onboarding (docs/06): welcome brand moment, then three
 * value slides. Skippable in one tap, 20 seconds end to end. All
 * art is inline line-art in the icon language, with gentle idle
 * motion that respects reduced-motion via the global rule.
 */

const Container = styled.div`
	position: fixed;
	inset: 0;
	background: var(--bg);
	display: flex;
	flex-direction: column;
	overflow: hidden;
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
	color: var(--ink-2);
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
	gap: ${space[6]};
	padding: 0 ${space[6]};
	text-align: center;
	overflow-y: auto;
`;

const Illustration = styled.div`
	width: 200px;
	height: 190px;
	display: flex;
	align-items: center;
	justify-content: center;
`;

const Headline = styled.h1`
	${type.display};
	font-size: clamp(1.75rem, 6vw, 2rem);
	color: var(--ink-1);
	max-width: 420px;
`;

const Sub = styled.p`
	${type.body};
	color: var(--ink-2);
	max-width: 400px;
`;

const Wordmark = styled(Headline)`
	span {
		color: var(--accent);
	}
`;

/* Slide content animates in on every slide change (key remount):
   illustration drifts up, text follows. Reduced motion collapses to
   a fast fade through the global rule. */
const SlideIn = styled.div`
	animation: pw-slide-in ${motion.dur.expressive} ${motion.ease.enter};
	@keyframes pw-slide-in {
		from {
			opacity: 0;
			transform: translateY(16px);
		}
	}
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
			transform: translateY(-2px);
		}
		to {
			transform: translateY(2px);
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

function FormatsArt() {
	return (
		<svg width="180" height="180" viewBox="0 0 180 180" fill="none" role="img">
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
					x={94}
					y={42}
					w={38}
					h={50}
					color="var(--fmt-docx)"
					rotate={0}
					opacity={0}
				/>
				<FoldedSheet
					x={96}
					y={40}
					w={38}
					h={50}
					color="var(--fmt-pdf)"
					rotate={6}
				/>
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
		<svg width="180" height="180" viewBox="0 0 180 180" fill="none" role="img">
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
		<svg width="180" height="180" viewBox="0 0 180 180" fill="none" role="img">
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

function WelcomeArt() {
	return (
		<svg width="170" height="160" viewBox="0 0 170 160" fill="none" role="img">
			<title>The fanned stack with a small wren perched on top</title>
			<FloatWrap>
				<FoldedSheet
					x={40}
					y={46}
					w={34}
					h={46}
					color="var(--fmt-xlsx)"
					rotate={-12}
					opacity={0.88}
				/>
				<FoldedSheet
					x={64}
					y={40}
					w={34}
					h={46}
					color="var(--fmt-docx)"
					opacity={0.88}
				/>
				<FoldedSheet
					x={88}
					y={36}
					w={34}
					h={46}
					color="var(--fmt-pdf)"
					rotate={10}
				/>
				{/* the wren: small round bird, ember breast, perched on the stack */}
				<g>
					<path
						d="M112 106 C110 98 116 92 124 92 C132 92 138 97 138 104 L138 112 L116 112 C114 110 112.5 108 112 106 Z"
						fill="var(--ink-1)"
					/>
					<path
						d="M118 112 C119 105 125 101 132 103 C135 104 137 108 136.5 112 Z"
						fill="var(--accent)"
					/>
					<circle cx="133" cy="99" r="1.3" fill="var(--bg)" />
					<path
						d="M138 100 L142 101 L138 102.5"
						stroke="var(--bg)"
						strokeWidth="1.2"
						strokeLinecap="round"
						fill="none"
					/>
					<line
						x1="122"
						y1="112"
						x2="122"
						y2="115"
						stroke="var(--ink-1)"
						strokeWidth="1.6"
						strokeLinecap="round"
					/>
					<line
						x1="132"
						y1="112"
						x2="132"
						y2="115"
						stroke="var(--ink-1)"
						strokeWidth="1.6"
						strokeLinecap="round"
					/>
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
	},
	{
		headline: "Private by design",
		body: "Paperwren asks for zero permissions and collects zero data. Your files never leave your phone. The app does not even have internet access.",
		art: <PrivacyArt />,
	},
	{
		headline: "Feather-light",
		body: "Small, quick to start, and comfortable on modest phones. That is the whole point.",
		art: <FeatherArt />,
	},
];

export function Onboarding({
	onFinish,
	onOpenPicker,
}: {
	onFinish: () => void;
	onOpenPicker: () => void;
}) {
	const [slide, setSlide] = useState(-1); // -1 = welcome screen
	const isWelcome = slide === -1;

	const skip = () => onFinish();

	const next = () => {
		if (slide >= SLIDES.length - 1) {
			onFinish();
		} else {
			setSlide((s) => s + 1);
		}
	};

	if (isWelcome) {
		return (
			<Container data-testid="welcome">
				<SkipRow>
					<SkipButton onClick={skip}>Skip</SkipButton>
				</SkipRow>
				<Body>
					<SlideIn>
						<Illustration>
							<WelcomeArt />
						</Illustration>
					</SlideIn>
					<SlideIn>
						<Wordmark style={{ fontFamily: font.display }}>
							Paper<span>wren</span>
						</Wordmark>
					</SlideIn>
					<Sub>Open anything. Instantly.</Sub>
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
			<Body>
				<SlideIn key={`art-${slide}`}>
					<Illustration>{current.art}</Illustration>
				</SlideIn>
				<SlideIn key={`text-${slide}`}>
					<Headline>{current.headline}</Headline>
					<Sub>{current.body}</Sub>
				</SlideIn>
			</Body>
			<Footer>
				{!isFirst ? (
					<IconButton label="Back" onClick={() => setSlide((s) => s - 1)}>
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
