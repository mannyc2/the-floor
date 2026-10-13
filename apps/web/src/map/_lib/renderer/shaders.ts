export const surfaceVertex = `
attribute float _SURFACE;
attribute float _MAT;
attribute float _LINE;
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
varying float lineClass;
void main() {
  vec4 point = vec4(position, 1.0);
  point.y += _ANIMATED * mix(_PREVIOUS, _NEXT, interpolation);
  vec3 transformedNormal = normal;
  surfaceId = _SURFACE;
  entityId = _ENTITY;
  lineClass = _LINE;
  materialSlot = _PALETTE >= 0.0 ? _PALETTE : _MAT;
  #ifdef USE_INSTANCING
    point = instanceMatrix * point;
    mat3 im = mat3(instanceMatrix);
    transformedNormal /= vec3(dot(im[0], im[0]), dot(im[1], im[1]), dot(im[2], im[2]));
    transformedNormal = im * transformedNormal;
  #endif
  // Three's non-sheared instance normal transform followed by inverse view
  // rotation keeps the face tones in the room when the camera quarter-turns.
  faceNormal = normalize((vec4(normalMatrix * transformedNormal, 0.0) * viewMatrix).xyz);
  gl_Position = projectionMatrix * modelViewMatrix * point;
}
`;
export const colorFragment = `
uniform sampler2D palette;
uniform float paletteSize;
varying vec3 faceNormal;
varying float materialSlot;
void main() {
  float index = floor(materialSlot + 0.5);
  if (index >= 4.0) {
    float base = 4.0 + floor((index - 4.0) / 4.0) * 4.0;
    vec3 n = normalize(faceNormal);
    // Horizontal tops must remain lightest at every camera corner. Sloped
    // forms use these provisional bands until the Atlas records the pick.
    float side = dot(n.xz, normalize(vec2(-1.0, 1.0)));
    // Diagonal station faces lie on the side-band boundary. Absorb inverse-view
    // roundoff there so a quarter turn cannot change a stationary face's tone.
    index = base + (n.y > 0.5 ? 3.0 : n.y < -0.5 ? 0.0 : side >= -0.0001 ? 2.0 : 1.0);
  }
  gl_FragColor = vec4(texture2D(palette, vec2((index + 0.5) / paletteSize, 0.5)).rgb, 1.0);
  #include <colorspace_fragment>
}
`;
export const dataFragment = `
varying float surfaceId;
varying float entityId;
varying float lineClass;
void main() {
  float id = floor(entityId + 0.5) * 4096.0 + floor(surfaceId + 0.5);
  vec3 encoded = vec3(mod(id, 256.0), mod(floor(id / 256.0), 256.0), floor(id / 65536.0)) / 255.0;
  // RGB remains the exact picking identity. Alpha carries ordinary (1),
  // surface-dark (.5) or instrument-contour (0); none can create a surface edge.
  gl_FragColor = vec4(encoded, 1.0 - lineClass * 0.5);
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
uniform vec3 darkLineColor;
uniform float lineOpacity;
uniform float mask;
varying vec2 coordinate;
vec2 edgeAt(vec2 direction) {
  vec2 neighbor = coordinate + direction * pixel;
  vec4 a = texture2D(ids, coordinate);
  vec4 b = texture2D(ids, neighbor);
  float depth = abs(texture2D(depths, coordinate).r - texture2D(depths, neighbor).r);
  float edge = max(step(0.001, length(a.rgb - b.rgb)), step(0.0012, depth));
  // Only instrument plates and markings extend dark contours across an edge.
  // Surface-dark lights cannot spread dark ink onto their dim steel housing.
  return vec2(edge, edge * (1.0 - step(0.25, b.a)));
}
void main() {
  vec2 edge = max(
    max(edgeAt(vec2(edgeSpan.y, 0.0)), edgeAt(vec2(-edgeSpan.x, 0.0))),
    max(edgeAt(vec2(0.0, edgeSpan.y)), edgeAt(vec2(0.0, -edgeSpan.x)))
  );
  vec3 base = texture2D(colors, coordinate).rgb;
  float dark = max(step(0.25, 1.0 - texture2D(ids, coordinate).a), edge.y);
  vec3 stroke = mix(lineColor, darkLineColor, dark);
  float opacity = mix(lineOpacity, 1.0, dark);
  gl_FragColor = vec4(mask > 0.5 ? vec3(1.0 - edge.x) : mix(base, stroke, edge.x * opacity), 1.0);
  #include <colorspace_fragment>
}
`;
