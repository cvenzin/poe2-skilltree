import { Mesh, Shader, Texture, UniformGroup } from 'pixi.js';
import type { EdgeState } from './edgeState';
import { EDGE_STYLE, EDGE_UNDERLAY, edgeScreenWidth } from './edgeStyle';
import { buildEdgeStrokeGeometry } from './edgeStrokeGeometry';
import type { EdgeStrokePath } from './edgeStrokeGeometry';

const VERTEX = `
in vec2 aPosition;
in vec2 aNormal;
in vec2 aUV;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform vec4 uWorldColorAlpha;
uniform vec4 uColor;
uniform float uZoom;
uniform mediump float uWidth;
out mediump float vDistance;
out mediump vec4 vColor;
void main() {
  float halfWidth = uWidth * 0.5 + ${EDGE_UNDERLAY.padding} + 1.0;
  vec2 position = aPosition + aNormal * aUV.y * halfWidth / uZoom;
  gl_Position = vec4((uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix * vec3(position, 1.0)).xy, 0.0, 1.0);
  vDistance = aUV.y * halfWidth;
  vColor = uColor * uWorldColorAlpha;
}`;

function rgb(color: number): number[] {
  return [(color >> 16 & 255) / 255, (color >> 8 & 255) / 255, (color & 255) / 255];
}

const FRAGMENT = `
in mediump float vDistance;
in mediump vec4 vColor;
uniform mediump float uWidth;
uniform vec4 uStroke;
uniform float uFeather;
out vec4 finalColor;
void main() {
  float distance = abs(vDistance);
  float aa = uFeather;
  float core = (1.0 - smoothstep(uWidth * 0.5 - aa, uWidth * 0.5 + aa, distance)) * uStroke.a;
  float outer = (1.0 - smoothstep(uWidth * 0.5 + ${EDGE_UNDERLAY.padding} - aa, uWidth * 0.5 + ${EDGE_UNDERLAY.padding} + aa, distance)) * ${EDGE_UNDERLAY.alpha};
  float under = outer * (1.0 - core);
  finalColor = vec4(uStroke.rgb * core + vec3(${rgb(EDGE_UNDERLAY.color).join(', ')}) * under, core + under) * vColor;
}`;

/** One sharp stroke and its dark underlay in a single draw per state, using
 * the same mesh/uniform approach as search rings. No blur/filter passes. */
export function createEdgeStroke(state: EdgeState) {
  const style = EDGE_STYLE[state];
  const uniforms = new UniformGroup({
    uZoom: { value: 1, type: 'f32' },
    uWidth: { value: Number(style.width), type: 'f32' },
    uFeather: { value: 0.5, type: 'f32' },
    uStroke: { value: [...rgb(style.color), style.alpha], type: 'vec4<f32>' },
  });
  const shader = Shader.from({ gl: { vertex: VERTEX, fragment: FRAGMENT }, resources: { edgeUniforms: uniforms } });
  const mesh = new Mesh({ geometry: buildEdgeStrokeGeometry([]), shader, texture: Texture.WHITE });
  mesh.eventMode = 'none';
  mesh.visible = false;
  let paths: readonly EdgeStrokePath[] = [];
  let lastZoom = -1, lastReference = -1, lastResolution = -1;

  // Mesh.destroy does not own custom shader/geometry resources. The event also
  // runs when a class swap or canvas teardown destroys the parent container.
  mesh.on('destroyed', () => { mesh.geometry.destroy(true); shader.destroy(); });

  return {
    mesh,
    setPaths(next: readonly EdgeStrokePath[]) {
      if (paths.length === next.length && paths.every((path, i) => path === next[i])) return;
      paths = next;
      const previous = mesh.geometry;
      mesh.geometry = buildEdgeStrokeGeometry(paths);
      previous.destroy(true);
      mesh.visible = paths.length > 0;
    },
    setZoom(zoom: number, reference: number, resolution = 1) {
      if (zoom === lastZoom && reference === lastReference && resolution === lastResolution) return;
      lastZoom = zoom; lastReference = reference; lastResolution = resolution;
      uniforms.uniforms.uZoom = Math.max(zoom, 0.0001);
      uniforms.uniforms.uWidth = edgeScreenWidth(state, zoom, reference);
      // Half a physical pixel at each boundary. Explicit feathering also
      // works on WebGL 1 without requiring standard-derivatives support.
      uniforms.uniforms.uFeather = 0.5 / Math.max(resolution, 1);
      uniforms.update();
    },
  };
}

export type EdgeStroke = ReturnType<typeof createEdgeStroke>;
