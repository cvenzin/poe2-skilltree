import { Assets, Rectangle, Texture } from 'pixi.js';
import type { TreeData } from '../data/types';

// Raw shape of `assets/*.json` in the export — TexturePacker-style.
// See INSTRUCTIONS.md §2.
export interface AtlasJson {
  frames: Record<
    string,
    { frame: { x: number; y: number; w: number; h: number } }
  >;
  meta: {
    image: string;
    scale: string | number;
    size: { w: number; h: number };
  };
}

export interface LoadedAtlas {
  /** Stable name we use to look up the atlas (e.g. "frame", "skills", "background-warrior"). */
  name: string;
  /** Frame-key → sub-texture. The keys preserve their export prefix, e.g. `frame:KeystoneFrameAllocated`. */
  textures: Map<string, Texture>;
  /** URL of the backing WebP — used as the Assets cache key for unload. */
  imageUrl: string;
}

/**
 * Fetch an atlas JSON, load its WebP via Pixi's Assets cache, and slice one
 * sub-texture per frame entry.
 *
 * The returned `Texture`s share the same `TextureSource`, so the GPU memory
 * cost is one decoded WebP regardless of frame count.
 */
export async function loadAtlas(
  atlasJsonUrl: string,
  name: string
): Promise<LoadedAtlas> {
  const res = await fetch(atlasJsonUrl);
  if (!res.ok) {
    throw new Error(`atlas "${name}" json (${atlasJsonUrl}): ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as AtlasJson;

  // `meta.image` is relative to the JSON file's directory.
  const baseDir = atlasJsonUrl.slice(0, atlasJsonUrl.lastIndexOf('/') + 1);
  const imageUrl = baseDir + json.meta.image;

  // Pixi's Assets cache dedupes by URL — loading the same WebP twice across
  // atlases (shouldn't happen with our exports, but defensive) reuses the
  // existing TextureSource.
  const base = await Assets.load<Texture>(imageUrl);
  const source = base.source;

  // TexturePacker convention: `meta.scale` says "source images were exported
  // at this fraction of their intended display size" (typically 0.5 to keep
  // file size down). Setting Pixi's Texture `orig` rect to the design-time
  // dimensions makes every sprite created from these textures naturally
  // render at the correct size — no per-sprite scaling needed downstream.
  const metaScale = parseScale(json.meta.scale);

  const textures = new Map<string, Texture>();
  for (const [key, def] of Object.entries(json.frames)) {
    const tex = new Texture({
      source,
      frame: new Rectangle(def.frame.x, def.frame.y, def.frame.w, def.frame.h),
      orig: new Rectangle(0, 0, def.frame.w / metaScale, def.frame.h / metaScale),
    });
    textures.set(key, tex);
  }

  return { name, textures, imageUrl };
}

function parseScale(raw: string | number | undefined): number {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw;
  const n = Number.parseFloat(String(raw ?? ''));
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * The atlases shared by every version of the export. Per-class backgrounds
 * are added dynamically from `data.playableClassIndices` (see {@link loadAtlasBundle}).
 */
export const STATIC_ATLAS_NAMES = [
  'background',
  'frame',
  'group-background',
  'jewel-radius',
  'jewel',
  'line',
  'mastery-effect-active',
  'mastery-effect-disabled',
  'skills-disabled',
  'skills',
] as const;

export interface AtlasBundle {
  version: string;
  /** atlas name → LoadedAtlas */
  atlases: Map<string, LoadedAtlas>;
  /** Total number of distinct frame textures across all atlases — useful for diagnostics. */
  totalFrames: number;
  /** Destroy every sub-texture and unload every TextureSource. Call on version switch (§10.8). */
  destroy: () => void;
}

/**
 * Look up a single sprite across the bundle. Throws if the atlas or frame is
 * unknown — these are programmer errors, not user input.
 */
export function getFrame(bundle: AtlasBundle, atlasName: string, frameKey: string): Texture {
  const atlas = bundle.atlases.get(atlasName);
  if (!atlas) throw new Error(`atlas "${atlasName}" not loaded`);
  const tex = atlas.textures.get(frameKey);
  if (!tex) throw new Error(`atlas "${atlasName}" has no frame "${frameKey}"`);
  return tex;
}

/**
 * Load every atlas needed to render a version: the 10 static ones plus one
 * `background-<class>` per playable class. All requests run in parallel.
 */
export async function loadAtlasBundle(version: string, data: TreeData): Promise<AtlasBundle> {
  const baseUrl = `${import.meta.env.BASE_URL}trees/${version}/assets`;

  const classBackgroundNames = data.playableClassIndices
    .map((i) => data.classes[i])
    .filter((c): c is NonNullable<typeof c> => c !== undefined)
    .map((c) => `background-${c.name.toLowerCase()}`);

  const allNames = [...STATIC_ATLAS_NAMES, ...classBackgroundNames];
  const loaded = await Promise.all(
    allNames.map((name) => loadAtlas(`${baseUrl}/${name}.json`, name))
  );

  const atlases = new Map<string, LoadedAtlas>();
  let totalFrames = 0;
  for (const atlas of loaded) {
    atlases.set(atlas.name, atlas);
    totalFrames += atlas.textures.size;
  }

  return {
    version,
    atlases,
    totalFrames,
    destroy: () => {
      for (const atlas of loaded) {
        for (const tex of atlas.textures.values()) tex.destroy(false); // false: don't destroy shared source
        Assets.unload(atlas.imageUrl).catch(() => { /* swallow: unloading already-gone asset */ });
      }
    },
  };
}
