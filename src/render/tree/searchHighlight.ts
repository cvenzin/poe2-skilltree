import { Container, Mesh, MeshGeometry, Shader, Texture, UniformGroup } from 'pixi.js';
import { ringRadiusForWrap } from './nodes';

const RING_SEGMENTS = 48;
const NORMAL_STROKE_WIDTH = 3;
const FOCUSED_STROKE_WIDTH = 5;

const RING_VERTEX_SHADER = `
in vec2 aPosition;
in vec2 aUV;
in vec2 aNormal;
in float aSide;
in float aRingIndex;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform vec4 uWorldColorAlpha;
uniform mat3 uTransformMatrix;
uniform vec4 uColor;
uniform float uRingZoom;
uniform float uFocusedRing;

out vec4 vColor;

void main(void) {
  float strokeWidth = abs(aRingIndex - uFocusedRing) < 0.5 ? ${FOCUSED_STROKE_WIDTH}.0 : ${NORMAL_STROKE_WIDTH}.0;
  vec2 position = aPosition + aNormal * aSide * (0.5 * strokeWidth / max(uRingZoom, 0.0001));
  mat3 modelViewProjectionMatrix = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((modelViewProjectionMatrix * vec3(position, 1.0)).xy, 0.0, 1.0);
  vColor = uColor * uWorldColorAlpha;
}
`;

const RING_FRAGMENT_SHADER = `
in vec4 vColor;
out vec4 finalColor;

void main(void) {
  finalColor = vec4(0.25098, 0.87843, 0.87843, 1.0) * vColor;
}
`;

export interface SearchRingGeometryInput {
  key: string;
  x: number;
  y: number;
  radius: number;
}

interface SearchRingState {
  layer: Container;
  mesh: Mesh<MeshGeometry, Shader>;
  shader: Shader;
  uniforms: UniformGroup;
  matches: readonly string[] | null;
  ringIndexByKey: Map<string, number>;
  focusedKey: string | null;
  viewportScale: number;
}

const states = new WeakMap<Container, SearchRingState>();

/** Create one mesh layer whose ring geometry stays stable during zoom and focus changes. */
export function createSearchMatchLayer(): Container {
  const layer = new Container();
  layer.eventMode = 'none';

  const uniforms = new UniformGroup({
    uRingZoom: { value: 1, type: 'f32' },
    uFocusedRing: { value: -1, type: 'f32' },
  });
  const shader = Shader.from({
    gl: { vertex: RING_VERTEX_SHADER, fragment: RING_FRAGMENT_SHADER },
    resources: { searchRingUniforms: uniforms },
  });
  const mesh = new Mesh({ geometry: buildSearchRingGeometry([]), shader, texture: Texture.WHITE });
  mesh.eventMode = 'none';
  mesh.visible = false;
  layer.addChild(mesh);

  states.set(layer, {
    layer,
    mesh,
    shader,
    uniforms,
    matches: null,
    ringIndexByKey: new Map(),
    focusedKey: null,
    viewportScale: 1,
  });
  return layer;
}

/**
 * Update ring geometry only when the match set changes. Enter/Shift+Enter only
 * changes the focused-ring uniform; zoom only changes the stroke-width uniform.
 */
export function applySearchHighlight(
  matches: readonly string[],
  cursor: number,
  wraps: ReadonlyMap<string, Container>,
  layer: Container,
  worldContainer: Container,
  viewportScale: number,
  forceRebuild = false,
): void {
  const state = states.get(layer);
  if (!state) return;

  if (forceRebuild || state.matches !== matches) {
    rebuildSearchRings(state, matches, wraps, worldContainer);
  }

  const focusedKey = cursor >= 0 ? matches[cursor] ?? null : null;
  if (state.focusedKey !== focusedKey) {
    state.focusedKey = focusedKey;
    state.uniforms.uniforms.uFocusedRing = focusedKey === null
      ? -1
      : state.ringIndexByKey.get(focusedKey) ?? -1;
    state.uniforms.update();
  }

  refreshSearchRingUniforms(layer, viewportScale);
  // Reset alpha so the pulse starts at the same point after each search edit.
  layer.alpha = 1;
}

