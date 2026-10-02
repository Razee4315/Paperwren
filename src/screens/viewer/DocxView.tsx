import { t } from "@/lib/i18n";
import { fitted } from "@/lib/print";
import { Button, ErrorArt, IconButton, Spinner, StateView } from "@/ui";
import { Search } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import "@/styles/office-fonts.css";
import { PageJump } from "./Dialogs";
import s from "./Doc.module.css";
import { Scrubber } from "./Scrubber";
import { FindBar, Shell, ZoomControl, shellStyles } from "./Shell";
import { useScrollMemory, useZoom, useZoomLevel } from "./hooks";
import type { ViewerProps } from "./types";
import { useDomFind } from "./useDomFind";

/** A page is never opened larger than this: on a wide window it sits
 * at a comfortable reading size instead of being stretched to fill it
 * (the same ceiling a PDF opens at). */
const MAX_FIT = 1.25;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 5;

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
	const stage = useRef<HTMLDivElement>(null);
	const hud = useRef<HTMLDivElement>(null);
	const pages = useRef<HTMLDivElement>(null);
	const host = useRef<HTMLDivElement>(null);
	const [status, setStatus] = useState<"loading" | "ready" | "error">(
		"loading",
	);
	const [zoom, commit] = useZoomLevel(position);
	const [fit, setFit] = useState(1);
	const [pageCount, setPageCount] = useState(0);
	const [page, setPage] = useState(1);
	const sheets = useRef<HTMLElement[]>([]);
	const [chromeHidden, setChromeHidden] = useState(false);
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
				const count = staging.querySelectorAll("section.docx").length;
				if (!count) throw new Error("empty");
				host.current.replaceChildren(...staging.childNodes);
				sheets.current = [
					...host.current.querySelectorAll<HTMLElement>("section.docx"),
				];
				setPageCount(count);
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
			// The 12px side padding sits inside the zoomed box and scales too.
			if (widest > 0)
				setFit(
					Math.min(
						MAX_FIT,
						Math.floor((el.clientWidth / (widest + 24)) * 1e3) / 1e3,
					),
				);
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	}, [status]);

	const scale = fit * zoom;
	const { zoomBy, zoomTo } = useZoom({
		scroller,
		content: pages,
		stage,
		zoom,
		commit,
		hud,
		label: (z) => `${Math.round(fit * z * 100)}%`,
		min: MIN_ZOOM,
		max: MAX_ZOOM,
		active,
		onTap: () => setChromeHidden((h) => !h),
	});
	useScrollMemory(scroller, status === "ready", position, onPosition, zoom);

	// Which page the reader is on: the one under a line a third of the
	// way down the screen (the last one, at the very end).
	// biome-ignore lint/correctness/useExhaustiveDependencies: a new scale moves every page
	useEffect(() => {
		const el = scroller.current;
		if (status !== "ready" || !el) return;
		let raf = 0;
		const update = () => {
			raf = 0;
			const list = sheets.current;
			let at = list.length - 1;
			if (el.scrollTop + el.clientHeight < el.scrollHeight - 2) {
				const line = el.getBoundingClientRect().top + el.clientHeight / 3;
				let lo = 0;
				let hi = at;
				while (lo < hi) {
					const mid = (lo + hi + 1) >> 1;
					if (list[mid].getBoundingClientRect().top <= line) lo = mid;
					else hi = mid - 1;
				}
				at = lo;
			}
			setPage(at + 1);
		};
		const onScroll = () => {
			if (!raf) raf = requestAnimationFrame(update);
		};
		update();
		el.addEventListener("scroll", onScroll, { passive: true });
		return () => {
			cancelAnimationFrame(raf);
			el.removeEventListener("scroll", onScroll);
		};
	}, [status, scale]);

	const goTo = (n: number) => {
		const el = scroller.current;
		const target = sheets.current[n - 1];
		if (!el || !target) return;
		el.scrollTop +=
			target.getBoundingClientRect().top - el.getBoundingClientRect().top - 8;
	};

	return (
		<Shell
			name={name}
			format={format}
			onClose={onClose}
			active={active}
			hud={hud}
			progressOf={scroller}
			chromeHidden={chromeHidden && !find.open}
			onFind={status === "ready" ? find.start : undefined}
			onPrint={
				status === "ready"
					? (root) => {
							const source = host.current;
							if (!source) return;
							let widest = 1;
							for (const page of source.querySelectorAll<HTMLElement>(
								"section.docx",
							))
								widest = Math.max(widest, page.offsetWidth);
							root.appendChild(fitted(source.cloneNode(true), widest, s.docx));
						}
					: undefined
			}
			actions={
				<IconButton
					label={t("Find")}
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
						<PageJump
							page={Math.min(page, pageCount)}
							pages={pageCount}
							onGo={goTo}
							testId="doc"
						/>
						<ZoomControl
							label={
								Math.abs(zoom - 1) < 0.005
									? t("Fit width")
									: `${Math.round(scale * 100)}%`
							}
							onOut={() => zoomBy(1 / 1.25)}
							onIn={() => zoomBy(1.25)}
							onReset={() => zoomTo(1)}
							resetLabel={t("Fit width")}
							testId="doc"
						/>
					</div>
				) : undefined
			}
		>
			<div ref={scroller} className={s.scroller} data-testid="doc-scroll">
				<div ref={stage} className={s.stage}>
					<div
						ref={pages}
						className={`${s.pages} ${s.docx}`}
						style={{ zoom: scale }}
					>
						<div ref={host} />
					</div>
				</div>
			</div>
			<Scrubber
				of={scroller}
				label={`${Math.min(page, pageCount)} / ${pageCount}`}
				enabled={status === "ready"}
			/>
			{status === "loading" && (
				<StateView>
					<Spinner label={t("Opening document")} />
				</StateView>
			)}
			{status === "error" && (
				<StateView
					icon={<ErrorArt />}
					title={t("Can't open this document")}
					action={<Button onClick={onClose}>{t("Close")}</Button>}
				>
					{t("The file is damaged or isn't a valid Word document.")}
				</StateView>
			)}
		</Shell>
	);
}
