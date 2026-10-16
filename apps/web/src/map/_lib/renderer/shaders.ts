import { shading } from "@floor/atlas/look";

export const surfaceVertex = `
attribute float _SURFACE;
attribute float _MAT;
attribute float _LINE;
attribute float _ENTITY;
attribute float _PALETTE;
#ifdef USE_INSTANCING
attribute vec4 _INSTANCE_FROM;
attribute vec4 _INSTANCE_TO;
uniform float instanceInterpolation;
uniform vec2 screenSlots;
#else
attribute float _ANIMATED;
attribute float _PREVIOUS;
attribute float _NEXT;
uniform float interpolation;
#endif
varying vec3 faceNormal;
varying float materialSlot;
varying float lineClass;
flat out vec3 identity;
void main() {
  vec4 point = vec4(position, 1.0);
  #ifndef USE_INSTANCING
    point.y += _ANIMATED * mix(_PREVIOUS, _NEXT, interpolation);
  #endif
  // Entity and surface are constant on each triangle. Encoding them per vertex
  // avoids repeated byte arithmetic across every covered fragment.
  float id = floor(_ENTITY + 0.5) * 4096.0 + floor(_SURFACE + 0.5);
  identity = vec3(mod(id, 256.0), mod(floor(id / 256.0), 256.0), floor(id / 65536.0)) / 255.0;
  lineClass = _LINE;
  materialSlot = _PALETTE >= 0.0 ? _PALETTE : _MAT;
  #ifdef USE_INSTANCING
    // A negative authored material marks the monitor face. Its activity shares
    // the target-position lane, preserving WebGL's sixteen-attribute ceiling.
    if (_MAT < 0.0) materialSlot = mix(screenSlots.x, screenSlots.y, _INSTANCE_TO.w);
    // Instances translate authored geometry; shape transforms are baked into
    // its vertices and normals, so a general matrix transform adds no information.
    point.xyz += instanceMatrix[3].xyz;
    point.xyz += mix(_INSTANCE_FROM.xyz, _INSTANCE_TO.xyz, instanceInterpolation);
    point.xyz *= _INSTANCE_FROM.w;
  #endif
  // Inverse view rotation keeps the face tones in the room when the camera turns.
  faceNormal = normalize((vec4(normalMatrix * normal, 0.0) * viewMatrix).xyz);
  gl_Position = projectionMatrix * modelViewMatrix * point;
}
`;
export const colorFragment = `
uniform sampler2D palette;
uniform float paletteSize;
uniform float paletteTheme;
varying vec3 faceNormal;
varying float materialSlot;
varying float lineClass;
flat in vec3 identity;
layout(location = 1) out highp vec4 identityColor;
void main() {
  float index = floor(materialSlot + 0.5);
  if (index >= ${shading.unshadedSlots.toFixed(1)}) {
    float base = ${shading.unshadedSlots.toFixed(1)} + floor((index - ${shading.unshadedSlots.toFixed(1)}) / ${
  shading.tonesPerMaterial.toFixed(1)
}) * ${shading.tonesPerMaterial.toFixed(1)};
    vec3 n = normalize(faceNormal);
    // Horizontal tops must remain lightest at every camera corner. Sloped
    // forms use these provisional bands until the Atlas records the pick.
    float side = dot(n.xz, normalize(vec2(-1.0, 1.0)));
    // Diagonal station faces lie on the side-band boundary. Absorb inverse-view
    // roundoff there so a quarter turn cannot change a stationary face's tone.
    index = base + (n.y > ${shading.verticalThreshold} ? 3.0 : n.y < -${shading.verticalThreshold} ? 0.0 : side >= ${shading.sideTolerance} ? 2.0 : 1.0);
  }
  gl_FragColor = vec4(texture2D(palette, vec2((index + 0.5) / paletteSize, paletteTheme)).rgb, 1.0);
  // RGB remains the exact picking identity. Alpha carries ordinary (1),
  // surface-dark (.5) or instrument-contour (0); none can create a surface edge.
  identityColor = vec4(identity, 1.0 - lineClass * 0.5);
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
uniform sampler2D colorDecode;
uniform sampler2D ids;
uniform sampler2D depths;
uniform vec2 edgeSpan;
uniform vec3 lineColor;
uniform vec3 darkLineColor;
uniform float lineOpacity;
uniform float mask;
varying vec2 coordinate;
float decodeChannel(float encoded) {
  return texelFetch(colorDecode, ivec2(int(floor(encoded * 255.0 + 0.5)), 0), 0).r;
}
vec2 edgeAt(ivec2 neighbor, vec4 a, vec4 b, float centerDepth) {
  float depth = abs(centerDepth - texelFetch(depths, neighbor, 0).r);
  // IDs are nearest-sampled bytes: every nonzero distance is at least 1/255.
  // Squaring the same threshold preserves that decision without a per-pixel sqrt.
  vec3 difference = a.rgb - b.rgb;
  float edge = max(step(0.001 * 0.001, dot(difference, difference)), step(0.0012, depth));
  // Only instrument plates and markings extend dark contours across an edge.
  // Surface-dark lights cannot spread dark ink onto their dim steel housing.
  return vec2(edge, edge * (1.0 - step(0.25, b.a)));
}
void main() {
  // The composite and its nearest-sampled inputs have the same pixel dimensions.
  // Integer texels avoid normalized filtering work; explicit clamping preserves
  // the previous ClampToEdgeWrapping at the canvas boundary.
  ivec2 center = ivec2(gl_FragCoord.xy);
  ivec2 last = textureSize(ids, 0) - ivec2(1);
  ivec2 right = clamp(center + ivec2(int(edgeSpan.y), 0), ivec2(0), last);
  ivec2 left = clamp(center - ivec2(int(edgeSpan.x), 0), ivec2(0), last);
  ivec2 up = clamp(center + ivec2(0, int(edgeSpan.y)), ivec2(0), last);
  ivec2 down = clamp(center - ivec2(0, int(edgeSpan.x)), ivec2(0), last);
  vec4 centerId = texelFetch(ids, center, 0);
  vec4 rightId = texelFetch(ids, right, 0);
  vec4 leftId = texelFetch(ids, left, 0);
  vec4 upId = texelFetch(ids, up, 0);
  vec4 downId = texelFetch(ids, down, 0);
  vec3 base = texelFetch(colors, center, 0).rgb;
  // Zero RGB is reserved for cleared background. Only an entirely empty
  // neighborhood can skip depth reads; checking the center alone loses outlines.
  vec3 occupied = max(centerId.rgb, max(max(rightId.rgb, leftId.rgb), max(upId.rgb, downId.rgb)));
  if (max(occupied.r, max(occupied.g, occupied.b)) == 0.0) {
    gl_FragColor = vec4(mask > 0.5 ? vec3(1.0) : base, 1.0);
  } else {
    float centerDepth = texelFetch(depths, center, 0).r;
    vec2 edge = max(
      max(edgeAt(right, centerId, rightId, centerDepth), edgeAt(left, centerId, leftId, centerDepth)),
      max(edgeAt(up, centerId, upId, centerDepth), edgeAt(down, centerId, downId, centerDepth))
    );
    if (mask > 0.5) {
      gl_FragColor = vec4(vec3(1.0 - edge.x), 1.0);
    } else if (edge.x == 0.0) {
      // A binary zero edge leaves the stored color unchanged. Only an outline
      // needs linear-light blending and a transfer back to encoded output.
      gl_FragColor = vec4(base, 1.0);
    } else {
      float dark = max(step(0.25, 1.0 - centerId.a), edge.y);
      vec3 stroke = mix(lineColor, darkLineColor, dark);
      float opacity = mix(lineOpacity, 1.0, dark);
      if (opacity == 1.0) {
        gl_FragColor = sRGBTransferOETF(vec4(stroke, 1.0));
      } else {
        vec3 linear = vec3(decodeChannel(base.r), decodeChannel(base.g), decodeChannel(base.b));
        gl_FragColor = sRGBTransferOETF(vec4(mix(linear, stroke, opacity), 1.0));
      }
    }
  }
}
`;
