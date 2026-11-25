import { getCapture } from "../lib/store.js";
import { getSettings, FORMATS } from "../lib/settings.js";
import { buildFilename, tokenValues } from "../lib/filename.js";
import { addMetadata, metadataFields } from "../lib/metadata.js";

const $ = (id) => document.getElementById(id);
const stage = $("stage");
const view = $("view");
const overlay = $("overlay");
const toastEl = $("toast");

const MIME = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" };
const EXT = { png: "png", jpeg: "jpg", webp: "webp" };

let settings;
let capture; // record from IndexedDB
let parts = []; // [{ source: ImageBitmap, ops: [] }]
let active = 0;
let current = null; // canvas holding the rendered current part
let tool = null; // null | { kind: "crop"|"redact", rects: [] }
let format = "png";

// ---------- loading ----------

async function init() {
	settings = await getSettings();
	format = settings.format;
	$("format").value = format;

	const id = new URLSearchParams(location.search).get("id");
	capture = id ? await getCapture(id).catch(() => null) : null;
	if (!capture?.parts?.length) {
		$("frame").hidden = true;
		$("empty").hidden = false;
		$("empty").textContent = "This capture is no longer available. Captures are kept only while their tab is open.";
		for (const b of document.querySelectorAll(".bar button, .bar select")) b.disabled = true;
		return;
	}

	parts = await Promise.all(capture.parts.map(async (blob) => ({ source: await createImageBitmap(blob), ops: [] })));
	const v = tokenValues({ url: capture.url, title: capture.title, mode: capture.mode });
	document.title = `FRAME · ${v.domain || "capture"}`;

	if (parts.length > 1) {
		const nav = $("parts");
		nav.hidden = false;
		parts.forEach((_, i) => {
			const b = document.createElement("button");
			b.className = "btn";
			b.type = "button";
			b.textContent = `PART ${i + 1}`;
			b.addEventListener("click", () => selectPart(i));
			nav.appendChild(b);
		});
		$("save-all").hidden = false;
	}
	if (capture.notices?.length) {
		$("notice").hidden = false;
		$("notice").textContent = capture.notices.join(" ");
	}

	// Fit large captures to the window; small ones show at their real size.
	stage.classList.add("fit");
	selectPart(0);
}

function selectPart(i) {
	cancelTool();
	active = i;
	[...$("parts").children].forEach((b, j) => b.classList.toggle("active", j === i));
	render();
}

// ---------- rendering ----------

function render() {
	const part = parts[active];
	let c = document.createElement("canvas");
	c.width = part.source.width;
	c.height = part.source.height;
	c.getContext("2d").drawImage(part.source, 0, 0);
	for (const op of part.ops) c = applyOp(c, op);
	current = c;

	view.width = c.width;
	view.height = c.height;
	view.getContext("2d").drawImage(c, 0, 0);
	applyZoom();
	$("undo").disabled = part.ops.length === 0;

	const v = tokenValues({ url: capture.url, title: capture.title, mode: capture.mode });
	$("info").textContent = [v.domain, `${c.width} × ${c.height}`, parts.length > 1 ? `part ${active + 1}/${parts.length}` : ""]
		.filter(Boolean)
		.join("  ·  ");
}

function applyOp(c, op) {
	if (op.kind === "crop") {
		const { x, y, w, h } = op.rect;
		const out = document.createElement("canvas");
		out.width = w;
		out.height = h;
		out.getContext("2d").drawImage(c, x, y, w, h, 0, 0, w, h);
		return out;
	}
	if (op.kind === "redact") {
		const g = c.getContext("2d");
		for (const r of op.rects) {
			if (op.style === "pixelate") pixelate(c, g, r);
			else {
				g.fillStyle = "#000000";
				g.fillRect(r.x, r.y, r.w, r.h);
			}
		}
	}
	return c;
}

// Strong pixelation: big blocks, each block is the average colour of its area.
// Solid is the safer choice for text; this is for when context should stay visible.
function pixelate(c, g, r) {
	const block = Math.max(14, Math.round(Math.min(r.w, r.h) / 4));
	const cols = Math.max(1, Math.ceil(r.w / block));
	const rows = Math.max(1, Math.ceil(r.h / block));
	const small = document.createElement("canvas");
	small.width = cols;
	small.height = rows;
	const sg = small.getContext("2d");
	sg.imageSmoothingEnabled = true;
	sg.imageSmoothingQuality = "high";
	sg.drawImage(c, r.x, r.y, r.w, r.h, 0, 0, cols, rows);
	g.save();
	g.imageSmoothingEnabled = false;
	g.drawImage(small, 0, 0, cols, rows, r.x, r.y, r.w, r.h);
	g.restore();
}

// ---------- zoom ----------

let actualSize = false;

