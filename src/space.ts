import { Keymap, PaneType, setIcon } from "obsidian";
import * as THREE from "three";
import { TrackballControls } from "three/examples/jsm/controls/TrackballControls.js";
import { forceLink, forceManyBody, forceSimulation, forceX, forceY, forceZ } from "d3-force-3d";
import type { PlanetData } from "./folders";
import { ROCK_ICON, rockGeometry, rockMaterial } from "./rock";

// One star colour per planet, in order; past the end they repeat. Same set as 3D Animation with Toggle.
const PALETTE = ["#8b5cf6", "#14b8a6", "#f59e0b", "#ec4899", "#3b82f6", "#84cc16", "#ef4444", "#06b6d4", "#a855f7", "#f97316"];
// Empty space kept between two planets, past the edges of their constellations.
const GAP = 40;
// Opening or closing a planet takes this long.
const OPEN_MS = 500;
// A double-click brings the camera this much closer to where it lands (Alt: this much further), over ZOOM_MS.
const ZOOM_IN = 0.4;
const ZOOM_MS = 350;
// A click on a note waits this long for a second click before opening it.
const CLICK_WAIT_MS = 250;
// Pressing and holding still this long grabs the picture: dragging then moves it instead of turning it.
const HOLD_MS = 250;
// A press that moves further than this, in pixels, is a turn or a drag, not a click or a hold.
const STILL_PX = 4;
// Both mouse buttons, as MouseEvent.buttons counts them.
const BOTH = 3;

export type Spot = [number, number, number];

export interface SpaceHooks {
	// `tab` as Obsidian reads a click: Cmd or Ctrl for a new tab, and so on; false for the same one.
	open(path: string, tab: PaneType | boolean): void;
	toggled(key: string, open: boolean): void;
	// A planet was dragged, or pushed by one that was; read places() for where they all are now.
	moved(): void;
}

interface Planet {
	data: PlanetData;
	center: THREE.Vector3;
	open: boolean;
	// 0 closed, 1 open; eases towards `open` over OPEN_MS.
	openness: number;
	// Where each star sits, from the centre, while the planet is open.
	local: THREE.Vector3[];
	rockR: number;
	// How far the open constellation reaches from the centre.
	openR: number;
	rock: THREE.Mesh;
	label: HTMLElement;
	// The planet's first star, and first link, in the shared meshes.
	first: number;
	firstLink: number;
}

export class PlanetSpace {
	readonly el: HTMLElement;
	private labelsEl: HTMLElement;
	private tipEl: HTMLElement;

	private renderer: THREE.WebGLRenderer;
	private scene = new THREE.Scene();
	private camera = new THREE.PerspectiveCamera(50, 1, 1, 400000);
	// Trackball, not orbit: it turns past the top and bottom as freely as side to side.
	private controls: TrackballControls;
	private rockGeo = rockGeometry();
	private rockMat = rockMaterial();
	private stars: THREE.InstancedMesh | null = null;
	private lines: THREE.LineSegments | null = null;
	private planets: Planet[] = [];
	private starPlanet: number[] = [];
	private resize: ResizeObserver;
	private frame = 0;
	private lastFrame = performance.now();
	private framed = false;

	private pointer = new THREE.Vector2();
	private hovered: { planet: number; star: number } | null = null;
	private downAt: { x: number; y: number } | null = null;
	private openTimer = 0;
	private holdTimer = 0;
	private zoom: { start: number; pos: THREE.Vector3[]; target: THREE.Vector3[] } | null = null;
	// Where the mouse was on the last move while the picture is grabbed; null when it isn't.
	private grabbedAt: { x: number; y: number } | null = null;
	// Both buttons down: the planet under the mouse follows it on a plane facing the camera.
	private carry: { planet: Planet; plane: THREE.Plane; offset: THREE.Vector3 } | null = null;
	// Set from the moment both buttons go down until the last one comes up, so nothing else reads the press.
	private chord = false;

