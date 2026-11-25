// Annotation, end to end: draw with each tool in the real result viewer, then
// check the pixels on screen and in what Copy and Save actually produce.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setup, teardown, controller, openFixture, capture, waitForResult, size, pixel, closeTabs, near, hex } from "./harness.mjs";

before(setup);
after(teardown);

const BG = hex("123456"); // short.html background; orange box at 100,100 200x150
const RED = hex("ef4444");
const YELLOW = hex("facc15");
const BLUE = hex("3b82f6");
const GREEN = hex("22c55e");

/**
 * Opens a visible capture of short.html and returns helpers that work in the
 * page's CSS pixels, whatever the screen scale.
 */
async function open() {
	const { tabId, page } = await openFixture("short.html");
	const vw = await page.evaluate(() => innerWidth);
	assert.deepEqual(await capture(tabId, "visible"), { ok: true });
	const result = await waitForResult();
	await result.evaluate(() => document.fonts.ready);
	const s = (await size(result)).w / vw; // image px per page CSS px

	const screen = async (x, y) => {
		const b = await result.$eval("#overlay", (o) => {
			const r = o.getBoundingClientRect();
			return { x: r.left, y: r.top, w: r.width };
		});
		const k = b.w / (await size(result)).w;
		return [b.x + x * s * k, b.y + y * s * k];
	};
	const drag = async (from, to, via = []) => {
		await result.mouse.move(...(await screen(...from)));
		await result.mouse.down();
		for (const p of [...via, to]) await result.mouse.move(...(await screen(...p)), { steps: 4 });
		await result.mouse.up();
	};
	const click = async (x, y) => result.mouse.click(...(await screen(x, y)));
	const px = (x, y) => pixel(result, x * s, y * s);
	const annotate = async (shape, { color, width, size: textSize } = {}) => {
		if (!(await result.$eval("#annotate", (b) => b.classList.contains("active")))) await result.click("#annotate");
		await result.click(`#shapes [data-shape="${shape}"]`);
		if (color) await result.click(`#colors [data-color="${color}"]`);
		if (width) await result.click(`#widths [data-width="${width}"]`);
		if (textSize) await result.click(`#sizes [data-size="${textSize}"]`);
	};
	/** Bounding box (image px) of pixels near `rgb` inside a region given in CSS px. */
	const extent = (rgb, [x, y, w, h], tol = 60) =>
		result.evaluate(
			(rgb, x, y, w, h, tol) => {
				const d = document.getElementById("view").getContext("2d").getImageData(x, y, w, h).data;
				let n = 0, top = Infinity, bottom = -1, left = Infinity, right = -1;
				for (let j = 0; j < h; j++)
					for (let i = 0; i < w; i++) {
						const o = (j * w + i) * 4;
						if (Math.abs(d[o] - rgb[0]) + Math.abs(d[o + 1] - rgb[1]) + Math.abs(d[o + 2] - rgb[2]) <= tol) {
							n++;
							top = Math.min(top, j);
							bottom = Math.max(bottom, j);
							left = Math.min(left, i);
							right = Math.max(right, i);
						}
					}
				return { n, h: bottom - top + 1, w: right - left + 1 };
			},
			rgb, Math.round(x * s), Math.round(y * s), Math.round(w * s), Math.round(h * s), tol,
		);
	return { tabId, page, result, s, drag, click, px, annotate, extent };
}

