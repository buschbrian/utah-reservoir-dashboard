# ADR-027: Use CSS pixels for map symbols and opening labels

## Status

Superseded by ADR-030

## Date

2026-08-14

## Context

ADR-025 defined the primary map's reservoir diameters as 8–36 CSS pixels and
kept them fixed while the view zoomed. The arithmetic and tests used those
pixel values, but the CIM renderer passed them directly to numeric `size`
properties. CIM defines that property in typographic points. At the CSS
reference density, 36 points draw as 48 pixels, so the symbol shipped one
third wider than the value the sizing code and tests claimed. Dense groups
therefore still covered one another in the opening view.

Drainage-area labels were limited to scales of 1:10,000,000 and closer. The
fixed opening extent resolves to a different scale for each viewport, and the
desktop map can open farther out than that limit. Labels that did draw used a
numeric 1.25-point halo, which varied from the pixel dimensions used by the
rest of the interface and did not separate the text reliably from reservoirs
and boundary lines.

## Decision

Keep the 8–36 CSS-pixel symbol range and fixed-on-screen behavior from
ADR-025. Convert every pixel dimension to points at the CIM boundary using
`72 / 96`. The ring, storage fill, shadow size and shadow offset all use the
same conversion. A simple marker that supports explicit units, such as the
selection ring, receives a `px` value instead.

Show one drainage-area label per source feature at scales of 1:25,000,000 and
closer so the names are eligible at every tested opening viewport. Allow the
text to extend beyond a narrow polygon, retain static label deconfliction, and
use an explicit 11-pixel font with a 2-pixel near-white halo and darker text.

## Alternatives Considered

### Lower the symbol constants until the rendered circles look smaller

- Rejected: it would compensate for the unit error with unexplained values.
  Future code would still be unable to compare a tested pixel diameter with
  the rendered result.

### Scale symbols down only at the opening view

- Rejected: it reintroduces view-scale-dependent symbols. Fixed-size circles
  let zooming separate nearby reservoir centers without enlarging them at the
  same time.

### Force every drainage label to draw

- Rejected: disabling label deconfliction can replace a missing label with two
  unreadable labels on top of one another. The wider scale range and stronger
  halo improve eligibility and contrast while the label engine still manages
  collisions.

## Consequences

- The largest reservoir circle is the intended 36 CSS pixels instead of
  approximately 48 CSS pixels.
- The sizing arithmetic, tests and rendered CIM symbols now use the same unit.
- Drainage-area names are present in the opening view when the label engine
  can place them and remain readable across map backgrounds.
- ADR-025 is superseded. Its decisions about fixed symbol size, draw order,
  panel padding and one label source per drainage area remain in force here.
