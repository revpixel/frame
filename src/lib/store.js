// Hands captures from the service worker to the result page through IndexedDB.
// IndexedDB is local to this extension's origin; nothing is synced or uploaded.
// A capture is deleted when its result tab closes, and anything older than
// MAX_AGE is swept whenever a new capture starts.

const DB = "frame";
const STORE = "captures";
const MAX_AGE = 24 * 60 * 60 * 1000;

function open() {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB, 1);
		req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

async function tx(mode, fn) {
	const db = await open();
	try {
		return await new Promise((resolve, reject) => {
			const t = db.transaction(STORE, mode);
			const req = fn(t.objectStore(STORE));
			t.oncomplete = () => resolve(req.result);
			t.onerror = () => reject(t.error);
			t.onabort = () => reject(t.error);
		});
	} finally {
		db.close();
	}
}

/**
 * @param {{ id: string, created: number, parts: Blob[], width: number, heights: number[],
 *           mode: string, url: string, title: string, notice?: string }} record
 */
export function putCapture(record) {
	return tx("readwrite", (s) => s.put(record));
}

export function getCapture(id) {
	return tx("readonly", (s) => s.get(id));
}

export function deleteCapture(id) {
	return tx("readwrite", (s) => s.delete(id));
}

export async function sweepOld(now = Date.now()) {
	const db = await open();
	try {
		await new Promise((resolve, reject) => {
			const t = db.transaction(STORE, "readwrite");
			const req = t.objectStore(STORE).openCursor();
			req.onsuccess = () => {
				const c = req.result;
				if (!c) return;
				if (!(now - c.value.created < MAX_AGE)) c.delete();
				c.continue();
			};
			t.oncomplete = resolve;
			t.onerror = () => reject(t.error);
		});
	} finally {
		db.close();
	}
}
