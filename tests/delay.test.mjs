// Capture Delay, end to end. The countdown logic itself is covered without real
// waiting in unit.test.mjs; these tests use the real 3 s delay to check the
// whole flow in Chrome.
import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { setup, teardown, browser, worker, controller, extId, openFixture, capture, waitForResult, size, pixel, closeTabs, near, hex, sleep } from "./harness.mjs";

before(setup);
after(teardown);
afterEach(() => setDelay(0));

const setDelay = (seconds) => controller.evaluate((s) => chrome.storage.sync.set({ delay: s }), seconds);
const BG = hex("123456"); // short.html background
const ORANGE = [255, 136, 0];

const hasPill = (page) => page.evaluate(() => !!document.querySelector("frame-countdown"));
const badge = (tabId) => worker.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId);

/** Pixels in the result that are far from `rgb` (anything the page didn't paint). */
const strayPixels = (result, rgb) =>
	result.evaluate((rgb) => {
		const v = document.getElementById("view");
		const d = v.getContext("2d").getImageData(0, 0, v.width, v.height).data;
		let n = 0;
		for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - rgb[0]) + Math.abs(d[i + 1] - rgb[1]) + Math.abs(d[i + 2] - rgb[2]) > 30) n++;
		return n;
	}, rgb);

const repaint = (page, color) =>
	page.evaluate((c) => {
		document.body.style.background = c;
		document.getElementById("box").remove();
	}, color);

test("delay off: capture starts immediately with no countdown", async () => {
	await setDelay(0);
	const { tabId, page } = await openFixture("short.html");
	const t0 = Date.now();
	assert.deepEqual(await capture(tabId, "visible"), { ok: true });
	assert.equal(await hasPill(page), false);
	const result = await waitForResult();
	assert.ok(Date.now() - t0 < 2000, `took ${Date.now() - t0} ms`);
	assert.ok(near(await pixel(result, 5, 5), BG));
	await closeTabs(result, page);
});

test("delay 3s, visible: counts down on the page and badge, captures the page as it is at the end, without the countdown", async () => {
	await setDelay(3);
	const { tabId, page } = await openFixture("short.html");
	const t0 = Date.now();
	assert.deepEqual(await capture(tabId, "visible"), { ok: true });
	assert.equal(await hasPill(page), true, "countdown shown");
	assert.match(await badge(tabId), /^[123]$/);
	await sleep(1000);
	await repaint(page, "#00aa55"); // the "open a menu" moment
	const result = await waitForResult();
	assert.ok(Date.now() - t0 >= 2900, `captured after ${Date.now() - t0} ms`);
	assert.equal(await strayPixels(result, [0, 170, 85]), 0, "only the repainted page: no countdown pill, no old content");
	assert.equal(await hasPill(page), false);
	assert.equal(await badge(tabId), "");
	const { lastCapture } = await worker.evaluate(() => chrome.storage.local.get("lastCapture"));
	assert.equal(lastCapture.delay, 3);
	await closeTabs(result, page);
});

test("delay 3s, full page: nothing is measured or changed until the countdown ends", async () => {
	await setDelay(3);
	const { tabId, page } = await openFixture("short.html");
	assert.deepEqual(await capture(tabId, "full"), { ok: true });
	await sleep(500);
	const during = await page.evaluate(() => ({ helper: "__frame" in window, style: !!document.getElementById("__frame-capture-style") }));
	assert.deepEqual(during, { helper: false, style: false }, "full-page preparation hasn't started");
	await repaint(page, "#00aa55");
	const result = await waitForResult();
	assert.equal(await strayPixels(result, [0, 170, 85]), 0);
	const leftovers = await page.evaluate(() => "__frame" in window || !!document.querySelector("frame-countdown"));
	assert.equal(leftovers, false);
	await closeTabs(result, page);
});

test("delay 3s, select area: overlay appears only after the countdown, then works normally", async () => {
	await setDelay(3);
	const { tabId, page } = await openFixture("short.html");
	const t0 = Date.now();
	assert.deepEqual(await capture(tabId, "area"), { ok: true });
	await sleep(2000);
	assert.equal(await page.evaluate(() => !!document.querySelector("frame-select")), false, "no overlay during the countdown");
	await page.waitForSelector("frame-select", { timeout: 5000 });
	assert.ok(Date.now() - t0 >= 2900);
	assert.equal(await hasPill(page), false, "countdown gone before the overlay");
	await page.mouse.move(100, 100);
	await page.mouse.down();
	await page.mouse.move(300, 250, { steps: 6 });
	await page.mouse.up();
	await page.keyboard.press("Enter");
	const result = await waitForResult();
	const { w, h } = await size(result);
	assert.ok(Math.abs(h / w - 150 / 200) < 0.02, `size ${w}x${h}`);
	assert.ok(near(await pixel(result, w / 2, h / 2), ORANGE));
	await closeTabs(result, page);
});

test("Esc cancels a pending delayed capture; the next capture works", async () => {
	await setDelay(3);
	const { tabId, page } = await openFixture("short.html");
	assert.deepEqual(await capture(tabId, "visible"), { ok: true });
	await sleep(800);
	await page.keyboard.press("Escape");
	await sleep(3500);
	assert.equal(browser.targets().some((t) => t.url().includes("/result/result.html")), false, "no result opened");
	const { lastCapture } = await worker.evaluate(() => chrome.storage.local.get("lastCapture"));
	assert.equal(lastCapture.cancelled, true);
	assert.equal(await hasPill(page), false);
	assert.equal(await badge(tabId), "");

	await setDelay(0);
	assert.deepEqual(await capture(tabId, "visible"), { ok: true });
	const result = await waitForResult();
	await closeTabs(result, page);
});

test("a second capture during a countdown is refused with a clear message", async () => {
	await setDelay(3);
	const { tabId, page } = await openFixture("short.html");
	assert.deepEqual(await capture(tabId, "visible"), { ok: true });
	const second = await capture(tabId, "full");
	assert.equal(second.ok, false);
	assert.match(second.message, /counting down/);
	const result = await waitForResult();
	await closeTabs(result, page);
});

test("restricted pages fail straight away instead of counting down", async () => {
	await setDelay(3);
	const { tabId } = await worker.evaluate(async () => {
		const w = await chrome.windows.create({ url: "chrome://version", focused: true });
		return { tabId: w.tabs[0].id };
	});
	const t0 = Date.now();
	const res = await capture(tabId, "full");
	assert.equal(res.code, "restricted");
	assert.ok(Date.now() - t0 < 1500);
});

test("popup: delay choice is shown and remembered between sessions", async () => {
	await setDelay(0);
	const popup = await browser.newPage();
	await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
	const checked = () => popup.$$eval(".delay button", (bs) => bs.filter((b) => b.getAttribute("aria-checked") === "true").map((b) => b.dataset.delay));
	await popup.waitForFunction(() => document.querySelector('.delay button[aria-checked="true"]'));
	assert.deepEqual(await checked(), ["0"], "Off by default");
	await popup.click('.delay button[data-delay="5"]');
	await popup.waitForFunction(async () => (await chrome.storage.sync.get("delay")).delay === 5);
	await popup.reload();
	await popup.waitForFunction(() => document.querySelector('.delay button[aria-checked="true"]'));
	assert.deepEqual(await checked(), ["5"], "remembered after reopening");
	await popup.click('.delay button[data-delay="10"]');
	await popup.waitForFunction(async () => (await chrome.storage.sync.get("delay")).delay === 10);
	await popup.close();
});
