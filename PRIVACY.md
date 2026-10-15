# Privacy Policy — Scratchpad for AI Chats

_Last updated: 15 October 2026_

**This extension collects nothing.**

Everything it does happens inside your browser:

- Your sketch is drawn on a `<canvas>` and converted to a PNG in memory.
- That PNG is handed to the attachment control of the page you are already on —
  claude.ai, chatgpt.com or gemini.google.com — exactly as if you had chosen the
  file yourself. Where it goes from there is governed by that service's own
  privacy policy.
- Nothing is sent anywhere else. The extension contains no analytics, no error
  reporting, no remote code, and makes no network requests of its own.
- No account is required and none is created.

## Stored data

The extension uses Chrome's local `storage` permission for exactly two values:
your selected pen colour and stroke width. These stay on your device, are never
transmitted, and are removed when you uninstall the extension.

Sketches themselves are never stored. Closing the pad without attaching discards
them, and attaching clears the pad.

## Permissions

| Permission | Why |
|---|---|
| `storage` | Remember your pen colour and stroke width between sessions |
| Access to claude.ai, chatgpt.com, chat.openai.com, gemini.google.com | Show the Sketch button next to the message box on those sites and hand the finished PNG to that page's attachment control |

Access is limited to those four origins. The extension does not run on, read, or
have any access to any other website.

## Contact

Open an issue on the project repository.
