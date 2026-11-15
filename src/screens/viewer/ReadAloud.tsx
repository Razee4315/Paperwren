import { language, t, uiDir } from "@/lib/i18n";
import { SPEECH_RATES, Stopped, guessLang, speaker } from "@/lib/speech";
import { useSettings } from "@/state/settings";
import { IconButton, toast } from "@/ui";
import { Pause, Play, SkipBack, SkipForward, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import s from "./Shell.module.css";
import { type SpeechPiece, type SpeechSource, unmark } from "./speechSources";

/** How many pieces already said are kept, to go back through. */
const BEHIND = 50;

/**
 * Read aloud: a small bar over the document while it reads, from the
 * place on show, sentence by sentence (each marked and kept in view).
 * Pause, the previous and the next sentence, the pace, and away. It
 * stops when the document is left or another one is shown over it.
 */
export function ReadAloud({
	source,
	active,
	onClose,
}: {
	source: SpeechSource;
	active: boolean;
	onClose: () => void;
}) {
	const { settings, update } = useSettings();
	const voice = speaker();
	const [playing, setPlaying] = useState(true);
	const rateRef = useRef(settings.speechRate);
	rateRef.current = settings.speechRate;

	// What has been said, what is being said, what was skipped back over,
	// and the rest of the document, still to be read.
	const flow = useRef<AsyncGenerator<SpeechPiece> | null>(null);
	const behind = useRef<SpeechPiece[]>([]);
	const ahead = useRef<SpeechPiece[]>([]);
	const now = useRef<SpeechPiece | null>(null);
	/** Each run of reading has a number: an older one stops on its own. */
	const run = useRef(0);

	const fetching = useRef<Promise<unknown>>(Promise.resolve());
	const next = useCallback(
		(mine: number): Promise<SpeechPiece | null> => {
			const pending = fetching.current.then(async () => {
				if (mine !== run.current) return null;
				const queued = ahead.current.pop();
				if (queued) return queued;
				flow.current ??= source();
				const step = await flow.current.next();
				const piece = step.done ? null : step.value;
				if (mine !== run.current) {
					// Put it behind pieces queued by Back, before the next fetch.
					if (piece) ahead.current.unshift(piece);
					return null;
				}
				return piece;
			});
			fetching.current = pending.catch(() => {});
			return pending;
		},
		[source],
	);

	const finish = useCallback(() => {
		run.current++;
		voice?.stop();
		unmark();
		onClose();
	}, [voice, onClose]);

	/** Read from `piece` (or the next one) on, until stopped. */
	const read = useCallback(
		async (piece: SpeechPiece | null) => {
			if (!voice) return;
			const mine = ++run.current;
			setPlaying(true);
			let current = piece ?? (await next(mine));
			while (current && mine === run.current) {
				now.current = current;
				current.show?.();
				try {
					await voice.say(
						current.text,
						current.lang ?? guessLang(current.text, language()) ?? undefined,
						rateRef.current,
					);
				} catch (err) {
					if (err instanceof Stopped || mine !== run.current) return;
					toast(t("Couldn't read this aloud"));
					finish();
					return;
				}
				if (mine !== run.current) return;
				behind.current = [...behind.current, current].slice(-BEHIND);
				current = await next(mine);
			}
			if (mine === run.current && !current) {
				// The end of the document.
				now.current = null;
				finish();
			}
		},
		[voice, next, finish],
	);

	// Start from the place on show; stop when the bar goes.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reads once per opening of the bar
	useEffect(() => {
		read(null);
		return () => {
			run.current++;
			voice?.stop();
			unmark();
			// A new start reads the document afresh from the place on show.
			flow.current = null;
			behind.current = [];
			ahead.current = [];
			now.current = null;
		};
	}, []);

	// Leaving the document (or another shown over it) stops the reading.
	useEffect(() => {
		if (!active) finish();
	}, [active, finish]);

	const pause = () => {
		run.current++;
		voice?.stop();
		setPlaying(false);
	};
	const resume = () => read(now.current);
	const forward = () => {
		run.current++;
		voice?.stop();
		const done = now.current;
		if (done) behind.current = [...behind.current, done].slice(-BEHIND);
		now.current = null;
		read(null);
	};
	const back = () => {
		const previous = behind.current.pop();
		if (!previous) {
			resume();
			return;
		}
		run.current++;
		voice?.stop();
		if (now.current) ahead.current.push(now.current);
		read(previous);
	};
	const faster = () => {
		const at = SPEECH_RATES.indexOf(settings.speechRate);
		const rate = SPEECH_RATES[(at + 1) % SPEECH_RATES.length];
		update("speechRate", rate);
		rateRef.current = rate;
		// Heard at once: the sentence starts again at the new pace.
		if (playing) read(now.current);
	};

	return (
		<div
			className={s.speech}
			dir={uiDir()}
			role="toolbar"
			aria-label={t("Read aloud")}
			data-testid="read-aloud"
		>
			<IconButton label={t("Previous sentence")} onClick={back}>
				<SkipBack size={18} className="pw-flip" />
			</IconButton>
			{playing ? (
				<IconButton
					label={t("Pause")}
					onClick={pause}
					data-testid="read-aloud-pause"
				>
					<Pause size={20} />
				</IconButton>
			) : (
				<IconButton
					label={t("Resume")}
					onClick={resume}
					data-testid="read-aloud-play"
				>
					<Play size={20} />
				</IconButton>
			)}
			<IconButton
				label={t("Next sentence")}
				onClick={forward}
				data-testid="read-aloud-next"
			>
				<SkipForward size={18} className="pw-flip" />
			</IconButton>
			<button
				type="button"
				className={s.speechRate}
				onClick={faster}
				aria-label={t("Reading speed {n}×", { n: settings.speechRate })}
				title={t("Reading speed")}
				data-testid="read-aloud-rate"
			>
				{settings.speechRate}×
			</button>
			<IconButton
				label={t("Stop reading")}
				onClick={finish}
				data-testid="read-aloud-stop"
			>
				<X size={18} />
			</IconButton>
		</div>
	);
}
