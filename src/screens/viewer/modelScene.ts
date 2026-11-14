/**
 * The 3D engine behind the model viewer (three.js): one scene for one
 * binary glTF, drawn only when something changes or an animation plays.
 * ModelView.tsx is the screen around it. Everything here is loaded as
 * part of that screen's own chunk, never at start.
 *
 * Nothing is fetched. The file is read from memory, and a request for
 * anything that is not already inside it (an address, a file) is turned
 * down by the loader's manager as well as by `readGlb` beforehand.
 */

import {
	AnimationMixer,
	Box3,
	DirectionalLight,
	Group,
	InstancedMesh,
	LoadingManager,
	type Material,
	MathUtils,
	NeutralToneMapping,
	type Object3D,
	PMREMGenerator,
	PerspectiveCamera,
	Scene,
	SkinnedMesh,
	Spherical,
	Texture,
	TextureLoader,
	Vector3,
	type WebGLRenderTarget,
	WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/** Why a model could not be put on screen. */
export class ModelFailure extends Error {
	constructor(readonly reason: "webgl" | "damaged") {
		super(reason);
		this.name = "ModelFailure";
	}
}

export interface SceneHooks {
	/** The zoom as a percentage of the first framing (100 = as framed). */
	onZoom: (percent: number) => void;
	/** The browser took the drawing surface away, or gave it back. */
	onLost: (lost: boolean) => void;
}

export interface ModelScene {
	/** Frame the model afresh. */
	reset: () => void;
	/** Turn the model by these angles (radians): sideways, up and down. */
	turn: (sideways: number, upright: number) => void;
	/** Move closer (above 1) or further away (below 1). */
	zoom: (factor: number) => void;
	setPlaying: (on: boolean) => void;
	/** Drawing stops while the viewer is not on show. */
	setShown: (on: boolean) => void;
	/** The room it is drawn in changed size. */
	resize: () => void;
	dispose: () => void;
	animated: boolean;
}

/** What a request for anything but data inside the file gets. */
const NOTHING = "data:application/octet-stream;base64,";
const INSIDE = /^(?:data|blob):/i;

/** The first view: from a little above and to one side. */
const LOOK = new Vector3(0.55, 0.4, 1).normalize();
/** The model is scaled to a sphere of this radius, so the camera and
 * the controls work in the same units whatever the file's own. */
const RADIUS = 1;

function disposeTree(root: Object3D) {
	root.traverse((object) => {
		const drawn = object as Object3D & {
			geometry?: { dispose: () => void };
			material?: Material | Material[];
		};
		drawn.geometry?.dispose();
		const materials = Array.isArray(drawn.material)
			? drawn.material
			: drawn.material
				? [drawn.material]
				: [];
		for (const material of materials) {
			for (const value of Object.values(material))
				if (value instanceof Texture) value.dispose();
			material.dispose();
		}
		if (object instanceof InstancedMesh) object.dispose();
		if (object instanceof SkinnedMesh) object.skeleton?.dispose();
	});
}

/**
 * Put `data` (a binary glTF `readGlb` accepted) on `canvas`, in the
 * room `host`. Throws `ModelFailure`: "webgl" where there is no way to
 * draw 3D, "damaged" where the file would not load or holds nothing.
 */
export async function openModel(
	canvas: HTMLCanvasElement,
	host: HTMLElement,
	data: ArrayBuffer,
	hooks: SceneHooks,
): Promise<ModelScene> {
	let renderer: WebGLRenderer;
	try {
		renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
	} catch {
		throw new ModelFailure("webgl");
	}
	const scene = new Scene();
	const camera = new PerspectiveCamera(40, 1, 0.05, 100);
	const controls = new OrbitControls(camera, canvas);
	const env: { target: WebGLRenderTarget | null } = { target: null };
	let disposed = false;

	try {
		// The canvas is clear: the room's own colour shows through, in
		// either theme.
		renderer.setClearColor(0x000000, 0);
		renderer.toneMapping = NeutralToneMapping;

		// Light from a room, so shiny and metal parts have something to
		// show, and a lamp that travels with the camera so the side that
		// faces the reader is never dark.
		const lightRoom = () => {
			const room = new RoomEnvironment();
			const pmrem = new PMREMGenerator(renderer);
			env.target?.dispose();
			env.target = pmrem.fromScene(room, 0.04);
			scene.environment = env.target.texture;
			scene.environmentIntensity = 0.75;
			pmrem.dispose();
			room.dispose();
		};
		lightRoom();
		const lamp = new DirectionalLight(0xffffff, 0.8);
		lamp.position.set(0.6, 1, 1.2);
		camera.add(lamp);
		scene.add(camera);

		const manager = new LoadingManager();
		manager.setURLModifier((url) => (INSIDE.test(url) ? url : NOTHING));
		const loader = new GLTFLoader(manager);
		// Pictures inside the file are drawn through an <img> from a blob
		// (the app's content policy allows that, not a fetch of one).
		loader.register((parser) => {
			parser.textureLoader = new TextureLoader(manager);
			return { name: "PaperwrenTextures" };
		});
		let gltf: Awaited<ReturnType<GLTFLoader["parseAsync"]>>;
		try {
			gltf = await loader.parseAsync(data, "");
		} catch {
			throw new ModelFailure("damaged");
		}
		const model = gltf.scene;
		const mixer = new AnimationMixer(model);
		const clips = gltf.animations.filter((clip) => clip.duration > 0);
		for (const clip of clips) mixer.clipAction(clip).play();
		mixer.update(0);

		// Centred, and scaled so that it fits a sphere of RADIUS.
		const holder = new Group();
		holder.add(model);
		scene.add(holder);
		model.updateMatrixWorld(true);
		const box = new Box3().setFromObject(model);
		const size = box.getSize(new Vector3());
		const reach = size.length() / 2;
		if (box.isEmpty() || !Number.isFinite(reach) || reach <= 0)
			throw new ModelFailure("damaged");
		model.position.sub(box.getCenter(new Vector3()));
		holder.scale.setScalar(RADIUS / reach);

		controls.enableDamping = true;
		controls.dampingFactor = 0.12;
		controls.screenSpacePanning = true;
		controls.minDistance = 0.3;
		controls.maxDistance = 20;

		let width = 0;
		let framed = new Vector3();
		let framedDistance = 1;
		/** Where the camera stands to see the whole model, for this shape
		 * of room (a tall narrow one needs more distance). */
		const frame = () => {
			// Whatever coast is left from a flick stops here: with damping
			// off, one update takes it all in at once.
			controls.enableDamping = false;
			controls.update();
			controls.enableDamping = true;
			const up = MathUtils.degToRad(camera.fov) / 2;
			const across = Math.atan(Math.tan(up) * camera.aspect);
			framedDistance = (RADIUS / Math.sin(Math.min(up, across))) * 1.08;
			framed = LOOK.clone().multiplyScalar(framedDistance);
			camera.position.copy(framed);
			controls.target.set(0, 0, 0);
			camera.lookAt(controls.target);
			controls.update();
		};
		/** Still as framed: not turned, moved or zoomed by the reader. */
		const untouched = () =>
			camera.position.distanceTo(framed) < 1e-3 &&
			controls.target.lengthSq() < 1e-6;

		let shown = true;
		let playing = false;
		let lost = false;
		let queued = 0;
		// Seconds since the last frame, for animations.
		let last = performance.now();
		const elapsed = () => {
			const now = performance.now();
			const seconds = (now - last) / 1000;
			last = now;
			return seconds;
		};
		let lastZoom = -1;
		let lastView = "";

		const draw = () => {
			renderer.render(scene, camera);
			const away = camera.position.distanceTo(controls.target);
			const percent = Math.round((framedDistance / away) * 100);
			if (percent !== lastZoom) {
				lastZoom = percent;
				hooks.onZoom(percent);
			}
			// What a test reads to see the view change.
			const spin = new Spherical().setFromVector3(
				camera.position.clone().sub(controls.target),
			);
			const view = `${spin.theta.toFixed(2)} ${spin.phi.toFixed(2)} ${spin.radius.toFixed(2)}`;
			if (view !== lastView) {
				lastView = view;
				host.dataset.view = view;
			}
		};
		const tick = () => {
			queued = 0;
			if (disposed || !shown || lost || !width) return;
			const step = Math.min(elapsed(), 0.1);
			if (playing) mixer.update(step);
			// While the model coasts to a stop after a flick, update says
			// it moved; once it is still, nothing more is drawn.
			const moving = controls.update();
			draw();
			if (playing || moving) queue();
		};
		const queue = () => {
			if (queued || disposed || !shown || lost) return;
			queued = requestAnimationFrame(tick);
		};
		controls.addEventListener("change", queue);

		const resize = () => {
			// A tab not on show has no size: nothing to fit to.
			const w = host.clientWidth;
			const h = host.clientHeight;
			if (!w || !h || disposed) return;
			const still = !width || untouched();
			width = w;
			renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
			renderer.setSize(w, h, false);
			camera.aspect = w / h;
			camera.updateProjectionMatrix();
			if (still) frame();
			queue();
		};
		resize();
		if (!width) {
			// Not laid out yet: frame for a typical room until it is.
			camera.aspect = 1;
			frame();
		}
		draw();

		canvas.addEventListener("webglcontextlost", (event) => {
			if (disposed) return;
			event.preventDefault();
			lost = true;
			hooks.onLost(true);
		});
		canvas.addEventListener("webglcontextrestored", () => {
			if (disposed) return;
			// What was drawn into the room's light is gone with the context.
			lightRoom();
			lost = false;
			hooks.onLost(false);
			queue();
		});

		const orbit = (offset: Vector3) => {
			camera.position.copy(controls.target).add(offset);
			camera.lookAt(controls.target);
			controls.update();
			queue();
		};
		return {
			animated: clips.length > 0,
			reset: () => {
				frame();
				queue();
			},
			turn: (sideways, upright) => {
				const spin = new Spherical().setFromVector3(
					camera.position.clone().sub(controls.target),
				);
				spin.theta -= sideways;
				spin.phi = MathUtils.clamp(spin.phi - upright, 0.05, Math.PI - 0.05);
				orbit(new Vector3().setFromSpherical(spin));
			},
			zoom: (factor) => {
				const offset = camera.position.clone().sub(controls.target);
				const length = MathUtils.clamp(
					offset.length() / factor,
					controls.minDistance,
					controls.maxDistance,
				);
				orbit(offset.setLength(length));
			},
			setPlaying: (on) => {
				playing = on;
				if (on) {
					elapsed();
					queue();
				}
			},
			setShown: (on) => {
				shown = on;
				if (!on) return;
				elapsed();
				resize();
				queue();
			},
			resize,
			dispose: () => {
				if (disposed) return;
				disposed = true;
				cancelAnimationFrame(queued);
				controls.dispose();
				mixer.stopAllAction();
				disposeTree(scene);
				env.target?.dispose();
				renderer.dispose();
				renderer.forceContextLoss();
			},
		};
	} catch (error) {
		disposed = true;
		controls.dispose();
		disposeTree(scene);
		env.target?.dispose();
		renderer.dispose();
		renderer.forceContextLoss();
		throw error;
	}
}
