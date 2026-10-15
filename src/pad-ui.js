/* Scratchpad — the pad itself, rendered into a shadow root inside the host page.
 *
 * It used to live in a chrome-extension:// iframe. That does not work: ChatGPT and
 * Claude both ship a strict `frame-src` allowlist with no chrome-extension: entry,
 * so the frame was silently stripped and the pad never rendered. Content-script
 * DOM and styles are not subject to the page's CSP, so a shadow root works
 * everywhere and removes the postMessage bridge as a bonus.
 *
 * Original notes follow.
 *
 * Two rules keep this cheap no matter how far the world extends:
 *
 *   1. The canvas is VIEWPORT-sized, never artboard-sized. A 2560x1600 page at
 *      DPR 2 would be a 65MB backing store per layer; this stays near 1MB. The
 *      camera decides what is drawn, so the world can be any size for free.
 *   2. Nothing in the pointer path touches the DOM or re-renders the chrome.
 *      Pointer events mutate plain objects and ask for a frame.
 *
 * #static holds committed shapes, #overlay holds only the shape under the cursor
 * plus selection chrome, and both are culled against the viewport.
 */
self.__scratchpadCreatePad = function createPad(opts) {
  'use strict';

  const MARKUP = `
    <header class="toolbar" role="toolbar" aria-label="Drawing tools">
      <div class="group" id="tools"></div>

      <div class="group">
        <button class="tool" id="iconBtn" aria-haspopup="true" aria-expanded="false" data-tip="Icons &nbsp;I">
          <svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/></svg>
        </button>
      </div>

      <div class="sep" aria-hidden="true"></div>

      <div class="group">
        <button class="tool" id="strokeBtn" aria-haspopup="true" aria-expanded="false" data-tip="Stroke width">
          <span class="stroke-dot" id="strokeDot"></span>
        </button>
        <div class="popover" id="strokePop" role="menu" hidden></div>

        <button class="tool" id="colorBtn" aria-haspopup="true" aria-expanded="false" data-tip="Colour">
          <span class="color-dot" id="colorDot"></span>
        </button>
        <div class="popover" id="colorPop" role="menu" hidden></div>
      </div>

      <div class="sep" aria-hidden="true"></div>

      <div class="group">
        <button class="tool" id="undoBtn" data-tip="Undo" aria-label="Undo">
          <svg viewBox="0 0 24 24"><path d="M3 7v6h6"/><path d="M3 13a9 9 0 1 0 3-7.7L3 8"/></svg>
        </button>
        <button class="tool" id="redoBtn" data-tip="Redo" aria-label="Redo">
          <svg viewBox="0 0 24 24"><path d="M21 7v6h-6"/><path d="M21 13a9 9 0 1 1-3-7.7L21 8"/></svg>
        </button>
        <button class="tool" id="clearBtn" data-tip="Clear page" aria-label="Clear page">
          <svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>
        </button>
      </div>

      <div class="sep" aria-hidden="true"></div>

      <div class="group">
        <button class="tool wide" id="sizeBtn" aria-haspopup="true" aria-expanded="false" data-tip="Page size">
          <svg viewBox="0 0 24 24"><rect x="3.5" y="6.5" width="17" height="11" rx="1.5"/></svg>
          <span id="sizeLabel">Standard</span>
        </button>
        <div class="popover wide" id="sizePop" role="menu" hidden></div>
      </div>

      <div class="spacer"></div>

      <div class="group">
        <button class="btn ghost" id="cancelBtn">Cancel</button>
        <button class="btn primary" id="sendBtn">
          <span id="sendLabel">Attach</span>
          <kbd>&#8629;</kbd>
        </button>
      </div>
    </header>

    <div class="icon-panel" id="iconPanel" hidden>
      <div class="icon-search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z"/><path d="M16 16l5 5"/></svg>
        <input id="iconSearch" type="text" placeholder="Search icons" autocomplete="off" spellcheck="false">
      </div>
      <div class="icon-grid" id="iconGrid"></div>
    </div>

    <div class="stage" id="stage">
      <div class="surface" id="surface">
        <canvas id="static"></canvas>
        <canvas id="overlay"></canvas>
        <input id="textInput" class="text-input" hidden autocomplete="off" spellcheck="false">
      </div>
      <div class="scroll-hint" id="scrollHint" hidden></div>
    </div>

    <footer class="statusbar">
      <div class="pages" id="pages" role="tablist" aria-label="Pages"></div>
      <button class="tool" id="addPageBtn" data-tip="Add page" aria-label="Add page">
        <svg viewBox="0 0 24 24"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
      </button>

      <div class="spacer"></div>

      <div class="zoom group">
        <button class="tool sm" id="zoomOutBtn" aria-label="Zoom out">
          <svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg>
        </button>
        <button class="zoom-level" id="zoomLabel" title="Reset to 100%">100%</button>
        <button class="tool sm" id="zoomInBtn" aria-label="Zoom in">
          <svg viewBox="0 0 24 24"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
        </button>
        <button class="tool sm" id="fitBtn" data-tip="Fit page" aria-label="Fit page">
          <svg viewBox="0 0 24 24"><path d="M4 9V4h5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/></svg>
        </button>
      </div>
    </footer>`;

  // Standard is exactly 1.02 MP. Claude downsamples past roughly 1.15 MP, so a
  // standard page reaches the model with nothing resampled away. Wide and Tall
  // trade some of that for room; beyond 2x, add a page instead of growing one.
  const SIZES = [
    { id: 'standard', label: 'Standard', w: 1280, h: 800,  note: '1280 x 800' },
    { id: 'wide',     label: 'Wide',     w: 2560, h: 800,  note: '2560 x 800' },
    { id: 'tall',     label: 'Tall',     w: 1280, h: 1600, note: '1280 x 1600' },
  ];
  const MAX_PAGES = 8;
  const ZOOM_MIN = 0.12, ZOOM_MAX = 6;
  const DPR = Math.min(window.devicePixelRatio || 1, 2);

  const theme = opts.theme === 'dark' ? 'dark' : 'light';
  const isDark = theme === 'dark';

  // Ink is tied to the paper, not to the UI theme: the page is white either way,
  // so the palette is always dark-on-white and the export is identical in both.
  const PALETTE = ['#18181b', '#dc2626', '#d97706', '#16a34a', '#2563eb'];
  const PAGE_BG = '#ffffff';
  const PAGE_EDGE = isDark ? '#2f2f36' : '#e4e4e7';
  const SELECT = '#2563eb';
  const WIDTHS = [2.5, 4.5, 8];

  const TOOLS = [
    { id: 'select', key: 'v', tip: 'Select',  path: '<path d="M4 3l7.5 17 2.2-6.8L20.5 11z"/>' },
    { id: 'pen',    key: 'p', tip: 'Pen',     path: '<path d="M3 17c3-6 5 2 8-3s4 1 7-4"/><path d="M3 21h18"/>' },
    { id: 'rect',   key: 'r', tip: 'Box',     path: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/>' },
    { id: 'ellipse',key: 'o', tip: 'Ellipse', path: '<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>' },
    { id: 'line',   key: 'l', tip: 'Line',    path: '<path d="M4 19L20 5"/>' },
    { id: 'arrow',  key: 'a', tip: 'Arrow',   path: '<path d="M4 19L20 5"/><path d="M13 5h7v7"/>' },
    { id: 'text',   key: 't', tip: 'Text',    path: '<path d="M5 6V4.5h14V6"/><path d="M12 4.5V19"/><path d="M9 19h6"/>' },
    { id: 'eraser', key: 'e', tip: 'Erase',   path: '<path d="M8 20H20"/><path d="M15.5 4.5l4 4L10 18H6.5l-2-2z"/>' },
  ];

  const hostEl = document.createElement('div');
  hostEl.dataset.theme = theme;
  const root = hostEl.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${self.__SCRATCHPAD_CSS}</style>
    <div class="backdrop"><div class="pad-shell"><div class="pad">${MARKUP}</div></div></div>
    <div class="toast" id="toast" hidden></div>`;
  document.documentElement.appendChild(hostEl);

  const backdrop = root.querySelector('.backdrop');
  const shell = root.querySelector('.pad-shell');
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });

  let isOpen = false;

  const $ = (id) => root.getElementById(id);
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));

  // ------------------------------------------------------------------ state

  const newPage = (size = SIZES[0]) => ({
    id: uid(), sizeId: size.id, w: size.w, h: size.h,
    shapes: [], undo: [], redo: [],      // history is per page, so undo never
  });                                     // reaches across a page switch

  let pages = [newPage()];
  let pageIndex = 0;

  // Camera: screen = (world - cam) * z
  const cam = { x: 0, y: 0, z: 1 };

  let tool = 'pen';
  let color = PALETTE[0];
  let width = WIDTHS[1];

  const ICONS = self.__SCRATCHPAD_ICONS || [];
  const ICON_BY_ID = Object.fromEntries(ICONS.map((i) => [i.id, i]));
  const ICON_PATHS = {};                 // Path2D is costly to build; make each once
  const iconPath = (id) => (ICON_PATHS[id] ||= new Path2D(ICON_BY_ID[id].d));
  const ICON_DEFAULT = 110;              // box size when an icon is clicked, not dragged
  let pendingIcon = null;

  let draft = null, selectedId = null, drag = null;
  let shiftHeld = false, spaceHeld = false;
  let framePending = false, staticDirty = true;
  let camTouched = false;   // has the user zoomed/panned since the last fit?

  const page = () => pages[pageIndex];
  const shapes = () => page().shapes;

  // ------------------------------------------------------------------ canvas

  const surface = $('surface');
  const staticCv = $('static'), overlayCv = $('overlay');
  const sctx = staticCv.getContext('2d');
  const octx = overlayCv.getContext('2d');
  const textInput = $('textInput');

  let VW = 0, VH = 0;

  function resizeCanvases() {
    const r = surface.getBoundingClientRect();
    VW = Math.max(1, Math.round(r.width));
    VH = Math.max(1, Math.round(r.height));
    for (const cv of [staticCv, overlayCv]) {
      cv.width = VW * DPR; cv.height = VH * DPR;
      cv.style.width = VW + 'px'; cv.style.height = VH + 'px';
    }
    staticDirty = true;
    // The first ResizeObserver callback can land after boot's fitPage(), which
    // would otherwise leave the pad stuck at whatever zoom the pre-layout size
    // produced. Re-fit until the user takes the camera over.
    if (!camTouched && VW > 50 && VH > 50) fitPage();
    invalidate();
  }
  new ResizeObserver(resizeCanvases).observe(surface);

  // ------------------------------------------------------------------ camera

  function applyCamera(ctx) {
    ctx.setTransform(DPR * cam.z, 0, 0, DPR * cam.z, -cam.x * cam.z * DPR, -cam.y * cam.z * DPR);
  }
  const toWorld = (e) => {
    const r = overlayCv.getBoundingClientRect();
    return { x: (e.clientX - r.left) / cam.z + cam.x, y: (e.clientY - r.top) / cam.z + cam.y };
  };
  const toScreen = (wx, wy) => ({ x: (wx - cam.x) * cam.z, y: (wy - cam.y) * cam.z });
  const viewBounds = () => ({ x: cam.x, y: cam.y, w: VW / cam.z, h: VH / cam.z });

  function zoomAt(sx, sy, factor) {
    const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, cam.z * factor));
    if (z === cam.z) return;
    // Keep the world point under the cursor pinned where it is.
    cam.x += sx / cam.z - sx / z;
    cam.y += sy / cam.z - sy / z;
    cam.z = z;
    camTouched = true;
    staticDirty = true;
    invalidate();
    showZoom();
  }

  function fitPage() {
    camTouched = false;   // a fit hands the camera back to the layout
    const p = page(), m = 44;
    cam.z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.min((VW - m) / p.w, (VH - m) / p.h)));
    cam.x = p.w / 2 - VW / (2 * cam.z);
    cam.y = p.h / 2 - VH / (2 * cam.z);
    staticDirty = true;
    invalidate();
    paintZoomLabel();
  }

  function pan(dxScreen, dyScreen) {
    cam.x += dxScreen / cam.z;
    cam.y += dyScreen / cam.z;
    camTouched = true;
    staticDirty = true;
    invalidate();
  }

  // ------------------------------------------------------------------ drawing

  function drawShape(ctx, s) {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = s.color; ctx.fillStyle = s.color; ctx.lineWidth = s.width;
    switch (s.type) {
      case 'pen': {
        const p = s.points;
        if (p.length < 2) {
          ctx.beginPath(); ctx.arc(p[0].x, p[0].y, s.width / 2, 0, Math.PI * 2); ctx.fill(); return;
        }
        ctx.beginPath(); ctx.moveTo(p[0].x, p[0].y);
        for (let i = 1; i < p.length - 1; i++) {
          ctx.quadraticCurveTo(p[i].x, p[i].y, (p[i].x + p[i + 1].x) / 2, (p[i].y + p[i + 1].y) / 2);
        }
        ctx.lineTo(p[p.length - 1].x, p[p.length - 1].y);
        ctx.stroke(); return;
      }
      case 'rect': {
        const x = Math.min(s.x1, s.x2), y = Math.min(s.y1, s.y2);
        const w = Math.abs(s.x2 - s.x1), h = Math.abs(s.y2 - s.y1);
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(x, y, w, h, Math.min(8, w / 2, h / 2)) : ctx.rect(x, y, w, h);
        ctx.stroke(); return;
      }
      case 'ellipse': {
        ctx.beginPath();
        ctx.ellipse((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2,
          Math.abs(s.x2 - s.x1) / 2, Math.abs(s.y2 - s.y1) / 2, 0, 0, Math.PI * 2);
        ctx.stroke(); return;
      }
      case 'line':
      case 'arrow': {
        ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); ctx.stroke();
        if (s.type === 'arrow') {
          const a = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
          const len = 9 + s.width * 2.2, spread = 0.46;
          ctx.beginPath();
          ctx.moveTo(s.x2, s.y2);
          ctx.lineTo(s.x2 - len * Math.cos(a - spread), s.y2 - len * Math.sin(a - spread));
          ctx.moveTo(s.x2, s.y2);
          ctx.lineTo(s.x2 - len * Math.cos(a + spread), s.y2 - len * Math.sin(a + spread));
          ctx.stroke();
        }
        return;
      }
      case 'icon': {
        const ic = ICON_BY_ID[s.iconId];
        if (!ic) return;
        const x = Math.min(s.x1, s.x2), y = Math.min(s.y1, s.y2);
        const w = Math.abs(s.x2 - s.x1), h = Math.abs(s.y2 - s.y1);
        const k = Math.max(0.01, Math.min(w, h) / 24);
        ctx.save();
        ctx.translate(x + (w - 24 * k) / 2, y + (h - 24 * k) / 2);
        ctx.scale(k, k);
        ctx.lineWidth = s.width / k;     // keep the stroke visually constant
        ctx.stroke(iconPath(s.iconId));
        ctx.restore();
        return;
      }
      case 'text': {
        ctx.font = `500 ${s.size}px ui-sans-serif, -apple-system, system-ui, sans-serif`;
        ctx.textBaseline = 'middle';
        ctx.fillText(s.text, s.x1, s.y1); return;
      }
    }
  }

  /** One AABB test per shape. At a few hundred shapes this is far cheaper than
   *  the draw calls it skips, and it is what makes panning a big page free. */
  function visible(s, view) {
    const b = bbox(s), m = s.width + 4;
    return !(b.x + b.w + m < view.x || b.x - m > view.x + view.w ||
             b.y + b.h + m < view.y || b.y - m > view.y + view.h);
  }

  function drawPageFrame(ctx, p) {
    ctx.save();
    ctx.shadowColor = isDark ? 'rgba(0,0,0,.6)' : 'rgba(0,0,0,.24)';
    ctx.shadowBlur = (isDark ? 26 : 18) / cam.z;
    ctx.shadowOffsetY = (isDark ? 8 : 5) / cam.z;
    ctx.fillStyle = PAGE_BG;
    ctx.fillRect(0, 0, p.w, p.h);
    ctx.restore();
    ctx.strokeStyle = PAGE_EDGE;
    ctx.lineWidth = 1 / cam.z;
    ctx.strokeRect(0, 0, p.w, p.h);
  }

  function renderStatic() {
    staticDirty = false;
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.clearRect(0, 0, staticCv.width, staticCv.height);
    applyCamera(sctx);
    const p = page(), view = viewBounds();
    drawPageFrame(sctx, p);
    for (const s of p.shapes) if (visible(s, view)) drawShape(sctx, s);
  }

  function renderOverlay() {
    framePending = false;
    if (staticDirty) renderStatic();
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, overlayCv.width, overlayCv.height);
    applyCamera(octx);
    if (draft) drawShape(octx, draft);
    if (selectedId) {
      const s = shapes().find((x) => x.id === selectedId);
      if (s) {
        const b = bbox(s), pad = 6 / cam.z;
        octx.save();
        octx.strokeStyle = SELECT;
        octx.lineWidth = 1.5 / cam.z;
        octx.setLineDash([5 / cam.z, 4 / cam.z]);
        octx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
        octx.restore();
      }
    }
  }

  function invalidate() {
    if (framePending) return;
    framePending = true;
    requestAnimationFrame(renderOverlay);
  }

  // ------------------------------------------------------------------ geometry

  function bbox(s) {
    if (s.type === 'pen') {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of s.points) {
        if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
        if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
      }
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    if (s.type === 'text') {
      sctx.save();
      sctx.setTransform(1, 0, 0, 1, 0, 0);
      sctx.font = `500 ${s.size}px ui-sans-serif, -apple-system, system-ui, sans-serif`;
      const w = sctx.measureText(s.text).width;
      sctx.restore();
      return { x: s.x1, y: s.y1 - s.size / 2, w, h: s.size };
    }
    const x = Math.min(s.x1, s.x2), y = Math.min(s.y1, s.y2);
    return { x, y, w: Math.abs(s.x2 - s.x1), h: Math.abs(s.y2 - s.y1) };
  }

  function hit(x, y) {
    const list = shapes();
    for (let i = list.length - 1; i >= 0; i--) {
      const b = bbox(list[i]);
      const t = Math.max(10 / cam.z, list[i].width * 2);
      if (x >= b.x - t && x <= b.x + b.w + t && y >= b.y - t && y <= b.y + b.h + t) return list[i];
    }
    return null;
  }

  function translate(s, dx, dy) {
    if (s.type === 'pen') { for (const p of s.points) { p.x += dx; p.y += dy; } return; }
    s.x1 += dx; s.y1 += dy;
    if (s.x2 != null) { s.x2 += dx; s.y2 += dy; }
  }

  function constrain(s) {
    if (s.type === 'icon') {             // always square, shift or not
      const d = Math.max(Math.abs(s.x2 - s.x1), Math.abs(s.y2 - s.y1));
      s.x2 = s.x1 + Math.sign(s.x2 - s.x1 || 1) * d;
      s.y2 = s.y1 + Math.sign(s.y2 - s.y1 || 1) * d;
      return;
    }
    if (!shiftHeld) return;
    if (s.type === 'rect' || s.type === 'ellipse') {
      const d = Math.max(Math.abs(s.x2 - s.x1), Math.abs(s.y2 - s.y1));
      s.x2 = s.x1 + Math.sign(s.x2 - s.x1 || 1) * d;
      s.y2 = s.y1 + Math.sign(s.y2 - s.y1 || 1) * d;
    } else if (s.type === 'line' || s.type === 'arrow') {
      const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
      const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
      const len = Math.hypot(dx, dy);
      s.x2 = s.x1 + Math.cos(a) * len;
      s.y2 = s.y1 + Math.sin(a) * len;
    }
  }

  // ------------------------------------------------------------------ history

  function pushUndo() {
    const p = page();
    p.undo.push(JSON.stringify(p.shapes));
    if (p.undo.length > 60) p.undo.shift();
    p.redo.length = 0;
    syncChrome();
  }
  function undo() {
    const p = page();
    if (!p.undo.length) return;
    p.redo.push(JSON.stringify(p.shapes));
    p.shapes = JSON.parse(p.undo.pop());
    afterMutation();
  }
  function redo() {
    const p = page();
    if (!p.redo.length) return;
    p.undo.push(JSON.stringify(p.shapes));
    p.shapes = JSON.parse(p.redo.pop());
    afterMutation();
  }
  function afterMutation() {
    selectedId = null;
    staticDirty = true;
    invalidate();
    syncChrome();
    queueThumb();
  }

  function syncChrome() {
    const p = page();
    const any = pages.some((pg) => pg.shapes.length);
    $('undoBtn').disabled = !p.undo.length;
    $('redoBtn').disabled = !p.redo.length;
    $('clearBtn').disabled = !p.shapes.length;
    $('sendBtn').disabled = !any;
    const filled = pages.filter((pg) => pg.shapes.length).length;
    $('sendLabel').textContent = filled > 1 ? `Attach ${filled} pages` : 'Attach';
    $('addPageBtn').disabled = pages.length >= MAX_PAGES;
  }

  // ------------------------------------------------------------------ pointer

  const pointers = new Map();
  let pinch = null;   // {dist, cx, cy}
  let panning = null; // {x, y}

  function cancelDraft() {
    if (!draft) return;
    draft = null;
    invalidate();
  }

  overlayCv.addEventListener('mousedown', (e) => {
    if (tool === 'text' || textAt) e.preventDefault();
  });

  overlayCv.addEventListener('pointerdown', (e) => {
    overlayCv.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Second finger down turns the gesture into a pinch, whatever it was.
    if (pointers.size === 2) {
      cancelDraft(); drag = null;
      pinch = pinchState();
      surface.dataset.panning = '1';
      return;
    }
    if (pointers.size > 2) return;

    // Middle-drag or space-drag pans, like every canvas app.
    if (e.button === 1 || spaceHeld) {
      panning = { x: e.clientX, y: e.clientY };
      surface.dataset.panning = '1';
      return;
    }
    if (e.button !== 0 && e.pointerType === 'mouse') return;

    const { x, y } = toWorld(e);
    commitText();

    if (tool === 'select') {
      const s = hit(x, y);
      selectedId = s ? s.id : null;
      if (s) { pushUndo(); drag = { mode: 'move', lastX: x, lastY: y, shape: s }; }
      invalidate();
      return;
    }
    if (tool === 'eraser') { pushUndo(); drag = { mode: 'erase' }; eraseAt(x, y); return; }
    if (tool === 'text') {
      // Without this the compatibility mousedown fires next and moves focus to
      // <body>, blurring the input we are about to open.
      e.preventDefault();
      openTextInput(x, y);
      return;
    }

    selectedId = null;
    draft = {
      id: uid(), type: tool, color, width,
      x1: x, y1: y, x2: x, y2: y,
      points: tool === 'pen' ? [{ x, y }] : undefined,
      iconId: tool === 'icon' ? pendingIcon : undefined,
    };
    invalidate();
  });

  function pinchState() {
    const [a, b] = [...pointers.values()];
    return {
      dist: Math.hypot(a.x - b.x, a.y - b.y),
      cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2,
    };
  }

  overlayCv.addEventListener('pointermove', (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pinch && pointers.size >= 2) {
      const now = pinchState();
      const r = overlayCv.getBoundingClientRect();
      if (pinch.dist > 0) {
        // Zoom about the midpoint, and pan by however far the midpoint moved, so
        // two fingers can scroll and scale in one continuous motion.
        pan(pinch.cx - now.cx, pinch.cy - now.cy);
        zoomAt(now.cx - r.left, now.cy - r.top, now.dist / pinch.dist);
      }
      pinch = now;
      return;
    }
    if (panning) {
      pan(panning.x - e.clientX, panning.y - e.clientY);
      panning = { x: e.clientX, y: e.clientY };
      return;
    }
    if (!drag && !draft) return;

    const { x, y } = toWorld(e);
    if (drag?.mode === 'move') {
      translate(drag.shape, x - drag.lastX, y - drag.lastY);
      drag.lastX = x; drag.lastY = y;
      staticDirty = true; invalidate();
      return;
    }
    if (drag?.mode === 'erase') { eraseAt(x, y); return; }
    if (!draft) return;

    if (draft.type === 'pen') {
      // Trackpads and styluses report well above 60Hz; take every coalesced
      // sample so the curve is accurate, but only paint once per frame.
      const evts = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of evts) draft.points.push(toWorld(ev));
    } else {
      draft.x2 = x; draft.y2 = y;
      constrain(draft);
    }
    invalidate();
  });

  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!pointers.size) { panning = null; delete surface.dataset.panning; }

    if (draft) {
      const dragged = Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1) > 3 / cam.z;
      if (draft.type === 'icon' && !dragged) {
        const half = ICON_DEFAULT / 2;
        draft.x1 -= half; draft.y1 -= half;
        draft.x2 = draft.x1 + ICON_DEFAULT; draft.y2 = draft.y1 + ICON_DEFAULT;
      }
      const moved = draft.type === 'pen' ? draft.points.length > 1 : dragged || draft.type === 'icon';
      if (moved || draft.type === 'pen') {
        pushUndo();
        shapes().push(draft);
        staticDirty = true;
      }
      draft = null;
      queueThumb();
    }
    if (drag) { drag = null; queueThumb(); }
    syncChrome();
    invalidate();
  }
  overlayCv.addEventListener('pointerup', endPointer);
  overlayCv.addEventListener('pointercancel', endPointer);

  function eraseAt(x, y) {
    const s = hit(x, y);
    if (!s) return;
    page().shapes = shapes().filter((o) => o !== s);
    staticDirty = true; invalidate(); syncChrome();
  }

  // ------------------------------------------------------------------ wheel

  // Chrome reports trackpad pinch as ctrl+wheel; plain wheel is a two-finger
  // scroll. Both funnel into the same camera.
  overlayCv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = overlayCv.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) {
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.01));
    } else {
      pan(e.deltaX, e.deltaY);
    }
  }, { passive: false });

  // ------------------------------------------------------------------ text tool

  let textAt = null, textArmed = false;
  function openTextInput(x, y) {
    textAt = { x, y };
    const size = width * 5;
    const p = toScreen(x, y);
    textInput.hidden = false;
    textInput.value = '';
    textInput.style.left = p.x + 'px';
    textInput.style.top = (p.y - (size * cam.z) / 2 - 4) + 'px';
    textInput.style.fontSize = (size * cam.z) + 'px';
    textInput.style.color = color;
    textArmed = false;
    textInput.focus();
    requestAnimationFrame(() => {
      if (root.activeElement !== textInput) textInput.focus();
      textArmed = true;
    });
  }
  function commitText() {
    if (!textAt) return;
    const value = textInput.value.trim();
    const at = textAt;
    textAt = null; textArmed = false;
    textInput.hidden = true;
    if (!value) return;
    pushUndo();
    shapes().push({ id: uid(), type: 'text', color, width, size: width * 5, text: value, x1: at.x, y1: at.y });
    staticDirty = true; invalidate(); syncChrome(); queueThumb();
  }
  textInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); commitText(); }
    if (e.key === 'Escape') { textAt = null; textArmed = false; textInput.hidden = true; }
  });
  textInput.addEventListener('blur', () => { if (textArmed) commitText(); });

  // ------------------------------------------------------------------ toolbar

  const toolsEl = $('tools');
  toolsEl.innerHTML = TOOLS.map((t) => `
    <button class="tool" data-tool="${t.id}" role="radio" aria-pressed="${t.id === tool}"
            tabindex="${t.id === tool ? 0 : -1}" aria-label="${t.tip}"
            data-tip="${t.tip} &nbsp;${t.key.toUpperCase()}">
      <svg viewBox="0 0 24 24">${t.path}</svg>
    </button>`).join('');

  function setTool(id) {
    tool = id;
    if (id !== 'select') selectedId = null;
    surface.dataset.tool = id;
    $('iconBtn').setAttribute('aria-pressed', id === 'icon');
    for (const b of toolsEl.children) {
      const on = b.dataset.tool === id;
      b.setAttribute('aria-pressed', on);
      b.tabIndex = on ? 0 : -1;
    }
    invalidate();
  }
  toolsEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tool]');
    if (b) setTool(b.dataset.tool);
  });
  // Roving focus — the behaviour Radix's ToggleGroup would have given us.
  toolsEl.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const items = [...toolsEl.children];
    const next = items[(items.indexOf(document.activeElement) + (e.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length];
    next.focus();
    setTool(next.dataset.tool);
  });
  setTool(tool);

  // ------------------------------------------------------------------ popovers

  function buildPopover(btnId, popId, items, render, onPick, isActive) {
    const btn = $(btnId), pop = $(popId);
    pop.innerHTML = items.map((it, i) =>
      `<button role="menuitemradio" aria-checked="${isActive(it)}" data-i="${i}">${render(it)}</button>`).join('');

    const close = () => { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
    const open = () => {
      const r = btn.getBoundingClientRect();
      const s0 = shell.getBoundingClientRect();
      pop.hidden = false;
      pop.style.left = Math.max(6, r.left - s0.left) + 'px';
      pop.style.top = (r.bottom - s0.top) + 'px';
      btn.setAttribute('aria-expanded', 'true');
    };
    btn.addEventListener('click', (e) => { e.stopPropagation(); pop.hidden ? open() : close(); });
    pop.addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]');
      if (!b) return;
      onPick(items[+b.dataset.i]);
      for (const c of pop.children) c.setAttribute('aria-checked', isActive(items[+c.dataset.i]));
      close();
    });
    root.addEventListener('click', close);
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    return { refresh: () => { for (const c of pop.children) c.setAttribute('aria-checked', isActive(items[+c.dataset.i])); } };
  }

  const paintStrokeDot = () => { $('strokeDot').style.height = Math.max(2, width * 0.9) + 'px'; };
  const paintColorDot = () => { $('colorDot').style.background = color; };

  const strokePop = buildPopover('strokeBtn', 'strokePop', WIDTHS,
    (w) => `<span class="stroke-dot" style="height:${Math.max(2, w * 0.9)}px;width:16px"></span>`,
    (w) => { width = w; paintStrokeDot(); savePrefs(); },
    (w) => w === width);
  const colorPop = buildPopover('colorBtn', 'colorPop', PALETTE,
    (c) => `<span class="swatch" style="background:${c}"></span>`,
    (c) => { color = c; paintColorDot(); savePrefs(); },
    (c) => c === color);
  buildPopover('sizeBtn', 'sizePop', SIZES,
    (s) => `<span>${s.label}</span><span class="dim">${s.note}</span>`,
    (s) => setPageSize(s),
    (s) => s.id === page().sizeId);
  paintStrokeDot(); paintColorDot();

  function setPageSize(s) {
    const p = page();
    p.sizeId = s.id; p.w = s.w; p.h = s.h;
    $('sizeLabel').textContent = s.label;
    fitPage(); queueThumb();
  }

  // ------------------------------------------------------------------ icon picker

  const iconBtn = $('iconBtn'), iconPanel = $('iconPanel'), iconGrid = $('iconGrid'), iconSearch = $('iconSearch');

  const glyph = (ic) =>
    `<svg viewBox="0 0 24 24" aria-hidden="true">${ic.d.split(' M').map((seg, i) =>
      `<path d="${i ? 'M' + seg : seg}"/>`).join('')}</svg>`;

  function renderIcons(query = '') {
    const q = query.trim().toLowerCase();
    const hit = (ic) => !q || ic.id.includes(q) || ic.kw.includes(q) || ic.cat.toLowerCase().includes(q);
    const matches = ICONS.filter(hit);

    // Popular floats to the top when the user has not typed anything; once they
    // search, one flat relevance list is less confusing than grouped results.
    const groups = q
      ? [['Results', matches]]
      : [['Popular', matches.filter((i) => i.pop)],
         ...[...new Set(matches.map((i) => i.cat))].map((c) => [c, matches.filter((i) => i.cat === c)])];

    iconGrid.innerHTML = groups.filter(([, list]) => list.length).map(([name, list]) => `
      <div class="icon-group">
        <div class="icon-group-label">${name}</div>
        <div class="icon-cells">${list.map((ic) => `
          <button class="icon-cell" data-icon="${ic.id}" title="${ic.id}">
            ${glyph(ic)}<span>${ic.id}</span>
          </button>`).join('')}</div>
      </div>`).join('') || '<div class="icon-empty">No icons match that</div>';
  }

  function openIcons() {
    iconSearch.value = '';
    renderIcons('');
    iconPanel.hidden = false;
    iconBtn.setAttribute('aria-expanded', 'true');
    iconSearch.focus();
    iconSearch.select();
  }
  function closeIcons() {
    iconPanel.hidden = true;
    iconBtn.setAttribute('aria-expanded', 'false');
  }

  iconBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    iconPanel.hidden ? openIcons() : closeIcons();
  });
  iconPanel.addEventListener('click', (e) => {
    e.stopPropagation();
    const cell = e.target.closest('[data-icon]');
    if (!cell) return;
    pendingIcon = cell.dataset.icon;
    setTool('icon');
    closeIcons();
    toast(`${pendingIcon} — click the page to place it`);
  });
  iconSearch.addEventListener('input', () => renderIcons(iconSearch.value));
  iconSearch.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { closeIcons(); return; }
    if (e.key === 'Enter') {
      const first = iconGrid.querySelector('[data-icon]');
      if (first) first.click();
    }
  });
  root.addEventListener('click', () => { if (!iconPanel.hidden) closeIcons(); });

  // ------------------------------------------------------------------ pages

  const pagesEl = $('pages');
  let thumbTimer = null;

  function renderPageStrip() {
    pagesEl.innerHTML = pages.map((p, i) => `
      <button class="page-chip" role="tab" data-i="${i}" aria-selected="${i === pageIndex}"
              aria-label="Page ${i + 1}">
        <canvas width="92" height="64"></canvas>
        <span class="num">${i + 1}</span>
        ${pages.length > 1 ? `<span class="kill" data-kill="${i}" role="button" aria-label="Delete page ${i + 1}">&times;</span>` : ''}
      </button>`).join('');
    for (let i = 0; i < pages.length; i++) paintThumb(i);
  }

  function paintThumb(i) {
    const chip = pagesEl.children[i];
    if (!chip) return;
    const cv = chip.querySelector('canvas');
    const ctx = cv.getContext('2d');
    const p = pages[i];
    const k = Math.min(cv.width / p.w, cv.height / p.h);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = PAGE_BG;
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.setTransform(k, 0, 0, k, (cv.width - p.w * k) / 2, (cv.height - p.h * k) / 2);
    for (const s of p.shapes) drawShape(ctx, s);
  }

  /** Thumbnails are the one thing that would be wasteful per stroke, so they
   *  settle after you stop rather than tracking every frame. */
  function queueThumb() {
    clearTimeout(thumbTimer);
    thumbTimer = setTimeout(() => paintThumb(pageIndex), 400);
  }

  pagesEl.addEventListener('click', (e) => {
    const kill = e.target.closest('[data-kill]');
    if (kill) {
      e.stopPropagation();
      const i = +kill.dataset.kill;
      pages.splice(i, 1);
      pageIndex = Math.min(pageIndex, pages.length - 1);
      renderPageStrip(); gotoPage(pageIndex, true);
      return;
    }
    const chip = e.target.closest('[data-i]');
    if (chip) gotoPage(+chip.dataset.i);
  });

  function gotoPage(i, force) {
    if (i === pageIndex && !force) return;
    commitText();
    pageIndex = i;
    selectedId = null; draft = null; drag = null;
    for (const c of pagesEl.children) c.setAttribute('aria-selected', +c.dataset.i === i);
    $('sizeLabel').textContent = SIZES.find((s) => s.id === page().sizeId).label;
    fitPage(); syncChrome();
  }

  $('addPageBtn').addEventListener('click', () => {
    if (pages.length >= MAX_PAGES) return;
    // Refuse to stack blank pages. An empty page you forgot about still counts
    // as a page the moment a stray click puts a dot on it.
    if (!shapes().length) { toast('This page is still empty'); return; }
    pages.push(newPage(SIZES.find((s) => s.id === page().sizeId)));
    renderPageStrip();
    gotoPage(pages.length - 1, true);
  });

  // A mouse click should not park focus on a button: with focus sitting on "+",
  // every later Enter activated it instead of attaching. Keyboard focus is left
  // alone (detail === 0 for keyboard activation).
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b && e.detail > 0) b.blur();
  });

  // ------------------------------------------------------------------ zoom ui

  const hint = $('scrollHint');
  let hintTimer = null;
  function showZoom() {
    paintZoomLabel();
    hint.hidden = false;
    hint.classList.add('show');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => hint.classList.remove('show'), 700);
  }
  // Keeps the badge in sync even when it is mid-fade, so a Fit never leaves the
  // previous zoom level sitting on screen.
  const paintZoomLabel = () => {
    const t = Math.round(cam.z * 100) + '%';
    $('zoomLabel').textContent = t;
    hint.textContent = t;
  };

  const zoomCentre = (f) => zoomAt(VW / 2, VH / 2, f);
  $('zoomInBtn').addEventListener('click', () => zoomCentre(1.25));
  $('zoomOutBtn').addEventListener('click', () => zoomCentre(1 / 1.25));
  $('fitBtn').addEventListener('click', fitPage);
  $('zoomLabel').addEventListener('click', () => zoomCentre(1 / cam.z));

  // ------------------------------------------------------------------ preferences

  // Guarded so the pad still runs when opened directly over http:// for testing.
  const store = (typeof chrome !== 'undefined' && chrome.storage) ? chrome.storage.local : null;
  function savePrefs() {
    store?.set({ colorIndex: PALETTE.indexOf(color), widthIndex: WIDTHS.indexOf(width) });
  }
  store?.get(['colorIndex', 'widthIndex'], (p) => {
    if (PALETTE[p.colorIndex]) { color = PALETTE[p.colorIndex]; paintColorDot(); colorPop.refresh(); }
    if (WIDTHS[p.widthIndex]) { width = WIDTHS[p.widthIndex]; paintStrokeDot(); strokePop.refresh(); }
  });

  // ------------------------------------------------------------------ actions

  $('undoBtn').addEventListener('click', undo);
  $('redoBtn').addEventListener('click', redo);
  $('clearBtn').addEventListener('click', () => {
    if (!shapes().length) return;
    pushUndo();
    page().shapes = [];
    afterMutation();
  });
  $('cancelBtn').addEventListener('click', close);
  $('sendBtn').addEventListener('click', send);

  function close() { api.hide(); opts.onClose && opts.onClose(); }

  /** Each page exports at its own native size — no supersampling, nothing to be
   *  downsampled again on the way into the model. */
  function renderPageToBlob(p) {
    const out = document.createElement('canvas');
    out.width = p.w; out.height = p.h;
    const ctx = out.getContext('2d');
    ctx.fillStyle = PAGE_BG;
    ctx.fillRect(0, 0, p.w, p.h);
    for (const s of p.shapes) drawShape(ctx, s);
    return new Promise((r) => out.toBlob(r, 'image/png'));
  }

  let sending = false;
  async function send() {
    if (sending) return;
    commitText();
    const filled = pages.filter((p) => p.shapes.length);
    if (!filled.length) return;
    sending = true;
    try {
      const buffers = [];
      for (const p of filled) buffers.push(await (await renderPageToBlob(p)).arrayBuffer());
      // NO transfer list. The consumer is a content script in an isolated world,
      // and the page's main world receives this message too. Transferring hands
      // ownership to one world and the other gets a detached, zero-length buffer
      // — a 0-byte PNG that the uploader accepts and the server then rejects.
      // These are ~25KB; copying them costs nothing.
      api.hide();
      opts.onAttach && opts.onAttach(buffers);
    } finally {
      setTimeout(() => { sending = false; }, 1200);
    }
  }

  // ------------------------------------------------------------------ keyboard

  window.addEventListener('keydown', (e) => {
    if (!isOpen) return;
    if (e.target === textInput || root.activeElement === textInput) return;
    const mod = e.metaKey || e.ctrlKey;

    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomCentre(1.25); return; }
    if (mod && e.key === '-') { e.preventDefault(); zoomCentre(1 / 1.25); return; }
    if (mod && e.key === '0') { e.preventDefault(); fitPage(); return; }

    if (e.key === ' ' && !spaceHeld) { spaceHeld = true; surface.dataset.pan = '1'; e.preventDefault(); return; }
    if (e.key === 'Shift') { shiftHeld = true; if (draft) { constrain(draft); invalidate(); } return; }
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'Enter' && !mod) {
      // Let a focused control activate itself rather than attaching twice.
      if (root.activeElement && root.activeElement.tagName === 'BUTTON') return;
      e.preventDefault(); send(); return;
    }
    if (e.key === 'i' || e.key === 'I') { e.preventDefault(); iconPanel.hidden ? openIcons() : closeIcons(); return; }
    if (e.key === '[') { e.preventDefault(); gotoPage(Math.max(0, pageIndex - 1)); return; }
    if (e.key === ']') { e.preventDefault(); gotoPage(Math.min(pages.length - 1, pageIndex + 1)); return; }
    if ((e.key === 'Backspace' || e.key === 'Delete') && selectedId) {
      e.preventDefault(); pushUndo();
      page().shapes = shapes().filter((s) => s.id !== selectedId);
      afterMutation();
      return;
    }
    if (mod || e.altKey) return;
    const t = TOOLS.find((t) => t.key === e.key.toLowerCase());
    if (t) { e.preventDefault(); setTool(t.id); }
  });
  window.addEventListener('keyup', (e) => {
    if (!isOpen) return;
    if (e.key === 'Shift') { shiftHeld = false; if (draft) invalidate(); }
    if (e.key === ' ') { spaceHeld = false; delete surface.dataset.pan; }
  });
  window.addEventListener('blur', () => { spaceHeld = false; shiftHeld = false; delete surface.dataset.pan; });

  // ------------------------------------------------------------------ host

  const toastEl = $('toast');
  let toastTimer;
  function toast(text) {
    toastEl.textContent = text;
    toastEl.hidden = false;
    requestAnimationFrame(() => toastEl.classList.add('show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2400);
  }

  /** Back to one blank page, after the sketch has safely landed. A failed or
   *  rejected attach deliberately keeps everything so it can be retried. */
  function resetPad() {
    const size = SIZES.find((x) => x.id === page().sizeId) || SIZES[0];
    pages = [newPage(size)];
    pageIndex = 0;
    selectedId = null; draft = null; drag = null;
    pendingIcon = null;
    $('sizeLabel').textContent = size.label;
    renderPageStrip();
    camTouched = false;
    fitPage();
    syncChrome();
  }

  // ------------------------------------------------------------------ api

  const api = {
    get visible() { return isOpen; },
    show() {
      if (isOpen) return;
      isOpen = true;
      hostEl.dataset.open = '1';
      // Canvases size to zero while display:none, so measure after it is laid out.
      requestAnimationFrame(() => {
        hostEl.dataset.shown = '1';
        resizeCanvases();
        if (!camTouched) fitPage();
      });
    },
    hide() {
      if (!isOpen) return;
      isOpen = false;
      delete hostEl.dataset.shown;
      setTimeout(() => { if (!isOpen) delete hostEl.dataset.open; }, 170);
    },
    toggle() { isOpen ? api.hide() : api.show(); },
    setTheme(t) { hostEl.dataset.theme = t === 'dark' ? 'dark' : 'light'; },
    report({ how, count, status }) {
      if (status === 'failed') { toast('The site rejected the upload'); return; }
      if (status === 'empty') { toast('The sketch came through empty'); return; }
      if (!how) { toast('Could not attach the sketch'); return; }
      toast(how === 'clipboard' ? 'Copied — paste it into the message box'
                                : (count > 1 ? `Attached ${count} pages` : 'Attached'));
      // It landed, so start clean: otherwise the next Attach re-sends the same
      // sketch and every page you already sent along with it.
      resetPad();
    },
    destroy() { hostEl.remove(); },
  };

  // ------------------------------------------------------------------ boot

  renderPageStrip();
  syncChrome();
  return api;
};
