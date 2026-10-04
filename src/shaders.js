// All GLSL used by the three scenes. Written for three.js ShaderMaterial.
// GLSL leaves smoothstep() undefined when edge0 >= edge1, and many shaders here fade out with reversed edges,
// so every fragment shader gets the helper ss() below, which is well defined in both directions.
const PRE = "float ss(float a, float b, float x){ float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }\n";

export const NOISE = /* glsl */ `
float hash31(vec3 p){ p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x){
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash31(i), hash31(i + vec3(1,0,0)), f.x), mix(hash31(i + vec3(0,1,0)), hash31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash31(i + vec3(0,0,1)), hash31(i + vec3(1,0,1)), f.x), mix(hash31(i + vec3(0,1,1)), hash31(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p){ float a = 0.5; float s = 0.0; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }
`;

// ------------------------------------------------------------------ Earth, from space
const _EARTH_VERT = /* glsl */ `
varying vec2 vUv; varying vec3 vObj; varying vec3 vWorld;
void main(){ vUv = uv; vObj = normalize(position); vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }
`;
const _EARTH_FRAG = /* glsl */ `
uniform sampler2D dayTex; uniform sampler2D nightTex; uniform sampler2D waterTex; uniform sampler2D reliefTex; uniform sampler2D cloudTex;
uniform vec3 sunDir; uniform float cloudShadow; uniform vec2 texel; uniform vec3 cutN; uniform float cutOn;
varying vec2 vUv; varying vec3 vObj; varying vec3 vWorld;
void main(){
  vec3 N = normalize(vObj);
  if (cutOn > 0.5 && dot(N, cutN) > 0.0) discard;
  vec3 V = normalize(cameraPosition - vWorld);
  float d = dot(N, sunDir);
  float dayMix = ss(-0.10, 0.20, d);
  vec3 day = texture2D(dayTex, vUv).rgb;
  float ocean = texture2D(waterTex, vUv).r;
  // relief shading from the height map: light comes from the Sun direction projected on the local tangent plane
  vec3 E = normalize(cross(vec3(0.0, 1.0, 0.0), N) + vec3(1e-5));
  vec3 Nr = cross(N, E);
  float hx = texture2D(reliefTex, vUv + vec2(texel.x, 0.0)).r - texture2D(reliefTex, vUv - vec2(texel.x, 0.0)).r;
  float hy = texture2D(reliefTex, vUv + vec2(0.0, texel.y)).r - texture2D(reliefTex, vUv - vec2(0.0, texel.y)).r;
  float relief = 1.0 + 3.2 * (-hx * dot(sunDir, E) - hy * dot(sunDir, Nr)) * (1.0 - ocean);
  day *= clamp(relief, 0.7, 1.35);
  // slightly richer oceans
  day = mix(day, day * vec3(0.78, 0.92, 1.12), ocean * 0.5);
  float cl = texture2D(cloudTex, vUv + vec2(-0.0009 * dot(sunDir, E), 0.0009 * dot(sunDir, Nr))).r;
  day *= 1.0 - cloudShadow * 0.38 * cl;
  float lit = clamp(d * 1.25 + 0.06, 0.0, 1.0);
  lit = lit * lit * (3.0 - 2.0 * lit);
  vec3 col = day * (0.04 + 0.98 * lit);
  // sun glint on the ocean
  vec3 H = normalize(sunDir + V);
  float glint = pow(max(dot(N, H), 0.0), 140.0) * ocean * step(0.0, d) * (1.0 - cl * 0.9);
  col += vec3(1.0, 0.93, 0.78) * glint * 1.7;
  float broad = pow(max(dot(N, H), 0.0), 18.0) * ocean * step(0.0, d) * (1.0 - cl * 0.9);
  col += vec3(0.5, 0.62, 0.8) * broad * 0.16;
  // warm band at the terminator
  float dusk = ss(-0.20, 0.0, d) * (1.0 - ss(0.0, 0.26, d));
  col = mix(col, col * vec3(1.25, 0.82, 0.62) + vec3(0.07, 0.025, 0.0), dusk * 0.55);
  // night side: city lights, dimmed under cloud
  vec3 lights = texture2D(nightTex, vUv).rgb;
  float lum = dot(lights, vec3(0.30, 0.59, 0.11));
  float city = ss(0.10, 0.75, lum);
  vec3 night = vec3(1.0, 0.74, 0.40) * city * 1.5 * (1.0 - 0.7 * cl) + vec3(0.006, 0.010, 0.022) + day * 0.012;
  col = mix(night, col, dayMix);
  // thin atmosphere haze towards the limb
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  vec3 haze = mix(vec3(0.10, 0.20, 0.45), vec3(0.42, 0.66, 1.0), dayMix);
  col += haze * fres * (0.18 + 0.7 * dayMix);
  gl_FragColor = vec4(col, 1.0);
}
`;

