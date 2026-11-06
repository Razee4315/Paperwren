/**
 * What an older Chromium lacks, filled in before anything else runs.
 *
 * Phones without Google Play (Huawei's HarmonyOS among them) carry a
 * WebView that is not kept up to date, often years behind. The app and
 * pdf.js reach for a few things those WebViews never had; each is added
 * here only when it is missing, so an up-to-date WebView runs its own.
 * Imported first by the app and by the pdf.js worker.
 */

type Indexed = { length: number; [index: number]: unknown };

/** `.at()`: Chrome 92. */
function at(this: Indexed, index: number) {
	const n = Math.trunc(index) || 0;
	const i = n < 0 ? this.length + n : n;
	return i < 0 || i >= this.length ? undefined : this[i];
}
const typed = Object.getPrototypeOf(Int8Array.prototype) as object;
for (const proto of [Array.prototype, String.prototype, typed])
	if (!("at" in proto))
		Object.defineProperty(proto, "at", {
			value: at,
			writable: true,
			configurable: true,
		});

/** `Object.hasOwn`: Chrome 93. */
if (typeof (Object as { hasOwn?: unknown }).hasOwn !== "function")
	Object.defineProperty(Object, "hasOwn", {
		value: (target: object, key: PropertyKey) =>
			Object.prototype.hasOwnProperty.call(target, key),
		writable: true,
		configurable: true,
	});

/** `structuredClone`: Chrome 98. pdf.js copies plain data with it
 * (numbers, strings, arrays, maps, typed arrays); what it cannot copy,
 * such as a drawn bitmap, is handed back as it is. A transfer is a copy
 * here, which only costs memory. */
function clone(value: unknown, seen = new Map<unknown, unknown>()): unknown {
	if (typeof value !== "object" || value === null) return value;
	const known = seen.get(value);
	if (known !== undefined) return known;
	if (value instanceof Date) return new Date(value.getTime());
	if (value instanceof RegExp) return new RegExp(value.source, value.flags);
	if (value instanceof ArrayBuffer) {
		const copy = value.slice(0);
		seen.set(value, copy);
		return copy;
	}
	if (ArrayBuffer.isView(value)) {
		const view = value as unknown as {
			constructor: new (
				buffer: ArrayBuffer,
				offset: number,
				length: number,
			) => unknown;
			buffer: ArrayBuffer;
			byteOffset: number;
			byteLength: number;
			BYTES_PER_ELEMENT?: number;
		};
		const buffer = view.buffer.slice(
			view.byteOffset,
			view.byteOffset + view.byteLength,
		);
		const copy = new view.constructor(
			buffer,
			0,
			view.byteLength / (view.BYTES_PER_ELEMENT ?? 1),
		);
		seen.set(value, copy);
		return copy;
	}
	if (value instanceof Map) {
		const copy = new Map();
		seen.set(value, copy);
		for (const [k, v] of value) copy.set(clone(k, seen), clone(v, seen));
		return copy;
	}
	if (value instanceof Set) {
		const copy = new Set();
		seen.set(value, copy);
		for (const v of value) copy.add(clone(v, seen));
		return copy;
	}
	if (Array.isArray(value)) {
		const copy: unknown[] = [];
		seen.set(value, copy);
		for (const v of value) copy.push(clone(v, seen));
		return copy;
	}
	const proto = Object.getPrototypeOf(value);
	if (proto !== Object.prototype && proto !== null) return value;
	const copy: Record<string, unknown> = {};
	seen.set(value, copy);
	for (const key of Object.keys(value))
		copy[key] = clone((value as Record<string, unknown>)[key], seen);
	return copy;
}
if (typeof globalThis.structuredClone !== "function")
	Object.defineProperty(globalThis, "structuredClone", {
		value: (value: unknown) => clone(value),
		writable: true,
		configurable: true,
	});

/** `Promise.withResolvers`: Chrome 119. The legacy pdf.js carries its
 * own; this covers the app's other code and any library that asks. */
if (
	typeof (Promise as { withResolvers?: unknown }).withResolvers !== "function"
)
	Object.defineProperty(Promise, "withResolvers", {
		value<T>() {
			let resolve!: (value: T | PromiseLike<T>) => void;
			let reject!: (reason?: unknown) => void;
			const promise = new Promise<T>((yes, no) => {
				resolve = yes;
				reject = no;
			});
			return { promise, resolve, reject };
		},
		writable: true,
		configurable: true,
	});

export {};
