# FRAME privacy policy

_Last updated: 25 November 2026_

FRAME works entirely on your device. It never sends your data to the developer or to anyone else. There are no FRAME servers, accounts, analytics or uploads, so nothing you capture can reach the developer. FRAME doesn't sell, share or transfer user data, and doesn't use it for anything except taking and editing the screenshot you asked for.

## What FRAME handles, and where it stays

To take a screenshot, FRAME has to work with some of your data. All of it stays on your device.

| Data | Why FRAME uses it | Where it's kept | How long |
|---|---|---|---|
| **Website content**: the screenshot of the page you chose to capture | That's what FRAME is for. It captures, then crops, redacts or annotates what you asked it to. | In memory, and briefly in the extension's own local database (IndexedDB) so the result tab can open it | Deleted when you close the result tab. Anything left behind (for example after a crash) is deleted by FRAME's next capture once it's over 24 hours old, or when FRAME is removed. |
| **The page's URL and title** | To build the filename (for example `github.com_2026-11-25_09-41-03.png`), and to write into the file if you turn on capture metadata | Alongside the capture above | Same as the capture |
| **Your settings** (capture mode, delay, format, quality, save behavior, filename template, metadata on/off) | So FRAME remembers your choices | Chrome's extension storage on your device. If you've turned on Chrome Sync, Chrome syncs it to your own Google account like any extension setting. The developer can't see it. | Until you change it or remove FRAME |
| **A summary of the last capture** (mode, image size, number of screens, timing, any error code) | So "Copy diagnostic info" can help with a bug report | Chrome's extension storage on your device. It contains no URL, title or image. | Replaced by the next capture; removed with FRAME |

FRAME only touches a page when **you** start a capture on it (by clicking FRAME or using its keyboard shortcut). It doesn't run on pages in the background, doesn't read text from the page, and doesn't keep a history of the pages you've captured.

While you select an area, FRAME follows your mouse and listens for Enter and Esc, only to draw the selection. Nothing is recorded.

## Where your screenshots go

Screenshots go only where you put them:

- **Copy** puts the image on your clipboard.
- **Save** writes a file to your Downloads folder, or to a folder you choose.

What happens after that is up to you. FRAME never uploads or shares anything.

## Network

FRAME makes no network requests. It has no analytics, telemetry, crash reporting, ads, remote fonts, CDNs or remote code. The only web addresses in FRAME are links on its settings page (to its GitHub repository and Cyberdyne Network), and they open only if you click them.

## Capture metadata

This is off by default. If you turn it on, the page URL, page title and capture time are written as text inside the image files you save (not drawn on the image). Anyone you send that file to can read them. With it off, files contain only the image.

## Diagnostic info and bug reports

"Copy diagnostic info" copies these to your clipboard: FRAME's version, your browser and OS versions, screen size, FRAME's settings, and the last-capture summary. It never includes URLs, page titles, page content or history. Nothing is sent anywhere; you decide whether to paste it.

Bug reports and feature requests happen on GitHub, and you write them yourself. Anything you post there is public. Please redact sensitive information in any screenshot you attach.

## Permissions

- `activeTab`: lets FRAME access the tab you invoke it on, only when you invoke it, and only until that tab navigates.
- `scripting`: runs FRAME's own bundled scripts in that tab. These measure and scroll the page for a full-page capture, show the Select Area overlay, and show the delay countdown.
- `storage`: saves your settings and the last-capture summary.

## Removing your data

- Closing a result tab deletes that capture.
- Removing FRAME from Chrome deletes everything it stored.

## Chrome Web Store User Data Policy

FRAME's use of information complies with the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq), including the Limited Use requirements.

## Changes

Any change to this policy is made in this file. Its full history is public in [the repository](https://github.com/revpixel/frame/commits/main/PRIVACY.md).

## Contact

Open an issue at https://github.com/revpixel/frame/issues.
