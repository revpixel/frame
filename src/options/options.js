import { getSettings, setSettings, DEFAULTS } from "../lib/settings.js";
import { buildFilename } from "../lib/filename.js";
import { diagnosticText } from "../lib/diagnostics.js";

const $ = (id) => document.getElementById(id);

$("version").textContent = `v${chrome.runtime.getManifest().version}`;

const s = await getSettings();
$("defaultMode").value = s.defaultMode;
$("format").value = s.format;
$("quality").value = s.quality;
$("saveBehavior").value = s.saveBehavior;
$("filenameTemplate").value = s.filenameTemplate;
$("includeMetadata").checked = s.includeMetadata;

function syncQuality() {
	$("quality-out").textContent = $("quality").value;
	$("quality-row").style.opacity = $("format").value === "png" ? 0.55 : 1;
}

function preview() {
	const t = $("filenameTemplate").value.trim() || DEFAULTS.filenameTemplate;
	$("tmpl-preview").textContent = `${buildFilename(t, { url: "https://www.example.com/docs", title: "Example Domain", mode: "full" })}.png`;
}

for (const id of ["defaultMode", "format", "saveBehavior"]) {
	$(id).addEventListener("change", () => {
		setSettings({ [id]: $(id).value }).then(saved);
		syncQuality();
	});
}
$("quality").addEventListener("input", syncQuality);
$("quality").addEventListener("change", () => setSettings({ quality: Number($("quality").value) }).then(saved));
$("includeMetadata").addEventListener("change", () => setSettings({ includeMetadata: $("includeMetadata").checked }).then(saved));

let tmplTimer;
$("filenameTemplate").addEventListener("input", () => {
	preview();
	clearTimeout(tmplTimer);
	tmplTimer = setTimeout(() => {
		const v = $("filenameTemplate").value.trim();
		setSettings({ filenameTemplate: v || DEFAULTS.filenameTemplate }).then(saved);
	}, 400);
});
$("tmpl-reset").addEventListener("click", () => {
	$("filenameTemplate").value = DEFAULTS.filenameTemplate;
	preview();
	setSettings({ filenameTemplate: DEFAULTS.filenameTemplate }).then(saved);
});

syncQuality();
preview();

// Shortcuts
const NAMES = { _execute_action: "Open FRAME", "capture-full": "Full page", "capture-area": "Select area", "capture-visible": "Visible" };
const commands = await chrome.commands.getAll();
$("shortcuts").replaceChildren(
	...commands.map((c) => {
		const li = document.createElement("li");
		const name = document.createElement("span");
		name.textContent = NAMES[c.name] || c.description || c.name;
		const key = document.createElement(c.shortcut ? "kbd" : "span");
		key.textContent = c.shortcut || "not set";
		if (!c.shortcut) key.className = "unset";
		li.append(name, key);
		return li;
	}),
);
$("open-shortcuts").addEventListener("click", (e) => {
	e.preventDefault();
	chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
});

// Diagnostics
$("copy-diag").addEventListener("click", async () => {
	await navigator.clipboard.writeText(await diagnosticText());
	toast("Diagnostic info copied");
});
$("show-diag").addEventListener("click", async (e) => {
	e.preventDefault();
	const pre = $("diag-preview");
	pre.textContent = await diagnosticText();
	pre.hidden = !pre.hidden;
});

let toastTimer;
function toast(msg) {
	const t = $("toast");
	t.textContent = msg;
	t.classList.add("show");
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}
const saved = () => toast("Saved");
