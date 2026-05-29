import { Assets, Rectangle, Texture } from 'pixi.js';

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
 * The atlases shared by every version of the export, loaded up front. Per-class
 * backgrounds are NOT here — they're lazy-loaded on demand via
 * {@link AtlasBundle.ensure} (the active class's is eager-loaded at boot).
 */
export const STATIC_ATLAS_NAMES = [
  'background',
  'frame',
  'group-background',
  'mastery-effect-active',
  'mastery-effect-disabled',
  'skills-disabled',
  'skills',
] as const;
// Deliberately omitted (shipped by the export but never sampled here, ~440 KB):
//   'jewel', 'jewel-radius' — this planner doesn't model jewels (see normalize.ts).
//   'line'                  — edges are drawn procedurally with Pixi Graphics, not sprites.
// Add back here if jewel/line-sprite rendering is implemented.

export interface AtlasBundle {
  version: string;
  /** atlas name → LoadedAtlas. Grows as lazy atlases (class backgrounds) load. */
  atlases: Map<string, LoadedAtlas>;
  /** Total number of distinct frame textures across all atlases — useful for diagnostics. */
  totalFrames: number;
  /**
   * Load an atlas on demand if it isn't already in the bundle (used for the
   * per-class backgrounds, which we lazy-load instead of fetching all up front).
   * Concurrent calls for the same name share one request. Resolves `true` if the
   * atlas was newly added, `false` if it was already present. Rejects if the
   * fetch fails — callers that render decoration should swallow it.
   */
  ensure: (name: string) => Promise<boolean>;
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

/** Load a specific set of atlases by name. All requests run in parallel. */
export async function loadAtlases(
  version: string,
  names: readonly string[]
): Promise<LoadedAtlas[]> {
  const baseUrl = `${import.meta.env.BASE_URL}trees/${version}/assets`;
  return Promise.all(names.map((name) => loadAtlas(`${baseUrl}/${name}.json`, name)));
}

/** The `background-<class>` atlas name for a class. The single source of truth
 *  for this convention, shared by the loader, the lazy `ensure`, and the renderer. */
export function classBackgroundName(className: string): string {
  return `background-${className.toLowerCase()}`;
}

/** Destroy a set of loaded atlases: free each sub-texture and unload its backing WebP. */
export function destroyAtlases(loaded: readonly LoadedAtlas[]): void {
  for (const atlas of loaded) {
    for (const tex of atlas.textures.values()) tex.destroy(false); // false: don't destroy shared source
    Assets.unload(atlas.imageUrl).catch(() => { /* swallow: unloading already-gone asset */ });
  }
}

/** Assemble a renderable bundle from already-loaded atlases. The bundle can
 *  grow afterwards via {@link AtlasBundle.ensure} (lazy class backgrounds). */
export function buildAtlasBundle(version: string, initial: LoadedAtlas[]): AtlasBundle {
  // `loaded` is mutable so lazily-added atlases are covered by `destroy`.
  const loaded = [...initial];
  const atlases = new Map<string, LoadedAtlas>();
  let totalFrames = 0;
  for (const atlas of loaded) {
    atlases.set(atlas.name, atlas);
    totalFrames += atlas.textures.size;
  }

  // Dedupe concurrent `ensure(name)` calls so a quick A→B→A class switch (or
  // an eager boot load racing the first render) issues at most one request.
  const inFlight = new Map<string, Promise<boolean>>();
  let destroyed = false;

  const bundle: AtlasBundle = {
    version,
    atlases,
    totalFrames,
    ensure: (name) => {
      if (atlases.has(name)) return Promise.resolve(false);
      const existing = inFlight.get(name);
      if (existing) return existing;

      const p = loadAtlases(version, [name]).then(([atlas]) => {
        inFlight.delete(name);
        // Bundle was torn down (version switch) mid-load — don't attach to a
        // dead bundle; release the texture we just decoded instead.
        if (destroyed || !atlas) {
          if (atlas) destroyAtlases([atlas]);
          return false;
        }
        if (atlases.has(name)) return false; // raced with another caller
        loaded.push(atlas);
        atlases.set(atlas.name, atlas);
        bundle.totalFrames += atlas.textures.size;
        return true;
      });
      // Drop the in-flight entry on failure too, so a later retry can re-request.
      p.catch(() => inFlight.delete(name));
      inFlight.set(name, p);
      return p;
    },
    destroy: () => {
      destroyed = true;
      destroyAtlases(loaded);
    },
  };

  return bundle;
}
