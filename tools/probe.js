/* Paste into the DevTools console on claude.ai, chatgpt.com or gemini.google.com
 * while signed in, with an empty composer. Reports which injection strategy the
 * site honours. Attaches a small red test square — delete it afterwards.
 *
 * Caveat: this runs in the page's main world, the extension runs in an isolated
 * world. A pass here is necessary but not quite sufficient; a FAIL here is
 * conclusive. */
(async () => {
  const SEL = ['div.ProseMirror[contenteditable="true"]', '#prompt-textarea',
               'rich-textarea div[contenteditable="true"]', 'div.ql-editor[contenteditable="true"]',
               'div[contenteditable="true"]', 'textarea'];
  const composer = SEL.map((s) => document.querySelector(s)).find((e) => e && e.getBoundingClientRect().width > 120);
  if (!composer) return console.error('PROBE: no composer found — selectors need updating');
  const region = composer.closest('form') || composer.parentElement?.parentElement?.parentElement || composer;
  console.log('PROBE: composer =', composer, '\nPROBE: region =', region);

  const cv = Object.assign(document.createElement('canvas'), { width: 240, height: 160 });
  const c = cv.getContext('2d');
  c.fillStyle = '#fff'; c.fillRect(0, 0, 240, 160);
  c.fillStyle = '#dc2626'; c.fillRect(40, 40, 160, 80);
  const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
  const file = new File([blob], 'probe.png', { type: 'image/png' });
  const dt = () => { const d = new DataTransfer(); d.items.add(file); return d; };

  const count = () => region.querySelectorAll('img, canvas, [data-testid*="attachment" i]').length;
  const settled = (before) => new Promise((res) => {
    const t0 = Date.now();
    (function tick() {
      if (count() > before) return res(true);
      if (Date.now() - t0 > 1800) return res(false);
      setTimeout(tick, 120);
    })();
  });

  const strategies = {
    fileinput() {
      const i = [...region.querySelectorAll('input[type="file"]'), ...document.querySelectorAll('input[type="file"]')]
        .find((i) => !i.disabled && (!i.accept || /image|\*/i.test(i.accept)));
      if (!i) return console.warn('PROBE:   no file input in reach'), false;
      i.files = dt().files;
      i.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    paste() {
      composer.focus();
      composer.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt() }));
      return true;
    },
    drop() {
      const r = region.getBoundingClientRect();
      const base = { bubbles: true, cancelable: true, dataTransfer: dt(),
                     clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
      for (const t of ['dragenter', 'dragover', 'drop']) region.dispatchEvent(new DragEvent(t, base));
      return true;
    },
  };

  for (const [name, fn] of Object.entries(strategies)) {
    const before = count();
    console.log(`PROBE: trying ${name}...`);
    let ok = false;
    try { ok = fn(); } catch (e) { console.warn('PROBE:   threw', e.message); }
    if (ok && await settled(before)) return console.log(`%cPROBE: ${name} WORKS on ${location.hostname}`, 'color:#16a34a;font-weight:bold');
    console.log(`PROBE:   ${name} did not attach`);
  }
  console.log('%cPROBE: all three failed — clipboard fallback would be used', 'color:#dc2626;font-weight:bold');
})();
