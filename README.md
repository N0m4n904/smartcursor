# Smart Cursor

A custom pointer for the web: a glowing dot plus a ring that morphs onto whatever
it hovers.

- **Idle** — the ring is a small circle trailing the pointer.
- **Over an interactive element** — the ring animates onto that element's
  outline, matching its position, size and corner radius.
- **Over a text surface** — the ring fades out and the dot becomes a caret.

It picks its own colours from the background it sits on (dark ring on light
surfaces, light ring on dark ones), so it stays visible across themes without
per-page configuration.

Two files, no build step, no dependencies.

<https://github.com/N0m4n904/smartcursor>

## Install

Both files must be loaded: the stylesheet carries the configuration tokens the
script reads back, so the script alone will silently fall back to its built-in
defaults.

### From a CDN

jsDelivr serves any file in a public GitHub repository with the right MIME type,
so no hosting setup is needed — paste these two tags into your page:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/N0m4n904/smartcursor@v1.0.0/smartcursor.css">
<script src="https://cdn.jsdelivr.net/gh/N0m4n904/smartcursor@v1.0.0/smartcursor.js" defer></script>
```

The part after `@` is a git tag, branch or commit SHA:

| Reference | URL fragment | Behaviour |
|---|---|---|
| Tag | `@v1.0.0` | Immutable, cached permanently. **Use this in production.** |
| Branch | `@main` | Follows the branch, but jsDelivr caches it for up to 12 hours — an edit will not appear immediately. |
| Commit | `@a1b2c3d` | Immutable, pins one exact revision. |
| *(omitted)* | `smartcursor/smartcursor.js` | Resolves to the latest tag. Convenient, but a future release can change the cursor under you. |

Tag a release before pointing a live site at it:

```sh
git tag v1.0.0
git push origin v1.0.0
```

For a third-party CDN it is worth pinning the file contents as well as the
version. Compute the hashes once, after pushing:

```sh
openssl dgst -sha384 -binary smartcursor.js | openssl base64 -A
```

```html
<script src="https://cdn.jsdelivr.net/gh/N0m4n904/smartcursor@v1.0.0/smartcursor.js"
        integrity="sha384-<hash>" crossorigin="anonymous" defer></script>
```

### From GitHub Pages

If Pages is enabled for the repository (*Settings → Pages*, source `main`), the
files are also served correctly from:

```html
<link rel="stylesheet" href="https://n0m4n904.github.io/smartcursor/smartcursor.css">
<script src="https://n0m4n904.github.io/smartcursor/smartcursor.js" defer></script>
```

This always reflects the current branch, with no CDN cache in front of it —
handy while developing, less predictable for a live site.

### Self-hosted

Copy both files into your own site and reference them by path. This is the only
option that works for a private repository:

```html
<link rel="stylesheet" href="/smartcursor.css">
<script src="/smartcursor.js" defer></script>
```

### Do not link to raw.githubusercontent.com

```html
<!-- Does not work -->
<script src="https://raw.githubusercontent.com/N0m4n904/smartcursor/main/smartcursor.js"></script>
```

Raw URLs are served as `text/plain` with `X-Content-Type-Options: nosniff`, so
the browser refuses to execute the script and ignores the stylesheet. The
failure is quiet — the page loads, the cursor simply never appears. Use jsDelivr
or Pages instead.

### Placement

The script appends its overlays to `<body>` as soon as it runs, so it must not
run before the body exists — use `defer` (as in every example above) or place
the `<script>` tag at the end of `<body>`.

Load `smartcursor.css` **before** any stylesheet of your own that overrides its
tokens, since the defaults are declared on `:root`.

## Configure

### Colour

The dot reads two custom properties off `:root` and picks whichever suits the
background it is currently over:

```css
:root {
  --brand: #a60430;       /* used on light backgrounds */
  --brand-light: #ff7a9c; /* used on dark backgrounds  */
}
```

Both should be readable against the surface they are named for. If a property is
missing, that case falls back to `#a60430`. The ring's border colour is derived
from the background automatically and is not configurable.

### Size and feel

Every dimension is a custom property, declared once at the top of
`smartcursor.css`. There are no geometry constants left in the JavaScript — it
reads the three values it animates back out of `:root` — so retuning the cursor
means overriding these and nothing else:

| Property | Default | Controls |
|---|---|---|
| `--sc-dot-size` | `6px` | diameter of the dot |
| `--sc-dot-glow` | `6px` | inner glow radius; the outer layer is 3× this |
| `--sc-ring-size` | `34px` | diameter of the idle ring |
| `--sc-ring-width` | `2px` | ring border thickness |
| `--sc-ring-opacity` | `0.65` | ring opacity when idle |
| `--sc-ring-opacity-morph` | `0.9` | ring opacity when morphed onto an element |
| `--sc-pad` | `5px` | gap left between a hovered element and the ring |
| `--sc-ease` | `0.3` | how far the ring closes on its target each frame |
| `--sc-caret-width` | `2px` | thickness of the caret over text |
| `--sc-caret-scale` | `1.2` | caret height as a multiple of the text's font size |

Override them from a stylesheet loaded **after** `smartcursor.css`:

```css
:root {
  --sc-ring-size: 44px;  /* a larger, looser ring */
  --sc-pad: 8px;
  --sc-ease: 0.18;       /* … that trails further behind the pointer */
}
```

`--sc-ease` is a rate, not a duration: `1` snaps instantly, lower values trail
more. It is clamped to `0.01`–`1`, since `0` would freeze the ring in place.

Declare these on `:root`. Setting one on an individual element has no effect —
the script resolves them from the document root, so a component cannot request
its own ring padding.

