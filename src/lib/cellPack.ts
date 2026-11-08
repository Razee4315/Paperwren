/**
 * A sheet's cells as they cross from the parse worker to the screen.
 *
 * As objects, one per cell, a big sheet (a 50,000-row export) arrives
 * as hundreds of thousands of them: the screen must unpack each and
 * index it again, and it stops while it does, for seconds on a slow
 * computer. Packed, the cells are one list of places (handed over, not
 * copied), one list of texts, and the few cells with anything more (a
 * style, a formula, a link, a note) on their own. The grid looks a
 * cell up where it lies and makes its object only when it is asked
 * for, which is only for the cells on screen.
 */

import type { GridCell } from "./workbookModel";

/** A cell's place as one number: its row, then its column (sheets
 * have at most 500 columns, so 1024 leaves room). */
export const cellKey = (r: number, c: number) => r * 1024 + c;

export interface PackedCells {
	/** Each cell's place, in order. */
	keys: Int32Array;
	/** Each cell's style, or -1 for the neutral look. */
	styles: Int32Array;
	values: string[];
	/** The cells with more than a value and a style: their index into
	 * the lists above, and the rest of them. */
	rich: Array<[number, Omit<GridCell, "value" | "style">]>;
}

/** What a sheet's cells are to the grid: Map's way of reading them. */
export interface Cells extends Iterable<[number, GridCell]> {
	get(key: number): GridCell | undefined;
	readonly size: number;
}

/** The cells, packed, in order of place. A place given twice keeps the
 * later cell, as a Map built from them would. */
export function packCells(
	cells: Array<[number, number, GridCell]>,
): PackedCells {
	const n = cells.length;
	const order = new Uint32Array(n);
	const places = new Int32Array(n);
	for (let i = 0; i < n; i++) {
		order[i] = i;
		places[i] = cellKey(cells[i][0], cells[i][1]);
	}
	order.sort((a, b) => places[a] - places[b] || a - b);
	const keys: number[] = [];
	const styles: number[] = [];
	const values: string[] = [];
	const rich: PackedCells["rich"] = [];
	for (let i = 0; i < n; i++) {
		const from = order[i];
		const place = places[from];
		// The same place again: the later cell replaces the earlier one.
		if (keys.length && keys[keys.length - 1] === place) {
			keys.pop();
			styles.pop();
			values.pop();
			if (rich.length && rich[rich.length - 1][0] === keys.length) rich.pop();
		}
		const { value, style, ...more } = cells[from][2];
		const at = keys.length;
		keys.push(place);
		styles.push(style ?? -1);
		values.push(value);
		let any = false;
		for (const k in more)
			if ((more as Record<string, unknown>)[k] !== undefined) {
				any = true;
				break;
			}
		if (any) rich.push([at, more]);
	}
	return {
		keys: Int32Array.from(keys),
		styles: Int32Array.from(styles),
		values,
		rich,
	};
}

/** Packed cells, read as a Map of place to cell. */
export class CellStore implements Cells {
	private readonly keys: Int32Array;
	private readonly styles: Int32Array;
	private readonly values: string[];
	private readonly rich: Map<number, Omit<GridCell, "value" | "style">>;
	/** The cells asked for so far: the same cell is the same object. */
	private readonly made = new Map<number, GridCell>();

	constructor(packed: PackedCells) {
		this.keys = packed.keys;
		this.styles = packed.styles;
		this.values = packed.values;
		this.rich = new Map(packed.rich);
	}

	get size(): number {
		return this.keys.length;
	}

	private indexOf(key: number): number {
		const keys = this.keys;
		let lo = 0;
		let hi = keys.length - 1;
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			const at = keys[mid];
			if (at === key) return mid;
			if (at < key) lo = mid + 1;
			else hi = mid - 1;
		}
		return -1;
	}

	private cell(i: number): GridCell {
		let cell = this.made.get(i);
		if (!cell) {
			const style = this.styles[i];
			cell = {
				value: this.values[i],
				...(style >= 0 ? { style } : {}),
				...this.rich.get(i),
			};
			this.made.set(i, cell);
		}
		return cell;
	}

	get(key: number): GridCell | undefined {
		const i = this.indexOf(key);
		return i < 0 ? undefined : this.cell(i);
	}

	/** Every cell, in order of place. A walk through all of them (find,
	 * a sum) keeps none of the objects it makes. */
	*[Symbol.iterator](): Iterator<[number, GridCell]> {
		for (let i = 0; i < this.keys.length; i++) {
			const style = this.styles[i];
			yield [
				this.keys[i],
				this.made.get(i) ?? {
					value: this.values[i],
					...(style >= 0 ? { style } : {}),
					...this.rich.get(i),
				},
			];
		}
	}
}
