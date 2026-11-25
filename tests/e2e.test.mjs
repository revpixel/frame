// End-to-end tests: load FRAME into Chrome for Testing, capture fixture pages,
// and check the pixels of the result. Run with `npm test`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setup, teardown, worker, controller, openFixture, capture, waitForResult, size, pixel, rowsMatching, closeTabs, bandColor, near, hex } from "./harness.mjs";

before(setup);
after(teardown);

test("full page: stitches bands in order, fixed UI once, sticky once, page restored", async () => {
	const { tabId, page } = await openFixture("long.html");
	await page.evaluate(() => window.scrollTo({ top: 777, behavior: "instant" }));
	const vw = await page.evaluate(() => innerWidth);

	assert.deepEqual(await capture(tabId, "full"), { ok: true });
	const result = await waitForResult();
	const { w, h } = await size(result);
	const s = w / vw;
	const total = 10 * 250 + 50 + 30 * 250;
	assert.ok(Math.abs(h - Math.round(total * s)) <= 1, `height ${h} vs ${total * s}`);

	for (let i = 0; i < 40; i++) {
		const y = (i < 10 ? i * 250 : 2550 + (i - 10) * 250) + 125;
		assert.ok(near(await pixel(result, w / 2, y * s), bandColor(i)), `band ${i} at y=${y}`);
	}

	const magenta = await rowsMatching(result, 5, [255, 0, 255]);
	assert.ok(magenta.length > 0 && magenta.every((y) => y < 60 * s), `fixed header only at the top (${magenta.length} rows, max ${Math.max(...magenta)})`);
	const cyan = await rowsMatching(result, 5, [0, 255, 255]);
	assert.ok(cyan.length > 0 && cyan.every((y) => y >= h - 40 * s - 1), "fixed footer only at the bottom");
	const yellow = await rowsMatching(result, 5, [255, 255, 0]);
	assert.ok(Math.abs(yellow.length - 50 * s) <= 2 && yellow[0] >= 2500 * s - 1, `sticky bar once in place (${yellow.length} rows at ${yellow[0]})`);

	const after = await page.evaluate(() => ({
		y: scrollY,
		hdr: document.getElementById("hdr").getAttribute("style"),
		sticky: document.getElementById("sticky").getAttribute("style"),
		style: !!document.getElementById("__frame-capture-style"),
		helper: "__frame" in window,
	}));
	assert.deepEqual(after, { y: 777, hdr: null, sticky: null, style: false, helper: false });
	await closeTabs(result, page);
});

test("full page: inner scroll container is captured in full", async () => {
	const { tabId, page } = await openFixture("inner.html");
	const geo = await page.evaluate(() => ({ vw: innerWidth, cw: document.getElementById("scroller").clientWidth }));
	assert.deepEqual(await capture(tabId, "full"), { ok: true });
	const result = await waitForResult();
	const { w, h } = await size(result);
	const s = w / geo.cw;
	assert.ok(Math.abs(s - Math.round(s * 4) / 4) < 0.01, `sane scale ${s}`);
	assert.ok(Math.abs(h - 6000 * s) <= 1, `height ${h}`);
	for (let i = 0; i < 30; i++) assert.ok(near(await pixel(result, w / 2, (i * 200 + 100) * s), bandColor(i)), `band ${i}`);
	assert.equal((await rowsMatching(result, 5, [255, 0, 255])).length, 0, "page chrome outside the panel is not included");
	await closeTabs(result, page);
});

test("full page: lazy images and scroll-triggered content are loaded", async () => {
	const { tabId, page } = await openFixture("lazy.html");
	const vw = await page.evaluate(() => innerWidth);
	assert.deepEqual(await capture(tabId, "full"), { ok: true });
	const result = await waitForResult();
	const { w, h } = await size(result);
	const s = w / vw;
	assert.ok(Math.abs(h - 4800 * s) <= 1, `height ${h}`);
	const imgs = ["ff0000", "00ff00", "0000ff", "ff8800", "8800ff", "00ff88"];
	const ios = ["ff4040", "40ff40", "4040ff", "ffd040", "d040ff", "40ffd0"];
	for (let i = 0; i < 6; i++) assert.ok(near(await pixel(result, w / 2, (i * 400 + 200) * s), hex(imgs[i])), `lazy image ${i}`);
	for (let i = 0; i < 6; i++) assert.ok(near(await pixel(result, w / 2, (2400 + i * 400 + 200) * s), hex(ios[i])), `observer block ${i}`);
	await closeTabs(result, page);
});