function rebuildSearchRings(
  state: SearchRingState,
  matches: readonly string[],
  wraps: ReadonlyMap<string, Container>,
  worldContainer: Container,
): void {
  state.matches = matches;
  state.ringIndexByKey = new Map();
  const matchSet = new Set(matches);
  const dim = matchSet.size > 0;
  for (const [key, wrap] of wraps) {
    wrap.alpha = dim && !matchSet.has(key) ? 0.35 : 1;
  }

  const inputs: SearchRingGeometryInput[] = [];
  for (const key of matches) {
    const wrap = wraps.get(key);
    if (!wrap || !wrap.visible) continue;
    const pos = worldContainer.toLocal(wrap.getGlobalPosition());
    const ringIndex = inputs.length;
    state.ringIndexByKey.set(key, ringIndex);
    inputs.push({ key, x: pos.x, y: pos.y, radius: ringRadiusForWrap(wrap) });
  }

  const oldGeometry = state.mesh.geometry;
  state.mesh.geometry = buildSearchRingGeometry(inputs);
  oldGeometry.destroy(true);
  state.mesh.visible = inputs.length > 0;
  state.focusedKey = null;
  state.uniforms.uniforms.uFocusedRing = -1;
  state.uniforms.update();
}

/** Change only a uniform; this never clears, restrokes, or uploads ring vertices. */
export function refreshSearchRingUniforms(layer: Container, viewportScale: number): void {
  const state = states.get(layer);
  if (!state || state.viewportScale === viewportScale) return;
  state.viewportScale = viewportScale;
  state.uniforms.uniforms.uRingZoom = Math.max(viewportScale, 0.0001);
  state.uniforms.update();
}

/** Release the custom mesh, geometry buffers, and shader resources on canvas teardown. */
export function destroySearchMatchLayer(layer: Container | null): void {
  if (!layer) return;
  const state = states.get(layer);
  if (!state) return;
  states.delete(layer);
  layer.removeChild(state.mesh);
  const geometry = state.mesh.geometry;
  state.mesh.destroy();
  geometry.destroy(true);
  state.shader.destroy();
}

export function buildSearchRingGeometry(rings: readonly SearchRingGeometryInput[]): MeshGeometry {
  const verticesPerRing = (RING_SEGMENTS + 1) * 2;
  const vertexCount = rings.length * verticesPerRing;
  const positions = new Float32Array(vertexCount * 2);
  const normals = new Float32Array(vertexCount * 2);
  const sides = new Float32Array(vertexCount);
  const ringIndices = new Float32Array(vertexCount);
  const indices = new Uint32Array(rings.length * RING_SEGMENTS * 6);

  for (let ringIndex = 0; ringIndex < rings.length; ringIndex++) {
    const ring = rings[ringIndex]!;
    const vertexStart = ringIndex * verticesPerRing;
    for (let segment = 0; segment <= RING_SEGMENTS; segment++) {
      const angle = (segment / RING_SEGMENTS) * Math.PI * 2;
      const nx = Math.cos(angle);
      const ny = Math.sin(angle);
      const vertex = vertexStart + segment * 2;
      for (let sideIndex = 0; sideIndex < 2; sideIndex++) {
        const offset = vertex + sideIndex;
        positions[offset * 2] = ring.x + nx * ring.radius;
        positions[offset * 2 + 1] = ring.y + ny * ring.radius;
        normals[offset * 2] = nx;
        normals[offset * 2 + 1] = ny;
        sides[offset] = sideIndex === 0 ? 1 : -1;
        ringIndices[offset] = ringIndex;
      }
    }

    const indexStart = ringIndex * RING_SEGMENTS * 6;
    for (let segment = 0; segment < RING_SEGMENTS; segment++) {
      const first = vertexStart + segment * 2;
      const next = first + 2;
      const offset = indexStart + segment * 6;
      indices[offset] = first;
      indices[offset + 1] = first + 1;
      indices[offset + 2] = next;
      indices[offset + 3] = next;
      indices[offset + 4] = first + 1;
      indices[offset + 5] = next + 1;
    }
  }

  const geometry = new MeshGeometry({ positions, indices });
  geometry.addAttribute('aNormal', { buffer: normals, format: 'float32x2' });
  geometry.addAttribute('aSide', { buffer: sides, format: 'float32' });
  geometry.addAttribute('aRingIndex', { buffer: ringIndices, format: 'float32' });
  return geometry;
}
