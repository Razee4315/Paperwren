import { t } from "@/lib/i18n";
import { sniffImageType } from "@/lib/sniff";
import { Button, ErrorArt, StateView } from "@/ui";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import s from "./Image.module.css";
import { Shell, ZoomControl, shellStyles } from "./Shell";
import { useZoom, useZoomLevel } from "./hooks";
import type { ViewerProps } from "./types";

/** Pictures (PNG, JPEG, GIF, WebP, BMP): a scanned page or a photo of
 * a document is still a document. Fitted to the screen, zoomable. */
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
	const hud = useRef<HTMLDivElement>(null);
	const [size, setSize] = useState<{ w: number; h: number } | null>(null);
	const [failed, setFailed] = useState(false);
	const [fit, setFit] = useState(1);
	const [zoom, commit] = useZoomLevel();
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

	// t("Fit") shows the whole picture, never enlarged past its own pixels.
	useLayoutEffect(() => {
		const el = scroller.current;
		if (!el || !size) return;
		const measure = () =>
			setFit(
				Math.min(
					1,
					(el.clientWidth - 16) / size.w,
					(el.clientHeight - 16) / size.h,
				),
			);
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	}, [size]);

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

	return (
		<Shell
			name={name}
			format={format}
			onClose={onClose}
			active={active}
			hud={hud}
			chromeHidden={chromeHidden}
			onPrint={
				size && url
					? (root) => {
							const picture = new Image();
							picture.src = url;
							picture.className = `pw-page ${s.printed}`;
							root.appendChild(picture);
						}
					: undefined
			}
			bottom={
				size ? (
					<div className={shellStyles.pager}>
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
							testId="image"
						/>
					</div>
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
								className={s.picture}
								src={url}
								alt={name}
								draggable={false}
								onLoad={(e) =>
									setSize({
										w: e.currentTarget.naturalWidth,
										h: e.currentTarget.naturalHeight,
									})
								}
								onError={() => setFailed(true)}
								data-testid="image"
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