test("annotate: arrow, rectangle, freehand, text and highlight draw into the image", async () => {
	const t = await open();
	const { result, drag, click, px, annotate, extent, s } = t;

	await annotate("arrow", { color: "#ef4444", width: 4 });
	await drag([400, 400], [600, 400]);
	assert.ok(near(await px(500, 400), RED), "arrow shaft");
	assert.ok(near(await px(588, 404), RED, 20) && near(await px(588, 396), RED, 20), "arrow head is wider than the shaft");
	assert.ok(near(await px(500, 420), BG), "nothing drawn off the arrow");

	await annotate("rect", { color: "#22c55e", width: 8 });
	await drag([400, 450], [600, 550]);
	assert.ok(near(await px(400, 500), GREEN), "rectangle edge");
	assert.ok(near(await px(500, 500), BG), "rectangle is an outline, not filled");

	await annotate("pen", { color: "#3b82f6", width: 4 });
	await drag([650, 400], [750, 400], [[700, 450]]);
	assert.ok(near(await px(700, 450), BLUE, 20), "freehand passes through the middle point");
	assert.ok(near(await px(675, 425), BLUE, 20), "freehand joins the points");

	await annotate("text", { color: "#facc15", size: 36 });
	await click(650, 500);
	await result.keyboard.type("HELLO");
	await result.keyboard.press("Enter");
	const text = await extent(YELLOW, [640, 490, 300, 70]);
	assert.ok(text.n > 50, `text pixels: ${text.n}`);

	await annotate("highlight", { color: "#facc15" });
	await drag([50, 600], [300, 680]);
	const blended = BG.map((c, i) => Math.round(c * 0.65 + YELLOW[i] * 0.35));
	assert.ok(near(await px(175, 640), blended, 4), `highlight is translucent: ${await px(175, 640)} vs ${blended}`);

	// Typing in the text box never triggered viewer shortcuts (C crops, R redacts, Z zooms, A toggles).
	assert.equal(await result.$eval("#annotate", (b) => b.classList.contains("active")), true);
	assert.equal(await result.$eval("#crop", (b) => b.classList.contains("active")), false);
	assert.equal(s > 0, true);
	await closeTabs(result, t.page);
});

test("annotate: stroke width and text size change what's drawn", async () => {
	const t = await open();
	const { result, drag, click, annotate, extent, s } = t;

	await annotate("rect", { color: "#22c55e", width: 2 });
	await drag([420, 420], [520, 520]);
	await annotate("rect", { color: "#22c55e", width: 8 });
	await drag([620, 420], [720, 520]);
	// Thickness of the left edge, measured across a horizontal strip.
	const thin = await extent(GREEN, [410, 470, 20, 1]);
	const thick = await extent(GREEN, [610, 470, 20, 1]);
	assert.ok(Math.abs(thin.w - 2 * s) <= 1, `thin edge ${thin.w}px`);
	assert.ok(Math.abs(thick.w - 8 * s) <= 1, `thick edge ${thick.w}px`);

	await annotate("text", { color: "#facc15", size: 16 });
	await click(420, 560);
	await result.keyboard.type("Size");
	await result.keyboard.press("Enter");
	await annotate("text", { size: 36 });
	await click(620, 560);
	await result.keyboard.type("Size");
	await result.keyboard.press("Enter");
	const small = await extent(YELLOW, [410, 550, 180, 60]);
	const large = await extent(YELLOW, [610, 550, 250, 70]);
	assert.ok(large.h > small.h * 1.8 && large.w > small.w * 1.8, `small ${small.w}x${small.h}, large ${large.w}x${large.h}`);
	await closeTabs(result, t.page);
});

test("annotate: preset and custom colours", async () => {
	const t = await open();
	const { result, drag, px, annotate } = t;
	for (const [i, c] of ["#ef4444", "#facc15", "#3b82f6", "#22c55e", "#ffffff", "#000000"].entries()) {
		await annotate("rect", { color: c, width: 8 });
		await drag([400 + i * 60, 400], [450 + i * 60, 450]);
		assert.ok(near(await px(400 + i * 60, 425), hex(c)), `swatch ${c}`);
	}
	await result.$eval("#color-custom", (el) => {
		el.value = "#a78bfa";
		el.dispatchEvent(new Event("input", { bubbles: true }));
	});
	await annotate("rect", { width: 8 });
	await drag([400, 500], [450, 550]);
	assert.ok(near(await px(400, 525), hex("a78bfa")), "custom colour");
	assert.equal(await result.$eval("#colors .custom", (l) => l.getAttribute("aria-pressed")), "true");
	await closeTabs(result, t.page);
});

test("annotate: undo removes one annotation at a time (button and Ctrl+Z), and stays in Annotate", async () => {
	const t = await open();
	const { result, drag, px, annotate } = t;
	await annotate("rect", { color: "#ef4444", width: 8 });
	await drag([400, 400], [500, 500]);
	await annotate("rect", { color: "#22c55e", width: 8 });
	await drag([600, 400], [700, 500]);
	assert.ok(near(await px(600, 450), GREEN));
	await result.keyboard.down("Control");
	await result.keyboard.press("z");
	await result.keyboard.up("Control");
	assert.ok(near(await px(600, 450), BG), "Ctrl+Z removed the last annotation");
	assert.ok(near(await px(400, 450), RED), "earlier annotation kept");
	assert.equal(await result.$eval("#annotate", (b) => b.classList.contains("active")), true, "still annotating");
	await result.click("#undo");
	assert.ok(near(await px(400, 450), BG), "undo button removed the other");
	assert.equal(await result.$eval("#undo", (b) => b.disabled), true);
	await closeTabs(result, t.page);
});

