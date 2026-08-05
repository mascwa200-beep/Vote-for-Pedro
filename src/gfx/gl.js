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

uniform mat4 uModel;
uniform mat4 uViewProj;
uniform mat3 uNormalMatrix;

varying vec3 vNormal;
varying vec3 vColor;
varying float vDepth;
varying vec3 vWorld;

void main() {
  vec3 n = normalize(uNormalMatrix * aNormal);
  vec4 world = uModel * vec4(aPosition, 1.0);
  gl_Position = uViewProj * world;
  vNormal = n;
  vColor = aColor;
  vDepth = gl_Position.w;
  vWorld = world.xyz;
}
`;

// Two lights and a rim term, all constant. There is no light in space, but
// there is no ship in space either, and a hull lit from exactly one direction
// loses half its faces to solid black.
const FRAG = `
precision mediump float;

varying vec3 vNormal;
varying vec3 vColor;
varying float vDepth;
varying vec3 vWorld;

uniform vec3 uKey;        // key light direction
uniform vec3 uFill;       // fill light direction
uniform vec3 uTint;       // faction/status tint multiplied into the hull
uniform float uAlpha;
uniform float uEmissive;  // 1.0 makes the surface ignore lighting entirely
uniform float uFogFar;    // distance at which the haze reaches its floor
uniform float uAmbient;   // how much light a surface facing away still gets
uniform float uKeyPower;  // strength of the key
uniform vec3 uEye;        // where the camera is, for the specular
uniform float uGloss;     // 0 for matte, 1 for painted metal and moulded plastic

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
  vec3 lit = vColor * uTint * (uAmbient + key * uKeyPower + fill);

  // A specular highlight, Blinn-Phong, one term.
  //
  // Painted metal and moulded plastic both have one, and neither reads as its
  // material without it — a flat-shaded bulkhead with no highlight is a
  // coloured polygon, and the same bulkhead with a soft sheen sliding across it
  // as you turn your head is a wall. It is also the cheapest possible cue that
  // the camera is MOVING through a real place rather than panning a picture.
  if (uGloss > 0.001) {
    vec3 v = normalize(uEye - vWorld);
    vec3 halfway = normalize(normalize(uKey) + v);
    float spec = pow(max(dot(n, halfway), 0.0), 24.0) * uGloss;
    lit += vec3(spec);
  }
  lit = mix(lit, vColor * uTint, uEmissive);

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
  gl_FragColor = vec4(lit * fog, uAlpha);
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
    };

    // Scratch float32 views. Matrices are float64 in the simulation and must be
    // narrowed on the way to the GPU; doing it into a reused array keeps the
    // draw path allocation-free.
    this._m4a = new Float32Array(16);
    this._m4b = new Float32Array(16);
    this._m3 = new Float32Array(9);

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
    gl.uniform3f(this.uniform.key, 0.55, 0.72, 0.42);
    gl.uniform3f(this.uniform.fill, -0.6, -0.2, -0.5);
    // Vacuum by default: one hard sun and nothing to bounce off.
    gl.uniform1f(this.uniform.ambient, 0.22);
    gl.uniform1f(this.uniform.keyPower, 0.85);
    gl.uniform1f(this.uniform.gloss, 0);
    return true;
  }

  /**
   * Light the scene as a place rather than as a vacuum.
   *
   * `key` and `fill` are DIRECTIONS the light comes from; `ambient` is what a
   * surface facing away from both still receives, which in a room is most of
   * the light and in space is almost none.
   */
  setLighting({ key, fill, ambient = 0.22, keyPower = 0.85, eye, gloss = 0 } = {}) {
    if (this.lost) return;
    const { gl } = this;
    if (key) gl.uniform3f(this.uniform.key, key[0], key[1], key[2]);
    if (fill) gl.uniform3f(this.uniform.fill, fill[0], fill[1], fill[2]);
    if (eye) gl.uniform3f(this.uniform.eye, eye[0], eye[1], eye[2]);
    gl.uniform1f(this.uniform.ambient, ambient);
    gl.uniform1f(this.uniform.keyPower, keyPower);
    gl.uniform1f(this.uniform.gloss, gloss);
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
   * @param {object} opts { model, normalMatrix, tint, alpha, emissive }
   */
  draw(key, mesh, {
    model, normalMatrix, tint = [1, 1, 1], alpha = 1, emissive = 0,
    // Default is the engagement volume, which is what almost every draw is.
    fogFar = 9000,
  }) {
    if (this.lost) return;
    const entry = this.upload(key, mesh);
    if (!entry) return;
    const { gl } = this;

    gl.bindBuffer(gl.ARRAY_BUFFER, entry.buffer);
    const { position, normal, color } = this.attrib;
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 3, gl.FLOAT, false, entry.stride, 0);
    gl.enableVertexAttribArray(normal);
    gl.vertexAttribPointer(normal, 3, gl.FLOAT, false, entry.stride, 12);
    gl.enableVertexAttribArray(color);
    gl.vertexAttribPointer(color, 3, gl.FLOAT, false, entry.stride, 24);

    this._m4b.set(model);
    gl.uniformMatrix4fv(this.uniform.model, false, this._m4b);
    this._m3.set(normalMatrix);
    gl.uniformMatrix3fv(this.uniform.normalMatrix, false, this._m3);
    gl.uniform3f(this.uniform.tint, tint[0], tint[1], tint[2]);
    gl.uniform1f(this.uniform.alpha, alpha);
    gl.uniform1f(this.uniform.emissive, emissive);
    gl.uniform1f(this.uniform.fogFar, fogFar);

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
