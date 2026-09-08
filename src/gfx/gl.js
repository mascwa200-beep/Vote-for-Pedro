// A very small WebGL wrapper.
//
// WebGL 1, deliberately: it is available everywhere, including on the WebView
// inside the APK, and nothing here needs WebGL 2. There is no fallback path to
// maintain and no feature detection beyond "did the context come back".
//
// Three things this does that a naive wrapper does not:
//
//   It survives context loss. A phone that backgrounds the tab, or a driver
//   that resets, takes the context away and every buffer with it. The game must
//   come back rather than showing a black rectangle for the rest of the session.
//
//   It reports failure honestly. If the context cannot be created — a very old
//   device, a headless runner with no GPU, WebGL disabled — `Renderer.create`
//   returns null and the caller falls back to the 2D display, which still works.
//
//   It never allocates in the draw path.

const VERT = `
precision mediump float;

attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec3 aColor;
attribute float aGlow;

uniform mat4 uModel;
uniform mat4 uViewProj;
uniform mat3 uNormalMatrix;

varying vec3 vNormal;
varying vec3 vColor;
varying float vDepth;
varying vec3 vWorld;
varying float vGlow;
varying vec3 vObject;

void main() {
  vec3 n = normalize(uNormalMatrix * aNormal);
  vec4 world = uModel * vec4(aPosition, 1.0);
  gl_Position = uViewProj * world;
  vNormal = n;
  vColor = aColor;
  vGlow = aGlow;
  vDepth = gl_Position.w;
  vWorld = world.xyz;
  // The mesh's OWN space, which is where surface detail has to live.
  //
  // vWorld already exists and is the wrong thing for this: a hull that turns
  // would have its plating slide across it, and two ships of the same class in
  // different places would be plated differently. aPosition is cached per class
  // and never moves, so a panel line stays welded to the plate it is on.
  //
  // This is what makes texture-like detail possible with no texture and no UV:
  // there is no unwrap to author for procedurally generated geometry, and no
  // atlas to pack, because the coordinate is already here.
  vObject = aPosition;
}
`;

