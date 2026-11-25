// Renders FRAME's UI for visual review (and README screenshots) into tests/.out/shots.
import { launch } from "./browser.mjs";
import { createServer } from "node:http";
import { readFile, cp, rm, writeFile } from "node:fs/promises";

const out = "tests/.out/shots";
const server = createServer(async (req, res) => { try { res.end(await readFile("tests/fixtures" + req.url.split("?")[0])); } catch { res.writeHead(404).end(); } });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
await rm("tests/.out/ext", { recursive: true, force: true });
await cp("src", "tests/.out/ext", { recursive: true });
const m = JSON.parse(await readFile("tests/.out/ext/manifest.json", "utf8"));
m.host_permissions = ["<all_urls>"];
await writeFile("tests/.out/ext/manifest.json", JSON.stringify(m));

const browser = await launch({ enableExtensions: [process.cwd() + "/tests/.out/ext"], args: ["--window-size=1280,860"] });
const sw = await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().endsWith("/background.js"));
const worker = await sw.worker();
const id = new URL(sw.url()).host;
const ext = (p) => `chrome-extension://${id}/${p}`;

for (const scheme of ["dark", "light"]) {
	const p = await browser.newPage();
	await p.emulateMediaFeatures([{ name: "prefers-color-scheme", value: scheme }]);
	await p.setViewport({ width: 300, height: 330, deviceScaleFactor: 2 });
	await p.goto(ext("popup/popup.html"));
	await new Promise((r) => setTimeout(r, 300));
	await p.screenshot({ path: `${out}/popup-${scheme}.png`, fullPage: true });
	await p.setViewport({ width: 900, height: 1000, deviceScaleFactor: 1 });
	await p.goto(ext("options/options.html"));
	await new Promise((r) => setTimeout(r, 300));
	await p.screenshot({ path: `${out}/options-${scheme}.png`, fullPage: true });
	await p.close();
}

const ctl = await browser.newPage();
await ctl.goto(ext("options/options.html"));
const { tabId } = await worker.evaluate(async (u) => { const w = await chrome.windows.create({ url: u, width: 1280, height: 860, focused: true }); return { tabId: w.tabs[0].id }; }, `${base}/long.html`);
const fixture = await (await browser.waitForTarget((t) => t.url().endsWith("long.html"))).page();
await fixture.waitForFunction(() => document.readyState === "complete");
await ctl.evaluate((t) => chrome.runtime.sendMessage({ type: "frame:capture", mode: "area", tabId: t }), tabId);
await fixture.waitForSelector("frame-select");
await fixture.mouse.move(300, 200); await fixture.mouse.down(); await fixture.mouse.move(800, 500, { steps: 5 }); await fixture.mouse.up();
const shot = await worker.evaluate(async (t) => chrome.tabs.captureVisibleTab((await chrome.tabs.get(t)).windowId, { format: "png" }), tabId);
await writeFile(`${out}/area-overlay.png`, Buffer.from(shot.split(",")[1], "base64"));
await fixture.keyboard.press("Escape");

await ctl.evaluate((t) => chrome.runtime.sendMessage({ type: "frame:capture", mode: "full", tabId: t }), tabId);
const rt = await browser.waitForTarget((t) => t.url().includes("result.html"), { timeout: 120000 });
const result = await rt.page();
await result.waitForFunction(() => document.getElementById("view").width > 0);
await result.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
await new Promise((r) => setTimeout(r, 300));
const shotR = async (name) => writeFile(`${out}/${name}.png`, Buffer.from((await worker.evaluate(async (t) => chrome.tabs.captureVisibleTab((await chrome.tabs.get(t)).windowId, { format: "png" }), tabId)).split(",")[1], "base64"));
await shotR("result");
await result.click("#redact");
const b = await result.$eval("#overlay", (o) => { const r = o.getBoundingClientRect(); return [r.left, r.top, r.width]; });
await result.mouse.move(b[0] + b[2] * 0.2, b[1] + 80); await result.mouse.down(); await result.mouse.move(b[0] + b[2] * 0.6, b[1] + 160, { steps: 4 }); await result.mouse.up();
await shotR("result-redact");
await browser.close();
server.close();
console.log("done");
