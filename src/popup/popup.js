import { getSettings, setSettings, preferredMode } from "../lib/settings.js";

const errorBox = document.querySelector(".error");
const errorMsg = errorBox.querySelector(".msg");
const fallback = errorBox.querySelector(".fallback");
const buttons = [...document.querySelectorAll(".mode")];

let delayWrite = Promise.resolve();

async function capture(mode) {
	errorBox.hidden = true;
	await delayWrite; // a delay picked a moment ago must be saved before the worker reads it
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	if (!tab) return showError("FRAME couldn't find the current tab.");
	const btn = buttons.find((b) => b.dataset.mode === mode);
	btn?.classList.add("working");
	const res = await chrome.runtime.sendMessage({ type: "frame:capture", mode, tabId: tab.id });
	btn?.classList.remove("working");
	if (res?.ok) window.close();
	else showError(res?.message || "Something went wrong.", res?.code === "restricted" && mode !== "visible");
}

function showError(message, offerVisible = false) {
	errorMsg.textContent = message;
	fallback.hidden = !offerVisible;
	errorBox.hidden = false;
}

document.getElementById("settings").addEventListener("click", (e) => {
	e.preventDefault();
	chrome.runtime.openOptionsPage();
	window.close();
});

for (const b of buttons) b.addEventListener("click", () => capture(b.dataset.mode));
fallback.addEventListener("click", () => capture("visible"));

// Delay: remembered between sessions, applies to the next capture (and shortcuts).
const delayButtons = [...document.querySelectorAll(".delay button")];
function showDelay(seconds) {
	for (const b of delayButtons) b.setAttribute("aria-checked", String(Number(b.dataset.delay) === seconds));
}
for (const b of delayButtons) {
	b.addEventListener("click", () => {
		const seconds = Number(b.dataset.delay);
		showDelay(seconds);
		delayWrite = setSettings({ delay: seconds });
	});
}

// Highlight and focus the remembered mode, so Enter repeats it.
getSettings().then((s) => {
	showDelay(s.delay);
	const mode = preferredMode(s);
	const btn = buttons.find((b) => b.dataset.mode === mode) || buttons[0];
	btn.classList.add("preferred");
	btn.focus();
});

// Arrow keys move between modes.
document.addEventListener("keydown", (e) => {
	if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
	const i = buttons.indexOf(document.activeElement);
	const next = buttons[(i + (e.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length];
	next.focus();
	e.preventDefault();
});
