import { holdWindow } from "@/lib/closeGuard";
import { t } from "@/lib/i18n";
import {
	type Ask,
	askLeave,
	guardedScopes,
	onGuardsChange,
	setDefaultAsk,
} from "@/state/leave";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "./Button";
import { Dialog } from "./Overlay";

/**
 * The "Leave without saving?" of a guard with no question of its own
 * (state/leave), and the window's close held while anything would be
 * lost. `show` brings the document a question is about into view.
 */
export function LeaveHost({ show }: { show?: (scope: string) => void }) {
	const [asking, setAsking] = useState<{ go: () => void } | null>(null);
	useEffect(() => {
		const ask: Ask = (go) => setAsking({ go });
		setDefaultAsk(ask);
		return () => setDefaultAsk(null);
	}, []);

	const showRef = useRef(show);
	showRef.current = show;
	const held = useSyncExternalStore(
		onGuardsChange,
		() => guardedScopes() !== "",
	);
	useEffect(() => {
		if (!held) return;
		return holdWindow((close) =>
			askLeave(null, close, (scope) => showRef.current?.(scope)),
		);
	}, [held]);

	return (
		<Dialog
			open={asking !== null}
			title={t("Leave without saving?")}
			onClose={() => setAsking(null)}
			alert
			testId="leave"
			actions={
				<>
					<Button variant="ghost" onClick={() => setAsking(null)}>
						{t("Keep editing")}
					</Button>
					<Button
						variant="danger"
						onClick={() => {
							const go = asking?.go;
							setAsking(null);
							go?.();
						}}
						data-testid="leave-discard"
					>
						{t("Discard")}
					</Button>
				</>
			}
		>
			{t("What you added is lost unless you save a copy.")}
		</Dialog>
	);
}
