// The hero's clear sky as a fragment shader (motion-background: shader technique, plain WebGL, no Three.js:
// one full-screen triangle does not need 700 KB of library). It opens already clear: a deep blue sky with
// bright white clouds in two layers that keep drifting, sliding apart with scroll and the pointer, under a
// warm sun with soft rays. Colours are set in OKLCH (color-motion) and dithered with grain so the gradient
// never bands. A pale pool behind the headline keeps the copy readable over any cloud.
// The CSS sky (sky.css) stays underneath as the fallback: no WebGL, a lost context or a shader error just
// leaves it showing. Reduced motion gets one still frame of the clear sky. ?t=N renders the frame at N s.
(() => {
  const sky = document.querySelector("[data-sky-gl]");
  if (!sky) return;
  const hero = sky.parentElement;

  // ---------- colour: OKLCH in, sRGB out ----------
  const oklchToRgb = ([L, C, h]) => {
    const a = C * Math.cos((h * Math.PI) / 180), b = C * Math.sin((h * Math.PI) / 180);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const lin = [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ];
    return lin.map((v) => {
      const c = Math.min(1, Math.max(0, v));
      return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
    });
  };
  // deep sky on top (#579EDF), lighter behind the headline (#A3D1F5), the page ground at the bottom (--bg)
  const SKY = { top: [0.68, 0.12, 248], mid: [0.84, 0.07, 242], sun: [0.95, 0.07, 75] };
  const ground = (getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#dfeaf7")
    .replace("#", "").match(/../g).map((h) => parseInt(h, 16) / 255);

  // ---------- GL ----------
  const canvas = document.createElement("canvas");
  canvas.className = "sky-canvas";
  canvas.setAttribute("aria-hidden", "true");
  const gl = canvas.getContext("webgl", { antialias: false, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: "low-power" });
  if (!gl) return;

  const VERT = "attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }";
  const FRAG = `
precision highp float;
uniform vec2 uRes; uniform float uTime, uScroll; uniform vec2 uMouse;
uniform vec3 uTop, uMid, uGround, uSun;
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0)), c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
  return v;
}
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  float y = uv.y;
  // sky: ground at the bottom (the conveyor stands on it), mid sky behind the headline, deeper blue on top
  vec3 col = mix(uGround, uMid, smoothstep(0.08, 0.5, y));
  col = mix(col, uTop, smoothstep(0.5, 1.05, y));
  // sun breaking through, top right, with slow soft rays
  vec2 d = (uv - vec2(0.86, 1.04)) * vec2(aspect, 1.0);
  float r = length(d);
  col += uSun * exp(-r * 2.4) * 0.6;
  float ang = atan(d.y, d.x);
  float rays = noise(vec2(ang * 9.0, uTime * 0.06)) * noise(vec2(ang * 17.0 + 4.0, -uTime * 0.04));
  col += uSun * rays * exp(-r * 1.3) * 0.3 * smoothstep(0.25, 0.7, y);
  // clouds: a far, slow layer and a near one; scroll and pointer pull them apart (parallax)
  vec2 p = vec2(uv.x * aspect, y);
  vec2 par = (uMouse - 0.5) * 0.04;
  float cover = 0.44;
  vec2 q1 = p * vec2(3.6, 8.0) + vec2(uTime * 0.03, uScroll * 0.6) + par * 1.5;
  float w1 = fbm(q1 + 0.5 * fbm(q1 * 0.7 + uTime * 0.008));
  float c1 = smoothstep(cover + 0.06, cover + 0.22, w1) * smoothstep(0.3, 0.7, y) * 0.7;
  vec2 q2 = p * vec2(2.2, 4.6) + vec2(7.3 + uTime * 0.05, 1.7 + uScroll * 1.3) + par * 3.0;
  float w2 = fbm(q2 + 0.6 * fbm(q2 * 0.8 - uTime * 0.012));
  float c2 = smoothstep(cover + 0.04, cover + 0.2, w2) * smoothstep(0.22, 0.62, y);
  // bright sunlit tops, pale blue bellies
  vec3 lit = vec3(1.0);
  vec3 belly = vec3(0.8, 0.87, 0.96);
  vec3 cloud1 = mix(belly, lit, 0.55 + 0.45 * smoothstep(cover, cover + 0.5, w1));
  vec3 cloud2 = mix(belly, lit, smoothstep(cover + 0.04, cover + 0.34, w2));
  col = mix(col, cloud1, c1);
  col = mix(col, cloud2, c2 * 0.94);
  // a soft bright pool behind the headline and buttons keeps the copy readable over any cloud (scrim)
  float pool = exp(-pow(length((uv - vec2(0.5, 0.6)) * vec2(1.5, 2.3)), 2.0));
  col = mix(col, vec3(0.94, 0.965, 0.99), pool * 0.58);
  col += (hash(gl_FragCoord.xy + fract(uTime)) - 0.5) * (2.0 / 255.0);
  gl_FragColor = vec4(col, 1.0);
}`;
  const shader = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  };
  const vs = shader(gl.VERTEX_SHADER, VERT), fs = shader(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return;
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = {};
  for (const n of ["uRes", "uTime", "uScroll", "uMouse", "uTop", "uMid", "uGround", "uSun"]) U[n] = gl.getUniformLocation(prog, n);
  gl.uniform3fv(U.uGround, ground);
  gl.uniform3fv(U.uTop, oklchToRgb(SKY.top));
  gl.uniform3fv(U.uMid, oklchToRgb(SKY.mid));
  gl.uniform3fv(U.uSun, oklchToRgb(SKY.sun));

  // ---------- state ----------
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const freeze = parseFloat(new URLSearchParams(location.search).get("t"));
  let mouse = [0.5, 0.5], mouseGoal = [0.5, 0.5], scroll = 0;

  const resize = () => {
    // soft clouds do not need full resolution: half the device pixels, capped at DPR 2
    const k = Math.min(window.devicePixelRatio || 1, 2) * 0.5;
    const w = Math.max(1, Math.round(canvas.clientWidth * k)), h = Math.max(1, Math.round(canvas.clientHeight * k));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
    gl.uniform2f(U.uRes, w, h);
  };
  const draw = (t) => {
    mouse = mouse.map((v, i) => v + (mouseGoal[i] - v) * 0.04);
    gl.uniform1f(U.uTime, t);
    gl.uniform1f(U.uScroll, scroll);
    gl.uniform2f(U.uMouse, mouse[0], mouse[1]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  sky.appendChild(canvas);
  resize();
  const show = () => sky.classList.add("has-gl");

  if (Number.isFinite(freeze) || reduce) {
    const still = Number.isFinite(freeze) ? freeze : 30;
    draw(still);
    show();
    new ResizeObserver(() => { resize(); draw(still); }).observe(canvas);
    return;
  }

  let onScreen = true, lost = false, raf = 0, clock = 0, last = performance.now();
  const frame = (now) => {
    raf = 0;
    clock += Math.min(0.1, (now - last) / 1000); // paused time does not count
    last = now;
    draw(clock);
    loop();
  };
  const loop = () => {
    if (!raf && onScreen && !lost && !document.hidden) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  };
  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; loop(); }).observe(hero);
  document.addEventListener("visibilitychange", loop);
  addEventListener("scroll", () => { scroll = Math.min(1.5, scrollY / Math.max(1, hero.offsetHeight)); }, { passive: true });
  addEventListener("pointermove", (e) => { if (e.pointerType === "mouse") mouseGoal = [e.clientX / innerWidth, 1 - e.clientY / innerHeight]; }, { passive: true });
  canvas.addEventListener("webglcontextlost", () => { lost = true; sky.classList.remove("has-gl"); });
  draw(0);
  show();
  loop();
})();
