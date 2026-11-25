import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFilename, sanitize } from "../src/lib/filename.js";
import { addMetadata, metadataFields } from "../src/lib/metadata.js";

const date = new Date(2026, 10, 25, 9, 4, 7);

test("default template", () => {
	assert.equal(buildFilename("{domain}_{date}_{time}", { url: "https://www.github.com/x", title: "t", date, mode: "full" }), "github.com_2026-11-25_09-04-07");
});

test("title and mode tokens; unknown tokens left alone", () => {
	assert.equal(buildFilename("{title} {mode} {nope}", { url: "https://a.com", title: "Hello", date, mode: "area" }), "Hello area {nope}");
});

test("reserved characters and Windows names are made safe", () => {
	assert.equal(sanitize('a<b>c:d"e/f\\g|h?i*j'), "a-b-c-d-e-f-g-h-i-j");
	assert.equal(sanitize("CON"), "_CON");
	assert.equal(sanitize("nul.txt"), "_nul.txt");
	assert.equal(sanitize("  ..trailing.. "), "trailing");
	assert.equal(sanitize(""), "frame-capture");
	assert.equal(sanitize("tab\there\nnewline"), "tabherenewline");
	assert.ok(sanitize("x".repeat(400)).length <= 150);
});

test("empty tokens don't leave double separators", () => {
	assert.equal(buildFilename("{domain}_{title}_{date}", { url: "about:blank", title: "", date }), "about_2026-11-25");
	assert.equal(buildFilename("{title}", { url: "", title: "", date }), "frame-capture");
});

test("file URLs", () => {
	assert.equal(buildFilename("{domain}", { url: "file:///C:/x.html", title: "", date }), "local-file");
});

const fields = metadataFields({ url: "https://example.com/?q=ü", title: 'A "title" <tag>', captured: new Date(Date.UTC(2026, 0, 2)) });

// Smallest valid 1x1 PNG.
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

function pngChunks(bytes) {
	const v = new DataView(bytes.buffer);
	const out = [];
	for (let o = 8; o < bytes.length; ) {
		const len = v.getUint32(o);
		out.push({ type: new TextDecoder().decode(bytes.subarray(o + 4, o + 8)), data: bytes.subarray(o + 8, o + 8 + len) });
		o += 12 + len;
	}
	return out;
}

test("PNG metadata: iTXt chunks after IHDR, image chunks untouched", async () => {
	const out = new Uint8Array(await (await addMetadata(new Blob([PNG], { type: "image/png" }), "image/png", fields)).arrayBuffer());
	const chunks = pngChunks(out);
	assert.deepEqual(chunks.map((c) => c.type), ["IHDR", "iTXt", "iTXt", "iTXt", "iTXt", "IDAT", "IEND"]);
	const text = new TextDecoder().decode(chunks[2].data);
	assert.ok(text.startsWith("Source\0") && text.endsWith("https://example.com/?q=ü"));
	assert.deepEqual(pngChunks(PNG).find((c) => c.type === "IDAT").data, chunks.find((c) => c.type === "IDAT").data);
});

test("JPEG metadata: COM segment after SOI/APP0", async () => {
	const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xd9]);
	const out = new Uint8Array(await (await addMetadata(new Blob([jpeg]), "image/jpeg", fields)).arrayBuffer());
	assert.deepEqual([...out.subarray(0, 6)], [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04]);
	assert.deepEqual([...out.subarray(8, 10)], [0xff, 0xfe]);
	assert.ok(new TextDecoder().decode(out).includes("Title: A \"title\" <tag>"));
	assert.deepEqual([...out.subarray(-2)], [0xff, 0xd9]);
});

test("WebP metadata: simple VP8L becomes VP8X with XMP flag and valid RIFF size", async () => {
	// Minimal VP8L header for a 3x2 image (payload content is irrelevant here).
	const vp8l = new Uint8Array([0x2f, 0x02, 0x40, 0x00, 0x00, 0, 0, 0]);
	const riff = new Uint8Array(12 + 8 + vp8l.length);
	const v = new DataView(riff.buffer);
	riff.set(new TextEncoder().encode("RIFF"), 0);
	v.setUint32(4, riff.length - 8, true);
	riff.set(new TextEncoder().encode("WEBPVP8L"), 8);
	v.setUint32(16, vp8l.length, true);
	riff.set(vp8l, 20);

	const out = new Uint8Array(await (await addMetadata(new Blob([riff]), "image/webp", fields)).arrayBuffer());
	const ov = new DataView(out.buffer);
	const str = (o) => new TextDecoder().decode(out.subarray(o, o + 4));
	assert.equal(str(0), "RIFF");
	assert.equal(ov.getUint32(4, true), out.length - 8);
	assert.equal(str(12), "VP8X");
	assert.equal(out[20] & 0x04, 0x04, "XMP flag");
	assert.equal(1 + (out[24] | (out[25] << 8) | (out[26] << 16)), 3, "canvas width");
	assert.equal(1 + (out[27] | (out[28] << 8) | (out[29] << 16)), 2, "canvas height");
	assert.equal(str(30), "VP8L");
	const xmp = new TextDecoder().decode(out);
	assert.ok(xmp.includes("XMP ") && xmp.includes("A &quot;title&quot; &lt;tag&gt;"));
});
