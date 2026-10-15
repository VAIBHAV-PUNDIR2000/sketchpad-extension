# Chrome Web Store submission

Everything needed for the form. Nothing here puts a third-party brand in the
**name**, **icon** or **screenshots** — store policy treats that as implying
affiliation, and it is a common rejection reason. Brand names appear only as
plain-language compatibility statements in the description body.

---

## Name (45 char max)

```
Scratchpad for AI Chats
```

## Summary (132 char max)

```
Sketch a quick diagram next to the message box and attach it to your prompt. No screenshots, no switching apps.
```

## Category

`Productivity`

## Language

`English (United States)`

## Description

```
Some ideas are faster to drawn than typed.

Scratchpad puts a Sketch button next to the message box. Click it, rough out
your idea — boxes, arrows, labels, icons — and press Enter. The drawing is
attached to your prompt as an image, ready to send.

Works with Claude, ChatGPT and Gemini.

WHAT YOU GET

• Box, ellipse, line, arrow, pen, text and eraser
• 51 built-in icons — database, cloud, server, queue, cache, api, lock and more,
  searchable, with the common ones on top
• Pinch to zoom, two-finger scroll to pan — zoom anchors where you point
• Multiple pages, attached as separate images
• Three page sizes: standard, wide and tall
• Hold Shift to snap to squares, circles and 45° angles
• Full undo and redo, kept per page
• Single-key shortcuts: V P R O L A T E I
• Alt+S to open the pad from anywhere on the page
• Matches the light or dark theme of the page you're on

BUILT FOR TRACKPADS TOO

Freehand on a trackpad is painful, so the shape tools, the icon library and the
text tool do the heavy lifting. Most diagrams worth sending are boxes, arrows
and labels — you can build those without drawing a single wobbly line. Zooming
in makes a trackpad far more precise without costing any output quality. A
stylus or touchscreen works beautifully if you have one.

PRIVACY

Nothing leaves your browser. The sketch is drawn and converted to an image
locally, then handed to the page's own attachment control exactly as if you had
picked the file yourself. No analytics, no accounts, no servers, no network
requests of any kind. The extension runs only on the four sites it names and has
no access to any other page.

Not affiliated with Anthropic, OpenAI or Google.
```

## Assets

| Asset | Size | File |
|---|---|---|
| Icon | 128×128 | ✅ `icons/icon128.png` |
| Screenshot 1 — sketching a labelled system diagram | 1280×800 | ✅ `store/screenshots/1-sketch.png` |
| Screenshot 2 — the icon picker | 1280×800 | ✅ `store/screenshots/2-icons.png` |
| Screenshot 3 — the sketch attached to a prompt | 1280×800 | ✅ `store/screenshots/3-attached.png` |
| Small promo tile (optional) | 440×280 | ⬜ not required |

Screenshots were shot against a neutral, unbranded mock composer on purpose — no
third-party logo, wordmark or signed-in account name appears in any frame.

---

## Privacy practices form

**Single purpose**

```
Lets the user draw a sketch and attach it as an image to the message box of the
AI chat site they are currently on.
```

**Permission justifications**

| Field | Text |
|---|---|
| `storage` | Stores the user's selected pen colour and stroke width locally so the pad opens with their last settings. No other data is stored. |
| Host access — claude.ai, chatgpt.com, chat.openai.com, gemini.google.com | The extension must run on these pages to position the Sketch button next to the message box and to hand the finished image to that page's own attachment control. These are the only sites it supports and the only sites it can access. |
| Remote code | Not used. All code is contained in the extension package. |

**Data usage disclosure** — tick nothing, then certify all three:

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL** — required, because the item requests host access. Publish
`PRIVACY.md` somewhere public and paste the URL. A GitHub repo file, GitHub Pages
site or a public Gist all qualify.

---

## Submission checklist

- [x] `./tools/package.sh` → `dist/scratchpad-1.0.0.zip` (36KB)
- [x] Verified live on ChatGPT, Claude and Gemini, signed in
- [x] Screenshots produced at 1280×800
- [x] No remote code, no analytics, no network requests
- [ ] Register a Chrome Web Store developer account — one-time $5 USD, your Google account
- [ ] Publish `PRIVACY.md` at a public URL
- [ ] Upload the zip, paste the copy above, attach the three screenshots
- [ ] Fill the privacy practices form with the justifications above
- [ ] Submit — expect a few business days; longer for a brand-new developer account