// Two lights, a highlight and a rim term. There is no light in space, but there
// is no ship in space either, and a hull lit from exactly one direction loses
// half its faces to solid black.
//
// This note used to say "two lights and a rim term, all constant", and both
// halves of that were wrong. There was no rim term at all — the sentence above
// stated the problem one should solve and then nothing solved it — and nothing
// here has been constant since ambient and key strength became per-frame. The
// rim exists now, and the four terms below say for themselves which they are.
const FRAG = `
precision mediump float;

varying vec3 vNormal;
varying vec3 vColor;
varying float vDepth;
varying vec3 vWorld;
varying float vGlow;
varying vec3 vObject;

uniform vec3 uKey;        // key light direction
uniform vec3 uFill;       // fill light direction
uniform vec3 uTint;       // faction/status tint multiplied into the hull
uniform float uAlpha;
uniform float uEmissive;  // 1.0 makes the WHOLE draw ignore lighting
uniform float uFogFar;    // distance at which the haze reaches its floor
uniform float uAmbient;   // how much light a surface facing away still gets
uniform float uKeyPower;  // strength of the key
uniform vec3 uEye;        // where the camera is, for the specular
uniform float uGloss;     // 0 for matte, 1 for painted metal and moulded plastic
uniform float uShine;     // the specular exponent: high is tight, low is broad
uniform float uRim;       // light picked up along the silhouette; 0 disables
uniform vec3 uSky;        // ambient arriving from above; white is the old flat term
uniform vec3 uGround;     // ambient arriving from below; white is the old flat term
uniform float uGlowGain;  // how far above white a self-lit face is driven
uniform float uExposure;  // scene exposure, applied before the tonemap
uniform vec2 uDetail;     // .x cycles across the object, .y strength; 0 disables

// A highlight rolloff: identity below the knee, asymptotic to white above it.
//
// The shader had no tonemap at all, and the tell was in the material constants —
// HULL_GLOSS is documented as tuned so its specular peak lands at exactly 1.000,
// because anything above that clipped to a flat white chip. Without somewhere to
// put values above white, every bright thing in the game was either kept under
// the ceiling or destroyed by it.
//
// The obvious answer is a filmic S-curve, and the first draft of this was the
// ACES approximation. That is the wrong curve for THIS renderer and it is worth
// saying why: ACES is scene-referred, built for input where 1.0 is white paper
// and highlights run to 16 and beyond, so applied to already display-referred
// values it lifts every mid-tone — a 0.5 becomes 0.62. This palette has been
// hand-tuned against the existing treatment across many sections, and a curve
// that moves every colour in the game is a change to all of that work disguised
// as a renderer feature.
//
// So: below knee this is exactly the identity, and the picture below it is
// bit-for-bit what it was. Above, values roll off along a hyperbola that
// approaches 1.0 and never reaches it. The join is C1-continuous — the slope is
// 1 on both sides at the knee — so there is no visible seam where it takes over.
//
// Deliberately NOT paired with a gamma decode/encode either, for the same
// reason: the correct pipeline converts albedo from sRGB to linear, lights
// there, and encodes back, and that too would move every authored colour. That
// is the change the chromaticity guards in the suite exist to catch, and it is
// not this one.
vec3 rolloff(vec3 x) {
  const float knee = 0.75;
  vec3 over = max(x - knee, 0.0);
  return min(x, knee) + (1.0 - knee) * (over / (over + (1.0 - knee)));
}

// Surface detail, computed rather than sampled.
//
// This project ships no art it did not make, so there are no textures — and
// there are no UV coordinates in the vertex format either, which rules out
// generating one at load and sampling it: a procedurally generated hull has no
// unwrap to sample it WITH. What it does have is an object-space position, and
// a field evaluated on that gives plating and panel seams welded to the hull,
// for one varying and no vertex format change.
//
// Triangle waves, not a hash. The obvious noise for this is
// fract(sin(dot(p, k)) * large), and it must not be used here: this shader is
// mediump, that function needs the low bits of a large product, and on a phone
// it degenerates into banding or a constant. abs(fract(x) - 0.5) is exact at
// any precision.
//
// The frequencies are mutually unrelated so the octaves never line up and
// repeat visibly, which is the same reason terrain() in scene.js multiplies by
// 2.07 rather than 2.
float tri1(float x) { return abs(fract(x) - 0.5) * 2.0; }

float plating(vec3 p, float f) {
  float a = (tri1(p.x * f) + tri1(p.y * f * 0.73) + tri1(p.z * f * 1.31)) / 3.0;
  float b = (tri1(p.x * f * 2.13 + 0.37) + tri1(p.z * f * 2.61 + 0.11)) / 2.0;
  return a * 0.65 + b * 0.35;
}

// The narrow dark line where two plates meet. This is the term that reads as
// panelling rather than as noise — and the one that has to fade with distance,
// because a seam thinner than a pixel is not detail, it is aliasing, and there
// is no mipmap under a computed field to do it for us.
float seams(vec3 p, float f) {
  vec3 g = abs(fract(p * f) - 0.5) * 2.0;
  return smoothstep(0.0, 0.10, min(min(g.x, g.y), g.z));
}

void main() {
  vec3 n = normalize(vNormal);
  float key = max(dot(n, normalize(uKey)), 0.0);
  float fill = max(dot(n, normalize(uFill)), 0.0) * 0.35;

  // Ambient and key strength are per-FRAME now, not constants.
  //
  // 0.22 ambient with a single hard key is right for a hull in vacuum, where
  // there is one sun and nothing to bounce off. It is completely wrong for a
  // room: a bridge lit from a ceiling ring, with pale grey walls bouncing light
  // at each other, has almost no true shadow in it. Hardcoding the vacuum value
  // rendered the interior as a black box with a few lit panels floating in it.
  //
  // The ambient has a DIRECTION now. A flat scalar gives every face away from the
  // key the same fill regardless of which way it points, which is the one thing
  // that reliably reads as computer graphics: real ambient arrives mostly from
  // one hemisphere — sky above a planet, deckhead above a room, the galactic
  // plane in open space. Blending sky against ground on n.y costs one mix and is
  // what makes a corner of a corridor read as a corner.
  //
  // uSky == uGround == white reproduces the old flat term exactly, which is the
  // default, so every caller that has not been taught about this is unaffected.
  vec3 ambient = uAmbient * mix(uGround, uSky, n.y * 0.5 + 0.5);

  // Plating and panel seams, faded out with distance so they never alias.
  //
  // Applied to the ALBEDO, before any lighting, because that is what they are:
  // the hull is not a uniform colour, it is plates. Modulating the lit result
  // instead would put panel lines on top of the highlight as well, which reads
  // as dirt on the lens rather than as a surface.
  vec3 albedo = vColor;
  if (uDetail.y > 0.001) {
    float near = clamp(1.0 - vDepth / (uFogFar * 0.35), 0.0, 1.0);
    float d = plating(vObject, uDetail.x) - 0.5;
    float s = seams(vObject, uDetail.x * 0.18);
    albedo *= (1.0 + d * uDetail.y * near) * mix(1.0, s, 0.35 * near);
  }

  vec3 lit = albedo * uTint * (ambient + key * uKeyPower + fill);

  // A specular highlight, Blinn-Phong, one term.
  //
  // Painted metal and moulded plastic both have one, and neither reads as its
  // material without it — a flat-shaded bulkhead with no highlight is a
  // coloured polygon, and the same bulkhead with a soft sheen sliding across it
  // as you turn your head is a wall. It is also the cheapest possible cue that
  // the camera is MOVING through a real place rather than panning a picture.
  vec3 v = normalize(uEye - vWorld);

  if (uGloss > 0.001) {
    vec3 halfway = normalize(normalize(uKey) + v);
    float spec = pow(max(dot(n, halfway), 0.0), uShine) * uGloss;
    // Weighted by the surface's own brightness, which is the material channel
    // this mesh already carries. Within one hull the trim colour is a scaled
    // down version of the plate colour, so luminance separates panel from plate
    // with no new vertex attribute; across hulls it makes matte Klingon green
    // less glossy than Starfleet enamel, which is what those two hulls are.
    //
    // Nothing extra is needed to keep the highlight off a window: the mix below
    // replaces the lit colour outright at vGlow = 1, so this term is already
    // multiplied by (1 - vGlow) for free. Measured on the fleet rather than
    // assumed — every painted surface carries glow 0 and every self-lit one
    // carries glow above 0.45.
    //
    // (No backticks anywhere in this shader source: it is a JS template
    // literal, and one in a comment ends the string.)
    lit += vec3(spec * (0.35 + 0.65 * dot(vColor, vec3(0.299, 0.587, 0.114))));
  }

  // The rim the header at the top of this file has been promising since it was
  // written, and which was not here.
  //
  // It is the term that works where the specular one does not, and the reason
  // is geometric rather than a matter of taste. A highlight needs the normal to
  // line up with the half-vector, which on a flat-shaded hull a few dozen
  // pixels across is luck: the facets point where they point, the lobe is
  // narrower than the gap between them, and the whole ship samples the lobe at
  // one instant of one direction. Measured, wiring the specular alone moved the
  // brightest pixel on a hull by thirteen levels out of 255 and was invisible
  // at four times the clipping ceiling.
  //
  // A rim needs the normal to be PERPENDICULAR to the view, which every closed
  // shape guarantees all the way round its own outline, on every frame, at
  // every angle. That is why the header's complaint — a hull lit from one
  // direction loses half its faces to solid black — is answered by this and not
  // by a highlight: it puts light exactly where there is none, along the edge
  // that separates the ship from the starfield.
  //
  // In the surface's OWN colour, not white. White hangs a halo round the hull
  // and greys out the faction palette; multiplying the albedo can only lift a
  // surface toward more of what it already is, so a Klingon hull rims green and
  // a Starfleet one rims white without either being told to.
  //
  // Cubed, so it is confined to the facets that are genuinely edge-on. Squared
  // reaches too far inboard and reads as fog on the hull.
  if (uRim > 0.001) {
    float rim = 1.0 - max(dot(n, v), 0.0);
    lit += vColor * uTint * (rim * rim * rim * uRim);
  }
  // Per-vertex glow, or the whole-draw uniform, whichever is higher.
  //
  // The uniform is still how a phaser bolt or a warp field says "all of me is
  // self-lit". The attribute is how a HULL says "these particular faces are" —
  // windows, bussard domes, the deflector, an impulse deck — without paying a
  // second draw call for them. A hull with no lit faces carries zeroes here and
  // renders exactly as it did before.
  //
  // Fog toward the far plane, so a distant hull recedes rather than hanging
  // at full contrast against the starfield.
  //
  // The falloff used to be hardcoded at 9,000 units, which is right for the
  // 3,000-unit engagement volume and wrong for everything else in the scene.
  // A planet sits four to thirteen thousand units out and the starfield twelve
  // thousand, so both were pinned at the 0.35 floor — the sky was permanently
  // dimmed to a third of its colour and a world outside the window rendered as
  // a near-black disc. It is a uniform now, and the draws that are meant to be
  // far away set it accordingly.
  float fog = clamp(1.0 - vDepth / uFogFar, 0.35, 1.0);

  // The rolloff covers the LIT path ONLY, and this is the most important line
  // in the change.
  //
  // A self-lit surface is not a measurement of arriving light — it is the
  // colour the mesh asked for, and the whole reason the glow channel exists is
  // that a window has to punch through the haze. Running it through a shoulder
  // costs exactly the thing §99 spent a section buying: shadedAlong bakes a
  // 0.58-to-1.18 ramp into every window belt, port row and greeble run in the
  // fleet, and the display span of that ramp measures
  //
  //     today, clamped at 1.0      0.580 -> 1.000     span 0.420
  //     rolled off with the lit    0.580 -> 0.908     span 0.328
  //
  // — a fifth of the gradient work on half the fleet's vertices, given away to
  // a curve that was never meant to touch it. Mapping the two paths separately
  // costs one extra mix and gives that back.
  //
  // uGlowGain is 1.0 by default, and at 1.0 this branch is bit-for-bit what
  // the shader did before. Emissive surfaces are not where the glow should come
  // from anyway: driving them above white only clips the same ramp from the
  // other end. The glow belongs in the overlay glare pass, where it can be a
  // halo AROUND the aperture rather than a brighter aperture.
  vec3 mapped = rolloff(lit * fog * uExposure);
  vec3 selfLit = clamp(vColor * uTint * uGlowGain, 0.0, 1.0) * fog;
  gl_FragColor = vec4(mix(mapped, selfLit, clamp(max(uEmissive, vGlow), 0.0, 1.0)), uAlpha);
}
`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`shader failed to compile: ${log}`);
  }
  return shader;
}

