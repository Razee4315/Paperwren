import { backend } from "@/lib/backend";
import { isDesktop } from "@/lib/env";
import { t } from "@/lib/i18n";
import type { DigitalId as Id, SignBlocker } from "@/lib/sign";
import { PasswordDialog } from "@/screens/viewer/Dialogs";
import { Button, Dialog, Sheet } from "@/ui";
import { TriangleAlert } from "lucide-react";
import {
	type CSSProperties,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react";
import s from "./Tools.module.css";
import {
	blockerMessage,
	certificateWarnings,
	issuerLine,
	problemMessage,
	signerLines,
	validLine,
	validity,
} from "./certificate";

/** The signing code, loaded only when a digital ID is asked for. */
const lib = () => import("@/lib/sign");

/** A digital ID the reader chose to sign with, and how. */
export interface Chosen {
	id: Id;
	/** A mark on the page, or none. */
	visible: boolean;
	/** The PDF already has a digital signature: only this one may be
	 * added, so the earlier one stays valid. */
	signed: boolean;
}

type Step =
	| { at: "checking" }
	| { at: "password"; wrong: boolean; busy: boolean; round: number }
	| { at: "summary"; id: Id }
	| { at: "problem"; message: string; again: boolean };

/**
 * Choosing a digital ID: the PDF is checked first (a locked or certified
 * one can't be signed), then the reader picks the file, gives its
 * password and sees whose it is before anything is signed. The file
 * and its password are let go as soon as the ID is read; what is handed
 * on is a key that can sign but not be read out, forgotten by whoever
 * holds it last.
 */
export function DigitalIdFlow({
	name,
	pdf,
	held,
	onReady,
	onBlocked,
	onDrop,
	onClose,
}: {
	/** The PDF's name. */
	name: string;
	/** The PDF as opened, checked before a digital ID is asked for. */
	pdf: () => Promise<Uint8Array>;
	/** The digital ID already chosen: its summary again. */
	held?: Chosen | null;
	onReady: (chosen: Chosen) => void;
	/** This PDF can't be signed with a digital ID. */
	onBlocked: (blocker: SignBlocker) => void;
	/** The held ID is put aside for another one. */
	onDrop: () => void;
	onClose: () => void;
}) {
	const [step, setStep] = useState<Step>(
		held ? { at: "summary", id: held.id } : { at: "checking" },
	);
	const [visible, setVisible] = useState(held?.visible ?? true);
	// The picked file, until its ID is read; and an ID read but not yet
	// handed on. Neither outlives this flow.
	const file = useRef<{ name: string; bytes: Uint8Array } | null>(null);
	const pending = useRef<Id | null>(null);
	const signed = useRef(held?.signed ?? false);
	const alive = useRef(true);

	const wipe = () => {
		file.current?.bytes.fill(0);
		file.current = null;
	};

	const pick = async () => {
		setStep({ at: "checking" });
		let picked: Awaited<ReturnType<typeof backend.pickDigitalId>> = null;
		try {
			picked = await backend.pickDigitalId();
		} catch {
			if (alive.current)
				setStep({ at: "problem", message: problemMessage(""), again: true });
			return;
		}
		if (!alive.current) {
			picked?.bytes.fill(0);
			return;
		}
		if (!picked) return onClose();
		wipe();
		file.current = picked;
		setStep({ at: "password", wrong: false, busy: false, round: 0 });
	};

	// Once only, even where React runs an effect twice to test it: a
	// second picker would take the place of the password asked for.
	const started = useRef(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: once, when the flow opens
	useEffect(() => {
		alive.current = true;
		if (!held && !started.current) {
			started.current = true;
			(async () => {
				try {
					const { canSign } = await lib();
					const found = await canSign(await pdf());
					if (!alive.current) return;
					// A PDF not signed yet is written out afresh before it is
					// signed, and the fresh copy is checked then: a structure
					// only that rewrite tidies (a linearized file's, say) is no
					// reason to refuse it here.
					const blocker =
						found.blocker === "damaged" && !found.signed
							? undefined
							: found.blocker;
					if (blocker) {
						onBlocked(blocker);
						setStep({
							at: "problem",
							message: blockerMessage(blocker),
							again: false,
						});
						return;
					}
					signed.current = found.signed;
				} catch {
					if (alive.current)
						setStep({
							at: "problem",
							message: t("Couldn't sign the copy"),
							again: false,
						});
					return;
				}
				await pick();
			})();
		}
		return () => {
			alive.current = false;
			wipe();
			pending.current?.forget();
			pending.current = null;
		};
	}, []);

	const submit = async (password: string, round: number) => {
		const picked = file.current;
		if (!picked) return;
		setStep({ at: "password", wrong: false, busy: true, round });
		try {
			const { readDigitalId } = await lib();
			// The reader erases what it is given, so each try has a copy.
			const id = await readDigitalId(picked.bytes.slice(), password);
			if (!alive.current) return id.forget();
			wipe();
			pending.current = id;
			setStep({ at: "summary", id });
		} catch (err) {
			if (!alive.current) return;
			const { DigitalIdError } = await lib();
			const reason = err instanceof DigitalIdError ? err.reason : undefined;
			if (reason === "password") {
				// Asked again, in a new dialog: the password tried is gone.
				setStep({ at: "password", wrong: true, busy: false, round: round + 1 });
				return;
			}
			wipe();
			setStep({ at: "problem", message: problemMessage(reason), again: true });
		}
	};

	// Only an ID read here waits in `pending`; the held one is its
	// holder's to forget.
	const cancel = () => {
		pending.current?.forget();
		pending.current = null;
		onClose();
	};

	const dropped = useRef(false);
	const other = () => {
		if (held && !dropped.current) {
			dropped.current = true;
			onDrop();
		}
		pending.current?.forget();
		pending.current = null;
		setVisible(true);
		pick();
	};

	if (step.at === "password")
		return (
			<PasswordDialog
				key={step.round}
				open
				name={file.current?.name ?? name}
				wrong={step.wrong}
				busy={step.busy}
				title={t("Digital ID password")}
				action={t("Continue")}
				allowEmpty
				onSubmit={(password) => submit(password, step.round)}
				onCancel={() => {
					wipe();
					onClose();
				}}
				testId="digital-id"
			/>
		);
	if (step.at === "problem")
		return (
			<Dialog
				open
				alert
				title={t("Sign with a digital ID")}
				onClose={onClose}
				testId="digital-id-problem"
				actions={
					<>
						{step.again && (
							<Button
								variant="ghost"
								onClick={other}
								data-testid="digital-id-other"
							>
								{t("Use a different digital ID")}
							</Button>
						)}
						<Button onClick={onClose} data-testid="digital-id-problem-close">
							{t("Close")}
						</Button>
					</>
				}
			>
				<p className={s.hint} data-testid="digital-id-problem-text">
					{step.message}
				</p>
			</Dialog>
		);
	if (step.at === "summary")
		return (
			<CertificateSummary
				id={step.id}
				visible={visible}
				onVisible={setVisible}
				onContinue={() => {
					pending.current = null;
					onReady({ id: step.id, visible, signed: signed.current });
				}}
				onOther={other}
				onCancel={cancel}
			/>
		);
	return null;
}

/** Whose digital ID this is, what readers will make of the signature,
 * and whether it shows on the page. */
export function CertificateSummary({
	id,
	visible,
	onVisible,
	onContinue,
	onOther,
	onCancel,
	now: given,
}: {
	id: Id;
	visible: boolean;
	onVisible: (visible: boolean) => void;
	onContinue: () => void;
	onOther: () => void;
	onCancel: () => void;
	/** Today, by this device's clock (given only by tests). */
	now?: Date;
}) {
	const [now] = useState(() => given ?? new Date());
	const { summary } = id;
	const lines = signerLines(summary);
	const warnings = certificateWarnings(summary, now);
	const outOfDate = validity(summary, now) !== "valid";
	const ways: Array<[boolean, string]> = [
		[true, t("Show it on the page")],
		[false, t("No mark on the page")],
	];
	const body = (
		<div className={s.certificate}>
			<dl className={s.certFacts}>
				<div>
					<dt>{t("Signed as")}</dt>
					<dd>
						{lines.map((line, i) =>
							i === 0 ? (
								<strong key="name" dir="auto" data-testid="digital-id-name">
									{line}
								</strong>
							) : (
								<span key={line} dir="auto">
									{line}
								</span>
							),
						)}
					</dd>
				</div>
				<div>
					<dt>{t("Issued by")}</dt>
					<dd dir="auto" data-testid="digital-id-issuer">
						{issuerLine(summary)}
					</dd>
				</div>
			</dl>
			<p className={s.certValid} data-testid="digital-id-valid">
				{validLine(summary)}
			</p>
			{warnings.map((warning) => (
				<p
					key={warning}
					className={s.certWarning}
					data-testid="digital-id-warning"
				>
					<TriangleAlert size={17} aria-hidden="true" />
					<span>{warning}</span>
				</p>
			))}
			<ul className={s.certNotes}>
				{summary.selfSigned && (
					<li>
						{t(
							"Readers show who signed only if they've been told to trust this certificate.",
						)}
					</li>
				)}
				<li>
					{t(
						"Whether the signature is trusted is decided by the app that opens the PDF, not by Paperwren.",
					)}
				</li>
				<li>
					{t(
						"There's no timestamp: the signing time comes from this device's clock.",
					)}
				</li>
			</ul>
			<div
				className={s.ways}
				role="radiogroup"
				aria-label={t("Digital ID")}
				style={{ "--n": 2, "--i": visible ? 0 : 1 } as CSSProperties}
			>
				{ways.map(([on, label]) => (
					<button
						key={label}
						type="button"
						// biome-ignore lint/a11y/useSemanticElements: a pair of buttons with radio semantics
						role="radio"
						aria-checked={visible === on}
						aria-selected={visible === on}
						className={s.way}
						onClick={() => onVisible(on)}
						data-testid={`digital-id-${on ? "visible" : "invisible"}`}
					>
						{label}
					</button>
				))}
			</div>
			<button
				type="button"
				className={s.certOther}
				onClick={onOther}
				data-testid="digital-id-other"
			>
				{t("Use a different digital ID")}
			</button>
		</div>
	);
	const actions = (
		<>
			<Button
				variant="ghost"
				onClick={onCancel}
				data-testid="digital-id-cancel"
			>
				{t("Cancel")}
			</Button>
			<Button onClick={onContinue} data-testid="digital-id-continue">
				{outOfDate ? t("Sign anyway") : t("Continue")}
			</Button>
		</>
	);
	return (
		<Panel
			title={t("Sign with a digital ID")}
			onClose={onCancel}
			actions={actions}
		>
			{body}
		</Panel>
	);
}

/** A dialog on a desktop; on a phone, a sheet from the foot of the
 * screen with its buttons at the end. */
function Panel({
	title,
	onClose,
	actions,
	children,
}: {
	title: string;
	onClose: () => void;
	actions: ReactNode;
	children: ReactNode;
}) {
	if (isDesktop)
		return (
			<Dialog
				open
				title={title}
				onClose={onClose}
				actions={actions}
				testId="digital-id-summary"
			>
				{children}
			</Dialog>
		);
	return (
		<Sheet
			open
			wide
			title={title}
			onClose={onClose}
			testId="digital-id-summary"
		>
			{children}
			<div className={s.certActions}>{actions}</div>
		</Sheet>
	);
}

/** Load a picture from its address. */
function loadPicture(src: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error("picture"));
		image.src = src;
	});
}

