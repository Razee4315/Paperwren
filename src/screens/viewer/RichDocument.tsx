import type { RichBlock, RichDoc, RichPara, RichRun } from "@/lib/office/model";
import { type CSSProperties, useEffect, useState } from "react";
import d from "./Doc.module.css";

const FALLBACK = ", Calibri, Arial, sans-serif";

function Runs({ runs, urls }: { runs: RichRun[]; urls: string[] }) {
	return (
		<>
			{runs.map((r, i) => {
				if (r.image) {
					const src = urls[r.image.media];
					return src ? (
						<img
							key={i}
							className={d.richImage}
							src={src}
							alt=""
							width={r.image.width || undefined}
							height={r.image.height || undefined}
							draggable={false}
						/>
					) : null;
				}
				const decoration = [
					r.underline && "underline",
					r.strike && "line-through",
				]
					.filter(Boolean)
					.join(" ");
				const style: CSSProperties = {
					fontWeight: r.bold ? 700 : undefined,
					fontStyle: r.italic ? "italic" : undefined,
					textDecoration: decoration || undefined,
					fontSize: r.size ? `${r.size}pt` : undefined,
					color: r.color,
					background: r.highlight,
					fontFamily: r.font ? `'${r.font}'${FALLBACK}` : undefined,
					verticalAlign: r.script,
				};
				if (r.script) style.fontSize = "0.7em";
				return r.href ? (
					<a
						key={i}
						href={r.href}
						target="_blank"
						rel="noopener noreferrer nofollow"
						style={style}
					>
						{r.text}
					</a>
				) : (
					<span key={i} style={style}>
						{r.text}
					</span>
				);
			})}
		</>
	);
}

function Paragraph({ p, urls }: { p: RichPara; urls: string[] }) {
	const Tag = p.heading ? (`h${Math.min(6, p.heading)}` as "h1") : "p";
	const style: CSSProperties = {
		textAlign: p.align,
		paddingInlineStart: p.list
			? 28 + p.list.level * 24
			: p.indent
				? Math.min(p.indent, 160)
				: undefined,
	};
	return (
		<>
			{p.pageBreak && <hr className={d.pageBreak} />}
			<Tag
				className={p.list ? d.listItem : undefined}
				style={style}
				dir={p.rtl ? "rtl" : "auto"}
			>
				{p.list && <span className={d.marker}>{p.list.marker}</span>}
				<Runs runs={p.runs} urls={urls} />
			</Tag>
		</>
	);
}

function Blocks({ blocks, urls }: { blocks: RichBlock[]; urls: string[] }) {
	return (
		<>
			{blocks.map((b, i) => {
				if (b.kind === "para") return <Paragraph key={i} p={b} urls={urls} />;
				const total = b.cols?.reduce((sum, w) => sum + w, 0) ?? 0;
				return (
					<div key={i} className={d.tableWrap}>
						{/* Keep the file's column proportions, but shrink to the
						    screen: text wraps instead of running off the page. */}
						<table
							className={d.richTable}
							style={
								total
									? {
											width: "100%",
											maxWidth: total,
											minWidth: Math.min(total, (b.cols?.length ?? 1) * 36),
										}
									: undefined
							}
						>
							{b.cols && total > 0 && (
								<colgroup>
									{b.cols.map((w, c) => (
										<col key={c} style={{ width: `${(w / total) * 100}%` }} />
									))}
								</colgroup>
							)}
							<tbody>
								{b.rows.map((row, r) => (
									<tr key={r}>
										{row.map((cell, c) => (
											<td
												key={c}
												colSpan={cell.colSpan}
												rowSpan={cell.rowSpan}
												style={{
													background: cell.fill,
													width: b.cols ? undefined : cell.width,
												}}
											>
												<Blocks blocks={cell.blocks} urls={urls} />
											</td>
										))}
									</tr>
								))}
							</tbody>
						</table>
					</div>
				);
			})}
		</>
	);
}

/** A legacy Word / OpenDocument text file with its formatting, lists,
 * tables and pictures, flowing to the width of the screen. */
export function RichDocument({ doc }: { doc: RichDoc }) {
	// Made and revoked by the same effect, so a re-run never leaves the
	// pictures pointing at revoked URLs.
	const [urls, setUrls] = useState<string[]>([]);
	useEffect(() => {
		const made = doc.media.map((m) =>
			URL.createObjectURL(new Blob([m.bytes as BlobPart], { type: m.type })),
		);
		setUrls(made);
		return () => {
			for (const url of made) URL.revokeObjectURL(url);
		};
	}, [doc]);
	return (
		<article className={`${d.paper} ${d.rich}`}>
			<Blocks blocks={doc.blocks} urls={urls} />
		</article>
	);
}
