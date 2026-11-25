// FRAME service worker. Runs captures, stitches tiles and opens the result page.
// Everything happens on this machine: there are no network requests anywhere in FRAME.

import { getSettings, setSettings, MODES } from "./lib/settings.js";
import { putCapture, deleteCapture, sweepOld } from "./lib/store.js";

const CAPTURE_INTERVAL = 550; // Chrome allows ~2 captureVisibleTab calls per second
const MAX_TILES = 120;
const MAX_CSS_HEIGHT = 150_000;
const MAX_PART_SIDE = 32_000; // Chrome canvas limit is 32,767 per side
const MAX_PART_AREA = 100_000_000; // stay well under Chrome's ~268M pixel canvas limit

let busy = false;
let lastCaptureAt = 0;

class CaptureError extends Error {
	constructor(code, message) {
		super(message);
		this.code = code;
	}
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- entry points ----------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
	if (msg?.type === "frame:capture") {
		chrome.tabs.get(msg.tabId).then(
			(tab) => runCapture(tab, msg.mode, sendResponse),
			() => sendResponse({ ok: false, code: "no-tab", message: "FRAME couldn't find the current tab." }),
		);
		return true;
	}
	if (msg?.type === "frame:area" && sender.tab) {
		finishArea(sender.tab, msg.rect, msg.viewport);
		return false;
	}
	if (msg?.type === "frame:area-cancel") {
		busy = false;
		return false;
	}
	return false;
});

chrome.commands.onCommand.addListener((command, tab) => {
	const mode = { "capture-full": "full", "capture-area": "area", "capture-visible": "visible" }[command];
	if (mode && tab) runCapture(tab, mode, null);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
	const key = `result:${tabId}`;
	const { [key]: id } = await chrome.storage.session.get(key);
	if (id) {
		await chrome.storage.session.remove(key);
		await deleteCapture(id).catch(() => {});
	}
});

// ---------- orchestration ----------

/**
 * @param {chrome.tabs.Tab} tab
 * @param {"full"|"area"|"visible"} mode
 * @param {((r: object) => void) | null} respond  popup callback; called once the capture has started
 */
async function runCapture(tab, mode, respond) {
	const reply = (r) => {
		if (respond) respond(r);
		respond = null;
	};
	if (!MODES.includes(mode)) return reply({ ok: false, code: "bad-mode", message: "Unknown capture mode." });
	// An open Select Area overlay doesn't block a new capture (the user may have abandoned it).
	if (busy === true) return reply({ ok: false, code: "busy", message: "A capture is already in progress." });
	busy = true;
	setSettings({ lastMode: mode }).catch(() => {});
	sweepOld().catch(() => {});

	const started = Date.now();
	const diag = { mode, at: new Date(started).toISOString() };
	try {
		if (mode === "visible") {
			reply({ ok: true });
			const shot = await captureTab(tab.windowId);
			const blob = dataUrlToBlob(shot);
			const bmp = await createImageBitmap(blob);
			Object.assign(diag, { tiles: 1, size: `${bmp.width}x${bmp.height}` });
			bmp.close();
			await openResult(tab, mode, [blob], []);
		} else if (mode === "area") {
			await inject(tab.id, "lib/select-area.js");
			reply({ ok: true });
			busy = "area"; // released when the overlay reports back
			return;
		} else {
			await inject(tab.id, "lib/capture-page.js");
			reply({ ok: true });
			Object.assign(diag, await captureFullPage(tab));
		}
		diag.ms = Date.now() - started;
	} catch (err) {
		diag.error = err.code || "error";
		diag.message = String(err.message || err).slice(0, 300);
		if (respond) reply({ ok: false, code: diag.error, message: friendly(err) });
		else flagError(tab.id, friendly(err));
	} finally {
		if (busy !== "area") busy = false;
		chrome.storage.local.set({ lastCapture: diag }).catch(() => {});
	}
}

async function finishArea(tab, rect, viewport) {
	const diag = { mode: "area", at: new Date().toISOString() };
	try {
		const shot = await captureTab(tab.windowId);
		const bmp = await createImageBitmap(dataUrlToBlob(shot));
		const scale = bmp.width / viewport.w;
		const sx = Math.round(rect.x * scale);
		const sy = Math.round(rect.y * scale);
		const sw = Math.max(1, Math.min(bmp.width - sx, Math.round(rect.w * scale)));
		const sh = Math.max(1, Math.min(bmp.height - sy, Math.round(rect.h * scale)));
		const canvas = new OffscreenCanvas(sw, sh);
		canvas.getContext("2d").drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
		bmp.close();
		const blob = await canvas.convertToBlob({ type: "image/png" });
		Object.assign(diag, { tiles: 1, scale: round(scale), size: `${sw}x${sh}` });
		await openResult(tab, "area", [blob], []);
	} catch (err) {
		diag.error = err.code || "error";
		diag.message = String(err.message || err).slice(0, 300);
		flagError(tab.id, friendly(err));
	} finally {
		busy = false;
		chrome.storage.local.set({ lastCapture: diag }).catch(() => {});
	}
}

