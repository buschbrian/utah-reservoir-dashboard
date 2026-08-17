# ADR-045: Name the site for the water, and each page for its own subject

- Status: Accepted
- Date: 2026-08-16

## Context

The site was the "Utah Reservoir Dashboard", which was accurate when
reservoirs were all it carried. It now has five surfaces, and two of them —
the snowpack view and the weekly drought map — are not about reservoirs at
all. The name described roughly a third of the product.

There was a second, quieter problem. `brandMarkup` produced the site name as
the page's `h1`, on every page. So a reader moving between five surfaces was
told the same thing five times and never which one they were on, and every
page's document outline began with a heading that carried no information about
that page. The navigation bar named the current page only by *omitting* it
from the button row.

## Decision

**The site is the Utah Water Dashboard** (`Utah Water` where the bar is too
narrow for the whole of it), and **each page's `h1` is its own subject**:

| Page | Subject |
|---|---|
| `index.html`, `modern.html` | Utah Reservoir Storage |
| `overview.html` | Utah Storage Charts |
| `snow.html` | Utah Snowpack |
| `drought.html` | Utah Drought |
| `methods.html` | Methods and Sources |
| `data.html` | Public Data API |

The site name stays above the heading as ordinary text, because the site is
the context and the page is the subject. Document titles are
`<subject> — Utah Water Dashboard`.

**Two names per page, and they are not the same name.** The bar's button text
stays short — "Snowpack" — because `calcite-navigation` clips rather than
scrolls and the width is the binding constraint there. The subject is the
longer form, for a browser tab, a bookmark or a shared link, where there is no
bar around it to supply the context.

`PAGE_SUBJECTS` is keyed by `PageId` rather than derived from the navigation
table, because the two lists genuinely differ: the public data documentation
is a page a reader can be on and is deliberately not in the bar.

## Consequences

- Every page's document outline now begins with a heading that describes that
  page, which is what a screen-reader user navigating by heading expects.
- `SITE_NAME` is exported and spelled once. A second literal spelling of it is
  how the bar and the tab drift apart, and a test asserts both halves for every
  page.
- The three-line brand stack does not fit a 64px bar at every width. The SDK
  name is the line that drops below 75rem — ADR-016 requires it in the
  navigation and it is still there wherever the bar can hold it, and a reader
  who cannot tell which page they are on is worse off than one who cannot see
  which SDK drew it.
- The redirect pages and the loading text carry the new name too.

## Alternatives considered

**Keep "Utah Reservoir Dashboard".** Accurate for one surface of five and
actively misleading about the other two.

**Put the page name in the bar's button row as well.** The bar clips; this is
the constraint that already forced the buttons to their short form.

**Leave the `h1` as the site name and add a visually hidden page heading.**
Two headings claiming to be the page's name, one of them invisible, is worse
than one correct one.
