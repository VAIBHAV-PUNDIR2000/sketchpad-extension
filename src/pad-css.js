/* Pad stylesheet, as a string.
 *
 * It lives in a .js file rather than a .css file because the pad renders into
 * a shadow root created by the content script — there is no document to link a
 * stylesheet into, and fetching one would need an extra web-accessible resource
 * plus an await before the pad can show. This is the single source of truth;
 * there is no longer a pad.css. */
self.__SCRATCHPAD_CSS = `/* shadcn/ui design tokens, hand-written. Same neutral ramp, same 0.5rem radius,
   same muted-foreground/border treatment — without dragging a build step and a
   React runtime into the drawing hot path.

   The paper is white in BOTH themes. Dark chrome with a light canvas is what
   every drawing tool does, it keeps the exported PNG dark-on-white (the easiest
   read for a vision model), and a dark sheet simply doesn't feel like paper.
   --muted is the recessed well the page sits in, so in dark mode it is DARKER
   than --background, not lighter. */

:host([data-theme="light"]) {
  --background: #ffffff;
  --foreground: #09090b;
  --muted: #f4f4f5;
  --muted-foreground: #71717a;
  --accent: #f4f4f5;
  --accent-foreground: #18181b;
  --border: #e4e4e7;
  --input: #e4e4e7;
  --ring: #a1a1aa;
  --primary: #18181b;
  --primary-foreground: #fafafa;
  --popover: #ffffff;
  --canvas: #ffffff;
  --chip: #18181b;
  --chip-foreground: #fafafa;
  --shadow: 0 10px 30px -12px rgb(0 0 0 / .18);
}

:host([data-theme="dark"]) {
  --background: #1a1a1d;
  --foreground: #ededf0;
  --muted: #0e0e10;            /* the well — recessed, so darker than the chrome */
  --muted-foreground: #9a9aa3;
  --accent: #292930;
  --accent-foreground: #fafafa;
  --border: #313138;           /* #27272a was effectively invisible on #18181b */
  --input: #3f3f46;
  --ring: #5b5b66;
  --primary: #fafafa;
  --primary-foreground: #18181b;
  --popover: #212126;
  --canvas: #ffffff;           /* paper stays paper */
  --chip: #2c2c33;
  --chip-foreground: #fafafa;
  --shadow: 0 14px 38px -14px rgb(0 0 0 / .7);
}

* { box-sizing: border-box; }


:host {
  all: initial;
  position: fixed; inset: 0; z-index: 2147483647;
  display: none;
  font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  font-size: 14px;
  color: var(--foreground);
}
:host([data-open="1"]) { display: block; }

.backdrop {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  background: rgba(9, 9, 11, .42);
  backdrop-filter: blur(2px);
  opacity: 0; transition: opacity .15s ease;
}
:host([data-shown="1"]) .backdrop { opacity: 1; }

.pad-shell {
  width: min(94vw, 1020px); height: min(88vh, 760px);
  transform: scale(.985);
  transition: transform .15s cubic-bezier(.2,.8,.3,1);
  box-shadow: 0 24px 60px -12px rgba(0,0,0,.45);
  border-radius: 14px;
}
:host([data-shown="1"]) .pad-shell { transform: scale(1); }

* { -webkit-font-smoothing: antialiased; }

.pad {
  display: flex; flex-direction: column; height: 100%;
  background: var(--background);
  border: 1px solid var(--border);
  border-radius: 14px;
  overflow: hidden;
}

/* ------------------------------------------------------------------ toolbar */

.toolbar {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--background);
  flex: 0 0 auto;
}
.group { display: flex; align-items: center; gap: 2px; }
.spacer { flex: 1 1 auto; }
.sep { width: 1px; height: 20px; background: var(--border); margin: 0 4px; flex: 0 0 auto; }

.tool {
  position: relative;
  display: inline-flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; padding: 0;
  border: 0; border-radius: 8px;
  background: transparent; color: var(--muted-foreground);
  cursor: pointer;
  transition: background .12s ease, color .12s ease;
}
.tool:hover { background: var(--accent); color: var(--accent-foreground); }
.tool:focus-visible { outline: 2px solid var(--ring); outline-offset: -1px; }
.tool[aria-pressed="true"] { background: var(--accent); color: var(--accent-foreground); }
.tool[disabled] { opacity: .4; pointer-events: none; }
.tool svg {
  width: 16px; height: 16px; fill: none; stroke: currentColor;
  stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round;
}

/* tooltips: cheap, no portal, no layout thrash */
.tool[data-tip]::after {
  content: attr(data-tip);
  position: absolute; top: calc(100% + 7px); left: 50%;
  transform: translateX(-50%) translateY(-3px);
  padding: 5px 8px; border-radius: 6px; white-space: nowrap;
  font-size: 12px; font-weight: 500; line-height: 1;
  background: var(--chip); color: var(--chip-foreground);
  opacity: 0; pointer-events: none; z-index: 20;
  transition: opacity .12s ease .25s, transform .12s ease .25s;
}
.tool[data-tip]:hover::after { opacity: 1; transform: translateX(-50%) translateY(0); }

.stroke-dot { background: currentColor; border-radius: 99px; width: 16px; }
.color-dot { width: 15px; height: 15px; border-radius: 99px; border: 1px solid var(--border); }

/* ------------------------------------------------------------------ buttons */

.btn {
  display: inline-flex; align-items: center; gap: 7px;
  height: 32px; padding: 0 12px;
  font-size: 13px; font-weight: 500;
  border-radius: 8px; border: 1px solid transparent;
  cursor: pointer;
  transition: background .12s ease, opacity .12s ease;
}
.btn:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
.btn.ghost { background: transparent; color: var(--muted-foreground); }
.btn.ghost:hover { background: var(--accent); color: var(--accent-foreground); }
.btn.primary { background: var(--primary); color: var(--primary-foreground); }
.btn.primary:hover { opacity: .9; }

kbd {
  font: 500 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  padding: 2px 4px; border-radius: 4px;
  background: color-mix(in srgb, currentColor 14%, transparent);
  border: 0;
}

/* ------------------------------------------------------------------ popovers */

.popover[hidden] { display: none; }
.popover {
  position: absolute; z-index: 30;
  display: flex; gap: 4px; align-items: center;
  padding: 6px; margin-top: 6px;
  background: var(--popover);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: var(--shadow);
  animation: pop .12s cubic-bezier(.2,.8,.3,1);
}
@keyframes pop { from { opacity: 0; transform: scale(.96) translateY(-2px); } }
.popover button {
  display: inline-flex; align-items: center; justify-content: center;
  width: 30px; height: 30px; padding: 0;
  border: 0; border-radius: 7px; background: transparent;
  color: var(--muted-foreground); cursor: pointer;
}
.popover button:hover { background: var(--accent); }
.popover button[aria-checked="true"] { background: var(--accent); }
.popover button:focus-visible { outline: 2px solid var(--ring); outline-offset: -1px; }
.swatch { width: 16px; height: 16px; border-radius: 99px; border: 1px solid var(--border); }

/* ------------------------------------------------------------------ stage */

.stage {
  position: relative;
  flex: 1 1 auto; min-height: 0;
  background: var(--muted);
  overflow: hidden;
}
.surface {
  position: relative;
  width: 100%; height: 100%;
  overflow: hidden;
  touch-action: none;
}
.surface canvas {
  display: block; position: absolute; inset: 0;
  width: 100%; height: 100%;
  touch-action: none;
}
#overlay { cursor: crosshair; }
.surface[data-pan="1"] #overlay,
.surface[data-pan="1"] #overlay:active { cursor: grab; }
.surface[data-panning="1"] #overlay { cursor: grabbing; }
.surface[data-tool="select"] #overlay { cursor: default; }
.surface[data-tool="text"]   #overlay { cursor: text; }
.surface[data-tool="eraser"] #overlay { cursor: cell; }

.text-input {
  position: absolute; z-index: 5;
  padding: 2px 4px; margin: 0;
  border: 1px dashed var(--ring); border-radius: 4px;
  background: color-mix(in srgb, var(--canvas) 85%, transparent);
  color: inherit; font-family: inherit; outline: none;
  min-width: 40px;
}

/* ------------------------------------------------------------------ footer */

.hint {
  flex: 0 0 auto;
  display: flex; justify-content: space-between; gap: 12px;
  padding: 7px 12px;
  border-top: 1px solid var(--border);
  font-size: 11.5px; color: var(--muted-foreground);
}
.hint .muted { opacity: .8; }
@media (max-width: 720px) { .hint span:last-child { display: none; } }

/* ------------------------------------------------------------------ toast */

.toast {
  position: absolute; left: 50%; bottom: 22px; transform: translateX(-50%) translateY(6px);
  padding: 8px 12px; border-radius: 8px;
  font-size: 13px; font-weight: 500;
  background: var(--chip); color: var(--chip-foreground);
  box-shadow: var(--shadow);
  opacity: 0; pointer-events: none;
  transition: opacity .15s ease, transform .15s ease;
}
.toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }

@media (prefers-reduced-motion: reduce) {
  *, *::after { transition: none !important; animation: none !important; }
}


/* ------------------------------------------------------------------ status bar */

.statusbar {
  flex: 0 0 auto;
  display: flex; align-items: center; gap: 6px;
  padding: 6px 8px;
  border-top: 1px solid var(--border);
  background: var(--background);
  min-height: 46px;
}

.pages { display: flex; align-items: center; gap: 6px; overflow-x: auto; max-width: 62%; }
.pages::-webkit-scrollbar { height: 0; }

.page-chip {
  position: relative; flex: 0 0 auto;
  width: 46px; height: 32px; padding: 0;
  border: 1px solid var(--border); border-radius: 6px;
  background: var(--canvas); cursor: pointer; overflow: hidden;
  transition: border-color .12s ease, box-shadow .12s ease;
}
.page-chip canvas { display: block; width: 100%; height: 100%; }
.page-chip:hover { border-color: var(--ring); }
.page-chip[aria-selected="true"] { border-color: var(--foreground); box-shadow: 0 0 0 1px var(--foreground); }
.page-chip:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
.page-chip .num {
  position: absolute; left: 2px; bottom: 1px;
  font-size: 9px; font-weight: 600; line-height: 1;
  padding: 1px 3px; border-radius: 3px;
  background: color-mix(in srgb, var(--background) 78%, transparent);
  color: var(--muted-foreground);
}
.page-chip .kill {
  position: absolute; top: 1px; right: 1px;
  width: 13px; height: 13px; padding: 0; line-height: 1;
  display: none; align-items: center; justify-content: center;
  font-size: 12px; border: 0; border-radius: 4px; cursor: pointer;
  background: var(--chip); color: var(--chip-foreground);
}
.page-chip:hover .kill { display: flex; }

.tool.sm { width: 26px; height: 26px; }
.tool.sm svg { width: 13px; height: 13px; }
.tool.wide { width: auto; gap: 6px; padding: 0 9px; font-size: 12.5px; font-weight: 500; }

.zoom { gap: 1px; }
.zoom-level {
  min-width: 48px; height: 26px; padding: 0 6px;
  border: 0; border-radius: 7px; background: transparent;
  font: 500 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--muted-foreground); cursor: pointer;
}
.zoom-level:hover { background: var(--accent); color: var(--accent-foreground); }
.zoom-level:focus-visible { outline: 2px solid var(--ring); outline-offset: -1px; }

.popover.wide { flex-direction: column; align-items: stretch; gap: 2px; min-width: 164px; }
.popover.wide button {
  width: auto; height: 30px; padding: 0 9px; gap: 8px;
  justify-content: flex-start; font-size: 13px; color: var(--foreground);
}
.popover.wide button .dim { margin-left: auto; font-size: 11px; color: var(--muted-foreground); }

/* Transient readout while panning or zooming — avoids a toolbar re-render per frame. */
.scroll-hint {
  position: absolute; right: 12px; top: 12px;
  padding: 4px 8px; border-radius: 6px;
  font: 500 11.5px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  background: var(--chip); color: var(--chip-foreground);
  opacity: 0; transition: opacity .12s ease; pointer-events: none;
}
.scroll-hint.show { opacity: .92; }


/* ------------------------------------------------------------------ icon picker */

.pad { position: relative; }

.icon-panel {
  position: absolute; z-index: 40;
  top: 50px; left: 10px;
  width: min(430px, calc(100% - 20px));
  max-height: min(420px, calc(100% - 110px));
  display: flex; flex-direction: column;
  background: var(--popover);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: var(--shadow);
  overflow: hidden;
  animation: pop .12s cubic-bezier(.2,.8,.3,1);
}
.icon-panel[hidden] { display: none; }

.icon-search {
  display: flex; align-items: center; gap: 8px;
  padding: 9px 11px;
  border-bottom: 1px solid var(--border);
  flex: 0 0 auto;
}
.icon-search svg {
  width: 15px; height: 15px; flex: 0 0 auto;
  fill: none; stroke: var(--muted-foreground); stroke-width: 1.8;
  stroke-linecap: round; stroke-linejoin: round;
}
.icon-search input {
  flex: 1 1 auto; min-width: 0;
  border: 0; background: transparent; outline: none;
  color: var(--foreground); font: inherit; font-size: 13.5px;
}
.icon-search input::placeholder { color: var(--muted-foreground); }

.icon-grid { overflow-y: auto; padding: 8px 10px 12px; }
.icon-grid::-webkit-scrollbar { width: 10px; }
.icon-grid::-webkit-scrollbar-thumb {
  background: var(--border); border-radius: 99px;
  border: 3px solid var(--popover);
}

.icon-group + .icon-group { margin-top: 12px; }
.icon-group-label {
  font-size: 11px; font-weight: 600; letter-spacing: .04em;
  text-transform: uppercase; color: var(--muted-foreground);
  padding: 6px 2px 7px;
}
.icon-cells { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; }

.icon-cell {
  display: flex; flex-direction: column; align-items: center; gap: 5px;
  padding: 9px 3px 6px;
  border: 1px solid transparent; border-radius: 9px;
  background: transparent; color: var(--foreground);
  cursor: pointer; overflow: hidden;
  transition: background .12s ease, border-color .12s ease;
}
.icon-cell:hover { background: var(--accent); border-color: var(--border); }
.icon-cell:focus-visible { outline: 2px solid var(--ring); outline-offset: -1px; }
.icon-cell svg {
  width: 22px; height: 22px; fill: none; stroke: currentColor;
  stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round;
}
.icon-cell span {
  font-size: 10px; line-height: 1.1; color: var(--muted-foreground);
  max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.icon-empty {
  padding: 26px 10px; text-align: center;
  font-size: 13px; color: var(--muted-foreground);
}
`;
