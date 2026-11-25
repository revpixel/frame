// Optional capture metadata (off by default). Written as text inside the file
// container: PNG iTXt chunks, a JPEG COM segment, a WebP XMP chunk. The pixels
// are never touched. When the setting is off, files are written exactly as the
// browser encodes them.

const enc = new TextEncoder();

/** @param {{ url: string, title: string, captured: Date }} m */
export function metadataFields(m) {
	return [
		["Title", m.title || ""],
		["Source", m.url || ""],
		["Creation Time", m.captured.toISOString()],
		["Software", "FRAME"],
	].filter(([, v]) => v);
}

export async function addMetadata(blob, type, fields) {
	const bytes = new Uint8Array(await blob.arrayBuffer());
	let out;
	if (type === "image/png") out = pngWithText(bytes, fields);
	else if (type === "image/jpeg") out = jpegWithComment(bytes, fields);
	else if (type === "image/webp") out = webpWithXmp(bytes, fields);
	else return blob;
	return new Blob([out], { type });
}

// ---------- PNG ----------

const CRC_TABLE = (() => {
	const t = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c >>> 0;
	}
	return t;
})();

function crc32(bytes) {
	let c = 0xffffffff;
	for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
	const out = new Uint8Array(12 + data.length);
	const view = new DataView(out.buffer);
	view.setUint32(0, data.length);
	out.set(enc.encode(type), 4);
	out.set(data, 8);
	view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
	return out;
}

function pngWithText(bytes, fields) {
	// Insert iTXt (UTF-8) chunks right after IHDR: 8-byte signature + 25-byte IHDR chunk.
	const at = 33;
	const chunks = fields.map(([key, value]) => {
		// keyword \0 compression-flag(0) compression-method(0) language \0 translated-keyword \0 text
		const k = enc.encode(key);
		const v = enc.encode(value);
		const data = new Uint8Array(k.length + 5 + v.length);
		data.set(k, 0);
		data.set(v, k.length + 5);
		return pngChunk("iTXt", data);
	});
	return concat([bytes.subarray(0, at), ...chunks, bytes.subarray(at)]);
}

// ---------- JPEG ----------

function jpegWithComment(bytes, fields) {
	const text = enc.encode(fields.map(([k, v]) => `${k}: ${v}`).join("\n")).subarray(0, 65000);
	const seg = new Uint8Array(4 + text.length);
	seg[0] = 0xff;
	seg[1] = 0xfe; // COM
	new DataView(seg.buffer).setUint16(2, text.length + 2);
	seg.set(text, 4);
	// After SOI and any APP0 (JFIF) segment.
	let at = 2;
	if (bytes[2] === 0xff && bytes[3] === 0xe0) at = 4 + ((bytes[4] << 8) | bytes[5]);
	return concat([bytes.subarray(0, at), seg, bytes.subarray(at)]);
}

// ---------- WebP ----------

function xmlEscape(s) {
	return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]);
}

function webpWithXmp(bytes, fields) {
	const get = (k) => xmlEscape(fields.find(([key]) => key === k)?.[1] || "");
	const xmp = enc.encode(
		`<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>` +
			`<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">` +
			`<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/">` +
			`<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${get("Title")}</rdf:li></rdf:Alt></dc:title>` +
			`<dc:source>${get("Source")}</dc:source>` +
			`<xmp:CreateDate>${get("Creation Time")}</xmp:CreateDate>` +
			`<xmp:CreatorTool>FRAME</xmp:CreatorTool>` +
			`</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`,
	);

	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const fourcc = (o) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
	if (fourcc(0) !== "RIFF" || fourcc(8) !== "WEBP") return bytes;

	const chunks = [];
	for (let o = 12; o + 8 <= bytes.length; ) {
		const size = view.getUint32(o + 4, true);
		chunks.push({ id: fourcc(o), data: bytes.subarray(o + 8, o + 8 + size) });
		o += 8 + size + (size & 1);
	}

	let vp8x = chunks.find((c) => c.id === "VP8X");
	if (!vp8x) {
		const img = chunks.find((c) => c.id === "VP8 " || c.id === "VP8L");
		if (!img) return bytes;
		let w, h, alpha = false;
		if (img.id === "VP8 ") {
			w = (img.data[6] | (img.data[7] << 8)) & 0x3fff;
			h = (img.data[8] | (img.data[9] << 8)) & 0x3fff;
		} else {
			const b = img.data;
			w = 1 + (((b[2] & 0x3f) << 8) | b[1]);
			h = 1 + (((b[4] & 0x0f) << 10) | (b[3] << 2) | ((b[2] & 0xc0) >> 6));
			alpha = ((b[4] >> 4) & 1) === 1;
		}
		const d = new Uint8Array(10);
		d[0] = alpha ? 0x10 : 0;
		const W = w - 1, H = h - 1;
		d[4] = W & 0xff; d[5] = (W >> 8) & 0xff; d[6] = (W >> 16) & 0xff;
		d[7] = H & 0xff; d[8] = (H >> 8) & 0xff; d[9] = (H >> 16) & 0xff;
		vp8x = { id: "VP8X", data: d };
		chunks.unshift(vp8x);
	} else {
		vp8x.data = vp8x.data.slice();
	}
	vp8x.data[0] |= 0x04; // XMP present
	chunks.push({ id: "XMP ", data: xmp });

	const body = chunks.map((c) => {
		const pad = c.data.length & 1;
		const out = new Uint8Array(8 + c.data.length + pad);
		out.set(enc.encode(c.id), 0);
		new DataView(out.buffer).setUint32(4, c.data.length, true);
		out.set(c.data, 8);
		return out;
	});
	const total = 4 + body.reduce((n, b) => n + b.length, 0);
	const head = new Uint8Array(12);
	head.set(enc.encode("RIFF"), 0);
	new DataView(head.buffer).setUint32(4, total, true);
	head.set(enc.encode("WEBP"), 8);
	return concat([head, ...body]);
}

function concat(parts) {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let o = 0;
	for (const p of parts) {
		out.set(p, o);
		o += p.length;
	}
	return out;
}
