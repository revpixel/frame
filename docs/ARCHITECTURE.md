# FRAME architecture

FRAME is a Manifest V3 extension written in plain HTML, CSS and JavaScript (ES modules). There is no build step, no framework and no runtime dependency: the `src/` folder is the extension, byte for byte.

## File structure

```
src/
  manifest.json
  background.js          service worker: runs captures, stitches tiles, opens the result page
  lib/
    capture-page.js      injected into the page: measures, scrolls, hides fixed UI, restores
    select-area.js       injected into the page: the Select Area overlay
    store.js             IndexedDB hand-off of captures between worker and result page
    settings.js          defaults + chrome.storage.sync wrapper
    filename.js          filename template + OS-safe sanitising
    metadata.js          optional PNG / JPEG / WebP text metadata
    diagnostics.js       "Copy diagnostic info" text
  popup/                 three buttons, nothing else
  result/                viewer: copy, save, crop, redact
  options/               settings + About / Help
  fonts/                 Space Grotesk + JetBrains Mono (OFL, bundled)
  icons/                 PNG icons
tests/                   Puppeteer harness + fixture pages (dev only, not shipped)
```

### Data flow

1. Popup (or a keyboard shortcut) sends `{ mode }` to the service worker.
2. The worker injects `lib/capture-page.js` into the active tab, which prepares the page and answers questions ("scroll to y", "how big are you").
3. The worker calls `chrome.tabs.captureVisibleTab` for each viewport, draws each tile straight into an `OffscreenCanvas` (so tiles are never all held in memory), and encodes PNG blobs.
4. Blobs go into IndexedDB (extension-origin, local only). The worker opens `result/result.html?id=…`.
5. The result page reads the blob, edits happen on a canvas, and saving / copying use browser APIs on that page. The stored capture is deleted when the result tab closes (and anything older than 24 hours is swept on every new capture).

Nothing leaves the machine. There is no `fetch`, no remote URL in any page, and the default MV3 content-security policy blocks remote code.

## Permissions

| Permission | Why |
|---|---|
| `activeTab` | Grants access to the tab *you* clicked FRAME on (or used a shortcut on), and only that tab, until it navigates. This is what allows `captureVisibleTab` and script injection without asking for "read and change all your data on all websites". |
| `scripting` | Injects the measuring/scrolling script and the Select Area overlay into that active tab. |
| `storage` | Saves your settings and the last-capture diagnostic summary. |

That is the whole list. Deliberately **not** requested:

- No host permissions (`<all_urls>`): `activeTab` covers the clicked tab.
- No `downloads`: saving uses a normal `<a download>` link ("Save to Downloads") or the browser's own Save dialog via `showSaveFilePicker` ("Ask where to save", which remembers the last folder, so a synced OneDrive/Drive/Dropbox folder works fine).
- No `clipboardWrite`: `navigator.clipboard.write` works from the focused result page on a click.
- No `tabs`: `activeTab` exposes the URL and title of the clicked tab, which is all the filename template needs.

## Full-page capture: the hard cases

| Case | Handling |
|---|---|
| **Rate limit** | Chrome allows ~2 `captureVisibleTab` calls per second. Calls are spaced ≥ 550 ms apart. |
| **Device pixel ratio / zoom** | The scale is measured from the first captured tile (`tile.width / innerWidth`), not assumed from `devicePixelRatio`, so page zoom and HiDPI both stitch correctly. |
| **Lazy-loaded content** | `loading="lazy"` images are switched to eager, then a fast pre-scroll pass walks the page to trigger scroll-based loaders, then the page is re-measured. Each tile waits for the frame to settle and for in-view images to finish (with a timeout). |
| **Fixed / sticky UI** | `position: sticky` elements are pinned to their natural position (`position: relative`) for the whole capture, so they appear once, where they live in the document. `position: fixed` elements stay for the first tile and are hidden (`visibility: hidden`) for later tiles, so headers appear once at the top and don't repeat. The page is re-scanned after each scroll, catching headers that turn fixed on scroll. All styles are restored afterwards. |
| **Smooth scrolling** | `scroll-behavior: auto` is forced and scrolls use `behavior: "instant"`. The *actual* scroll position is read back after each scroll and the tile is placed there, so clamped or snapped scrolling can't misplace a tile. |
| **Scrollbars** | Hidden during capture so they don't stripe the image. |
| **Inner scroll containers** | If the document itself doesn't scroll, FRAME looks for the largest visible scrollable element (≥ 25% of the viewport). It scrolls that element and stitches only its on-screen rectangle, producing the full contents of that panel. |
| **Last tile overlap** | The final scroll position is clamped by the browser; drawing at the real position overlaps the previous tile correctly instead of duplicating content. |
| **Canvas limits** | Chrome canvases top out at 32,767 px per side and ~268 M pixels. FRAME splits output into parts no taller than `min(32,000, 100M / width)` device pixels. Each part is a separate image in the viewer, saved as `…-part1`, `…-part2`. |
| **Infinite scroll / absurd pages** | Height is fixed after the pre-scroll measurement. Captures stop at 120 tiles or 150,000 CSS px and the viewer says the page was truncated, rather than running forever. |
| **Restricted pages** | `chrome://`, the Chrome Web Store, other extensions and similar pages refuse script injection. FRAME reports that clearly and offers a Visible capture instead (which works on some of them, e.g. the PDF viewer). |
| **Switching tabs mid-capture** | `captureVisibleTab` shoots whatever tab is showing, so the worker checks the tab is still visible before every tile and stops with a clear error if not. Frame waits fall back to timers because `requestAnimationFrame` pauses in background tabs. |
| **Restoring the page** | Original scroll position, inline styles and `loading` attributes are restored in a `finally`, including when a capture fails. |

## v1 scope

**In v1:** Full Page, Select Area, Visible; result viewer with copy, PNG/JPEG/WebP, crop, redact (solid or pixelate), undo; filename templates; optional embedded metadata (PNG text chunks, JPEG comment, WebP XMP); settings; About/Help with GitHub links; diagnostic info; keyboard shortcuts.

**Deferred (deliberately):**

- Select Area larger than the viewport (scroll-while-selecting). v1 selects within the visible viewport; use Full Page + Crop for taller regions.
- Capturing cross-origin iframes' own inner scroll, and nested scroll containers beyond the single primary one.
- PDF export.
- Capturing multiple tabs at once.
- Firefox / Safari ports.
