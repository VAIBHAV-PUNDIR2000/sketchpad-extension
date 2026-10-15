/* Scratchpad for AI Chats — host-page side.
 *
 * Responsibilities, in order of how much they can break:
 *   1. find the composer and park a button near it   (fragile-ish, heuristic fallback)
 *   2. own the pad's lifecycle (shadow root, not an iframe)  (ours, can't break)
 *   3. get a PNG into the site's attachment flow     (fragile, four fallbacks)
 *
 * Deliberate choices:
 *   - We never insert nodes into the site's own DOM. These are all React apps and
 *     they will happily unmount anything foreign that lands inside a managed
 *     subtree. The button is position:fixed and tracks the composer's rect.
 *   - The pad is a shadow root in this page, never a chrome-extension:// iframe.
 *     ChatGPT and Claude both ship a strict `frame-src` with no chrome-extension:
 *     entry, so a frame is silently stripped.
 *   - No MutationObserver on <body>. On ChatGPT that fires continuously while a
 *     response streams and makes the whole page feel like our fault. We poll
 *     cheaply, back off, and re-anchor on SPA navigation.
 */
(() => {
  'use strict';
  if (window.__scratchpadLoaded) return;
  window.__scratchpadLoaded = true;

  const VERSION = chrome.runtime.getManifest().version;

  // ---------------------------------------------------------------- site adapters

  const SITES = {
    'claude.ai': {
      id: 'claude',
      composer: ['div.ProseMirror[contenteditable="true"]', 'div[contenteditable="true"]'],
    },
    'chatgpt.com': {
      id: 'chatgpt',
      composer: ['#prompt-textarea', 'div.ProseMirror[contenteditable="true"]', 'textarea'],
    },
    'chat.openai.com': {
      id: 'chatgpt',
      composer: ['#prompt-textarea', 'div.ProseMirror[contenteditable="true"]', 'textarea'],
    },
    'gemini.google.com': {
      id: 'gemini',
      composer: ['rich-textarea div[contenteditable="true"]', 'div.ql-editor[contenteditable="true"]', 'div[contenteditable="true"]'],
    },
  };

  const site = SITES[location.hostname];
  if (!site) return;

  /** Last resort when every selector above misses: the lowest editable box on screen. */
  function heuristicComposer() {
    const cands = [...document.querySelectorAll('div[contenteditable="true"], textarea')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 180 && r.height > 20 && r.bottom > window.innerHeight * 0.4;
      });
    return cands.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0] || null;
  }

  function findComposer() {
    for (const sel of site.composer) {
      const el = document.querySelector(sel);
      if (el && el.getBoundingClientRect().width > 120) return el;
    }
    return heuristicComposer();
  }

  /** The chunk of DOM that holds the composer and its attachment chips: the
   *  smallest ancestor that also holds a file input. See the note in
   *  inject-main.js — a fixed depth broke on Claude. */
  function composerRegion(composer) {
    let el = composer.parentElement;
    for (let i = 0; i < 12 && el && el !== document.body; i++, el = el.parentElement) {
      if (el.querySelector('input[type="file"]')) return el;
    }
    return composer.closest('form') || composer.parentElement?.parentElement?.parentElement || composer;
  }

  // ---------------------------------------------------------------- theme

  function isDark() {
    const probe = findComposer() || document.body;
    let el = probe;
    for (let i = 0; i < 6 && el; i++, el = el.parentElement) {
      const bg = getComputedStyle(el).backgroundColor;
      const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (!m) continue;
      const [r, g, b] = [+m[1], +m[2], +m[3]];
      if (bg.includes('rgba') && bg.endsWith(', 0)')) continue;
      return (0.299 * r + 0.587 * g + 0.114 * b) < 128;
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  // ---------------------------------------------------------------- floating button

  const host = document.createElement('div');
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483646;top:0;left:0;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      button {
        position: fixed; display: inline-flex; align-items: center; gap: 6px;
        height: 32px; padding: 0 10px 0 9px;
        font: 500 13px/1 ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif;
        color: var(--fg); background: var(--bg);
        border: 1px solid var(--border); border-radius: 8px;
        cursor: pointer; opacity: 0; transform: translateY(2px);
        transition: opacity .14s ease, transform .14s ease, background .12s ease;
        box-shadow: 0 1px 2px rgba(0,0,0,.06);
        -webkit-font-smoothing: antialiased;
      }
      button.show { opacity: 1; transform: translateY(0); }
      button:hover { background: var(--bg-hover); }
      button:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
      button:active { transform: translateY(1px); }
      svg { width: 15px; height: 15px; }
      @media (prefers-reduced-motion: reduce) { button { transition: none; } }
    </style>
    <button part="btn" type="button" aria-label="Open scratchpad (Alt+S)" title="Scratchpad — Alt+S">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3 17c3-6 5 2 8-3s4 1 7-4"/>
        <path d="M3 21h18"/>
      </svg>
      <span>Sketch</span>
    </button>`;
  const btn = root.querySelector('button');

  function paintButtonTheme(dark) {
    btn.style.setProperty('--fg', dark ? '#e4e4e7' : '#3f3f46');
    btn.style.setProperty('--bg', dark ? '#27272a' : '#ffffff');
    btn.style.setProperty('--bg-hover', dark ? '#323236' : '#f4f4f5');
    btn.style.setProperty('--border', dark ? '#3f3f46' : '#e4e4e7');
    btn.style.setProperty('--ring', dark ? '#a1a1aa' : '#71717a');
  }

  // ---------------------------------------------------------------- anchoring

  let composer = null;
  let rafPending = false;

  function placeButton() {
    rafPending = false;
    if (!composer || !composer.isConnected) { composer = findComposer(); }
    if (!composer) { btn.classList.remove('show'); return; }
    const r = composer.getBoundingClientRect();
    if (r.width < 100) { btn.classList.remove('show'); return; }
    // Sit just above the composer's right edge: clear of send buttons and of the
    // model picker, and it survives the composer growing as you type.
    const top = Math.max(8, r.top - 40);
    const left = Math.min(window.innerWidth - 100, r.right - 92);
    btn.style.top = top + 'px';
    btn.style.left = left + 'px';
    btn.classList.add('show');
  }

  function schedulePlace() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(placeButton);
  }

  function attach() {
    composer = findComposer();
    paintButtonTheme(isDark());
    placeButton();
    if (composer) {
      ro.disconnect();
      ro.observe(composer);
      const region = composerRegion(composer);
      if (region !== composer) ro.observe(region);
    }
  }

  const ro = new ResizeObserver(schedulePlace);
  window.addEventListener('resize', schedulePlace, { passive: true });
  window.addEventListener('scroll', schedulePlace, { passive: true, capture: true });

  // Re-anchor on SPA navigation rather than watching the DOM for changes.
  for (const fn of ['pushState', 'replaceState']) {
    const orig = history[fn];
    history[fn] = function () { const r = orig.apply(this, arguments); setTimeout(attach, 350); return r; };
  }
  window.addEventListener('popstate', () => setTimeout(attach, 350));

  // Cheap backing poll: fast while we have no composer, slow once anchored.
  let misses = 0;
  setInterval(() => {
    if (composer && composer.isConnected) {
      misses = 0;
      if (padOpen) return;
      schedulePlace();
    } else if (misses++ < 40 || misses % 10 === 0) {
      attach();
    }
  }, 1000);

  document.documentElement.appendChild(host);
  attach();
  window.postMessage({ ns: 'scratchpad-ping' }, '*');
  setTimeout(() => {
    window.postMessage({ ns: 'scratchpad-ping' }, '*');
    setTimeout(() => console.debug('%c[scratchpad]', 'color:#2563eb',
      `v${VERSION} ready on ${site.id}; main-world dispatch: ${mainWorldSeen ? 'yes' : 'NO'}`), 300);
  }, 900);

  // ---------------------------------------------------------------- pad lifecycle

  /* The pad is a shadow root in this page, not an iframe. ChatGPT and Claude both
   * ship a strict `frame-src` with no chrome-extension: entry, so a frame is
   * silently stripped — which is why the pad never appeared. Content-script DOM
   * is not subject to the page's CSP. */
  let pad = null;

  function ensurePad() {
    if (pad) return pad;
    pad = self.__scratchpadCreatePad({
      theme: isDark() ? 'dark' : 'light',
      onClose: () => {},
      onAttach: (buffers) => {
        // Let the close transition finish before touching the host app's React.
        setTimeout(() => handleAttach(buffers), 190);
      },
    });
    return pad;
  }

  function openPad() {
    const p = ensurePad();
    p.setTheme(isDark() ? 'dark' : 'light');
    p.show();
  }
  const closePad = () => pad && pad.hide();
  const padOpen = () => !!pad && pad.visible;

  btn.addEventListener('click', () => (padOpen() ? closePad() : openPad()));
  window.addEventListener('keydown', (e) => {
    if (e.altKey && !e.metaKey && !e.ctrlKey && (e.key === 's' || e.key === 'S')) {
      e.preventDefault(); padOpen() ? closePad() : openPad();
    }
  });

  // Build it once the page is quiet so the first open is instant.
  (window.requestIdleCallback || setTimeout)(() => ensurePad(), { timeout: 4000 });

  async function handleAttach(buffers) {
    const blobs = buffers.map((b) => new Blob([b], { type: 'image/png' }));
    if (!blobs.length) return;
    const { how, done, status } = await injectImages(blobs);
    pad && pad.report({ how, count: done, status });
    if (how === 'clipboard') {
      toast(blobs.length > 1
        ? 'Only the first page could be copied — press ' + pasteKey()
        : 'Sketch copied — press ' + pasteKey());
    } else if (status === 'failed') {
      toast(done
        ? `${done} attached, then the site rejected one — remove the failed chip and retry`
        : 'The site rejected the upload — remove the failed chip and try again');
    } else if (!how) {
      toast('Could not attach the sketch automatically');
    }
  }

  // ---------------------------------------------------------------- injection

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = (...a) => console.debug('%c[scratchpad]', 'color:#2563eb', `v${VERSION}`, ...a);

  function pasteKey() {
    return navigator.platform.includes('Mac') ? '\u2318V' : 'Ctrl+V';
  }

  /* Pages go in one at a time. These uploaders debounce their own file handling,
   * so firing all of them at once silently drops all but the last.
   *
   * We stop on the first page the site rejects rather than marching through the
   * rest — three "Upload failed" chips help nobody. */
  async function injectImages(blobs) {
    let how = null, done = 0, status = 'none';
    const tag = Date.now().toString(36).slice(-4);

    for (let i = 0; i < blobs.length; i++) {
      // Short and unique: these chips truncate the filename in the DOM, and we
      // match on it to tell our own attachment apart from anything else there.
      const name = blobs.length > 1 ? `sketch-${i + 1}-${tag}.png` : `sketch-${tag}.png`;
      if (!blobs[i].size) {
        log(`page ${i + 1}: blob is 0 bytes — refusing to inject`);
        return { how: null, done, status: 'empty' };
      }
      const r = await injectImage(blobs[i], name, how);
      status = r.status;
      log(`page ${i + 1}/${blobs.length}`, name, `${blobs[i].size}B`, '->', r.how || 'nothing', r.status);

      if (r.status === 'failed') { how = r.how; break; }
      if (r.status !== 'ok') break;
      how = r.how;
      done++;
      if (how === 'clipboard') break;   // only one image fits on the clipboard
      if (i + 1 < blobs.length) await sleep(400);
    }
    return { how, done, status };
  }

  /* The actual dispatch happens in the page's own world (src/inject-main.js).
   * Everything here just ferries bytes across and waits for the verdict. If that
   * script is missing — an older Chrome without `world: "MAIN"` support — we
   * fall back to dispatching from here, which mostly works. */
  let mainWorldSeen = false;
  window.addEventListener('message', (e) => {
    if (e.source === window && e.data?.ns === 'scratchpad-main-ready') mainWorldSeen = true;
  });

  function askMainWorld(buffer, name, preferred) {
    return new Promise((resolve) => {
      const id = Math.random().toString(36).slice(2);
      const onMsg = (e) => {
        if (e.source !== window) return;
        const m = e.data;
        if (!m || m.ns !== 'scratchpad-inject-result' || m.id !== id) return;
        cleanup();
        resolve(m);
      };
      const timer = setTimeout(() => { cleanup(); resolve(null); }, 9000);
      const cleanup = () => { clearTimeout(timer); window.removeEventListener('message', onMsg); };
      window.addEventListener('message', onMsg);
      window.postMessage({
        ns: 'scratchpad-inject-request', id, buffer, name,
        preferred, selectors: site.composer,
      }, '*');
    });
  }

  async function injectImage(blob, name, preferred) {
    const buffer = await blob.arrayBuffer();
    const r = await askMainWorld(buffer, name, preferred);
    if (r) {
      if (r.fileName && r.fileName !== name) log('WARNING: file name mangled ->', r.fileName);
      return { how: r.how, status: r.status };
    }
    log('main-world script did not answer; falling back to isolated dispatch');
    return injectImageIsolated(blob, name, preferred);
  }

  async function injectImageIsolated(blob, name, preferred) {
    const file = new File([blob], name, { type: 'image/png', lastModified: Date.now() });
    const target = findComposer();
    const region = target ? composerRegion(target) : document.body;
    const order = preferred && preferred !== 'clipboard'
      ? [preferred] : ['fileinput', 'paste', 'drop'];

    for (const how of order) {
      const before = countThumbs(region);
      let dispatched = false;
      try { dispatched = await ISOLATED[how](file, target, region); } catch (e) { log(how, 'threw', e.message); }
      if (!dispatched) continue;
      const status = await watchAttachment(region, name, before);
      if (status !== 'none') return { how, status };
    }
    try { if (await tryClipboard(blob)) return { how: 'clipboard', status: 'ok' }; } catch (_) {}
    return { how: null, status: 'none' };
  }

  function countThumbs(region) {
    return region.querySelectorAll('img, canvas, [data-testid*="attachment" i]').length;
  }

  /* Counted, not just tested. A rejected chip from an earlier attempt stays in the
   * composer until the user dismisses it, so a plain `test()` reported every later
   * upload as failed — which stopped multi-page runs dead after page 1. Only a
   * NEW occurrence is our failure. */
  const FAIL_RE = /upload failed|unable to upload|couldn.t upload|failed to upload/gi;
  const failCount = (region) => ((region.textContent || '').match(FAIL_RE) || []).length;

  function watchAttachment(region, name, before) {
    const failBefore = failCount(region);
    // Document-wide backstop: if the region is wrong, we would otherwise report
    // 'none' and the caller would dispatch the next strategy on top of an
    // attachment that did land.
    const docBefore = countThumbs(document.body);
    return new Promise((resolve) => {
      const t0 = Date.now();
      let appearedAt = 0;
      const tick = () => {
        const text = region.textContent || '';
        if (failCount(region) > failBefore) return resolve('failed');
        if (!appearedAt && (text.includes(name) || countThumbs(region) > before ||
                            countThumbs(document.body) > docBefore)) appearedAt = Date.now();
        if (appearedAt && Date.now() - appearedAt > 1200) return resolve('ok');
        if (!appearedAt && Date.now() - t0 > 2200) return resolve('none');
        setTimeout(tick, 120);
      };
      setTimeout(tick, 120);
    });
  }

  function dataTransferFor(file) {
    const dt = new DataTransfer();
    dt.items.add(file);
    return dt;
  }

  const ISOLATED = {
    fileinput(file, target, region) {
      const input = [...document.querySelectorAll('input[type="file"]')]
        .find((i) => !i.disabled && !i.capture && (!i.accept || /image|\*/i.test(i.accept)));
      if (!input) return false;
      input.files = dataTransferFor(file).files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    paste(file, target) {
      if (!target) return false;
      target.focus();
      target.dispatchEvent(new ClipboardEvent('paste', {
        bubbles: true, cancelable: true, clipboardData: dataTransferFor(file),
      }));
      return true;
    },
    drop(file, target, region) {
      const el = region || target;
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const base = { bubbles: true, cancelable: true, dataTransfer: dataTransferFor(file),
                     clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
      for (const t of ['dragenter', 'dragover', 'drop']) el.dispatchEvent(new DragEvent(t, base));
      return true;
    },
  };

  /* Always-works fallback: put it on the real clipboard and let the user paste. */
  async function tryClipboard(blob) {
    window.focus();
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  }

  // ---------------------------------------------------------------- toast

  let toastEl = null, toastTimer = null;
  function toast(text) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.style.cssText = [
        'all:initial', 'position:fixed', 'left:50%', 'bottom:92px',
        'transform:translateX(-50%) translateY(6px)', 'z-index:2147483647',
        'font:500 13px/1.4 ui-sans-serif,-apple-system,system-ui,sans-serif',
        'padding:9px 13px', 'border-radius:8px', 'pointer-events:none',
        'background:#18181b', 'color:#fafafa', 'border:1px solid #3f3f46',
        'box-shadow:0 8px 24px -6px rgba(0,0,0,.4)',
        'opacity:0', 'transition:opacity .15s ease, transform .15s ease',
      ].join(';');
      document.documentElement.appendChild(toastEl);
    }
    toastEl.textContent = text;
    requestAnimationFrame(() => {
      toastEl.style.opacity = '1';
      toastEl.style.transform = 'translateX(-50%) translateY(0)';
    });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.style.opacity = '0';
      toastEl.style.transform = 'translateX(-50%) translateY(6px)';
    }, 3200);
  }
})();
