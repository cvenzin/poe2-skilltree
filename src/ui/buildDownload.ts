import type { GggBuild } from '../state/gggBuild';

/** Trigger the browser's native download flow (also available in mobile Files).
 * Keep the Blob alive briefly so mobile browsers can finish opening/saving it. */
export function downloadBuildFile(build: GggBuild, filename: string): void {
  const blob = new Blob([JSON.stringify(build, null, 2) + '\n'], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    globalThis.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