/** The share of a visible digital signature's box its picture takes;
 * the caption has the rest, below it. */
export const PICTURE_SHARE = 0.66;

/**
 * The look of a visible digital signature, as one picture: the
 * signature above, the caption under it, drawn in the app's own font so
 * any script and direction comes out right.
 */
export async function signatureAppearance(
	src: string,
	caption: string[],
	width: number,
	height: number,
	ink: string,
): Promise<string> {
	const scale = 4;
	const w = Math.max(16, Math.round(width * scale));
	const h = Math.max(16, Math.round(height * scale));
	const canvas = document.createElement("canvas");
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("no canvas");
	const picture = await loadPicture(src);
	const room = h * PICTURE_SHARE;
	const fit = Math.min(w / picture.width, room / picture.height);
	const pw = picture.width * fit;
	const ph = picture.height * fit;
	ctx.drawImage(picture, (w - pw) / 2, (room - ph) / 2, pw, ph);
	const line = (h - room) / caption.length;
	ctx.fillStyle = ink;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.direction = document.documentElement.dir === "rtl" ? "rtl" : "ltr";
	const family = getComputedStyle(document.body).fontFamily;
	caption.forEach((text, i) => {
		ctx.font = `${i === 0 ? 600 : 400} ${line * 0.72}px ${family}`;
		ctx.fillText(text, w / 2, room + line * (i + 0.5), w * 0.98);
	});
	return canvas.toDataURL("image/png");
}
