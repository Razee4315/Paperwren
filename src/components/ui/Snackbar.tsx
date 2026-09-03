import { motion, radius, type } from "@/theme";
import { useEffect, useState } from "react";
import { createGlobalStyle, styled } from "styled-components";

/** Snackbar (docs/02 section 6): ink-1 background, bg text,
 * optional action, 4s duration. One at a time, managed by the
 * SnackbarProvider. */

const SnackbarGlobal = createGlobalStyle`
  @keyframes pw-snackbar-in {
    from { opacity: 0; transform: translateY(12px); }
  }
`;

const Bar = styled.div`
	position: fixed;
	left: 16px;
	right: 16px;
	bottom: calc(16px + var(--safe-area-bottom, 0px));
	z-index: 1500;
	background: var(--ink-1);
	color: var(--bg);
	border-radius: ${radius.m};
	padding: 14px 16px;
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 16px;
	box-shadow: var(--shadow-3);
	animation: pw-snackbar-in ${motion.dur.fast} ${motion.ease.enter};
	max-width: 520px;
	margin: 0 auto;
`;

const Message = styled.span`
	${type.small};
	color: var(--bg);
	flex: 1;
`;

const Action = styled.button`
	background: none;
	border: none;
	color: var(--accent);
	${type.bodyStrong};
	cursor: pointer;
	padding: 4px 8px;
	border-radius: ${radius.s};

	&:hover {
		background: rgba(255, 255, 255, 0.08);
	}
`;

export interface SnackbarState {
	message: string;
	actionLabel?: string;
	onAction?: () => void;
}

let showSnackbarImpl: ((state: SnackbarState) => void) | null = null;

/** Imperative API usable from anywhere: showSnackbar({ message }). */
export function showSnackbar(state: SnackbarState) {
	showSnackbarImpl?.(state);
}

export function SnackbarProvider({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<>
			<SnackbarGlobal />
			{children}
			<SnackbarHost
				onRegister={(impl) => {
					showSnackbarImpl = impl;
				}}
			/>
		</>
	);
}

function SnackbarHost({
	onRegister,
}: {
	onRegister: (impl: (state: SnackbarState) => void) => void;
}) {
	const [state, setState] = useState<SnackbarState | null>(null);

	useEffect(() => {
		onRegister(setState);
		return () => {
			showSnackbarImpl = null;
		};
	}, [onRegister]);

	useEffect(() => {
		if (!state) return;
		const t = window.setTimeout(() => setState(null), 4000);
		return () => window.clearTimeout(t);
	}, [state]);

	if (!state) return null;

	return (
		// biome-ignore lint/a11y/useSemanticElements: a transient toast is announced as a status region
		<Bar role="status">
			<Message>{state.message}</Message>
			{state.actionLabel && state.onAction && (
				<Action
					onClick={() => {
						state.onAction?.();
						setState(null);
					}}
				>
					{state.actionLabel}
				</Action>
			)}
		</Bar>
	);
}
