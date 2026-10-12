export const surfaceVertex = `
attribute float _SURFACE;
attribute float _MAT;
attribute float _ENTITY;
attribute float _PALETTE;
attribute float _ANIMATED;
attribute float _PREVIOUS;
attribute float _NEXT;
uniform float interpolation;
varying vec3 faceNormal;
varying float surfaceId;
varying float materialSlot;
varying float entityId;
void main() {
  vec4 point = vec4(position, 1.0);
  point.y += _ANIMATED * mix(_PREVIOUS, _NEXT, interpolation);
  faceNormal = normalize(normalMatrix * normal);
  surfaceId = _SURFACE;
  entityId = _ENTITY;
  materialSlot = _PALETTE >= 0.0 ? _PALETTE : _MAT;
  #ifdef USE_INSTANCING
    point = instanceMatrix * point;
  #endif
  gl_Position = projectionMatrix * modelViewMatrix * point;
}
`;
export const colorFragment = `
uniform sampler2D palette;
varying vec3 faceNormal;
varying float materialSlot;
void main() {
  float index = floor(materialSlot + 0.5);
  if (index >= 4.0) {
    float light = dot(normalize(faceNormal), normalize(vec3(-0.4, 0.8, 0.45)));
    index = light > 0.65 ? 7.0 : light > 0.1 ? 6.0 : light > -0.5 ? 5.0 : 4.0;
  }
  gl_FragColor = vec4(texture2D(palette, vec2((index + 0.5) / 8.0, 0.5)).rgb, 1.0);
  #include <colorspace_fragment>
}
`;
export const dataFragment = `
varying float surfaceId;
varying float entityId;
void main() {
  float id = floor(entityId + 0.5) * 4096.0 + floor(surfaceId + 0.5);
  vec3 encoded = vec3(mod(id, 256.0), mod(floor(id / 256.0), 256.0), floor(id / 65536.0)) / 255.0;
  gl_FragColor = vec4(encoded, 1.0);
}
`;
export const screenVertex = `
varying vec2 coordinate;
void main() {
  coordinate = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;
export const screenFragment = `
uniform sampler2D colors;
uniform sampler2D ids;
uniform sampler2D depths;
uniform vec2 pixel;
uniform vec2 edgeSpan;
uniform vec3 lineColor;
uniform float lineOpacity;
uniform float mask;
varying vec2 coordinate;
float edgeAt(vec2 direction) {
  vec2 neighbor = coordinate + direction * pixel;
  vec3 a = texture2D(ids, coordinate).rgb;
  vec3 b = texture2D(ids, neighbor).rgb;
  float depth = abs(texture2D(depths, coordinate).r - texture2D(depths, neighbor).r);
  return max(step(0.001, length(a - b)), step(0.0012, depth));
}
void main() {
  float edge = max(
    max(edgeAt(vec2(edgeSpan.y, 0.0)), edgeAt(vec2(-edgeSpan.x, 0.0))),
    max(edgeAt(vec2(0.0, edgeSpan.y)), edgeAt(vec2(0.0, -edgeSpan.x)))
  );
  vec3 base = texture2D(colors, coordinate).rgb;
  gl_FragColor = vec4(mask > 0.5 ? vec3(1.0 - edge) : mix(base, lineColor, edge * lineOpacity), 1.0);
  #include <colorspace_fragment>
}
`;
