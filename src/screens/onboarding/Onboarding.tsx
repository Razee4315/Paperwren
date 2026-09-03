import { Button, IconButton } from "@/components/ui";
import { motion, radius, space, type } from "@/theme";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import styled from "styled-components";

/**
 * SCR-02..04 Onboarding (docs/06): welcome brand moment, then three
 * value slides. Skippable in one tap, 20 seconds end to end,
 * requests nothing. All copy from the doc 06 deck, adjusted to the
 * project writing rules: no em dashes.
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

	&:hover {
		color: var(--ink-1);
		background: var(--surface-2);
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
	width: 180px;
	height: 180px;
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

const StyledGhost = styled.button`
	background: none;
	border: none;
	width: 100%;
	${type.bodyStrong};
	color: var(--ink-2);
	padding: 14px;
	border-radius: ${radius.m};
	cursor: pointer;

	&:hover {
		color: var(--ink-1);
		background: var(--surface-2);
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
	transition: width ${motion.dur.fast} ${motion.ease.standard};
`;

/** Illustrations: line-art in the icon language, one format color
 * each (docs/03 section 4). Kept as simple inline SVG. */
function FormatsArt() {
	return (
		<svg
			width="150"
			height="150"
			viewBox="0 0 150 150"
			fill="none"
			aria-hidden="true"
		>
			<rect
				x="30"
				y="40"
				width="34"
				height="44"
				rx="6"
				fill="var(--fmt-xlsx)"
				opacity="0.85"
				transform="rotate(-10 47 62)"
			/>
			<rect
				x="58"
				y="34"
				width="34"
				height="44"
				rx="6"
				fill="var(--fmt-docx)"
				opacity="0.85"
			/>
			<g transform="rotate(10 95 56)">
				<rect
					x="88"
					y="30"
					width="34"
					height="44"
					rx="6"
					fill="var(--fmt-pdf)"
				/>
				<path
					d="M108 30 L114 36 L120 30"
					fill="var(--fmt-pptx)"
					opacity="0.001"
				/>
			</g>
			<path
				d="M30 108 C55 96 95 96 120 108"
				stroke="var(--ink-2)"
				strokeWidth="2"
				strokeLinecap="round"
			/>
			<path
				d="M45 120 C65 111 85 111 105 120"
				stroke="var(--ink-2)"
				strokeWidth="2"
				strokeLinecap="round"
				opacity="0.5"
			/>
		</svg>
	);
}

function PrivacyArt() {
	return (
		<svg
			width="150"
			height="150"
			viewBox="0 0 150 150"
			fill="none"
			aria-hidden="true"
		>
			<path
				d="M75 30 L110 42 V78 C110 98 95 112 75 120 C55 112 40 98 40 78 V42 Z"
				stroke="var(--ink-1)"
				strokeWidth="2.5"
				strokeLinejoin="round"
			/>
			<rect
				x="60"
				y="58"
				width="30"
				height="40"
				rx="4"
				fill="var(--fmt-pdf)"
				opacity="0.9"
			/>
			<line
				x1="35"
				y1="30"
				x2="115"
				y2="122"
				stroke="var(--danger)"
				strokeWidth="2.5"
				strokeLinecap="round"
				opacity="0"
			/>
		</svg>
	);
}

function FeatherArt() {
	return (
		<svg
			width="150"
			height="150"
			viewBox="0 0 150 150"
			fill="none"
			aria-hidden="true"
		>
			<rect
				x="45"
				y="40"
				width="60"
				height="76"
				rx="8"
				stroke="var(--ink-1)"
				strokeWidth="2.5"
			/>
			<path
				d="M88 96 C104 84 110 62 102 46 C86 50 74 64 72 82 C71.5 87 74 92 79 93 C83 94 86 95 88 96 Z"
				fill="var(--fmt-pdf)"
				opacity="0.9"
			/>
			<path
				d="M102 46 C92 62 84 76 78 92"
				stroke="#FFF6F1"
				strokeWidth="1.5"
				strokeLinecap="round"
				opacity="0.7"
			/>
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
					<Illustration aria-hidden="true">
						<svg
							width="150"
							height="150"
							viewBox="0 0 150 150"
							fill="none"
							role="img"
							aria-hidden="true"
						>
							<title>Fanned document sheets with a small wren</title>
							<rect
								x="38"
								y="36"
								width="30"
								height="40"
								rx="6"
								fill="var(--fmt-xlsx)"
								opacity="0.85"
								transform="rotate(-12 53 56)"
							/>
							<rect
								x="60"
								y="32"
								width="30"
								height="40"
								rx="6"
								fill="var(--fmt-docx)"
								opacity="0.85"
							/>
							<g transform="rotate(12 105 52)">
								<rect
									x="88"
									y="30"
									width="30"
									height="40"
									rx="6"
									fill="var(--fmt-pdf)"
								/>
								<path d="M98 30 L103 35 L108 30" fill="var(--accent-tint)" />
							</g>
							{/* the wren: a small round bird with an ember breast,
							    perched on the top sheet */}
							<path
								d="M112 100 C110 94 114 89 120 89 C126 89 130 93 130 98 L130 106 L114 106 C112.5 104 112.5 102 112 100 Z"
								fill="var(--ink-1)"
							/>
							<path
								d="M114 106 C115 100 120 97 126 99 C128 100 129.5 103 129 106 Z"
								fill="var(--fmt-pdf)"
							/>
							<circle cx="126.5" cy="94.5" r="1.1" fill="var(--bg)" />
							<path
								d="M130 95 L133.5 96 L130 97.5"
								stroke="var(--bg)"
								strokeWidth="1"
								strokeLinecap="round"
								fill="none"
							/>
							<line
								x1="118"
								y1="106"
								x2="118"
								y2="108.5"
								stroke="var(--ink-1)"
								strokeWidth="1.5"
								strokeLinecap="round"
							/>
							<line
								x1="126"
								y1="106"
								x2="126"
								y2="108.5"
								stroke="var(--ink-1)"
								strokeWidth="1.5"
								strokeLinecap="round"
							/>
						</svg>
					</Illustration>
					<Wordmark>
						Paper<span>wren</span>
					</Wordmark>
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
			<Body key={slide}>
				<Illustration>{current.art}</Illustration>
				<Headline>{current.headline}</Headline>
				<Sub>{current.body}</Sub>
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
