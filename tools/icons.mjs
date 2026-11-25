// Renders assets/icon.svg to the PNG sizes the manifest needs.
import { readFile, writeFile } from "node:fs/promises";
import { launch } from "./browser.mjs";

const svg = await readFile(new URL("../assets/icon.svg", import.meta.url), "utf8");
const browser = await launch();
const page = await browser.newPage();
for (const size of [16, 32, 48, 128]) {
	await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
	await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
	const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
	await writeFile(new URL(`../src/icons/icon-${size}.png`, import.meta.url), png);
	console.log(`icon-${size}.png`);
}
await browser.close();