test("full page: pages taller than a canvas are split into parts", async () => {
	const { tabId, page } = await openFixture("huge.html");
	const vw = await page.evaluate(() => innerWidth);
	assert.deepEqual(await capture(tabId, "full"), { ok: true });
	const result = await waitForResult();
	const nParts = await result.evaluate(() => document.querySelectorAll("#parts button").length);
	assert.ok(nParts >= 2, `parts: ${nParts}`);
	const first = await size(result);
	const s = first.w / vw;
	assert.ok(first.h <= 32_000);
	// Check a band in part 2 lines up with the global position.
	await result.click("#parts button:nth-child(2)");
	await result.waitForFunction(() => document.getElementById("info").textContent.includes("part 2/"));
	// Sample rows in part 2, away from band edges.
	for (const y of [50 * s, 1000 * s, 5000 * s]) {
		const globalY = (first.h + y) / s;
		if (globalY % 400 < 20 || globalY % 400 > 380) continue;
		assert.ok(near(await pixel(result, first.w / 2, y), bandColor(Math.floor(globalY / 400))), `part 2 continues where part 1 ended (y=${y})`);
	}
	await closeTabs(result, page);
});

test("visible: captures the viewport", async () => {
	const { tabId, page } = await openFixture("long.html");
	const vw = await page.evaluate(() => innerWidth);
	const vh = await page.evaluate(() => innerHeight);
	assert.deepEqual(await capture(tabId, "visible"), { ok: true });
	const result = await waitForResult();
	const { w, h } = await size(result);
	const s = w / vw;
	assert.ok(Math.abs(h - vh * s) <= 1, `${w}x${h} for viewport ${vw}x${vh}`);
	assert.ok(near(await pixel(result, w / 2, 100 * s), bandColor(0)));
	assert.ok(near(await pixel(result, 5, 10), [255, 0, 255]), "fixed header is part of a visible capture");
	await closeTabs(result, page);
});

test("select area: captures exactly the dragged rectangle, overlay leaves no trace", async () => {
	const { tabId, page } = await openFixture("short.html");
	assert.deepEqual(await capture(tabId, "area"), { ok: true });
	await page.waitForSelector("frame-select");
	await page.mouse.move(100, 100);
	await page.mouse.down();
	await page.mouse.move(200, 180, { steps: 4 });
	await page.mouse.move(300, 250, { steps: 4 });
	await page.mouse.up();
	await page.keyboard.press("Enter");
	const result = await waitForResult();
	const { w, h } = await size(result);
	const s = w / 200;
	assert.ok(Math.abs(h - 150 * s) <= 1, `size ${w}x${h}`);
	for (const [x, y] of [[1, 1], [w - 2, 1], [1, h - 2], [w - 2, h - 2], [w / 2, h / 2]]) {
		assert.ok(near(await pixel(result, x, y), [255, 136, 0]), `orange at ${x},${y} (overlay must not be in the shot)`);
	}
	assert.equal(await page.evaluate(() => !!document.querySelector("frame-select") || "__frameSelect" in window), false);
	await closeTabs(result, page);
});

test("select area: Escape cancels without opening a result", async () => {
	const { tabId, page } = await openFixture("short.html");
	assert.deepEqual(await capture(tabId, "area"), { ok: true });
	await page.waitForSelector("frame-select");
	await page.keyboard.press("Escape");
	await page.waitForFunction(() => !document.querySelector("frame-select"));
	// A new capture works straight away (nothing left "busy").
	assert.deepEqual(await capture(tabId, "visible"), { ok: true });
	const result = await waitForResult();
	await closeTabs(result, page);
});

