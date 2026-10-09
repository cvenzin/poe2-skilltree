import { Container, Graphics } from 'pixi.js';
import { ringRadiusForWrap } from './nodes';

/**
 * Per-tree-state visuals for search:
 *   - Cyan ring sprites around every matched node, pulsed via the ticker
 *     (alpha handled in the ticker callback, not here).
 *   - Non-matched node wraps dim to 0.35 alpha while a search is active;
 *     full alpha when the match set is empty.
 *
 * Ring positions are computed via `worldContainer.toLocal(wrap.getGlobalPosition())`
 * so the same code path handles main-tree nodes (children of worldContainer)
 * and ascendancy-overlay nodes (children of the overlay's transformed
 * container) without needing the ascendancy transform here.
 */
export function applySearchHighlight(
  matches: readonly string[],
  cursor: number,
  wraps: ReadonlyMap<string, Container>,
  layer: Container,
  worldContainer: Container,
  viewportScale: number,
): void {
  const matchSet = new Set(matches);
  const dim = matchSet.size > 0;
  for (const [key, wrap] of wraps) {
    wrap.alpha = dim && !matchSet.has(key) ? 0.35 : 1;
  }

  for (const child of [...layer.children]) child.destroy({ children: true });
  layer.removeChildren();

  const focusedKey = cursor >= 0 ? matches[cursor] : null;
  for (const key of matches) {
    const wrap = wraps.get(key);
    if (!wrap) continue;
    // Defence in depth — SearchInput already pre-filters constraint-hidden
    // matches, but if a stale match leaks through (race between allocation
    // change and search re-run) don't ring an invisible node.
    if (!wrap.visible) continue;
    const isFocused = key === focusedKey;
    const pos = worldContainer.toLocal(wrap.getGlobalPosition());
    // Size the ring to the node's own visual bounds (notables, keystones,
    // and jewel sockets are all different diameters) plus a small visible
    // gap outside the frame.
    const radius = ringRadiusForWrap(wrap);
    const ring = new Graphics() as SearchRing;
    // Stash the geometry so the zoom listener can redraw the stroke without
    // re-measuring bounds or re-resolving the focused match.
    ring._ringMeta = { x: pos.x, y: pos.y, radius, focused: isFocused };
    drawSearchRing(ring, viewportScale);
    // Don't let the ring intercept clicks meant for the node underneath.
    ring.eventMode = 'none';
    layer.addChild(ring);
  }

  // Reset alpha so the pulse re-takes effect on the next ticker tick.
  layer.alpha = 1;
}

/** Base stroke widths in *screen* pixels. The world-space width is divided by
 *  the current viewport scale on draw so the ring stays equally visible at
 *  every zoom level (otherwise it would shrink to a hairline when zoomed out). */
const SEARCH_RING_WIDTH = 3;

const SEARCH_RING_FOCUSED_WIDTH = 5;

type SearchRing = Graphics & {
  _ringMeta: { x: number; y: number; radius: number; focused: boolean };
};

function drawSearchRing(ring: SearchRing, viewportScale: number): void {
  const { x, y, radius, focused } = ring._ringMeta;
  const baseWidth = focused ? SEARCH_RING_FOCUSED_WIDTH : SEARCH_RING_WIDTH;
  ring.clear()
    .circle(x, y, radius)
    .stroke({ color: 0x40e0e0, width: baseWidth / viewportScale, alpha: 1 });
}

/** Redraw every ring's stroke for the current zoom. Called from the pulse
 *  ticker whenever `viewport.scale.x` changes so the rings keep a constant
 *  on-screen thickness regardless of zoom level. */
export function refreshSearchRingStrokes(layer: Container, viewportScale: number): void {
  for (const child of layer.children) {
    drawSearchRing(child as SearchRing, viewportScale);
  }
}
