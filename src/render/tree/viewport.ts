import { Application } from 'pixi.js';
import type { WorldSize, NodeBounds, MountContext } from './types';
import { Viewport } from 'pixi-viewport';

const MAX_ZOOM = 6;

/** Read the user's `prefers-reduced-motion: reduce` setting at mount time.
 *  We don't live-update on change — reloading the page picks up a flip. */
export function prefersReducedMotion(): boolean {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

export async function createPixiApp(host: HTMLDivElement): Promise<Application> {
  const app = new Application();
  await app.init({
    resizeTo: host,
    antialias: true,
    backgroundAlpha: 0,           // page background bleeds through
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
    preference: 'webgl',          // WebGPU is not yet widely available
  });
  return app;
}

export function createViewport(app: Application, world: WorldSize): Viewport {
  const vp = new Viewport({
    screenWidth: app.renderer.width,
    screenHeight: app.renderer.height,
    worldWidth: world.width,
    worldHeight: world.height,
    events: app.renderer.events,
  });
  app.stage.addChild(vp);
  return vp;
}

export function configureViewport(vp: Viewport, app: Application, world: WorldSize, reduceMotion: boolean): void {
  const fitScale = computeFitScale(app, world);
  vp.drag({ mouseButtons: 'left' })
    // Reduced motion: kill the wheel smoothing so each tick zooms instantly.
    .wheel({ smooth: reduceMotion ? 0 : 10, percent: 0.1, interrupt: true })
    .pinch({ percent: 1 });
  // Reduced motion: skip drag inertia entirely. Pan stops where the cursor
  // releases instead of gliding.
  if (!reduceMotion) vp.decelerate({ friction: 0.94, bounce: 0.6, minSpeed: 0.01 });
  vp.clampZoom({ minScale: fitScale, maxScale: MAX_ZOOM })
    .clamp({
      left: 0,
      right: world.width,
      top: 0,
      bottom: world.height,
      underflow: 'center',
    });
}

/** Breathing room around the main tree on initial fit (fraction of its bbox). */
const INITIAL_FIT_PADDING = 0.06;

/**
 * Initial camera state on (re)load. If a `saved` camera is supplied (the user
 * just switched class/ascendancy without unmounting the canvas) restore that
 * — clamps already configured on the viewport keep it in range. Otherwise
 * frame the *visible main tree* (not the full padded world, which includes
 * room for ascendancy backdrops). Falls back to `vp.fit(true)` if no main-tree
 * bbox is available.
 */
export function setInitialCamera(
  vp: Viewport,
  app: Application,
  world: WorldSize,
  mainTree: NodeBounds | null,
  saved: { x: number; y: number; scale: number } | null,
): void {
  if (saved) {
    vp.scale.set(saved.scale);
    vp.moveCenter(saved.x, saved.y);
    return;
  }
  if (!mainTree) {
    vp.fit(true);
    return;
  }
  const w = mainTree.maxX - mainTree.minX;
  const h = mainTree.maxY - mainTree.minY;
  const fitW = w * (1 + 2 * INITIAL_FIT_PADDING);
  const fitH = h * (1 + 2 * INITIAL_FIT_PADDING);
  const scale = Math.min(app.renderer.width / fitW, app.renderer.height / fitH);
  vp.scale.set(scale);
  // worldContainer is offset by (-world.minX, -world.minY), so a world-space
  // centre (mx, my) lives at viewport coord (mx - world.minX, my - world.minY).
  const cx = (mainTree.minX + mainTree.maxX) / 2 - world.minX;
  const cy = (mainTree.minY + mainTree.maxY) / 2 - world.minY;
  vp.moveCenter(cx, cy);
}

export function computeFitScale(app: Application, world: WorldSize): number {
  return Math.min(app.renderer.width / world.width, app.renderer.height / world.height);
}

export function attachResizeObserver(
  host: HTMLDivElement,
  app: Application,
  vp: Viewport,
  world: WorldSize,
  ctx: MountContext
): ResizeObserver {
  const ro = new ResizeObserver(() => {
    vp.resize(app.renderer.width, app.renderer.height, world.width, world.height);
    const fitScale = computeFitScale(app, world);
    ctx.fitScale = fitScale;
    vp.clampZoom({ minScale: fitScale, maxScale: MAX_ZOOM });
    // If the window shrank past the current camera state, the tree no longer
    // fits — animate back to fit-to-screen so it stays in view.
    if (vp.scale.x < fitScale) {
      vp.animate({
        scale: fitScale,
        time: ctx.reduceMotion ? 0 : 200,
        ease: 'easeInOutCubic',
      });
    }
  });
  ro.observe(host);
  return ro;
}