const _CLOUD_VERT = _EARTH_VERT;
const _CLOUD_FRAG = /* glsl */ `
uniform sampler2D cloudTex; uniform vec3 sunDir; uniform vec3 cutN; uniform float cutOn;
varying vec2 vUv; varying vec3 vObj; varying vec3 vWorld;
void main(){
  vec3 N = normalize(vObj);
  if (cutOn > 0.5 && dot(N, cutN) > 0.0) discard;
  float d = dot(N, sunDir);
  float a = texture2D(cloudTex, vUv).r;
  float dayMix = ss(-0.12, 0.22, d);
  float lit = clamp(d * 1.3 + 0.12, 0.0, 1.0);
  vec3 dayCol = vec3(0.97, 0.98, 1.0) * (0.55 + 0.45 * lit);
  vec3 nightCol = vec3(0.025, 0.04, 0.075);
  vec3 col = mix(nightCol, dayCol, dayMix);
  float dusk = ss(-0.2, 0.0, d) * (1.0 - ss(0.0, 0.2, d));
  col += vec3(0.5, 0.2, 0.08) * dusk * 0.5 * a;
  gl_FragColor = vec4(col, a * (0.12 + 0.86 * dayMix));
}
`;

const _ATMO_VERT = /* glsl */ `
varying vec3 vW;
void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }
`;
// Glow is strongest where the view ray just grazes the Earth and fades with height above the limb.
const _ATMO_FRAG = /* glsl */ `
uniform vec3 sunDir;
varying vec3 vW;
void main(){
  vec3 V = normalize(vW - cameraPosition);
  float tc = max(-dot(cameraPosition, V), 0.0);
  vec3 cp = cameraPosition + V * tc;
  float d = length(cp);
  float h = max(d - 1.0, 0.0);
  float glow = exp(-h * 30.0);
  float sunSide = dot(cp / max(d, 1e-4), sunDir);
  float day = ss(-0.30, 0.45, sunSide);
  float term = ss(0.42, 0.0, abs(sunSide + 0.02));
  vec3 col = mix(vec3(0.04, 0.09, 0.2), vec3(0.30, 0.58, 1.0), day);
  col = mix(col, vec3(1.0, 0.52, 0.22), term * 0.5);
  float a = glow * (0.07 + 0.93 * day) * 0.95;
  gl_FragColor = vec4(col, a);
}
`;

const _AURORA_SHELL_FRAG = /* glsl */ `
uniform sampler2D gridTex; uniform float time; uniform vec3 sunDir; uniform float strength;
varying vec2 vUv; varying vec3 vObj; varying vec3 vWorld;
` + NOISE + `
void main(){
  vec3 N = normalize(vObj);
  float lat = asin(clamp(N.y, -1.0, 1.0));
  float lon = atan(-N.z, N.x);
  float u = fract(lon / 6.2831853);
  float v = (lat * 57.29578 + 90.0 + 0.5) / 181.0;
  float p = texture2D(gridTex, vec2(u, v)).r;
  float n = fbm(vec3(N.x * 24.0, N.y * 24.0 + time * 0.15, N.z * 24.0 + time * 0.1));
  float ray = 0.55 + 0.7 * n;
  float s = pow(p, 1.35) * ray * strength;
  float night = ss(0.25, -0.18, dot(N, sunDir));
  vec3 V = normalize(cameraPosition - vWorld);
  float facing = pow(max(dot(N, V), 0.0), 0.6);
  vec3 g = mix(vec3(0.20, 1.0, 0.55), vec3(0.75, 0.40, 1.0), ss(0.35, 0.9, p));
  float a = clamp(s * 2.4, 0.0, 1.0) * night * facing;
  gl_FragColor = vec4(g * a, a);
}
`;

