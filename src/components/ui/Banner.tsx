import { motion, radius, type } from "@/theme";
import type React from "react";
import styled from "styled-components";

/** Banner (docs/02 section 6): full-width strip with icon, for
 * password / file-changed / large-file cautions. */

const Strip = styled.div`
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 12px 16px;
	background: var(--surface-2);
	border-bottom: 1px solid var(--border);
	animation: pw-banner-in ${motion.dur.fast} ${motion.ease.enter};
	@keyframes pw-banner-in {
		from {
			opacity: 0;
			transform: translateY(-8px);
		}
	}
`;

const Text = styled.div`
	flex: 1;
	${type.small};
	color: var(--ink-1);
	min-width: 0;
`;

const ActionButton = styled.button`
	background: none;
	border: none;
	${type.bodyStrong};
	color: var(--accent-strong);
	cursor: pointer;
	padding: 8px;
	border-radius: ${radius.s};
	white-space: nowrap;

	&:hover {
		background: var(--surface-3);
	}
`;

export function Banner({
	icon,
	message,
	actionLabel,
	onAction,
}: {
	icon?: React.ReactNode;
	message: string;
	actionLabel?: string;
	onAction?: () => void;
}) {
	return (
		// biome-ignore lint/a11y/useSemanticElements: a transient banner is announced as a status region
		<Strip role="status">
			{icon}
			<Text>{message}</Text>
			{actionLabel && onAction && (
				<ActionButton onClick={onAction}>{actionLabel}</ActionButton>
			)}
		</Strip>
	);
}
