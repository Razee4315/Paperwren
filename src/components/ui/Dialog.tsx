import type React from "react";
import { useEffect } from "react";
import styled from "styled-components";
import { X } from "lucide-react";
import { motion, radius, type } from "@/theme";
import { Button } from "./Button";
import { IconButton } from "./IconButton";

/**
 * Dialog (docs/02 section 6): radius-l, title title-m, actions
 * right-aligned. Destructive actions render as ghost danger buttons,
 * never filled red.
 */

const Scrim = styled.div`
	position: fixed;
	inset: 0;
	background: var(--scrim);
	z-index: 1200;
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 24px;
	animation: pw-fade-in ${motion.dur.fast} ${motion.ease.enter};
	@keyframes pw-fade-in {
		from {
			opacity: 0;
		}
	}
`;

const Box = styled.div`
	background: var(--surface);
	border: 1px solid var(--border);
	border-radius: ${radius.l};
	box-shadow: var(--shadow-3);
	padding: 24px;
	max-width: 400px;
	width: 100%;
	animation: pw-rise ${motion.dur.standard} ${motion.ease.enter};
	@keyframes pw-rise {
		from {
			opacity: 0;
			transform: translateY(12px) scale(0.98);
		}
	}
`;

const Title = styled.h2`
	${type.titleM};
	color: var(--ink-1);
	margin-bottom: 8px;
	padding-right: 40px;
`;

const Body = styled.p`
	${type.body};
	color: var(--ink-2);
	margin-bottom: 24px;
	white-space: pre-line;
`;

const Actions = styled.div`
	display: flex;
	justify-content: flex-end;
	gap: 8px;
	flex-wrap: wrap;
`;

const Close = styled(IconButton)`
	position: absolute;
	top: 8px;
	right: 8px;
`;

export function Dialog({
	open,
	title,
	children,
	actions,
	onDismiss,
	dismissable = true,
	"label": label,
}: {
	open: boolean;
	title: string;
	children?: React.ReactNode;
	actions?: React.ReactNode;
	onDismiss?: () => void;
	dismissable?: boolean;
	"label"?: string;
}) {
	useEffect(() => {
		if (!open || !dismissable || !onDismiss) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onDismiss();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open, dismissable, onDismiss]);

	if (!open) return null;

	return (
		<Scrim
			onClick={dismissable && onDismiss ? onDismiss : undefined}
			role="presentation"
		>
			<Box
				role="dialog"
				aria-modal="true"
				aria-label={label ?? title}
				onClick={(e) => e.stopPropagation()}
			>
				<Title>{title}</Title>
				{dismissable && onDismiss && (
					<Close label="Close" onClick={onDismiss}>
						<X size={22} />
					</Close>
				)}
				<Body>{children}</Body>
				{actions && <Actions>{actions}</Actions>}
			</Box>
		</Scrim>
	);
}

/** Standard two-action dialog: cancel first, then primary. */
export function ConfirmDialog({
	open,
	title,
	message,
	confirmLabel,
	onConfirm,
	onDismiss,
	variant = "filled",
}: {
	open: boolean;
	title: string;
	message: string;
	confirmLabel: string;
	onConfirm: () => void;
	onDismiss: () => void;
	variant?: "filled" | "destructive";
}) {
	return (
		<Dialog
			open={open}
			title={title}
			onDismiss={onDismiss}
			actions={
				<>
					<Button variant="ghost" onClick={onDismiss}>
						Cancel
					</Button>
					<Button
						variant={variant}
						onClick={() => {
							onConfirm();
							onDismiss();
						}}
					>
						{confirmLabel}
					</Button>
				</>
			}
		>
			{message}
		</Dialog>
	);
}
