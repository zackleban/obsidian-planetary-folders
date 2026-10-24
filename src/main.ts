import { debounce, Plugin, setIcon, setTooltip, View } from "obsidian";
import { findPlanets, PlanetData } from "./folders";
import { PlanetSpace, Spot } from "./space";

interface Prefs {
	on: boolean;
	// Folder keys of the planets left open.
	open: string[];
	// Where each planet was left, by folder key.
	places: Record<string, Spot>;
}

const DEFAULTS: Prefs = { on: false, open: [], places: {} };

// What this plugin adds to one graph view.
interface Attached {
	button: HTMLElement;
	space: PlanetSpace | null;
	// Planets, notes and links last drawn, so a refresh that changes nothing leaves the view alone.
	shape: string;
}

export default class PlanetaryFoldersPlugin extends Plugin {
	private prefs: Prefs = { ...DEFAULTS };
	private attached = new Map<View, Attached>();
	private savePlaces = debounce(() => void this.saveData(this.prefs), 1000, true);

	async onload() {
		this.prefs = Object.assign({}, DEFAULTS, await this.loadData());

		const attach = () => this.attachAll();
		this.app.workspace.onLayoutReady(attach);
		this.registerEvent(this.app.workspace.on("layout-change", attach));
		this.registerEvent(this.app.workspace.on("active-leaf-change", attach));
		this.registerEvent(this.app.workspace.on("css-change", () => this.attached.forEach((a) => a.space?.recolor())));

		const refresh = debounce(() => void this.refreshAll(), 1000, true);
		this.registerEvent(this.app.metadataCache.on("resolved", refresh));
		this.registerEvent(this.app.vault.on("delete", refresh));
		this.registerEvent(this.app.vault.on("rename", refresh));
	}

	onunload() {
		this.attached.forEach((a) => this.detach(a));
		this.attached.clear();
	}

	// Puts the planet button in the graph's controls column: under 3D Animation with Toggle's 2D/3D toggle when
	// that plugin is on, else under the timelapse wand.
	private attachAll() {
		const live = new Set<View>();
		for (const leaf of this.app.workspace.getLeavesOfType("graph")) {
			const view = leaf.view;
			live.add(view);
			const known = this.attached.get(view);
			if (known && known.button.isConnected) continue;
			if (known) this.detach(known);
			const controls = view.containerEl.querySelector<HTMLElement>(".graph-controls");
			const after = controls?.querySelector<HTMLElement>(".three-d-toggle") ?? controls?.querySelector<HTMLElement>(".mod-animate");
			if (!after) continue;
			this.attached.set(view, this.attach(view, after));
		}
		for (const [view, a] of this.attached) {
			if (live.has(view)) continue;
			this.detach(a);
			this.attached.delete(view);
		}
	}

	private attach(view: View, after: HTMLElement): Attached {
		const button = createDiv("clickable-icon graph-controls-button mod-planetary");
		setIcon(button, "orbit");
		setTooltip(button, "Planetary folders");
		after.insertAdjacentElement("afterend", button);
		const a: Attached = { button, space: null, shape: "" };
		button.addEventListener("click", () => void this.setOn(!this.prefs.on));
		button.toggleClass("is-active", this.prefs.on);
		if (this.prefs.on) void this.show(view, a);
		return a;
	}

	private detach(a: Attached) {
		a.space?.destroy();
		a.button.remove();
	}

	private async setOn(on: boolean) {
		this.prefs.on = on;
		await this.saveData(this.prefs);
		for (const [view, a] of this.attached) {
			a.button.toggleClass("is-active", on);
			if (on) await this.show(view, a);
			else {
				a.space?.destroy();
				a.space = null;
			}
		}
	}

	private spaceFor(view: View, a: Attached) {
		if (!a.space) {
			const content = view.containerEl.querySelector<HTMLElement>(".view-content") ?? view.containerEl;
			const space = new PlanetSpace(content, {
				open: (path, tab) => void this.app.workspace.openLinkText(path, "", tab),
				toggled: (key, open) => {
					this.prefs.open = this.prefs.open.filter((k) => k !== key);
					if (open) this.prefs.open.push(key);
					void this.saveData(this.prefs);
				},
				moved: () => {
					this.prefs.places = { ...this.prefs.places, ...space.places() };
					this.savePlaces();
				},
			});
			a.space = space;
		}
		return a.space;
	}

	private async show(view: View, a: Attached, planets?: PlanetData[]) {
		const data = planets ?? (await findPlanets(this.app));
		a.shape = shapeOf(data);
		this.spaceFor(view, a).show(data, new Set(this.prefs.open), this.prefs.places);
	}

	private async refreshAll() {
		if (!this.prefs.on) return;
		const data = await findPlanets(this.app);
		for (const [view, a] of this.attached) {
			if (a.space && shapeOf(data) !== a.shape) await this.show(view, a, data);
		}
	}
}

function shapeOf(planets: PlanetData[]) {
	return JSON.stringify(planets.map((p) => [p.key, p.stars.map((s) => s.path), p.links]));
}
