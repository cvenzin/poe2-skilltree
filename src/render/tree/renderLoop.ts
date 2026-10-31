import { UPDATE_PRIORITY } from 'pixi.js';
import type { Application } from 'pixi.js';
import type { Viewport } from 'pixi-viewport';

/** Sleep after the camera settles; input and scene changes request a new frame.
 * The viewport uses noTicker so this loop owns its updates and their cleanup. */
export function startRenderLoop(app: Application, viewport: Viewport, isAnimating: () => boolean) {
  // High-refresh displays otherwise redraw the whole tree up to 360 times/s.
  // Pixi keeps elapsed-time animation updates correct when skipping frames.
  app.ticker.maxFPS = 60;
  let destroyed = false;
  let invalidated = false;
  const requestRender = () => {
    if (destroyed) return;
    invalidated = true;
    if (!document.hidden) app.ticker.start();
  };
  const beginFrame = () => { invalidated = false; };
  const updateCamera = () => { viewport.update(app.ticker.deltaMS); };
  const finishFrame = () => {
    const cameraChanged = viewport.dirty;
    viewport.dirty = false;
    // Run one settling frame after movement. This lets viewport emit its end
    // events and keeps wheel smoothing/inertia alive until they finish.
    if (!cameraChanged && !invalidated && !isAnimating() &&
      !viewport.plugins.get('animate', true) && !viewport.plugins.get('decelerate', true)?.isActive()) {
      app.ticker.stop();
    }
  };
  app.ticker.add(beginFrame, undefined, UPDATE_PRIORITY.HIGH);
  // Update before the normal-priority overlay callbacks read the camera scale.
  app.ticker.add(updateCamera, undefined, UPDATE_PRIORITY.HIGH - 1);
  // Application.render runs at LOW; stop only after the final image is drawn.
  app.ticker.add(finishFrame, undefined, UPDATE_PRIORITY.UTILITY);

  const inputEvents = ['moved', 'zoomed', 'pointerdown', 'pointerup', 'pointerupoutside', 'pointercancel'] as const;
  for (const event of inputEvents) viewport.on(event, requestRender);
  // A smoothed wheel event schedules movement for a future viewport update.
  app.canvas.addEventListener('wheel', requestRender, { passive: true });
  app.canvas.addEventListener('webglcontextrestored', requestRender);
  app.renderer.on('resize', requestRender);
  const onVisibility = () => {
    if (document.hidden) app.ticker.stop();
    else requestRender();
  };
  document.addEventListener('visibilitychange', onVisibility);
  requestRender();

  return {
    requestRender,
    destroy: () => {
      destroyed = true;
      app.ticker.stop();
      app.ticker.remove(beginFrame);
      app.ticker.remove(updateCamera);
      app.ticker.remove(finishFrame);
      for (const event of inputEvents) viewport.off(event, requestRender);
      app.canvas.removeEventListener('wheel', requestRender);
      app.canvas.removeEventListener('webglcontextrestored', requestRender);
      app.renderer.off('resize', requestRender);
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
