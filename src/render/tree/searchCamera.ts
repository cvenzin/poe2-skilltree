import { Viewport } from 'pixi-viewport';
import type { WorldSize } from './types';
import { Container } from 'pixi.js';
import { useStore } from '../../state/store';

const SEARCH_MAX_ZOOM = 2.5;

const SEARCH_PADDING_FRACTION = 0.15;

/**
 * Camera transitions tied to search state changes. Three cases:
 *   1. Search just became non-empty (`prev.searchQuery === '' && next != ''`):
 *      capture the camera into `preSearchCamera` so Esc can restore it.
 *   2. Matches or cursor changed (with matches > 0): frame the bbox of the
 *      relevant subset (cursor-focused = single node, else all matches),
 *      capped by `SEARCH_MAX_ZOOM`, floored at fit-to-screen.
 *   3. Search just cleared (`prev.searchQuery !== '' && next === ''`) AND a
 *      `preSearchCamera` snapshot exists: animate back to it.
 */
export function handleSearchCameraTransition(
  vp: Viewport,
  world: WorldSize,
  fitScale: number,
  wraps: ReadonlyMap<string, Container>,
  worldContainer: Container,
  reduceMotion: boolean,
  prev: { searchQuery: string; searchMatches: readonly string[]; searchCursor: number; preSearchCamera: { x: number; y: number; scale: number } | null },
  next: { searchQuery: string; searchMatches: readonly string[]; searchCursor: number; preSearchCamera: { x: number; y: number; scale: number } | null },
): void {
  const becameActive = prev.searchQuery === '' && next.searchQuery !== '';
  const becameCleared = prev.searchQuery !== '' && next.searchQuery === '';
  const subsetChanged =
    next.searchQuery !== '' &&
    (prev.searchMatches !== next.searchMatches || prev.searchCursor !== next.searchCursor);

  if (becameActive) {
    // Capture current camera once, on the rising edge. The store ignores
    // re-captures while a snapshot is already set, so repeated calls are safe.
    useStore.getState().capturePreSearchCamera({
      x: vp.center.x,
      y: vp.center.y,
      scale: vp.scale.x,
    });
  }

  if (becameCleared && prev.preSearchCamera) {
    vp.animate({
      position: { x: prev.preSearchCamera.x, y: prev.preSearchCamera.y },
      scale: prev.preSearchCamera.scale,
      time: reduceMotion ? 0 : 350,
      ease: 'easeInOutCubic',
    });
    return;
  }

  if ((becameActive || subsetChanged) && next.searchMatches.length > 0) {
    frameCameraOnMatches(vp, world, fitScale, wraps, worldContainer, reduceMotion, next.searchMatches, next.searchCursor);
  }
}

function frameCameraOnMatches(
  vp: Viewport,
  world: WorldSize,
  fitScale: number,
  wraps: ReadonlyMap<string, Container>,
  worldContainer: Container,
  reduceMotion: boolean,
  matches: readonly string[],
  cursor: number,
): void {
  const keys = cursor >= 0
    ? (matches[cursor] !== undefined ? [matches[cursor] as string] : [])
    : matches;
  const points: { x: number; y: number }[] = [];
  for (const key of keys) {
    const wrap = wraps.get(key);
    if (!wrap) continue;
    const p = worldContainer.toLocal(wrap.getGlobalPosition());
    points.push({ x: p.x, y: p.y });
  }
  if (points.length === 0) return;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const w = Math.max(maxX - minX, 1);
  const h = Math.max(maxY - minY, 1);
  const padX = w * SEARCH_PADDING_FRACTION;
  const padY = h * SEARCH_PADDING_FRACTION;
  const boxW = w + 2 * padX;
  const boxH = h + 2 * padY;
  let scale = Math.min(vp.screenWidth / boxW, vp.screenHeight / boxH);
  scale = Math.min(scale, SEARCH_MAX_ZOOM);
  scale = Math.max(scale, fitScale);

  // worldContainer is at position (-world.minX, -world.minY) inside the
  // viewport, so a worldContainer-local point (cx, cy) lives at viewport
  // coord (cx - world.minX, cy - world.minY). vp.animate's `position` is in
  // viewport coords.
  const centerX = (minX + maxX) / 2 - world.minX;
  const centerY = (minY + maxY) / 2 - world.minY;
  vp.animate({
    position: { x: centerX, y: centerY },
    scale,
    time: reduceMotion ? 0 : 500,
    ease: 'easeInOutCubic',
  });
}
