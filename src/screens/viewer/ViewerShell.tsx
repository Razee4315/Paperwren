import { IconButton, InkProgress } from "@/components/ui";
import { useNavigation } from "@/state/NavigationContext";
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
 *
 * Viewport contract (audit section 8): the shell publishes
 * --viewer-top-height and --viewer-bottom-height (safe areas
 * included) so every format viewer can pad its scroll area the
 * same way and no first line/page/row hides behind chrome.
 */

const Shell = styled.div`
	position: fixed;
	inset: 0;
	background: var(--bg);
	display: flex;
	flex-direction: column;
	/* Above in-page chrome like the Home FAB (z 500) but below the
	   shared Sheet (1100) and Dialog (1200): a fullscreen viewer must
	   never have the previous screen's floating buttons poke through
	   its bars (audit XLS-06: bottom-strip taps must reach it). */
	z-index: 600;
	animation: pw-screen-in ${motion.dur.standard} ${motion.ease.enter};
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
	/* Landscape safe areas are owned here, once (audit SH-03). */
	padding-left: calc(${space[2]} + var(--safe-area-left, 0px));
	padding-right: calc(${space[2]} + var(--safe-area-right, 0px));
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
	/* The shell owns the bottom safe-area padding exactly once (audit
	   SH-03): bar content must not add it again. */
	padding-bottom: var(--safe-area-bottom, 0px);
	padding-left: var(--safe-area-left, 0px);
	padding-right: var(--safe-area-right, 0px);
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
	/** Explicit tap-to-toggle for surfaces with a validated tap
	 * policy (PDF read surface via its gesture controller). */
	toggleChrome: () => void;
	chromeVisible: boolean;
	/** Measured shell width, for responsive action rows (audit
	 * SH-01): viewers expose more top actions only when the real
	 * toolbar has room for them. */
	shellWidth: number;
}

const ChromeContext = createContext<ChromeApi>({
	showChrome: () => {},
	scheduleHide: () => {},
	toggleChrome: () => {},
	chromeVisible: true,
	shellWidth: 0,
});

export function useViewerChrome(): ChromeApi {
	return useContext(ChromeContext);
}

/** Measured layout-viewport width. The shell is fixed inset-0, so
 * this equals the shell's own clientWidth; viewers that render the
 * shell (and can therefore never read its context) use it to decide
 * how many actions fit (audit SH-01). */
export function useViewportWidth(): number {
	const [width, setWidth] = useState(0);
	useEffect(() => {
		const measure = () => setWidth(document.documentElement.clientWidth);
		measure();
		window.addEventListener("resize", measure);
		return () => window.removeEventListener("resize", measure);
	}, []);
	return width;
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
	contentTapTogglesChrome = false,
}: {
	name: string;
	formatColor: string;
	progress: number | null;
	topActions?: React.ReactNode;
	bottomBar?: React.ReactNode;
	children: React.ReactNode;
	onClose: () => void;
	chromeAutohide: boolean;
	/** Opt-in (audit SH-02): only a surface with a validated tap
	 * policy toggles chrome from content taps. Spreadsheet and DOCX
	 * chrome stay stable; the PDF read surface opts in (mouse) and
	 * owns touch taps through its gesture controller. */
	contentTapTogglesChrome?: boolean;
}) {
	const [chromeVisible, setChromeVisible] = useState(true);
	const hideTimer = useRef<number | null>(null);
	const [bottomNode, setBottomNode] = useState<HTMLElement | null>(null);
	const shellRef = useRef<HTMLDivElement | null>(null);
	const topRef = useRef<HTMLHeadElement | null>(null);
	const bottomBarRef = useRef<HTMLElement | null>(null);
	const shellWidth = useViewportWidth();
	const { state: navState } = useNavigation();
	const overlaysOpen = navState.overlays.length > 0;

	// Publish the shared viewport inset contract: the real rendered
	// heights of the bars, safe areas included (audit section 8).
	// Viewers without a bottom bar reserve the raw system bottom inset
	// through --viewer-bottom-reserve so content never hides behind
	// the gesture bar (audit SH-03). Re-publishes when bar visibility
	// flips because the bottom slot mounts/unmounts.
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional
	useEffect(() => {
		const publish = () => {
			const shell = shellRef.current;
			if (!shell) return;
			shell.style.setProperty(
				"--viewer-top-height",
				`${topRef.current?.offsetHeight ?? 56}px`,
			);
			shell.style.setProperty(
				"--viewer-bottom-height",
				bottomNode ? `${bottomNode.offsetHeight}px` : "0px",
			);
			shell.style.setProperty(
				"--viewer-bottom-reserve",
				bottomNode ? "0px" : "var(--safe-area-bottom, 0px)",
			);
		};
		publish();
		const ro =
			typeof ResizeObserver !== "undefined"
				? new ResizeObserver(publish)
				: null;
		if (ro && topRef.current) ro.observe(topRef.current);
		if (ro && bottomNode) ro.observe(bottomNode);
		window.addEventListener("resize", publish);
		return () => {
			ro?.disconnect();
			window.removeEventListener("resize", publish);
		};
	}, [bottomNode, chromeVisible, bottomBar]);

	const showChrome = useCallback(() => setChromeVisible(true), []);

	// Whether idle autohide must stay paused (audit SH-02): overlays
	// are open, a load is running, or keyboard focus sits inside the
	// chrome. Hiding under those conditions would trap or strand
	// focus and fight recovery UI.
	const chromeHoldRef = useRef(false);
	const chromeHold =
		overlaysOpen ||
		progress !== null ||
		(typeof document !== "undefined" &&
			document.activeElement instanceof HTMLElement &&
			(document.activeElement.closest("header[data-chrome]") != null ||
				document.activeElement.closest("footer[data-chrome]") != null));
	chromeHoldRef.current = chromeHold;

	const toggleChrome = useCallback(() => {
		if (chromeHoldRef.current) {
			setChromeVisible(true);
			return;
		}
		setChromeVisible((v) => !v);
	}, []);

	const scheduleHide = useCallback(() => {
		if (!chromeAutohide) return;
		if (chromeHoldRef.current) return;
		if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
		hideTimer.current = window.setTimeout(() => {
			if (!chromeHoldRef.current) setChromeVisible(false);
		}, 2500);
	}, [chromeAutohide]);

	// Re-show the chrome whenever a hold becomes active so controls
	// never disappear while overlays or recovery UI are up.
	useEffect(() => {
		if (chromeHold) setChromeVisible(true);
	}, [chromeHold]);

	// Hidden bars must not stay keyboard-focusable or interactive
	// (audit SH-02): `inert` removes them from the tab order in the
	// supported WebViews; the translate animation is cosmetic only.
	useEffect(() => {
		const top = topRef.current;
		const bottom = bottomBarRef.current;
		if (top) top.inert = !chromeVisible;
		if (bottom) bottom.inert = !chromeVisible;
	}, [chromeVisible]);

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

	// Desktop click-to-toggle only (audit SH-02): touch taps belong to
	// the format viewer's gesture policy — a spreadsheet cell tap or a
	// PDF pinch must never hide chrome as a side effect.
	const onContentPointerUp = useCallback(
		(e: React.PointerEvent) => {
			if (!contentTapTogglesChrome) return;
			if (e.pointerType !== "mouse") return;
			const target = e.target as HTMLElement;
			if (target.closest("a, button, input, textarea, select, [role=slider]")) {
				return;
			}
			const selection = window.getSelection();
			if (selection && selection.toString().length > 0) return;
			setChromeVisible((v) => !v);
		},
		[contentTapTogglesChrome],
	);

	const chromeApi: ChromeApi = {
		showChrome,
		scheduleHide,
		toggleChrome,
		chromeVisible,
		shellWidth,
	};

	return (
		<ChromeContext.Provider value={chromeApi}>
			<Shell data-testid="viewer" ref={shellRef}>
				<TopBar $visible={chromeVisible} ref={topRef} data-chrome>
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

				<Content onPointerUp={onContentPointerUp}>{children}</Content>

				{bottomBar && (
					<BottomBar
						$visible={chromeVisible}
						ref={(node) => {
							setBottomNode(node);
							bottomBarRef.current = node;
						}}
						data-chrome
					>
						{bottomBar}
					</BottomBar>
				)}
			</Shell>
		</ChromeContext.Provider>
	);
}
