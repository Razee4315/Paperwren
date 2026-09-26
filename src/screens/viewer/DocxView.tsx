import { Button, ErrorArt, IconButton, Spinner, StateView } from "@/ui";
import { Search, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import s from "./Doc.module.css";
import { FindBar, Shell, shellStyles } from "./Shell";
import { usePinchZoom, useScrollMemory } from "./hooks";
import type { ViewerProps } from "./types";
import { useDomFind } from "./useDomFind";

/** Word (.docx) with docx-preview: the document's own page layout,
 * fitted to the screen width, pinch-zoomable. */
export default function DocxView({
	data,
	name,
	format,
	position,
	onPosition,
	onClose,
	active,
}: ViewerProps) {
	const scroller = useRef<HTMLDivElement>(null);
	const host = useRef<HTMLDivElement>(null);
	const [status, setStatus] = useState<"loading" | "ready" | "error">(
		"loading",
	);
	const [zoom, setZoom] = useState(1);
	const [fit, setFit] = useState(1);
	const find = useDomFind(host, scroller);

	useEffect(() => {
		let cancelled = false;
		const staging = document.createElement("div");
		(async () => {
			try {
				const docx = await import("docx-preview");
				await docx.renderAsync(data.slice(0), staging, staging, {
					inWrapper: true,
					breakPages: true,
					ignoreLastRenderedPageBreak: false,
					experimental: true,
					useBase64URL: true,
				});
				if (cancelled || !host.current) return;
				if (!staging.querySelector("section.docx")) throw new Error("empty");
				host.current.replaceChildren(...staging.childNodes);
				setStatus("ready");
			} catch {
				if (!cancelled) setStatus("error");
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [data]);

	// Fit the widest page to the viewport; follow rotation/resizes.
	useLayoutEffect(() => {
		const el = scroller.current;
		if (status !== "ready" || !el || !host.current) return;
		const measure = () => {
			let widest = 0;
			for (const sec of host.current?.querySelectorAll<HTMLElement>(
				"section.docx",
			) ?? []) {
				widest = Math.max(widest, sec.offsetWidth);
			}
			if (widest > 0) setFit(Math.min(1.5, (el.clientWidth - 24) / widest));
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	}, [status]);

	useEffect(() => {
		if (position?.kind === "scroll" && position.zoom) setZoom(position.zoom);
	}, [position]);

	const scale = fit * zoom;
	usePinchZoom(scroller, zoom, setZoom, 0.5, 5);
	useScrollMemory(scroller, status === "ready", position, onPosition, zoom);

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
					disabled={status !== "ready"}
					data-testid="doc-find"
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
			bottom={
				status === "ready" ? (
					<div className={shellStyles.pager}>
						<span />
						<div className={shellStyles.group}>
							<IconButton
								label="Zoom out"
								onClick={() => setZoom((z) => Math.max(0.5, z / 1.25))}
							>
								<ZoomOut size={20} />
							</IconButton>
							<button
								type="button"
								className={shellStyles.pill}
								onClick={() => setZoom(1)}
								data-testid="doc-fit"
							>
								{zoom === 1 ? "Fit width" : `${Math.round(scale * 100)}%`}
							</button>
							<IconButton
								label="Zoom in"
								onClick={() => setZoom((z) => Math.min(5, z * 1.25))}
							>
								<ZoomIn size={20} />
							</IconButton>
						</div>
					</div>
				) : undefined
			}
		>
			<div ref={scroller} className={s.scroller} data-testid="doc-scroll">
				<div className={`${s.pages} ${s.docx}`} style={{ zoom: scale }}>
					<div ref={host} />
				</div>
			</div>
			{status === "loading" && (
				<StateView>
					<Spinner label="Opening document" />
				</StateView>
			)}
			{status === "error" && (
				<StateView
					icon={<ErrorArt />}
					title="Can't open this document"
					action={<Button onClick={onClose}>Close</Button>}
				>
					The file is damaged or isn't a valid Word document.
				</StateView>
			)}
		</Shell>
	);
}
