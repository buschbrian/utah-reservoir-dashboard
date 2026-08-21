# Verification

One command per intent. Every target below runs the same underlying commands
CI runs, so a green local target means a green job.

| Target | Runs | Use when |
|---|---|---|
| `npm run verify:fast` | typecheck + Vitest | any TypeScript edit, as the inner loop |
| `npm run verify:frontend` | typecheck + Vitest + SDK budget + `vite build` | before finishing frontend work |
| `npm run verify:pipeline` | the pytest suite, which includes the committed drought-pair check | any Python or generated-data work |
| `npm run verify:browser` | production build, then both smoke suites | anything a browser renders, or any layout change |
| `npm run verify:all` | frontend, pipeline and browser in order | a cross-cutting change, before merge |

`verify:frontend` *is* `npm run build` — the four steps the Pages workflow
runs — under a name an agent can pick without reconstructing them.
`verify:pipeline` and `verify:browser` are `scripts/verify-pipeline.sh` and
`scripts/verify-browser.sh`, which the CI jobs call too, so a green run here is
a green job there. `scripts/python.sh` is the single place that decides which
interpreter to use.

## Choosing a target

Run the smallest target that can fail on your change:

- Changed a `src/**/*.ts` module with unit tests → `verify:fast`.
- Changed anything the SDK bundle or `dist/` layout depends on →
  `verify:frontend`.
- Changed Python, a generated-data rule, or a committed reference file →
  `verify:pipeline`.
- Changed the DOM, CSS, visible text, a layer, or a URL contract →
  `verify:browser`. Nothing else can see those.
- Touched two of the three areas, or moved a shared contract →
  `verify:all`.

**Both browser suites serve `dist/`, not `src/`.** `verify:browser` rebuilds
first for that reason: a smoke run after an un-built edit tests the previous
build and reports failures the working tree has already fixed, or passes work
that never compiled.

## Browser prerequisites

**Playwright is not in `package.json` on purpose, so `npm install` deletes
it.** CI installs it with `--no-save --no-package-lock` to keep the lockfile
exactly what `npm ci` produced, which means any ordinary `npm install` prunes
it as extraneous. Put it back the same way:

```bash
npm install --no-save --no-package-lock playwright
```

All three browser tools take `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. A machine
with Google Chrome installed does not need a second Chromium:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run verify:browser
```

## What each suite is for

`tests/smoke-modern.mjs` is the one that catches what the others cannot: a page
that loads, paints a basemap and renders no reservoirs at all. It asserts every
reservoir rendered, that no retired vocabulary is visible, that nothing overlaps
the map controls, and that there are no console errors. It also runs axe-core
over every page at every width and watches the font host — both catch things
nothing else can, because Calcite and the ArcGIS components put their real
controls inside shadow roots, and a mistyped label font 404s silently.

`tests/smoke.mjs` is the smaller redirect suite: saved-link translation, and
proof that no retired runtime is requested.

## On demand, not part of any target

```bash
node tools/profile-symbols.mjs                   # needs a real, visible browser window
node tools/audit-transfer.mjs                    # needs a built dist/ and Playwright
.venv/bin/python tools/build_normal_baselines.py --missing   # network job
.venv/bin/python tools/check_reference_freshness.py          # what is due to be re-checked
.venv/bin/python tools/measure_drought_convergence.py        # what the sampling step is worth
```

`audit-transfer.mjs` reports what each page actually requests and from which
hosts. It is the measurement the content policy was written from: when a layer
or service is added, run it and widen the policy from what it reports rather
than from what the service's documentation claims.

`profile-symbols.mjs` measures what the composed symbol and the filter effect
cost on the machine you run it on, and refuses to run in CI rather than report a
perfect score from a renderer that never drew. Leave the window in front.

## Two things automated tests cannot do

- The ArcGIS map canvas renders **blank in headless Chromium**, CI included, so
  uploaded screenshots prove much less than they look like they do. Colour
  balance, density and visual hierarchy need a human at a real browser.
- Hover cannot be exercised in a hidden pane: `requestAnimationFrame` never
  fires there and `view.hitTest()` never settles.