Lengths may use any CSS unit, not just `px` — `--sc-ring-size: 2.5rem` works.
Relative units are resolved by the browser at read time, with `em` and `%`
resolving against `<body>`.

### The caret

The caret is not a fixed size — it takes its height from the text it sits in,
as `font-size × --sc-caret-scale`. An 11px field gets a 13px caret and a 32px
one gets a 38px caret, and the dot's height transition animates between them as
the pointer crosses from one to the other.

The measurement is taken from the element **actually under the pointer**, not
from the `input`/`textarea`/`[contenteditable]` that `TEXTUAL` matched. Inside a
rich editor the pointer may be over a heading or a code span with its own size,
and that local size is what a native caret would take.

`--sc-caret-width` is deliberately not scaled — native carets stay thin
regardless of text size. Override it if you want otherwise.

### When the tokens are read

The script reads these at startup and again on `smartCursor.refresh()`, never
per frame — resolving custom properties forces a style recalculation, which the
animation loop stays clear of. So a theme that also retunes sizes only needs the
same `refresh()` call it already makes for colour; the ring animates to the new
geometry rather than jumping to it.

## Tell it what is interactive

The two selectors near the top of `smartcursor.js` are the main thing you will
want to edit. They decide which of the three modes applies:

```js
const INTERACTIVE =
  'a, button, select, label, summary, [role="button"], .card, .server-card, .tab, .link-btn';

const TEXTUAL =
  'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]),' +
  'textarea, [contenteditable="true"], .xterm';
```

`INTERACTIVE` is what the ring morphs onto. Replace the project-specific classes
(`.card`, `.server-card`, `.tab`, `.link-btn`, and `.xterm` in `TEXTUAL`) with
your own — they are examples, not part of the library.

`TEXTUAL` wins over `INTERACTIVE`: anything matching it gets the caret. It is
meant for *typable* surfaces. Clickable inputs — checkboxes, radios, and the
button-like input types — are excluded on purpose so they keep the ring.

The ring targets the **innermost** match, so a card containing its own buttons
gives each button a snug ring rather than outlining the whole card. Both overlays
are `pointer-events: none`, so clicks always pass through to your page.

## Turning it on

**It is off by default, and stays off until something enables it.** Loading the
files alone changes nothing on the page — this is deliberate: replacing the
system cursor is a preference, not something to impose on every visitor.

Enable it through the global API:

```js
smartCursor.setEnabled(true);   // turn on and remember the choice
smartCursor.setEnabled(false);  // turn off and remember the choice
smartCursor.isEnabled();        // → boolean
```

`setEnabled` persists to `localStorage` under the key `smartCursorV2`, and that
value is what the script reads on the next page load. Wiring it to a settings
toggle is the whole integration:

```html
<label>
  <input type="checkbox" id="cursor-toggle">
  Smart cursor
</label>
```

```js
const toggle = document.getElementById('cursor-toggle');
toggle.checked = smartCursor.isEnabled();
toggle.addEventListener('change', () => smartCursor.setEnabled(toggle.checked));
```

Because `smartcursor.js` runs in an IIFE, `window.smartCursor` only exists after
the script has executed — read it from your own deferred script or an event
handler, not from inline markup earlier in the page.

### Theme switches

The script caches the background luminance it measured per element. After a
theme change those caches are stale, so call:

```js
smartCursor.refresh();
```

from wherever you swap themes. It drops the luminance caches and re-reads the
size tokens, so a theme may retune geometry as well as colour. This is the one
hook you must remember to call; everything else is automatic.

## What it handles for you

- **Touch devices** — under `(hover: none)` the overlays are hidden, the native
  cursor is restored, and `setEnabled(true)` is forced to off. There is no
  pointer to replace, so nothing you do can switch it on.
- **Fullscreen** — a fullscreen element renders in the browser's top layer, above
  any `body`-level overlay, which would leave the page cursor-less. The overlays
  reparent into the fullscreen element on `fullscreenchange` and back out on
  exit.
- **Pointer leaving the window** — the overlays fade out on `mouseout` with no
  related target, and on window `blur` (Alt-Tab).
- **The page changing under a resting pointer** — clicking something that opens a
  modal or closes a drawer produces no `mousemove`, so the ring would keep
  hugging a now-covered element. The target is re-resolved once after each click.

## CSS notes

`smartcursor.css` hides the native cursor via `html.sc-on, html.sc-on * { cursor: none !important }`.
The `.sc-on` class is added and removed by `setEnabled`, so the native pointer
comes straight back when the feature is off.

The overlays sit at `z-index` 99998 (ring) and 99999 (dot). If your own UI stacks
above that, the cursor will be drawn behind it — lower your stack or raise these.

Do **not** add CSS transitions for the ring's `transform`, `width`, `height` or
`border-radius`. Those are interpolated per frame in JavaScript and a CSS
transition on the same properties will fight the animation. Only paint properties
(`opacity`, `border-color`, `background-color`) transition in CSS.

## Performance

The design keeps per-frame work at close to zero when nothing is happening:

- The hovered element comes from `mousemove`'s `e.target` — no `elementFromPoint`
  polling and no forced style recalculation on the hot path.
- Mode and colour resolution runs only when the hovered element actually changes,
  with per-element luminance caching.
- Position is written as a `translate3d` transform (compositor-only) rather than
  `left`/`top`.
- The animation snaps to its target below 0.1px and then stops writing styles
  altogether, so an idle pointer costs no paint work per frame.

## Browser support

Any browser with `WeakMap`, `Element.closest`, `matchMedia` and
`requestAnimationFrame` — that is, every current engine. The source is plain ES5+
with no modules, so it can be served as-is or concatenated into an existing
bundle.
