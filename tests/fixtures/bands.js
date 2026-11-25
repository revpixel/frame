// Shared by fixtures: band i gets a unique, easy-to-check colour.
window.bandColor = (i) => `rgb(${(i * 37) % 200 + 20}, ${(i * 91) % 200 + 20}, ${(i * 53) % 120 + 100})`;
window.makeBands = (parent, n, h) => {
	for (let i = 0; i < n; i++) {
		const d = document.createElement("div");
		d.className = "band";
		d.style.cssText = `height:${h}px;background:${bandColor(i)}`;
		d.dataset.i = i;
		parent.appendChild(d);
	}
};
