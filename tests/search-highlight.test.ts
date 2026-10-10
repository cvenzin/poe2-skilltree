import { describe, expect, it } from 'vitest';
import { buildSearchRingGeometry } from '../src/render/tree/searchHighlight';

const VERTICES_PER_RING = 49 * 2;
const INDICES_PER_RING = 48 * 6;

describe('search highlight geometry', () => {
  it('builds one combined annulus mesh from ring inputs', () => {
    const geometry = buildSearchRingGeometry([
      { key: 'first', x: 25, y: 40, radius: 30 },
      { key: 'second', x: 110, y: 215, radius: 30 },
    ]);

    expect(geometry.positions).toHaveLength(2 * VERTICES_PER_RING * 2);
    expect(geometry.positions[0]).toBeCloseTo(55);
    expect(geometry.positions[VERTICES_PER_RING * 2]).toBeCloseTo(140);
    expect(geometry.indices).toHaveLength(2 * INDICES_PER_RING);

    geometry.destroy(true);
  });

  it('creates empty geometry when there are no matches', () => {
    const geometry = buildSearchRingGeometry([]);

    expect(geometry.positions).toHaveLength(0);
    expect(geometry.indices).toHaveLength(0);

    geometry.destroy(true);
  });
});
