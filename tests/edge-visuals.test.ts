import { Container, Shader } from 'pixi.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { edgeScreenWidth } from '../src/render/tree/edgeStyle';
import { buildEdgeStrokeGeometry, buildEdgeStrokePath } from '../src/render/tree/edgeStrokeGeometry';
import { identityTransform, resolveDrawableEdge } from '../src/render/tree/edgeGeometry';
import { createEdgeStroke } from '../src/render/tree/edgeStroke';
import { makeTree } from './fixtures/tree';

afterEach(() => vi.restoreAllMocks());

describe('edge stroke sizing', () => {
  it('uses CSS-pixel targets at overview, with equal weapon-set widths and readable minima', () => {
    for (const reference of [0.03, 0.1, 0.5]) {
      expect(edgeScreenWidth('idle', reference, reference)).toBe(1.65);
      expect(edgeScreenWidth('preview', reference, reference)).toBe(3);
      for (const state of ['allocated', 'set1', 'set2'] as const) {
        expect(edgeScreenWidth(state, reference, reference)).toBeCloseTo(2.43);
        expect(edgeScreenWidth(state, reference / 100, reference)).toBe(1.25);
        expect(edgeScreenWidth(state, reference * 100, reference)).toBe(3.4);
      }
    }
  });

  it('tapers only allocated paths at far zoom and preserves normal widths and preview', () => {
    for (const state of ['allocated', 'set1', 'set2'] as const) {
      expect(edgeScreenWidth(state, 0.05, 0.1)).toBeCloseTo(2.7 * 0.5 ** 0.35 * 0.9);
      expect(edgeScreenWidth(state, 0.15, 0.1)).toBeCloseTo(2.7 * 1.5 ** 0.35 * 0.95);
      expect(edgeScreenWidth(state, 0.2, 0.1)).toBe(3.4);
      for (const boundary of [0.1, 0.2]) {
        expect(Math.abs(edgeScreenWidth(state, boundary - 1e-8, 0.1) - edgeScreenWidth(state, boundary + 1e-8, 0.1)))
          .toBeLessThan(0.00001);
      }
    }
    // Neither untouched state receives the selected-path taper at any zoom.
    expect(edgeScreenWidth('idle', 0.05, 0.1)).toBeCloseTo(1.65 * 0.5 ** 0.35);
    expect(edgeScreenWidth('preview', 0.05, 0.1)).toBeCloseTo(3 * 0.5 ** 0.35);
    expect(edgeScreenWidth('idle', 0.2, 0.1)).toBeCloseTo(1.65 * 2 ** 0.35);
    expect(edgeScreenWidth('preview', 0.2, 0.1)).toBe(3.6);
  });

  it('scales continuously but grows more slowly than the nodes', () => {
    const widths = [0.01, 0.025, 0.05, 0.1, 0.2, 0.5, 1, 6]
      .map((zoom) => edgeScreenWidth('allocated', zoom, 0.1));
    expect(widths).toEqual([...widths].sort((a, b) => a - b));
    expect(edgeScreenWidth('allocated', 0.2, 0.1)).toBeLessThan(2 * 2.7);
    expect(edgeScreenWidth('idle', 0, 0)).toBeGreaterThan(0);
  });
});

describe('cached edge paths', () => {
  function pair(ax: number, ay: number, bx: number, by: number) {
    const data = makeTree({ '1': { x: ax, y: ay, icon: 'test' }, '2': { x: bx, y: by, icon: 'test' } });
    return resolveDrawableEdge(data.nodes['1'], data.nodes['2'])!;
  }

  it.each([[100, 0], [0, 100], [60, 80], [-60, 80]])('has unit perpendicular normals for angle %s/%s', (x, y) => {
    const path = buildEdgeStrokePath(pair(0, 0, x, y), { from: '1', to: '2' }, identityTransform);
    expect(path.positions).toEqual([0, 0, x, y]);
    expect(Math.hypot(path.normals[0]!, path.normals[1]!)).toBeCloseTo(1);
    expect(path.normals[0]! * x + path.normals[1]! * y).toBeCloseTo(0);
    const geometry = buildEdgeStrokeGeometry([path, path]);
    expect(geometry.positions).toHaveLength(16);
    expect(geometry.indices).toHaveLength(12);
    // Separate edges never acquire a triangle connecting them.
    expect([...geometry.indices.slice(0, 6)].every((index) => index < 4)).toBe(true);
    expect([...geometry.indices.slice(6)].every((index) => index >= 4)).toBe(true);
    geometry.destroy(true);
  });

  it('keeps the minor arc, precise endpoints and ascendancy translation', () => {
    const edge = { from: '1', to: '2', orbitX: 0, orbitY: 0 };
    const path = buildEdgeStrokePath(pair(100, 0, 0, 100), edge, identityTransform);
    expect(path.positions.length).toBeGreaterThan(4);
    expect(path.positions.slice(0, 2)).toEqual([100, 0]);
    expect(path.positions.at(-2)).toBeCloseTo(0);
    expect(path.positions.at(-1)).toBeCloseTo(100);
    for (let i = 0; i < path.positions.length; i += 2) {
      expect(Math.hypot(path.positions[i]!, path.positions[i + 1]!)).toBeCloseTo(100);
    }
    const translated = buildEdgeStrokePath(pair(100, 0, 0, 100), edge, { tx: (x) => x - 50, ty: (y) => y + 25 });
    expect(translated.positions[0]).toBe(50);
    expect(translated.positions[1]).toBe(25);
    expect(translated.positions.at(-2)).toBeCloseTo(-50);
    expect(translated.positions.at(-1)).toBeCloseTo(125);
  });

  it('retains the straight-line fallback for invalid arc centers', () => {
    const path = buildEdgeStrokePath(pair(100, 0, 0, 10), { from: '1', to: '2', orbitX: 0, orbitY: 0 }, identityTransform);
    expect(path.positions).toEqual([100, 0, 0, 10]);
  });
});

describe('edge resource reuse', () => {
  it('keeps buffers on zoom/unchanged state and releases resources with the parent', () => {
    // Node has no WebGL context; browser QA checks real shader compilation.
    vi.spyOn(Shader, 'from').mockImplementation(() => ({ destroy: vi.fn() }) as unknown as Shader);
    const stroke = createEdgeStroke('allocated');
    const parent = new Container();
    parent.addChild(stroke.mesh);
    const path = { positions: [0, 0, 100, 0], normals: [0, 1, 0, 1] };
    stroke.setPaths([path]);
    const geometry = stroke.mesh.geometry;
    const shader = stroke.mesh.shader!;
    const destroyGeometry = vi.spyOn(geometry, 'destroy');
    const destroyShader = vi.spyOn(shader, 'destroy');
    const positionData = geometry.positions;
    const indices = geometry.indices;
    stroke.setZoom(0.1, 0.1, 1);
    stroke.setZoom(6, 0.1, 2);
    stroke.setPaths([path]);
    expect(stroke.mesh.geometry).toBe(geometry);
    expect(geometry.positions).toBe(positionData);
    expect(geometry.indices).toBe(indices);
    expect(destroyGeometry).not.toHaveBeenCalled();
    parent.destroy({ children: true });
    expect(destroyGeometry).toHaveBeenCalledOnce();
    expect(destroyShader).toHaveBeenCalledOnce();
  });
});