function applyZoom() {
	const fit = !actualSize;
	stage.classList.toggle("fit", fit);
	// One image pixel per screen pixel (matters on HiDPI screens); "fit" also caps it to the window.
	view.style.width = `${view.width / devicePixelRatio}px`;
	$("zoom").querySelector("span").textContent = fit ? "100%" : "Fit";
}

$("zoom").addEventListener("click", () => {
	actualSize = !actualSize;
	applyZoom();
});

// ---------- crop & redact ----------

function startTool(kind) {
	if (!current) return;
	if (tool?.kind === kind) return cancelTool();
	cancelTool();
	tool = { kind, rects: [] };
	document.body.classList.add("editing");
	$("editbar").hidden = false;
	$("redact-style").hidden = kind !== "redact";
	$("edit-hint").textContent = kind === "crop" ? "Drag to choose the area to keep." : "Drag over anything you want hidden. Add as many boxes as you need.";
	$(kind).classList.add("active");
	updateApply();
}

function cancelTool() {
	if (!tool) return;
	$(tool.kind).classList.remove("active");
	tool = null;
	overlay.replaceChildren();
	document.body.classList.remove("editing");
	$("editbar").hidden = true;
}

function applyTool() {
	if (!tool || !tool.rects.length) return;
	const part = parts[active];
	if (tool.kind === "crop") part.ops.push({ kind: "crop", rect: tool.rects[0] });
	else part.ops.push({ kind: "redact", style: redactStyle(), rects: tool.rects.slice() });
	cancelTool();
	render();
}

const redactStyle = () => document.querySelector('input[name="rstyle"]:checked').value;

function updateApply() {
	$("edit-apply").disabled = !tool?.rects.length;
}

// Overlay coordinates are in image pixels; boxes are positioned in percentages
// so they stay put when the window (and the fitted image) resizes.
function toImage(e) {
	const b = overlay.getBoundingClientRect();
	const x = ((e.clientX - b.left) / b.width) * view.width;
	const y = ((e.clientY - b.top) / b.height) * view.height;
	return { x: Math.min(view.width, Math.max(0, x)), y: Math.min(view.height, Math.max(0, y)) };
}

function placeBox(el, r) {
	Object.assign(el.style, {
		left: `${(r.x / view.width) * 100}%`,
		top: `${(r.y / view.height) * 100}%`,
		width: `${(r.w / view.width) * 100}%`,
		height: `${(r.h / view.height) * 100}%`,
	});
}

let drawing = null;

overlay.addEventListener("pointerdown", (e) => {
	if (!tool || e.button !== 0 || e.target.classList.contains("x")) return;
	e.preventDefault();
	overlay.setPointerCapture(e.pointerId);
	const start = toImage(e);
	const el = document.createElement("div");
	el.className = `r ${tool.kind === "crop" ? "crop-box" : "redact-box"}`;
	if (tool.kind === "redact" && redactStyle() === "pixelate") el.classList.add("pixelate");
	const dims = document.createElement("span");
	dims.className = "dims";
	el.appendChild(dims);
	if (tool.kind === "crop") {
		overlay.replaceChildren();
		tool.rects = [];
	}
	overlay.appendChild(el);
	drawing = { start, el, dims, rect: { x: start.x, y: start.y, w: 0, h: 0 } };
	updateApply();
});

overlay.addEventListener("pointermove", (e) => {
	if (!drawing) return;
	const p = toImage(e);
	const s = drawing.start;
	const r = {
		x: Math.round(Math.min(s.x, p.x)),
		y: Math.round(Math.min(s.y, p.y)),
		w: Math.round(Math.abs(p.x - s.x)),
		h: Math.round(Math.abs(p.y - s.y)),
	};
	drawing.rect = r;
	placeBox(drawing.el, r);
	drawing.dims.textContent = `${r.w} × ${r.h}`;
});

overlay.addEventListener("pointerup", () => {
	if (!drawing) return;
	const { el, dims, rect } = drawing;
	drawing = null;
	if (rect.w < 3 || rect.h < 3) {
		el.remove();
		updateApply();
		return;
	}
	if (tool.kind === "crop") tool.rects = [rect];
	else {
		dims.remove();
		tool.rects.push(rect);
		const x = document.createElement("button");
		x.className = "x";
		x.type = "button";
		x.title = "Remove";
		x.textContent = "×";
		x.addEventListener("click", (ev) => {
			ev.stopPropagation();
			tool.rects = tool.rects.filter((r) => r !== rect);
			el.remove();
			updateApply();
		});
		el.appendChild(x);
	}
	updateApply();
});

document.querySelectorAll('input[name="rstyle"]').forEach((i) =>
	i.addEventListener("change", () => {
		for (const el of overlay.querySelectorAll(".redact-box")) el.classList.toggle("pixelate", redactStyle() === "pixelate");
	}),
);

