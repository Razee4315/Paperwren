import type { Block, Extracted } from "@/lib/office/model";
import { Button, ErrorArt, IconButton, Spinner, StateView } from "@/ui";
import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import d from "./Doc.module.css";
import { FindBar, Shell } from "./Shell";
import { usePinchZoom, useScrollMemory } from "./hooks";
import { runWorker } from "./runWorker";
import type { ViewerProps } from "./types";
import { useDomFind } from "./useDomFind";

type Result =
	| { ok: true; doc: Extracted }
	| { ok: false; reason: "corrupt" | "password" };

async function extract(
	props: ViewerProps,
	signal: AbortSignal,
): Promise<Result> {
	const { format, data } = props;
	if (format === "odt" || format === "odp") {
		const { extractOdf } = await import("@/lib/office/odf");
		try {
			return { ok: true, doc: extractOdf(new Uint8Array(data), format) };
		} catch {
			return { ok: false, reason: "corrupt" };
		}
	}
	const type = format === "doc" ? "doc" : format === "ppt" ? "ppt" : "rtf";
	return runWorker<Result>({ type, buffer: data }, signal);
}

function Blocks({ blocks }: { blocks: Block[] }) {
	return (
		<>
			{blocks.map((b, i) => {
				if (b.kind === "heading") {
					const level = Math.min(4, Math.max(1, b.level ?? 1));
					const H = `h${level}` as "h1";
					return <H key={i}>{b.text}</H>;
				}
				return <p key={i}>{b.text}</p>;
			})}
		</>
	);
}

/** Formats read as text structure: legacy .doc/.ppt, OpenDocument
 * text and slides, and RTF. Honest about what is not shown. */
export default function ReflowView(props: ViewerProps) {
	const { name, format, position, onPosition, onClose, active } = props;
	const scroller = useRef<HTMLDivElement>(null);
	const content = useRef<HTMLDivElement>(null);
	const [result, setResult] = useState<Result | null>(null);
	const [zoom, setZoom] = useState(1);
	const find = useDomFind(content, scroller);

	// biome-ignore lint/correctness/useExhaustiveDependencies: extract once per document
	useEffect(() => {
		const abort = new AbortController();
		extract(props, abort.signal)
			.then(setResult)
			.catch(
				(e) =>
					e?.name !== "AbortError" &&
					setResult({ ok: false, reason: "corrupt" }),
			);
		return () => abort.abort();
	}, [props.data]);

	usePinchZoom(scroller, zoom, setZoom, 0.6, 3);
	useScrollMemory(scroller, !!result?.ok, position, onPosition);

	const doc = result?.ok ? result.doc : null;
	const note =
		format === "doc" || format === "ppt"
			? "Older Office format: showing the text only. Layout and images aren't displayed."
			: format === "rtf"
				? "Showing the text of this RTF document."
				: "Showing the text of this OpenDocument file. Layout and images aren't displayed.";

	return (
		<Shell
			name={name}
			format={format}
			onClose={onClose}
			active={active}
			actions={
				<IconButton
					label="Find"
					onClick={find.start}
					active={find.open}
					disabled={!doc}
					data-testid="reflow-find"
				>
					<Search size={20} />
				</IconButton>
			}
			find={
				find.open ? (
					<FindBar
						state={find.state}
						onQuery={find.setQuery}
						onStep={find.step}
						onClose={find.close}
					/>
				) : undefined
			}
		>
			<div ref={scroller} className={d.scroller} data-testid="reflow-scroll">
				{doc && (
					<div className={d.pages} style={{ zoom, width: "100%" }}>
						<p className={d.banner}>{note}</p>
						<div ref={content}>
							{doc.kind === "document" ? (
								<article className={d.paper}>
									<Blocks blocks={doc.blocks} />
								</article>
							) : (
								doc.slides.map((slide, i) => (
									<section key={i}>
										<p className={d.slideNum}>Slide {i + 1}</p>
										<div className={d.slideText}>
											<Blocks blocks={slide} />
										</div>
									</section>
								))
							)}
						</div>
					</div>
				)}
			</div>
			{!result && (
				<StateView>
					<Spinner label="Opening document" />
				</StateView>
			)}
			{result && !result.ok && (
				<StateView
					icon={<ErrorArt />}
					title={
						result.reason === "password"
							? "Password protected"
							: "Can't open this file"
					}
					action={<Button onClick={onClose}>Close</Button>}
				>
					{result.reason === "password"
						? "Encrypted Office documents can't be opened."
						: "The file is damaged or uses a variant Paperwren can't read."}
				</StateView>
			)}
			{doc &&
				(doc.kind === "document"
					? doc.blocks.length === 0
					: doc.slides.length === 0) && (
					<StateView title="No text found">
						This file has no readable text.
					</StateView>
				)}
		</Shell>
	);
}
