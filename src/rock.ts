import * as THREE from "three";
import { ConvexGeometry } from "three/examples/jsm/geometries/ConvexGeometry.js";
import logo from "./obsidian-logo-gradient.svg";

// Obsidian's purple, for the 3D rock, which is drawn here after the app's logo (the labels show the logo itself).
export const ROCK_PURPLE = "#6c31e3";

// A tall, lopsided crystal about two units high: the corners of a faceted purple rock.
const CORNERS: [number, number, number][] = [
	[0.12, 1.15, 0.05],
	[-0.08, -1.0, 0.02],
	[0.7, 0.3, 0.12],
	[0.32, 0.6, 0.55],
	[-0.48, 0.42, 0.42],
	[-0.66, -0.08, -0.04],
	[-0.28, 0.25, -0.62],
	[0.42, -0.18, -0.55],
	[0.52, -0.52, 0.34],
	[-0.34, -0.58, 0.38],
];

export function rockGeometry() {
	// The hull's triangles each carry their own normal, so every facet catches the light on its own.
	return new ConvexGeometry(CORNERS.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
}

export function rockMaterial() {
	return new THREE.MeshStandardMaterial({
		color: ROCK_PURPLE,
		emissive: "#2a0f66",
		roughness: 0.35,
		metalness: 0.1,
		flatShading: true,
	});
}

// Obsidian's logo for the drop-down labels, unmodified, from obsidian.md/brand. Shown as an image, never edited.
export const LOGO_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(logo)}`;
