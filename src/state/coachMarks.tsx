import { backend } from "@/lib/backend";
import { motion, radius, space, type } from "@/theme";
import { useEffect, useState } from "react";
import styled from "styled-components";

/**
 * Post-onboarding coach marks (docs/06 section 4): one-time,
 * dismiss on tap, never repeat. CM-1 greets on the empty Home,
 * CM-2 explains the tap-to-hide chrome on first viewer open.
 */

export type CoachMarkId = "homeFab" | "viewerChrome";

interface CoachMarks {
	homeFab?: boolean;
	viewerChrome?: boolean;
}

async function loadMarks(): Promise<CoachMarks> {
	try {
		const stored = await backend.storeGet("coach_marks");
		return stored && typeof stored === "object" ? (stored as CoachMarks) : {};
	} catch {
		return {};
	}
}

function saveMarks(marks: CoachMarks) {
	backend.storeSet("coach_marks", marks).catch(() => {});
}

let marksCache: CoachMarks | null = null;

export async function hasCoachMark(id: CoachMarkId): Promise<boolean> {
	if (!marksCache) marksCache = await loadMarks();
	return !marksCache[id];
}

export async function markCoachSeen(id: CoachMarkId) {
	if (!marksCache) marksCache = await loadMarks();
	marksCache[id] = true;
	saveMarks(marksCache);
}

const Bubble = styled.button`
	position: fixed;
	left: 16px;
	right: 16px;
	max-width: 340px;
	margin: 0 auto;
	z-index: 900;
	background: var(--ink-1);
	color: var(--bg);
	border: none;
	border-radius: ${radius.l};
	padding: ${space[4]};
	${type.small};
	line-height: 1.5;
	text-align: left;
	cursor: pointer;
	box-shadow: var(--shadow-3);
	animation: pw-coach-in ${motion.dur.standard} ${motion.ease.enter};
	@keyframes pw-coach-in {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
	}

	b {
		font-weight: 700;
	}
`;

export function CoachBubble({
	id,
	text,
	position,
}: {
	id: CoachMarkId;
	text: string;
	position: { bottom: string };
}) {
	const [visible, setVisible] = useState(false);

	useEffect(() => {
		let cancelled = false;
		hasCoachMark(id).then((needed) => {
			if (cancelled || !needed) return;
			const t = window.setTimeout(() => {
				if (!cancelled) setVisible(true);
			}, 1200);
			return () => window.clearTimeout(t);
		});
		return () => {
			cancelled = true;
		};
	}, [id]);

	if (!visible) return null;

	return (
		<Bubble
			style={{ bottom: position.bottom }}
			onClick={() => {
				setVisible(false);
				markCoachSeen(id);
			}}
		>
			{text}
		</Bubble>
	);
}