function link(gl, vertSrc, fragSrc) {
  const program = gl.createProgram();
  const vs = compile(gl, gl.VERTEX_SHADER, vertSrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragSrc);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`program failed to link: ${log}`);
  }
  return program;
}

/**
 * The lighting a scene in space gets when nothing asks for anything else.
 *
 * One hard sun and nothing to bounce off. It lives here, as one object, because
 * `beginFrame` sets it at the top of every frame AND any pass that lights
 * something differently has to be able to put it back afterwards — and two
 * copies of four numbers is two places for the vacuum to drift apart from
 * itself.
 */
export const VACUUM_LIGHT = {
  key: [0.55, 0.72, 0.42],
  fill: [-0.6, -0.2, -0.5],
  ambient: 0.22,
  keyPower: 0.85,
};

/**
 * Scene exposure, multiplied in immediately before the highlight rolloff.
 *
 * 1.0 on purpose, and it is the honest default rather than a placeholder. The
 * rolloff is the identity below its knee, so at exposure 1.0 every pixel the
 * game drew below 0.75 is unchanged to the bit — which means this whole change
 * can be judged on what it does to the bright end alone, with nothing else
 * moving underneath it.
 *
 * It is a uniform rather than a constant because the bridge and open space want
 * different answers eventually, and because the one thing a renderer with no
 * tonemap could not offer was a single place to say "this scene is brighter".
 */
