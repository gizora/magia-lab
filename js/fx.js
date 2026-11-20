// エフェクト: パーティクル・光のフラッシュ・衝撃波の輪・光る玉・テクスチャ生成
(function () {
  'use strict';
  const MG = (window.MG = window.MG || {});

  const FX = {};
  const MAX = 7000;
  let scene, points, geo, uniforms;
  const pos = new Float32Array(MAX * 3), vel = new Float32Array(MAX * 3), col = new Float32Array(MAX * 3);
  const size = new Float32Array(MAX), alpha = new Float32Array(MAX);
  const life = new Float32Array(MAX), maxLife = new Float32Array(MAX), size0 = new Float32Array(MAX), size1 = new Float32Array(MAX);
  const drag = new Float32Array(MAX), grav = new Float32Array(MAX), alpha0 = new Float32Array(MAX);
  let cursor = 0;
  const lights = [];
  const rings = [];
  const glowMats = {};
  FX.alive = 0;

  // ---- キャンバスで作るテクスチャ ----
  function canvasTex(w, h, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    return t;
  }
  FX.canvasTex = canvasTex;

  FX.makeTextures = function () {
    FX.glowTex = canvasTex(128, 128, (g, w) => {
      const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(255,255,255,0.8)');
      gr.addColorStop(0.5, 'rgba(255,255,255,0.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, w);
    });
    // 化学記号の入った魔法陣
    FX.circleTex = canvasTex(512, 512, (g, w) => {
      const c = w / 2;
      g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineCap = 'round';
      const ring = (r, lw) => { g.lineWidth = lw; g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.stroke(); };
      ring(246, 6); ring(232, 2); ring(178, 3); ring(120, 2); ring(60, 3);
      const sym = ['H', 'C', 'O', 'N', 'Fe', 'Na', 'Cu', 'Si', 'Au', 'Ag', 'S', 'P', 'Mg', 'Zn', 'Ne', 'He'];
      g.font = 'bold 30px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      sym.forEach((s, i) => {
        const a = (i / sym.length) * Math.PI * 2;
        g.save(); g.translate(c + Math.cos(a) * 205, c + Math.sin(a) * 205); g.rotate(a + Math.PI / 2); g.fillText(s, 0, 0); g.restore();
      });
      // 六芒星（ベンゼン環のような六角形も重ねる）
      g.lineWidth = 3;
      for (let k = 0; k < 2; k++) {
        g.beginPath();
        for (let i = 0; i <= 3; i++) { const a = (i / 3) * Math.PI * 2 + k * Math.PI / 3 - Math.PI / 2; const x = c + Math.cos(a) * 178, y = c + Math.sin(a) * 178; i ? g.lineTo(x, y) : g.moveTo(x, y); }
        g.stroke();
      }
      g.beginPath();
      for (let i = 0; i <= 6; i++) { const a = (i / 6) * Math.PI * 2; const x = c + Math.cos(a) * 100, y = c + Math.sin(a) * 100; i ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke();
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; g.beginPath(); g.arc(c + Math.cos(a) * 178, c + Math.sin(a) * 178, 9, 0, Math.PI * 2); g.fill(); }
      for (let i = 0; i < 48; i++) { const a = (i / 48) * Math.PI * 2; g.lineWidth = i % 4 ? 1.5 : 3; g.beginPath(); g.moveTo(c + Math.cos(a) * 232, c + Math.sin(a) * 232); g.lineTo(c + Math.cos(a) * (i % 4 ? 222 : 214), c + Math.sin(a) * (i % 4 ? 222 : 214)); g.stroke(); }
    });
    FX.ringTex = canvasTex(256, 256, (g, w) => {
      const gr = g.createRadialGradient(w / 2, w / 2, w * 0.3, w / 2, w / 2, w / 2);
      gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.75, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, w);
    });
  };

  FX.init = function (sc) {
    scene = sc;
    FX.makeTextures();
    geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('pcolor', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('psize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('palpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
    uniforms = { uScale: { value: 400 } };
    const mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: `
        attribute vec3 pcolor; attribute float psize; attribute float palpha;
        uniform float uScale; varying vec3 vColor; varying float vAlpha;
        void main() {
          vColor = pcolor; vAlpha = palpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = palpha > 0.001 ? psize * uScale / max(0.1, -mv.z) : 0.0;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vColor; varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d);
          float core = smoothstep(0.18, 0.0, d);
          gl_FragColor = vec4(vColor * a + vec3(core) * 0.6, a * a * vAlpha);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.renderOrder = 5;
    scene.add(points);
    for (let i = 0; i < 6; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 20, 2);
      l.position.set(0, -100, 0); scene.add(l);
      lights.push({ light: l, t: 0, max: 0, base: 0 });
    }
  };

  FX.resize = function (h, fov) { if (uniforms) uniforms.uScale.value = h / (2 * Math.tan((fov * Math.PI) / 360)); };

  const tmpC1 = new THREE.Color(), tmpC2 = new THREE.Color();
  const toColor = (c, out) => (c instanceof THREE.Color ? out.copy(c) : out.set(c));

  // パーティクルを出す
  // o: { count, c1, c2, speed, speedVar, dir(Vector3), spread(0..1), life, lifeVar, size, sizeEnd, gravity, drag, jitter, up, rainbow, alpha }
  FX.emit = function (p, o) {
    const n = o.count || 10;
    toColor(o.c1 || '#ffffff', tmpC1); toColor(o.c2 || o.c1 || '#ffffff', tmpC2);
    const sp = o.speed == null ? 4 : o.speed, spv = o.speedVar == null ? 0.5 : o.speedVar;
    const spread = o.spread == null ? 1 : o.spread;
    const lf = o.life || 0.8, lfv = o.lifeVar == null ? 0.4 : o.lifeVar;
    const sz = o.size || 0.5, sze = o.sizeEnd == null ? 0 : o.sizeEnd;
    const jit = o.jitter || 0;
    for (let k = 0; k < n; k++) {
      const i = cursor; cursor = (cursor + 1) % MAX;
      const i3 = i * 3;
      let dx, dy, dz;
      // 方向: dir があれば円錐、なければ球
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      dx = r * Math.cos(th); dy = u; dz = r * Math.sin(th);
      if (o.dir) {
        dx = o.dir.x + dx * spread; dy = o.dir.y + dy * spread; dz = o.dir.z + dz * spread;
        const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
      }
      const s = sp * (1 - spv + Math.random() * spv * 2);
      let jx = 0, jy = 0, jz = 0;
      if (jit) { jx = (Math.random() * 2 - 1) * jit; jy = (Math.random() * 2 - 1) * jit; jz = (Math.random() * 2 - 1) * jit; if (o.flat) jy = 0; }
      pos[i3] = p.x + jx; pos[i3 + 1] = p.y + jy; pos[i3 + 2] = p.z + jz;
      vel[i3] = dx * s; vel[i3 + 1] = dy * s + (o.up || 0); vel[i3 + 2] = dz * s;
      let cr, cg, cb;
      if (o.rainbow) { tmpC2.setHSL(Math.random(), 1, 0.6); cr = tmpC2.r; cg = tmpC2.g; cb = tmpC2.b; toColor(o.c2 || o.c1 || '#fff', tmpC2); }
      else { const m = Math.random(); cr = tmpC1.r + (tmpC2.r - tmpC1.r) * m; cg = tmpC1.g + (tmpC2.g - tmpC1.g) * m; cb = tmpC1.b + (tmpC2.b - tmpC1.b) * m; }
      col[i3] = cr; col[i3 + 1] = cg; col[i3 + 2] = cb;
      const L = lf * (1 - lfv + Math.random() * lfv * 2);
      life[i] = L; maxLife[i] = L;
      size0[i] = sz * (0.7 + Math.random() * 0.6); size1[i] = sze;
      size[i] = size0[i];
      alpha0[i] = o.alpha == null ? 1 : o.alpha; alpha[i] = alpha0[i];
      drag[i] = o.drag == null ? 1.5 : o.drag; grav[i] = o.gravity || 0;
    }
  };

  // 2点の間に沿ってパーティクルを出す
  FX.emitLine = function (a, b, o) {
    const n = o.count || 20; const d = new THREE.Vector3().subVectors(b, a);
    const q = new THREE.Vector3();
    const per = Object.assign({}, o, { count: 1 });
    for (let i = 0; i < n; i++) { q.copy(a).addScaledVector(d, Math.random()); FX.emit(q, per); }
  };

  FX.flash = function (p, color, intensity, dist, dur) {
    let best = lights[0];
    for (const l of lights) if (l.t <= 0) { best = l; break; } else if (l.t < best.t) best = l;
    best.light.position.copy(p); best.light.color.set(color); best.light.distance = dist || 20;
    best.base = intensity || 6; best.t = dur || 0.35; best.max = best.t;
    best.light.intensity = best.base;
  };

  // 地面に広がる衝撃波の輪
  FX.ring = function (p, color, r0, r1, dur, opts) {
    opts = opts || {};
    const m = new THREE.MeshBasicMaterial({ map: FX.ringTex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, opacity: 1 });
    const mesh = new THREE.Mesh(FX.planeGeo || (FX.planeGeo = new THREE.PlaneGeometry(2, 2)), m);
    mesh.position.copy(p);
    if (opts.vertical) mesh.lookAt(opts.lookAt || new THREE.Vector3(p.x, p.y, p.z + 1));
    else mesh.rotation.x = -Math.PI / 2;
    mesh.scale.setScalar(r0);
    mesh.renderOrder = 4;
    scene.add(mesh);
    rings.push({ mesh, r0, r1, t: 0, dur: dur || 0.5 });
    return mesh;
  };

  FX.glowMaterial = function (color) {
    const key = typeof color === 'string' ? color : '#' + new THREE.Color(color).getHexString();
    if (!glowMats[key]) glowMats[key] = new THREE.SpriteMaterial({ map: FX.glowTex, color: key, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    return glowMats[key];
  };
  FX.glowSprite = function (color, s) {
    const sp = new THREE.Sprite(FX.glowMaterial(color));
    sp.scale.setScalar(s); sp.renderOrder = 6;
    return sp;
  };

  FX.update = function (dt) {
    let alive = 0;
    for (let i = 0; i < MAX; i++) {
      if (life[i] <= 0) { if (alpha[i] !== 0) alpha[i] = 0; continue; }
      alive++;
      life[i] -= dt;
      const i3 = i * 3;
      const k = Math.max(0, 1 - drag[i] * dt);
      vel[i3] *= k; vel[i3 + 1] = vel[i3 + 1] * k - grav[i] * dt; vel[i3 + 2] *= k;
      pos[i3] += vel[i3] * dt; pos[i3 + 1] += vel[i3 + 1] * dt; pos[i3 + 2] += vel[i3 + 2] * dt;
      if (pos[i3 + 1] < 0.02 && grav[i] > 0) { pos[i3 + 1] = 0.02; vel[i3 + 1] *= -0.3; }
      const t = 1 - life[i] / maxLife[i];
      size[i] = size0[i] + (size1[i] - size0[i]) * t;
      alpha[i] = life[i] <= 0 ? 0 : alpha0[i] * (t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9);
    }
    FX.alive = alive;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.pcolor.needsUpdate = true;
    geo.attributes.psize.needsUpdate = true;
    geo.attributes.palpha.needsUpdate = true;
    for (const l of lights) {
      if (l.t > 0) { l.t -= dt; l.light.intensity = Math.max(0, l.base * (l.t / l.max)); if (l.t <= 0) l.light.intensity = 0; }
    }
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i]; r.t += dt;
      const t = Math.min(1, r.t / r.dur);
      const e = 1 - Math.pow(1 - t, 3);
      r.mesh.scale.setScalar(r.r0 + (r.r1 - r.r0) * e);
      r.mesh.material.opacity = 1 - t;
      if (t >= 1) { scene.remove(r.mesh); r.mesh.material.dispose(); rings.splice(i, 1); }
    }
  };

  MG.FX = FX;
})();
