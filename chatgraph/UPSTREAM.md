# Upstream integration

- Repository: https://github.com/tt-a1i/archify
- Baseline: `72c750bb070d95171dbb2244e5b62b1b7da69c12`
- Upstream development version at baseline: `2.17.0-dev.1`
- Local feature branch: `chatgraph/mindmap-workspace`
- License: MIT; root `LICENSE`, `THIRD_PARTY_NOTICES.md` and embedded font OFL are retained.

The checkout retains the original history and `origin` pointing to Archify. ChatGraph is an independent product distribution; publication uses a separate `chatgraph` remote. No pull request is submitted to upstream. Public hosted deployment is separate from a source-code release.

ChatGraph application code is located in `chatgraph/`; the root README, Docker exclusions and dedicated GitHub workflow provide its distribution entry points. The original root README is preserved as `ARCHIFY_README.md`. Its renderer imports `applyTemplate`, `esc`, and `textUnits` from `archify/renderers/shared/utils.mjs`, and reads the generated viewer at `archify/assets/template.html`. It generates its own conversation-specific SVG with the upstream semantic node/edge attributes. Nodes have a non-transformed outer semantic group; positioning is applied to an inner group so Archify's `getBBox()`-based camera and radar receive diagram-space bounds. Export viewBoxes start at `0 0`.

The CLI renderer modules are not imported because their top-level behavior reads argv and writes files. ChatGraph does not modify existing architecture/workflow schemas or pretend their engineering constraints validate conversation semantics. Its own graph validator checks IDs, enums, references, tree cycles, bounds and sizes. AI extraction adds role and user-decision evidence checks.

ChatGraph does not use third-party technology brand marks. Standalone HTML uses the upstream template including embedded JetBrains Mono and its SIL Open Font License. ChatGraph's SVG exports use system fonts and require no downloaded image assets.

Upgrade procedure: update in a separate branch, inspect `utils.mjs`, template placeholder and semantic viewer contracts, run ChatGraph tests, run upstream generated-viewer freshness checks, then verify a standalone export's camera, search, semantic bounds and sources in a real browser. Do not regenerate upstream artifacts unless their authoritative inputs change.
