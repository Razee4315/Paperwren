/**
 * Writes the 3D model fixtures, each a few kilobytes: a cube with a
 * colour on every face (model.glb), the same cube turning about its
 * upright axis (model-animated.glb), a model that asks for Draco
 * (model-compressed.glb) and one that points at a file on the web
 * (model-external.glb), which Paperwren must refuse without asking for
 * it, and model-truncated.glb, the first cube cut short.
 * Run: node scripts/make-model-fixtures.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "fixtures");
mkdirSync(dir, { recursive: true });

const FLOAT = 5126;
const USHORT = 5123;
const UBYTE = 5121;

/** A binary glTF: a header, the JSON padded with spaces, the data
 * padded with zeros. */
function glb(json, bin) {
	const text = Buffer.from(JSON.stringify(json), "utf8");
	const jsonPad = (4 - (text.length % 4)) % 4;
	const jsonPart = Buffer.concat([text, Buffer.alloc(jsonPad, 0x20)]);
	const binPad = (4 - (bin.length % 4)) % 4;
	const binPart = Buffer.concat([bin, Buffer.alloc(binPad)]);
	const chunks = [
		[0x4e4f534a, jsonPart],
		...(binPart.length ? [[0x004e4942, binPart]] : []),
	];
	const length =
		12 + chunks.reduce((sum, [, part]) => sum + 8 + part.length, 0);
	const out = Buffer.alloc(length);
	out.writeUInt32LE(0x46546c67, 0);
	out.writeUInt32LE(2, 4);
	out.writeUInt32LE(length, 8);
	let at = 12;
	for (const [type, part] of chunks) {
		out.writeUInt32LE(part.length, at);
		out.writeUInt32LE(type, at + 4);
		part.copy(out, at + 8);
		at += 8 + part.length;
	}
	return out;
}

// Six faces: the way each one points (normal, and the two directions
// across it) and its colour. The cube is not a perfect one, so that
// turning it shows which way round it is.
const SIZE = [0.5, 0.3, 0.4];
const FACES = [
	{ n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0], rgb: [230, 90, 60] },
	{ n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], rgb: [70, 160, 220] },
	{ n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1], rgb: [240, 200, 70] },
	{ n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], rgb: [140, 90, 200] },
	{ n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], rgb: [90, 190, 110] },
	{ n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0], rgb: [235, 235, 235] },
];

/** The cube's data and the glTF pieces that describe it. */
function cube() {
	const positions = [];
	const normals = [];
	const colors = [];
	const indices = [];
	for (const [face, { n, u, v, rgb }] of FACES.entries()) {
		for (const [a, b] of [
			[-1, -1],
			[1, -1],
			[1, 1],
			[-1, 1],
		])
			for (let k = 0; k < 3; k++) {
				positions.push(SIZE[k] * (n[k] + a * u[k] + b * v[k]));
				normals.push(n[k]);
			}
		// Vertex colours are read as linear, so the screen colours go
		// through the inverse of the display curve first.
		const linear = rgb.map((c) => Math.round(255 * (c / 255) ** 2.2));
		for (let i = 0; i < 4; i++) colors.push(...linear, 255);
		const first = face * 4;
		indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
	}
	const parts = [
		Buffer.from(new Float32Array(positions).buffer),
		Buffer.from(new Float32Array(normals).buffer),
		Buffer.from(new Uint8Array(colors).buffer),
		Buffer.from(new Uint16Array(indices).buffer),
	];
	const views = [];
	let at = 0;
	for (const part of parts) {
		views.push({ buffer: 0, byteOffset: at, byteLength: part.length });
		at += part.length;
	}
	const json = {
		asset: { version: "2.0", generator: "Paperwren make-model-fixtures" },
		scene: 0,
		scenes: [{ nodes: [0] }],
		nodes: [{ mesh: 0, name: "Cube" }],
		meshes: [
			{
				primitives: [
					{
						attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 },
						indices: 3,
						material: 0,
					},
				],
			},
		],
		materials: [
			{
				pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 0.7 },
			},
		],
		accessors: [
			{
				bufferView: 0,
				componentType: FLOAT,
				count: 24,
				type: "VEC3",
				min: SIZE.map((s) => -s),
				max: SIZE,
			},
			{ bufferView: 1, componentType: FLOAT, count: 24, type: "VEC3" },
			{
				bufferView: 2,
				componentType: UBYTE,
				normalized: true,
				count: 24,
				type: "VEC4",
			},
			{ bufferView: 3, componentType: USHORT, count: 36, type: "SCALAR" },
		],
		bufferViews: views,
		buffers: [{ byteLength: at }],
	};
	return { json, bin: Buffer.concat(parts) };
}

/** The cube, turning a quarter at a time about its upright axis. */
function animated() {
	const { json, bin } = cube();
	const times = new Float32Array([0, 1, 2, 3, 4]);
	const turns = [];
	for (let i = 0; i <= 4; i++) {
		const half = (i * Math.PI) / 4;
		turns.push(0, Math.sin(half), 0, Math.cos(half));
	}
	const rotations = new Float32Array(turns);
	const start = bin.length;
	const extra = [Buffer.from(times.buffer), Buffer.from(rotations.buffer)];
	json.bufferViews.push(
		{ buffer: 0, byteOffset: start, byteLength: extra[0].length },
		{
			buffer: 0,
			byteOffset: start + extra[0].length,
			byteLength: extra[1].length,
		},
	);
	json.accessors.push(
		{
			bufferView: 4,
			componentType: FLOAT,
			count: 5,
			type: "SCALAR",
			min: [0],
			max: [4],
		},
		{ bufferView: 5, componentType: FLOAT, count: 5, type: "VEC4" },
	);
	json.animations = [
		{
			name: "Turn",
			samplers: [{ input: 4, output: 5, interpolation: "LINEAR" }],
			channels: [{ sampler: 0, target: { node: 0, path: "rotation" } }],
		},
	];
	json.buffers[0].byteLength = start + extra[0].length + extra[1].length;
	return { json, bin: Buffer.concat([bin, ...extra]) };
}

const plain = cube();
const model = glb(plain.json, plain.bin);
const turning = animated();

const compressed = cube();
compressed.json.extensionsUsed = ["KHR_draco_mesh_compression"];
compressed.json.extensionsRequired = ["KHR_draco_mesh_compression"];

const external = cube();
external.json.images = [{ uri: "https://example.invalid/skin.png" }];
external.json.buffers.push({
	uri: "https://example.invalid/more.bin",
	byteLength: 12,
});

const files = {
	"model.glb": model,
	"model-animated.glb": glb(turning.json, turning.bin),
	"model-compressed.glb": glb(compressed.json, compressed.bin),
	"model-external.glb": glb(external.json, external.bin),
	"model-truncated.glb": model.subarray(0, 400),
};
for (const [name, bytes] of Object.entries(files)) {
	writeFileSync(join(dir, name), bytes);
	console.log(name, bytes.length, "bytes");
}
