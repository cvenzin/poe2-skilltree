const PULSE_DURATION_MS = 1000;

/** One gentle pulse per result update, ending at full opacity without a timer.
 * update() runs before rendering and reports whether another frame is needed. */
export function createSearchPulse(layer: { alpha: number }) {
  let startedAt: number | null = null;
  return {
    restart() {
      startedAt = performance.now();
      layer.alpha = 1;
    },
    update(enabled: boolean): boolean {
      const elapsed = startedAt === null ? PULSE_DURATION_MS : performance.now() - startedAt;
      if (!enabled || elapsed >= PULSE_DURATION_MS) {
        startedAt = null;
        layer.alpha = 1;
        return false;
      }
      // Start and finish at 1, fading to 0.6 halfway through the pulse.
      layer.alpha = 0.8 + 0.2 * Math.cos(elapsed / PULSE_DURATION_MS * 2 * Math.PI);
      return true;
    },
  };
}
