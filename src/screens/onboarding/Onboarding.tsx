import type { FileFormat } from "@/lib/formats";
import { isRtl, msg, t } from "@/lib/i18n";
import { useBackClose } from "@/state/navigation";
import { useSettings } from "@/state/settings";
import { FileIcon, ThemePicker, Wren } from "@/ui";
import { ArrowRight, Check, CloudOff, Lock, UserX } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import s from "./Onboarding.module.css";

const GRID: FileFormat[] = [
	"pdf",
	"docx",
	"xlsx",
	"pptx",
	"odt",
	"csv",
	"md",
	"txt",
];

function HelloScene() {
	return (
		<div className={s.disc}>
			<Wren size={168} />
		</div>
	);
}

function FormatsScene() {
	return (
		<div className={s.grid}>
			{GRID.map((f) => (
				<span key={f} className={s.cell}>
					<FileIcon format={f} size={44} />
				</span>
			))}
		</div>
	);
}

function PrivacyScene() {
	return (
		<div className={s.privacy}>
			<div className={s.disc}>
				<span className={s.lock}>
					<Lock size={64} strokeWidth={1.75} />
				</span>
			</div>
			<ul className={s.tags}>
				<li>
					<CloudOff size={16} /> {t("Offline")}
				</li>
				<li>
					<UserX size={16} /> {t("No accounts")}
				</li>
				<li>
					<Check size={16} /> {t("No ads")}
				</li>
			</ul>
		</div>
	);
}

function CustomizeScene() {
	const { settings, update } = useSettings();
	return (
		<div className={s.panel}>
			<ThemePicker
				value={settings.theme}
				onChange={(v) => update("theme", v)}
			/>
		</div>
	);
}

const STEPS = [
	{
		title: msg("Meet Paperwren"),
		body: msg("The small, quiet way to open every document on your device."),
		Scene: HelloScene,
	},
	{
		title: msg("Opens everything"),
		body: msg(
			"PDF, Word, Excel, PowerPoint, OpenDocument, RTF, CSV and text. Even old .doc and .ppt files.",
		),
		Scene: FormatsScene,
	},
	{
		title: msg("Private by design"),
		body: msg(
			"No internet, no accounts, no ads. Your files never leave your device.",
		),
		Scene: PrivacyScene,
	},
	{
		title: msg("Pick a look"),
		body: msg(
			"Paper, Sand or Ink, all easy on the eyes. Change it any time in Settings.",
		),
		Scene: CustomizeScene,
	},
];

/** First-run welcome. Swipe, tap Next, or skip; Back steps back. */
export default function Onboarding({ onDone }: { onDone: () => void }) {
	const [step, setStep] = useState(0);
	const drag = useRef<{ x: number; y: number } | null>(null);
	const last = step === STEPS.length - 1;

	const go = useCallback((to: number) => {
		setStep(Math.max(0, Math.min(STEPS.length - 1, to)));
	}, []);

	const done = useRef(false);
	const finish = useCallback(() => {
		if (done.current) return;
		done.current = true;
		onDone();
	}, [onDone]);

	useBackClose("onboarding-step", step > 0, () => go(step - 1));

	// "Forward" is towards the end of the line: left in Arabic and Urdu.
	const forward = isRtl() ? -1 : 1;
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "ArrowRight") go(step + forward);
			if (e.key === "ArrowLeft") go(step - forward);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [go, step, forward]);

	// The welcome covers the app: the keyboard starts inside it.
	const root = useRef<HTMLDivElement>(null);
	useEffect(() => root.current?.focus({ preventScroll: true }), []);

	const { Scene } = STEPS[step];

	return (
		<div
			ref={root}
			tabIndex={-1}
			className={s.root}
			// biome-ignore lint/a11y/useSemanticElements: a full-screen surface, not a native dialog
			role="dialog"
			aria-modal="true"
			aria-label={t("Meet Paperwren")}
			data-testid="onboarding"
			onPointerDown={(e) => {
				drag.current = { x: e.clientX, y: e.clientY };
			}}
			onPointerUp={(e) => {
				const start = drag.current;
				drag.current = null;
				if (!start) return;
				const dx = e.clientX - start.x;
				if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(e.clientY - start.y))
					go(step + (dx < 0 ? forward : -forward));
			}}
		>
			<div className={s.top}>
				{!last && (
					<button
						type="button"
						className={s.skip}
						onClick={finish}
						data-testid="onboarding-skip"
					>
						{t("Skip")}
					</button>
				)}
			</div>
			<div className={s.stage}>
				<div key={step} className={s.scene}>
					<Scene />
				</div>
			</div>
			<div className={s.copy} key={`copy-${step}`}>
				<h1 className={s.title}>{t(STEPS[step].title)}</h1>
				<p className={s.body}>{t(STEPS[step].body)}</p>
			</div>
			<div className={s.foot}>
				<div className={s.dots} role="tablist" aria-label={t("Steps")}>
					{STEPS.map((_, i) => (
						<button
							type="button"
							key={i}
							role="tab"
							aria-selected={i === step}
							aria-label={t("Step {n}", { n: i + 1 })}
							className={`${s.dot} ${i === step ? s.dotOn : ""}`}
							onClick={() => go(i)}
						/>
					))}
				</div>
				<button
					type="button"
					className={s.next}
					onClick={() => (last ? finish() : go(step + 1))}
					data-testid="onboarding-next"
				>
					{last ? t("Start reading") : t("Next")}{" "}
					<ArrowRight size={20} className="pw-flip" />
				</button>
			</div>
		</div>
	);
}
