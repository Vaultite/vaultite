# Colour schemes: where the palettes come from

Each scheme in this folder maps a published palette onto the app's tokens (index.css). The colours are the upstream
projects'; the mapping (which colour is the page, the cards, the sidebar, the headings) is ours. All are under
permissive licences that allow this with attribution.

| File | Palette | Upstream | Licence |
| --- | --- | --- | --- |
| gruvbox.css | Gruvbox | github.com/morhetz/gruvbox (Pavel Pertsev) | MIT/X11 |
| catppuccin.css | Catppuccin Latte and Mocha | github.com/catppuccin/catppuccin | MIT |
| nord.css | Nord | github.com/nordtheme/nord (Arctic Ice Studio, Sven Greb) | MIT |
| dracula.css | Dracula | github.com/dracula/dracula-theme (Zeno Rocha) | MIT |
| solarized.css | Solarized | github.com/altercation/solarized (Ethan Schoonover) | MIT |
| tokyo-night.css | Tokyo Night (Day and Night) | github.com/enkia/tokyo-night-vscode-theme, github.com/folke/tokyonight.nvim | MIT, Apache-2.0 |
| rose-pine.css | Rosé Pine (Dawn and Main) | github.com/rose-pine/rose-pine-theme | MIT |
| everforest.css | Everforest (medium) | github.com/sainnhe/everforest | MIT |
| kanagawa.css | Kanagawa (Lotus and Wave) | github.com/rebelot/kanagawa.nvim | MIT |
| one.css | One Light and One Dark | github.com/atom/atom (GitHub) | MIT |
| ayu.css | Ayu (light and dark) | github.com/ayu-theme/ayu-colors | MIT |
| github.css | GitHub (Primer) | github.com/primer/primitives | MIT |
| flexoki.css | Flexoki | github.com/kepano/flexoki (Steph Ango) | MIT |

Two more are the app's own palettes, not published ones: amethyst.css (white pages, a purple accent) and paper.css
(warm text on white, a calm blue). Only colour values; no CSS, fonts or images of any other app's. Their ids were
`obsidian` and `notion` until October 2026 and still work; the app isn't affiliated with either of those apps.

Some surfaces the originals don't define (a card a step off the page, a sidebar a step darker) are mixed from their
own colours. Obsidian themes the user drops in their vault are converted at runtime (core/appearance.ts) and are not
part of the app.