test("restricted pages report a clear error", async () => {
	const { tabId } = await worker.evaluate(async () => {
		const w = await chrome.windows.create({ url: "chrome://version", focused: true });
		return { tabId: w.tabs[0].id };
	});
	const res = await capture(tabId, "full");
	assert.equal(res.ok, false);
	assert.equal(res.code, "restricted");
});

test("result page: crop and redact change the image, undo restores it", async () => {
	const { tabId, page } = await openFixture("short.html");
	assert.deepEqual(await capture(tabId, "visible"), { ok: true });
	const result = await waitForResult();
	const before = await size(result);
	const s = before.w / (await page.evaluate(() => innerWidth)); // image px per page CSS px

	// Work in the fixture's CSS pixels; the orange square is at 100,100 200x150.
	await result.click("#redact");
	const box = await result.$eval("#overlay", (o) => {
		const r = o.getBoundingClientRect();
		return { x: r.left, y: r.top, w: r.width, h: r.height };
	});
	const k = (box.w / before.w) * s; // screen px per page CSS px
	const at = (x, y) => [box.x + x * k, box.y + y * k];
	await result.mouse.move(...at(120, 120));
	await result.mouse.down();
	await result.mouse.move(...at(250, 200), { steps: 5 });
	await result.mouse.up();
	await result.click("#edit-apply");
	assert.ok(near(await pixel(result, 180 * s, 160 * s), [0, 0, 0]), "redacted area is solid black");

	// Crop to the orange square.
	await result.click("#crop");
	await result.mouse.move(...at(100, 100));
	await result.mouse.down();
	await result.mouse.move(...at(300, 250), { steps: 5 });
	await result.mouse.up();
	await result.keyboard.press("Enter");
	const cropped = await size(result);
	assert.ok(Math.abs(cropped.w - 200 * s) <= 2 * s && Math.abs(cropped.h - 150 * s) <= 2 * s, `cropped to ${cropped.w}x${cropped.h}`);

	await result.click("#undo");
	await result.click("#undo");
	assert.deepEqual(await size(result), before);
	assert.ok(near(await pixel(result, 180 * s, 160 * s), [255, 136, 0]), "undo restores the original");
	await closeTabs(result, page);
});

test("captures are removed from storage when the result tab closes", async () => {
	const { tabId, page } = await openFixture("short.html");
	assert.deepEqual(await capture(tabId, "visible"), { ok: true });
	const result = await waitForResult();
	const id = new URL(result.url()).searchParams.get("id");
	const count = () =>
		controller.evaluate(
			(id) =>
				new Promise((resolve) => {
					const req = indexedDB.open("frame", 1);
					req.onsuccess = () => {
						const g = req.result.transaction("captures").objectStore("captures").get(id);
						g.onsuccess = () => {
							resolve(g.result ? 1 : 0);
							req.result.close();
						};
					};
				}),
			id,
		);
	assert.equal(await count(), 1);
	await result.close();
	await new Promise((r) => setTimeout(r, 500));
	assert.equal(await count(), 0);
	await closeTabs(page);
});

test("switching tabs mid-capture stops cleanly and restores the page", async () => {
	const { tabId, page } = await openFixture("huge.html");
	assert.deepEqual(await capture(tabId, "full"), { ok: true });
	await new Promise((r) => setTimeout(r, 2500));
	await worker.evaluate(async (id) => {
		const t = await chrome.tabs.get(id);
		await chrome.tabs.create({ windowId: t.windowId, url: "about:blank", active: true });
	}, tabId);
	let last;
	for (let i = 0; i < 40 && !last?.error; i++) {
		await new Promise((r) => setTimeout(r, 250));
		({ lastCapture: last } = await worker.evaluate(() => chrome.storage.local.get("lastCapture")));
	}
	assert.equal(last?.error, "tab-hidden");
	const leftovers = await page.evaluate(() => !!document.getElementById("__frame-capture-style") || "__frame" in window);
	assert.equal(leftovers, false);
	await closeTabs(page);
});
