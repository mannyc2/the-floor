import { shading } from "@floor/atlas/look";
import { skinScale } from "../assets/trader-kit";

// How long a trader takes to blend from one clip into the next.
export const blendSeconds = .45;

// The live floor's material defines LIVE_SCENE. Every difference from the
// synthetic and approved scenes sits behind it, so their programs keep the
// exact preprocessed source the picked frames were captured with.
export const surfaceVertex = `
#ifdef TRADER
// A trader packs surface, paint, line class and visibility group into one
// lane, and four skinning influences into another, keeping the program within
// WebGL's sixteen vertex attributes beside the instance matrix and its
// animation lanes.
attribute vec4 _PART;
attribute vec4 _SKIN;
#define _SURFACE _PART.x
#define _MAT _PART.y
#define _LINE _PART.z
#define _GROUP _PART.w
#define _PALETTE -1.0
#else
attribute float _SURFACE;
attribute float _MAT;
attribute float _LINE;
#endif
attribute float _ENTITY;
#ifndef TRADER
attribute float _PALETTE;
#endif
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
#ifdef LIVE_SCENE
uniform float paletteTheme;
varying float flatTone;
#ifdef USE_INSTANCING
attribute float _TINT;
uniform vec3 tintSlots;
uniform vec2 nightSlots;
#endif
#ifdef TRADER
// A trader's current and previous clips (clip, start, cycles per second, then
// the current clip's fade-in start and the previous clip's unused lane), and
// its look: palette slots packed in pairs, then hair style, sixteen times the
// outfit and sixty-four times the body.
attribute vec4 _ANIM_A;
attribute vec4 _ANIM_B;
attribute vec4 _LOOK;
uniform highp sampler2D motion;
uniform float motionTime;
vec3 rotateByQuaternion(vec4 q, vec3 v) {
  return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
}
// One bone of one clip at a loop phase: neighbouring baked frames blended.
// FRAMES_PER_CLIP comes from the trader kit.
void sampleBone(float clip, float phase, int b, out vec4 q, out vec4 p) {
  float f = fract(phase) * float(FRAMES_PER_CLIP);
  float f0 = floor(f);
  int row0 = int(clip + 0.5) * FRAMES_PER_CLIP + int(f0);
  int row1 = int(clip + 0.5) * FRAMES_PER_CLIP + int(mod(f0 + 1.0, float(FRAMES_PER_CLIP)));
  vec4 qa = texelFetch(motion, ivec2(b * 2, row0), 0);
  vec4 qb = texelFetch(motion, ivec2(b * 2, row1), 0);
  qb *= sign(dot(qa, qb) + 1e-6);
  q = normalize(mix(qa, qb, f - f0));
  p = mix(texelFetch(motion, ivec2(b * 2 + 1, row0), 0), texelFetch(motion, ivec2(b * 2 + 1, row1), 0), f - f0);
}
// One influence's pose: the current clip, faded from the previous one.
void poseBone(int b, float fade, out vec4 q, out vec4 p) {
  sampleBone(_ANIM_A.x, (motionTime - _ANIM_A.y) * _ANIM_A.z, b, q, p);
  if (fade > 0.0 && _ANIM_B.x > -0.5) {
    vec4 qb, pb;
    sampleBone(_ANIM_B.x, (motionTime - _ANIM_B.y) * _ANIM_B.z, b, qb, pb);
    float k = fade * fade * (3.0 - 2.0 * fade);
    q = normalize(mix(q, qb * sign(dot(q, qb) + 1e-6), k));
    p = mix(p, pb, k);
  }
}
#endif
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
  #ifdef LIVE_SCENE
    // Geometry carries its night line classes; by day every outline is
    // ordinary, as in the approved day frames. A theme change needs no rebuild.
    float night = step(0.5, paletteTheme);
    lineClass = _LINE * night;
    flatTone = 0.0;
    vec3 objectNormal = normal;
  #endif
  #ifdef TRADER
    // A slot with no agent standing, or a part outside this trader's hair
    // style and body, leaves the clip volume before any texture read.
    float group = floor(_GROUP + 0.5);
    float style = mod(_LOOK.w + 0.5, 16.0) - 0.5;
    float outfit = mod(floor((_LOOK.w + 0.5) / 16.0), 4.0);
    float body = floor((_LOOK.w + 0.5) / 64.0);
    bool shown = group < 0.5 || (group < 7.5 ? abs(group - style) < 0.5 : abs(group - 8.0 - body) < 0.5);
    if (_ANIM_A.x < -0.5 || !shown) {
      gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
      return;
    }
    // Linear blend skinning over four influences, each a rotation, uniform
    // scale and translation from the bind pose.
    float fade = 1.0 - clamp((motionTime - _ANIM_A.w) / ${blendSeconds.toFixed(2)}, 0.0, 1.0);
    vec3 skinned = vec3(0.0), skinnedNormal = vec3(0.0);
    for (int k = 0; k < 4; k++) {
      float lane = _SKIN[k];
      float weight = mod(lane + 0.5, ${skinScale.toFixed(1)}) - 0.5;
      if (weight < 0.5) break;
      vec4 q, p;
      poseBone(int(floor((lane + 0.5) / ${skinScale.toFixed(1)})), fade, q, p);
      skinned += weight * (rotateByQuaternion(q, position * p.w) + p.xyz);
      skinnedNormal += weight * rotateByQuaternion(q, normal);
    }
    point.xyz = skinned / 255.0;
    objectNormal = normalize(skinnedNormal);
    // Negative paints take this trader's colours: jacket and trousers, skin
    // and hair, shirt and tie pack in pairs. The rest choose between them by
    // outfit: a jacket, or shirtsleeves rolled to the elbow with braces.
    if (_MAT < -1.5) {
      vec3 low = mod(_LOOK.xyz + 0.5, 256.0) - 0.5;
      vec3 high = floor((_LOOK.xyz + 0.5) / 256.0);
      float m = -_MAT;
      bool sleeves = outfit > 0.5;
      materialSlot = m < 2.5 ? low.x
        : m < 5.5 ? high.x
        : m < 6.5 ? low.y
        : m < 7.5 ? high.y
        : m < 8.5 ? low.z
        : m < 9.5 ? high.z
        : m < 10.5 ? (sleeves ? low.z : low.x)
        : m < 11.5 ? (sleeves ? high.x : low.x)
        : m < 12.5 ? (sleeves ? high.z : low.x)
        : m < 13.5 ? (sleeves ? low.y : low.x)
        : m < 14.5 ? (sleeves ? high.z : low.x)
        : m < 15.5 ? (sleeves ? high.z : low.z)
        : (sleeves ? low.y : low.z);
    }
    // Neighbouring regions painted alike share one outline surface, so a
    // jacket draws no seam where its sleeve meets its body.
    float surface = _SURFACE + materialSlot;
    id = floor(_ENTITY + 0.5) * 4096.0 + floor(surface + 0.5);
    identity = vec3(mod(id, 256.0), mod(floor(id / 256.0), 256.0), floor(id / 65536.0)) / 255.0;
    objectNormal = mat3(instanceMatrix) * objectNormal;
    point.xyz = mat3(instanceMatrix) * point.xyz + instanceMatrix[3].xyz;
  #elif defined(USE_INSTANCING)
    #ifdef LIVE_SCENE
      // A hidden slot (a desk nobody holds yet, or a pose its agent is not in)
      // leaves the clip volume before any transform.
      if (_INSTANCE_FROM.w < 0.5) {
        gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
        return;
      }
      // Negative authored materials name lit faces and jackets: -1 a desk
      // screen and -3 its lamp follow the agent's activity, -4 a crown screen
      // lights at night, and -2 takes the agent's jacket. Lit and dark screens
      // hold one flat tone, so the top band of glass never imitates a lit face.
      float lit = _INSTANCE_TO.w;
      if (_MAT < -3.5) {
        materialSlot = nightSlots.y;
        flatTone = 1.0;
        lineClass = night;
      } else if (_MAT < -2.5) {
        materialSlot = mix(screenSlots.x, nightSlots.x, lit);
        flatTone = 1.0;
        lineClass = night * lit;
      } else if (_MAT < -1.5) {
        materialSlot = _TINT < 0.5 ? tintSlots.x : _TINT < 1.5 ? tintSlots.y : tintSlots.z;
      } else if (_MAT < 0.0) {
        materialSlot = mix(screenSlots.x, screenSlots.y, lit);
        flatTone = 1.0;
        lineClass = night * lit;
      }
      // Live slots turn to face their post or their place: the instance's
      // rotation applies to the authored vertices and normals.
      objectNormal = mat3(instanceMatrix) * normal;
      point.xyz = mat3(instanceMatrix) * point.xyz + instanceMatrix[3].xyz;
    #else
      // A negative authored material marks the monitor face. Its activity shares
      // the target-position lane, preserving WebGL's sixteen-attribute ceiling.
      if (_MAT < 0.0) materialSlot = mix(screenSlots.x, screenSlots.y, _INSTANCE_TO.w);
      // Instances translate authored geometry; shape transforms are baked into
      // its vertices and normals, so a general matrix transform adds no information.
      point.xyz += instanceMatrix[3].xyz;
    #endif
    point.xyz += mix(_INSTANCE_FROM.xyz, _INSTANCE_TO.xyz, instanceInterpolation);
    point.xyz *= _INSTANCE_FROM.w;
  #endif
  // Inverse view rotation gives world normals, so tops are found on world Y.
  #ifdef LIVE_SCENE
    faceNormal = normalize((vec4(normalMatrix * objectNormal, 0.0) * viewMatrix).xyz);
  #else
    faceNormal = normalize((vec4(normalMatrix * normal, 0.0) * viewMatrix).xyz);
  #endif
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
#ifdef LIVE_SCENE
varying float flatTone;
#endif
flat in vec3 identity;
layout(location = 1) out highp vec4 identityColor;
void main() {
  float index = floor(materialSlot + 0.5);
  if (index >= ${shading.unshadedSlots.toFixed(1)}) {
    float base = ${shading.unshadedSlots.toFixed(1)} + floor((index - ${shading.unshadedSlots.toFixed(1)}) / ${
  shading.tonesPerMaterial.toFixed(1)
}) * ${shading.tonesPerMaterial.toFixed(1)};
    vec3 n = normalize(faceNormal);
    // Tops and undersides follow world Y: in view space the camera's pitch would
    // tilt walls toward the top band. Sides follow the view, so the dark side
    // stays on the screen's right as the camera turns.
    float side = -(mat3(viewMatrix) * n).x;
    // Faces turned straight at the camera lie on the side-band boundary.
    // Absorb view-transform roundoff there so they keep one tone.
    #ifdef TRADER
      // A figure is drawn in broad planes: only its flattest tops and
      // undersides change tone, and its shadow side starts past its middle.
      index = base + (n.y > .8 ? 3.0 : n.y < -.75 ? 0.0 : side >= .22 ? 2.0 : 1.0);
    #else
      index = base + (n.y > ${shading.verticalThreshold} ? 3.0 : n.y < -${shading.verticalThreshold} ? 0.0 : side >= ${shading.sideTolerance} ? 2.0 : 1.0);
    #endif
    #ifdef LIVE_SCENE
      if (flatTone > 0.5) index = base + 1.0;
    #endif
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
uniform float depthThreshold;
uniform vec3 lineColor;
uniform vec3 darkLineColor;
uniform float lineOpacity;
uniform float mask;
#ifdef LIVE_SCENE
uniform float surfaceLines;
uniform float farLines;
#endif
varying vec2 coordinate;
float decodeChannel(float encoded) {
  return texelFetch(colorDecode, ivec2(int(floor(encoded * 255.0 + 0.5)), 0), 0).r;
}
vec2 edgeAt(ivec2 neighbor, vec4 a, vec4 b, float centerDepth) {
  float depth = abs(centerDepth - texelFetch(depths, neighbor, 0).r);
  // IDs are nearest-sampled bytes: every nonzero distance is at least 1/255.
  // Squaring the same threshold preserves that decision without a per-pixel sqrt.
  vec3 difference = a.rgb - b.rgb;
  float edge = max(step(0.001 * 0.001, dot(difference, difference)), step(depthThreshold, depth));
  // Only instrument plates and markings extend dark contours across an edge.
  // Surface-dark lights cannot spread dark ink onto their dim steel housing.
  return vec2(edge, edge * (1.0 - step(0.25, b.a)));
}
#ifdef LIVE_SCENE
// The picking entity is the identity's top twelve bits: the high byte and the
// green byte's upper nibble.
float entityOf(vec4 id) {
  return floor(id.g * 255.0 / 16.0 + 0.5 / 16.0) + floor(id.b * 255.0 + 0.5) * 16.0;
}
// An outline between things (another entity, or a step in depth) as opposed
// to one between two surfaces of the same thing at the same depth.
float strongAt(ivec2 neighbor, vec4 a, vec4 b, float centerDepth) {
  float depth = abs(centerDepth - texelFetch(depths, neighbor, 0).r);
  return max(step(0.5, abs(entityOf(a) - entityOf(b))), step(depthThreshold, depth));
}
#endif
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
      #ifdef LIVE_SCENE
        // Far from the floor a post's or a figure's inner outlines crowd into
        // solid ink; they fade with distance while silhouettes stay.
        float strong = max(
          max(strongAt(right, centerId, rightId, centerDepth), strongAt(left, centerId, leftId, centerDepth)),
          max(strongAt(up, centerId, upId, centerDepth), strongAt(down, centerId, downId, centerDepth))
        );
        // From the farthest rungs a post is a dozen pixels across; every outline
        // lightens so posts and crowds keep their colour instead of going black.
        opacity *= mix(surfaceLines, 1.0, max(strong, dark)) * farLines;
      #endif
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
