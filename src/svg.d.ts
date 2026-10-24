// SVG files are bundled as their text (see esbuild.config.mjs).
declare module "*.svg" {
	const text: string;
	export default text;
}
