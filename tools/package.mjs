// Zips src/ into dist/frame-<version>.zip for the Chrome Web Store. No dependencies.
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { deflateRawSync, crc32 } from "node:zlib";

const src = new URL("../src/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const { version } = JSON.parse(await readFile(join(src, "manifest.json"), "utf8"));

async function* walk(dir) {
	for (const e of await readdir(dir, { withFileTypes: true })) {
		const p = join(dir, e.name);
		if (e.isDirectory()) yield* walk(p);
		else yield p;
	}
}

const files = [];
for await (const p of walk(src)) files.push(p);
files.sort();

const locals = [];
const central = [];
let offset = 0;
for (const p of files) {
	const name = Buffer.from(relative(src, p).split("\\").join("/"));
	const data = await readFile(p);
	const packed = deflateRawSync(data, { level: 9 });
	const crc = crc32(data);
	const head = Buffer.alloc(30);
	head.writeUInt32LE(0x04034b50, 0);
	head.writeUInt16LE(20, 4);
	head.writeUInt16LE(0x0800, 6); // UTF-8 names
	head.writeUInt16LE(8, 8); // deflate
	head.writeUInt32LE(0x00210000, 10); // fixed timestamp (1980-01-01) for reproducible zips
	head.writeUInt32LE(crc, 14);
	head.writeUInt32LE(packed.length, 18);
	head.writeUInt32LE(data.length, 22);
	head.writeUInt16LE(name.length, 26);
	locals.push(head, name, packed);

	const cen = Buffer.alloc(46);
	cen.writeUInt32LE(0x02014b50, 0);
	cen.writeUInt16LE(20, 4);
	cen.writeUInt16LE(20, 6);
	cen.writeUInt16LE(0x0800, 8);
	cen.writeUInt16LE(8, 10);
	cen.writeUInt32LE(0x00210000, 12);
	cen.writeUInt32LE(crc, 16);
	cen.writeUInt32LE(packed.length, 20);
	cen.writeUInt32LE(data.length, 24);
	cen.writeUInt16LE(name.length, 28);
	cen.writeUInt32LE(offset, 42);
	central.push(cen, name);
	offset += head.length + name.length + packed.length;
}

const cdSize = central.reduce((n, b) => n + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(cdSize, 12);
end.writeUInt32LE(offset, 16);

await mkdir(new URL("../dist/", import.meta.url), { recursive: true });
const out = new URL(`../dist/frame-${version}.zip`, import.meta.url);
const zip = Buffer.concat([...locals, ...central, end]);
await writeFile(out, zip);
console.log(`dist/frame-${version}.zip  ${files.length} files  ${(zip.length / 1024).toFixed(1)} KB`);
