// Capture delay countdown. Pure logic with injected timing, so it can be tested
// without waiting real seconds.

/**
 * Counts down `seconds`, calling onTick(secondsLeft) at the start of each second.
 * Checks isCancelled() every `step` ms so Esc feels instant.
 * @returns {Promise<boolean>} true if it ran to the end, false if cancelled
 */
export async function countdown(seconds, { onTick = () => {}, isCancelled = () => false, sleep, step = 100 }) {
	for (let left = seconds; left > 0; left--) {
		if (isCancelled()) return false;
		await onTick(left);
		for (let t = 0; t < 1000; t += step) {
			if (isCancelled()) return false;
			await sleep(Math.min(step, 1000 - t));
		}
	}
	return !isCancelled();
}
