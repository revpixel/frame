// Injected into the page for Select Area. Draws a dimmed overlay in a closed
// shadow root (so page CSS can't touch it and page scripts can't read it),
// lets the user drag a rectangle, then removes itself completely before the
// screenshot is taken.
(() => {
	if (window.__frameSelect) return;
	window.__frameSelect = true;

	const MIN = 4;
	const host = document.createElement("frame-select");
	const root = host.attachShadow({ mode: "closed" });
	root.innerHTML = `
<style>
	:host { all: initial; position: fixed !important; inset: 0 !important; z-index: 2147483647 !important; display: block !important; }
	.layer { position: fixed; inset: 0; cursor: crosshair; font: 13px/1.3 system-ui, -apple-system, "Segoe UI", sans-serif; color: #e8ebfa; user-select: none; -webkit-user-select: none; }
	.dim { position: fixed; inset: 0; background: rgba(7, 10, 20, 0.55); }
	.box { position: fixed; display: none; outline: 1px solid #38bdf8; box-shadow: 0 0 0 100vmax rgba(7, 10, 20, 0.55), 0 0 0 1px rgba(7,10,20,.6) inset; cursor: move; }
	.has-box .dim { display: none; }
	.has-box .box { display: block; }
	.handle { position: absolute; width: 10px; height: 10px; background: #070a14; border: 2px solid #38bdf8; border-radius: 2px; box-sizing: border-box; }
	.handle[data-h="nw"] { left: -5px; top: -5px; cursor: nwse-resize; }
	.handle[data-h="ne"] { right: -5px; top: -5px; cursor: nesw-resize; }
	.handle[data-h="sw"] { left: -5px; bottom: -5px; cursor: nesw-resize; }
	.handle[data-h="se"] { right: -5px; bottom: -5px; cursor: nwse-resize; }
	.size { position: absolute; left: 0; top: -26px; padding: 3px 7px; border-radius: 5px; background: #070a14; border: 1px solid #2f3a62; font: 11px/1.2 ui-monospace, "Cascadia Code", Consolas, monospace; white-space: nowrap; }
	.size.inside { top: 6px; left: 6px; }
	.actions { position: absolute; right: 0; bottom: -44px; display: flex; gap: 6px; }
	.actions.inside { bottom: 8px; right: 8px; }
	button { all: unset; cursor: pointer; padding: 7px 12px; border-radius: 8px; font: 600 12px/1 system-ui, -apple-system, "Segoe UI", sans-serif; letter-spacing: .02em; background: #111628; border: 1px solid #2f3a62; color: #e8ebfa; box-shadow: 0 4px 14px rgba(0,0,0,.35); }
	button:hover { border-color: #38bdf8; }
	button.primary { background: linear-gradient(95deg, #38bdf8, #a78bfa); border-color: transparent; color: #070a14; }
	button:focus-visible { outline: 2px solid #38bdf8; outline-offset: 2px; }
	.hint { position: fixed; left: 50%; top: 18px; transform: translateX(-50%); padding: 8px 14px; border-radius: 999px; background: rgba(7,10,20,.88); border: 1px solid #2f3a62; color: #8f98bd; white-space: nowrap; pointer-events: none; box-shadow: 0 6px 20px rgba(0,0,0,.35); }
	.hint b { color: #e8ebfa; font-weight: 600; }
	kbd { font: 11px/1 ui-monospace, Consolas, monospace; padding: 2px 5px; border: 1px solid #2f3a62; border-radius: 4px; color: #e8ebfa; }
</style>
<div class="layer" part="layer">
	<div class="dim"></div>
	<div class="box">
		<span class="size"></span>
		<span class="handle" data-h="nw"></span><span class="handle" data-h="ne"></span>
		<span class="handle" data-h="sw"></span><span class="handle" data-h="se"></span>
		<div class="actions">
			<button class="cancel" type="button">Cancel</button>
			<button class="primary capture" type="button">Capture</button>
		</div>
	</div>
	<div class="hint"><b>FRAME</b> &nbsp;Drag to select &nbsp;·&nbsp; <kbd>Enter</kbd> capture &nbsp;·&nbsp; <kbd>Esc</kbd> cancel</div>
</div>`;

	const layer = root.querySelector(".layer");
	const box = root.querySelector(".box");
	const size = root.querySelector(".size");
	const actions = root.querySelector(".actions");
	const hint = root.querySelector(".hint");

	let sel = null; // { x, y, w, h } in viewport CSS px
	let drag = null;

	const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

	function render() {
		if (!sel || sel.w < MIN || sel.h < MIN) {
			layer.classList.remove("has-box");
			return;
		}
		layer.classList.add("has-box");
		Object.assign(box.style, { left: `${sel.x}px`, top: `${sel.y}px`, width: `${sel.w}px`, height: `${sel.h}px` });
		size.textContent = `${Math.round(sel.w)} × ${Math.round(sel.h)}`;
		size.classList.toggle("inside", sel.y < 30);
		actions.classList.toggle("inside", sel.y + sel.h + 48 > innerHeight);
		hint.style.display = sel.y < 64 ? "none" : "";
	}

	function normalize(x1, y1, x2, y2) {
		x1 = clamp(x1, 0, innerWidth);
		x2 = clamp(x2, 0, innerWidth);
		y1 = clamp(y1, 0, innerHeight);
		y2 = clamp(y2, 0, innerHeight);
		return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
	}

	layer.addEventListener("pointerdown", (e) => {
		if (e.button !== 0 || e.target.closest("button")) return;
		e.preventDefault();
		layer.setPointerCapture(e.pointerId);
		const handle = e.target.dataset?.h;
		if (handle && sel) {
			// Resize from a corner: anchor the opposite corner.
			const ax = handle.includes("w") ? sel.x + sel.w : sel.x;
			const ay = handle.includes("n") ? sel.y + sel.h : sel.y;
			drag = { kind: "draw", ax, ay };
		} else if (sel && e.target.closest(".box")) {
			drag = { kind: "move", dx: e.clientX - sel.x, dy: e.clientY - sel.y };
		} else {
			drag = { kind: "draw", ax: e.clientX, ay: e.clientY };
			sel = { x: e.clientX, y: e.clientY, w: 0, h: 0 };
		}
	});

	layer.addEventListener("pointermove", (e) => {
		if (!drag) return;
		if (drag.kind === "draw") sel = normalize(drag.ax, drag.ay, e.clientX, e.clientY);
		else {
			sel.x = clamp(e.clientX - drag.dx, 0, innerWidth - sel.w);
			sel.y = clamp(e.clientY - drag.dy, 0, innerHeight - sel.h);
		}
		render();
	});

	layer.addEventListener("pointerup", () => {
		drag = null;
		if (sel && (sel.w < MIN || sel.h < MIN)) sel = null;
		render();
	});

	box.addEventListener("dblclick", (e) => {
		e.preventDefault();
		confirm();
	});
	root.querySelector(".capture").addEventListener("click", confirm);
	root.querySelector(".cancel").addEventListener("click", cancel);

	function onKey(e) {
		if (e.key === "Escape") cancel();
		else if (e.key === "Enter" && sel) confirm();
		else return;
		e.preventDefault();
		e.stopImmediatePropagation();
	}
	addEventListener("keydown", onKey, true);
	addEventListener("resize", cancel);

	function teardown() {
		removeEventListener("keydown", onKey, true);
		removeEventListener("resize", cancel);
		host.remove();
		delete window.__frameSelect;
	}

	function cancel() {
		teardown();
		chrome.runtime.sendMessage({ type: "frame:area-cancel" });
	}

	function confirm() {
		if (!sel) return;
		const rect = { ...sel };
		teardown();
		// Let the overlay disappear from the screen before the capture is taken.
		requestAnimationFrame(() =>
			requestAnimationFrame(() =>
				setTimeout(() => chrome.runtime.sendMessage({ type: "frame:area", rect, viewport: { w: innerWidth, h: innerHeight } }), 30),
			),
		);
	}

	document.documentElement.appendChild(host);
	render();
})();
