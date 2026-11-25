// Launches a Chromium browser for dev tooling. Uses PUPPETEER_EXECUTABLE_PATH if set,
// otherwise the local Edge/Chrome install.
import puppeteer from "puppeteer";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Prefer Chrome for Testing from the puppeteer cache: branded Chrome/Edge may block automation.
function cachedChrome() {
	const dir = join(homedir(), ".cache", "puppeteer", "chrome");
	try {
		for (const build of readdirSync(dir).sort().reverse()) {
			for (const sub of ["chrome-win64/chrome.exe", "chrome-linux64/chrome", "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing", "chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"]) {
				const p = join(dir, build, sub);
				if (existsSync(p)) return p;
			}
		}
	} catch {}
	return null;
}

const CANDIDATES = [
	process.env.PUPPETEER_EXECUTABLE_PATH,
	cachedChrome(),
	"C:/Program Files/Google/Chrome/Application/chrome.exe",
	`${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
	"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	"/usr/bin/google-chrome",
	"/usr/bin/chromium",
].filter(Boolean);

export function executablePath() {
	return CANDIDATES.find((p) => existsSync(p));
}

export function launch(opts = {}) {
	return puppeteer.launch({ executablePath: executablePath(), headless: true, pipe: true, defaultViewport: null, ...opts });
}
