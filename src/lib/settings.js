// Settings live in chrome.storage.sync so they follow the user's Chrome profile.
// Nothing here is ever sent anywhere by FRAME.

export const MODES = ["full", "area", "visible"];
export const FORMATS = ["png", "jpeg", "webp"];

export const DEFAULTS = Object.freeze({
	defaultMode: "last", // "last" | "full" | "area" | "visible"
	lastMode: "full",
	format: "png", // default export format
	quality: 92, // JPEG / WebP quality, 1-100
	filenameTemplate: "{domain}_{date}_{time}",
	includeMetadata: false,
	saveBehavior: "downloads", // "downloads" | "ask"
});

export async function getSettings() {
	const stored = await chrome.storage.sync.get(null);
	const s = { ...DEFAULTS, ...stored };
	if (!MODES.includes(s.lastMode)) s.lastMode = DEFAULTS.lastMode;
	if (s.defaultMode !== "last" && !MODES.includes(s.defaultMode)) s.defaultMode = DEFAULTS.defaultMode;
	if (!FORMATS.includes(s.format)) s.format = DEFAULTS.format;
	s.quality = Math.min(100, Math.max(1, Math.round(Number(s.quality) || DEFAULTS.quality)));
	if (typeof s.filenameTemplate !== "string" || !s.filenameTemplate.trim()) s.filenameTemplate = DEFAULTS.filenameTemplate;
	if (s.saveBehavior !== "ask") s.saveBehavior = "downloads";
	s.includeMetadata = s.includeMetadata === true;
	return s;
}

export function setSettings(patch) {
	return chrome.storage.sync.set(patch);
}

/** The mode the popup should highlight. */
export function preferredMode(s) {
	return s.defaultMode === "last" ? s.lastMode : s.defaultMode;
}
