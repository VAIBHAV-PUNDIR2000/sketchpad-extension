/* Runs in the page's MAIN world (see manifest `world: "MAIN"`).
 *
 * Why this file exists: File, FileList and DataTransfer are host objects. Built
 * in the content script's isolated world and handed to the page's handlers, they
 * can arrive without their properties intact — ChatGPT ended up creating an
 * upload record named `undefined`, which it then rejected. Constructing them
 * here means every object the site touches is native to its own world.
 *
 * The isolated side sends raw bytes (an ArrayBuffer marshals fine — it is data,
 * not a host object) and gets back {how, status}. */
(() => {
  'use strict';
  const REQ = 'scratchpad-inject-request';
  const RES = 'scratchpad-inject-result';

  function findComposer(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.getBoundingClientRect().width > 120) return el;
    }
    const cands = [...document.querySelectorAll('div[contenteditable="true"], textarea')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 180 && r.height > 20 && r.bottom > window.innerHeight * 0.4;
      });
    return cands.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0] || null;
  }

  /* The smallest ancestor of the composer that also holds a file input. That is
   * the attachment UI's container by definition, so it is where chips appear.
   * A fixed "three parents up" worked on ChatGPT (a <form>) but not on Claude,
   * which has no form and renders chips six levels up — detection never fired
   * and the cascade stacked a duplicate for every strategy it tried. */
  function composerRegion(c) {
    let el = c.parentElement;
    for (let i = 0; i < 12 && el && el !== document.body; i++, el = el.parentElement) {
      if (el.querySelector('input[type="file"]')) return el;
    }
    return c.closest('form') || c.parentElement?.parentElement?.parentElement || c;
  }

  const countThumbs = (region) =>
    region.querySelectorAll('img, canvas, [data-testid*="attachment" i]').length;

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

  const STRATEGIES = {
    /* Hand the file straight to the site's own <input type=file>. Ranked rather
     * than first-match: other extensions and site features add their own. */
    fileinput(file, composer, region) {
      const score = (i) => {
        if (i.disabled || i.capture) return -1;
        let n = 1;
        if (region.contains(i)) n += 10;
        if (/image\/(png|\*)/i.test(i.accept)) n += 5;
        else if (i.accept && !/image|\*/i.test(i.accept)) return -1;
        return n;
      };
      const input = [...document.querySelectorAll('input[type="file"]')]
        .map((i) => [score(i), i]).filter(([n]) => n > 0)
        .sort((a, b) => b[0] - a[0])[0]?.[1];
      if (!input) return false;
      input.files = dataTransferFor(file).files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },

    /* ProseMirror reads clipboardData.files directly and never checks isTrusted. */
    paste(file, composer) {
      if (!composer) return false;
      composer.focus();
      composer.dispatchEvent(new ClipboardEvent('paste', {
        bubbles: true, cancelable: true, clipboardData: dataTransferFor(file),
      }));
      return true;
    },

    drop(file, composer, region) {
      const el = region || composer;
      if (!el) return false;
      const dt = dataTransferFor(file);
      const r = el.getBoundingClientRect();
      const base = { bubbles: true, cancelable: true, dataTransfer: dt,
                     clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
      for (const t of ['dragenter', 'dragover', 'drop']) el.dispatchEvent(new DragEvent(t, base));
      return true;
    },
  };

  async function inject({ buffer, name, preferred, selectors }) {
    const blob = new Blob([buffer], { type: 'image/png' });
    if (!blob.size) return { how: null, status: 'empty', size: 0 };

    const file = new File([blob], name, { type: 'image/png', lastModified: Date.now() });
    const composer = findComposer(selectors);
    const region = composer ? composerRegion(composer) : document.body;

    const order = preferred && preferred !== 'clipboard'
      ? [preferred]
      : ['fileinput', 'paste', 'drop'];

    for (const how of order) {
      const before = countThumbs(region);
      let dispatched = false;
      try { dispatched = STRATEGIES[how](file, composer, region); } catch (_) { dispatched = false; }
      if (!dispatched) continue;
      const status = await watchAttachment(region, name, before);
      // Anything but 'none' means this reached the uploader; trying the next
      // strategy would only stack a duplicate chip.
      if (status !== 'none') return { how, status, size: blob.size, fileName: file.name };
    }
    return { how: null, status: 'none', size: blob.size, fileName: file.name };
  }

  window.addEventListener('message', async (e) => {
    if (e.source !== window) return;
    const m = e.data;
    if (m && m.ns === 'scratchpad-ping') {
      window.postMessage({ ns: 'scratchpad-main-ready' }, '*');
      return;
    }
    if (!m || m.ns !== REQ) return;
    let out;
    try { out = await inject(m); }
    catch (err) { out = { how: null, status: 'error', error: String(err && err.message) }; }
    window.postMessage({ ns: RES, id: m.id, ...out }, '*');
  });

  window.postMessage({ ns: 'scratchpad-main-ready' }, '*');
})();
