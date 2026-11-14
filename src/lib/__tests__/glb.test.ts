import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAX_GLB_BYTES, isGlb, readGlb } from "../glb";

const fixture = (name: string) => {
	const b = readFileSync(`fixtures/${name}`);
	return b.buffer.slice(
		b.byteOffset,
		b.byteOffset + b.byteLength,
	) as ArrayBuffer;
};

/** A binary glTF with this JSON and no data. */
function withJson(json: unknown): ArrayBuffer {
	const text = new TextEncoder().encode(JSON.stringify(json));
	const padded = new Uint8Array(Math.ceil(text.length / 4) * 4).fill(0x20);
	padded.set(text);
	const out = new Uint8Array(20 + padded.length);
	const view = new DataView(out.buffer);
	view.setUint32(0, 0x46546c67, true);
	view.setUint32(4, 2, true);
	view.setUint32(8, out.length, true);
	view.setUint32(12, padded.length, true);
	view.setUint32(16, 0x4e4f534a, true);
	out.set(padded, 20);
	return out.buffer;
}

const asset = { version: "2.0" };

describe("readGlb", () => {
	it("counts what is in a cube and a turning cube", () => {
		expect(readGlb(fixture("model.glb"))).toEqual({
			ok: true,
			facts: { triangles: 12, vertices: 24, animations: 0 },
		});
		const turning = readGlb(fixture("model-animated.glb"));
		expect(turning.ok && turning.facts.animations).toBe(1);
	});

	it("tells a binary glTF from other bytes", () => {
		expect(isGlb(new Uint8Array(fixture("model.glb")))).toBe(true);
		expect(isGlb(new Uint8Array(fixture("sample.pdf")))).toBe(false);
		expect(isGlb(new Uint8Array([0x67, 0x6c, 0x54]))).toBe(false);
		expect(readGlb(fixture("sample.pdf"))).toEqual({
			ok: false,
			reason: "notGlb",
		});
	});

	it("says a cut-off file is damaged", () => {
		expect(readGlb(fixture("model-truncated.glb"))).toEqual({
			ok: false,
			reason: "damaged",
		});
		expect(readGlb(fixture("model.glb").slice(0, 10))).toEqual({
			ok: false,
			reason: "notGlb",
		});
		expect(readGlb(withJson("not an object").slice(0, 19))).toEqual({
			ok: false,
			reason: "damaged",
		});
	});

	it("says JSON that does not parse is damaged", () => {
		const bytes = new Uint8Array(withJson({ asset }));
		bytes[21] = 0x78;
		expect(readGlb(bytes.buffer)).toEqual({ ok: false, reason: "damaged" });
	});

	it("refuses another version", () => {
		const old = new Uint8Array(fixture("model.glb"));
		new DataView(old.buffer).setUint32(4, 1, true);
		expect(readGlb(old.buffer)).toEqual({ ok: false, reason: "version" });
		expect(readGlb(withJson({ asset: { version: "1.0" } }))).toEqual({
			ok: false,
			reason: "version",
		});
	});

	it("refuses the squeezing it has no decoder for", () => {
		const reason = "compressed";
		expect(readGlb(fixture("model-compressed.glb"))).toEqual({
			ok: false,
			reason,
		});
		for (const name of ["EXT_meshopt_compression", "KHR_texture_basisu"])
			expect(readGlb(withJson({ asset, extensionsRequired: [name] }))).toEqual({
				ok: false,
				reason,
			});
		// Used with a fallback, not required: the plain data is shown.
		expect(
			readGlb(withJson({ asset, extensionsUsed: ["KHR_texture_basisu"] })).ok,
		).toBe(true);
	});

	it("refuses anything that lives outside the file", () => {
		const external = { ok: false, reason: "external" };
		expect(readGlb(fixture("model-external.glb"))).toEqual(external);
		expect(
			readGlb(
				withJson({ asset, buffers: [{ uri: "more.bin", byteLength: 4 }] }),
			),
		).toEqual(external);
		expect(
			readGlb(withJson({ asset, images: [{ uri: "http://x.test/a.png" }] })),
		).toEqual(external);
		expect(
			readGlb(withJson({ asset, images: [{ uri: "textures/a.png" }] })),
		).toEqual(external);
		// A picture written into the JSON itself asks for nothing.
		expect(
			readGlb(
				withJson({ asset, images: [{ uri: "data:image/png;base64,AAAA" }] }),
			).ok,
		).toBe(true);
	});

	it("refuses a size no phone could hold", () => {
		const huge = { byteLength: MAX_GLB_BYTES + 1 } as ArrayBuffer;
		expect(readGlb(huge)).toEqual({ ok: false, reason: "tooLarge" });
	});

	it("counts a mesh once for each node that uses it", () => {
		const json = {
			asset,
			accessors: [{ count: 3 }, { count: 6 }],
			meshes: [
				{ primitives: [{ attributes: { POSITION: 0 } }] },
				{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }] },
				{ primitives: [{ attributes: { POSITION: 0 }, mode: 1 }] },
			],
			nodes: [{ mesh: 0 }, { mesh: 0 }, { mesh: 1 }, { mesh: 2 }, {}],
		};
		expect(readGlb(withJson(json))).toEqual({
			ok: true,
			facts: { triangles: 1 + 1 + 2 + 0, vertices: 3 * 4, animations: 0 },
		});
		// No nodes at all: each mesh once.
		expect(readGlb(withJson({ ...json, nodes: undefined }))).toMatchObject({
			ok: true,
			facts: { triangles: 3 },
		});
	});
});
