# Bevelled paper mat — 0.2.1

Frame & mat → Mat → Paper edge offers Flat and Bevelled, with a preview and selected checkmark for each. Colour remains a separate nine-option grid. Mat-tab Down reaches the selected finish; Left/Right moves between finishes; Down reaches the selected colour; successive Down presses lead through the colour grid to Done. Back closes the dialog. Both finish controls remain reachable when No mat is selected; no paper edge is drawn until a mat colour is chosen.

`matStyle` is saved per artwork in the existing looks setting. Legacy records default to Flat without a schema migration or rewriting user choices. No mat suppresses the bevel, shadow and paper lighting while retaining the saved finish for when a colour is selected again. No raster assets, runtime libraries or network services are added.

Design review used the apple-design skill’s general layout, colour, button and focus principles, applied to the established Samsung D-pad interface. Controls retain explicit focus outlines and selection checkmarks; the paper lighting belongs to artwork content. Apple platform navigation conventions were not applied.


## Two bevel widths, 0.6.1

The original `bevel` value is now labelled **Bevelled thin** and keeps its original geometry. **Bevelled thick** uses `bevel-thick`, with a slightly wider edge (clamp 4 px / 0.68 vmin / 10 px versus thin 3 px / 0.48 vmin / 7 px). Both use the same paper colours and directional shading. Preview edges use 2 px and 3 px. Both are available per artwork and in global appearance; No mat suppresses both. Three finish buttons have explicit left/right D-pad links. No existing saved selection is migrated or enlarged.