test("annotate with crop and redact: Redact → Annotate → Crop keeps everything where it belongs", async () => {
	const t = await open();
	const { result, drag, px, annotate, s } = t;

	// Redact a block, then draw an arrow across it: the arrow sits on top.
	await result.click("#redact");
	await drag([400, 380], [500, 420]);
	await result.click("#edit-apply");
	await annotate("arrow", { color: "#ef4444", width: 4 });
	await drag([350, 400], [600, 400]);
	assert.ok(near(await px(450, 400), RED), "annotation drawn over the redaction");
	assert.ok(near(await px(450, 390), [0, 0, 0]), "redaction still there around it");

	// Annotate, then redact over it: the redaction hides the annotation.
	await annotate("rect", { color: "#22c55e", width: 8 });
	await drag([650, 450], [750, 550]);
	await result.click("#annot-done");
	await result.click("#redact");
	await drag([640, 440], [760, 560]);
	await result.keyboard.press("Enter");
	assert.ok(near(await px(650, 500), [0, 0, 0]), "redaction covers the earlier annotation");

	// Crop around the arrow: it lands at the right place in the cropped image.
	await result.click("#crop");
	await drag([300, 350], [650, 450]);
	await result.keyboard.press("Enter");
	const { w, h } = await size(result);
	assert.ok(Math.abs(w - 350 * s) <= 2 * s && Math.abs(h - 100 * s) <= 2 * s, `cropped to ${w}x${h}`);
	assert.ok(near(await pixel(result, 150 * s, 50 * s), RED), "arrow moved with the crop");
	assert.ok(near(await pixel(result, 150 * s, 40 * s), [0, 0, 0]), "redaction moved with the crop");

	// Annotating after the crop uses the cropped image's coordinates.
	await annotate("rect", { color: "#3b82f6", width: 8 });
	const b = await result.$eval("#overlay", (o) => {
		const r = o.getBoundingClientRect();
		return { x: r.left, y: r.top, k: r.width / document.getElementById("view").width };
	});
	await result.mouse.move(b.x + 20 * s * b.k, b.y + 20 * s * b.k);
	await result.mouse.down();
	await result.mouse.move(b.x + 80 * s * b.k, b.y + 80 * s * b.k, { steps: 4 });
	await result.mouse.up();
	assert.ok(near(await pixel(result, 20 * s, 50 * s), BLUE), "annotation after crop");

	// Undo walks back through all of it in order.
	for (let i = 0; i < 6; i++) await result.click("#undo"); // redact, arrow, rect, redact, crop, rect
	assert.equal(await result.$eval("#undo", (b) => b.disabled), true);
	assert.ok(near(await px(450, 400), BG), "back to the original capture");
	await closeTabs(result, t.page);
});

// ---------- export ----------

/** Intercepts Save (download link) and Copy (clipboard) so the output can be decoded. */
const intercept = (result) =>
	result.evaluate(() => {
		window.__saved = [];
		HTMLAnchorElement.prototype.click = function () {
			window.__saved.push({ name: this.download, href: this.href });
		};
		navigator.clipboard.write = async (items) => {
			window.__clip = await items[0].getType("image/png");
		};
	});

/** Decodes a blob in the page and samples pixels at image coordinates. */
const sampleBlob = (result, expr, points) =>
	result.evaluate(
		async (expr, points) => {
			const blob = expr === "clip" ? window.__clip : await (await fetch(window.__saved.at(-1).href)).blob();
			const bmp = await createImageBitmap(blob);
			const c = new OffscreenCanvas(bmp.width, bmp.height);
			const g = c.getContext("2d");
			g.drawImage(bmp, 0, 0);
			const bytes = new Uint8Array(await blob.arrayBuffer());
			return {
				type: blob.type,
				w: bmp.width,
				h: bmp.height,
				name: expr === "clip" ? null : window.__saved.at(-1).name,
				head: [...bytes.subarray(0, 16)],
				text: new TextDecoder("latin1").decode(bytes),
				webpXmpFlag: blob.type === "image/webp" && String.fromCharCode(...bytes.subarray(12, 16)) === "VP8X" && (bytes[20] & 0x04) === 0x04,
				px: points.map(([x, y]) => [...g.getImageData(x, y, 1, 1).data.slice(0, 3)]),
			};
		},
		expr,
		points,
	);

