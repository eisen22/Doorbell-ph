# Doorbell logo (November 2026)

A ringing bell: the bell that tells the parent their child has arrived. Made with Recraft from our brief,
then set up for the app. Logo green **#779931**, near-black **#1B1D19** (the app's ink), white.

| File | Use |
|---|---|
| `doorbell-app-icon.svg` | White bell on the green rounded tile: browser tab icon, sidebar, gate app icon, small sizes |
| `doorbell-icon-color.svg` | The bell alone, green |
| `doorbell-horizontal-color.svg` | Bell + "Doorbell" side by side (headers, documents) |
| `doorbell-stacked-color.svg`, `doorbell-color.svg` | Bell above "Doorbell" (title pages, posters) |
| `doorbell-wordmark-color.svg` | "Doorbell" only |
| `doorbell-mono.svg` | All near-black (printing in one color) |
| `doorbell-inverse.svg` | All white, for dark backgrounds |
| `doorbell-reversed.svg` | White logo on a green square |

Below about 48 px use `doorbell-app-icon.svg` (the bell's rays are too thin to read on their own).
In the code: `Logo()` in `src/ui.jsx`, the tab icon in `index.html`, and `doorbell_mark.xml` /
`ic_launcher_foreground.xml` in the gate app draw this same bell.

The previous logo (a bell shaped like an arched door) is in `v1-arched-door/`.
