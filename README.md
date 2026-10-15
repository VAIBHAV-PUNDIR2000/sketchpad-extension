# Scratchpad for AI Chats

A floating **Sketch** button next to the message box on Claude, ChatGPT and Gemini.
Open it, draw a rough diagram, hit <kbd>Enter</kbd>, and the sketch is attached to
your prompt as a PNG.

No build step. No dependencies. No network calls. Load the folder and it runs.

## Install (unpacked, for development)

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → select this folder
4. Open claude.ai, chatgpt.com or gemini.google.com — the button appears above the composer

<kbd>Alt</kbd>+<kbd>S</kbd> opens and closes the pad from anywhere on the page.

## Tools

| Key | Tool | | Key | Action |
|-----|------|-|-----|--------|
| <kbd>V</kbd> | Select / move | | <kbd>⌘Z</kbd> / <kbd>⇧⌘Z</kbd> | Undo / redo |
| <kbd>P</kbd> | Pen | | <kbd>⇧</kbd> | Constrain (square / circle / 45°) |
| <kbd>R</kbd> | Box | | <kbd>⌫</kbd> | Delete selected |
| <kbd>O</kbd> | Ellipse | | <kbd>Enter</kbd> | Attach to prompt |
| <kbd>L</kbd> | Line | | <kbd>Esc</kbd> | Close |
| <kbd>A</kbd> | Arrow | | <kbd>[</kbd> / <kbd>]</kbd> | Previous / next page |
| <kbd>T</kbd> | Text | | <kbd>⌘+</kbd> / <kbd>⌘-</kbd> / <kbd>⌘0</kbd> | Zoom in / out / fit |
| <kbd>E</kbd> | Erase | | <kbd>Space</kbd>+drag | Pan |
| <kbd>I</kbd> | Icons | | | |

### Navigating

- **Pinch** to zoom (trackpad or touchscreen), **two-finger scroll** to pan
- **Space+drag** or **middle-drag** to pan with a mouse
- Zoom anchors on the pointer, so you zoom into what you're pointing at

Zoom is the best thing here for trackpad drawing. At 300% your trackpad is
effectively 3× more precise, and the stroke you commit is at full page resolution
either way.

### Icons

<kbd>I</kbd> or the grid button opens a searchable icon picker — 51 hand-authored
24x24 stroke glyphs across Infrastructure, Data & flow, Interface and Status, with
the ones you actually reach for when sketching a system (database, cloud, server,
queue, cache, api, lock, user) floated into a Popular row at the top. Search
matches id, keywords and category, so "db" finds `database` and "docker" finds
`container`.

Click the page to drop an icon at a default size, or drag to size it. Icons are
ordinary shapes: they take the current ink colour and stroke width, move with the
select tool, and delete like anything else.

They are stored as SVG path data in `src/pad-icons.js`, so the same string renders
in the picker as an `<svg>` and on the canvas through a cached `Path2D`.

### Pages

Each page is a fixed sheet in one of three sizes — **Standard** 1280×800,
**Wide** 2560×800, **Tall** 1280×1600 — set per page from the toolbar. Add up to
8 from the strip in the status bar. Every page with something on it is attached as
its own image, so a three-page sketch arrives as three attachments.

Undo history is per page, so undo never reaches across a page switch.

**After a successful attach the pad resets to one blank page.** Otherwise the next
Attach re-sends the sketch you just sent, plus every page along with it. A failed
or rejected attach deliberately keeps everything, so you can fix it and retry.

### Theme

The chrome follows the host page's light or dark theme. **The paper stays white in
both.** Dark chrome with a light canvas is what every drawing tool does, it keeps
the exported PNG dark-on-white (the easiest read for a vision model), and a dark
sheet doesn't feel like paper. The ink palette is therefore tied to the paper, not
the UI, so a sketch exports identically either way.

## How it works

```
src/content.js      isolated world: floating button, pad lifecycle, orchestration
src/pad-ui.js       isolated world: the pad, rendered into a shadow root
src/pad-css.js      the pad stylesheet, as a string (shadcn/ui tokens)
src/inject-main.js  MAIN world: builds the File and dispatches it to the site
```

### Why the pad is a shadow root and not an iframe

It was an iframe at `chrome-extension://.../pad.html`. That does not work on the
sites this extension targets. Both ship a strict `frame-src` allowlist with no
`chrome-extension:` entry:

