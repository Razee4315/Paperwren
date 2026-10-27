import { t } from "@/lib/i18n";
import {
	canUpdate,
	checkForUpdate,
	dismissUpdate,
	installUpdate,
	useUpdateState,
} from "@/lib/updates";
import { useSettings } from "@/state/settings";
import { Button, Dialog, toast } from "@/ui";
import { useEffect, useRef, useState } from "react";
import s from "./Updates.module.css";

/** The first screen settles before anything is asked or checked. */
const ASK_AFTER_MS = 2500;
const CHECK_AFTER_MS = 4000;

/** A computer's updates: asks once whether to check for them, checks
 * at start when allowed, and offers a version it found. `paused` while
 * the welcome is on screen. */
export function UpdateHost({ paused }: { paused: boolean }) {
	const { settings, ready, update } = useSettings();
	const status = useUpdateState();
	const [asking, setAsking] = useState(false);
	const checked = useRef(false);

	useEffect(() => {
		if (!canUpdate || !ready || paused) return;
		if (settings.updates === "ask") {
			const timer = window.setTimeout(() => setAsking(true), ASK_AFTER_MS);
			return () => window.clearTimeout(timer);
		}
		if (settings.updates !== "auto" || checked.current) return;
		const timer = window.setTimeout(() => {
			checked.current = true;
			checkForUpdate(true);
		}, CHECK_AFTER_MS);
		return () => window.clearTimeout(timer);
	}, [ready, paused, settings.updates]);

	useEffect(() => {
		if (status.phase !== "install-failed") return;
		toast(t("Couldn't install the update"));
		dismissUpdate();
	}, [status.phase]);

	const answer = (auto: boolean) => {
		setAsking(false);
		update("updates", auto ? "auto" : "off");
		if (auto) {
			checked.current = true;
			checkForUpdate(true);
		}
	};

	const offered =
		status.phase === "available" || status.phase === "installing"
			? status
			: null;
	const installing = status.phase === "installing";

	return (
		<>
			<Dialog
				open={asking && settings.updates === "ask"}
				title={t("Check for updates automatically?")}
				onClose={() => setAsking(false)}
				testId="updates-ask"
				actions={
					<>
						<Button variant="ghost" onClick={() => answer(false)}>
							{t("No thanks")}
						</Button>
						<Button onClick={() => answer(true)} data-testid="updates-allow">
							{t("Check automatically")}
						</Button>
					</>
				}
			>
				{t(
					"When it starts, Paperwren can ask GitHub whether a new version is out. Nothing about you or your files is sent. You can change this in Settings.",
				)}
			</Dialog>
			<Dialog
				open={offered !== null}
				title={t("Paperwren {version} is available", {
					version: offered?.version ?? "",
				})}
				onClose={() => !installing && dismissUpdate()}
				testId="updates-offer"
				actions={
					<>
						<Button
							variant="ghost"
							onClick={dismissUpdate}
							disabled={installing}
						>
							{t("Later")}
						</Button>
						<Button
							onClick={() => installUpdate()}
							disabled={installing}
							data-testid="updates-install"
						>
							{t("Install and restart")}
						</Button>
					</>
				}
			>
				{status.phase === "installing" ? (
					<p aria-live="polite">
						{status.percent === null
							? t("Downloading the update")
							: t("Downloading the update: {percent}%", {
									percent: status.percent,
								})}
					</p>
				) : status.phase === "available" && status.notes ? (
					<div className={s.notes}>{status.notes}</div>
				) : (
					<p>{t("A new version of Paperwren is ready to install.")}</p>
				)}
			</Dialog>
		</>
	);
}
