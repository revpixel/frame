// "Copy diagnostic info": safe, non-sensitive facts for a bug report.
// Never includes URLs, page titles, page content, history or the filename template text.

import { getSettings, DEFAULTS } from "./settings.js";

export async function diagnosticText() {
	const manifest = chrome.runtime.getManifest();
	const s = await getSettings();
	const { lastCapture } = await chrome.storage.local.get("lastCapture");
	const platform = await chrome.runtime.getPlatformInfo().catch(() => ({}));

	let browser = navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0] || "unknown";
	try {
		const ua = await navigator.userAgentData?.getHighEntropyValues(["fullVersionList", "platformVersion"]);
		const brand = ua?.fullVersionList?.find((b) => !/Not.?A.?Brand|Chromium/i.test(b.brand)) || ua?.fullVersionList?.find((b) => b.brand === "Chromium");
		if (brand) browser = `${brand.brand} ${brand.version}`;
		if (ua?.platformVersion) platform.version = ua.platformVersion;
	} catch {}

	const lines = [
		"FRAME diagnostic info",
		`FRAME: ${manifest.version}`,
		`Browser: ${browser}`,
		`OS: ${[platform.os, platform.version, platform.arch].filter(Boolean).join(" ") || "unknown"}`,
		`Screen: ${screen.width}x${screen.height} @${devicePixelRatio}x`,
		"",
		"Settings",
		`  default mode: ${s.defaultMode}`,
		`  format: ${s.format}  quality: ${s.quality}`,
		`  save: ${s.saveBehavior}`,
		`  metadata: ${s.includeMetadata ? "on" : "off"}`,
		`  filename template: ${s.filenameTemplate === DEFAULTS.filenameTemplate ? "default" : "custom"}`,
	];

	if (lastCapture) {
		lines.push("", "Last capture");
		// Browser error messages can quote a URL; strip anything URL-shaped.
		const scrub = (v) => String(v).replace(/\b[a-z][\w+.-]*:\/\/[^\s"')]+/gi, "<url>");
		for (const [k, v] of Object.entries(lastCapture)) lines.push(`  ${k}: ${scrub(v)}`);
	}
	return lines.join("\n");
}
