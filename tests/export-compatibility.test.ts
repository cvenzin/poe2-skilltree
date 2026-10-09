import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RawTreeData } from '../src/data/types';
import { normalizeTreeData, startNodeKeyForClass } from '../src/data/normalize';
import { VERSIONS } from '../src/data/versions';
import { applyPathAllocation, bfsShortestPath, buildBlockedKeys, resolveCascade } from '../src/interaction/pathing';
import { spritesForNode } from '../src/render/frameForNode';
import { EMPTY_ALLOCATION, buildAllocation, pruneAllocation, removeKey } from '../src/state/allocation';
import { decodeShareHash, encodeShareHash, reconcileShareHash } from '../src/state/shareHash';

interface Atlas {
  frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }>;
  meta: { image: string; scale: string; size: { w: number; h: number } };
}

describe.each(VERSIONS)('bundled export %s', (version) => {
  const folder = resolve('public', 'trees', version);
  const data = normalizeTreeData(JSON.parse(readFileSync(resolve(folder, 'data.json'), 'utf8')) as RawTreeData);

  it('has valid graph endpoints and starts for every playable class', () => {
    expect(data.playableClassIndices.length).toBeGreaterThan(0);
    for (const index of data.playableClassIndices) {
      expect(data.startNodeByClassIndex.has(index)).toBe(true);
    }
    const missing = data.edges.filter((edge) => !data.nodes[edge.from] || !data.nodes[edge.to]);
    expect(missing).toEqual([]);
  });

  it('provides images and in-bounds atlas frames for all rendered node states', () => {
    const assets = resolve(folder, 'assets');
    const atlases = new Map<string, Atlas>();
    for (const filename of readdirSync(assets).filter((name) => name.endsWith('.json'))) {
      const atlas = JSON.parse(readFileSync(resolve(assets, filename), 'utf8')) as Atlas;
      expect(existsSync(resolve(assets, atlas.meta.image)), filename).toBe(true);
      expect(Number(atlas.meta.scale), filename).toBeGreaterThan(0);
      const invalid = Object.entries(atlas.frames).filter(([, { frame: f }]) =>
        f.x < 0 || f.y < 0 || f.w <= 0 || f.h <= 0 ||
        f.x + f.w > atlas.meta.size.w || f.y + f.h > atlas.meta.size.h);
      expect(invalid, filename).toEqual([]);
      atlases.set(filename.slice(0, -5), atlas);
    }
    for (const index of data.playableClassIndices) {
      expect(atlases.has(`background-${data.classes[index]!.name.toLowerCase()}`)).toBe(true);
    }
    const missing: string[] = [];
    for (const [key, node] of Object.entries(data.nodes)) {
      if (node.ascendancyId && !data.playableAscendancyIds.has(node.ascendancyId)) continue;
      for (const state of ['idle', 'preview', 'allocated'] as const) {
        const sprites = spritesForNode(node, state);
        for (const sprite of [sprites.icon, sprites.frame]) {
          if (sprite && !atlases.get(sprite.atlas)?.frames[sprite.key]) missing.push(`${key}/${state}/${sprite.key}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('previews, commits, cascades and shares an actual weapon-set branch', () => {
    const start = startNodeKeyForClass('Witch', data)!;
    const blocked = buildBlockedKeys(data, start, null, new Set());
    const candidates = Object.keys(data.nodes).filter((key) => {
      const node = data.nodes[key]!;
      return /^\d+$/.test(key) && !blocked.has(key) && !node.ascendancyId && !node.isMastery && !node.classStartIndex;
    });
    const path = candidates.map((key) => bfsShortestPath(data, new Set(), start, key, blocked))
      .find((result) => result && result.length >= 4 && result.length <= 8)!;
    expect(path).toBeDefined();
    let allocation = applyPathAllocation(data, EMPTY_ALLOCATION, path.slice(0, 2), [], 'shared');
    allocation = applyPathAllocation(data, allocation, path.slice(2), [], 'set1');
    expect(resolveCascade(data, allocation, new Set([start]))).toBe(allocation);
    expect(resolveCascade(data, removeKey(allocation, path[0]!), new Set([start])))
      .toEqual(buildAllocation([], [], []));
    const decoded = decodeShareHash(encodeShareHash({ version, className: 'Witch', ascendancyId: null,
      sharedKeys: [...allocation.shared], set1Keys: [...allocation.set1], set2Keys: [] }))!;
    const restored = reconcileShareHash(decoded, data)!;
    expect(new Set(restored.shared)).toEqual(allocation.shared);
    expect(new Set(restored.set1)).toEqual(allocation.set1);
    const locked = buildAllocation(data.constrainedNodeKeys, [], []);
    expect(pruneAllocation(locked, null, data).shared.size).toBe(0);
  });
});