// ------------------------------------------------------------------ satellite swarm (positions computed on the GPU)
const _SWARM_VERT = /* glsl */ `
attribute vec4 el1; attribute vec4 el2; attribute vec3 el3;
uniform float tMin; uniform float gmst; uniform vec3 obs; uniform vec4 show; uniform float pr; uniform float sizeScale; uniform float selIdx;
attribute float aIdx;
varying vec3 vColor; varying float vAlpha;
void main(){
  float dt = tMin - el1.x;
  float e = el1.z;
  float M = mod(el2.z + el1.y * dt, 6.28318530718);
  float raan = el2.x + el3.y * dt;
  float argp = el2.y + el3.z * dt;
  float E = M;
  for (int k = 0; k < 5; k++) { E = E - (E - e * sin(E) - M) / (1.0 - e * cos(E)); }
  float xp = el3.x * (cos(E) - e);
  float yp = el3.x * sqrt(1.0 - e * e) * sin(E);
  float cO = cos(raan), sO = sin(raan), cw = cos(argp), sw = sin(argp), ci = cos(el1.w), si = sin(el1.w);
  float x = (cO * cw - sO * sw * ci) * xp + (-cO * sw - sO * cw * ci) * yp;
  float y = (sO * cw + cO * sw * ci) * xp + (-sO * sw + cO * cw * ci) * yp;
  float z = sw * si * xp + cw * si * yp;
  float ex = x * cos(gmst) + y * sin(gmst);
  float ey = -x * sin(gmst) + y * cos(gmst);
  vec3 p = vec3(ex, z, -ey);
  float t = el2.w;
  float vis = t < 0.5 ? show.x : t < 1.5 ? show.y : t < 2.5 ? show.x : t < 3.5 ? show.z : 1.0;
  vis *= step(el3.x, 7.2);
  vec3 d = p - obs;
  float above = step(0.1736, dot(normalize(d), normalize(obs)));
  vec3 base = t < 0.5 ? vec3(0.80, 0.88, 1.0) : t < 1.5 ? vec3(0.42, 0.80, 1.0) : t < 2.5 ? vec3(0.62, 0.72, 1.0) : t < 3.5 ? vec3(1.0, 0.52, 0.36) : vec3(1.0);
  vColor = mix(base, vec3(0.55, 1.0, 0.86), above);
  vAlpha = vis * (t > 3.5 ? 1.0 : 0.62 + 0.38 * above);
  float sel = 1.0 - step(0.5, abs(aIdx - selIdx));
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float size = (t > 3.5 ? 6.5 : t > 2.5 ? 1.9 : 2.3) + above * 2.4 + sel * 12.0;
  vAlpha = max(vAlpha, sel * vis);
  vColor = mix(vColor, vec3(1.0, 0.95, 0.7), sel);
  gl_PointSize = size * pr * sizeScale * clamp(6.0 / length(mv.xyz), 0.7, 1.9) * max(vis, sel);
  gl_Position = projectionMatrix * mv;
}
`;
const _SWARM_FRAG = /* glsl */ `
varying vec3 vColor; varying float vAlpha;
void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; float a = ss(0.5, 0.0, d) * vAlpha; gl_FragColor = vec4(vColor * a, a); }
`;

// markers for storms, fires, quakes (kinds: 0 fire, 1 cyclone, 2 flood, 3 quake, 4 new)
const _MARKER_VERT = /* glsl */ `
attribute float kind; attribute float size; attribute float phase; uniform float pr; uniform float sizeScale; uniform vec2 showQH;
varying float vKind; varying float vPhase; varying float vFront;
void main(){
  vKind = kind; vPhase = phase;
  vec4 w = modelMatrix * vec4(position, 1.0);
  float vis = kind > 2.5 ? showQH.x : showQH.y;
  vFront = step(0.08, dot(normalize(w.xyz), normalize(cameraPosition))) * vis;
  vec4 mv = viewMatrix * w;
  gl_PointSize = size * pr * sizeScale * clamp(3.4 / length(mv.xyz), 0.75, 1.6) * vis;
  gl_Position = projectionMatrix * mv;
}
`;
const _MARKER_FRAG = /* glsl */ `
uniform float time;
varying float vKind; varying float vPhase; varying float vFront;
void main(){
  vec2 p = gl_PointCoord - 0.5; float d = length(p); if (d > 0.5) discard;
  vec3 c; float a;
  if (vKind < 0.5) { c = vec3(1.0, 0.62, 0.34); a = ss(0.5, 0.05, d) * (0.65 + 0.35 * sin(time * 6.0 + vPhase * 40.0)); }
  else if (vKind < 1.5) { float ang = atan(p.y, p.x); float arms = 0.5 + 0.5 * sin(ang * 2.0 + d * 22.0 - time * 2.4);
    c = vec3(0.68, 0.86, 1.0); a = ss(0.5, 0.08, d) * (0.25 + 0.75 * arms) + ss(0.08, 0.0, d); }
  else if (vKind < 2.5) { c = vec3(0.45, 0.68, 1.0); a = ss(0.5, 0.0, d) * (0.6 + 0.3 * sin(time * 1.5 + vPhase * 10.0)); }
  else if (vKind < 3.5) { float r = fract(time * 0.33 + vPhase) * 0.5; c = vec3(1.0, 0.72, 0.43);
    a = ss(0.045, 0.0, abs(d - r)) * (1.0 - r * 2.0) + ss(0.09, 0.0, d); }
  else { float r = fract(time * 0.9) * 0.5; c = vec3(1.0, 0.85, 0.35);
    a = ss(0.05, 0.0, abs(d - r)) * (1.0 - r * 2.0) * 1.3 + ss(0.12, 0.0, d); }
  a *= vFront;
  gl_FragColor = vec4(c * a, a);
}
`;

