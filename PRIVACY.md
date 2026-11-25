# FRAME privacy policy

FRAME doesn't collect, transmit, sell or share any data. There's nothing to opt out of.

## What FRAME does with your screenshots

- Captures are made by your browser on your computer.
- To get a capture from the extension's background worker to the result tab, FRAME briefly stores it in the extension's own local IndexedDB. It's deleted when you close that result tab; anything left behind (for example after a crash) is deleted after 24 hours.
- Screenshots go where you put them: your clipboard, or a file you save. FRAME never uploads them.

## What FRAME stores

- **Settings** (capture mode, capture delay, format, quality, save behavior, filename template, metadata on/off) in Chrome's extension storage. If you use Chrome Sync, Chrome syncs these like any extension setting.
- **A summary of the last capture** (mode, image size, number of screens, timing, any error code) to help with bug reports. It contains no URL, title or image.

## Network

FRAME makes no network requests. No analytics, telemetry, crash reporting, ads, remote fonts, CDNs or remote code. The only web addresses in FRAME are links on its settings page (to this GitHub repository and Cyberdyne Network), which open only if you click them.

## Capture metadata

Off by default. If you turn it on, the page URL, page title and capture time are written as text inside the image files you save (not drawn on the image). Anyone you send that file to can read them.

## Diagnostic info

"Copy diagnostic info" copies FRAME's version, your browser and OS versions, screen size, FRAME's settings, and the last-capture summary to your clipboard. It never includes URLs, page titles, page content or history. Nothing is sent anywhere; you decide whether to paste it into a bug report.

## Permissions

- `activeTab`: access to the tab you invoke FRAME on, only when you invoke it.
- `scripting`: runs FRAME's measuring script or selection overlay in that tab.
- `storage`: saves your settings.

## Contact

Open an issue at https://github.com/revpixel/frame/issues.