```
chatgpt.com   frame-src 'self' challenges.cloudflare.com https://*.embed.chatgpt.site ...
claude.ai     frame-src 'self' a-cdn.claude.ai a.claude.ai b.stripecdn.com ...
```

The frame was silently stripped — no console error on the page, the overlay div
just ended up empty — so the pad never rendered at all. Content-script DOM and
styles are **not** subject to the host page's CSP, so a shadow root works
everywhere, and it removes the postMessage bridge as a bonus.

This is also why `pad-css.js` is a `.js` file holding a string: there is no
document to link a stylesheet into, and fetching one would need a web-accessible
resource plus an await before the pad could open. The extension declares no
`web_accessible_resources` at all now.

### Why injection runs in the MAIN world

`File`, `FileList` and `DataTransfer` are host objects. Built in a content
script's isolated world and handed to the page's handlers, they can arrive
without their properties intact — ChatGPT ended up creating an upload record
named `undefined` and rejecting it. `src/inject-main.js` is registered with
`"world": "MAIN"` so every object the site touches is native to its own world.

The isolated side ships raw bytes across (an ArrayBuffer is data, not a host
object, so it marshals cleanly) and gets back `{how, status}`. If the MAIN script
never answers — an older Chrome without `world` support — `content.js` falls back
to dispatching from the isolated world.

Four decisions worth knowing before you change anything:

**The canvas is viewport-sized, never artboard-sized.** This is what lets the
world be any size for free. A 2560×1600 page at DPR 2 would need a 65MB backing
store *per layer*; a viewport-sized canvas stays near 1MB however far you pan. The
camera (`screen = (world - cam) * z`) decides what gets drawn, applied as a single
`setTransform` before each render.

**File construction happens in the MAIN world.** `File`, `FileList` and
`DataTransfer` are host objects; built in the isolated world and handed to the
page's handlers they can arrive with their properties missing — ChatGPT created
an upload record named `undefined` and rejected it. `src/inject-main.js` runs with
`"world": "MAIN"` so everything the site touches is native to its own world.

**The button never enters the site's DOM.** Claude, ChatGPT and Gemini are React
apps and will unmount foreign nodes that land in a managed subtree. The button is
`position: fixed` in a shadow root on `<html>`, tracking the composer's bounding
rect via `ResizeObserver`.

**No `MutationObserver` on `<body>`.** On ChatGPT that fires continuously while a
response streams, and the page feels slow in a way users blame on the extension.
Re-anchoring happens on SPA navigation (patched `pushState`/`replaceState`) with a
cheap 1s backing poll.

**Nothing re-renders during a stroke.** Pointer events mutate a plain object and
request a frame. `#static` holds committed shapes; `#overlay` holds only the shape
under your cursor. Dragging a box across a busy sketch repaints an almost-empty
overlay instead of every shape. Both layers cull against the viewport — one AABB
test per shape, far cheaper than the draw calls it skips, and it's what makes
panning a large page free.

Panning and zooming currently repaint the static layer each frame (culled). If you
ever push past a few thousand shapes and feel it, the next lever is to CSS-`transform`
the canvas elements during the gesture and repaint once on release — GPU-cheap,
slightly soft mid-gesture, crisp when you stop.

### Per-site behaviour

Verified live, signed in, on all three:

| Site | Winning strategy | Notes |
|---|---|---|
| ChatGPT | `fileinput` | Four file inputs inside the composer `<form>`; any of them works |
| Claude | `fileinput` | No `<form>`; one file input, nine levels above the composer |
| Gemini | `paste` | **No file inputs exist** until you open its upload menu, so `fileinput` is skipped and paste carries it |

Gemini is why the cascade has to stay a cascade, and Claude is why the region is
derived rather than hardcoded.

### Injection cascade

`injectImage()` tries four mechanisms and verifies each one actually produced an
attachment before giving up on it:

1. **File input** — assign `input.files` and dispatch `change`. Indistinguishable
   from a real file pick. Most robust.
2. **Synthetic paste** — `ClipboardEvent` with a populated `clipboardData`.
   ProseMirror (Claude, ChatGPT) reads `.files` directly and doesn't check
   `isTrusted`.
3. **Synthetic drop** — `DragEvent` sequence on the composer region.
4. **Real clipboard** — `navigator.clipboard.write()` plus a toast telling you to
   press ⌘V. Never fails.

