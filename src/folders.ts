import { App, TFile } from "obsidian";

export interface Star {
	path: string;
	name: string;
	// Links in or out inside its own planet, for the dot's size.
	degree: number;
}

export interface PlanetData {
	// Folder path; "" for the notes outside every folder.
	key: string;
	name: string;
	stars: Star[];
	// Pairs of star indexes, both in this planet. Links between planets are left out: planets never connect.
	links: [number, number][];
}

/*
 * A planet is a subvault (a folder holding its own .obsidian folder). A vault with none of those is split by its
 * top-level folders instead. Notes outside every planet form one more, named after the vault.
 */
export async function findPlanets(app: App): Promise<PlanetData[]> {
	const adapter = app.vault.adapter;
	const folders = app.vault.getAllFolders(false);
	const nested = (
		await Promise.all(folders.map(async (f) => ((await adapter.exists(`${f.path}/.obsidian`)) ? f.path : null)))
	).filter((p): p is string => p !== null);
	const roots = nested.length > 0 ? nested : app.vault.getRoot().children.filter((c) => !(c instanceof TFile)).map((c) => c.path);
	// Deepest first, so a subvault inside a subvault wins.
	const deepest = [...roots].sort((a, b) => b.length - a.length);
	const keyOf = (path: string) => deepest.find((r) => path.startsWith(r + "/")) ?? "";

	const byKey = new Map<string, Star[]>();
	for (const f of app.vault.getMarkdownFiles()) {
		const key = keyOf(f.path);
		if (!byKey.has(key)) byKey.set(key, []);
		byKey.get(key)!.push({ path: f.path, name: f.basename, degree: 0 });
	}

	const planets: PlanetData[] = [];
	const keys = [...byKey.keys()].sort((a, b) => ((a === "") !== (b === "") ? (a === "" ? 1 : -1) : a.localeCompare(b)));
	for (const key of keys) {
		const stars = byKey.get(key)!.sort((a, b) => a.path.localeCompare(b.path));
		const index = new Map(stars.map((s, i) => [s.path, i]));
		const links: [number, number][] = [];
		const seen = new Set<string>();
		for (const s of stars) {
			const a = index.get(s.path)!;
			for (const to of Object.keys(app.metadataCache.resolvedLinks[s.path] ?? {})) {
				const b = index.get(to);
				if (b === undefined || b === a) continue;
				const pair = a < b ? `${a}:${b}` : `${b}:${a}`;
				if (seen.has(pair)) continue;
				seen.add(pair);
				links.push([a, b]);
				stars[a].degree++;
				stars[b].degree++;
			}
		}
		planets.push({ key, name: key === "" ? app.vault.getName() : key.split("/").pop() ?? key, stars, links });
	}
	return planets;
}
