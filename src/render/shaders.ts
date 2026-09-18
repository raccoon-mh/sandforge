// One fullscreen triangle; every pixel is a cell lookup plus a palette fetch.
// Keeping the colouring on the GPU is what lets the overlays and the layered
// views cost nothing extra on the CPU side.

export const VERT = `#version 300 es
out vec2 vUV;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUV = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`

export const FRAG = `#version 300 es
precision highp float;
precision highp sampler2DArray;

uniform sampler2DArray uCells;    // R: material, G: tint+flags, BA: temperature
uniform sampler2D uPalette;       // x: material index, rgb: colour, a: glow
uniform sampler2DArray uField;    // R: pressure, G: |velocity|
uniform int uMode;                // 0 material 1 thermal 2 pressure 3 circuit
uniform int uView;                // 0 slice 1 stack 2 tilt
uniform int uLayer;
uniform int uLayers;
uniform vec2 uTilt;
uniform float uGlow;

in vec2 vUV;
out vec4 frag;

const float T_MAX = 10000.0;

float decodeTemp(vec4 c) { return (c.b + c.a * 256.0) * (255.0 / 65535.0) * T_MAX; }

// Perceptually ordered black -> red -> yellow -> white, so a thermal image
// reads the same way an infrared camera does.
vec3 thermal(float t) {
  float u = clamp((t - 200.0) / 2600.0, 0.0, 1.0);
  vec3 c = vec3(0.0);
  c += smoothstep(0.0, 0.35, u) * vec3(0.65, 0.05, 0.25);
  c += smoothstep(0.30, 0.65, u) * vec3(0.35, 0.45, -0.15);
  c += smoothstep(0.60, 0.90, u) * vec3(0.0, 0.45, 0.35);
  c += smoothstep(0.88, 1.0, u) * vec3(0.0, 0.0, 0.55);
  return c;
}

// Diverging: suction blue, neutral grey, compression red.
vec3 pressureMap(float p) {
  float u = clamp(p / 40.0, -1.0, 1.0);
  vec3 cold = vec3(0.15, 0.45, 0.95);
  vec3 mid  = vec3(0.10, 0.10, 0.13);
  vec3 hot  = vec3(1.00, 0.35, 0.20);
  return u < 0.0 ? mix(mid, cold, -u) : mix(mid, hot, u);
}

vec4 shadeLayer(vec2 uv, int layer) {
  vec4 c = texture(uCells, vec3(uv, float(layer)));
  int mat = int(c.r * 255.0 + 0.5);
  if (mat == 0) return vec4(0.0);

  int flags = int(c.g * 255.0 + 0.5);
  float jitter = float(flags >> 3) / 32.0;
  bool burning = (flags & 1) != 0;
  bool charged = (flags & 2) != 0;

  vec4 pal = texelFetch(uPalette, ivec2(mat, 0), 0);
  vec3 col = pal.rgb * (0.86 + jitter * 0.28);
  float glow = pal.a;

  float temp = decodeTemp(c);
  if (temp > 700.0) {
    // Everything glows when it is hot enough; incandescence is not a property
    // of the material, it is a property of the temperature.
    float g = clamp((temp - 700.0) / 2200.0, 0.0, 1.0);
    col = mix(col, vec3(1.0, 0.55 + g * 0.4, 0.2 + g * 0.7), g * 0.85);
    glow = max(glow, g);
  }
  if (burning) { col = mix(col, vec3(1.0, 0.6, 0.15), 0.5); glow = max(glow, 0.7); }
  if (charged) { col = mix(col, vec3(1.0, 0.95, 0.5), 0.75); glow = max(glow, 0.9); }

  return vec4(col + col * glow * uGlow, 1.0);
}

void main() {
  vec3 outc = vec3(0.0);
  float cov = 0.0;

  if (uView == 0) {
    // Slice: the working layer in full, its neighbours as faint ghosts behind.
    for (int d = 3; d >= 1; d--) {
      int lo = uLayer - d, hi = uLayer + d;
      float f = 0.13 / float(d);
      if (lo >= 0) { vec4 s = shadeLayer(vUV, lo); outc = mix(outc, s.rgb, s.a * f); }
      if (hi < uLayers) { vec4 s = shadeLayer(vUV, hi); outc = mix(outc, s.rgb, s.a * f); }
    }
    vec4 s = shadeLayer(vUV, uLayer);
    outc = mix(outc, s.rgb, s.a);
    cov = s.a;
  } else {
    // Stack and tilt both walk back to front; tilt adds a per-layer parallax.
    for (int i = 0; i < 32; i++) {
      if (i >= uLayers) break;
      int layer = uLayers - 1 - i;
      float depth = float(layer) / max(1.0, float(uLayers - 1));
      vec2 uv = vUV + (uView == 2 ? uTilt * (depth - 0.5) : vec2(0.0));
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) continue;
      vec4 s = shadeLayer(uv, layer);
      float shade = mix(0.32, 1.0, 1.0 - depth);
      outc = mix(outc, s.rgb * shade, s.a * (uView == 2 ? 1.0 : 0.72));
      cov = max(cov, s.a);
    }
  }

  if (uMode == 1) {
    vec4 c = texture(uCells, vec3(vUV, float(uLayer)));
    float t = decodeTemp(c);
    int mat = int(c.r * 255.0 + 0.5);
    vec3 tc = thermal(t);
    outc = mat == 0 && abs(t - 295.0) < 1.0 ? outc * 0.25 : mix(outc * 0.2, tc, 0.9);
  } else if (uMode == 2) {
    vec2 f = texture(uField, vec3(vUV, float(uLayer))).rg;
    float p = (f.r - 0.5) * 160.0;
    outc = mix(outc * 0.25, pressureMap(p), 0.82) + vec3(f.g * 0.55);
  } else if (uMode == 3) {
    vec4 c = texture(uCells, vec3(vUV, float(uLayer)));
    int flags = int(c.g * 255.0 + 0.5);
    float lit = (flags & 2) != 0 ? 1.0 : 0.0;
    outc = mix(vec3(dot(outc, vec3(0.3, 0.5, 0.2)) * 0.35), vec3(1.0, 0.95, 0.55), lit);
  }

  frag = vec4(outc, max(cov, 0.0));
}`
