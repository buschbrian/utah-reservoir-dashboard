---
name: verify
description: Choose and run the right verification target for a change, and know what each suite can and cannot prove. Use before declaring any work complete.
---

# Verify

**Trigger:** you are about to say a change is finished, or you need to know
which checks a change requires.

## Choose one target

| Change | Target |
|---|---|
| A TypeScript module with unit tests | `npm run verify:fast` |
| Anything the SDK bundle or `dist/` layout touches | `npm run verify:frontend` |
| Python, a generated file, or a committed reference file | `npm run verify:pipeline` |
| DOM, CSS, visible text, a layer, a URL contract | `npm run verify:browser` |
| Two of the three areas, or a shared contract | `npm run verify:all` |

Run the smallest target that can fail on your change. Do not assemble the
underlying commands by hand; the targets are what CI runs.

## Before the browser target

```bash
npm install --no-save --no-package-lock playwright   # if npm install pruned it
export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
```

`verify:browser` rebuilds first on purpose: both suites serve `dist/`, so a run
after an un-built edit tests the previous build.

## What the suites cannot prove

- The ArcGIS canvas is **blank in headless Chromium**. A screenshot is not
  evidence that a map drew. Say so instead of implying a visual check.
- Hover is unexercisable in a hidden pane: `requestAnimationFrame` never fires
  and `view.hitTest()` never settles.
- Colour balance, density and visual hierarchy need a human at a real browser.

## Done means

The chosen target exits zero, you have named it in your report, and any failure
you could not fix is stated with its output rather than summarised away. A
pre-existing failure is reported as pre-existing, not silently inherited.

Detail: [`docs/operations/verification.md`](../../../docs/operations/verification.md).
