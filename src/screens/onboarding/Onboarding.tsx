import type { FileFormat } from "@/lib/formats";
import { useBackClose } from "@/state/navigation";
import { useSettings } from "@/state/settings";
import { AccentPicker, Blobs, FileIcon, ThemePicker, Wren } from "@/ui";
import { ArrowRight, Sparkles } from "lucide-react";
import {
	type CSSProperties,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import s from "./Onboarding.module.css";

const ORBIT: FileFormat[] = [
	"pdf",
	"docx",
	"xlsx",
	"pptx",
	"md",
	"csv",
	"odt",
	"txt",
];

function HelloScene() {
	return (
		<div className={s.hello}>
			<Wren size={220} />
			<span className={s.bubble}>Hi! I'm Wren 👋</span>
		</div>
	);
}

function FormatsScene() {
	return (
		<div className={s.orbit}>
			<span className={s.ring} />
			<div className={s.spinner}>
				{ORBIT.map((f, i) => (
					<span
						key={f}
						className={s.sat}
						style={{ "--a": `${(360 / ORBIT.length) * i}deg` } as CSSProperties}
					>
						<span>
							<span
								className={s.pop}
								style={{ "--d": `${120 + i * 70}ms` } as CSSProperties}
							>
								<FileIcon format={f} size={48} />
							</span>
						</span>
					</span>
				))}
			</div>
			<div className={s.core}>
				<Wren size={96} animate={false} />
			</div>
		</div>
	);
}

function PrivacyScene() {
	return (
		<div className={s.shieldWrap}>
			<span className={s.pulse} />
			<span className={s.pulse} />
			<span className={s.pulse} />
			<svg className={s.shield} viewBox="0 0 130 150" aria-hidden="true">
				<defs>
					<linearGradient id="ob-shield" x1="0" y1="0" x2="1" y2="1">
						<stop offset="0" style={{ stopColor: "var(--grad-a)" }} />
						<stop offset="0.55" style={{ stopColor: "var(--grad-b)" }} />
						<stop offset="1" style={{ stopColor: "var(--grad-c)" }} />
					</linearGradient>
				</defs>
				<path
					d="M65 4 L120 24 V70 C120 108 94 134 65 146 C36 134 10 108 10 70 V24 Z"
					fill="url(#ob-shield)"
				/>
				<path
					d="M65 4 L120 24 V70 C120 108 94 134 65 146 Z"
					fill="#fff"
					opacity="0.14"
				/>
				<path
					className={s.lockShackle}
					d="M50 70 V58 a15 15 0 0 1 30 0 V70"
					fill="none"
					stroke="#fff"
					strokeWidth="7"
					strokeLinecap="round"
				/>
				<rect x="42" y="68" width="46" height="36" rx="8" fill="#fff" />
				<circle cx="65" cy="84" r="5" fill="var(--grad-b)" />
				<rect x="63" y="86" width="4" height="9" rx="2" fill="var(--grad-b)" />
			</svg>
			<svg className={s.cloud} viewBox="0 0 70 50" aria-hidden="true">
				<path
					d="M18 40 a12 12 0 0 1 2 -24 a16 16 0 0 1 30 4 a10 10 0 0 1 2 20 Z"
					fill="var(--surface)"
					stroke="var(--line-strong)"
					strokeWidth="2"
				/>
				<path
					className={s.slash}
					d="M10 6 L60 46"
					stroke="var(--danger)"
					strokeWidth="4"
					strokeLinecap="round"
				/>
			</svg>
			<div className={s.tags}>
				{["No ads", "No accounts", "Offline"].map((t, i) => (
					<span
						key={t}
						className={s.tag}
						style={{ animationDelay: `${500 + i * 120}ms` }}
					>
						{t}
					</span>
				))}
			</div>
		</div>
	);
}

function CustomizeScene() {
	const { settings, update } = useSettings();
	return (
		<div className={s.customize}>
			<div className={s.panel}>
				<span className={s.panelLabel}>Theme</span>
				<ThemePicker
					value={settings.theme}
					onChange={(v) => update("theme", v)}
				/>
			</div>
			<div className={s.panel}>
				<span className={s.panelLabel}>Colour</span>
				<AccentPicker
					value={settings.accent}
					onChange={(v) => update("accent", v)}
				/>
			</div>
		</div>
	);
}

const STEPS = [
	{
		title: (
			<>
				Meet <span className="grad-text">Paperwren</span>
			</>
		),
		body: "The tiny, fast way to open every document on your phone.",
		Scene: HelloScene,
	},
	{
		title: (
			<>
				Opens <span className="grad-text">everything</span>
			</>
		),
		body: "PDF, Word, Excel, PowerPoint, OpenDocument, RTF, CSV and text. Even old .doc and .ppt files.",
		Scene: FormatsScene,
	},
	{
		title: (
			<>
				Private <span className="grad-text">by design</span>
			</>
		),
		body: "No internet, no accounts, no ads. Your files never leave your phone.",
		Scene: PrivacyScene,
	},
	{
		title: (
			<>
				Make it <span className="grad-text">yours</span>
			</>
		),
		body: "Pick a look. You can change it any time in Settings.",
		Scene: CustomizeScene,
	},
];

const CONFETTI_COLORS = [
	"var(--grad-a)",
	"var(--grad-b)",
	"var(--grad-c)",
	"var(--fmt-doc)",
	"var(--fmt-sheet)",
	"var(--fmt-slides)",
];

function Confetti() {
	// Stable per mount; 42 pieces thrown in a fan.
	const pieces = useRef(
		Array.from({ length: 42 }, (_, i) => {
			const angle = Math.PI * (i / 41) + Math.PI; // upper half-circle
			const dist = 160 + Math.random() * 220;
			return {
				x: `${Math.cos(angle) * dist}px`,
				y: `${Math.sin(angle) * dist + 240}px`,
				r: `${Math.round(Math.random() * 720 - 360)}deg`,
				c: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
				d: `${Math.round(Math.random() * 120)}ms`,
			};
		}),
	).current;
	return (
		<div className={s.confetti} aria-hidden="true">
			{pieces.map((p, i) => (
				<i
					key={i}
					style={
						{
							"--x": p.x,
							"--y": p.y,
							"--r": p.r,
							"--c": p.c,
							"--d": p.d,
						} as CSSProperties
					}
				/>
			))}
		</div>
	);
}

/** First-run welcome. Swipe, tap Next, or skip; Back steps back. */
export default function Onboarding({ onDone }: { onDone: () => void }) {
	const [step, setStep] = useState(0);
	const [dir, setDir] = useState(1);
	const [leaving, setLeaving] = useState(false);
	const [party, setParty] = useState(false);
	const drag = useRef<{ x: number; y: number } | null>(null);
	const last = step === STEPS.length - 1;

	const go = useCallback((to: number) => {
		setStep((cur) => {
			const next = Math.max(0, Math.min(STEPS.length - 1, to));
			setDir(next >= cur ? 1 : -1);
			return next;
		});
	}, []);

	const done = useRef(false);
	const finish = useCallback(
		(celebrate: boolean) => {
			if (done.current) return;
			done.current = true;
			// Confetti first, then the whole welcome slides up to Home.
			const lift = celebrate ? 650 : 0;
			if (celebrate) setParty(true);
			window.setTimeout(() => setLeaving(true), lift);
			window.setTimeout(onDone, lift + 500);
		},
		[onDone],
	);

	useBackClose("onboarding-step", step > 0 && !party && !leaving, () =>
		go(step - 1),
	);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "ArrowRight") go(step + 1);
			if (e.key === "ArrowLeft") go(step - 1);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [go, step]);

	const { Scene } = STEPS[step];

	return (
		<div
			className={`${s.root} ${leaving ? s.leaving : ""}`}
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
					go(step + (dx < 0 ? 1 : -1));
			}}
		>
			<Blobs />
			<div className={s.top}>
				{!last && (
					<button
						type="button"
						className={s.skip}
						onClick={() => finish(false)}
						data-testid="onboarding-skip"
					>
						Skip
					</button>
				)}
			</div>
			<div className={s.stage}>
				<div
					key={step}
					className={s.scene}
					style={{ "--dir": dir } as CSSProperties}
				>
					<Scene />
				</div>
			</div>
			<div className={s.copy} key={`copy-${step}`}>
				<h1 className={s.title}>{STEPS[step].title}</h1>
				<p className={s.body}>{STEPS[step].body}</p>
			</div>
			<div className={s.foot}>
				<div className={s.dots} role="tablist" aria-label="Steps">
					{STEPS.map((_, i) => (
						<button
							type="button"
							key={i}
							role="tab"
							aria-selected={i === step}
							aria-label={`Step ${i + 1}`}
							className={`${s.dot} ${i === step ? s.dotOn : ""}`}
							onClick={() => go(i)}
						/>
					))}
				</div>
				<button
					type="button"
					className={s.next}
					onClick={() => (last ? finish(true) : go(step + 1))}
					data-testid="onboarding-next"
				>
					{last ? (
						<>
							Let's go <Sparkles size={20} />
						</>
					) : (
						<>
							Next <ArrowRight size={20} />
						</>
					)}
				</button>
			</div>
			{party && <Confetti />}
		</div>
	);
}
