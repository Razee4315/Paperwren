import { backend } from "@/lib/backend";
import { motion, radius, space, type } from "@/theme";
import { useEffect, useState } from "react";
import styled from "styled-components";

/**
 * Post-onboarding coach marks (docs/06 section 4): one-time,
 * dismiss on tap, never repeat. The viewer chrome coach was
 * removed (audit section 9): conventional controls plus the
 * auto-hide setting explain it without a mandatory-feeling bubble.
 */

export type CoachMarkId = "homeFab";

interface CoachMarks {
	homeFab?: boolean;
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

	// Both timers are owned by the effect scope so cleanup is a
	// valid effect cleanup (audit 9.1); the mark is marked seen when
	// shown and auto-dismisses, so it never demands a tap (9.2).
	useEffect(() => {
		let cancelled = false;
		let showTimer: number | null = null;
		let hideTimer: number | null = null;
		hasCoachMark(id).then((needed) => {
			if (cancelled || !needed) return;
			showTimer = window.setTimeout(() => {
				if (cancelled) return;
				setVisible(true);
				markCoachSeen(id);
				hideTimer = window.setTimeout(() => {
					if (!cancelled) setVisible(false);
				}, 4000);
			}, 1200);
		});
		return () => {
			cancelled = true;
			if (showTimer !== null) window.clearTimeout(showTimer);
			if (hideTimer !== null) window.clearTimeout(hideTimer);
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