const _YOU_FRAG = /* glsl */ `
uniform float time; uniform vec3 tint;
void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard;
  float r = fract(time * 0.5) * 0.5; float ring = ss(0.04, 0.0, abs(d - r)) * (1.0 - r * 2.0);
  float core = ss(0.07, 0.03, d); float a = max(ring, core); gl_FragColor = vec4(tint * a, a); }
`;
const _YOU_VERT = /* glsl */ `
uniform float pr; uniform float sizeScale;
void main(){ vec4 mv = viewMatrix * modelMatrix * vec4(position, 1.0); gl_PointSize = 46.0 * pr * sizeScale * clamp(3.0 / length(mv.xyz), 0.7, 1.3); gl_Position = projectionMatrix * mv; }
`;

// seismic wave rings drawn on the Earth's surface
const _WAVE_FRAG = /* glsl */ `
uniform vec3 centre; uniform float rP; uniform float rS; uniform float fade; uniform vec3 cutN; uniform float cutOn;
varying vec2 vUv; varying vec3 vObj; varying vec3 vWorld;
void main(){
  vec3 N = normalize(vObj);
  if (cutOn > 0.5 && dot(N, cutN) > 0.0) discard;
  float ang = acos(clamp(dot(N, centre), -1.0, 1.0));
  float w = 0.005 + ang * 0.014;
  float p = exp(-pow((ang - rP) / w, 2.0)) * step(0.001, rP);
  float s = exp(-pow((ang - rS) / (w * 1.3), 2.0)) * step(0.001, rS);
  float decayP = 1.0 / (1.0 + rP * 1.4);
  float decayS = 1.0 / (1.0 + rS * 1.4);
  vec3 col = vec3(1.0, 0.72, 0.38) * p * decayP * 1.1 + vec3(1.0, 0.30, 0.42) * s * decayS * 1.1;
  float a = clamp(p * decayP * 1.0 + s * decayS * 1.0, 0.0, 1.0) * fade;
  gl_FragColor = vec4(col * fade, a);
}
`;

// ------------------------------------------------------------------ ribbons drawn on or above the globe
const _RIBBON_VERT = /* glsl */ `
attribute vec3 color; attribute float alpha; varying vec3 vC; varying float vA; varying float vFront;
void main(){ vC = color; vA = alpha; vec4 w = modelMatrix * vec4(position, 1.0);
  vFront = length(cameraPosition) > 0.001 ? step(-0.05, dot(normalize(w.xyz), normalize(cameraPosition))) : 1.0;
  gl_Position = projectionMatrix * viewMatrix * w; }
`;
const _RIBBON_FRAG = /* glsl */ `
varying vec3 vC; varying float vA; varying float vFront; uniform float opacity; uniform float cull;
void main(){ float a = vA * opacity * mix(1.0, vFront, cull); gl_FragColor = vec4(vC * a, a); }
`;