	constructor(parent: HTMLElement, private hooks: SpaceHooks) {
		this.el = parent.createDiv("planetary-overlay");
		const host = this.el.createDiv("planetary-canvas");
		this.labelsEl = this.el.createDiv("planetary-labels");
		this.tipEl = this.el.createDiv("planetary-tip");

		this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
		this.renderer.setPixelRatio(this.el.win.devicePixelRatio);
		this.renderer.setClearColor(0x000000, 0);
		host.appendChild(this.renderer.domElement);

		this.scene.add(new THREE.AmbientLight(0xffffff, 1.2));
		const sun = new THREE.DirectionalLight(0xffffff, 2.2);
		sun.position.set(1, 2, 3);
		this.camera.add(sun);
		this.scene.add(this.camera);
		this.camera.position.set(0, 0, 600);

		this.controls = new TrackballControls(this.camera, this.renderer.domElement);
		this.controls.rotateSpeed = 2.5;
		this.controls.dynamicDampingFactor = 0.12;

		const canvas = this.renderer.domElement;
		canvas.addEventListener("pointerdown", (e) => this.onDown(e));
		// The second button down fires no pointerdown, only a mousedown (and a pointermove), so both are watched.
		canvas.addEventListener("mousedown", (e) => this.onButtons(e));
		canvas.addEventListener("pointermove", (e) => this.onMove(e));
		canvas.addEventListener("pointerleave", () => this.setHover(null));
		canvas.addEventListener("pointerup", (e) => this.onUp(e));
		canvas.addEventListener("pointercancel", () => this.letGo());
		canvas.addEventListener("dblclick", (e) => this.onDoubleClick(e));

		this.resize = new ResizeObserver(() => this.fit());
		this.resize.observe(this.el);
		this.fit();
		this.loop();
	}

	show(data: PlanetData[], open: Set<string>, places: Record<string, Spot>) {
		const was = new Map(this.planets.map((p) => [p.data.key, p]));
		this.clear();

		let first = 0;
		let firstLink = 0;
		this.starPlanet = [];
		this.planets = data.map((d, i) => {
			const rockR = 5 + 2.2 * Math.cbrt(d.stars.length);
			const local = layOut(d, rockR * 1.6 + 4);
			const openR = local.reduce((m, v, s) => Math.max(m, v.length() + starRadius(d.stars[s].degree)), rockR) + 4;
			const rock = new THREE.Mesh(this.rockGeo, this.rockMat);
			rock.scale.setScalar(rockR);
			rock.rotation.y = i * 1.3;
			this.scene.add(rock);
			const old = was.get(d.key);
			const at = places[d.key];
			const p: Planet = {
				data: d,
				center: old ? old.center.clone() : at ? new THREE.Vector3(...at) : new THREE.Vector3(),
				open: open.has(d.key),
				openness: old ? old.openness : open.has(d.key) ? 1 : 0,
				local,
				rockR,
				openR,
				rock,
				label: this.makeLabel(d),
				first,
				firstLink,
			};
			for (let s = 0; s < d.stars.length; s++) this.starPlanet.push(i);
			first += d.stars.length;
			firstLink += d.links.length;
			return p;
		});
		this.placeNew(places, was);

		const geo = new THREE.SphereGeometry(1, 14, 10);
		this.stars = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial(), Math.max(1, first));
		this.stars.count = first;
		this.stars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
		const c = new THREE.Color();
		this.planets.forEach((p, i) => {
			for (let s = 0; s < p.data.stars.length; s++) this.stars!.setColorAt(p.first + s, c.set(PALETTE[i % PALETTE.length]));
		});
		this.scene.add(this.stars);

