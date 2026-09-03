import { IconButton, InkProgress } from "@/components/ui";
import { CoachBubble } from "@/state/coachMarks";
import { motion, space, type as typeScale } from "@/theme";
import { ArrowLeft } from "lucide-react";
import type React from "react";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import styled from "styled-components";

/**
 * Shared viewer chrome (docs/05 section 4, docs/07 section 1):
 * toolbar up top, format-specific bottom bar, tap-center toggle,
 * auto-hide after 2.5s while reading, ink-underline progress.
 */

const Shell = styled.div`
	position: fixed;
	inset: 0;
	background: var(--bg);
	display: flex;
	flex-direction: column;
	z-index: 10;
`;

const TopBar = styled.header<{ $visible: boolean }>`
	position: absolute;
	top: 0;
	left: 0;
	right: 0;
	z-index: 20;
	background: color-mix(in srgb, var(--surface) 92%, transparent);
	backdrop-filter: blur(8px);
	border-bottom: 1px solid var(--border);
	padding-top: var(--safe-area-top, 0px);
	transform: translateY(${({ $visible }) => ($visible ? "0" : "-101%")});
	transition: transform ${motion.dur.fast} ${motion.ease.enter};
`;

const TopRow = styled.div`
	display: flex;
	align-items: center;
	gap: ${space[1]};
	height: 56px;
	padding: 0 ${space[2]};
	min-width: 0;
`;

const FileName = styled.span`
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	${typeScale.titleS};
	color: var(--ink-1);
`;

const Dot = styled.span<{ $color: string }>`
	width: 8px;
	height: 8px;
	border-radius: 999px;
	background: ${({ $color }) => $color};
	flex-shrink: 0;
	margin-right: ${space[2]};
`;

const ProgressSlot = styled.div`
	position: absolute;
	left: 0;
	right: 0;
	bottom: -3px;
`;

const BottomBar = styled.footer<{ $visible: boolean }>`
	position: absolute;
	bottom: 0;
	left: 0;
	right: 0;
	z-index: 20;
	background: color-mix(in srgb, var(--surface) 92%, transparent);
	backdrop-filter: blur(8px);
	border-top: 1px solid var(--border);
	padding-bottom: var(--safe-area-bottom, 0px);
	transform: translateY(${({ $visible }) => ($visible ? "0" : "101%")});
	transition: transform ${motion.dur.fast} ${motion.ease.enter};
`;

const Content = styled.div`
	position: absolute;
	inset: 0;
`;

interface ChromeApi {
	showChrome: () => void;
	scheduleHide: () => void;
	chromeVisible: boolean;
}

const ChromeContext = createContext<ChromeApi>({
	showChrome: () => {},
	scheduleHide: () => {},
	chromeVisible: true,
});

export function useViewerChrome(): ChromeApi {
	return useContext(ChromeContext);
}

export function ViewerShell({
	name,
	formatColor,
	progress,
	topActions,
	bottomBar,
	children,
	onClose,
	chromeAutohide,
}: {
	name: string;
	formatColor: string;
	progress: number | null;
	topActions?: React.ReactNode;
	bottomBar?: React.ReactNode;
	children: React.ReactNode;
	onClose: () => void;
	chromeAutohide: boolean;
}) {
	const [chromeVisible, setChromeVisible] = useState(true);
	const hideTimer = useRef<number | null>(null);
	const [bottomNode, setBottomNode] = useState<HTMLElement | null>(null);

	// Keep --bottom-bar-height truthful for format viewers that
	// offset their content (0 when there is no bottom bar).
	useEffect(() => {
		document.documentElement.style.setProperty(
			"--bottom-bar-height",
			bottomNode ? `${bottomNode.offsetHeight}px` : "0px",
		);
		return () => {
			document.documentElement.style.setProperty("--bottom-bar-height", "0px");
		};
	}, [bottomNode]);

	const showChrome = useCallback(() => setChromeVisible(true), []);

	const scheduleHide = useCallback(() => {
		if (!chromeAutohide) return;
		if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
		hideTimer.current = window.setTimeout(() => setChromeVisible(false), 2500);
	}, [chromeAutohide]);

	useEffect(() => {
		scheduleHide();
		// Any scroll (capture catches inner containers) keeps the
		// chrome alive a little longer while reading.
		const onScrollCapture = () => {
			if (chromeVisible) scheduleHide();
		};
		window.addEventListener("scroll", onScrollCapture, true);
		return () => {
			if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
			window.removeEventListener("scroll", onScrollCapture, true);
		};
	}, [scheduleHide, chromeVisible]);

	const onContentClick = useCallback((e: React.MouseEvent) => {
		// Interactive elements and text selection own their taps.
		const target = e.target as HTMLElement;
		if (target.closest("a, button, input, textarea, select, [role=slider]")) {
			return;
		}
		const selection = window.getSelection();
		if (selection && selection.toString().length > 0) return;
		setChromeVisible((v) => !v);
	}, []);

	const chromeApi: ChromeApi = { showChrome, scheduleHide, chromeVisible };

	return (
		<ChromeContext.Provider value={chromeApi}>
			<Shell data-testid="viewer">
				<TopBar $visible={chromeVisible}>
					<TopRow>
						<IconButton
							label="Back"
							onClick={onClose}
							data-testid="viewer-back"
						>
							<ArrowLeft size={22} />
						</IconButton>
						<FileName>{name}</FileName>
						<Dot $color={formatColor} aria-hidden="true" />
						{topActions}
					</TopRow>
					{progress !== null && (
						<ProgressSlot>
							<InkProgress progress={progress} />
						</ProgressSlot>
					)}
				</TopBar>

				<Content onClick={onContentClick}>{children}</Content>

				<CoachBubble
					id="viewerChrome"
					position={{ bottom: "40%" }}
					text="Tap the middle of the page to hide the buttons while you read."
				/>

				{bottomBar && (
					<BottomBar $visible={chromeVisible} ref={setBottomNode}>
						{bottomBar}
					</BottomBar>
				)}
			</Shell>
		</ChromeContext.Provider>
	);
}
