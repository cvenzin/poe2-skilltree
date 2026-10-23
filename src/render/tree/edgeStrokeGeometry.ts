import { GraphicsPath, MeshGeometry, Polygon } from 'pixi.js';
import type { Edge } from '../../data/types';
import { traceEdge } from './edgeGeometry';
import type { CoordTransform, DrawableEdge } from './edgeGeometry';

export interface EdgeStrokePath {
  positions: number[];
  normals: number[];
}

/** Use Pixi's existing arc tessellation and the same trace/degenerate fallback
 * as Graphics strokes. Cache centerlines and unit-width miters once per edge. */
export function buildEdgeStrokePath(pair: DrawableEdge, edge: Edge, transform: CoordTransform): EdgeStrokePath {
  const path = new GraphicsPath();
  traceEdge(path, pair.a, pair.b, edge, transform);
  const shape = path.shapePath.shapePrimitives[0]?.shape;
  const points = shape instanceof Polygon ? shape.points : [];
  const positions: number[] = [];
  for (let i = 0; i < points.length; i += 2) {
    if (i > 0 && Math.hypot(points[i]! - positions.at(-2)!, points[i + 1]! - positions.at(-1)!) < 0.001) continue;
    positions.push(points[i]!, points[i + 1]!);
  }
  const normals: number[] = [];
  for (let i = 0; i < positions.length; i += 2) {
    const previous = Math.max(0, i - 2);
    const next = Math.min(positions.length - 2, i + 2);
    const before = segmentNormal(positions, previous, i === 0 ? next : i);
    const after = segmentNormal(positions, i === positions.length - 2 ? previous : i, next);
    const nx = before[0] + after[0], ny = before[1] + after[1];
    const length = Math.hypot(nx, ny) || 1;
    const mx = nx / length, my = ny / length;
    const miter = 1 / Math.max(0.5, mx * after[0] + my * after[1]);
    normals.push(mx * miter, my * miter);
  }
  return { positions, normals };
}

function segmentNormal(points: number[], a: number, b: number): [number, number] {
  const dx = points[b]! - points[a]!, dy = points[b + 1]! - points[a + 1]!;
  const length = Math.hypot(dx, dy) || 1;
  return [-dy / length, dx / length];
}

/** Repartition cached paths only on state/visibility changes, never on zoom. */
export function buildEdgeStrokeGeometry(paths: readonly EdgeStrokePath[]): MeshGeometry {
  const pointCount = paths.reduce((sum, path) => sum + path.positions.length / 2, 0);
  const positions = new Float32Array(pointCount * 4);
  const normals = new Float32Array(pointCount * 4);
  const uvs = new Float32Array(pointCount * 4);
  const indices: number[] = [];
  let vertex = 0;
  for (const path of paths) {
    for (let i = 0; i < path.positions.length; i += 2) {
      for (let side = 0; side < 2; side++) {
        const offset = (vertex + side) * 2;
        positions[offset] = path.positions[i]!;
        positions[offset + 1] = path.positions[i + 1]!;
        normals[offset] = path.normals[i]!;
        normals[offset + 1] = path.normals[i + 1]!;
        uvs[offset + 1] = side === 0 ? -1 : 1;
      }
      if (i + 2 < path.positions.length) {
        indices.push(vertex, vertex + 1, vertex + 2, vertex + 2, vertex + 1, vertex + 3);
      }
      vertex += 2;
    }
  }
  const geometry = new MeshGeometry({ positions, uvs, indices: new Uint32Array(indices) });
  geometry.addAttribute('aNormal', { buffer: normals, format: 'float32x2' });
  return geometry;
}