Verification watches for our own short filename (`sketch-k3f9.png`) in the
composer region's text, falling back to a thumbnail-node count. It then keeps
watching for 1.2s, because these chips render first and only turn red afterwards
— an earlier version counted a failed-upload chip's broken-image icon as success
and cheerfully sent the next page.

The region is the **smallest ancestor of the composer that also contains a file
input** — the attachment UI's container by definition. A fixed three-parents-up
worked on ChatGPT (a `<form>`) but not on Claude, which has no form and renders
chips six levels up: detection never fired, every strategy got dispatched, and
each attach produced two duplicate chips. On Gemini no file input exists at all,
so that walk fails and a document-wide thumbnail count is the backstop — which
also guarantees we never stack duplicates when the region is wrong.

Failure text is **counted**, not just tested for. A rejected chip stays in the
composer until the user dismisses it, so a plain `test()` reported every later
upload as failed — and since the multi-page loop stops on a failure, page 2
onward never went out. Only a *new* occurrence counts as our failure.

It returns `ok` / `failed` / `none`. Anything but `none` means the strategy
reached the uploader, so the cascade stops there rather than stacking a duplicate
chip, and a `failed` stops the whole multi-page run.

Set `console` to show Debug level to see one line per page:
`[scratchpad] page 1/2 sketch-1-k3f9.png -> fileinput ok`

### Never transfer the buffers

`send()` posts the PNG ArrayBuffers to the parent **without a transfer list**.
The consumer is a content script in an isolated world, and the page's own main
world receives that message too. A transfer moves ownership, and the world that
doesn't get it can see a detached, zero-length buffer — which becomes a 0-byte
PNG that the uploader happily accepts and the server then rejects with a generic
"Upload failed". The buffers are ~25KB; copying them costs nothing. Don't
optimise this.

### Export

Each page exports a PNG at its own native size — no supersampling, nothing to be
downsampled twice. Standard is 1.02 MP, just under the ~1.15 MP point where Claude
starts resizing, so a standard page reaches the model untouched. Wide and Tall
trade some of that headroom for room to draw; past 2× the sensible move is another
page rather than a bigger one.

Stroke widths are deliberately heavy for the same reason: thin lines soften into
nothing if the image is ever resized.

Pages are injected **one at a time**, each waiting for its own thumbnail to appear
before the next starts — these uploaders debounce their file handling and firing
them together silently drops all but the last. Whichever strategy wins for page 1
is reused for the rest.

## Status

Verified by driving the pad in a browser: all eight tools, undo/redo, select and
move, erase, both themes, keyboard shortcuts, pinch zoom (anchored on the pointer),
two-finger pan, fit, page add/switch/delete, per-page sizes, and multi-page export
— two pages came out as a 1280×800 and a 2560×800 PNG, both valid.

Verified against live ChatGPT in a signed-in browser: a `File` built in the page's
own world and handed to the composer's `input[type=file]` uploads successfully,
and the extension's own MAIN-world path returns
`{how: "fileinput", status: "ok", fileName: "sketch-xyz9.png"}` with the image
appearing in the composer.

Verified end to end on live ChatGPT: the shadow-root pad opens over the page, two
pages drawn and attached, both landing in the composer —

```
v0.2.0 page 1/2 sketch-1-jvlc.png 23775B -> fileinput ok
v0.2.0 page 2/2 sketch-2-jvlc.png 23705B -> fileinput ok
```

The stale-failure fix was then verified live too: three consecutive pages all
report `ok` with a leftover "Upload failed" chip present in the composer, where
before even a single page reported `failed`.

## Known limitations (v1)

- Shapes are independent — moving a box does not move its label
- No resize handles; move and delete only
- Pages don't reorder (no drag in the strip)
- Icons can be moved and deleted but not resized after placing
- A single tap with the pen leaves a dot, which counts as page content
- Nothing constrains drawing to the page bounds — you can draw off-sheet, and it
  won't export. The page frame makes this visible but there's no snap-back.
- No shape snapping or arrow binding (the planned next step, and the thing that
  makes trackpad use genuinely good)
- Sketches aren't persisted between opens
- No Firefox/Safari build
- `fileinput` is the only strategy that has been confirmed to work on ChatGPT;
  paste and drop are untested there and remain as fallbacks

## Packaging

```bash
./tools/package.sh
```

Writes `dist/scratchpad-<version>.zip`, ready to upload to the Chrome Web Store.
See `store/listing.md` for the listing copy and permission justifications.
