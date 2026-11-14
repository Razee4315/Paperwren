import { deflateSync } from "node:zlib";

export const bytes = (s: string) => Uint8Array.from(Buffer.from(s, "latin1"));
export const text = (b: Uint8Array) => Buffer.from(b).toString("latin1");
export const stream = (s: string, dict = "") =>
	`<< /Length ${s.length} ${dict} >>\nstream\n${s}\nendstream`;
export const page =
	"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 5 0 R >> /XObject << /X1 7 0 R >> >> /Contents 4 0 R /Annots [6 0 R] >>";
export const content = (s: string) =>
	stream(`BT /F1 18 Tf 40 700 Td (${s}) Tj ET`);
export const baseObjects = () =>
	new Map<number, string>([
		[1, "<< /Type /Catalog /Pages 2 0 R >>"],
		[2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"],
		[3, page],
		[4, content("Reader shown")],
		[5, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"],
		[
			6,
			"<< /Type /Annot /Subtype /Stamp /Rect [10 10 40 40] /AP << /N 7 0 R >> >>",
		],
		[
			7,
			stream(
				"0 0 20 20 re f",
				"/Type /XObject /Subtype /Form /BBox [0 0 20 20]",
			),
		],
		[8, "0"],
		[9, "(ordinary)"],
		[10, "0"],
	]);
type Entry = [number, number, number];

/** Offsets are byte offsets because every generated character is Latin-1. */
export class PdfBuilder {
	source: string;
	entries = new Map<number, Entry>();
	previous?: number;
	root = "1 0 R";
	size = 64;
	constructor(prefix?: Uint8Array) {
		this.source = prefix ? text(prefix) : "%PDF-1.7\n";
		if (prefix)
			this.previous = Number(
				this.source.match(/startxref\s+(\d+)\s+%%EOF\s*$/)?.[1],
			);
	}
	object(
		n: number,
		body: string,
		indexed = true,
		generation = 0,
		header = `${n} ${generation} obj\n`,
	) {
		const at = this.source.length;
		this.source += `${header}${body}\nendobj\n`;
		if (indexed) this.entries.set(n, [1, at, generation]);
		return at;
	}
	compressed(n: number, body: string, container: number, indexed = true) {
		const head = `${n} 0 `;
		this.object(
			container,
			stream(head + body, `/Type /ObjStm /N 1 /First ${head.length}`),
		);
		if (indexed) this.entries.set(n, [2, container, 0]);
	}
	xrefStream(n: number, entries: Map<number, Entry>, predictor = false) {
		const sorted = [...entries].sort(([a], [b]) => a - b);
		let previous = Buffer.alloc(7);
		const rows = sorted.map(([, [type, offset, gen]]) => {
			const row = Buffer.alloc(7);
			row[0] = type;
			row.writeUInt32BE(offset, 1);
			row.writeUInt16BE(gen, 5);
			const filtered = Buffer.from([
				2,
				...row.map((v, i) => (v - previous[i]) & 255),
			]);
			previous = row;
			return predictor ? filtered : row;
		});
		const raw = Buffer.concat(rows);
		const data = predictor ? deflateSync(raw) : raw;
		return this.object(
			n,
			stream(
				data.toString("latin1"),
				`/Type /XRef /Size ${this.size} /W [1 4 2] /Index [${sorted.map(([n]) => `${n} 1`).join(" ")}] /Root ${this.root}${this.previous === undefined ? "" : ` /Prev ${this.previous}`}${predictor ? " /Filter /FlateDecode /DecodeParms << /Predictor 12 /Columns 7 >>" : ""}`,
			),
			false,
		);
	}
	finish(
		mode: "table" | "stream" | "hybrid" = "table",
		supplement?: Map<number, Entry>,
		predictor = false,
	) {
		let hybrid: number | undefined;
		if (mode === "hybrid")
			hybrid = this.xrefStream(60, supplement ?? this.entries, predictor);
		if (mode === "stream") {
			const at = this.source.length;
			this.entries.set(60, [1, at, 0]);
			this.xrefStream(60, this.entries, predictor);
			return bytes(`${this.source}startxref\n${at}\n%%EOF\n`);
		}
		const at = this.source.length;
		this.source += "xref\n0 1\n0000000000 65535 f \n";
		for (const [n, [type, offset, gen]] of [...this.entries].sort(
			([a], [b]) => a - b,
		)) {
			if (type === 2) continue;
			this.source += `${n} 1\n${String(offset).padStart(10, "0")} ${String(gen).padStart(5, "0")} ${type === 0 ? "f" : "n"} \n`;
		}
		return bytes(
			`${this.source}trailer\n<< /Size ${this.size} /Root ${this.root}${this.previous === undefined ? "" : ` /Prev ${this.previous}`}${hybrid === undefined ? "" : ` /XRefStm ${hybrid}`} >>\nstartxref\n${at}\n%%EOF\n`,
		);
	}
}
