# Planetary Folders

Turns the graph view into a solar system of folders. A planet button (an orbit) sits in the graph's controls column,
under 3D Animation with Toggle's 2D/3D toggle when that plugin is on, else under the timelapse wand. Turn it on and
every folder becomes a planet:

- **Closed**, a planet is a faceted purple rock (modelled after Obsidian's logo) with a drop-down label above it: a
  chevron, the Obsidian logo, the folder's name and how many notes it holds.
- **Click the rock or its label** and the planet opens: its notes come out of the rock as their own constellation,
  linked notes close together, each planet in its own colour. Click again and they fold back in.
- **Planets never touch or connect.** Only links inside a planet are drawn. An opening planet pushes the others back
  so there is always empty space between them.

Moving around:

- Drag to turn, in any direction (it keeps going past the top and bottom); scroll to zoom; right-drag to pan.
- Double-click to zoom in around that spot; Alt-double-click to zoom out.
- Press and hold still for a quarter second to grab the view: the pointer turns into a closed hand and dragging slides
  everything left, right, up and down, without turning.
- **Hold both mouse buttons (left and right) on a planet** to carry it: it follows the mouse, with the closed hand,
  and stays where you let go. Planets it bumps into move out of its way.
- Hover a note for its name; click it to open it (Cmd-click for a new tab).

Which planets are open, and where each was left, are saved.

## Planets

A planet is any folder that holds its own `.obsidian` folder (a subvault). A vault with none of those is split by its
top-level folders instead. Notes outside every planet form one more, named after the vault. Only notes (`.md`) are
shown.

## Install by hand

Copy `main.js`, `manifest.json` and `styles.css` into `<your vault>/.obsidian/plugins/planetary-folders/`, then turn it
on under Settings, Community plugins.

## Build

```
npm install
npm run build
```

`npm run dev` rebuilds on every save. Built with three.js and d3-force-3d (both MIT).

## The Obsidian logo

The Obsidian name and logo are trademarks of Obsidian. The labels show the logo exactly as published at
[obsidian.md/brand](https://obsidian.md/brand) (`src/obsidian-logo-gradient.svg`), unedited and never recoloured, only
scaled down. This plugin is free and is not made by or affiliated with Obsidian. The 3D rocks are this plugin's own
model, not the logo.