// ------------------------------------------------------------------ ground view: sky
const _SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main(){ vDir = normalize(position); vec4 p = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0); gl_Position = p.xyww; }
`;
const _SKY_FRAG = /* glsl */ `
uniform vec3 zenith; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 glowColor; uniform float glowAmt; uniform float sunAlt; uniform vec3 moonDir; uniform float moonAmt; uniform float airglow; uniform vec3 cityGlow;
varying vec3 vDir;
void main(){
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -0.2, 1.0);
  float t = pow(1.0 - clamp(h, 0.0, 1.0), 2.4);
  vec3 col = mix(zenith, horizon, t);
  float cs = clamp(dot(d, sunDir), 0.0, 1.0);
  float aroundSun = pow(cs, 6.0) * 0.55 + pow(cs, 64.0) * 0.9 + pow(cs, 1400.0) * 6.0;
  col += glowColor * aroundSun * glowAmt;
  float low = exp(-max(d.y, 0.0) * 5.5);
  float sunSide = 0.35 + 0.65 * max(dot(normalize(vec3(d.x, 0.0, d.z) + 1e-5), normalize(vec3(sunDir.x, 0.0, sunDir.z) + 1e-5)), 0.0);
  col += glowColor * low * sunSide * glowAmt * 0.55;
  float cm = clamp(dot(d, moonDir), 0.0, 1.0);
  col += vec3(0.55, 0.65, 0.9) * pow(cm, 40.0) * moonAmt * 0.28 + vec3(0.45, 0.55, 0.85) * pow(cm, 6.0) * moonAmt * 0.05;
  col += vec3(0.05, 0.11, 0.07) * airglow * (1.0 - clamp(d.y, 0.0, 1.0)) * 0.6;
  col += cityGlow * (exp(-max(d.y, 0.0) * 5.0) * 0.9 + 0.12);
  if (d.y < 0.0) col = mix(col, horizon * 0.35, ss(0.0, -0.2, d.y));
  gl_FragColor = vec4(col, 1.0);
}
`;

const _MILKYWAY_VERT = /* glsl */ `
varying vec3 vEq;
void main(){ vEq = normalize(position); vec4 p = projectionMatrix * mat4(mat3(viewMatrix)) * modelMatrix * vec4(position, 1.0); gl_Position = p.xyww; }
`;
const _MILKYWAY_FRAG = /* glsl */ `
uniform vec3 gx; uniform vec3 gy; uniform vec3 gz; uniform float amount;
varying vec3 vEq;
` + NOISE + `
void main(){
  vec3 e = normalize(vEq);
  float x = dot(e, gx), y = dot(e, gy), z = dot(e, gz);
  float b = asin(clamp(z, -1.0, 1.0));
  float l = atan(y, x);
  float band = exp(-abs(b) / 0.20);
  float bulge = exp(-pow(l / 0.95, 2.0)) * exp(-abs(b) / 0.30);
  float cloud = fbm(vec3(x, y, z) * 6.0);
  float fine = fbm(vec3(x, y, z) * 22.0);
  float dust = ss(0.50, 0.66, fbm(vec3(x, y, z) * 9.0 + 7.0)) * exp(-abs(b) / 0.12);
  float I = (band * (0.28 + 0.9 * cloud) + bulge * 1.1) * (0.65 + 0.7 * fine);
  I *= 1.0 - 0.62 * dust;
  vec3 warm = vec3(1.0, 0.86, 0.66), cool = vec3(0.62, 0.76, 1.0);
  vec3 col = mix(cool, warm, clamp(bulge * 1.4 + 0.1, 0.0, 1.0)) * I;
  float speck = pow(hash31(floor(e * 520.0)), 60.0) * 2.6 * I * I;
  col += vec3(0.95, 0.95, 1.0) * speck * (1.0 - 0.6 * dust);
  gl_FragColor = vec4(col * amount, 1.0);
}
`;

const _STAR_VERT = /* glsl */ `
attribute float mag; attribute vec3 tint; uniform float pr; uniform float magLimit; uniform float dark; uniform float time; uniform float sizeScale;
varying vec3 vTint; varying float vA;
void main(){
  vTint = tint;
  float vis = ss(magLimit + 0.35, magLimit - 0.5, mag);
  float tw = 0.88 + 0.12 * sin(time * 2.1 + position.x * 91.0 + position.y * 53.0);
  vA = vis * dark * tw * clamp(1.5 - mag * 0.16, 0.5, 1.0);
  vec4 p = projectionMatrix * mat4(mat3(viewMatrix)) * modelMatrix * vec4(position, 1.0);
  gl_PointSize = (1.9 + max(0.0, 3.6 - mag) * 1.2) * pr * sizeScale;
  gl_Position = p.xyww;
}
`;
const _STAR_FRAG = /* glsl */ `
varying vec3 vTint; varying float vA;
void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; float a = ss(0.5, 0.0, d) * vA; gl_FragColor = vec4(vTint * a, a); }
`;

const _SPRITE_VERT = /* glsl */ `
attribute float size; attribute vec3 color; attribute float alpha; uniform float pr; uniform float sizeScale;
varying vec3 vC; varying float vA;
void main(){ vC = color; vA = alpha; vec4 p = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); gl_PointSize = size * pr * sizeScale; gl_Position = p; }
`;
const _SPRITE_FRAG = /* glsl */ `
varying vec3 vC; varying float vA;
void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; float core = ss(0.18, 0.0, d); float halo = ss(0.5, 0.0, d) * 0.45;
  float a = (core + halo) * vA; gl_FragColor = vec4(vC * a, a); }
