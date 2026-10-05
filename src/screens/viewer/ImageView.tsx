import { backend } from "@/lib/backend";
import { isDesktop } from "@/lib/env";
import { t } from "@/lib/i18n";
import { sniffImageType } from "@/lib/sniff";
import type { OpenRequest } from "@/lib/types";
import { Button, ErrorArt, IconButton, SheetItem, StateView } from "@/ui";
import { ChevronLeft, ChevronRight, RotateCcw, RotateCw } from "lucide-react";
import {
	useContext,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { ViewerFileContext } from "./FileMenu";
import s from "./Image.module.css";
import { Shell, ZoomControl, percentPresets, shellStyles } from "./Shell";
import { useZoom, useZoomLevel } from "./hooks";
import type { ViewerProps } from "./types";

const ZOOM_LEVELS = [25, 50, 100, 200, 400];

/** A picture turned by `turn` degrees, as a file to print. */
async function turned(image: HTMLImageElement, turn: number): Promise<string> {
	const sideways = turn % 180 !== 0;
	const canvas = document.createElement("canvas");
	canvas.width = sideways ? image.naturalHeight : image.naturalWidth;
	canvas.height = sideways ? image.naturalWidth : image.naturalHeight;
	const context = canvas.getContext("2d");
	if (!context) return image.src;
	context.translate(canvas.width / 2, canvas.height / 2);
	context.rotate((turn * Math.PI) / 180);
	context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
	const blob = await new Promise<Blob | null>((resolve) =>
		canvas.toBlob(resolve, "image/png"),
	);
	canvas.width = canvas.height = 0;
	return blob ? URL.createObjectURL(blob) : image.src;
}

/** Pictures (PNG, JPEG, GIF, WebP, BMP): a scanned page or a photo of
 * a document is still a document. Fitted to the screen, zoomable, and
 * turned the right way up when it was taken sideways. */
export default function ImageView({
	data,
	name,
	format,
	onClose,
	active,
}: ViewerProps) {
	const scroller = useRef<HTMLDivElement>(null);
	const stage = useRef<HTMLDivElement>(null);
	const frame = useRef<HTMLDivElement>(null);
	const picture = useRef<HTMLImageElement>(null);
	const hud = useRef<HTMLDivElement>(null);
	const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
	const [failed, setFailed] = useState(false);
	const [fit, setFit] = useState(1);
	const [zoom, commit] = useZoomLevel();
	// Quarter turns clockwise: 0, 90, 180, 270.
	const [turn, setTurn] = useState(0);
	const [chromeHidden, setChromeHidden] = useState(false);

	// Made and revoked by the same effect, so a re-run never leaves the
	// picture pointing at a revoked URL.
	const [url, setUrl] = useState<string | null>(null);
	useEffect(() => {
		const type = sniffImageType(new Uint8Array(data)) ?? "image/png";
		const made = URL.createObjectURL(new Blob([data], { type }));
		setUrl(made);
		return () => URL.revokeObjectURL(made);
	}, [data]);

	// The picture as it stands on screen: a quarter turn swaps its sides.
	const size =
		natural && turn % 180 !== 0 ? { w: natural.h, h: natural.w } : natural;

	// t("Fit") shows the whole picture, never enlarged past its own pixels.
	const wide = size?.w ?? 0;
	const tall = size?.h ?? 0;
	useLayoutEffect(() => {
		const el = scroller.current;
		if (!el || !wide || !tall) return;
		const measure = () =>
			setFit(
				Math.min(
					1,
					(el.clientWidth - 16) / wide,
					(el.clientHeight - 16) / tall,
				),
			);
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	}, [wide, tall]);

	const { zoomBy, zoomTo } = useZoom({
		scroller,
		content: frame,
		stage,
		zoom,
		commit,
		hud,
		// From a thumbnail of itself up to well past its own pixels.
		min: 0.5,
		max: Math.max(8, 4 / fit),
		label: (z) => `${Math.round(fit * z * 100)}%`,
		enabled: !!size,
		active,
		onTap: () => setChromeHidden((h) => !h),
	});
	const scale = fit * zoom;
	const rotate = (by: 90 | -90) => {
		setTurn((now) => (now + by + 360) % 360);
		zoomTo(1);
	};

	// The other pictures of the folder this one was opened from, to step
	// through with the arrow keys (desktop: a phone hands over one file,
	// not the folder around it).
	const context = useContext(ViewerFileContext);
	const file = context?.file;
	const openOther = context?.openOther;
	const [beside, setBeside] = useState<OpenRequest[]>([]);
	useEffect(() => {
		if (!isDesktop || !file || !openOther) return;
		let alive = true;
		backend
			.picturesBeside(file)
			.then((list) => alive && setBeside(list))
			.catch(() => {});
		return () => {
			alive = false;
		};
	}, [file, openOther]);
	const at = beside.findIndex(
		(other) =>
			other.reopen.kind === "path" &&
			file?.reopen.kind === "path" &&
			other.reopen.path === file.reopen.path,
	);
	const step = (dir: 1 | -1) => {
		const other = at >= 0 ? beside[at + dir] : undefined;
		if (other) openOther?.(other);
	};
	const stepping = at >= 0 && beside.length > 1;

	return (
		<Shell
			name={name}
			format={format}
			onClose={onClose}
			active={active}
			hud={hud}
			chromeHidden={chromeHidden}
			onStep={stepping ? step : undefined}
			menu={
				size
					? (close) => (
							<>
								<SheetItem
									icon={<RotateCw size={20} />}
									onClick={() => {
										close();
										rotate(90);
									}}
									testId="image-rotate"
								>
									{t("Rotate")}
								</SheetItem>
								<SheetItem
									icon={<RotateCcw size={20} />}
									onClick={() => {
										close();
										rotate(-90);
									}}
									testId="image-rotate-left"
								>
									{t("Rotate left")}
								</SheetItem>
							</>
						)
					: undefined
			}
			actions={
				<>
					{stepping && (
						<>
							<IconButton
								label={t("Previous picture")}
								shortcut="←"
								disabled={at <= 0}
								onClick={() => step(-1)}
								data-testid="image-prev"
							>
								<ChevronLeft size={20} className="pw-flip" />
							</IconButton>
							<IconButton
								label={t("Next picture")}
								shortcut="→"
								disabled={at >= beside.length - 1}
								onClick={() => step(1)}
								data-testid="image-next"
							>
								<ChevronRight size={20} className="pw-flip" />
							</IconButton>
						</>
					)}
					{size && isDesktop && (
						<IconButton
							label={t("Rotate")}
							onClick={() => rotate(90)}
							data-testid="image-rotate-button"
						>
							<RotateCw size={18} />
						</IconButton>
					)}
				</>
			}
			onPrint={
				size && url
					? async (root) => {
							const page = new Image();
							page.className = `pw-page ${s.printed}`;
							const shown = picture.current;
							if (turn && shown) {
								page.src = await turned(shown, turn);
								const made = page.src;
								page.onload = () => {
									if (made !== url) URL.revokeObjectURL(made);
								};
							} else page.src = url;
							root.appendChild(page);
						}
					: undefined
			}
			pager={
				size ? (
					<>
						<span className={shellStyles.meta} data-testid="image-size">
							{size.w.toLocaleString()} × {size.h.toLocaleString()}
						</span>
						<ZoomControl
							label={
								Math.abs(zoom - 1) < 0.005
									? t("Fit")
									: `${Math.round(scale * 100)}%`
							}
							onOut={() => zoomBy(1 / 1.25)}
							onIn={() => zoomBy(1.25)}
							onReset={() => zoomTo(1)}
							resetLabel={t("Fit to screen")}
							presets={[
								{
									label: t("Fit"),
									run: () => zoomTo(1),
									on: Math.abs(zoom - 1) < 0.005,
								},
								...percentPresets(ZOOM_LEVELS, scale, (to) => zoomTo(to / fit)),
							]}
							testId="image"
						/>
					</>
				) : undefined
			}
		>
			<div ref={scroller} className={s.scroller} data-testid="image-scroll">
				<div ref={stage} className={s.stage}>
					<div
						ref={frame}
						className={s.frame}
						style={
							size
								? { width: size.w * scale, height: size.h * scale }
								: undefined
						}
					>
						{!failed && url && (
							<img
								ref={picture}
								className={`${s.picture} ${turn ? s.turned : ""}`}
								src={url}
								alt={name}
								draggable={false}
								style={
									turn && natural
										? {
												width: natural.w * scale,
												height: natural.h * scale,
												transform: `translate(-50%, -50%) rotate(${turn}deg)`,
											}
										: undefined
								}
								onLoad={(e) =>
									setNatural({
										w: e.currentTarget.naturalWidth,
										h: e.currentTarget.naturalHeight,
									})
								}
								onError={() => setFailed(true)}
								data-testid="image"
								data-turn={turn}
							/>
						)}
					</div>
				</div>
			</div>
			{failed && (
				<StateView
					icon={<ErrorArt />}
					title={t("Can't show this picture")}
					action={<Button onClick={onClose}>{t("Close")}</Button>}
				>
					{t("The file is damaged or isn't a picture format Paperwren shows.")}
				</StateView>
			)}
		</Shell>
	);
}
