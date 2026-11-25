// Shared end-to-end harness: serves the fixtures, loads a test copy of FRAME
// into Chrome for Testing, and offers helpers for driving captures and reading
// pixels back out of the result viewer.
//
// Captures normally need a user click (activeTab). Tests can't click the
// toolbar, so the test copy of the extension (never the shipped one) gets
// <all_urls> instead.
import { createServer } from "node:http";
import { readFile, cp, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, extname } from "node:path";
import { launch } from "../tools/browser.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const fixtures = join(root, "tests", "fixtures");

// Live bindings: set by setup(), read by the test files.
export let server, base, browser, worker, controller, extId;
let extDir;

// Same formula as fixtures/bands.js
export const bandColor = (i) => [((i * 37) % 200) + 20, ((i * 91) % 200) + 20, ((i * 53) % 120) + 100];
export const near = (a, b, tol = 8) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
export const hex = (h) => [0, 2, 4].map((i) => parseInt(h.replace("#", "").slice(i, i + 2), 16));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function setup() {
	server = createServer(async (req, res) => {
		const url = new URL(req.url, "http://x");
		if (url.pathname === "/img") {
			await sleep(Number(url.searchParams.get("delay") || 0));
			res.writeHead(200, { "content-type": "image/svg+xml" });
			return res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#${url.searchParams.get("c")}"/></svg>`);
		}
		try {
			const body = await readFile(join(fixtures, url.pathname.replace(/^\/+/, "")));
			res.writeHead(200, { "content-type": extname(url.pathname) === ".js" ? "text/javascript" : "text/html" });
			res.end(body);
		} catch {
			res.writeHead(404).end();
		}
	});
	await new Promise((r) => server.listen(0, "127.0.0.1", r));
	base = `http://127.0.0.1:${server.address().port}`;

	extDir = join(root, "tests", ".out", `ext-${process.pid}`);
	await rm(extDir, { recursive: true, force: true });
	await cp(join(root, "src"), extDir, { recursive: true });
	const manifest = JSON.parse(await readFile(join(extDir, "manifest.json"), "utf8"));
	manifest.host_permissions = ["<all_urls>"]; // captureVisibleTab needs <all_urls> without a click
	await writeFile(join(extDir, "manifest.json"), JSON.stringify(manifest, null, 2));

	browser = await launch({ enableExtensions: [extDir], args: ["--window-size=1000,800", `--force-device-scale-factor=${process.env.FRAME_DPR || 1}`] });
	const swTarget = await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().endsWith("/background.js"));
	extId = new URL(swTarget.url()).host;
	worker = await swTarget.worker();
	controller = await browser.newPage();
	await controller.goto(`chrome-extension://${extId}/options/options.html`);
}

export async function teardown() {
	await browser?.close();
	server?.close();
	if (extDir) await rm(extDir, { recursive: true, force: true }).catch(() => {});
}

/** Opens a fixture in its own focused window so it is the visible tab there. */
export async function openFixture(name) {
	const url = `${base}/${name}`;
	const { tabId } = await worker.evaluate(async (u) => {
		const w = await chrome.windows.create({ url: u, width: 1000, height: 800, focused: true });
		return { tabId: w.tabs[0].id };
	}, url);
	const target = await browser.waitForTarget((t) => t.url() === url);
	const page = await target.page();
	await page.waitForFunction(() => document.readyState === "complete");
	return { tabId, page };
}

export async function capture(tabId, mode) {
	await worker.evaluate(() => chrome.storage.local.remove("lastCapture"));
	return controller.evaluate((m, id) => chrome.runtime.sendMessage({ type: "frame:capture", mode: m, tabId: id }), mode, tabId);
}

export async function waitForResult() {
	// Fail fast if the worker recorded an error instead of opening a result.
	let stop = false;
	const failed = (async () => {
		while (!stop) {
			const { lastCapture } = await worker.evaluate(() => chrome.storage.local.get("lastCapture"));
			if (lastCapture?.error) throw new Error(`capture failed: ${lastCapture.error} ${lastCapture.message}`);
			await new Promise((r) => setTimeout(r, 500));
		}
	})();
	const target = await Promise.race([
		browser.waitForTarget((t) => t.url().includes("/result/result.html") && !t._seen, { timeout: 180_000 }),
		failed,
	]).finally(() => (stop = true));
	target._seen = true;
	const page = await target.page();
	await page.waitForFunction(() => document.getElementById("view").width > 0 && document.getElementById("info").textContent, { timeout: 60_000 });
	return page;
}

export const size = (page) => page.evaluate(() => ({ w: document.getElementById("view").width, h: document.getElementById("view").height }));
export const pixel = (page, x, y) =>
	page.evaluate((x, y) => [...document.getElementById("view").getContext("2d").getImageData(x, y, 1, 1).data.slice(0, 3)], Math.round(x), Math.round(y));

/** Rows (in output pixels) where column x matches a colour. */
export async function rowsMatching(page, x, rgb) {
	const col = await page.evaluate((x) => {
		const v = document.getElementById("view");
		return [...v.getContext("2d").getImageData(x, 0, 1, v.height).data];
	}, x);
	const rows = [];
	for (let y = 0; y * 4 < col.length; y++) if (near([col[y * 4], col[y * 4 + 1], col[y * 4 + 2]], rgb, 10)) rows.push(y);
	return rows;
}

export async function closeTabs(...pages) {
	for (const p of pages) await p.close().catch(() => {});
}
