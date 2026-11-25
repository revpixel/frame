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
let tool = null; // null | { kind: "crop"|"redact", rects: [] } | { kind: "annotate" }
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
	if (op.kind === "annotate") {
		drawAnnotation(c.getContext("2d"), op);
		return c;
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
	const annotating = kind === "annotate";
	document.body.classList.toggle("annotating", annotating);
	$("annot").hidden = !annotating;
	$("annot-done").hidden = !annotating;
	$("edit-hint").hidden = annotating;
	$("edit-cancel").hidden = annotating;
	$("edit-apply").hidden = annotating;
	$("redact-style").hidden = kind !== "redact";
	$(kind).classList.add("active");
	if (annotating) return selectShape(annot.shape);
	$("edit-hint").textContent = kind === "crop" ? "Drag to choose the area to keep." : "Drag over anything you want hidden. Add as many boxes as you need.";
	updateApply();
}

function cancelTool() {
	if (!tool) return;
	if (tool.kind === "annotate") {
		commitText();
		stroke = null;
		clearPreview();
		document.body.classList.remove("annotating", "shape-text");
	}
	$(tool.kind).classList.remove("active");
	tool = null;
	overlay.replaceChildren();
	document.body.classList.remove("editing");
	$("editbar").hidden = true;
}

function applyTool() {
	if (tool?.kind === "annotate") return commitText(); // annotations apply as they're drawn
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
	if (tool?.kind === "annotate") return annotDown(e);
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
	if (tool?.kind === "annotate") return annotMove(e);
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
	if (tool?.kind === "annotate") return annotUp();
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
$("annotate").addEventListener("click", () => startTool("annotate"));
$("annot-done").addEventListener("click", cancelTool);
$("edit-cancel").addEventListener("click", cancelTool);
$("edit-apply").addEventListener("click", applyTool);
$("undo").addEventListener("click", undo);

function undo() {
	if (tool?.kind === "annotate") {
		// Undo stays in Annotate: first drop an unfinished text box, then the last edit.
		if (textBox) return removeTextBox();
	} else if (tool) return cancelTool();
	const part = parts[active];
	if (!part?.ops.length) return;
	part.ops.pop();
	render();
}

// ---------- annotate ----------
// Each finished arrow, rectangle, stroke, text or highlight is one entry in the
// part's edit list, drawn straight into the image (no layers). Undo removes the
// last entry. Crop and redact before or after just work, because the list is
// replayed in order.

const ANNOT_FONT = '"Space Grotesk", system-ui, -apple-system, "Segoe UI", sans-serif';
const HIGHLIGHT_ALPHA = 0.35;
const annot = { shape: "arrow", color: "#ef4444", width: 4, size: 24 }; // width/size in screen px at 100%
const preview = $("preview");
let stroke = null; // annotation being drawn
let textBox = null; // { input, at, size, color } while text is being typed

// Sizes are picked in screen pixels and stored in image pixels, so a "medium"
// line looks the same on a HiDPI capture as on a normal one.
const px = (cssPx) => Math.max(1, Math.round(cssPx * devicePixelRatio));

function drawAnnotation(g, a) {
	g.save();
	g.lineCap = "round";
	g.lineJoin = "round";
	g.strokeStyle = g.fillStyle = a.color;
	g.lineWidth = a.width;
	if (a.shape === "arrow") drawArrow(g, a.points[0], a.points[1], a.width);
	else if (a.shape === "rect") g.strokeRect(a.rect.x, a.rect.y, a.rect.w, a.rect.h);
	else if (a.shape === "highlight") {
		g.globalAlpha = HIGHLIGHT_ALPHA;
		g.fillRect(a.rect.x, a.rect.y, a.rect.w, a.rect.h);
	} else if (a.shape === "pen") {
		const [p0, ...rest] = a.points;
		g.beginPath();
		g.moveTo(p0.x, p0.y);
		if (!rest.length) g.lineTo(p0.x + 0.01, p0.y); // a click leaves a dot
		for (const p of rest) g.lineTo(p.x, p.y);
		g.stroke();
	} else if (a.shape === "text") {
		g.font = `600 ${a.size}px ${ANNOT_FONT}`;
		g.textBaseline = "top";
		g.fillText(a.text, a.at.x, a.at.y);
	}
	g.restore();
}

function drawArrow(g, from, to, width) {
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	const len = Math.hypot(dx, dy) || 1;
	const head = Math.min(len, Math.max(width * 4, 12));
	const ux = dx / len;
	const uy = dy / len;
	// End the shaft inside the head so its round cap doesn't poke out past the tip.
	g.beginPath();
	g.moveTo(from.x, from.y);
	g.lineTo(to.x - ux * head * 0.8, to.y - uy * head * 0.8);
	g.stroke();
	const spread = head * 0.55;
	const hx = to.x - ux * head;
	const hy = to.y - uy * head;
	g.beginPath();
	g.moveTo(to.x, to.y);
	g.lineTo(hx - uy * spread, hy + ux * spread);
	g.lineTo(hx + uy * spread, hy - ux * spread);
	g.closePath();
	g.fill();
}

function selectShape(shape) {
	commitText();
	annot.shape = shape;
	document.body.classList.toggle("shape-text", shape === "text");
	for (const b of $("shapes").children) b.setAttribute("aria-pressed", String(b.dataset.shape === shape));
	// Only the controls that matter for this tool.
	$("widths").hidden = shape === "text" || shape === "highlight";
	$("sizes").hidden = shape !== "text";
	syncControls();
}

function syncControls() {
	const swatches = [...$("colors").querySelectorAll("button")];
	for (const b of swatches) b.setAttribute("aria-pressed", String(b.dataset.color === annot.color));
	$("colors").querySelector(".custom").setAttribute("aria-pressed", String(!swatches.some((b) => b.dataset.color === annot.color)));
	for (const b of $("widths").children) b.setAttribute("aria-pressed", String(Number(b.dataset.width) === annot.width));
	for (const b of $("sizes").children) b.setAttribute("aria-pressed", String(Number(b.dataset.size) === annot.size));
	if (textBox) {
		textBox.color = annot.color;
		textBox.size = px(annot.size);
		styleTextBox();
	}
}

function setColor(color) {
	annot.color = color;
	syncControls();
	textBox?.input.focus();
}

for (const b of $("shapes").children) b.addEventListener("click", () => selectShape(b.dataset.shape));
for (const b of $("colors").querySelectorAll("button")) b.addEventListener("click", () => setColor(b.dataset.color));
$("color-custom").addEventListener("input", (e) => setColor(e.target.value));
for (const b of $("widths").children)
	b.addEventListener("click", () => {
		annot.width = Number(b.dataset.width);
		syncControls();
	});
for (const b of $("sizes").children)
	b.addEventListener("click", () => {
		annot.size = Number(b.dataset.size);
		syncControls();
		textBox?.input.focus();
	});

function annotDown(e) {
	if (e.button !== 0 || e.target === textBox?.input) return;
	e.preventDefault();
	if (textBox) return commitText(); // clicking elsewhere finishes the text being typed
	const p = toImage(e);
	if (annot.shape === "text") return openTextBox(p);
	overlay.setPointerCapture(e.pointerId);
	const base = { kind: "annotate", shape: annot.shape, color: annot.color, width: px(annot.width) };
	if (annot.shape === "pen") stroke = { ...base, points: [p] };
	else if (annot.shape === "arrow") stroke = { ...base, points: [p, p] };
	else stroke = { ...base, start: p, rect: { x: p.x, y: p.y, w: 0, h: 0 } };
	sizePreview();
	drawPreview();
}

function annotMove(e) {
	if (!stroke) return;
	const p = toImage(e);
	if (stroke.shape === "pen") {
		const last = stroke.points[stroke.points.length - 1];
		if (Math.hypot(p.x - last.x, p.y - last.y) < 1.5) return;
		stroke.points.push(p);
	} else if (stroke.shape === "arrow") stroke.points[1] = p;
	else {
		const s0 = stroke.start;
		stroke.rect = { x: Math.min(s0.x, p.x), y: Math.min(s0.y, p.y), w: Math.abs(p.x - s0.x), h: Math.abs(p.y - s0.y) };
	}
	drawPreview();
}

function annotUp() {
	if (!stroke) return;
	const a = stroke;
	stroke = null;
	clearPreview();
	delete a.start;
	const [p0, p1] = a.points || [];
	const big = a.shape === "pen" || (a.shape === "arrow" ? Math.hypot(p1.x - p0.x, p1.y - p0.y) >= 3 : a.rect.w >= 3 && a.rect.h >= 3);
	if (big) commitAnnotation(a);
}

function commitAnnotation(op) {
	parts[active].ops.push(op);
	drawAnnotation(current.getContext("2d"), op);
	view.getContext("2d").drawImage(current, 0, 0);
	$("undo").disabled = false;
}

// The preview canvas matches the on-screen size of the image, not its full
// resolution, so drawing stays smooth on very tall full-page captures.
function sizePreview() {
	const b = overlay.getBoundingClientRect();
	preview.width = Math.max(1, Math.round(b.width * devicePixelRatio));
	preview.height = Math.max(1, Math.round(b.height * devicePixelRatio));
}

function drawPreview() {
	const g = preview.getContext("2d");
	g.setTransform(1, 0, 0, 1, 0, 0);
	g.clearRect(0, 0, preview.width, preview.height);
	if (!stroke) return;
	const k = preview.width / view.width;
	g.setTransform(k, 0, 0, k, 0, 0);
	drawAnnotation(g, stroke);
}

function clearPreview() {
	const g = preview.getContext("2d");
	g.setTransform(1, 0, 0, 1, 0, 0);
	g.clearRect(0, 0, preview.width, preview.height);
}

function openTextBox(at) {
	const input = document.createElement("input");
	input.type = "text";
	input.className = "text-input";
	input.maxLength = 200;
	input.setAttribute("aria-label", "Annotation text");
	textBox = { input, at, size: px(annot.size), color: annot.color };
	styleTextBox();
	input.addEventListener("keydown", (e) => {
		// Typing must never trigger viewer shortcuts (c, r, z, a, Ctrl+Z...).
		e.stopPropagation();
		if (e.key === "Enter") {
			e.preventDefault();
			commitText();
		} else if (e.key === "Escape") {
			e.preventDefault();
			removeTextBox();
		}
	});
	overlay.appendChild(input);
	input.focus();
}

function styleTextBox() {
	const k = overlay.getBoundingClientRect().width / view.width; // screen px per image px
	Object.assign(textBox.input.style, {
		left: `${(textBox.at.x / view.width) * 100}%`,
		top: `${(textBox.at.y / view.height) * 100}%`,
		fontSize: `${textBox.size * k}px`,
		height: `${textBox.size * k * 1.2}px`,
		color: textBox.color,
	});
}

function removeTextBox() {
	textBox?.input.remove();
	textBox = null;
}

function commitText() {
	if (!textBox) return;
	const { input, at, size, color } = textBox;
	const text = input.value.trim();
	removeTextBox();
	if (text) commitAnnotation({ kind: "annotate", shape: "text", text, at, size, color });
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
	else if (!mod && !e.altKey && k === "a") startTool("annotate");
	else if (e.key === "Escape" && tool) cancelTool();
	else if (e.key === "Enter" && tool?.kind === "annotate") return;
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
