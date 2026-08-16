// Smart cursor: a glowing dot plus a morphing ring. Idle, the ring is a small
// circle trailing the pointer; over an interactive element it morphs onto that
// element's outline (position, size and corner radius), over text it yields to
// a caret. The ring targets the INNERMOST interactive element (closest() walks
// up from the target), so a card's edit/remove buttons get their own snug ring
// instead of the whole card — and since both overlays are pointer-events:none,
// clicks always pass through.
//
// Performance rules: e.target from mousemove is the element under the pointer
// (no elementFromPoint, no forced recalcs); mode/colour work runs only when
// the hovered element changes, with per-element luminance caching; geometry
// lerps run in one rAF loop as compositor-friendly transforms plus small
// width/height writes on the ring.
(function () {
  'use strict';

  // v2 key on purpose: v1 auto-persisted "on" for everyone at load, so the
  // stored value never reflected a user choice. v2 is only written on an
  // explicit toggle, and the default is OFF.
  const PREF = 'smartCursorV2';
  const root = document.documentElement;
  const noHover = window.matchMedia('(hover: none)').matches;

  const dot = document.createElement('div');
  const ring = document.createElement('div');
  dot.className = 'smart-cursor off';
  ring.className = 'smart-cursor-ring off';
  document.body.appendChild(dot);
  document.body.appendChild(ring);

  // --- the drawn ring -------------------------------------------------------
  //
  // In sketch mode the ring is not a bordered box but a path this file draws.
  // The deviations are worked out once, as fractions of a wiggle, and mapped
  // onto whatever rectangle the ring currently is — so the wobble belongs to
  // the ring and holds still while it moves, instead of being rolled afresh
  // every frame, which would read as noise. Two sets of them, swapped a few
  // times a second, are what a redrawn line looks like.
  const SVG_NS = 'http://www.w3.org/2000/svg';
  // How far apart the deviations sit, along the line. Density is what has to
  // stay constant, not their number: a fixed count crowds them together on a
  // small ring — at the idle size they landed three pixels apart and turned a
  // circle into a gear — and spreads them thin around a large one.
  const SPACING = 16;
  const LEAST = 8;
  const MOST = 64;
  const PROFILE = 64;
  let sketchSvg = null;
  let sketching = false;   // drawn only while the ring is hugging something
  let sketchPath = null;
  let hands = null;
  let hand = 0;
  let lastBoil = 0;
  let sW = -1, sH = -1, sR = -1;

  function makeHands() {
    let seed = 1712;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648 - 0.5;
    };
    const one = () => {
      const out = new Array(PROFILE);
      for (let i = 0; i < PROFILE; i++) out[i] = next() * 2;
      return out;
    };
    return [one(), one()];
  }

  // A point and its outward normal at a distance along a rounded rectangle,
  // which is the one shape the ring ever takes: a circle is simply the case
  // where the corners have eaten both sides.
  function ringPath(w, h, r, deviations, wiggle) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    const flatX = Math.max(0, w - 2 * r);
    const flatY = Math.max(0, h - 2 * r);
    const arc = (Math.PI * r) / 2;
    const perimeter = 2 * flatX + 2 * flatY + 4 * arc;
    if (perimeter <= 0) return '';

    // As many deviations as the line has room for, and the profile is read at
    // the fraction round rather than by index, so the same wobble survives the
    // ring changing size.
    const count = Math.max(LEAST, Math.min(MOST, Math.round(perimeter / SPACING)));
    const pts = new Array(count);
    for (let i = 0; i < count; i++) {
      let s = (i / count) * perimeter;
      let x, y, nx, ny, a;
      if (s < flatX) { x = r + s; y = 0; nx = 0; ny = -1; }
      else if ((s -= flatX) < arc) { a = -Math.PI / 2 + (s / arc) * (Math.PI / 2); x = w - r + Math.cos(a) * r; y = r + Math.sin(a) * r; nx = Math.cos(a); ny = Math.sin(a); }
      else if ((s -= arc) < flatY) { x = w; y = r + s; nx = 1; ny = 0; }
      else if ((s -= flatY) < arc) { a = (s / arc) * (Math.PI / 2); x = w - r + Math.cos(a) * r; y = h - r + Math.sin(a) * r; nx = Math.cos(a); ny = Math.sin(a); }
      else if ((s -= arc) < flatX) { x = w - r - s; y = h; nx = 0; ny = 1; }
      else if ((s -= flatX) < arc) { a = Math.PI / 2 + (s / arc) * (Math.PI / 2); x = r + Math.cos(a) * r; y = h - r + Math.sin(a) * r; nx = Math.cos(a); ny = Math.sin(a); }
      else if ((s -= arc) < flatY) { x = 0; y = h - r - s; nx = -1; ny = 0; }
      else { a = Math.PI + ((s - flatY) / arc) * (Math.PI / 2); x = r + Math.cos(a) * r; y = r + Math.sin(a) * r; nx = Math.cos(a); ny = Math.sin(a); }
      const off = deviations[Math.floor((i / count) * PROFILE) % PROFILE] * wiggle;
      pts[i] = [x + nx * off, y + ny * off];
    }

    // Closed Catmull-Rom through the points, written as cubics: straight lines
    // between deviations would read as a polygon rather than a drawn line.
    let d = 'M' + pts[0][0].toFixed(1) + ' ' + pts[0][1].toFixed(1);
    for (let i = 0; i < count; i++) {
      const p0 = pts[(i - 1 + count) % count];
      const p1 = pts[i];
      const p2 = pts[(i + 1) % count];
      const p3 = pts[(i + 2) % count];
      d += 'C' + (p1[0] + (p2[0] - p0[0]) / 6).toFixed(1) + ' ' + (p1[1] + (p2[1] - p0[1]) / 6).toFixed(1) +
           ' ' + (p2[0] - (p3[0] - p1[0]) / 6).toFixed(1) + ' ' + (p2[1] - (p3[1] - p1[1]) / 6).toFixed(1) +
           ' ' + p2[0].toFixed(1) + ' ' + p2[1].toFixed(1);
    }
    return d + 'Z';
  }

  function applySketch() {
    if (cfg.sketch && !sketchSvg) {
      hands = makeHands();
      sketchSvg = document.createElementNS(SVG_NS, 'svg');
      sketchSvg.setAttribute('preserveAspectRatio', 'none');
      sketchPath = document.createElementNS(SVG_NS, 'path');
      sketchSvg.appendChild(sketchPath);
      ring.appendChild(sketchSvg);
    }
    sW = sH = sR = -1; // whatever was drawn was drawn for other tokens
  }

  // Geometry is declared in smartcursor.css as custom properties; the script
  // reads back the three values it has to animate. Read once at startup and
  // again on refresh(), never per frame — resolving custom properties forces a
  // style recalc, which the animation loop must stay clear of.
  const DEFAULTS = { ringSize: 34, pad: 5, ease: 0.3, caretScale: 1.2, wiggle: 2, boil: 0 };
  const cfg = {};

  // getComputedStyle returns custom properties exactly as authored ("34px",
  // "2rem", "0.3") — it does not resolve their units. Plain numbers are parsed
  // directly; anything else goes through a throwaway probe so the browser does
  // the resolving (em and % therefore resolve against <body>, where it sits).
  function toPixels(value, fallback) {
    const v = value.trim();
    if (!v) return fallback;
    if (/^-?[\d.]+(px)?$/.test(v)) return parseFloat(v);
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none';
    probe.style.width = v;
    if (!probe.style.width) return fallback; // CSSOM rejected it as invalid
    document.body.appendChild(probe);
    const px = parseFloat(getComputedStyle(probe).width);
    probe.remove();
    return Number.isFinite(px) ? px : fallback;
  }

  function toNumber(value, fallback) {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function readTokens() {
    const s = getComputedStyle(root);
    cfg.ringSize = toPixels(s.getPropertyValue('--sc-ring-size'), DEFAULTS.ringSize);
    cfg.pad = toPixels(s.getPropertyValue('--sc-pad'), DEFAULTS.pad);
    cfg.caretScale = toNumber(s.getPropertyValue('--sc-caret-scale'), DEFAULTS.caretScale);
    // 0 would freeze the ring where it stands and >1 overshoots into
    // oscillation; clamp, rather than let a stray value read as a broken cursor.
    const ease = toNumber(s.getPropertyValue('--sc-ease'), DEFAULTS.ease);
    cfg.ease = Math.min(Math.max(ease, 0.01), 1);
    // A drawn ring rather than a bordered box: off unless a page asks for it.
    cfg.sketch = toNumber(s.getPropertyValue('--sc-sketch'), 0) > 0.5;
    cfg.wiggle = toPixels(s.getPropertyValue('--sc-sketch-wiggle'), DEFAULTS.wiggle);
    cfg.boil = toNumber(s.getPropertyValue('--sc-sketch-rate'), DEFAULTS.boil) * 1000;
    applySketch();
  }
  readTokens();

  // The lerp is asymptotic; below this distance it is snapped home so the loop
  // can stop writing styles entirely.
  const SNAP = 0.1;

  let enabled = false;
  let raf = 0;
  let seen = false; // first mousemove reveals the overlays
  let mx = innerWidth / 2, my = innerHeight / 2;
  // Ring geometry, lerped towards its target each frame.
  let rx = mx, ry = my, rw = cfg.ringSize, rh = cfg.ringSize, rr = cfg.ringSize / 2;
  let target = null;
  let hoverEl = null;                    // interactive element the ring morphs onto
  let hoverRadius = cfg.ringSize / 2;    // its corner radius, resolved once per hover change
  let dirty = false;

  // What the ring morphs onto, and what yields to a caret. Editing these two
  // lines is the usual way to fit the cursor to a page — but a page taking this
  // file from a CDN cannot edit anything in it, so both are also settable at
  // runtime through the API at the bottom of this file.
  const DEFAULT_INTERACTIVE =
    'a, button, select, label, summary, [role="button"], .card, .server-card, .tab, .link-btn';
  // Typable surfaces get the caret. Clickable inputs (checkbox/radio/buttons)
  // deliberately stay in ring mode; the SSH terminal counts as text.
  const DEFAULT_TEXTUAL =
    'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]),' +
    'textarea, [contenteditable="true"], .xterm';

  let INTERACTIVE = DEFAULT_INTERACTIVE;
  let TEXTUAL = DEFAULT_TEXTUAL;

  // Throwing here, at the call, beats throwing later from inside a mousemove
  // handler whose stack says nothing about who set it.
  function checked(selector, fallback) {
    if (!selector) return fallback;
    document.querySelector(selector);
    return selector;
  }


  function parseRGB(str) {
    const m = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i.exec(str || '');
    if (!m) return null;
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  }

  function relLuminance(c) {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }

  // Luminance of the first sufficiently opaque background up the tree.
  // Cached per element; the cache is dropped wholesale on theme changes.
  let lumCache = new WeakMap();
  function bgLuminance(el) {
    const walked = [];
    let cur = el;
    let lum = null;
    while (cur && cur !== document.documentElement) {
      if (lumCache.has(cur)) { lum = lumCache.get(cur); break; }
      walked.push(cur);
      const c = parseRGB(getComputedStyle(cur).backgroundColor);
      if (c && c.a > 0.4) { lum = relLuminance(c); break; }
      cur = cur.parentElement;
    }
    if (lum === null) {
      const c = parseRGB(getComputedStyle(document.body).backgroundColor);
      lum = c && c.a > 0 ? relLuminance(c) : 0.5;
    }
    for (const w of walked) lumCache.set(w, lum);
    return lum;
  }

  // Corner radius of the hover target, resolved once per hover change.
  // Percentages (e.g. the round FABs) are converted against the element box.
  function cornerRadius(el, rect) {
    const raw = getComputedStyle(el).borderTopLeftRadius || '0px';
    const v = parseFloat(raw) || 0;
    return raw.trim().endsWith('%') ? (v / 100) * Math.min(rect.width, rect.height) : v;
  }

  // Caret height for the text under the pointer, as a CSS length — or '' to
  // hand the dot back to --sc-dot-size. Measured on the element actually under
  // the pointer rather than the TEXTUAL ancestor closest() matched: inside a
  // rich editor the pointer may be over a heading or a code span with its own
  // size, and that local size is what a native caret would take.
  function caretHeight(el) {
    const fs = parseFloat(getComputedStyle(el).fontSize);
    return Number.isFinite(fs) ? `${fs * cfg.caretScale}px` : '';
  }

  // Runs only when the hovered element changed.
  function applyMode() {
    const el = target;
    const isText = !!(el && el.closest && el.closest(TEXTUAL));
    hoverEl = !isText && el && el.closest ? el.closest(INTERACTIVE) : null;
    if (hoverEl) {
      hoverRadius = cornerRadius(hoverEl, hoverEl.getBoundingClientRect());
    }
    dot.classList.toggle('text', isText);
    ring.classList.toggle('text', isText);
    ring.classList.toggle('morph', !!hoverEl);
    // Idle, the ring is a plain circle: a drawn line says "this is the shape of
    // the thing under me", which is only true once there is something under it.
    const draw = !!(cfg.sketch && hoverEl && !isText);
    if (draw !== sketching) {
      sketching = draw;
      ring.classList.toggle('sketch', draw);
      sW = sH = sR = -1; // the drawing that is there was made for another shape
    }
    // Cheap here — applyMode only runs on a hover change, never per frame — and
    // the dot's height transition animates the caret between text sizes.
    dot.style.height = isText ? caretHeight(el) : '';

    const lum = el ? bgLuminance(el) : 0.5;
    const onLight = lum > 0.5;
    // The ring's own colour and halo are declared in the stylesheet and keyed
    // off this class, so both are configurable and neither is duplicated here.
    ring.classList.toggle('on-light', onLight);
    // Whichever token is named for the surface underneath. The fallbacks apply
    // only when smartcursor.css was not loaded — with it, :root always resolves
    // these — and are per-surface for the same reason the tokens are: a single
    // fallback for both branches is invisible on one of them.
    const styles = getComputedStyle(root);
    const color = (onLight ? styles.getPropertyValue('--brand') : styles.getPropertyValue('--brand-light')).trim()
      || (onLight ? '#1a1a1a' : '#f5f5f5');
    dot.style.backgroundColor = color;
    dot.style.color = color; // glow rides on currentColor
  }

  // Last values actually written to the DOM: once the lerp converges (see
  // SNAP) the loop stops touching styles entirely, so an idle pointer costs
  // zero paint work per frame.
  let wDotX = NaN, wDotY = NaN, wX = NaN, wY = NaN, wW = NaN, wH = NaN, wR = NaN;

  function loop() {
    // Where does the ring want to be this frame?
    let tx, ty, tw, th, tr;
    if (hoverEl && hoverEl.isConnected) {
      // Measured per frame on purpose: the element itself may move (e.g. the
      // card's hover lift), and the ring should ride along.
      const rect = hoverEl.getBoundingClientRect();
      tx = rect.left + rect.width / 2;
      ty = rect.top + rect.height / 2;
      // One pad on each side, and the same pad added to the radius so the
      // inflated corners stay concentric with the element's own.
      tw = rect.width + cfg.pad * 2;
      th = rect.height + cfg.pad * 2;
      tr = hoverRadius + cfg.pad;
    } else {
      if (hoverEl) { hoverEl = null; ring.classList.remove('morph'); } // re-render pulled it out
      tx = mx; ty = my;
      tw = cfg.ringSize; th = cfg.ringSize; tr = cfg.ringSize / 2;
    }
    const k = cfg.ease;
    rx += (tx - rx) * k; if (Math.abs(tx - rx) < SNAP) rx = tx;
    ry += (ty - ry) * k; if (Math.abs(ty - ry) < SNAP) ry = ty;
    rw += (tw - rw) * k; if (Math.abs(tw - rw) < SNAP) rw = tw;
    rh += (th - rh) * k; if (Math.abs(th - rh) < SNAP) rh = th;
    rr += (tr - rr) * k; if (Math.abs(tr - rr) < SNAP) rr = tr;

    if (mx !== wDotX || my !== wDotY) {
      dot.style.transform = `translate3d(${mx}px, ${my}px, 0) translate(-50%, -50%)`;
      wDotX = mx; wDotY = my;
    }
    if (rx !== wX || ry !== wY) {
      ring.style.transform = `translate3d(${rx}px, ${ry}px, 0) translate(-50%, -50%)`;
      wX = rx; wY = ry;
    }
    if (rw !== wW) { ring.style.width = `${rw}px`; wW = rw; }
    if (rh !== wH) { ring.style.height = `${rh}px`; wH = rh; }
    if (rr !== wR) { ring.style.borderRadius = `${rr}px`; wR = rr; }

    if (sketching && sketchPath) {
      // Moving costs nothing here: position is the transform written above, and
      // the drawing only has to be rebuilt when the ring changes shape. Redoing
      // it every frame means handing the browser a fresh path string to parse
      // sixty times a second, which is what made the ring trail the pointer.
      // Half a pixel is the threshold, since the lerp arrives asymptotically
      // and would otherwise never stop nudging the last hundredth.
      let redraw = Math.abs(rw - sW) > 0.5 || Math.abs(rh - sH) > 0.5 || Math.abs(rr - sR) > 0.5;
      if (redraw) { sW = rw; sH = rh; sR = rr; }
      // A rate of zero holds one drawing: the swap is what makes hand-drawn
      // linework live at the size of a card, and what makes it flicker at the
      // size of a cursor, so it is not something to have on by default.
      if (cfg.boil > 0 && performance.now() - lastBoil >= cfg.boil) {
        lastBoil = performance.now();
        hand ^= 1;
        redraw = true;
      }
      if (redraw) {
        sketchSvg.setAttribute('viewBox', `0 0 ${rw.toFixed(1)} ${rh.toFixed(1)}`);
        sketchPath.setAttribute('d', ringPath(rw, rh, rr, hands[hand], cfg.wiggle));
      }
    }

    if (dirty) { dirty = false; applyMode(); }
    raf = requestAnimationFrame(loop);
  }

  function show() {
    dot.classList.remove('off');
    ring.classList.remove('off');
  }
  function hide() {
    dot.classList.add('off');
    ring.classList.add('off');
  }

  // An embedded document is not ours to draw on: cursor:none does not reach
  // into it, and the pointer's movements inside it are never reported here.
  // Left alone the overlays would hang at its edge for as long as the pointer
  // was inside. They yield to the native cursor instead, which is the same
  // thing they already do when the pointer leaves the window.
  function overFrame(el) {
    return !!(el && el.closest && el.closest('iframe, embed, object'));
  }

  function onMove(e) {
    mx = e.clientX;
    my = e.clientY;
    if (!seen) {
      seen = true;
      rx = mx; ry = my; // ring starts on the pointer, not lerping across the page
    }
    if (overFrame(e.target)) hide(); else show();
    if (e.target !== target) { target = e.target; dirty = true; }
  }
  // mouseleave on document misses fast exits in some engines; mouseout with an
  // empty relatedTarget reliably marks "left the window", blur covers Alt+Tab.
  // A related target that is a frame means the pointer crossed into it, which
  // can happen faster than a move event lands on the frame itself.
  function onOut(e) { if (!e.relatedTarget || overFrame(e.relatedTarget)) hide(); }

  // Fullscreen renders its element in the browser's top layer, above every
  // body-level overlay — the cursor would vanish while cursor:none still
  // applies. Ride along: reparent the overlays into the fullscreen element,
  // and back to body when it exits. position:fixed keeps working (viewport
  // and the fullscreen element coincide).
  document.addEventListener('fullscreenchange', () => {
    const host = document.fullscreenElement || document.body;
    host.appendChild(dot);
    host.appendChild(ring);
  });

  // The page can change under a resting pointer with no mousemove to say so: a
  // click opens a modal over the card it was on, or a scroll carries the whole
  // page past a pointer that never moved. Left alone the ring keeps hugging
  // whatever it last saw — riding away with an element that has scrolled out
  // from under the pointer. Ask what is there now instead.
  //
  // elementFromPoint costs a layout read, which is why the pointer's own path
  // never uses it; here it runs once per event at most, and once per frame.
  let resolving = false;
  function resolveUnderPointer() {
    if (resolving) return;
    resolving = true;
    requestAnimationFrame(() => {
      resolving = false;
      // The overlays are pointer-events:none, so this sees the real element.
      const el = document.elementFromPoint(mx, my);
      if (el !== target) { target = el; dirty = true; }
    });
  }

  function setEnabled(on, persist) {
    on = !!on && !noHover;
    if (persist) localStorage.setItem(PREF, on ? 'on' : 'off');
    if (on === enabled) return;
    enabled = on;
    root.classList.toggle('sc-on', on);
    dot.style.display = on ? '' : 'none';
    ring.style.display = on ? '' : 'none';
    if (on) {
      document.addEventListener('mousemove', onMove, { passive: true });
      document.addEventListener('click', resolveUnderPointer, true);
      // Capture, so a scrolling container counts and not only the window.
      document.addEventListener('scroll', resolveUnderPointer, { passive: true, capture: true });
      window.addEventListener('mouseout', onOut);
      window.addEventListener('blur', hide);
      raf = requestAnimationFrame(loop);
    } else {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('click', resolveUnderPointer, true);
      document.removeEventListener('scroll', resolveUnderPointer, { capture: true });
      window.removeEventListener('mouseout', onOut);
      window.removeEventListener('blur', hide);
      cancelAnimationFrame(raf);
    }
  }

  window.smartCursor = {
    setEnabled: (on) => setEnabled(on, true),
    isEnabled: () => enabled,
    // What the ring morphs onto, and what hands it a caret. Pass nothing to go
    // back to the built-in list. Both throw on an unusable selector, here,
    // rather than from a mousemove handler later.
    setInteractive(selector) { INTERACTIVE = checked(selector, DEFAULT_INTERACTIVE); dirty = true; },
    setTextual(selector) { TEXTUAL = checked(selector, DEFAULT_TEXTUAL); dirty = true; },
    // Theme switches change the backgrounds — cached luminances are stale —
    // and may retune the geometry tokens along with the palette. The running
    // lerp picks up the new sizes on the next frame, so the ring animates to
    // them rather than jumping.
    refresh() { readTokens(); lumCache = new WeakMap(); dirty = true; },
  };

  // Opt-in: off unless explicitly enabled via the drawer toggle.
  setEnabled(localStorage.getItem(PREF) === 'on', false);
})();