`;

const _MOON_VERT = /* glsl */ `
varying vec2 vUv; varying vec3 vN;
void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }
`;
const _MOON_FRAG = /* glsl */ `
uniform sampler2D moonTex; uniform vec3 sunDir; uniform float exposure;
varying vec2 vUv; varying vec3 vN;
void main(){
  vec3 N = normalize(vN);
  float dif = clamp(dot(N, sunDir), 0.0, 1.0);
  float soft = ss(0.0, 0.18, dot(N, sunDir));
  float tex = texture2D(moonTex, vUv).r;
  float earthshine = 0.035;
  vec3 col = vec3(0.98, 0.96, 0.9) * (0.25 + 0.95 * tex) * (soft * (0.35 + 0.65 * dif)) * exposure + vec3(0.36, 0.42, 0.55) * tex * earthshine;
  gl_FragColor = vec4(col, 1.0);
}
`;

const _CURTAIN_VERT = /* glsl */ `
varying vec2 vUv; varying vec3 vP;
void main(){ vUv = uv; vP = position; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }
`;
const _CURTAIN_FRAG = /* glsl */ `
uniform float time; uniform float strength;
varying vec2 vUv; varying vec3 vP;
` + NOISE + `
void main(){
  float x = vUv.x * 14.0;
  float rays = 0.45 + 0.75 * fbm(vec3(x * 2.4, time * 0.25, 1.7));
  rays *= 0.6 + 0.7 * fbm(vec3(x * 9.0, time * 0.9, 4.3));
  float h = vUv.y;
  float bottom = ss(0.0, 0.07, h);
  float top = pow(1.0 - h, 1.6);
  float sway = fbm(vec3(vUv.x * 3.0, time * 0.2, 9.0));
  float edge = ss(0.0, 0.18, vUv.x) * ss(1.0, 0.82, vUv.x);
  float a = rays * bottom * top * edge * strength * (0.75 + 0.5 * sway);
  vec3 low = vec3(0.25, 1.0, 0.55), high = vec3(0.65, 0.35, 0.95);
  vec3 col = mix(low, high, ss(0.35, 1.0, h));
  col = mix(col, vec3(0.9, 0.2, 0.35), ss(0.82, 1.0, h) * 0.25);
  gl_FragColor = vec4(col * a, a);
}
`;

const _HORIZON_VERT = /* glsl */ `
varying vec3 vP; varying float vY;
void main(){ vP = position; vY = position.y; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }
`;
// Used for both the lower hemisphere (ground) and the ring of hills. Hills (y above 0) catch more of the city glow.
const _HORIZON_FRAG = /* glsl */ `
uniform vec3 glow; uniform float glowAmt; uniform vec3 base;
varying vec3 vP; varying float vY;
void main(){
  float depth = clamp(-vY / 29.0, 0.0, 1.0);
  float hill = clamp(vY / 1.2, 0.0, 1.0);
  float nearHorizon = pow(1.0 - depth, 6.0);
  vec3 col = base * (0.55 + 0.45 * hill) * (1.0 - 0.75 * depth);
  col += glow * glowAmt * (0.10 * nearHorizon + 0.05 * hill);
  gl_FragColor = vec4(col, 1.0);
}
`;

// ------------------------------------------------------------------ cutaway Earth
const _SLICE_FRAG = /* glsl */ `
uniform vec2 focus2; uniform float rP; uniform float rS; uniform float time; uniform float showWaves; uniform float km;
varying vec3 vL;
` + NOISE + `
void main(){
  float r = length(vL.xy);
  float rk = r * 6371.0;
  vec3 col;
  float n = fbm(vec3(vL.xy * 7.0, time * 0.03));
  if (r > 0.995) col = mix(vec3(0.20, 0.26, 0.20), vec3(0.34, 0.27, 0.18), n);
  else if (r > 0.546) { float k = (r - 0.546) / (0.995 - 0.546); col = mix(vec3(1.0, 0.62, 0.20), vec3(0.62, 0.24, 0.10), k); col *= 0.82 + 0.5 * n; }
  else if (r > 0.1915) { col = mix(vec3(1.0, 0.92, 0.45), vec3(1.0, 0.72, 0.25), (r - 0.1915) / (0.546 - 0.1915)); col *= 0.9 + 0.35 * n; }
  else col = vec3(1.0, 0.97, 0.85);
  float b1 = ss(0.006, 0.0, abs(r - 0.546));
  float b2 = ss(0.006, 0.0, abs(r - 0.1915));
  float b0 = ss(0.004, 0.0, abs(r - 0.995));
  col = mix(col, vec3(0.05, 0.03, 0.02), max(max(b1, b2), b0) * 0.55);
  col = pow(col, vec3(1.15));
  // waves in the plane: circles around the focus
  vec2 f = focus2; float dist = length(vL.xy - f) * 6371.0;
  float w = 70.0 + dist * 0.02;
  float p = exp(-pow((dist - rP) / w, 2.0)) * step(1.0, rP) * showWaves;
  float s = exp(-pow((dist - rS) / (w * 1.3), 2.0)) * step(1.0, rS) * showWaves;
  col += vec3(1.0, 0.95, 0.7) * p * 1.1 + vec3(1.0, 0.35, 0.55) * s * 1.1;
  gl_FragColor = vec4(col, 1.0);
}
`;
const _SLICE_VERT = /* glsl */ `
varying vec3 vL;
void main(){ vL = position; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }
`;

// gold pulse for objects launched in the last 30 days (drawn with SWARM_VERT)
const _NEW_FRAG = /* glsl */ `
uniform float time;
varying vec3 vColor; varying float vAlpha;
void main(){
  vec2 p = gl_PointCoord - 0.5; float d = length(p); if (d > 0.5) discard;
  float r = fract(time * 0.6) * 0.5;
  float ring = ss(0.05, 0.0, abs(d - r)) * (1.0 - r * 2.0);
  float core = ss(0.10, 0.02, d);
  float a = max(ring, core) * vAlpha;
  gl_FragColor = vec4(vec3(1.0, 0.82, 0.35) * a, a);
}
`;

// lines at "infinite" distance (constellations): camera translation is ignored
const _SKYLINE_VERT = /* glsl */ `
attribute vec3 color; attribute float alpha; varying vec3 vC; varying float vA; varying float vFront;
void main(){ vC = color; vA = alpha; vFront = 1.0;
  vec4 p = projectionMatrix * mat4(mat3(viewMatrix)) * modelMatrix * vec4(position, 1.0); gl_Position = p.xyww; }
