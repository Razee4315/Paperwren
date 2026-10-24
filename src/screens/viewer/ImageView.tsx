import { backend } from "@/lib/backend";
import { isDesktop } from "@/lib/env";
import { exifDate, readExif } from "@/lib/exif";
import { formatNumber, locale, t, tn } from "@/lib/i18n";
import { type Pictures, readPictures, systemDecode } from "@/lib/pictures";
import { idForReopen } from "@/lib/recents";
import { picturesAround } from "@/lib/siblings";
import type { OpenRequest } from "@/lib/types";
import { useSettings } from "@/state/settings";
import { Button, ErrorArt, IconButton, SheetItem, StateView } from "@/ui";
import {
	ChevronLeft,
	ChevronRight,
	FlipHorizontal2,
	FlipVertical2,
	ImageDown,
	RotateCcw,
	RotateCw,
	ScanLine,
} from "lucide-react";
import {
	useContext,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { PageJump } from "./Dialogs";
import { ViewerFileContext } from "./FileMenu";
import s from "./Image.module.css";
import {
	type BookmarkSource,
	Shell,
	ZoomControl,
	percentPresets,
	shellStyles,
} from "./Shell";
import { useZoom, useZoomLevel } from "./hooks";
import { pageFileName, savePicture } from "./savePicture";
import type { ViewerProps } from "./types";

const ZOOM_LEVELS = [25, 50, 100, 200, 400];
/** A swipe this long, mostly sideways, turns to the next picture. */
const SWIPE = 60;

/** How a picture is turned and mirrored on screen. */
interface Pose {
	turn: number;
	flipX: boolean;
	flipY: boolean;
}

/** A picture as it is shown (turned, mirrored), as a file to print. */
async function posed(image: HTMLImageElement, pose: Pose): Promise<string> {
	const { turn, flipX, flipY } = pose;
	const sideways = turn % 180 !== 0;
	const canvas = document.createElement("canvas");
	canvas.width = sideways ? image.naturalHeight : image.naturalWidth;
	canvas.height = sideways ? image.naturalWidth : image.naturalHeight;
	const context = canvas.getContext("2d");
	if (!context) return image.src;
	context.translate(canvas.width / 2, canvas.height / 2);
	context.rotate((turn * Math.PI) / 180);
	context.scale(flipX ? -1 : 1, flipY ? -1 : 1);
	context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
	const blob = await new Promise<Blob | null>((resolve) =>
		canvas.toBlob(resolve, "image/png"),
	);
	canvas.width = canvas.height = 0;
	return blob ? URL.createObjectURL(blob) : image.src;
}

/** A picture's own place: "34.0525° N, 118.2500° W". */
function place([lat, lon]: [number, number]): string {
	const part = (v: number, pos: string, neg: string) =>
		`${Math.abs(v).toFixed(4)}° ${v >= 0 ? pos : neg}`;
	return `${part(lat, "N", "S")}, ${part(lon, "E", "W")}`;
}

/** Pictures: a photo or a scan (PNG, JPEG, GIF, WebP, BMP, SVG, AVIF,
 * HEIC, TIFF), and pictures that come several to a file (a TIFF's
 * pages, a comic book). Fitted to the screen, zoomable, turned and
 * mirrored at will; several turn like pages. */
export default function ImageView({
	data,
	name,
	format,
	position,
	onPosition,
	onClose,
	active,
}: ViewerProps) {
	const { settings } = useSettings();
	const scroller = useRef<HTMLDivElement>(null);
	const stage = useRef<HTMLDivElement>(null);
	const frame = useRef<HTMLDivElement>(null);
	const picture = useRef<HTMLImageElement>(null);
	const hud = useRef<HTMLDivElement>(null);
	const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
	const [failed, setFailed] = useState<"damaged" | "unshown" | null>(null);
	const [fit, setFit] = useState(1);
	const [zoom, commit] = useZoomLevel();
	// Quarter turns clockwise: 0, 90, 180, 270; and mirrored either way.
	const [pose, setPose] = useState<Pose>({
		turn: 0,
		flipX: false,
		flipY: false,
	});
	const { turn } = pose;
	const [chromeHidden, setChromeHidden] = useState(false);

	// --- the file's pictures, and the one on show ---
	const [pictures, setPictures] = useState<Pictures | null>(null);
	useEffect(() => {
		let alive = true;
		setPictures(null);
		readPictures(data, format)
			.then((found) => {
				if (!alive) return;
				if (!found.count) setFailed("damaged");
				setPictures(found);
			})
			.catch(() => alive && setFailed("damaged"));
		return () => {
			alive = false;
		};
	}, [data, format]);
	const count = pictures?.count ?? 0;
	const several = count > 1;
	const [index, setIndex] = useState(() =>
		position?.kind === "pages" && settings.rememberPosition ? position.page : 0,
	);
	const shown = Math.min(index, Math.max(0, count - 1));

	// Made and revoked by the same effect, so a re-run never leaves the
	// picture pointing at a revoked URL.
	const [url, setUrl] = useState<string | null>(null);
	const decoded = useRef(false);
	useEffect(() => {
		if (!pictures) return;
		let alive = true;
		let made: string | null = null;
		decoded.current = false;
		setNatural(null);
		setFailed(null);
		pictures
			.page(shown)
			.then((blob) => {
				if (!alive) return;
				made = URL.createObjectURL(blob);
				setUrl(made);
			})
			.catch(() => alive && setFailed("damaged"));
		return () => {
			alive = false;
			if (made) URL.revokeObjectURL(made);
		};
	}, [pictures, shown]);

	/** The webview cannot draw it (HEIC on Windows or Android): the
	 * system may, as a JPEG. */
	const drawElsewhere = async () => {
		if (decoded.current || !pictures) return setFailed("unshown");
		decoded.current = true;
		const blob = await pictures.page(shown);
		const jpeg = await systemDecode(new Uint8Array(await blob.arrayBuffer()));
		if (!jpeg) return setFailed("unshown");
		setUrl(URL.createObjectURL(jpeg));
	};

	// The place among several, kept for next time.
	const onPositionRef = useRef(onPosition);
	onPositionRef.current = onPosition;
	useEffect(() => {
		if (!several || !settings.rememberPosition) return;
		const timer = window.setTimeout(
			() => onPositionRef.current({ kind: "pages", page: shown }),
			300,
		);
		return () => window.clearTimeout(timer);
	}, [several, shown, settings.rememberPosition]);

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

	// --- several pictures: turned like pages ---
	const goTo = (n: number) => {
		if (n < 0 || n >= count) return;
		setIndex(n);
		zoomTo(1);
	};
	const goToRef = useRef(goTo);
	goToRef.current = goTo;
	const shownRef = useRef(shown);
	shownRef.current = shown;

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
		onTap: (_target, x) => {
			// Several pictures turn with a tap on either side, as a book's
			// pages do; one alone where the reader asked for that.
			const box = scroller.current?.getBoundingClientRect();
			if (box && (several || settings.tapToTurn)) {
				const at = (x - box.left) / box.width;
				const dir = at < 0.25 ? -1 : at > 0.75 ? 1 : 0;
				if (dir) return stepRef.current(dir);
			}
			setChromeHidden((h) => !h);
		},
	});
	const scale = fit * zoom;
	const rotate = (by: 90 | -90) => {
		setPose((now) => ({ ...now, turn: (now.turn + by + 360) % 360 }));
		zoomTo(1);
	};
	const flip = (axis: "flipX" | "flipY") =>
		setPose((now) => ({ ...now, [axis]: !now[axis] }));

	// A swipe across turns to the next picture, while it fits the screen.
	const fitted = Math.abs(zoom - 1) < 0.01;
	useEffect(() => {
		const el = scroller.current;
		if (!el || !several || !fitted) return;
		let from: { x: number; y: number } | null = null;
		const onStart = (e: TouchEvent) => {
			from =
				e.touches.length === 1
					? { x: e.touches[0].clientX, y: e.touches[0].clientY }
					: null;
		};
		const onEnd = (e: TouchEvent) => {
			const start = from;
			from = null;
			const touch = e.changedTouches[0];
			if (!start || !touch) return;
			const dx = touch.clientX - start.x;
			const dy = touch.clientY - start.y;
			if (Math.abs(dx) > SWIPE && Math.abs(dx) > 2 * Math.abs(dy))
				goToRef.current(shownRef.current + (dx < 0 ? 1 : -1));
		};
		el.addEventListener("touchstart", onStart, { passive: true });
		el.addEventListener("touchend", onEnd);
		return () => {
			el.removeEventListener("touchstart", onStart);
			el.removeEventListener("touchend", onEnd);
		};
	}, [several, fitted]);

	// --- one picture: the others of its folder, to step through ---
	const context = useContext(ViewerFileContext);
	const file = context?.file;
	const openOther = context?.openOther;
	const [beside, setBeside] = useState<OpenRequest[]>([]);
	useEffect(() => {
		if (!file || !openOther) return;
		let alive = true;
		const here = picturesAround(idForReopen(file.reopen));
		if (here.length) setBeside(here);
		else if (isDesktop)
			backend
				.picturesBeside(file)
				.then((list) => alive && setBeside(list))
				.catch(() => {});
		return () => {
			alive = false;
		};
	}, [file, openOther]);
	const fileId = file ? idForReopen(file.reopen) : "";
	const at = beside.findIndex((other) => other.id === fileId);
	const stepFolder = (dir: 1 | -1) => {
		const other = at >= 0 ? beside[at + dir] : undefined;
		if (other) openOther?.(other);
	};
	const stepping = !several && at >= 0 && beside.length > 1;
	const step = (dir: 1 | -1) => (several ? goTo(shown + dir) : stepFolder(dir));
	const stepRef = useRef(step);
	stepRef.current = step;

	// --- what the file says ---
	const details = useMemo<Array<[string, string]>>(() => {
		const rows: Array<[string, string | undefined]> = [
			[
				t("Size in pixels"),
				natural ? `${natural.w} × ${natural.h}` : undefined,
			],
			[t("Pages"), several ? String(count) : undefined],
		];
		const facts = readExif(new Uint8Array(data));
		const taken = exifDate(facts.taken);
		rows.push(
			[t("Camera"), facts.camera],
			[t("Lens"), facts.lens],
			[
				t("Taken"),
				taken
					? taken.toLocaleString(locale(), {
							dateStyle: "medium",
							timeStyle: "short",
						})
					: undefined,
			],
			[t("Exposure"), facts.exposure],
			[t("Place"), facts.place ? place(facts.place) : undefined],
		);
		return rows.filter((row): row is [string, string] => !!row[1]);
	}, [data, natural, several, count]);

	const marks = useMemo<BookmarkSource | undefined>(
		() =>
			several
				? {
						here: () => ({
							label: t("Page {n}", { n: shownRef.current + 1 }),
							position: { kind: "pages", page: shownRef.current },
						}),
						go: (p) => {
							if (p.kind === "pages") goToRef.current(p.page);
						},
					}
				: undefined,
		[several],
	);

	const { flipX, flipY } = pose;
	const mirror =
		flipX || flipY ? ` scale(${flipX ? -1 : 1}, ${flipY ? -1 : 1})` : "";

	return (
		<Shell
			name={name}
			format={format}
			onClose={onClose}
			active={active}
			hud={hud}
			chromeHidden={chromeHidden}
			onStep={several || stepping ? step : undefined}
			details={details}
			bookmarks={marks}
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
								<SheetItem
									icon={<FlipHorizontal2 size={20} />}
									checked={flipX}
									onClick={() => {
										close();
										flip("flipX");
									}}
									testId="image-flip-x"
								>
									{t("Mirror left to right")}
								</SheetItem>
								<SheetItem
									icon={<FlipVertical2 size={20} />}
									checked={flipY}
									onClick={() => {
										close();
										flip("flipY");
									}}
									testId="image-flip-y"
								>
									{t("Mirror top to bottom")}
								</SheetItem>
								{several && pictures && (
									<SheetItem
										icon={<ImageDown size={20} />}
										hint={t("Page {n}, as a picture of its own", {
											n: shown + 1,
										})}
										onClick={() => {
											close();
											const n = shown;
											const showing = picture.current;
											void savePicture(async () => {
												// As it is shown: turned or mirrored, it is drawn
												// again; otherwise its own bytes, untouched.
												let blob = await pictures.page(n);
												if ((turn || flipX || flipY) && showing) {
													const made = await posed(showing, pose);
													blob = await (await fetch(made)).blob();
													if (made !== showing.src) URL.revokeObjectURL(made);
												}
												const type = blob.type || "image/png";
												return {
													bytes: new Uint8Array(await blob.arrayBuffer()),
													type,
													name: pageFileName(name, n + 1, type),
												};
											}, context?.openOver);
										}}
										testId="image-save-page"
									>
										{t("Save this picture")}
									</SheetItem>
								)}
								{!several && context?.openTools && (
									<SheetItem
										icon={<ScanLine size={20} />}
										hint={t("Straighten it and clean it up as a PDF")}
										onClick={() => {
											close();
											context.openTools?.("scan");
										}}
										testId="image-scan"
									>
										{t("Scan this photo")}
									</SheetItem>
								)}
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
								onClick={() => stepFolder(-1)}
								data-testid="image-prev"
							>
								<ChevronLeft size={20} className="pw-flip" />
							</IconButton>
							<IconButton
								label={t("Next picture")}
								shortcut="→"
								disabled={at >= beside.length - 1}
								onClick={() => stepFolder(1)}
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
				size && url && pictures
					? async (root) => {
							// Every picture of several; the one shown as it is shown.
							const add = (src: string) => {
								const page = new Image();
								page.className = `pw-page ${s.printed}`;
								page.src = src;
								root.appendChild(page);
								return page;
							};
							if (several) {
								for (let i = 0; i < count; i++) {
									const src = URL.createObjectURL(await pictures.page(i));
									add(src).onload = () => URL.revokeObjectURL(src);
								}
								return;
							}
							const showing = picture.current;
							if ((turn || flipX || flipY) && showing) {
								const made = await posed(showing, pose);
								add(made).onload = () => {
									if (made !== url) URL.revokeObjectURL(made);
								};
							} else add(url);
						}
					: undefined
			}
			pager={
				size ? (
					<>
						{several ? (
							<PageJump
								page={shown + 1}
								pages={count}
								onGo={(n) => goTo(n - 1)}
								testId="picture"
							/>
						) : (
							<span className={shellStyles.meta} data-testid="image-size">
								{formatNumber(size.w)} × {formatNumber(size.h)}
							</span>
						)}
						<ZoomControl
							label={fitted ? t("Fit") : `${Math.round(scale * 100)}%`}
							onOut={() => zoomBy(1 / 1.25)}
							onIn={() => zoomBy(1.25)}
							onReset={() => zoomTo(1)}
							resetLabel={t("Fit to screen")}
							presets={[
								{
									label: t("Fit"),
									run: () => zoomTo(1),
									on: fitted,
								},
								...percentPresets(ZOOM_LEVELS, scale, (to) => zoomTo(to / fit)),
							]}
							testId="image"
						/>
					</>
				) : undefined
			}
		>
			<div
				ref={scroller}
				className={`${s.scroller} ${several && fitted ? s.paged : ""}`}
				data-testid="image-scroll"
			>
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
								alt={several ? t("Page {n}", { n: shown + 1 }) : name}
								draggable={false}
								style={
									turn && natural
										? {
												width: natural.w * scale,
												height: natural.h * scale,
												transform: `translate(-50%, -50%) rotate(${turn}deg)${mirror}`,
											}
										: mirror
											? { transform: mirror.trim() }
											: undefined
								}
								onLoad={(e) =>
									setNatural({
										w: e.currentTarget.naturalWidth,
										h: e.currentTarget.naturalHeight,
									})
								}
								onError={() =>
									pictures?.type === "image/heic"
										? drawElsewhere()
										: setFailed("damaged")
								}
								data-testid="image"
								data-turn={turn}
								data-page={several ? shown + 1 : undefined}
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
					testId="image-error"
				>
					{failed === "unshown"
						? t(
								"This device can't draw HEIC pictures. Open it in another app from the menu.",
							)
						: t(
								"The file is damaged or isn't a picture format Paperwren shows.",
							)}
				</StateView>
			)}
			{several && !size && !failed && (
				<span className={s.counting}>
					{tn(count, "{n} picture", "{n} pictures")}
				</span>
			)}
		</Shell>
	);
}