		const lineGeo = new THREE.BufferGeometry();
		lineGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(Math.max(1, firstLink) * 6), 3));
		lineGeo.setDrawRange(0, firstLink * 2);
		this.lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ transparent: true, opacity: 0.6 }));
		this.lines.frustumCulled = false;
		this.scene.add(this.lines);
		this.recolor();

		this.paintLabels();
		if (!this.framed) this.frameAll();
		this.framed = true;
	}

	places(): Record<string, Spot> {
		const out: Record<string, Spot> = {};
		for (const p of this.planets) out[p.data.key] = [p.center.x, p.center.y, p.center.z];
		return out;
	}

	recolor() {
		if (!this.lines) return;
		(this.lines.material as THREE.LineBasicMaterial).color.set(this.cssColor("var(--graph-line, var(--text-faint))"));
	}

	destroy() {
		this.el.win.cancelAnimationFrame(this.frame);
		this.el.win.clearTimeout(this.openTimer);
		this.el.win.clearTimeout(this.holdTimer);
		this.resize.disconnect();
		this.controls.dispose();
		this.clear();
		this.rockGeo.dispose();
		this.rockMat.dispose();
		this.renderer.dispose();
		this.el.remove();
	}

	// Planets with no saved spot start spread over a sphere, then shove apart until none touch.
	private placeNew(places: Record<string, Spot>, was: Map<string, Planet>) {
		const fresh = this.planets.filter((p) => !was.has(p.data.key) && !places[p.data.key]);
		const k = fresh.length;
		const radius = this.planets.reduce((m, p) => Math.max(m, this.reach(p)), 0) * Math.max(1, Math.sqrt(this.planets.length)) * 1.5;
		fresh.forEach((p, i) => {
			const y = k > 1 ? 1 - (2 * (i + 0.5)) / k : 0;
			const r = Math.sqrt(1 - y * y);
			const turn = i * Math.PI * (3 - Math.sqrt(5));
			p.center.set(Math.cos(turn) * r, y, Math.sin(turn) * r).multiplyScalar(k > 1 ? radius : 0);
		});
		for (let t = 0; t < 200; t++) this.spread(1);
	}

	private reach(p: Planet) {
		// Closed, a planet keeps room for its label too.
		return Math.max(p.rockR * 2.5, ease(p.openness) * p.openR);
	}

	// Pushes overlapping planets apart, a share `rate` of the overlap at a time. A carried planet never gives way.
	private spread(rate: number) {
		let moved = false;
		const held = this.carry?.planet;
		for (let i = 0; i < this.planets.length; i++) {
			for (let j = i + 1; j < this.planets.length; j++) {
				const a = this.planets[i];
				const b = this.planets[j];
				const need = this.reach(a) + this.reach(b) + GAP;
				const apart = b.center.clone().sub(a.center);
				const d = apart.length();
				if (d >= need) continue;
				if (d < 1e-6) apart.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
				apart.normalize().multiplyScalar((need - d) * rate);
				if (a === held) b.center.add(apart);
				else if (b === held) a.center.sub(apart);
				else {
					b.center.addScaledVector(apart, 0.5);
					a.center.addScaledVector(apart, -0.5);
				}
				moved = true;
			}
		}
		return moved;
	}

	private loop = () => {
		this.frame = this.el.win.requestAnimationFrame(this.loop);
		const now = performance.now();
		const dt = Math.min(100, now - this.lastFrame);
		this.lastFrame = now;
		for (const p of this.planets) {
			const goal = p.open ? 1 : 0;
			const step = dt / OPEN_MS;
			p.openness = goal > p.openness ? Math.min(goal, p.openness + step) : Math.max(goal, p.openness - step);
			p.rock.rotation.y += dt * 0.0003;
		}
		if (this.spread(0.15) && !this.carry) this.hooks.moved();
		this.place();
		this.stepZoom(now);
		this.controls.update();
		this.renderer.render(this.scene, this.camera);
		this.paintLabelSpots();
	};

	private place() {
		if (!this.stars || !this.lines) return;
		const m = new THREE.Matrix4();
		const q = new THREE.Quaternion();
		const at = new THREE.Vector3();
		const s = new THREE.Vector3();
		const pos = this.lines.geometry.getAttribute("position") as THREE.BufferAttribute;
		const arr = pos.array as Float32Array;
		for (const p of this.planets) {
			p.rock.position.copy(p.center);
			const e = ease(p.openness);
			p.data.stars.forEach((star, i) => {
				const hover = this.hovered?.star === p.first + i ? 1.5 : 1;
				const r = e > 0.001 ? starRadius(star.degree) * e * hover : 0.0001;
				m.compose(at.copy(p.local[i]).multiplyScalar(e).add(p.center), q, s.set(r, r, r));
				this.stars!.setMatrixAt(p.first + i, m);
			});
			p.data.links.forEach(([a, b], l) => {
				const pa = at.copy(p.local[a]).multiplyScalar(e).add(p.center);
				arr.set([pa.x, pa.y, pa.z], (p.firstLink + l) * 6);
				const pb = at.copy(p.local[b]).multiplyScalar(e).add(p.center);
				arr.set([pb.x, pb.y, pb.z], (p.firstLink + l) * 6 + 3);
			});
		}
		this.stars.instanceMatrix.needsUpdate = true;
		this.stars.computeBoundingSphere();
		pos.needsUpdate = true;
	}

	private makeLabel(d: PlanetData) {
		const label = this.labelsEl.createDiv("planetary-label");
		label.createSpan("planetary-chevron");
		label.createSpan("planetary-rock").innerHTML = ROCK_ICON;
		label.createSpan({ cls: "planetary-name", text: d.name });
		label.createSpan({ cls: "planetary-count", text: `${d.stars.length}` });
		label.addEventListener("click", () => this.toggle(d.key));
		return label;
	}

	private paintLabels() {
		for (const p of this.planets) {
			const chevron = p.label.querySelector<HTMLElement>(".planetary-chevron")!;
			chevron.empty();
			setIcon(chevron, p.open ? "chevron-down" : "chevron-right");
			p.label.toggleClass("is-open", p.open);
		}
	}

	// Each label floats just above its rock on screen, or above the stars while the planet is open.
	private paintLabelSpots() {
		const w = this.renderer.domElement.clientWidth;
		const h = this.renderer.domElement.clientHeight;
		const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
		for (const p of this.planets) {
			const lift = Math.max(p.rockR * 1.35, ease(p.openness) * p.openR);
			const at = p.center.clone().addScaledVector(up, lift).project(this.camera);
			const visible = at.z < 1 && Math.abs(at.x) < 1.2 && Math.abs(at.y) < 1.2;
			p.label.toggleClass("is-hidden", !visible);
			if (!visible) continue;
			p.label.style.transform = `translate(${((at.x + 1) / 2) * w}px, ${((1 - at.y) / 2) * h}px) translate(-50%, -100%)`;
		}
	}

	private toggle(key: string) {
		const p = this.planets.find((x) => x.data.key === key);
		if (!p) return;
		p.open = !p.open;
		this.paintLabels();
		this.hooks.toggled(key, p.open);
	}

	// What is under the mouse: a star (and its planet), a rock, or nothing.
	private pick(e: MouseEvent): { planet: number; star: number } | null {
		// The rocks follow their planets once a frame; catch them up first, in case no frame has run yet.
		for (const p of this.planets) {
			p.rock.position.copy(p.center);
			p.rock.updateMatrixWorld();
		}
		const ray = this.rayAt(e);
		const hits = ray.intersectObjects([...this.planets.map((p) => p.rock), ...(this.stars ? [this.stars] : [])], false);
		for (const hit of hits) {
			if (hit.object === this.stars && hit.instanceId !== undefined) {
				const planet = this.starPlanet[hit.instanceId];
				if (ease(this.planets[planet].openness) < 0.5) continue;
				return { planet, star: hit.instanceId };
			}
			const planet = this.planets.findIndex((p) => p.rock === hit.object);
			if (planet >= 0) return { planet, star: -1 };
		}
		return null;
	}

	// For carrying: what is under the mouse, or else the planet whose reach on screen the mouse is inside.
	private pickPlanet(e: MouseEvent): Planet | null {
		const hit = this.pick(e);
		if (hit) return this.planets[hit.planet];
		const rect = this.renderer.domElement.getBoundingClientRect();
		const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
		let best: Planet | null = null;
		let bestRatio = 1;
		for (const p of this.planets) {
			const c = p.center.clone().project(this.camera);
			if (c.z > 1) continue;
			const edge = p.center.clone().addScaledVector(right, this.reach(p)).project(this.camera);
			const toScreen = (v: THREE.Vector3) => [((v.x + 1) / 2) * rect.width + rect.left, ((1 - v.y) / 2) * rect.height + rect.top];
			const [cx, cy] = toScreen(c);
			const [ex, ey] = toScreen(edge);
			const ratio = Math.hypot(e.clientX - cx, e.clientY - cy) / Math.max(1, Math.hypot(ex - cx, ey - cy));
			if (ratio < bestRatio) {
				best = p;
				bestRatio = ratio;
			}
		}
		return best;
	}

	private onDown(e: PointerEvent) {
		this.downAt = { x: e.clientX, y: e.clientY };
		this.el.win.clearTimeout(this.holdTimer);
		if (e.buttons !== 1) return;
		this.holdTimer = this.el.win.setTimeout(() => this.grab(e.clientX, e.clientY), HOLD_MS);
	}

	private onButtons(e: MouseEvent) {
		if ((e.buttons & BOTH) === BOTH && !this.chord) this.startCarry(e);
	}

	// Both buttons down: from now until the last one comes up the camera stays put, and the planet under the
	// mouse, if any, goes where the mouse goes.
	private startCarry(e: MouseEvent) {
		this.el.win.clearTimeout(this.holdTimer);
		this.el.win.clearTimeout(this.openTimer);
		this.chord = true;
		this.grabbedAt = null;
		this.controls.noRotate = true;
		this.controls.noPan = true;
		this.setHover(null);
		const planet = this.pickPlanet(e);
		if (!planet) return;
		const normal = this.camera.getWorldDirection(new THREE.Vector3());
		const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, planet.center);
		const hit = this.rayAt(e).ray.intersectPlane(plane, new THREE.Vector3());
		if (!hit) return;
		this.carry = { planet, plane, offset: planet.center.clone().sub(hit) };
		this.el.addClass("is-grabbing");
	}

	private endCarry() {
		if (!this.carry) return;
		this.carry = null;
		this.el.removeClass("is-grabbing");
		this.hooks.moved();
	}

	// Pressed and held still: the drag slides the picture and never turns it.
	private grab(x: number, y: number) {
		if (this.chord) return;
		this.grabbedAt = { x, y };
		this.controls.noRotate = true;
		this.setHover(null);
		this.el.addClass("is-grabbing");
	}

	// The last button is up: everything goes back to normal.
	private letGo() {
		this.el.win.clearTimeout(this.holdTimer);
		this.endCarry();
		this.chord = false;
		this.grabbedAt = null;
		this.controls.noRotate = false;
		this.controls.noPan = false;
		this.el.removeClass("is-grabbing");
	}

	private onMove(e: PointerEvent) {
		if ((e.buttons & BOTH) === BOTH && !this.chord) this.startCarry(e);
		if (this.chord) {
			if ((e.buttons & BOTH) !== BOTH) this.endCarry();
			const c = this.carry;
			if (c) {
				const hit = this.rayAt(e).ray.intersectPlane(c.plane, new THREE.Vector3());
				if (hit) c.planet.center.copy(hit.add(c.offset));
			}
			return;
		}
		if (this.grabbedAt) {
			this.slide(e.clientX - this.grabbedAt.x, e.clientY - this.grabbedAt.y);
			this.grabbedAt = { x: e.clientX, y: e.clientY };
			return;
		}
		const down = this.downAt;
		if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > STILL_PX) this.el.win.clearTimeout(this.holdTimer);
		if (e.buttons !== 0) return;
		this.setHover(this.pick(e));
		if (this.hovered) {
			const rect = this.renderer.domElement.getBoundingClientRect();
			this.tipEl.style.left = `${e.clientX - rect.left + 14}px`;
			this.tipEl.style.top = `${e.clientY - rect.top + 14}px`;
		}
	}

	private onUp(e: PointerEvent) {
		const down = this.downAt;
		const busy = this.chord || this.grabbedAt !== null;
		this.downAt = null;
		this.letGo();
		if (busy || !down || e.button !== 0 || Math.hypot(e.clientX - down.x, e.clientY - down.y) > STILL_PX) return;
		const hit = this.pick(e);
		if (!hit) return;
		if (hit.star < 0) return this.toggle(this.planets[hit.planet].data.key);
		const p = this.planets[hit.planet];
		const star = p.data.stars[hit.star - p.first];
		this.el.win.clearTimeout(this.openTimer);
		const tab = Keymap.isModEvent(e);
		this.openTimer = this.el.win.setTimeout(() => this.hooks.open(star.path, tab), CLICK_WAIT_MS);
	}

	private setHover(hit: { planet: number; star: number } | null) {
		this.hovered = hit;
		this.tipEl.toggleClass("is-shown", !!hit);
		this.renderer.domElement.style.cursor = hit ? "pointer" : "";
		if (!hit) return;
		const p = this.planets[hit.planet];
		if (hit.star < 0) {
			const n = p.data.stars.length;
			this.tipEl.setText(`${p.data.name} · ${n} ${n === 1 ? "note" : "notes"} · click to ${p.open ? "close" : "open"}`);
		} else {
			this.tipEl.setText(`${p.data.stars[hit.star - p.first].name} · ${p.data.name}`);
		}
	}

	// Zooms around the spot under the mouse: that spot stays where it is on screen while everything else closes in.
	private onDoubleClick(e: MouseEvent) {
		this.el.win.clearTimeout(this.openTimer);
		const target = this.controls.target;
		const ray = this.rayAt(e);
		const hit = ray.intersectObjects([...this.planets.map((p) => p.rock), ...(this.stars ? [this.stars] : [])], false)[0];
		// Off the planets, the spot is on the plane through the camera's centre of turn, facing the camera.
		const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(this.camera.getWorldDirection(new THREE.Vector3()), target);
		const spot = hit?.point ?? ray.ray.intersectPlane(plane, new THREE.Vector3());
		if (!spot) return;
		const k = e.altKey ? 1 / ZOOM_IN : ZOOM_IN;
		const toward = (v: THREE.Vector3) => spot.clone().addScaledVector(v.clone().sub(spot), k);
		this.zoom = {
			start: performance.now(),
			pos: [this.camera.position.clone(), toward(this.camera.position)],
			target: [target.clone(), toward(target)],
		};
	}

	private stepZoom(now: number) {
		const z = this.zoom;
		if (!z) return;
		const t = Math.min(1, (now - z.start) / ZOOM_MS);
		const e = 1 - Math.pow(1 - t, 3);
		this.camera.position.lerpVectors(z.pos[0], z.pos[1], e);
		this.controls.target.lerpVectors(z.target[0], z.target[1], e);
		if (t >= 1) this.zoom = null;
	}

	// Moves the camera and its centre of turn together, so the spot under the mouse at the centre's depth stays
	// under the mouse.
	private slide(dx: number, dy: number) {
		const h = Math.max(1, this.renderer.domElement.clientHeight);
		const depth = this.camera.position.distanceTo(this.controls.target);
		const perPixel = (2 * depth * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)) / h;
		const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
		const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
		const shift = right.multiplyScalar(-dx * perPixel).addScaledVector(up, dy * perPixel);
		this.camera.position.add(shift);
		this.controls.target.add(shift);
	}

	// Puts the camera far enough back to see every planet, open or not.
	private frameAll() {
		if (this.planets.length === 0) return;
		const centre = new THREE.Vector3();
		for (const p of this.planets) centre.add(p.center);
		centre.divideScalar(this.planets.length);
		const reach = this.planets.reduce((m, p) => Math.max(m, p.center.distanceTo(centre) + Math.max(p.openR, p.rockR)), 40);
		const fov = THREE.MathUtils.degToRad(this.camera.fov) / 2;
		const dist = (reach * 1.15) / Math.sin(Math.min(fov, Math.atan(Math.tan(fov) * this.camera.aspect)));
		this.controls.target.copy(centre);
		this.camera.position.copy(centre).add(new THREE.Vector3(0, 0, dist));
		this.camera.up.set(0, 1, 0);
		this.camera.lookAt(centre);
	}

	private rayAt(e: MouseEvent) {
		const rect = this.renderer.domElement.getBoundingClientRect();
		this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
		const ray = new THREE.Raycaster();
		ray.setFromCamera(this.pointer, this.camera);
		return ray;
	}

	private fit() {
		const w = Math.max(1, this.el.clientWidth);
		const h = Math.max(1, this.el.clientHeight);
		// The canvas is sized by CSS; only its pixels change here, so the observer never sees its own change.
		this.renderer.setSize(w, h, false);
		this.camera.aspect = w / h;
		this.camera.updateProjectionMatrix();
		this.controls.handleResize();
	}

	// Resolves a CSS colour (variables included) against the theme.
	private cssColor(value: string) {
		const probe = this.el.createDiv();
		probe.style.color = value;
		const color = getComputedStyle(probe).color;
		probe.remove();
		return color || "#888888";
	}

	private clear() {
		for (const p of this.planets) {
			this.scene.remove(p.rock);
			p.label.remove();
		}
		this.planets = [];
		for (const mesh of [this.stars, this.lines]) {
			if (!mesh) continue;
			this.scene.remove(mesh);
			mesh.geometry.dispose();
			(mesh.material as THREE.Material).dispose();
		}
		this.stars = null;
		this.lines = null;
		this.hovered = null;
	}
}