const EXPOSURE = 1.0;

export class Renderer {
  /**
   * @returns {Renderer|null} null when WebGL is unavailable, which is a
   *   supported outcome and not an error — the caller draws in 2D instead.
   */
  static create(canvas) {
    let gl = null;
    try {
      const opts = {
        alpha: false,
        antialias: true,
        depth: true,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: false,
        failIfMajorPerformanceCaveat: false,
      };
      gl = canvas.getContext('webgl', opts) ?? canvas.getContext('experimental-webgl', opts);
    } catch { gl = null; }
    if (!gl) return null;

    try {
      const r = new Renderer(canvas, gl);
      if (r.lost) return null;
      Renderer.lastError = null;
      return r;
    } catch (err) {
      // A shader that fails to compile must not look like a device without
      // WebGL. Both used to return a bare null, so a one-character GLSL typo
      // silently downgraded the whole game to the 2D fallback with nothing
      // anywhere saying why — and the message the driver went to the trouble of
      // writing was thrown away.
      Renderer.lastError = String(err?.message ?? err);
      console.error('[gl] renderer unavailable:', Renderer.lastError);
      return null;
    }
  }

  /** Why the last `create` failed, or null if it did not. For the harness. */
  static lastError = null;

  constructor(canvas, gl) {
    this.canvas = canvas;
    this.gl = gl;
    this.lost = false;
    this.drawCalls = 0;
    this.triangles = 0;
    this.buffers = new Map();

    this.program = link(gl, VERT, FRAG);
    this.attrib = {
      position: gl.getAttribLocation(this.program, 'aPosition'),
      normal: gl.getAttribLocation(this.program, 'aNormal'),
      color: gl.getAttribLocation(this.program, 'aColor'),
      glow: gl.getAttribLocation(this.program, 'aGlow'),
    };
    this.uniform = {
      model: gl.getUniformLocation(this.program, 'uModel'),
      viewProj: gl.getUniformLocation(this.program, 'uViewProj'),
      normalMatrix: gl.getUniformLocation(this.program, 'uNormalMatrix'),
      key: gl.getUniformLocation(this.program, 'uKey'),
      fill: gl.getUniformLocation(this.program, 'uFill'),
      tint: gl.getUniformLocation(this.program, 'uTint'),
      alpha: gl.getUniformLocation(this.program, 'uAlpha'),
      emissive: gl.getUniformLocation(this.program, 'uEmissive'),
      fogFar: gl.getUniformLocation(this.program, 'uFogFar'),
      ambient: gl.getUniformLocation(this.program, 'uAmbient'),
      keyPower: gl.getUniformLocation(this.program, 'uKeyPower'),
      eye: gl.getUniformLocation(this.program, 'uEye'),
      gloss: gl.getUniformLocation(this.program, 'uGloss'),
      shine: gl.getUniformLocation(this.program, 'uShine'),
      rim: gl.getUniformLocation(this.program, 'uRim'),
      sky: gl.getUniformLocation(this.program, 'uSky'),
      ground: gl.getUniformLocation(this.program, 'uGround'),
      glowGain: gl.getUniformLocation(this.program, 'uGlowGain'),
      exposure: gl.getUniformLocation(this.program, 'uExposure'),
      detail: gl.getUniformLocation(this.program, 'uDetail'),
    };

    // Scratch float32 views. Matrices are float64 in the simulation and must be
    // narrowed on the way to the GPU; doing it into a reused array keeps the
    // draw path allocation-free.
    this._m4a = new Float32Array(16);
    this._m4b = new Float32Array(16);
    this._m3 = new Float32Array(9);
    /** The frame's sheen and its tightness, for draws that name neither. */
    this._gloss = 0;
    this._shine = 24;
    this._rim = 0;
    this._detail = [0, 0];

    this._onLost = (e) => { e.preventDefault(); this.lost = true; this.buffers.clear(); };
    this._onRestored = () => { this.lost = false; this.restore(); };
    canvas.addEventListener('webglcontextlost', this._onLost, false);
    canvas.addEventListener('webglcontextrestored', this._onRestored, false);

    this.configure();
  }

