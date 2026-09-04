import { useOverlayRegistration } from "@/state/NavigationContext";
import { layout, motion, radius, type } from "@/theme";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import styled from "styled-components";

/**
 * Bottom sheet (docs/02 section 6): drag handle, dismiss on
 * drag-down past 96px or scrim tap. Follows the finger 1:1 while
 * dragging, springs back or flies out past the threshold
 * (docs/04 section 3.4).
 */

const Scrim = styled.div<{ $closing: boolean }>`
	position: fixed;
	inset: 0;
	background: var(--scrim);
	z-index: 1100;
	animation: pw-fade ${motion.dur.standard} ${motion.ease.enter};
	@keyframes pw-fade {
		from {
			opacity: 0;
		}
	}
`;

const Panel = styled.div<{ $dragY: number; $animating: boolean }>`
	position: fixed;
	left: 0;
	right: 0;
	bottom: 0;
	z-index: 1101;
	background: var(--surface);
	border-radius: ${radius.xl} ${radius.xl} 0 0;
	box-shadow: var(--shadow-2);
	border-top: 1px solid var(--border);
	max-height: calc(100dvh - 48px);
	max-width: ${layout.contentMaxWidth};
	margin: 0 auto;
	display: flex;
	flex-direction: column;
	padding-bottom: var(--safe-area-bottom, 0px);
	transform: translateY(${({ $dragY }) => $dragY}px);
	transition: ${({ $animating }) =>
		$animating
			? `transform ${motion.dur.standard} ${motion.ease.enter}`
			: "none"};
`;

const Handle = styled.div`
	width: 32px;
	height: 4px;
	border-radius: ${radius.full};
	background: var(--surface-3);
	margin: 12px auto 4px;
	flex-shrink: 0;
`;

const TitleRow = styled.div`
	padding: 8px 20px 4px;
`;

const Title = styled.h2`
	${type.titleM};
	color: var(--ink-1);
`;

const Content = styled.div`
	padding: 8px 20px 20px;
	overflow-y: auto;
	flex: 1;
	min-height: 0;
`;

const DRAG_THRESHOLD = 96;

export function Sheet({
	open,
	title,
	onDismiss,
	children,
	id,
}: {
	open: boolean;
	title: string;
	onDismiss: () => void;
	children: React.ReactNode;
	/** Stack id for system-Back dismissal; omitted on surfaces that
	 * manage their own Back handling. */
	id?: string;
}) {
	const [dragY, setDragY] = useState(0);
	const [dragging, setDragging] = useState(false);
	const [closing, setClosing] = useState(false);
	const startY = useRef<number | null>(null);
	const dismissTimer = useRef<number | null>(null);

	// Register with the shared overlay stack so system Back dismisses
	// the top sheet before touching the screen below it.
	useOverlayRegistration(id ?? "", open && id !== undefined, onDismiss);

	const dismiss = useCallback(() => {
		if (closing) return;
		setClosing(true);
		setDragY(0);
		dismissTimer.current = window.setTimeout(onDismiss, 200);
	}, [onDismiss, closing]);

	useEffect(() => {
		if (!open) return;
		setClosing(false);
		setDragY(0);
	}, [open]);

	// Cancel the delayed dismiss if we unmount mid-animation, and
	// never fire a dismiss after the sheet is gone.
	useEffect(
		() => () => {
			if (dismissTimer.current !== null) {
				window.clearTimeout(dismissTimer.current);
			}
		},
		[],
	);

	// Escape dismisses like a dialog; focus starts inside and returns
	// to the opener on close.
	const panelRef = useRef<HTMLDivElement | null>(null);
	useEffect(() => {
		if (!open) return;
		const opener = document.activeElement as HTMLElement | null;
		panelRef.current?.focus();
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.stopPropagation();
				dismiss();
			}
		};
		window.addEventListener("keydown", onKey, true);
		return () => {
			window.removeEventListener("keydown", onKey, true);
			opener?.focus?.();
		};
	}, [open, dismiss]);

	// Track pointer events on the panel header area so scrolling
	// content inside the sheet still works.
	const onPointerDown = (e: React.PointerEvent) => {
		startY.current = e.clientY;
		setDragging(true);
	};

	const onPointerMove = (e: React.PointerEvent) => {
		if (!dragging || startY.current === null) return;
		const dy = e.clientY - startY.current;
		if (dy > 0) setDragY(dy);
	};

	const onPointerUp = () => {
		if (!dragging) return;
		setDragging(false);
		startY.current = null;
		if (dragY > DRAG_THRESHOLD) {
			dismiss();
		} else {
			setDragY(0);
		}
	};

	if (!open) return null;

	return (
		<>
			<Scrim $closing={closing} onClick={dismiss} role="presentation" />
			{/* biome-ignore lint/a11y/useSemanticElements: bottom sheet is a dialog with custom drag behavior */}
			<Panel
				role="dialog"
				aria-modal="true"
				aria-label={title}
				ref={panelRef}
				tabIndex={-1}
				$dragY={dragY}
				$animating={!dragging}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
				onPointerCancel={onPointerUp}
			>
				<Handle />
				<TitleRow>
					<Title>{title}</Title>
				</TitleRow>
				<Content
					// Stop the drag handler from hijacking inner scrolls
					onPointerDown={(e) => e.stopPropagation()}
				>
					{children}
				</Content>
			</Panel>
		</>
	);
}