// ---------- full page ----------

async function captureFullPage(tab) {
	const page = (fn, ...args) => callPage(tab.id, fn, args);
	const diag = {};
	setBadge(tab.id, "…");
	try {
		const geo = await page("prepare");
		const step = Math.max(1, Math.floor(geo.step));
		let total = Math.ceil(geo.total);
		const notices = [];
		if (total > MAX_CSS_HEIGHT) {
			total = MAX_CSS_HEIGHT;
			notices.push(`This page is very long. FRAME captured the first ${MAX_CSS_HEIGHT.toLocaleString()} px.`);
		}

		// Scroll positions: one per viewport, the last one flush with the bottom.
		const positions = [];
		for (let y = 0; y < total - step; y += step) positions.push(y);
		positions.push(Math.max(0, total - step));
		if (positions.length > MAX_TILES) {
			positions.length = MAX_TILES;
			total = positions[MAX_TILES - 1] + step;
			notices.push(`This page is very long. FRAME captured the first ${total.toLocaleString()} px.`);
		}

		Object.assign(diag, {
			target: geo.target,
			viewport: `${geo.viewport.w}x${geo.viewport.h}`,
			dpr: geo.dpr,
			cssHeight: total,
			tiles: positions.length,
		});

		let stitch = null; // created after the first tile tells us the real scale
		for (let i = 0; i < positions.length; i++) {
			const phase = positions.length === 1 ? "only" : i === 0 ? "first" : i === positions.length - 1 ? "last" : "middle";
			const at = await page("scrollTo", positions[i], phase);
			// captureVisibleTab shoots whatever tab is showing; stop if the user switched away.
			const now = await chrome.tabs.get(tab.id).catch(() => null);
			if (!now?.active || now.windowId !== tab.windowId) throw new CaptureError("tab-hidden", "Tab was switched during capture.");
			const bmp = await createImageBitmap(dataUrlToBlob(await captureTab(tab.windowId)));
			if (!stitch) {
				const scale = bmp.width / geo.viewport.iw;
				stitch = new Stitcher(Math.round(at.region.w * scale), Math.round(total * scale), scale);
				diag.scale = round(scale);
			}
			await stitch.draw(bmp, at.region, at.y);
			bmp.close();
			setBadge(tab.id, `${Math.round(((i + 1) / positions.length) * 100)}%`);
		}
		const parts = await stitch.finish();
		diag.parts = parts.length;
		diag.size = `${stitch.width}x${stitch.height}`;
		if (parts.length > 1) notices.push(`This page is too tall for one image, so FRAME split it into ${parts.length} parts.`);
		await page("restore").catch(() => {});
		await openResult(tab, "full", parts, notices, stitch.heights);
		return diag;
	} catch (err) {
		await page("restore").catch(() => {});
		throw err;
	} finally {
		setBadge(tab.id, "");
	}
}

/** Draws tiles into one or more part canvases, encoding each part as soon as it is complete. */
class Stitcher {
	constructor(width, height, scale) {
		this.width = width;
		this.height = height;
		this.scale = scale;
		const partMax = Math.min(MAX_PART_SIDE, Math.floor(MAX_PART_AREA / Math.max(1, width)));
		this.ranges = [];
		for (let y = 0; y < height; y += partMax) this.ranges.push([y, Math.min(height, y + partMax)]);
		this.heights = this.ranges.map(([a, b]) => b - a);
		this.canvases = new Map();
		this.blobs = [];
		this.next = 0; // next part index still to be encoded
	}

	ctx(i) {
		let c = this.canvases.get(i);
		if (!c) {
			const [a, b] = this.ranges[i];
			c = new OffscreenCanvas(this.width, b - a);
			const g = c.getContext("2d");
			g.fillStyle = "#ffffff";
			g.fillRect(0, 0, c.width, c.height);
			this.canvases.set(i, c);
		}
		return c.getContext("2d");
	}

