/**
 * A binary glTF (.glb) looked at before any 3D engine is asked to draw
 * it: whether it is one, whether Paperwren can show it, and a few facts
 * about it. Only the header and the JSON part are read; the geometry is
 * the engine's business (viewer/modelScene.ts).
 *
 * Paperwren fetches nothing, so a model that points at files or
 * addresses outside itself is refused here, before the engine could
 * ask for them. Models squeezed with Draco, meshopt or KTX2 need a
 * decoder program of their own and are refused as well, with their own
 * reason.
 */

/** "glTF", read as a little-endian number. */
const MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;

/** Above this a model is not tried: it would not fit a phone's memory. */
export const MAX_GLB_BYTES = 250 * 1024 * 1024;

/** The squeezing methods Paperwren has no decoder for. */
const COMPRESSION = [
	"KHR_draco_mesh_compression",
	"EXT_meshopt_compression",
	"KHR_texture_basisu",
];

export type GlbRefusal =
	/** Not a binary glTF at all. */
	| "notGlb"
	/** A binary glTF, but not version 2. */
	| "version"
	/** Cut short, or its parts do not add up. */
	| "damaged"
	/** Needs a Draco, meshopt or KTX2 decoder. */
	| "compressed"
	/** Keeps data or pictures in other files or at addresses. */
	| "external"
	/** Too large to try. */
	| "tooLarge";

export interface GlbFacts {
	triangles: number;
	vertices: number;
	animations: number;
}

export type GlbReading =
	| { ok: true; facts: GlbFacts }
	| { ok: false; reason: GlbRefusal };

/** Whether the bytes begin the way a binary glTF does. */
export function isGlb(bytes: Uint8Array): boolean {
	return (
		bytes.length >= 12 &&
		new DataView(bytes.buffer, bytes.byteOffset, 12).getUint32(0, true) ===
			MAGIC
	);
}

interface Accessor {
	count?: number;
}
interface Primitive {
	mode?: number;
	indices?: number;
	attributes?: { POSITION?: number };
}
interface Gltf {
	asset?: { version?: unknown };
	extensionsRequired?: unknown;
	buffers?: Array<{ uri?: unknown }>;
	images?: Array<{ uri?: unknown }>;
	accessors?: Accessor[];
	meshes?: Array<{ primitives?: Primitive[] }>;
	nodes?: Array<{ mesh?: number }>;
	animations?: unknown[];
}

/** An accessor's element count, 0 where it is missing or odd. */
function countOf(gltf: Gltf, index: number | undefined): number {
	const n = index === undefined ? undefined : gltf.accessors?.[index]?.count;
	return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
}

/** Triangles and vertices of one mesh, each primitive once. */
function meshFacts(gltf: Gltf, mesh: { primitives?: Primitive[] }) {
	let triangles = 0;
	let vertices = 0;
	for (const prim of mesh.primitives ?? []) {
		const points = countOf(gltf, prim.attributes?.POSITION);
		const corners =
			prim.indices === undefined ? points : countOf(gltf, prim.indices);
		vertices += points;
		const mode = prim.mode ?? 4;
		// Triangles, a strip, a fan; points and lines have none.
		if (mode === 4) triangles += Math.floor(corners / 3);
		else if (mode === 5 || mode === 6) triangles += Math.max(0, corners - 2);
	}
	return { triangles, vertices };
}

/** What the file says about itself, or why it is not shown. */
export function readGlb(buffer: ArrayBuffer): GlbReading {
	const refuse = (reason: GlbRefusal): GlbReading => ({ ok: false, reason });
	if (buffer.byteLength > MAX_GLB_BYTES) return refuse("tooLarge");
	const bytes = new Uint8Array(buffer);
	if (!isGlb(bytes)) return refuse("notGlb");
	const view = new DataView(buffer);
	if (view.getUint32(4, true) !== 2) return refuse("version");
	// The header says how long the whole file is; a file shorter than
	// that was cut off.
	if (view.getUint32(8, true) > buffer.byteLength) return refuse("damaged");
	if (buffer.byteLength < 20) return refuse("damaged");
	const jsonLength = view.getUint32(12, true);
	if (view.getUint32(16, true) !== JSON_CHUNK) return refuse("damaged");
	if (20 + jsonLength > buffer.byteLength) return refuse("damaged");

	let gltf: Gltf;
	try {
		const text = new TextDecoder("utf-8").decode(
			bytes.subarray(20, 20 + jsonLength),
		);
		gltf = JSON.parse(text);
	} catch {
		return refuse("damaged");
	}
	if (!gltf || typeof gltf !== "object") return refuse("damaged");
	if (!String(gltf.asset?.version ?? "").startsWith("2"))
		return refuse("version");

	const required = Array.isArray(gltf.extensionsRequired)
		? gltf.extensionsRequired
		: [];
	if (COMPRESSION.some((name) => required.includes(name)))
		return refuse("compressed");

	// The binary part of the file is a buffer without an address. Any
	// other buffer is in a file or at an address, and so is any picture
	// that is not written into the JSON itself.
	if (gltf.buffers?.some((b) => b?.uri !== undefined))
		return refuse("external");
	if (
		gltf.images?.some(
			(i) =>
				i?.uri !== undefined &&
				!(typeof i.uri === "string" && /^data:image\//i.test(i.uri)),
		)
	)
		return refuse("external");

	const meshes = gltf.meshes ?? [];
	const per = meshes.map((mesh) => meshFacts(gltf, mesh));
	let triangles = 0;
	let vertices = 0;
	// A mesh used by several nodes is drawn as many times.
	const used = (gltf.nodes ?? []).filter(
		(node) => typeof node?.mesh === "number",
	);
	if (used.length)
		for (const node of used) {
			const own = per[node.mesh as number];
			triangles += own?.triangles ?? 0;
			vertices += own?.vertices ?? 0;
		}
	else
		for (const own of per) {
			triangles += own.triangles;
			vertices += own.vertices;
		}
	return {
		ok: true,
		facts: {
			triangles,
			vertices,
			animations: Array.isArray(gltf.animations) ? gltf.animations.length : 0,
		},
	};
}