function starRadius(degree: number) {
	return 1.5 + Math.sqrt(degree) * 0.9;
}

// Ease out: quick to open, gentle to land.
function ease(t: number) {
	return 1 - Math.pow(1 - t, 3);
}

interface SimNode {
	x?: number;
	y?: number;
	z?: number;
}

// Settles one planet's notes around its rock, linked notes close, none inside the rock.
function layOut(d: PlanetData, keepOut: number): THREE.Vector3[] {
	const nodes: SimNode[] = d.stars.map((_, i) => {
		const y = 1 - (2 * (i + 0.5)) / Math.max(1, d.stars.length);
		const r = Math.sqrt(1 - y * y);
		const turn = i * Math.PI * (3 - Math.sqrt(5));
		return { x: Math.cos(turn) * r * keepOut * 1.5, y: y * keepOut * 1.5, z: Math.sin(turn) * r * keepOut * 1.5 };
	});
	let held: SimNode[] = [];
	const outside = () => {
		for (const n of held) {
			const len = Math.hypot(n.x!, n.y!, n.z!) || 1e-3;
			if (len >= keepOut) continue;
			const k = keepOut / len;
			n.x! *= k;
			n.y! *= k;
			n.z! *= k;
		}
	};
	outside.initialize = (ns: SimNode[]) => (held = ns);
	const sim = forceSimulation(nodes, 3)
		.force("link", forceLink(d.links.map(([source, target]) => ({ source, target }))).distance(22).strength(0.4))
		.force("charge", forceManyBody().strength(-30).distanceMax(300))
		.force("x", forceX(0).strength(0.05))
		.force("y", forceY(0).strength(0.05))
		.force("z", forceZ(0).strength(0.05))
		.force("outside", outside)
		.stop();
	for (let t = 0; t < 300; t++) sim.tick();
	return nodes.map((n) => new THREE.Vector3(n.x, n.y, n.z));
}
