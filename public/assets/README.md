# Vendored Calcite runtime assets

This directory contains only the icons and English localization messages used
by the Phase 2 shell. They are copied unchanged from
`@esri/calcite-components` 5.1.2. Keeping this small runtime subset local
prevents browser privacy tools from turning navigation controls into blank
buttons when they block the default Calcite asset CDN.

When a shell component or icon changes, copy its required JSON files from
`node_modules/@esri/calcite-components/dist/cdn/assets/` and update the asset
contract in `src/architecture.test.ts`. Do not copy the package's complete
27 MiB asset directory.