async function annotatedCapture() {
	const t = await open();
	await t.annotate("arrow", { color: "#ef4444", width: 8 });
	await t.drag([400, 400], [600, 400]);
	await t.annotate("highlight", { color: "#facc15" });
	await t.drag([50, 600], [300, 680]);
	await t.annotate("text", { color: "#ffffff", size: 36 });
	await t.click(650, 500);
	await t.result.keyboard.type("Exported");
	// Leave the text box open: Copy/Save must commit it first.
	await intercept(t.result);
	return t;
}

test("copy and PNG / JPEG / WebP saves contain the annotations exactly as shown", async () => {
	const t = await annotatedCapture();
	const { result, s } = t;
	const points = [[500 * s, 400 * s], [175 * s, 640 * s], [5, 5]];

	await result.click("#copy");
	await result.waitForFunction(() => window.__clip);
	const shown = await Promise.all(points.map(([x, y]) => pixel(result, x, y)));
	const textShown = await t.extent([255, 255, 255], [640, 490, 300, 70], 30);
	assert.ok(textShown.n > 50, "pending text was committed before copying");
	const clip = await sampleBlob(result, "clip", points);
	assert.equal(clip.type, "image/png");
	clip.px.forEach((p, i) => assert.ok(near(p, shown[i], 0), `clipboard pixel ${i}: ${p} vs ${shown[i]}`));

	for (const [fmt, mime, tol] of [["png", "image/png", 0], ["jpeg", "image/jpeg", 24], ["webp", "image/webp", 24]]) {
		await result.select("#format", fmt);
		await result.click("#save");
		await result.waitForFunction((n) => window.__saved.length === n, {}, ["png", "jpeg", "webp"].indexOf(fmt) + 1);
		const out = await sampleBlob(result, "save", points);
		assert.equal(out.type, mime);
		assert.match(out.name, new RegExp(`\\.${fmt === "jpeg" ? "jpg" : fmt}$`));
		const view = await size(result);
		assert.deepEqual([out.w, out.h], [view.w, view.h]);
		out.px.forEach((p, i) => assert.ok(near(p, shown[i], tol), `${fmt} pixel ${i}: ${p} vs ${shown[i]}`));
	}
	await closeTabs(result, t.page);
});

test("metadata still works with annotated exports", async () => {
	await controller.evaluate(() => chrome.storage.sync.set({ includeMetadata: true }));
	try {
		const t = await annotatedCapture();
		const { result, s } = t;
		const points = [[500 * s, 400 * s]];
		for (const [fmt, marker] of [["png", "iTXt"], ["jpeg", "Source: http://127.0.0.1"], ["webp", "XMP "]]) {
			await result.select("#format", fmt);
			await result.click("#save");
			await result.waitForFunction((n) => window.__saved.length === n, {}, ["png", "jpeg", "webp"].indexOf(fmt) + 1);
			const out = await sampleBlob(result, "save", points);
			assert.ok(out.text.includes(marker), `${fmt} carries metadata`);
			if (fmt === "webp") assert.ok(out.webpXmpFlag, "WebP header flags the XMP chunk");
			assert.ok(near(out.px[0], RED, fmt === "png" ? 0 : 24), `${fmt} still has the annotation`);
		}
		await closeTabs(result, t.page);
	} finally {
		await controller.evaluate(() => chrome.storage.sync.set({ includeMetadata: false }));
	}
});

test("keyboard: A toggles Annotate; existing shortcuts are unchanged", async () => {
	const t = await open();
	const { result } = t;
	const active = (id) => result.$eval(`#${id}`, (b) => b.classList.contains("active"));
	await result.keyboard.press("a");
	assert.equal(await active("annotate"), true);
	await result.keyboard.press("Escape");
	assert.equal(await active("annotate"), false);
	await result.keyboard.press("c");
	assert.equal(await active("crop"), true);
	await result.keyboard.press("r");
	assert.equal(await active("redact"), true);
	assert.equal(await active("crop"), false);
	await result.keyboard.press("Escape");
	const zoom = await result.$eval("#zoom span", (s) => s.textContent);
	await result.keyboard.press("z");
	assert.notEqual(await result.$eval("#zoom span", (s) => s.textContent), zoom);
	await closeTabs(result, t.page);
});