	async draw(bmp, region, scrollY) {
		const s = this.scale;
		const sx = Math.round(region.x * s);
		const sy = Math.round(region.y * s);
		const sw = Math.min(this.width, bmp.width - sx);
		const sh = Math.min(Math.round(region.h * s), bmp.height - sy);
		const dy = Math.round(scrollY * s);
		for (let i = this.next; i < this.ranges.length; i++) {
			const [a, b] = this.ranges[i];
			if (dy >= b) continue;
			if (dy + sh <= a) break;
			this.ctx(i).drawImage(bmp, sx, sy, sw, sh, 0, dy - a, sw, sh);
		}
		// Parts that end above this tile are finished.
		while (this.next < this.ranges.length && this.ranges[this.next][1] <= dy) await this.encode(this.next++);
	}

	async encode(i) {
		const c = this.canvases.get(i) || (this.ctx(i), this.canvases.get(i));
		this.blobs[i] = await c.convertToBlob({ type: "image/png" });
		this.canvases.delete(i);
	}

	async finish() {
		while (this.next < this.ranges.length) await this.encode(this.next++);
		return this.blobs;
	}
}

// ---------- helpers ----------

async function captureTab(windowId) {
	const wait = lastCaptureAt + CAPTURE_INTERVAL - Date.now();
	if (wait > 0) await sleep(wait);
	try {
		for (let attempt = 0; ; attempt++) {
			try {
				return await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
			} catch (err) {
				// Quota errors are transient; anything else is real.
				if (attempt < 3 && /MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND|quota/i.test(String(err?.message))) {
					await sleep(CAPTURE_INTERVAL);
					continue;
				}
				throw new CaptureError("capture-denied", String(err?.message || err));
			}
		}
	} finally {
		lastCaptureAt = Date.now();
	}
}

async function inject(tabId, file) {
	try {
		await chrome.scripting.executeScript({ target: { tabId }, files: [file] });
	} catch (err) {
		throw new CaptureError("restricted", String(err?.message || err));
	}
}

async function callPage(tabId, fn, args) {
	const [res] = await chrome.scripting.executeScript({
		target: { tabId },
		func: (name, a) => {
			if (!window.__frame) throw new Error("FRAME's page helper is missing (the page may have navigated).");
			return window.__frame[name](...a);
		},
		args: [fn, args],
	});
	if (!res) throw new CaptureError("page-gone", "The page didn't respond.");
	if (res.error) throw new CaptureError("page-error", String(res.error.message || res.error));
	return res.result;
}

async function openResult(tab, mode, parts, notices, heights) {
	const id = crypto.randomUUID();
	const settings = await getSettings();
	await putCapture({
		id,
		created: Date.now(),
		mode,
		parts,
		heights: heights || [],
		url: tab.url || "",
		title: tab.title || "",
		notices,
		metadata: settings.includeMetadata,
	});
	const resultTab = await chrome.tabs.create({
		url: chrome.runtime.getURL(`result/result.html?id=${id}`),
		index: tab.index + 1,
		openerTabId: tab.id,
	});
	await chrome.storage.session.set({ [`result:${resultTab.id}`]: id });
}

function dataUrlToBlob(dataUrl) {
	const [head, b64] = dataUrl.split(",");
	const type = head.match(/data:([^;]+)/)?.[1] || "image/png";
	const bin = atob(b64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return new Blob([bytes], { type });
}

function setBadge(tabId, text) {
	chrome.action.setBadgeBackgroundColor({ tabId, color: "#38bdf8" }).catch(() => {});
	chrome.action.setBadgeText({ tabId, text }).catch(() => {});
}

async function flagError(tabId, message) {
	await chrome.action.setBadgeBackgroundColor({ tabId, color: "#f87171" }).catch(() => {});
	await chrome.action.setBadgeText({ tabId, text: "!" }).catch(() => {});
	await chrome.action.setTitle({ tabId, title: `FRAME: ${message}` }).catch(() => {});
	setTimeout(() => {
		chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
		chrome.action.setTitle({ tabId, title: "FRAME" }).catch(() => {});
	}, 6000);
}

function friendly(err) {
	switch (err?.code) {
		case "restricted":
			return "Chrome doesn't allow extensions to run on this page.";
		case "capture-denied":
			return "Chrome blocked the capture on this page.";
		case "tab-hidden":
			return "The tab was switched during the capture. Stay on the page until FRAME finishes.";
		case "page-gone":
		case "page-error":
			return "The page changed during the capture. Try again.";
		default:
			return "Something went wrong. Try again, or report a bug from FRAME's settings.";
	}
}

const round = (n) => Math.round(n * 1000) / 1000;
