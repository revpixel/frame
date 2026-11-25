// Filename templates. Tokens: {domain} {title} {date} {time} {mode}
// The result is sanitised so it is a valid filename on Windows, macOS and Linux.

export const TOKENS = ["domain", "title", "date", "time", "mode"];

const MODE_NAMES = { full: "full-page", area: "area", visible: "visible" };
const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;
const MAX_LENGTH = 150; // leaves room for "-part12.webp" and long folder paths

const pad = (n) => String(n).padStart(2, "0");

export function tokenValues({ url, title, date = new Date(), mode }) {
	let domain = "";
	try {
		const u = new URL(url);
		domain = u.hostname.replace(/^www\./, "") || (u.protocol === "file:" ? "local-file" : u.protocol.replace(":", ""));
	} catch {
		domain = "";
	}
	return {
		domain,
		title: (title || "").trim().slice(0, 80),
		date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
		time: `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`,
		mode: MODE_NAMES[mode] || "",
	};
}

export function sanitize(name) {
	let s = String(name)
		.normalize("NFC")
		.replace(/[\u0000-\u001f\u007f]/g, "") // control characters
		.replace(/[<>:"/\\|?*]/g, "-") // reserved on Windows (and / everywhere)
		.replace(/\s+/g, " ")
		.replace(/-{2,}/g, "-")
		.replace(/_{2,}/g, "_")
		.trim()
		.replace(/^[-_. ]+|[-_. ]+$/g, ""); // no leading/trailing dots, spaces, separators
	if (s.length > MAX_LENGTH) s = s.slice(0, MAX_LENGTH).replace(/[-_. ]+$/, "");
	if (!s) s = "frame-capture";
	if (RESERVED.test(s)) s = `_${s}`;
	return s;
}

/** Builds the base name (no extension) for a capture. */
export function buildFilename(template, info) {
	const values = tokenValues(info);
	const filled = String(template).replace(/\{(\w+)\}/g, (m, key) => (key in values ? values[key] : m));
	// Collapse separators left behind by empty tokens, e.g. "{domain}_{title}" with no title.
	return sanitize(filled.replace(/([ _-])[ _-]+/g, "$1"));
}
