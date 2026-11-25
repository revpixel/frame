// Injected into the page while a delayed capture counts down. Shows a small
// pill in the corner (in a closed shadow root, ignoring the mouse so the page
// can still be hovered and clicked) and lets Esc cancel. The service worker
// removes it, and waits for it to leave the screen, before anything is captured.
(() => {
	if (window.__frameCountdown) return;

	const host = document.createElement("frame-countdown");
	const root = host.attachShadow({ mode: "closed" });
	root.innerHTML = `
<style>
	:host { all: initial; position: fixed !important; right: 16px !important; bottom: 16px !important; z-index: 2147483647 !important; pointer-events: none !important; display: block !important; }
	.pill { display: flex; align-items: center; gap: 10px; padding: 7px 12px 7px 8px; border-radius: 999px; background: rgba(7, 10, 20, 0.9); border: 1px solid #2f3a62; box-shadow: 0 6px 20px rgba(0,0,0,.35); font: 12px/1 system-ui, -apple-system, "Segoe UI", sans-serif; color: #8f98bd; white-space: nowrap; }
	.n { display: grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; border: 2px solid #38bdf8; color: #e8ebfa; font: 700 13px/1 ui-monospace, "Cascadia Code", Consolas, monospace; }
	b { color: #e8ebfa; font-weight: 600; letter-spacing: .12em; font-size: 11px; }
	kbd { font: 11px/1 ui-monospace, Consolas, monospace; padding: 2px 5px; border: 1px solid #2f3a62; border-radius: 4px; color: #e8ebfa; }
</style>
<div class="pill" role="status" aria-live="polite"><span class="n"></span><b>FRAME</b><span>Capturing soon · <kbd>Esc</kbd> cancels</span></div>`;
	const n = root.querySelector(".n");

	function onKey(e) {
		if (e.key !== "Escape") return;
		e.preventDefault();
		e.stopImmediatePropagation();
		remove();
		chrome.runtime.sendMessage({ type: "frame:delay-cancel" });
	}

	function remove() {
		removeEventListener("keydown", onKey, true);
		host.remove();
		delete window.__frameCountdown;
	}

	addEventListener("keydown", onKey, true);
	document.documentElement.appendChild(host);

	window.__frameCountdown = {
		set(seconds) {
			n.textContent = String(seconds);
		},
		// Resolves once the pill is gone from the screen. requestAnimationFrame
		// pauses in background tabs, so a timer makes sure this never hangs.
		remove() {
			remove();
			return new Promise((resolve) => {
				const timer = setTimeout(resolve, 250);
				requestAnimationFrame(() =>
					requestAnimationFrame(() => {
						clearTimeout(timer);
						setTimeout(resolve, 30);
					}),
				);
			});
		},
	};
})();
