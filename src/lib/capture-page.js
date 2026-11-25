// Injected into the page for Full Page captures. It never reads page content;
// it only measures, scrolls, and temporarily changes styles, then puts
// everything back exactly as it was.
//
// The service worker drives it through window.__frame:
//   prepare()            -> geometry of what will be captured
//   scrollTo(y, phase)   -> scrolls, hides repeating fixed UI, waits for the frame to settle
//   restore()            -> undoes every change
(() => {
	if (window.__frame) return;

	const STYLE_ID = "__frame-capture-style";
	const SCROLL_ATTR = "data-frame-scroll";

	let target = null; // null = the document scrolls; otherwise the scrolling element
	let original = null;
	const touched = new Map(); // element -> { prop: [value, priority] } original inline styles
	const hadStyleAttr = new Map(); // element -> whether it had a style attribute before FRAME touched it
	const lazy = [];

	let active = false; // true between prepare() and restore(); nothing touches the page outside it

	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
	// Waits for n rendered frames. requestAnimationFrame pauses in background tabs,
	// so a timer guarantees this never hangs.
	const frames = (n = 2) =>
		new Promise((resolve) => {
			const timer = setTimeout(resolve, 50 * n + 100);
			const step = () => (--n <= 0 ? (clearTimeout(timer), resolve()) : requestAnimationFrame(step));
			requestAnimationFrame(step);
		});

	function setStyle(el, prop, value) {
		if (!active) return;
		let saved = touched.get(el);
		if (!saved) {
			touched.set(el, (saved = {}));
			if (!hadStyleAttr.has(el)) hadStyleAttr.set(el, el.hasAttribute("style"));
		}
		if (!(prop in saved)) saved[prop] = [el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)];
		el.style.setProperty(prop, value, "important");
	}

	function resetStyle(el, prop) {
		const saved = touched.get(el);
		if (!saved || !(prop in saved)) return;
		const [value, priority] = saved[prop];
		if (value) el.style.setProperty(prop, value, priority);
		else el.style.removeProperty(prop);
		delete saved[prop];
	}

	function* elements() {
		const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT);
		let n = walker.currentNode;
		while (n) {
			yield n;
			n = walker.nextNode();
		}
	}

	// w excludes a classic scrollbar if one survived; iw is what captureVisibleTab covers.
	const viewport = () => ({ w: document.documentElement.clientWidth || innerWidth, h: innerHeight, iw: innerWidth });

	function findScrollContainer() {
		const vp = viewport();
		const minArea = vp.w * vp.h * 0.25;
		let best = null;
		let bestArea = 0;
		for (const el of elements()) {
			if (el.scrollHeight <= el.clientHeight + 1 || el.clientHeight < 50) continue;
			const oy = getComputedStyle(el).overflowY;
			if (oy !== "auto" && oy !== "scroll" && oy !== "overlay") continue;
			const r = el.getBoundingClientRect();
			const w = Math.max(0, Math.min(r.right, vp.w) - Math.max(r.left, 0));
			const h = Math.max(0, Math.min(r.bottom, vp.h) - Math.max(r.top, 0));
			const area = w * h;
			if (area >= minArea && area > bestArea) {
				best = el;
				bestArea = area;
			}
		}
		return best;
	}

	const scroller = () => target || document.scrollingElement || document.documentElement;
	const scrollTop = () => (target ? target.scrollTop : scrollY);
	const totalHeight = () => (target ? target.scrollHeight : Math.max(scroller().scrollHeight, document.body?.scrollHeight || 0));
	const stepHeight = () => (target ? target.clientHeight : innerHeight);

	function doScroll(y) {
		scroller().scrollTo({ top: y, left: 0, behavior: "instant" });
	}

	function region() {
		if (!target) {
			const vp = viewport();
			return { x: 0, y: 0, w: vp.w, h: vp.h };
		}
		const r = target.getBoundingClientRect();
		return { x: r.left + target.clientLeft, y: r.top + target.clientTop, w: target.clientWidth, h: target.clientHeight };
	}

	// Sticky elements become position: relative for the whole capture, so they
	// show once at their place in the document instead of on every tile.
	function pinSticky() {
		for (const el of elements()) {
			if (touched.get(el)?.position) continue;
			const pos = getComputedStyle(el).position;
			if (pos === "sticky" || pos === "-webkit-sticky") {
				setStyle(el, "position", "relative");
				for (const side of ["top", "bottom", "left", "right"]) setStyle(el, side, "auto");
			}
		}
	}

	// Fixed elements: keep top-anchored ones on the first tile and bottom-anchored
	// ones on the last tile; hide everything fixed in between.
	function handleFixed(phase) {
		const half = innerHeight / 2;
		for (const el of elements()) {
			if (el === document.documentElement || el === document.body) continue;
			const pos = getComputedStyle(el).position;
			const hidden = touched.get(el)?.opacity;
			if (pos !== "fixed") {
				if (hidden) unhide(el);
				continue;
			}
			// Never hide an app shell that contains the panel being captured.
			if (target && el.contains(target)) continue;
			let hide = phase !== "only";
			if (phase === "first" || phase === "last") {
				const r = el.getBoundingClientRect();
				const bottomAnchored = r.top + r.height / 2 > half;
				hide = phase === "first" ? bottomAnchored : !bottomAnchored;
			}
			if (hide && !hidden) {
				setStyle(el, "transition", "none");
				setStyle(el, "opacity", "0");
			} else if (!hide && hidden) unhide(el);
		}
	}

	function unhide(el) {
		resetStyle(el, "opacity");
		resetStyle(el, "transition");
	}

	async function waitForImages(timeout) {
		const vh = innerHeight;
		const pending = [...document.images].filter((img) => {
			if (img.complete) return false;
			const r = img.getBoundingClientRect();
			return r.bottom > 0 && r.top < vh && r.width > 0;
		});
		if (!pending.length) return;
		await Promise.race([
			Promise.all(
				pending.map(
					(img) =>
						new Promise((done) => {
							img.addEventListener("load", done, { once: true });
							img.addEventListener("error", done, { once: true });
						}),
				),
			),
			sleep(timeout),
		]);
	}

	window.__frame = {
		async prepare() {
			active = true;
			original = { x: scrollX, y: scrollY };

			const style = document.createElement("style");
			style.id = STYLE_ID;
			style.textContent = `
				html, body, [${SCROLL_ATTR}] { scroll-behavior: auto !important; scroll-snap-type: none !important; }
				html, [${SCROLL_ATTR}] { scrollbar-width: none !important; }
				html::-webkit-scrollbar, [${SCROLL_ATTR}]::-webkit-scrollbar { display: none !important; }
			`;
			(document.head || document.documentElement).appendChild(style);

			for (const el of document.querySelectorAll('img[loading="lazy"], iframe[loading="lazy"]')) {
				lazy.push(el);
				el.loading = "eager";
			}

			const docScrolls = scroller().scrollHeight > innerHeight + 1;
			target = docScrolls ? null : findScrollContainer();
			if (target) {
				original.target = { x: target.scrollLeft, y: target.scrollTop };
				target.setAttribute(SCROLL_ATTR, "");
			}

			// Quick pass down the page to wake scroll-triggered lazy loaders.
			const started = performance.now();
			for (let y = 0, i = 0; y < totalHeight() && i < 60 && performance.now() - started < 6000; y += stepHeight(), i++) {
				doScroll(y);
				await sleep(60);
			}
			doScroll(0);
			if (target) window.scrollTo({ top: original.y, left: original.x, behavior: "instant" });
			await frames(2);
			await sleep(250);

			pinSticky();
			await frames(2);

			return {
				target: target ? "element" : "document",
				viewport: viewport(),
				region: region(),
				total: totalHeight(),
				step: stepHeight(),
				dpr: devicePixelRatio,
			};
		},

		async scrollTo(y, phase) {
			if (!active) throw new Error("FRAME capture is not active.");
			doScroll(y);
			await frames(2);
			pinSticky();
			handleFixed(phase);
			await frames(2);
			await sleep(phase === "first" || phase === "only" ? 120 : 60);
			await waitForImages(1500);
			await frames(1);
			return { y: scrollTop(), region: region() };
		},

		async restore() {
			active = false;
			for (const [el, props] of touched) for (const prop of Object.keys(props)) resetStyle(el, prop);
			touched.clear();
			// Leave no empty style="" behind on elements that had none. Chrome writes inline
			// style changes to the attribute lazily; reading it first flushes that, otherwise
			// the pending write recreates style="" after we remove it.
			for (const [el, had] of hadStyleAttr) {
				if (had || el.style.length) continue;
				el.getAttribute("style");
				el.removeAttribute("style");
			}
			hadStyleAttr.clear();
			for (const el of lazy.splice(0)) el.loading = "lazy";
			document.getElementById(STYLE_ID)?.remove();
			if (target) {
				target.removeAttribute(SCROLL_ATTR);
				target.scrollTo({ top: original.target.y, left: original.target.x, behavior: "instant" });
			}
			if (original) window.scrollTo({ top: original.y, left: original.x, behavior: "instant" });
			target = null;
			original = null;
			delete window.__frame;
			return true;
		},
	};
})();