  configure() {
    const { gl } = this;
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0.016, 0.02, 0.04, 1);
  }

  /** Rebuild everything the lost context took with it. */
  restore() {
    try {
      this.program = link(this.gl, VERT, FRAG);
      this.attrib = {
        position: this.gl.getAttribLocation(this.program, 'aPosition'),
        normal: this.gl.getAttribLocation(this.program, 'aNormal'),
        color: this.gl.getAttribLocation(this.program, 'aColor'),
        glow: this.gl.getAttribLocation(this.program, 'aGlow'),
      };
      for (const [k, v] of Object.entries(this.uniform)) {
        this.uniform[k] = this.gl.getUniformLocation(this.program, `u${k[0].toUpperCase()}${k.slice(1)}`);
        void v;
      }
      this.configure();
    } catch (err) {
      this.lost = true;
      Renderer.lastError = String(err?.message ?? err);
      throw err;
    }
  }

  /** Size the drawing buffer to the element, capped so a 3× phone stays fast. */
  resize(cssWidth, cssHeight, dpr = 1) {
    const scale = Math.min(dpr, 2);
    const w = Math.max(1, Math.round(cssWidth * scale));
    const h = Math.max(1, Math.round(cssHeight * scale));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.gl.viewport(0, 0, w, h);
    return { width: w, height: h, aspect: w / Math.max(1, h) };
  }

  beginFrame() {
    if (this.lost) return false;
    const { gl } = this;
    this.drawCalls = 0;
    this.triangles = 0;
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);
    // Vacuum by default: one hard sun and nothing to bounce off.
    const { key, fill, ambient, keyPower } = VACUUM_LIGHT;
    gl.uniform3f(this.uniform.key, key[0], key[1], key[2]);
    gl.uniform3f(this.uniform.fill, fill[0], fill[1], fill[2]);
    gl.uniform1f(this.uniform.ambient, ambient);
    gl.uniform1f(this.uniform.keyPower, keyPower);
    this._gloss = 0;
    this._shine = 24;
    this._rim = 0;
    gl.uniform1f(this.uniform.gloss, 0);
    gl.uniform1f(this.uniform.shine, 24);
    gl.uniform1f(this.uniform.rim, 0);
    // The tonemap's neutral setting, and a flat white hemisphere, so a frame
    // that never calls `setLighting` renders as it always did apart from the
    // filmic curve itself.
    gl.uniform3f(this.uniform.sky, 1, 1, 1);
    gl.uniform3f(this.uniform.ground, 1, 1, 1);
    gl.uniform1f(this.uniform.glowGain, 1);
    gl.uniform1f(this.uniform.exposure, EXPOSURE);
    this._detail = [0, 0];
    gl.uniform2f(this.uniform.detail, 0, 0);
    return true;
  }

  /**
   * Light the scene as a place rather than as a vacuum.
   *
   * `key` and `fill` are DIRECTIONS the light comes from; `ambient` is what a
   * surface facing away from both still receives, which in a room is most of
   * the light and in space is almost none.
   */
  setLighting({
    key, fill, ambient = 0.22, keyPower = 0.85, eye, gloss = 0, shine = 24, rim = 0,
    sky = null, ground = null, glowGain = 1, exposure = EXPOSURE,
  } = {}) {
    if (this.lost) return;
    const { gl } = this;
    if (key) gl.uniform3f(this.uniform.key, key[0], key[1], key[2]);
    if (fill) gl.uniform3f(this.uniform.fill, fill[0], fill[1], fill[2]);
    if (eye) gl.uniform3f(this.uniform.eye, eye[0], eye[1], eye[2]);
    gl.uniform1f(this.uniform.ambient, ambient);
    gl.uniform1f(this.uniform.keyPower, keyPower);
    // A caller that names neither gets a flat white hemisphere, which is the
    // old scalar ambient exactly. Naming one and not the other is a mistake
    // worth not silently accepting, so both fall back together.
    const above = sky ?? ground ?? [1, 1, 1];
    const below = ground ?? sky ?? [1, 1, 1];
    gl.uniform3f(this.uniform.sky, above[0], above[1], above[2]);
    gl.uniform3f(this.uniform.ground, below[0], below[1], below[2]);
    gl.uniform1f(this.uniform.glowGain, glowGain);
    gl.uniform1f(this.uniform.exposure, exposure);
    // The scene's default sheen. A draw may override it for one mesh; see
    // `draw`. Remembered so that an overriding draw does not leak its value
    // into the next one.
    this._gloss = gloss;
    gl.uniform1f(this.uniform.gloss, gloss);
    this._shine = shine;
    gl.uniform1f(this.uniform.shine, shine);
    this._rim = rim;
    gl.uniform1f(this.uniform.rim, rim);
  }

  /**
   * Restrict drawing to a rectangle of the canvas, in device pixels.
   *
   * This is how the viewscreen works. A bridge with a live view of space in it
   * needs the exterior scene rendered INSIDE a rectangle of the interior one,
   * and this renderer has no framebuffer objects and no render-to-texture — it
   * is one program, one context, one buffer. A scissor rectangle plus a pushed
   * depth range gets the same picture out of two passes over the same context,
   * with no second canvas and nothing to keep in sync.
   *
   * @param {number} y measured from the TOP, like every other rectangle in the
   *        DOM; GL counts from the bottom and the flip happens here rather than
   *        at each call site.
   */
  setScissor(x, y, w, h) {
    if (this.lost) return;
    const { gl } = this;
    const H = this.canvas.height;
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(
      Math.max(0, Math.round(x)),
      Math.max(0, Math.round(H - y - h)),
      Math.max(0, Math.round(w)),
      Math.max(0, Math.round(h)),
    );
  }

  clearScissor() {
    if (!this.lost) this.gl.disable(this.gl.SCISSOR_TEST);
  }

  /**
   * Draw into a rectangle of the canvas instead of all of it.
   *
   * Top-left origin, same as `setScissor`, because everything else in this
   * codebase measures the canvas that way and GL is the odd one out.
   *
   * This is what makes a picture-in-picture possible: a camera built for the
   * rectangle rather than for the canvas. Scissoring alone crops a full-canvas
   * projection down, which is a very different picture — the main viewer was
   * showing a fourteen-degree slice of a seventy-four-degree cone, and a slice
   * that narrow contains less than one star.
   */
  setViewport(x, y, w, h) {
    if (this.lost) return;
    const H = this.canvas.height;
    this.gl.viewport(
      Math.round(x), Math.round(H - y - h),
      Math.max(1, Math.round(w)), Math.max(1, Math.round(h)),
    );
  }

  /** Back to the whole canvas. */
  resetViewport() {
    if (!this.lost) this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * Reset the depth buffer, honouring the scissor if one is set.
   *
   * `glClear` obeys the scissor test, which makes this the way to say "what
   * comes next sits in front of everything already drawn HERE" without saying
   * anything about the rest of the frame. The alternative — squeezing the
   * background into a thin slice at the far end of the depth range — depends
   * on the depth buffer having enough bits to tell that slice apart from the
   * cleared value, and on a 16-bit buffer it does not.
   */
  clearDepth() {
    if (!this.lost) this.gl.clear(this.gl.DEPTH_BUFFER_BIT);
  }

  /**
   * Push a draw to the back of the depth buffer, or restore the full range.
   *
   * The other half of the viewscreen: the exterior is drawn first into the
   * far slice, so the bridge geometry drawn afterwards covers everything except
   * the aperture — where there is no geometry, and space shows through.
   * Clearing the depth buffer between passes instead would let the wall paint
   * over the screen.
   */
  setDepthRange(near = 0, far = 1) {
    if (!this.lost) this.gl.depthRange(near, far);
  }

  setCamera(viewProj) {
    this._m4a.set(viewProj);
    this.gl.uniformMatrix4fv(this.uniform.viewProj, false, this._m4a);
  }

  /** Upload a mesh once and keep the buffer under `key`. */
  upload(key, mesh) {
    if (this.lost) return null;
    let entry = this.buffers.get(key);
    if (entry) return entry;
    const { gl } = this;
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.data, gl.STATIC_DRAW);
    entry = { buffer, vertexCount: mesh.vertexCount, stride: mesh.stride };
    this.buffers.set(key, entry);
    return entry;
  }

  /**
   * Draw an uploaded mesh.
   *
   * `gloss` is per-DRAW rather than per-frame, which is what makes it a
   * material and not a lighting setting. A painted hull and the asteroid it is
   * flying past are lit by the same sun and are not the same substance; a
   * single frame-wide sheen either puts a highlight on the rock or takes it off
   * the ship. Everything else in a frame keeps whatever the last `setLighting`
   * asked for, so a draw that says nothing about gloss is unchanged.
   *
   * @param {object} opts { model, normalMatrix, tint, alpha, emissive, gloss }
   */
  draw(key, mesh, {
    model, normalMatrix, tint = [1, 1, 1], alpha = 1, emissive = 0,
    gloss = null, shine = null, rim = null, detail = null,
    // Default is the engagement volume, which is what almost every draw is.
    fogFar = 9000,
  }) {
    if (this.lost) return;
    const entry = this.upload(key, mesh);
    if (!entry) return;
    const { gl } = this;

    gl.bindBuffer(gl.ARRAY_BUFFER, entry.buffer);
    const { position, normal, color, glow } = this.attrib;
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 3, gl.FLOAT, false, entry.stride, 0);
    gl.enableVertexAttribArray(normal);
    gl.vertexAttribPointer(normal, 3, gl.FLOAT, false, entry.stride, 12);
    gl.enableVertexAttribArray(color);
    gl.vertexAttribPointer(color, 3, gl.FLOAT, false, entry.stride, 24);
    if (glow >= 0) {
      gl.enableVertexAttribArray(glow);
      gl.vertexAttribPointer(glow, 1, gl.FLOAT, false, entry.stride, 36);
    }

    this._m4b.set(model);
    gl.uniformMatrix4fv(this.uniform.model, false, this._m4b);
    this._m3.set(normalMatrix);
    gl.uniformMatrix3fv(this.uniform.normalMatrix, false, this._m3);
    gl.uniform3f(this.uniform.tint, tint[0], tint[1], tint[2]);
    gl.uniform1f(this.uniform.alpha, alpha);
    gl.uniform1f(this.uniform.emissive, emissive);
    gl.uniform1f(this.uniform.fogFar, fogFar);
    gl.uniform1f(this.uniform.gloss, gloss ?? this._gloss);
    gl.uniform1f(this.uniform.shine, shine ?? this._shine);
    gl.uniform1f(this.uniform.rim, rim ?? this._rim);
    // Written on EVERY draw, never conditionally. A hull that asks for plating
    // and a room that does not, drawn in that order, would otherwise put hull
    // plating on the deck — the same leak `_gloss` above exists to prevent.
    const det = detail ?? this._detail;
    gl.uniform2f(this.uniform.detail, det[0], det[1]);

    gl.drawArrays(gl.TRIANGLES, 0, entry.vertexCount);
    this.drawCalls++;
    this.triangles += entry.vertexCount / 3;
  }

  /** Release everything. Called when the tactical view is torn down. */
  dispose() {
    this.canvas.removeEventListener('webglcontextlost', this._onLost);
    this.canvas.removeEventListener('webglcontextrestored', this._onRestored);
    if (this.lost) return;
    for (const { buffer } of this.buffers.values()) this.gl.deleteBuffer(buffer);
    this.buffers.clear();
    this.gl.deleteProgram(this.program);
  }
}