$("crop").addEventListener("click", () => startTool("crop"));
$("redact").addEventListener("click", () => startTool("redact"));
$("edit-cancel").addEventListener("click", cancelTool);
$("edit-apply").addEventListener("click", applyTool);
$("undo").addEventListener("click", undo);

function undo() {
	if (tool) return cancelTool();
	const part = parts[active];
	if (!part?.ops.length) return;
	part.ops.pop();
	render();
}

// ---------- output ----------

function encode(canvas, fmt) {
	return new Promise((resolve, reject) =>
		canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Encoding failed"))), MIME[fmt], fmt === "png" ? undefined : settings.quality / 100),
	);
}

async function finalBlob(canvas, fmt) {
	let blob = await encode(canvas, fmt);
	if (capture.metadata) {
		blob = await addMetadata(blob, MIME[fmt], metadataFields({ url: capture.url, title: capture.title, captured: new Date(capture.created) }));
	}
	return blob;
}

function partCanvas(i) {
	if (i === active) return current;
	let c = document.createElement("canvas");
	c.width = parts[i].source.width;
	c.height = parts[i].source.height;
	c.getContext("2d").drawImage(parts[i].source, 0, 0);
	for (const op of parts[i].ops) c = applyOp(c, op);
	return c;
}

function filenameFor(i, fmt) {
	const base = buildFilename(settings.filenameTemplate, {
		url: capture.url,
		title: capture.title,
		date: new Date(capture.created),
		mode: capture.mode,
	});
	return `${base}${parts.length > 1 ? `-part${i + 1}` : ""}.${EXT[fmt]}`;
}

async function save(i = active) {
	if (tool) applyTool();
	const fmt = format;
	const name = filenameFor(i, fmt);
	try {
		const blob = await finalBlob(partCanvas(i), fmt);
		if (settings.saveBehavior === "ask" && "showSaveFilePicker" in window) {
			let handle;
			try {
				handle = await window.showSaveFilePicker({
					id: "frame-save", // the browser remembers the last folder used
					suggestedName: name,
					types: [{ description: `${fmt.toUpperCase()} image`, accept: { [MIME[fmt]]: [`.${EXT[fmt]}`] } }],
				});
			} catch (err) {
				if (err?.name === "AbortError") return false;
				throw err;
			}
			const w = await handle.createWritable();
			await w.write(blob);
			await w.close();
			toast(`Saved ${handle.name}`);
		} else {
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = name;
			document.body.appendChild(a);
			a.click();
			a.remove();
			setTimeout(() => URL.revokeObjectURL(url), 60_000);
			toast(`Saved ${name}`);
		}
		return true;
	} catch (err) {
		toast(`Couldn't save: ${err.message || err}`, true);
		return false;
	}
}

async function saveAll() {
	for (let i = 0; i < parts.length; i++) {
		if ((await save(i)) === false && settings.saveBehavior === "ask") return;
	}
}

async function copy() {
	if (tool) applyTool();
	try {
		// The clipboard only accepts PNG images. Passing a promise keeps the user gesture alive.
		await navigator.clipboard.write([new ClipboardItem({ "image/png": encode(current, "png") })]);
		toast("Copied to clipboard");
	} catch (err) {
		toast(`Couldn't copy: ${err.message || err}`, true);
	}
}

$("format").addEventListener("change", (e) => {
	if (FORMATS.includes(e.target.value)) format = e.target.value;
});
$("save").addEventListener("click", () => save());
$("save-all").addEventListener("click", saveAll);
$("copy").addEventListener("click", copy);

// ---------- keyboard ----------

document.addEventListener("keydown", (e) => {
	if (e.target.closest?.("select, input")) {
		if (e.key !== "Enter" && e.key !== "Escape") return;
	}
	const mod = e.ctrlKey || e.metaKey;
	const k = e.key.toLowerCase();
	if (mod && k === "s") (e.shiftKey && parts.length > 1 ? saveAll() : save());
	else if (mod && k === "c" && !String(getSelection())) copy();
	else if (mod && k === "z") undo();
	else if (!mod && !e.altKey && k === "c") startTool("crop");
	else if (!mod && !e.altKey && k === "r") startTool("redact");
	else if (!mod && !e.altKey && k === "z") $("zoom").click();
	else if (e.key === "Escape" && tool) cancelTool();
	else if (e.key === "Enter" && tool) applyTool();
	else return;
	e.preventDefault();
});

// ---------- toast ----------

let toastTimer;
function toast(msg, bad = false) {
	toastEl.textContent = msg;
	toastEl.classList.toggle("bad", bad);
	toastEl.classList.add("show");
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2600);
}

init();