`;

// soft translucent beam from a satellite to its ground footprint
const _BEAM_FRAG = /* glsl */ `
varying vec3 vC; varying float vA; varying float vFront; uniform float opacity; uniform float cull;
void main(){ float a = vA * opacity; gl_FragColor = vec4(vC * a, a); }
`;

// fragment shaders with the helper prepended
export const EARTH_FRAG = PRE + _EARTH_FRAG;
export const CLOUD_FRAG = PRE + _CLOUD_FRAG;
export const ATMO_FRAG = PRE + _ATMO_FRAG;
export const AURORA_SHELL_FRAG = PRE + _AURORA_SHELL_FRAG;
export const SWARM_FRAG = PRE + _SWARM_FRAG;
export const MARKER_FRAG = PRE + _MARKER_FRAG;

// ---------------------------------------------------------------- fire detections on the globe
// One point per 0.25 degree cell: size and colour follow the cell's total fire radiative power, brightness follows how recent it is.
const _FIRE_VERT = /* glsl */ `
attribute float power; attribute float fresh; uniform float pr; uniform float sizeScale;
varying float vP; varying float vFresh; varying float vFront;
void main(){
  vP = power; vFresh = fresh;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vFront = step(0.08, dot(normalize(w.xyz), normalize(cameraPosition)));
  vec4 mv = viewMatrix * w;
  gl_PointSize = (2.4 + power * 6.0) * pr * sizeScale * clamp(3.4 / length(mv.xyz), 0.75, 1.8);
  gl_Position = projectionMatrix * mv;
}
`;
const _FIRE_FRAG = /* glsl */ `
varying float vP; varying float vFresh; varying float vFront;
void main(){
  vec2 p = gl_PointCoord - 0.5; float d = length(p); if (d > 0.5) discard;
  float a = ss(0.5, 0.0, d) * (0.4 + 0.6 * vFresh) * vFront;
  vec3 c = mix(vec3(1.0, 0.32, 0.08), vec3(1.0, 0.92, 0.55), vP);
  gl_FragColor = vec4(c * a, a);
}
`;
export const FIRE_VERT = PRE + _FIRE_VERT;
export const FIRE_FRAG = PRE + _FIRE_FRAG;

export const YOU_FRAG = PRE + _YOU_FRAG;
export const WAVE_FRAG = PRE + _WAVE_FRAG;
export const RIBBON_FRAG = PRE + _RIBBON_FRAG;
export const SKY_FRAG = PRE + _SKY_FRAG;
export const MILKYWAY_FRAG = PRE + _MILKYWAY_FRAG;
export const STAR_FRAG = PRE + _STAR_FRAG;
export const SPRITE_FRAG = PRE + _SPRITE_FRAG;
export const MOON_FRAG = PRE + _MOON_FRAG;
export const CURTAIN_FRAG = PRE + _CURTAIN_FRAG;
export const HORIZON_FRAG = PRE + _HORIZON_FRAG;
export const SLICE_FRAG = PRE + _SLICE_FRAG;
export const NEW_FRAG = PRE + _NEW_FRAG;
export const BEAM_FRAG = PRE + _BEAM_FRAG;

// vertex shaders (some fade with ss() too)
export const EARTH_VERT = PRE + _EARTH_VERT;
export const CLOUD_VERT = PRE + _CLOUD_VERT;
export const ATMO_VERT = PRE + _ATMO_VERT;
export const SWARM_VERT = PRE + _SWARM_VERT;
export const MARKER_VERT = PRE + _MARKER_VERT;
export const YOU_VERT = PRE + _YOU_VERT;
export const RIBBON_VERT = PRE + _RIBBON_VERT;
export const SKY_VERT = PRE + _SKY_VERT;
export const MILKYWAY_VERT = PRE + _MILKYWAY_VERT;
export const STAR_VERT = PRE + _STAR_VERT;
export const SPRITE_VERT = PRE + _SPRITE_VERT;
export const MOON_VERT = PRE + _MOON_VERT;
export const CURTAIN_VERT = PRE + _CURTAIN_VERT;
export const HORIZON_VERT = PRE + _HORIZON_VERT;
export const SLICE_VERT = PRE + _SLICE_VERT;
export const SKYLINE_VERT = PRE + _SKYLINE_VERT;

// ---------------------------------------------------------------- satellites seen from the ground
// Same orbit solver as SWARM_VERT, but the result is a direction in the observer's sky (x east, y up, -z north).
export const SWARM_SKY_VERT = PRE + /* glsl */ `
attribute vec4 el1; attribute vec4 el2; attribute vec3 el3; attribute float aIdx;
uniform float tMin; uniform float gmst; uniform vec3 obs; uniform vec3 east; uniform vec3 upv; uniform vec3 north; uniform vec3 sunE;
uniform float night; uniform float showAll; uniform vec4 show; uniform float pr; uniform float sizeScale; uniform float selIdx; uniform float time;
varying vec3 vColor; varying float vAlpha;
void main(){
  float dt = tMin - el1.x;
  float e = el1.z;
  float M = mod(el2.z + el1.y * dt, 6.28318530718);
  float raan = el2.x + el3.y * dt;
  float argp = el2.y + el3.z * dt;
  float E = M;
  for (int k = 0; k < 5; k++) { E = E - (E - e * sin(E) - M) / (1.0 - e * cos(E)); }
  float xp = el3.x * (cos(E) - e);
  float yp = el3.x * sqrt(1.0 - e * e) * sin(E);
  float cO = cos(raan), sO = sin(raan), cw = cos(argp), sw = sin(argp), ci = cos(el1.w), si = sin(el1.w);
  float x = (cO * cw - sO * sw * ci) * xp + (-cO * sw - sO * cw * ci) * yp;
  float y = (sO * cw + cO * sw * ci) * xp + (-sO * sw + cO * cw * ci) * yp;
  float z = sw * si * xp + cw * si * yp;
  float ex = x * cos(gmst) + y * sin(gmst);
  float ey = -x * sin(gmst) + y * cos(gmst);
  vec3 p = vec3(ex, z, -ey);
  vec3 d = (p - obs) * 6371.0;
  vec3 loc = vec3(dot(d, east), dot(d, upv), -dot(d, north));
  float dist = length(loc);
  vec3 dir = loc / max(dist, 1.0);
  float t = el2.w;
  float vis = t < 0.5 ? show.x : t < 1.5 ? show.y : t < 2.5 ? show.x : t < 3.5 ? show.z : 1.0;
  vis *= step(el3.x, 7.2) * step(-0.03, dir.y);
  float dp = dot(p, sunE);
  float lit = (dp > 0.0 || length(p - dp * sunE) > 1.0) ? 1.0 : 0.0;
  float flash = 0.8 + 0.2 * sin(time * 2.6 + aIdx * 1.7);
  float bright = lit * night * flash + showAll * 0.3;
  float isStation = t > 3.5 ? 1.0 : 0.0;
  bright = max(bright, isStation * (lit * night + 0.25 * showAll));
  vec3 base = t < 0.5 ? vec3(0.9, 0.95, 1.0) : t < 1.5 ? vec3(0.7, 0.9, 1.0) : t < 2.5 ? vec3(0.75, 0.82, 1.0) : t < 3.5 ? vec3(1.0, 0.7, 0.55) : vec3(1.0, 1.0, 0.9);
  float sel = 1.0 - step(0.5, abs(aIdx - selIdx));
  vColor = mix(base, vec3(1.0, 0.92, 0.55), sel);
  vAlpha = clamp(bright, 0.0, 1.0) * vis;
  vAlpha = max(vAlpha, sel * vis);
  float high = smoothstep(0.0, 0.8, dir.y);
  float size = (isStation > 0.5 ? 9.0 : 3.2 + 1.6 * high) + sel * 12.0;
  gl_PointSize = size * pr * sizeScale * (vAlpha > 0.01 ? 1.0 : 0.0);
  vec4 pos = projectionMatrix * viewMatrix * vec4(dir * 50.0, 1.0);
  gl_Position = pos.xyww;
}
`;

// pulsing gold ring used to mark the selected thing in the ground view (drawn with SPRITE_VERT)
export const RING_FRAG = PRE + /* glsl */ `
uniform float time;
varying vec3 vC; varying float vA;
void main(){
  vec2 p = gl_PointCoord - 0.5; float d = length(p); if (d > 0.5) discard;
  float r = 0.36 + 0.06 * sin(time * 4.0);
  float ring = ss(0.035, 0.0, abs(d - r));
  float tick = ss(0.02, 0.0, abs(abs(p.x) - 0.5 + 0.08)) * step(abs(p.y), 0.02) + ss(0.02, 0.0, abs(abs(p.y) - 0.5 + 0.08)) * step(abs(p.x), 0.02);
  float a = max(ring, tick * 0.8) * vA;
  gl_FragColor = vec4(vC * a, a);
}
`;
