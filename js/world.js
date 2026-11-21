// 世界: 空と昼夜、へこむ地面（クレーター）、壊せる地形（石壁・岩・木箱・石柱）。ステージは「練習場」と、対戦用の「闘技場」
(function () {
  'use strict';
  const MG = window.MG, FX = MG.FX;
  const V3 = THREE.Vector3;
  const W = (MG.World = {});
  const ARENA = 54;

  let scene, renderer, sky, skyMat, starsMat, moonGroup, sunGroup, mtMat, groundMat, outerMat, circleMat, hemi, dirLight, amb, decorP;
  const lamps = [], crystals = [], props = [], debris = [], pillars = [];
  const timers = [];
  let clock = 0;
  W.stats = { destroyed: 0, craters: 0, chips: 0, erased: 0, carved: 0 };

  const rand = (a, b) => a + Math.random() * (b - a);
  // 位置から決まる乱数（同じ場所の頂点は同じだけ動くようにするため）
  const prand = (x, y, z) => { const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453; return s - Math.floor(s); };

  // ======================================================================
  //  昼と夜
  // ======================================================================
  const C = (h) => new THREE.Color(h);
  const PRESET = {
    day: {
      top: C('#2f6fd6'), mid: C('#6fa8ec'), hor: C('#d9e6f2'), fog: C('#bfd3e6'), fogD: 0.0065,
      hemiSky: C('#dce9ff'), hemiGround: C('#6b5a40'), hemiI: 1.0, dirC: C('#fff1d8'), dirI: 1.7, ambC: C('#ffffff'), ambI: 0.22,
      stars: 0, moon: 0, sun: 1, mt: C('#7d9cc4'), ground: C('#e2ddd2'), exposure: 1.0, lamp: 0.25, circle: 0.2, fireflies: 0,
    },
    night: {
      top: C('#030512'), mid: C('#0d1238'), hor: C('#4d2460'), fog: C('#0a1030'), fogD: 0.0145,
      hemiSky: C('#8c9cff'), hemiGround: C('#1a1030'), hemiI: 0.75, dirC: C('#b8c6ff'), dirI: 0.75, ambC: C('#30305a'), ambI: 0.35,
      stars: 1, moon: 1, sun: 0, mt: C('#23235c'), ground: C('#8a95c8'), exposure: 1.15, lamp: 1, circle: 0.35, fireflies: 1,
    },
  };
  const MOON_POS = new V3(-110, 120, -220), SUN_POS = new V3(130, 125, -200);
  let timeK = 1, timeTarget = 1; // 0 = 昼, 1 = 夜
  W.mode = 'night';

  function applyTime(k) {
    const a = PRESET.day, b = PRESET.night;
    const L = (x, y) => x + (y - x) * k;
    const LC = (x, y, out) => out.copy(x).lerp(y, k);
    LC(a.top, b.top, skyMat.uniforms.uTop.value);
    LC(a.mid, b.mid, skyMat.uniforms.uMid.value);
    LC(a.hor, b.hor, skyMat.uniforms.uHor.value);
    skyMat.uniforms.uSun.value = 1 - k;
    LC(a.fog, b.fog, scene.fog.color);
    scene.fog.density = L(a.fogD, b.fogD);
    if (W.stage === 'dungeon') { scene.fog.color.setRGB(0.05, 0.04, 0.035); scene.fog.density = 0.042; }
    LC(a.hemiSky, b.hemiSky, hemi.color); LC(a.hemiGround, b.hemiGround, hemi.groundColor); hemi.intensity = L(a.hemiI, b.hemiI) * (W.stage === 'dungeon' ? 0.6 : 1);
    if (W.stage === 'dungeon') { hemi.color.setRGB(0.75, 0.62, 0.5); hemi.groundColor.setRGB(0.15, 0.1, 0.08); }
    if (sky) sky.visible = W.stage !== 'dungeon';
    LC(a.dirC, b.dirC, dirLight.color); dirLight.intensity = L(a.dirI, b.dirI);
    dirLight.position.copy(SUN_POS).lerp(MOON_POS, k).normalize().multiplyScalar(50);
    LC(a.ambC, b.ambC, amb.color); amb.intensity = L(a.ambI, b.ambI);
    starsMat.opacity = Math.max(0, k * 1.4 - 0.4);
    moonGroup.children.forEach((c) => (c.material.opacity = Math.max(0, k * 1.3 - 0.3)));
    sunGroup.children.forEach((c) => (c.material.opacity = Math.max(0, (1 - k) * 1.3 - 0.3)));
    LC(a.mt, b.mt, mtMat.color);
    LC(a.ground, b.ground, groundMat.color); outerMat.color.copy(groundMat.color);
    renderer.toneMappingExposure = L(a.exposure, b.exposure);
    const lampK = L(a.lamp, b.lamp);
    lamps.forEach((l) => { l.glow.material.opacity = lampK; });
    if (typeof townWinMats !== 'undefined') townWinMats.forEach((m) => { m.emissiveIntensity = 0.12 + 0.9 * lampK; });
    if (W.stage === 'dungeon') { dirLight.intensity *= 0.25; amb.intensity = 0.5; amb.color.setRGB(0.32, 0.26, 0.22); }
    circleMat.opacity = L(a.circle, b.circle);
  }

  W.setTime = function (mode, instant) {
    W.mode = mode === 'day' ? 'day' : 'night';
    timeTarget = W.mode === 'day' ? 0 : 1;
    if (instant) { timeK = timeTarget; applyTime(timeK); }
  };
  W.timeK = () => timeK;

  // ======================================================================
  //  空・遠景
  // ======================================================================
  function buildSky() {
    skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uTop: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uSun: { value: 0 }, uSunDir: { value: SUN_POS.clone().normalize() } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 uTop, uMid, uHor, uSunDir; uniform float uSun; varying vec3 vP;
        void main(){
          float h = vP.y;
          vec3 c = mix(uHor, uMid, smoothstep(0.0, 0.22, h));
          c = mix(c, uTop, smoothstep(0.22, 0.85, h));
          if (h < 0.0) c = mix(uHor * 0.7, uHor * 0.25, smoothstep(0.0, -0.15, h));
          float s = max(dot(vP, uSunDir), 0.0);
          c += uSun * (vec3(1.0, 0.9, 0.7) * pow(s, 24.0) * 0.6 + vec3(1.0, 0.95, 0.85) * pow(s, 300.0));
          gl_FragColor = vec4(c, 1.0); }`,
    });
    sky = new THREE.Mesh(new THREE.SphereGeometry(320, 32, 16), skyMat);
    sky.renderOrder = -10;
    scene.add(sky);

    const starN = 1600, sp = new Float32Array(starN * 3), sc = new Float32Array(starN * 3);
    for (let i = 0; i < starN; i++) {
      const u = Math.random() * 0.95 + 0.03, th = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      sp[i * 3] = Math.cos(th) * r * 300; sp[i * 3 + 1] = u * 300; sp[i * 3 + 2] = Math.sin(th) * r * 300;
      const c = new THREE.Color().setHSL(rand(0.55, 0.7), rand(0.2, 0.6), rand(0.65, 0.95));
      sc[i * 3] = c.r; sc[i * 3 + 1] = c.g; sc[i * 3 + 2] = c.b;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(sc, 3));
    starsMat = new THREE.PointsMaterial({ size: 1.7, sizeAttenuation: false, vertexColors: true, fog: false, transparent: true, depthWrite: false });
    const stars = new THREE.Points(sg, starsMat); stars.renderOrder = -9;
    sky.add(stars);

    const disc = (draw, scale, pos) => {
      const tex = FX.canvasTex(128, 128, draw);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, fog: false, depthWrite: false, transparent: true }));
      s.scale.setScalar(scale); s.position.copy(pos); return s;
    };
    const glow = (col, scale, pos) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: FX.glowTex, color: col, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false })); s.scale.setScalar(scale); s.position.copy(pos); return s; };
    moonGroup = new THREE.Group();
    moonGroup.add(glow('#d8e4ff', 60, MOON_POS));
    moonGroup.add(disc((g, w) => {
      const gr = g.createRadialGradient(w * 0.45, w * 0.42, 0, w / 2, w / 2, w / 2);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.85, '#e4e9ff'); gr.addColorStop(0.97, '#c8d0f0'); gr.addColorStop(1, 'rgba(200,208,240,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(w / 2, w / 2, w / 2, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(150,160,200,0.25)';
      [[0.35, 0.55, 0.1], [0.6, 0.35, 0.07], [0.62, 0.65, 0.12]].forEach(([x, y, r]) => { g.beginPath(); g.arc(x * w, y * w, r * w, 0, Math.PI * 2); g.fill(); });
    }, 18, MOON_POS));
    sky.add(moonGroup);
    sunGroup = new THREE.Group();
    sunGroup.add(glow('#fff2c8', 90, SUN_POS));
    sunGroup.add(disc((g, w) => { const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.8, '#fff8e0'); gr.addColorStop(1, 'rgba(255,240,200,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, w); }, 16, SUN_POS));
    sky.add(sunGroup);

    // 遠くの山（白で描いて、昼夜で色をつける）
    const mtTex = FX.canvasTex(1024, 128, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      for (let layer = 0; layer < 2; layer++) {
        g.fillStyle = layer ? '#9a9a9a' : '#ffffff';
        g.beginPath(); g.moveTo(0, h);
        let y = h * (layer ? 0.55 : 0.4);
        for (let x = 0; x <= w; x += 8) { y += rand(-7, 7); y = Math.max(h * (layer ? 0.35 : 0.15), Math.min(h * 0.85, y)); g.lineTo(x, y); }
        g.lineTo(w, h); g.closePath(); g.fill();
      }
    });
    mtTex.wrapS = THREE.RepeatWrapping; mtTex.repeat.x = 3;
    mtMat = new THREE.MeshBasicMaterial({ map: mtTex, transparent: true, side: THREE.BackSide, fog: false, depthWrite: false });
    const mt = new THREE.Mesh(new THREE.CylinderGeometry(230, 230, 50, 64, 1, true), mtMat);
    mt.position.y = 14; mt.renderOrder = -8;
    sky.add(mt);
  }

  // ======================================================================
  //  へこむ地面
  // ======================================================================
  // 地面は 10×10 のブロックに分ける。ふだんは平らな板（三角形 2 枚）で、
  // クレーターができたブロックだけを細かい網目に置きかえて、へこませる（描画を軽くするため）
  const G_SIZE = 130, CH = 10, CH_SEG = 18, G_SEG = CH * CH_SEG, G_HALF = G_SIZE / 2, G_STEP = G_SIZE / G_SEG, CH_SIZE = G_SIZE / CH, TILE = 6.5;
  let heights, colors, chunks = [];
  function chunkGeometry(cx, cz, detailed) {
    const seg = detailed ? CH_SEG : 1;
    const geo = new THREE.PlaneGeometry(CH_SIZE, CH_SIZE, seg, seg);
    geo.rotateX(-Math.PI / 2);
    geo.translate(-G_HALF + (cx + 0.5) * CH_SIZE, 0, -G_HALF + (cz + 0.5) * CH_SIZE);
    const n = (seg + 1) * (seg + 1);
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    return geo;
  }
  // 細かいブロックの頂点を、高さと焦げ跡の表に合わせる
  function syncChunk(c) {
    const pos = c.mesh.geometry.attributes.position, col = c.mesh.geometry.attributes.color, R = G_SEG + 1;
    for (let j = 0; j <= CH_SEG; j++) for (let i = 0; i <= CH_SEG; i++) {
      const v = j * (CH_SEG + 1) + i;
      const gi = (c.cz * CH_SEG + j) * R + (c.cx * CH_SEG + i);
      pos.setY(v, heights[gi]);
      col.setXYZ(v, colors[gi * 3], colors[gi * 3 + 1], colors[gi * 3 + 2]);
    }
    pos.needsUpdate = true; col.needsUpdate = true;
    c.mesh.geometry.computeVertexNormals();
    // ブロックの境目で光の当たり方がずれないよう、端の法線を上向きの平均に寄せる
  }
  function detailChunk(c) {
    if (c.detailed) return;
    c.mesh.geometry.dispose();
    c.mesh.geometry = chunkGeometry(c.cx, c.cz, true);
    c.detailed = true;
  }
  function buildGround() {
    const tex = FX.canvasTex(256, 256, (g, w) => {
      g.fillStyle = '#5e5f66'; g.fillRect(0, 0, w, w);
      for (let i = 0; i < 2600; i++) { const v = rand(60, 140) | 0; g.fillStyle = `rgba(${v},${v},${v + 6},${rand(0.1, 0.35)})`; g.fillRect(rand(0, w), rand(0, w), rand(1, 4), rand(1, 4)); }
      g.strokeStyle = 'rgba(20,20,28,0.85)'; g.lineWidth = 3;
      for (let r = 0; r < 4; r++) {
        g.beginPath(); g.moveTo(0, r * 64); g.lineTo(w, r * 64); g.stroke();
        for (let c = 0; c < 4; c++) { const x = c * 64 + (r % 2) * 32; g.beginPath(); g.moveTo(x, r * 64); g.lineTo(x, r * 64 + 64); g.stroke(); }
      }
    });
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    const inner = tex.clone(); inner.needsUpdate = true; inner.repeat.set(CH_SIZE / TILE, CH_SIZE / TILE);
    const outer = tex.clone(); outer.needsUpdate = true; outer.repeat.set(1 / TILE, 1 / TILE);

    const n = (G_SEG + 1) * (G_SEG + 1);
    heights = new Float32Array(n);
    colors = new Float32Array(n * 3).fill(1);
    groundMat = new THREE.MeshStandardMaterial({ map: inner, vertexColors: true, roughness: 0.95, metalness: 0.05 });
    for (let cz = 0; cz < CH; cz++) for (let cx = 0; cx < CH; cx++) {
      const mesh = new THREE.Mesh(chunkGeometry(cx, cz, false), groundMat);
      scene.add(mesh);
      chunks.push({ cx, cz, mesh, detailed: false });
    }

    const sh = new THREE.Shape();
    sh.moveTo(-250, -250); sh.lineTo(250, -250); sh.lineTo(250, 250); sh.lineTo(-250, 250); sh.lineTo(-250, -250);
    const hole = new THREE.Path();
    hole.moveTo(-G_HALF, -G_HALF); hole.lineTo(-G_HALF, G_HALF); hole.lineTo(G_HALF, G_HALF); hole.lineTo(G_HALF, -G_HALF); hole.lineTo(-G_HALF, -G_HALF);
    sh.holes.push(hole);
    const og = new THREE.ShapeGeometry(sh); og.rotateX(-Math.PI / 2);
    outerMat = new THREE.MeshStandardMaterial({ map: outer, roughness: 0.95, metalness: 0.05 });
    scene.add(new THREE.Mesh(og, outerMat));

    circleMat = new THREE.MeshBasicMaterial({ map: FX.circleTex, color: 0x3fb8ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
    const circle = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), circleMat);
    circle.rotation.x = -Math.PI / 2; circle.position.set(0, 0.04, 17);
    decorP.add(circle);
    groundTex.practice = { inner, outer };
    W.circle = circle;
  }

  W.heightAt = function (x, z) {
    const fx = (x + G_HALF) / G_STEP, fz = (z + G_HALF) / G_STEP;
    if (fx < 0 || fz < 0 || fx >= G_SEG || fz >= G_SEG) return 0;
    const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz, R = G_SEG + 1;
    const h00 = heights[iz * R + ix], h10 = heights[iz * R + ix + 1], h01 = heights[(iz + 1) * R + ix], h11 = heights[(iz + 1) * R + ix + 1];
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  };

  // クレーターをつくる
  W.crater = function (p, r) {
    r = Math.max(1, Math.min(9, r));
    const depth = Math.min(2.6, 0.3 + r * 0.24);
    const R = G_SEG + 1;
    const ext = r * 1.6;
    const x0 = Math.max(0, Math.floor((p.x - ext + G_HALF) / G_STEP)), x1 = Math.min(G_SEG, Math.ceil((p.x + ext + G_HALF) / G_STEP));
    const z0 = Math.max(0, Math.floor((p.z - ext + G_HALF) / G_STEP)), z1 = Math.min(G_SEG, Math.ceil((p.z + ext + G_HALF) / G_STEP));
    if (x0 > x1 || z0 > z1) return false;
    for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) {
      const i = iz * R + ix;
      const x = -G_HALF + ix * G_STEP, z = -G_HALF + iz * G_STEP;
      const d = Math.hypot(x - p.x, z - p.z) / r;
      if (d > 1.6) continue;
      let h = heights[i];
      // 地面の端に近いほど浅くする（外側の平らな地面との段差を作らない）
      const edge = Math.max(0, Math.min(1, (G_HALF - Math.max(Math.abs(x), Math.abs(z))) / 8));
      const jag = (0.85 + prand(x, 0, z) * 0.3) * edge;
      if (d < 1) h -= depth * (1 - d * d) * 0.75 * jag;
      else if (d < 1.35) h += depth * 0.16 * Math.sin(((d - 1) / 0.35) * Math.PI) * jag;
      heights[i] = Math.max(-4.5, Math.min(1.2, h));
      // 焦げ跡
      const sc = d < 1 ? 0.12 + 0.5 * d * d : 0.62 + 0.38 * ((d - 1) / 0.6);
      colors[i * 3] = Math.min(colors[i * 3], sc * 1.02);
      colors[i * 3 + 1] = Math.min(colors[i * 3 + 1], sc * 0.94);
      colors[i * 3 + 2] = Math.min(colors[i * 3 + 2], sc * 0.9);
    }
    // 変わった範囲にかかるブロックだけ細かくして更新する
    const cx0 = Math.floor(x0 / CH_SEG), cx1 = Math.min(CH - 1, Math.floor(x1 / CH_SEG));
    const cz0 = Math.floor(z0 / CH_SEG), cz1 = Math.min(CH - 1, Math.floor(z1 / CH_SEG));
    for (let cz = Math.max(0, cz0 - (z0 % CH_SEG === 0 ? 1 : 0)); cz <= cz1; cz++) for (let cx = Math.max(0, cx0 - (x0 % CH_SEG === 0 ? 1 : 0)); cx <= cx1; cx++) {
      const c = chunks[cz * CH + cx];
      detailChunk(c); syncChunk(c);
    }
    W.stats.craters++;
    if (W.phys) PH.rebuildGroundSoon(W.heightAt, G_SIZE);
    // 砂ぼこりと石つぶて
    FX.emit(new V3(p.x, W.heightAt(p.x, p.z) + 0.3, p.z), { count: Math.min(80, 15 + r * 10), c1: '#8a7a68', c2: '#c9b9a0', speed: r * 1.5, up: r * 0.8, gravity: 4, drag: 1.5, life: 1.6, size: 0.9 + r * 0.15, alpha: 0.35, flat: true, jitter: r * 0.5 });
    const n = Math.min(10, 2 + Math.round(r));
    for (let k = 0; k < n; k++) {
      const a = rand(0, Math.PI * 2);
      const m = new THREE.Mesh(chunkGeo, rockMat);
      m.scale.setScalar(rand(0.15, 0.35) * Math.min(2, r * 0.4));
      m.position.set(p.x + Math.cos(a) * r * 0.4, W.heightAt(p.x, p.z) + 0.4, p.z + Math.sin(a) * r * 0.4);
      addDebris(m, new V3(Math.cos(a) * rand(3, 8), rand(5, 11), Math.sin(a) * rand(3, 8)), 5);
    }
    return true;
  };

  function resetGround() {
    heights.fill(0); colors.fill(1);
    chunks.forEach((c) => { if (c.detailed) { c.mesh.geometry.dispose(); c.mesh.geometry = chunkGeometry(c.cx, c.cz, false); c.detailed = false; } });
  }
  W.detailedChunks = () => chunks.filter((c) => c.detailed).length;

  // ======================================================================
  //  壊れるかけら
  // ======================================================================
  const chunkGeo = new THREE.IcosahedronGeometry(1, 0);
  let rockMat, brickMat, woodMat, pillarMat;
  const PH = MG.Phys;
  W.phys = false;
  // three.js の形から、物理の形を選んで動く物体を作る
  function debrisBody(mesh, vel, ang) {
    const g = mesh.geometry, s = mesh.scale, prm = g.parameters || {};
    const o = { mesh, vel, ang, fast: true, friction: 0.75, restitution: 0.2 };
    if (g.type === 'BoxGeometry') return PH.box(mesh.position, mesh.quaternion, prm.width * s.x / 2, prm.height * s.y / 2, prm.depth * s.z / 2, o);
    if (g.type === 'CylinderGeometry') return PH.cylinder(mesh.position, mesh.quaternion, prm.height * s.y / 2, (prm.radiusTop + prm.radiusBottom) / 2 * s.x, o);
    return PH.sphere(mesh.position, Math.max(0.08, (prm.radius || 1) * s.x * 0.85), o);
  }
  function addDebris(mesh, vel, life, opts) {
    opts = opts || {};
    if (!mesh.parent) scene.add(mesh);
    const bb = opts.half || mesh.scale.y * 0.5;
    const ang = new V3(rand(-6, 6), rand(-6, 6), rand(-6, 6)).multiplyScalar(opts.spin == null ? 1 : opts.spin);
    const d = { mesh, vel, ang, life, max: life, half: bb, rest: false, keep: !!opts.keep, s0: mesh.scale.clone(), body: null };
    if (W.phys) { mesh.updateMatrixWorld(); d.body = debrisBody(mesh, vel, ang); }
    debris.push(d);
    const cap = W.phys ? 170 : 260;
    while (debris.length > cap) { const i = debris.findIndex((x) => !x.keep); if (i < 0) break; removeDebris(i); }
  }
  function removeDebris(i) { const d = debris[i]; scene.remove(d.mesh); if (d.body) PH.remove(d.body); debris.splice(i, 1); }
  function updateDebris(dt) {
    for (let i = debris.length - 1; i >= 0; i--) {
      const d = debris[i];
      d.life -= dt;
      if (d.body) {
        if (d.life < 0.6) d.mesh.scale.copy(d.s0).multiplyScalar(Math.max(0.01, d.life / 0.6));
        if (d.life <= 0) removeDebris(i);
        continue;
      }
      if (!d.rest) {
        d.vel.y -= 20 * dt;
        d.mesh.position.addScaledVector(d.vel, dt);
        d.mesh.rotation.x += d.ang.x * dt; d.mesh.rotation.y += d.ang.y * dt; d.mesh.rotation.z += d.ang.z * dt;
        const g = W.heightAt(d.mesh.position.x, d.mesh.position.z) + d.half;
        if (d.mesh.position.y < g) {
          d.mesh.position.y = g;
          d.vel.y *= -0.28; d.vel.x *= 0.55; d.vel.z *= 0.55; d.ang.multiplyScalar(0.5);
          if (Math.abs(d.vel.y) < 1.2 && Math.hypot(d.vel.x, d.vel.z) < 0.8) d.rest = true;
        }
      }
      if (d.life < 0.6) d.mesh.scale.copy(d.s0).multiplyScalar(Math.max(0.01, d.life / 0.6));
      if (d.life <= 0) { scene.remove(d.mesh); debris.splice(i, 1); }
    }
  }

  // ======================================================================
  //  壊せる地形
  // ======================================================================
  function makeMaterials() {
    rockMat = new THREE.MeshStandardMaterial({ color: 0x8a8578, roughness: 0.95, flatShading: true });
    brickMat = new THREE.MeshStandardMaterial({ color: 0xa08f7c, roughness: 0.9, flatShading: true });
    const woodTex = FX.canvasTex(128, 128, (g, w) => {
      g.fillStyle = '#9a6a3a'; g.fillRect(0, 0, w, w);
      for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? '#8a5c30' : '#a87444'; g.fillRect(0, i * 32 + 2, w, 28); }
      g.strokeStyle = '#4a2e14'; g.lineWidth = 8; g.strokeRect(4, 4, w - 8, w - 8);
      g.beginPath(); g.moveTo(8, 8); g.lineTo(w - 8, w - 8); g.stroke();
      for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(60,30,10,${rand(0.05, 0.2)})`; g.fillRect(rand(0, w), rand(0, w), rand(4, 18), 1); }
    });
    woodMat = new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.8 });
    pillarMat = new THREE.MeshStandardMaterial({ color: 0x5d6380, roughness: 0.9, flatShading: true });
  }

  // 地形1つ分の物体を作る（レンガ・木箱は眠った状態の動く物体、岩・薄い壁は動かない物体）
  function makeBody(o) {
    const m = o.mesh; m.updateMatrixWorld();
    if (o.kind === 'brick') o.body = PH.box(m.position, m.quaternion, 0.73, 0.36, 0.4, { mesh: m, sleep: true, friction: 0.8, restitution: 0.05, tag: 'brick' });
    else if (o.kind === 'crate') o.body = PH.box(m.position, m.quaternion, o.size / 2, o.size / 2, o.size / 2, { mesh: m, sleep: true, friction: 0.6, tag: 'crate' });
    else if (o.kind === 'rock') o.body = PH.convex(m.position, m.quaternion, m.geometry, m.scale, { static: true });
    else if (o.kind === 'slab') o.body = PH.box(m.position, m.quaternion, LANE.w / 2, LANE.h / 2, LANE.t / 2 + 0.08, { static: true });
  }
  function pillarBodies(p) {
    (p.bodies || []).forEach((b) => PH.remove(b));
    p.bodies = W.phys ? p.parts.map((pt) => PH.cylinder(pt.m.position, pt.m.quaternion, pt.half, pt.half > 0.5 ? 1.12 : 1.3, { static: true })) : [];
  }
  W.enablePhysics = function () {
    if (!PH.ready || W.phys) return false;
    W.phys = true;
    PH.setGround(W.heightAt, G_SIZE);
    props.forEach((o) => { if (o.alive) makeBody(o); });
    pillars.forEach((p) => { if (p.alive) pillarBodies(p); });
    return true;
  };
  const isDynamicProp = (o) => o.kind === 'brick' || o.kind === 'crate';
  // 爆風で、動く地形（レンガ・木箱）を押し飛ばす
  function blastPush(o, p, radius, dmg) {
    if (!W.phys || !o.body || !o.body.alive || !isDynamicProp(o)) return;
    const c = o.mesh.position, d = c.distanceTo(p);
    if (d > radius * 1.25) return;
    const k = Math.min(14, (dmg / 25) * (1 - d / (radius * 1.25)) * 6 + 2);
    const dir = c.clone().sub(p); if (dir.lengthSq() < 1e-4) dir.set(0, 1, 0); dir.normalize();
    PH.kick(o.body, { x: dir.x * k, y: Math.abs(dir.y) * k * 0.6 + k * 0.35, z: dir.z * k }, { x: rand(-4, 4), y: rand(-4, 4), z: rand(-4, 4) });
  }

  function addProp(o) {
    o.alive = true; o.maxHp = o.hp; o.respawn = 0;
    o.home = { pos: o.mesh.position.clone(), rot: o.mesh.rotation.clone(), scale: o.mesh.scale.clone() };
    scene.add(o.mesh);
    props.push(o);
    return o;
  }

  let wallCount = 0;
  const walls = [];
  function buildWall(x0, z0, len, rows, rotY) {
    const wall = { id: wallCount++, bricks: [], respawnAt: 0 };
    walls.push(wall);
    const bw = 1.5, bh = 0.75, bd = 0.8;
    const geo = new THREE.BoxGeometry(bw - 0.04, bh - 0.03, bd);
    const dir = new V3(Math.cos(rotY), 0, -Math.sin(rotY));
    const n = Math.floor(len / bw);
    const grid = [];
    for (let r = 0; r < rows; r++) {
      grid[r] = [];
      const off = r % 2 ? bw / 2 : 0;
      const cnt = r % 2 ? n - 1 : n;
      for (let c = 0; c < cnt; c++) {
        const along = off + c * bw + bw / 2;
        const m = new THREE.Mesh(geo, brickMat);
        m.position.set(x0 + dir.x * along, bh / 2 + r * bh, z0 + dir.z * along);
        m.rotation.y = rotY;
        const shade = 0.85 + prand(along, r, x0) * 0.3;
        m.material = brickMat;
        m.scale.set(1, 1, 1);
        const p = addProp({ mesh: m, kind: 'brick', hp: 30, r: 0.62, col: 0.75, along, row: r, shade, wall });
        wall.bricks.push(p);
        grid[r].push(p);
      }
    }
    // 上の段は、下の段のレンガに支えられている
    for (let r = 1; r < rows; r++) grid[r].forEach((p) => { p.support = grid[r - 1].filter((q) => Math.abs(q.along - p.along) < bw * 0.99); });
  }

  function buildRock(x, z, r) {
    const geo = new THREE.IcosahedronGeometry(r, 1);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
      const k = 0.8 + prand(vx.toFixed(3) * 1, vy.toFixed(3) * 1, vz.toFixed(3) * 1) * 0.35;
      pos.setXYZ(i, vx * k, vy * k * 0.8, vz * k);
    }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, rockMat);
    m.position.set(x, r * 0.55, z);
    m.rotation.y = rand(0, Math.PI * 2);
    addProp({ mesh: m, kind: 'rock', hp: 55 * r, r: r * 0.9, col: r * 0.85, size: r });
  }

  function buildCrate(x, z, y, s) {
    s = s || 1.1;
    const m = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), woodMat);
    m.position.set(x, (y || 0) + s / 2, z);
    m.rotation.y = rand(-0.4, 0.4);
    const p = addProp({ mesh: m, kind: 'crate', hp: 22, r: s * 0.7, col: s * 0.6, size: s });
    return p;
  }

  function buildProps() {
    buildWall(-21, -12, 16.5, 3, 0);
    buildWall(4.5, -12, 16.5, 3, 0);
    buildWall(-27, 10, 13.5, 2, Math.PI / 2);
    buildWall(27, 10, 13.5, 2, Math.PI / 2);
    [[-22, -22, 2.2], [24, -24, 2.6], [-33, 4, 1.8], [34, 2, 2.0], [-14, 26, 1.6], [16, 28, 2.2], [0, -30, 3], [-40, -14, 2.4], [30, -34, 1.8], [-6, -24, 1.3], [7, -25, 1.5]].forEach(([x, z, r]) => buildRock(x, z, r));
    const c1 = buildCrate(-19, 7); buildCrate(-17.7, 7.3); const top = buildCrate(-18.4, 7.1, 1.1); top.support = [c1];
    const c2 = buildCrate(19, 8); buildCrate(20.3, 7.4); const top2 = buildCrate(19.6, 7.7, 1.1); top2.support = [c2];
    buildCrate(-9, -17); buildCrate(-7.7, -16.6);
    buildCrate(9, -17.5); buildCrate(10.3, -17.2, 0, 0.9);
    buildPierceLane();
  }

  // ---- 貫通テスト場: 番号つきの薄い岩壁を縦に並べる ----
  const LANE = { x: 42, start: 15, slabs: [7, 3, -1, -5, -9, -13], target: -19, w: 5, h: 3.6, t: 0.5 };
  W.LANE = LANE;
  function labelSprite(text, w, h, opts) {
    opts = opts || {};
    const tex = FX.canvasTex(256, Math.round(256 * h / w), (g, cw, ch) => {
      g.fillStyle = opts.bg || 'rgba(10,14,40,0.85)';
      const r = 24; g.beginPath(); g.moveTo(r, 0); g.arcTo(cw, 0, cw, ch, r); g.arcTo(cw, ch, 0, ch, r); g.arcTo(0, ch, 0, 0, r); g.arcTo(0, 0, cw, 0, r); g.fill();
      g.strokeStyle = opts.border || '#ffd36b'; g.lineWidth = 8; g.stroke();
      g.fillStyle = opts.color || '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      const lines = String(text).split('\n');
      const fs = opts.size || Math.round(ch * 0.55 / lines.length);
      g.font = `bold ${fs}px "Yu Gothic UI", "Hiragino Sans", sans-serif`;
      lines.forEach((ln, i) => g.fillText(ln, cw / 2, ch / 2 + (i - (lines.length - 1) / 2) * fs * 1.15));
    });
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sp.scale.set(w, h, 1);
    return sp;
  }
  function slabGeometry() {
    const geo = new THREE.BoxGeometry(LANE.w, LANE.h, LANE.t, 6, 4, 1);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const j = prand(x.toFixed(2) * 1, y.toFixed(2) * 1, 3.1);
      const edgeX = Math.abs(Math.abs(x) - LANE.w / 2) < 0.01, top = Math.abs(y - LANE.h / 2) < 0.01;
      pos.setXYZ(i, x + (edgeX ? (j - 0.5) * 0.3 : 0), y + (top ? (j - 0.5) * 0.35 : 0), z * (0.8 + j * 0.45));
    }
    geo.computeVertexNormals();
    return geo;
  }
  function buildPierceLane() {
    const mat = new THREE.MeshStandardMaterial({ color: 0x8d8579, roughness: 0.95, flatShading: true });
    LANE.slabs.forEach((z, i) => {
      const m = new THREE.Mesh(slabGeometry(), mat);
      m.position.set(LANE.x, LANE.h / 2, z);
      const o = addProp({ mesh: m, kind: 'slab', hp: 70, r: 2.6, col: 0, size: 1.3, index: i + 1, respawnTime: 12 });
      o.label = labelSprite(String(i + 1), 0.9, 0.9, { size: 150 });
      o.label.position.set(LANE.x, LANE.h + 0.75, z);
      scene.add(o.label);
    });
    // 結果の掲示板（射撃位置の横）
    const bc = document.createElement('canvas'); bc.width = 512; bc.height = 256;
    const btex = new THREE.CanvasTexture(bc); btex.encoding = THREE.sRGBEncoding;
    const board = new THREE.Sprite(new THREE.SpriteMaterial({ map: btex, transparent: true, depthWrite: false }));
    board.scale.set(4.4, 2.2, 1); board.position.set(LANE.x - LANE.w / 2 - 2.6, 2.6, LANE.start - 3);
    decorP.add(board);
    W.pierceBoard = { canvas: bc, tex: btex, sprite: board, last: null };
    W.setPierceBoard(null);
    // 通路の線
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.35, depthWrite: false });
    [-LANE.w / 2 - 0.3, LANE.w / 2 + 0.3].forEach((dx) => {
      const ln = new THREE.Mesh(new THREE.PlaneGeometry(0.12, LANE.start - LANE.target + 3), lineMat);
      ln.rotation.x = -Math.PI / 2; ln.position.set(LANE.x + dx, 0.05, (LANE.start + LANE.target) / 2); decorP.add(ln);
    });
  }

  // 掲示板に、前回つらぬいた枚数を書く（n = null で案内だけ）
  W.setPierceBoard = function (n, name) {
    const b = W.pierceBoard; if (!b) return;
    b.last = n;
    const g = b.canvas.getContext('2d'), w = b.canvas.width, h = b.canvas.height;
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(10,14,40,0.9)'; g.beginPath(); g.roundRect ? g.roundRect(4, 4, w - 8, h - 8, 28) : g.rect(4, 4, w - 8, h - 8); g.fill();
    g.strokeStyle = '#ffd36b'; g.lineWidth = 8; g.stroke();
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#c8cbe8';
    g.font = 'bold 34px "Yu Gothic UI", "Hiragino Sans", sans-serif';
    g.fillText(n == null ? '貫通テストの結果' : '前回の結果', w / 2, 48);
    if (n == null) {
      g.fillStyle = '#ffffff'; g.font = 'bold 40px "Yu Gothic UI", sans-serif';
      g.fillText('奥へ撃つと、ここに', w / 2, 118); g.fillText('つらぬいた枚数が出ます', w / 2, 172);
    } else {
      const all = n >= LANE.slabs.length;
      g.fillStyle = all ? '#5dff9a' : n > 0 ? '#ffd36b' : '#ff9a6a';
      g.font = 'bold 96px "Yu Gothic UI", sans-serif';
      g.fillText(all ? '全6枚 貫通！' : n + ' 枚 貫通', w / 2, 132);
      if (name) { g.fillStyle = '#c8cbe8'; g.font = '30px "Yu Mincho", serif'; g.fillText(String(name).slice(0, 16), w / 2, 206); }
    }
    b.tex.needsUpdate = true;
  };
  W.isLaneSlab = (o) => !!o && o.kind === 'slab';

  // 薄い壁（slab）は箱、それ以外は球として当たりを調べる
  function slabBox(o, pad) {
    const c = o.mesh.position;
    return { minX: c.x - LANE.w / 2 - pad, maxX: c.x + LANE.w / 2 + pad, minY: c.y - LANE.h / 2 - pad, maxY: c.y + LANE.h / 2 + pad, minZ: c.z - LANE.t / 2 - pad, maxZ: c.z + LANE.t / 2 + pad };
  }
  function inBox(p, b) { return p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY && p.z >= b.minZ && p.z <= b.maxZ; }
  function rayBox(o, d, b) {
    let t0 = 0, t1 = Infinity;
    for (const ax of ['x', 'y', 'z']) {
      const mn = b['min' + ax.toUpperCase()], mx = b['max' + ax.toUpperCase()];
      if (Math.abs(d[ax]) < 1e-9) { if (o[ax] < mn || o[ax] > mx) return null; continue; }
      let a = (mn - o[ax]) / d[ax], c = (mx - o[ax]) / d[ax];
      if (a > c) { const s = a; a = c; c = s; }
      t0 = Math.max(t0, a); t1 = Math.min(t1, c);
      if (t0 > t1) return null;
    }
    return t0;
  }
  function raySphere(o, d, c, r) {
    const oc = c.clone().sub(o); const tca = oc.dot(d); if (tca < 0) return null;
    const d2 = oc.lengthSq() - tca * tca; if (d2 > r * r) return null;
    const t = tca - Math.sqrt(r * r - d2); return t > 0 ? t : null;
  }
  function distToProp(o, p) {
    if (o.kind !== 'slab') return o.mesh.position.distanceTo(p) - o.r;
    const b = slabBox(o, 0);
    const q = new V3(Math.max(b.minX, Math.min(p.x, b.maxX)), Math.max(b.minY, Math.min(p.y, b.maxY)), Math.max(b.minZ, Math.min(p.z, b.maxZ)));
    return q.distanceTo(p);
  }
  // 線分 a→b にかかる地形を、近い順に返す（光線の貫通に使う）
  W.propsOnSegment = function (a, b, owner) {
    const d = b.clone().sub(a); const len = d.length(); d.normalize();
    const out = [];
    if (owner !== undefined) { const bh = W.barrierOnSegment(a, b, 0, owner); if (bh) out.push({ prop: bh.barrier, t: bh.t, barrier: true }); }
    for (const o of props) {
      if (!o.alive) continue;
      const t = o.kind === 'slab' ? rayBox(a, d, slabBox(o, 0)) : raySphere(a, d, o.mesh.position, o.r);
      if (t != null && t <= len) out.push({ prop: o, t });
    }
    for (const p of pillars) {
      if (!p.alive) continue;
      let best = null;
      for (const y of [1.2, 3.5, 5.8]) { const t = raySphere(a, d, new V3(p.x, y, p.z), 1.3); if (t != null && (best == null || t < best)) best = t; }
      if (best != null && best <= len) out.push({ prop: p, t: best, pillar: true });
    }
    for (const so of solids) { const t = solidRay(a, d, so); if (t != null && t <= len) out.push({ prop: so, t, solid: true }); }
    return out.sort((x, y) => x.t - y.t);
  };
  // 壁をつらぬいたときの見た目（ダメージなし）
  W.scratch = function (o, from) {
    if (!o || !o.mesh || o.solid) return;
    o.shake = 0.12;
    FX.emit(from, { count: 22, c1: '#77706a', c2: '#d8d0c0', speed: 6, up: 2, gravity: 14, drag: 0.6, life: 0.9, size: 0.22 });
    FX.emit(from, { count: 10, c1: '#8a7a68', c2: '#c9b9a0', speed: 1.5, life: 1.2, size: 1.1, alpha: 0.35, drag: 1.5 });
  };
  W.damageProp = function (o, dmg, from) {
    if (!o || !o.alive || o.parts || o.solid) return;
    o.hp -= dmg;
    if (o.hp <= 0) destroyProp(o, from); else chip(o, from);
  };

  // 外周の石柱
  let drumGeo, capGeo, lampGeo;
  function buildPillars() {
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      buildPillarAt(Math.cos(a) * (ARENA + 6), Math.sin(a) * (ARENA + 6), i, i % 2 ? '#7fd8ff' : '#c08bff');
    }
  }
  function buildPillarAt(x, z, i, colr) {
    if (!drumGeo) { drumGeo = new THREE.CylinderGeometry(1.05, 1.15, 2.3, 8); capGeo = new THREE.CylinderGeometry(1.5, 1.1, 0.7, 8); lampGeo = new THREE.IcosahedronGeometry(0.45, 0); }
    {
      const p = { x, z, hp: 160, maxHp: 160, alive: true, parts: [], lamp: null, glow: null, respawn: 0, rise: 1, ph: i };
      const mk = () => {
        p.parts = [];
        for (let k = 0; k < 3; k++) { const d = new THREE.Mesh(drumGeo, pillarMat); d.position.set(x, 1.15 + k * 2.3, z); d.rotation.y = k * 0.3; scene.add(d); p.parts.push({ m: d, half: 1.15 }); }
        const cap = new THREE.Mesh(capGeo, pillarMat); cap.position.set(x, 7.25, z); scene.add(cap); p.parts.push({ m: cap, half: 0.35 });
        p.lamp = new THREE.Mesh(lampGeo, new THREE.MeshBasicMaterial({ color: colr })); p.lamp.position.set(x, 8.4, z); scene.add(p.lamp);
        if (!p.glow) { p.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: FX.glowTex, color: colr, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); p.glow.scale.setScalar(4.5); scene.add(p.glow); lamps.push(p); }
        p.glow.visible = true; p.glow.position.copy(p.lamp.position);
      };
      p.build = mk;
      mk();
      pillars.push(p);
    }
  }

  // ======================================================================
  //  ステージ（練習場 / 闘技場）
  // ======================================================================
  const ARENA_R = 40;          // 闘技場の壁の内側の半径
  W.ARENA_R = ARENA_R;
  W.stage = 'practice';
  W.bound = () => (W.stage === 'arena' ? ARENA_R - 1.2 : W.stage === 'dungeon' ? 200 : ARENA); // 動ける範囲（半径。ダンジョンは壁で囲まれている）
  const stash = {};            // しまってあるステージの、壊せる地形・柱・壁
  const decor = {};            // ステージごとの飾り
  const groundTex = {};        // ステージごとの地面の模様
  const fires = [];            // 闘技場のかがり火

  function stashStage(name) {
    const s = { props: props.splice(0), pillars: pillars.splice(0), walls: walls.splice(0) };
    s.props.forEach((o) => { scene.remove(o.mesh); if (o.label) o.label.visible = false; if (o.body) { PH.remove(o.body); o.body = null; } });
    s.pillars.forEach((p) => {
      (p.bodies || []).forEach((b) => PH.remove(b)); p.bodies = [];
      p.parts.forEach((pt) => scene.remove(pt.m)); p.parts = [];
      if (p.lamp) scene.remove(p.lamp);
      if (p.glow) p.glow.visible = false;
      p.vanish = null;
    });
    stash[name] = s;
  }
  function unstashStage(name) {
    const s = stash[name]; delete stash[name];
    props.push(...s.props); pillars.push(...s.pillars); walls.push(...s.walls);
    props.forEach((o) => { o.body = null; restoreProp(o); });
    pillars.forEach((p) => { restorePillar(p); p.rise = 1; });
    walls.forEach((w) => (w.respawnAt = 0));
  }
  function applyGround(name) {
    const t = groundTex[name]; if (!t) return;
    groundMat.map = t.inner; outerMat.map = t.outer;
    groundMat.needsUpdate = true; outerMat.needsUpdate = true;
  }
  // ======================================================================
  //  固い壁（第26版）: 街の建物とダンジョンの壁。壊れず、プレイヤー・弾・光線・ねらいを止める。
  //  向きのそろった箱 { x, z, hx, hz, y0, y1, solid: true }。ステージごとに一覧を持つ
  // ======================================================================
  const stageSolids = { town: [], dungeon: [] };
  let solids = [];
  W.solidList = () => solids;
  function addSolid(list, x, z, hx, hz, y1, y0) {
    const s = { x, z, hx, hz, y0: y0 || 0, y1, solid: true, alive: true, kind: 'solid' };
    list.push(s);
    return s;
  }
  const solidBox = (s, pad) => ({ minX: s.x - s.hx - pad, maxX: s.x + s.hx + pad, minY: s.y0 - pad, maxY: s.y1 + pad, minZ: s.z - s.hz - pad, maxZ: s.z + s.hz + pad });
  function solidRay(o, d, s) {
    // 箱と半直線の交わり（入る点までの距離）
    const b = solidBox(s, 0); let t0 = -Infinity, t1 = Infinity;
    for (const [oo, dd, mn, mx] of [[o.x, d.x, b.minX, b.maxX], [o.y, d.y, b.minY, b.maxY], [o.z, d.z, b.minZ, b.maxZ]]) {
      if (Math.abs(dd) < 1e-9) { if (oo < mn || oo > mx) return null; continue; }
      let a = (mn - oo) / dd, c = (mx - oo) / dd; if (a > c) [a, c] = [c, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, c); if (t0 > t1) return null;
    }
    if (t1 < 0) return null;
    return Math.max(0, t0);
  }
  // 2 点の間に固い壁があるか（敵の見通しなど）。あればその距離
  W.solidOnSegment = function (a, b) {
    const d = b.clone().sub(a), len = d.length(); if (len < 1e-6) return null; d.multiplyScalar(1 / len);
    let best = null;
    for (const s of solids) { const t = solidRay(a, d, s); if (t != null && t <= len && (best == null || t < best)) best = t; }
    return best;
  };

  // ======================================================================
  //  街（第26版）: 神殿・杖の店・ダンジョンの門・練習場の門と、噴水の広場
  // ======================================================================
  W.SPOTS = {
    town: [
      { id: 'temple', label: '神殿', x: 0, z: -25, r: 4.5, hint: '神殿に入る（レベルと能力を見る）' },
      { id: 'shop', label: '杖の店', x: 23.5, z: -4, r: 4.5, hint: '杖の店に入る' },
      { id: 'dungeon', label: 'ダンジョン', x: -24, z: -4, r: 4.5, hint: 'ダンジョンに挑む' },
      { id: 'practice', label: '練習場', x: 0, z: 30, r: 4.5, hint: '練習場へ行く' },
    ],
    practice: [{ id: 'town', label: '街', x: 0, z: 46, r: 4.5, hint: '街へ戻る' }],
  };
  W.TOWN_SPAWN = [0, 12, 0];
  W.TEMPLE_SPAWN = [0, -20, Math.PI];
  W.PRACTICE_SPAWN = [0, 40, 0];
  // 看板（第27版）: 文字を描いた板。posts を付けると、2 本の柱で立つ立て看板になる
  W.signs = { town: 0, dungeon: 0, practice: 0 };
  function makeSignboard(text, o) {
    o = o || {};
    W.signs[signStage] = (W.signs[signStage] || 0) + 1;
    const w = o.w || 4, h = o.h || 1.4, g = new THREE.Group();
    const tex = FX.canvasTex(512, Math.round(512 * h / w), (c, cw, ch) => {
      const grd = c.createLinearGradient(0, 0, 0, ch);
      grd.addColorStop(0, o.bg || '#1d2a4a'); grd.addColorStop(1, o.bg2 || o.bg || '#101830');
      c.fillStyle = grd; c.fillRect(0, 0, cw, ch);
      c.strokeStyle = o.border || '#e8c06a'; c.lineWidth = Math.max(6, ch * 0.05); c.strokeRect(c.lineWidth / 2, c.lineWidth / 2, cw - c.lineWidth, ch - c.lineWidth);
      c.textAlign = 'center'; c.textBaseline = 'middle';
      const main = Math.round(ch * (o.sub ? 0.46 : 0.58));
      c.fillStyle = o.color || '#fff4d8';
      c.font = `bold ${main}px "Yu Gothic UI", "Hiragino Sans", sans-serif`;
      c.fillText(text, cw / 2, o.sub ? ch * 0.42 : ch * 0.53);
      if (o.sub) { c.fillStyle = o.subColor || '#e8c06a'; c.font = `bold ${Math.round(ch * 0.2)}px "Segoe UI", sans-serif`; c.fillText(o.sub, cw / 2, ch * 0.8); }
    });
    const faceMat = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: o.glow == null ? 0.45 : o.glow, roughness: 0.6 });
    const backMat = new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.8 });
    const board = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.14), [backMat, backMat, backMat, backMat, faceMat, backMat]);
    board.position.y = (o.posts || 0) + h / 2;
    g.add(board);
    if (o.posts) {
      const pm = new THREE.MeshStandardMaterial({ color: o.postColor || 0x3a3a42, roughness: 0.6, metalness: 0.4 });
      [-1, 1].forEach((sd) => { const p = new THREE.Mesh(new THREE.BoxGeometry(0.14, o.posts + h * 0.6, 0.14), pm); p.position.set(sd * (w / 2 - 0.25), (o.posts + h * 0.6) / 2, -0.12); g.add(p); });
    }
    if (o.lamp !== false && o.posts) { const gl = FX.glowSprite('#ffe9b0', w * 0.9); gl.position.set(0, o.posts + h + 0.2, 0.4); gl.material = gl.material.clone(); gl.material.opacity = 0.35; g.add(gl); }
    return g;
  }
  // ビルの窓（8×8 の窓。夜は明かりのついた窓が光る）
  let facadeMats = null, townWinMats = [];
  function facadeMat(kind) {
    if (!facadeMats) {
      const mk = (wall, glass, frame, lit, seed) => {
        let s = seed; const rr = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
        const cells = []; for (let i = 0; i < 64; i++) cells.push(rr() < lit);
        const map = FX.canvasTex(512, 512, (c, w) => {
          c.fillStyle = wall; c.fillRect(0, 0, w, w);
          for (let i = 0; i < 64; i++) {
            const x = (i % 8) * 64, y = Math.floor(i / 8) * 64;
            c.fillStyle = frame; c.fillRect(x + 12, y + 14, 40, 36);
            const gr = c.createLinearGradient(0, y + 10, 0, y + 52); gr.addColorStop(0, glass[0]); gr.addColorStop(1, glass[1]);
            c.fillStyle = cells[i] ? '#ffd890' : gr; c.fillRect(x + 15, y + 17, 34, 30);
            c.fillStyle = frame; c.fillRect(x + 31, y + 17, 2, 30);
            c.fillStyle = 'rgba(255,255,255,0.08)'; c.fillRect(x + 15, y + 17, 34, 5);
          }
        });
        const em = FX.canvasTex(512, 512, (c, w) => {
          c.fillStyle = '#000'; c.fillRect(0, 0, w, w);
          for (let i = 0; i < 64; i++) if (cells[i]) { const x = (i % 8) * 64, y = Math.floor(i / 8) * 64; c.fillStyle = ['#ffd890', '#fff0c8', '#ffe2a8', '#d8eaff'][i % 4]; c.fillRect(x + 15, y + 17, 16, 30); c.fillRect(x + 33, y + 17, 16, 30); }
        });
        [map, em].forEach((t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; });
        const m = new THREE.MeshStandardMaterial({ map, emissive: 0xffffff, emissiveMap: em, emissiveIntensity: 1, roughness: 0.55, metalness: 0.15 });
        townWinMats.push(m);
        return m;
      };
      facadeMats = {
        glass: mk('#4a5a72', ['#2a4a7a', '#14243e'], '#8a9ab0', 0.32, 7),
        brick: mk('#7a4a3a', ['#1a2230', '#0c1018'], '#c8b8a0', 0.4, 13),
        concrete: mk('#9a968e', ['#28303c', '#10141c'], '#5a5a5e', 0.36, 29),
        dark: mk('#2e3038', ['#1e2c44', '#0a1220'], '#4a4e58', 0.28, 41),
      };
      facadeMats.roof = new THREE.MeshStandardMaterial({ color: 0x55585e, roughness: 0.9 });
    }
    return facadeMats[kind];
  }
  // 窓の模様が、ビルの大きさに合わせて同じ大きさで並ぶように、面ごとに貼り方を変える（1 枚 = 横 24m・縦 28m）
  function buildingGeo(w, h, d) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const uv = geo.attributes.uv;
    const faces = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * faces[f][0] / 16, uv.getY(i) * faces[f][1] / 24.5); }
    return geo;
  }
  const townAnim = [];
  let signStage = 'practice'; // 今作っている看板が、どのステージのものか（動作確認用に数える）
  function buildTown() {
    signStage = 'town';
    const g = new THREE.Group(); decor.town = g; scene.add(g);
    const S = stageSolids.town;
    // 地面: 明るい歩道のタイル
    const pave = FX.canvasTex(256, 256, (c, w) => {
      c.fillStyle = '#8c8a86'; c.fillRect(0, 0, w, w);
      for (let i = 0; i < 2200; i++) { const v = rand(110, 160) | 0; c.fillStyle = `rgba(${v},${v},${v - 4},${rand(0.08, 0.25)})`; c.fillRect(rand(0, w), rand(0, w), rand(1, 3), rand(1, 3)); }
      c.strokeStyle = 'rgba(60,58,56,0.55)'; c.lineWidth = 2;
      for (let k = 0; k <= 8; k++) { c.beginPath(); c.moveTo(0, k * 32); c.lineTo(w, k * 32); c.stroke(); c.beginPath(); c.moveTo(k * 32, 0); c.lineTo(k * 32, w); c.stroke(); }
    });
    pave.wrapS = pave.wrapT = THREE.RepeatWrapping; pave.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    const pIn = pave.clone(); pIn.needsUpdate = true; pIn.repeat.set(CH_SIZE / 4, CH_SIZE / 4);
    const pOut = pave.clone(); pOut.needsUpdate = true; pOut.repeat.set(1 / 4, 1 / 4);
    groundTex.town = { inner: pIn, outer: pOut };
    const M = (o) => new THREE.MeshStandardMaterial(o);
    const box = (w, h, d, m, x, y, z, parent) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); (parent || g).add(o); return o; };
    const cyl = (r0, r1, h, m, x, y, z, seg) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg || 12), m); o.position.set(x, y, z); g.add(o); return o; };
    const place = (obj, x, y, z, ry) => { obj.position.set(x, y, z); obj.rotation.y = ry || 0; g.add(obj); return obj; };
    // ---- 道路: アスファルト・白線・横断歩道・縁石 ----
    const roadTex = (vertical) => {
      const t = FX.canvasTex(256, 512, (c, w, h) => {
        c.fillStyle = '#2e3034'; c.fillRect(0, 0, w, h);
        for (let i = 0; i < 2600; i++) { const v = rand(30, 80) | 0; c.fillStyle = `rgba(${v},${v},${v + 4},${rand(0.15, 0.4)})`; c.fillRect(rand(0, w), rand(0, h), rand(1, 3), rand(1, 3)); }
        c.fillStyle = '#e8e4d8'; c.fillRect(10, 0, 6, h); c.fillRect(w - 16, 0, 6, h);
        c.fillStyle = '#f0c040'; for (let y = 0; y < h; y += 128) c.fillRect(w / 2 - 4, y + 16, 8, 80);
      });
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      void vertical; return t;
    };
    const road = (x0, z0, x1, z1) => {
      const along = Math.abs(x1 - x0) > Math.abs(z1 - z0);
      const len = along ? Math.abs(x1 - x0) : Math.abs(z1 - z0), wid = along ? Math.abs(z1 - z0) : Math.abs(x1 - x0);
      const t = roadTex(); t.repeat.set(1, len / 18);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(wid, len), M({ map: t, roughness: 0.95 }));
      m.rotation.x = -Math.PI / 2; if (along) m.rotation.z = Math.PI / 2;
      m.position.set((x0 + x1) / 2, 0.025, (z0 + z1) / 2); g.add(m);
    };
    road(-4.5, -27, 4.5, -8.5);   // 北: 神殿まで
    road(-4.5, 0.5, 4.5, 37);     // 南: 練習場の門まで
    road(4.5, -8.5, 26, 0.5);     // 東: 杖の店まで
    road(-30, -8.5, -4.5, 0.5);   // 西: ダンジョンの入口まで
    const cross = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), M({ color: 0x2e3034, roughness: 0.95 })); cross.rotation.x = -Math.PI / 2; cross.position.set(0, 0.024, -4); g.add(cross);
    // 横断歩道
    const zebra = M({ color: 0xe8e4d8, roughness: 0.8 });
    const stripes = (cx, cz, alongX) => { for (let k = -3; k <= 3; k++) { const s = new THREE.Mesh(new THREE.PlaneGeometry(alongX ? 0.7 : 3.2, alongX ? 3.2 : 0.7), zebra); s.rotation.x = -Math.PI / 2; s.position.set(cx + (alongX ? k * 1.2 : 0), 0.03, cz + (alongX ? 0 : k * 1.2)); g.add(s); } };
    stripes(0, -10.5, true); stripes(0, 2.5, true); stripes(6.5, -4, false); stripes(-6.5, -4, false);
    // 縁石（歩道との境目。足もとの低い段）
    const curbM = M({ color: 0xb8b4aa, roughness: 0.85 });
    [[-4.6, -27, -4.6, -8.5], [4.6, -27, 4.6, -8.5], [-4.6, 0.5, -4.6, 37], [4.6, 0.5, 4.6, 37], [4.5, -8.6, 26, -8.6], [4.5, 0.6, 26, 0.6], [-30, -8.6, -4.5, -8.6], [-30, 0.6, -4.5, 0.6]].forEach(([x0, z0, x1, z1]) => {
      const lx = Math.abs(x1 - x0), lz = Math.abs(z1 - z0); box(Math.max(0.2, lx), 0.12, Math.max(0.2, lz), curbM, (x0 + x1) / 2, 0.06, (z0 + z1) / 2);
    });
    // ---- ビル: 道路で分けた 4 つの区画を、ビルで敷き詰める（手前は当たり判定あり、遠くは見た目だけ） ----
    let seed = 1234; const rr = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const kinds = ['glass', 'brick', 'concrete', 'dark'];
    // 建てない場所: 神殿・店・ダンジョンの入口・練習場の門（とそのまわり）
    const zones = [[-10.5, -60, 10.5, -25.5], [26, -9.5, 60, 1.5], [-60, -11, -26, 3.5], [-8, 33, 8, 60]];
    const blocked = (x, z, hw, hd) => zones.some(([a, b, c, d]) => x + hw > a && x - hw < c && z + hd > b && z - hd < d);
    const shopCols = [0xffc070, 0x9adfff, 0xffa0c8, 0xd8ffb0], awCols = [0xb83a3a, 0x2a6a9a, 0x3a8a5a, 0xc89a30];
    const shopTex = FX.canvasTex(256, 96, (c, w, h) => {
      c.fillStyle = '#14141a'; c.fillRect(0, 0, w, h);
      const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#9a9a9a'); gr.addColorStop(1, '#3a3a3a');
      for (let k = 0; k < 4; k++) { c.fillStyle = gr; c.fillRect(k * 64 + 5, 8, 54, h - 14); c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(k * 64 + 12, h - 30, 40, 16); }
      c.fillStyle = '#2a2a30'; c.fillRect(0, 0, w, 6);
    });
    const shopMats = shopCols.map((c) => M({ map: shopTex, color: 0x6a6a70, emissive: c, emissiveMap: shopTex, emissiveIntensity: 0.65, roughness: 0.25, metalness: 0.2 }));
    const awMats = awCols.map((c) => M({ color: c, roughness: 0.8 }));
    const roofBox = M({ color: 0x6a6e74, roughness: 0.8 });
    // fronts: 道路に面した面の向き（その面に 1 階の店先とひさしを付ける）
    const building = (x, z, w, d, h, kind, solid, fronts) => {
      const fm = facadeMat(kind), roof = facadeMat('roof');
      const b = new THREE.Mesh(buildingGeo(w, h, d), [fm, fm, roof, roof, fm, fm]); b.position.set(x, h / 2, z); g.add(b);
      (fronts || []).forEach((ry) => {
        const nx = Math.round(Math.sin(ry)), nz = Math.round(Math.cos(ry));
        const half = nx ? w / 2 : d / 2, len = (nx ? d : w) * 0.82;
        const k = Math.floor(rr() * 4);
        const p = new THREE.Mesh(new THREE.PlaneGeometry(len, 2.4), shopMats[k]); p.position.set(x + nx * (half + 0.03), 1.5, z + nz * (half + 0.03)); p.rotation.y = ry; g.add(p);
        const a = new THREE.Mesh(new THREE.BoxGeometry(len, 0.12, 1.1), awMats[k]); a.position.set(x + nx * (half + 0.55), 3.0, z + nz * (half + 0.55)); a.rotation.y = ry; g.add(a);
      });
      if (rr() < 0.6) box(w * 0.3, 1.4, d * 0.25, roofBox, x + w * 0.15, h + 0.7, z - d * 0.1);
      if (h > 38) { cyl(0.08, 0.12, 6, roofBox, x, h + 3, z, 6); const bl = FX.glowSprite('#ff3a3a', 1.6); bl.position.set(x, h + 6.2, z); g.add(bl); townAnim.push({ blink: bl, ph: rr() * 6 }); }
      if (solid) addSolid(S, x, z, w / 2, d / 2, h);
    };
    // (x0, z0) の角から、sx・sz の向きへ敷き詰める
    const pack = (x0, z0, sx, sz, lim) => {
      let z = z0, row = 0;
      while (Math.abs(z) < lim) {
        const d = 10 + rr() * 6;
        let x = x0, col = 0;
        while (Math.abs(x) < lim) {
          const w = 8 + rr() * 6;
          const cx = x + (sx * w) / 2, cz = z + (sz * d) / 2, dist = Math.hypot(cx, cz);
          if (dist < lim && !blocked(cx, cz, w / 2, d / 2)) {
            const h = 9 + rr() * 16 + Math.max(0, dist - 14) * 0.6 + (rr() < 0.12 ? 22 : 0);
            const fronts = [];
            if (col === 0 && dist < 60) fronts.push(sx > 0 ? -Math.PI / 2 : Math.PI / 2);
            if (row === 0 && dist < 60) fronts.push(sz > 0 ? Math.PI : 0);
            building(cx, cz, w, d, h, kinds[Math.floor(rr() * 4)], dist < 62, fronts);
          }
          x += sx * (w + 1.4); col++;
        }
        z += sz * (d + 1.4); row++;
      }
    };
    pack(7.6, -11.6, 1, -1, 92); pack(-7.6, -11.6, -1, -1, 92); pack(7.6, 3.6, 1, 1, 92); pack(-7.6, 3.6, -1, 1, 92);
    // 突き当たりの先をふさぐビル（店・入口・神殿・練習場の門のうしろ）
    building(48, -4, 20, 14, 30, 'glass', true, [-Math.PI / 2]);
    building(-54, -4, 12, 14, 26, 'concrete', true, []);
    building(0, -50, 22, 14, 34, 'dark', true, [0]);
    building(0, 50, 18, 14, 28, 'brick', true, [Math.PI]);
    // 遠くのビル群（街の外の見た目だけ）
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2 + rr() * 0.1, r = 105 + rr() * 60;
      const w = 14 + rr() * 16, h = 40 + Math.pow(rr(), 1.3) * 90;
      building(Math.cos(a) * r, Math.sin(a) * r, w, w * (0.7 + rr() * 0.6), h, kinds[Math.floor(rr() * 4)], false, []);
    }
    // ---- 街灯・信号・街路樹・ベンチ・停めてある車・ネオン ----
    const pole = M({ color: 0x3a3c42, roughness: 0.5, metalness: 0.5 });
    const streetLamp = (x, z, dir) => {
      cyl(0.09, 0.13, 6.5, pole, x, 3.25, z, 8);
      const arm = box(1.6, 0.1, 0.1, pole, x + dir * 0.8, 6.4, z);
      const head = box(0.7, 0.18, 0.35, M({ color: 0xfff0c8, emissive: 0xffe0a0, emissiveIntensity: 1.2 }), x + dir * 1.5, 6.3, z);
      const gl = FX.glowSprite('#ffd890', 5); gl.position.set(x + dir * 1.5, 6.1, z); g.add(gl);
      addSolid(S, x, z, 0.18, 0.18, 6.5); void arm; void head;
    };
    for (let z = -24; z <= 34; z += 13) { if (z > -12 && z < 4) continue; streetLamp(-5.8, z, 1); streetLamp(5.8, z + 6, -1); }
    for (let x = 9; x <= 24; x += 13) { streetLamp(x, -9.8, 0); streetLamp(-x, 1.8, 0); }
    const trafficLight = (x, z, ry) => {
      const t = new THREE.Group(); place(t, x, 0, z, ry);
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 4.2, 8), pole); p.position.y = 2.1; t.add(p);
      const hb = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.25, 0.35), M({ color: 0x1a1a1e, roughness: 0.6 })); hb.position.set(0, 4.2, 0); t.add(hb);
      [[0xff3a2a, 0.38], [0xffc030, 0], [0x3aff8a, -0.38]].forEach(([c, y], i) => { const l = new THREE.Mesh(new THREE.CircleGeometry(0.13, 12), M({ color: c, emissive: c, emissiveIntensity: i === 2 ? 1.6 : 0.15 })); l.position.set(0, 4.2 + y, 0.18); t.add(l); });
      addSolid(S, x, z, 0.16, 0.16, 4.2);
    };
    trafficLight(5.6, -9.6, Math.PI); trafficLight(-5.6, 1.6, 0); trafficLight(5.6, 1.6, Math.PI / 2); trafficLight(-5.6, -9.6, -Math.PI / 2);
    const leaf = M({ color: 0x2f7a3a, roughness: 0.8, flatShading: true }), bark = M({ color: 0x5a3a24, roughness: 0.9 });
    const tree = (x, z) => {
      box(1.4, 0.4, 1.4, M({ color: 0x8a8680, roughness: 0.9 }), x, 0.2, z);
      cyl(0.12, 0.18, 2.6, bark, x, 1.5, z, 6);
      const c = new THREE.Mesh(new THREE.IcosahedronGeometry(1.4, 0), leaf); c.position.set(x, 3.3, z); c.scale.set(1, 1.15, 1); g.add(c);
      addSolid(S, x, z, 0.7, 0.7, 0.4);
    };
    [[-6, -18], [6, -21], [-6, 10], [6, 16], [-6, 28], [6, 30], [14, -10.2], [-15, 1.9], [20, 1.9], [-21, -10.2]].forEach(([x, z]) => tree(x, z));
    const bench = (x, z, ry) => { const b = new THREE.Group(); place(b, x, 0, z, ry); const wd = woodMat; const s = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.1, 0.5), wd); s.position.y = 0.5; b.add(s); const bk = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, 0.08), wd); bk.position.set(0, 0.8, -0.22); b.add(bk); [-0.75, 0.75].forEach((dx) => { const l = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.45), pole); l.position.set(dx, 0.25, 0); b.add(l); }); };
    bench(-6.2, 20, Math.PI / 2); bench(6.2, 22, -Math.PI / 2); bench(-6.2, -16, Math.PI / 2);
    const car = (x, z, ry, col) => {
      const c = new THREE.Group(); place(c, x, 0, z, ry);
      const body = M({ color: col, roughness: 0.3, metalness: 0.6 }), glass = M({ color: 0x1a2a3a, roughness: 0.1, metalness: 0.8 }), tire = M({ color: 0x111111, roughness: 0.9 });
      const b1 = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.65, 4.2), body); b1.position.y = 0.6; c.add(b1);
      const b2 = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.55, 2.2), glass); b2.position.set(0, 1.18, -0.2); c.add(b2);
      [[-0.85, 1.35], [0.85, 1.35], [-0.85, -1.35], [0.85, -1.35]].forEach(([dx, dz]) => { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.25, 12), tire); w.rotation.z = Math.PI / 2; w.position.set(dx, 0.33, dz); c.add(w); });
      [-0.6, 0.6].forEach((dx) => { const hl = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.12, 0.05), M({ color: 0xfff6d8, emissive: 0xfff0c0, emissiveIntensity: 0.9 })); hl.position.set(dx, 0.7, 2.11); c.add(hl); const tl = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.12, 0.05), M({ color: 0xff2a2a, emissive: 0xff2a2a, emissiveIntensity: 0.8 })); tl.position.set(dx, 0.7, -2.11); c.add(tl); });
      const rot = Math.abs(Math.sin(ry)) > 0.5;
      addSolid(S, x, z, rot ? 2.1 : 0.9, rot ? 0.9 : 2.1, 1.45);
    };
    car(3.2, 20, 0, 0xc83a3a); car(-3.2, 26, Math.PI, 0x3a6ac8); car(3.2, -18, 0, 0xe8e8ec); car(14, -1.2, Math.PI / 2, 0x2a2a30); car(-17, -6.8, -Math.PI / 2, 0xd8b030);
    // ネオンの看板（ビルの壁）
    const neon = (text, x, y, z, ry, col) => {
      const s = makeSignboard(text, { w: 6, h: 1.6, bg: '#0a0a14', border: col, color: col, glow: 1.1 });
      s.children[0].position.y = 0; place(s, x, y, z, ry);
    };
    neon('MAGIA', 7.55, 14, -20, -Math.PI / 2, '#ff5ac8'); neon('魔法通り', -7.55, 11, 16, Math.PI / 2, '#5ad8ff'); neon('喫茶 星屑', 7.55, 8, 24, -Math.PI / 2, '#ffd25a');
    // ---- 神殿（北の突き当たり）: 段・柱・屋根・光る祭壇 ----
    const stone = M({ color: 0xe0dace, roughness: 0.85, flatShading: true }), stoneD = M({ color: 0x9a9286, roughness: 0.9, flatShading: true });
    const goldM = M({ color: 0xe8b04a, emissive: 0x8a5a10, emissiveIntensity: 0.5, roughness: 0.4, metalness: 0.4 });
    const tz = -34;
    box(18, 0.5, 13, stone, 0, 0.25, tz); box(16, 0.5, 11, stone, 0, 0.75, tz); box(14, 0.5, 9, stone, 0, 1.25, tz);
    addSolid(S, 0, tz, 9, 6.5, 0.5);
    for (let i = 0; i < 6; i++) { const x = -6 + i * 2.4; cyl(0.45, 0.5, 6.2, stone, x, 4.6, tz + 3.6); addSolid(S, x, tz + 3.6, 0.5, 0.5, 7.8); }
    box(14, 6.2, 0.8, stoneD, 0, 4.6, tz - 3.8); addSolid(S, 0, tz - 3.8, 7, 0.45, 7.8);
    [-1, 1].forEach((sd) => { box(0.8, 6.2, 7.6, stoneD, sd * 6.6, 4.6, tz); addSolid(S, sd * 6.6, tz, 0.45, 3.8, 7.8); });
    box(15, 0.6, 9.6, stone, 0, 8, tz);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1, 3, 4), stone); roof.rotation.y = Math.PI / 4; roof.scale.set(10.6, 1, 6.8); roof.position.set(0, 9.8, tz); g.add(roof);
    box(2.4, 1.2, 1.4, goldM, 0, 2.1, tz - 1.6);
    const aglow = FX.glowSprite('#ffe9a0', 6); aglow.position.set(0, 3.4, tz - 1.6); g.add(aglow);
    const sigil = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.MeshBasicMaterial({ map: FX.circleTex, color: 0xffd36b, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
    sigil.rotation.x = -Math.PI / 2; sigil.position.set(0, 1.52, tz + 0.5); g.add(sigil); townAnim.push({ m: sigil, spin: 0.3 });
    place(makeSignboard('神殿', { sub: 'TEMPLE', w: 3.4, h: 1.3, posts: 1.1 }), 6.5, 0, -23.5, -0.3);
    // ---- 杖の店（東の突き当たり）: 3 階建て。1 階は明るいショーウィンドウ ----
    const sx = 32, sz = -4;
    const shopB = new THREE.Mesh(buildingGeo(10, 12, 9), [facadeMat('brick'), facadeMat('brick'), facadeMat('roof'), facadeMat('roof'), facadeMat('brick'), facadeMat('brick')]);
    shopB.position.set(sx, 6, sz); g.add(shopB);
    addSolid(S, sx, sz, 5, 4.5, 12);
    const win = new THREE.Mesh(new THREE.PlaneGeometry(7.4, 2.8), M({ color: 0x2a1a10, emissive: 0xffb860, emissiveIntensity: 0.9, roughness: 0.2 })); win.rotation.y = -Math.PI / 2; win.position.set(sx - 5.03, 1.7, sz); g.add(win);
    for (let k = 0; k < 5; k++) { const wd = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.6, 6), M({ color: [0xd5deea, 0xffb347, 0x9effd8, 0xb0c4ff, 0xff5a1f][k], emissive: [0x7f93b0, 0xff7a20, 0x3affb0, 0x6a8aff, 0xff3a00][k], emissiveIntensity: 0.6 })); wd.rotation.z = 0.25; wd.position.set(sx - 4.9, 1.6, sz - 2.6 + k * 1.3); g.add(wd); }
    box(1.4, 0.15, 9, M({ color: 0x2a5a8a, roughness: 0.8 }), sx - 5.7, 3.3, sz);
    const hang = makeSignboard('杖の店', { sub: 'WAND SHOP', w: 3.6, h: 1.3, bg: '#3a1a10', bg2: '#220e08' }); place(hang, sx - 5.15, 4.4, sz, -Math.PI / 2);
    place(makeSignboard('杖の店', { sub: '杖・回復薬', w: 2.4, h: 1.1, posts: 0.9, bg: '#3a1a10' }), 24.5, 0, 2.6, -Math.PI / 2 + 0.4);
    // ---- ダンジョンの入口（西の突き当たり）: 古い石のアーチと、紫の渦 ----
    const dx = -31, dz0 = -4;
    const portal = (x, y, z, col, rotY, R) => {
      const m = new THREE.Mesh(new THREE.CircleGeometry(R, 40), new THREE.MeshBasicMaterial({ map: FX.circleTex, color: col, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      m.position.set(x, y, z); m.rotation.y = rotY; g.add(m);
      const fill = new THREE.Mesh(new THREE.CircleGeometry(R * 0.96, 40), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      fill.position.copy(m.position); fill.rotation.y = rotY; g.add(fill);
      const gl = FX.glowSprite('#' + new THREE.Color(col).getHexString(), R * 3); gl.position.set(x, y, z); g.add(gl);
      townAnim.push({ m, spin: 0.8, fill });
    };
    [-1, 1].forEach((sd) => { box(1.4, 7, 1.4, stoneD, dx, 3.5, dz0 + sd * 3.4); addSolid(S, dx, dz0 + sd * 3.4, 0.7, 0.7, 7); });
    box(1.6, 1.2, 8.2, stoneD, dx, 7.5, dz0);
    portal(dx, 3.5, dz0, 0xb06bff, Math.PI / 2, 3);
    // 入口のうしろは岩山（洞窟へ続く）
    const rockM = M({ color: 0x5a5248, roughness: 0.95, flatShading: true });
    [[-36, -4, 6], [-37, -11, 5], [-37, 3, 5], [-41, -6, 7]].forEach(([x, z, r]) => { const rk = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), rockM); rk.position.set(x, r * 0.5, z); rk.scale.y = 1.2; g.add(rk); addSolid(S, x, z, r * 0.7, r * 0.7, r * 1.2); });
    place(makeSignboard('ダンジョン入口', { sub: 'DUNGEON  危険・腕に自信のある者のみ', w: 4.2, h: 1.5, posts: 1.1, bg: '#2a1030', bg2: '#140818', border: '#c08aff' }), -26.5, 0, 3.4, Math.PI / 2 - 0.35);
    // ---- 練習場の門（南の突き当たり） ----
    const pz = 37;
    [-1, 1].forEach((sd) => { box(1.2, 6, 1.2, stone, sd * 3.2, 3, pz); addSolid(S, sd * 3.2, pz, 0.6, 0.6, 6); });
    box(7.8, 1, 1.4, stone, 0, 6.4, pz);
    portal(0, 3, pz, 0x4fa8ff, 0, 2.6);
    place(makeSignboard('練習場', { sub: 'TRAINING GROUND', w: 3.2, h: 1.2, posts: 1.1, bg: '#102a4a' }), -6.4, 0, 31.5, Math.PI + 0.35);
    // ---- 交差点の案内標識（矢印の看板） ----
    const post = new THREE.Group(); place(post, 5.8, 0, -10.2, 0);
    const pp = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 4.6, 8), pole); pp.position.y = 2.3; post.add(pp);
    [['↑ 神殿', 4.1, Math.PI], ['杖の店 →', 3.6, -Math.PI / 2], ['← ダンジョン', 3.1, Math.PI / 2], ['↓ 練習場', 2.6, 0]].forEach(([t, y, ry]) => {
      const sb = makeSignboard(t, { w: 1.9, h: 0.45, bg: '#1a5a3a', border: '#ffffff', glow: 0.5 }); sb.children[0].position.y = 0;
      sb.position.set(0, y, 0); sb.rotation.y = ry; post.add(sb);
    });
    addSolid(S, 5.8, -10.2, 0.1, 0.1, 4.6);
    g.visible = false;
  }

  // ======================================================================
  //  ダンジョン（第26版）: 迷路の階。壁は固い壁、床は暗い石。階段・帰還ポータルの飾りもここで作る
  // ======================================================================
  let dunTex = null, wallMat = null, dunGroup = null;
  const dunAnim = [];
  W.dun = null;
  function ensureDungeonDecor() {
    if (decor.dungeon) return;
    dunGroup = new THREE.Group(); decor.dungeon = dunGroup; scene.add(dunGroup); dunGroup.visible = false;
    // 洞窟の床: 湿った土と小石
    const t = FX.canvasTex(256, 256, (c, w) => {
      c.fillStyle = '#4a3e34'; c.fillRect(0, 0, w, w);
      for (let i = 0; i < 2600; i++) { const v = rand(40, 95) | 0; c.fillStyle = `rgba(${v},${(v * 0.85) | 0},${(v * 0.7) | 0},${rand(0.15, 0.45)})`; c.fillRect(rand(0, w), rand(0, w), rand(1, 4), rand(1, 4)); }
      for (let i = 0; i < 90; i++) { const v = rand(70, 130) | 0; c.fillStyle = `rgb(${v},${(v * 0.92) | 0},${(v * 0.85) | 0})`; c.beginPath(); c.ellipse(rand(0, w), rand(0, w), rand(2, 6), rand(1.5, 4), rand(0, 3), 0, Math.PI * 2); c.fill(); }
      c.fillStyle = 'rgba(20,14,10,0.35)'; for (let i = 0; i < 12; i++) { c.beginPath(); c.ellipse(rand(0, w), rand(0, w), rand(15, 40), rand(8, 20), rand(0, 3), 0, Math.PI * 2); c.fill(); }
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    const dIn = t.clone(); dIn.needsUpdate = true; dIn.repeat.set(CH_SIZE / 6, CH_SIZE / 6);
    const dOut = t.clone(); dOut.needsUpdate = true; dOut.repeat.set(1 / 4, 1 / 4);
    groundTex.dungeon = { inner: dIn, outer: dOut };
    // 洞窟の岩肌: ごつごつした茶色い岩（筋と割れ目）
    dunTex = FX.canvasTex(256, 256, (c, w) => {
      c.fillStyle = '#5e5246'; c.fillRect(0, 0, w, w);
      for (let i = 0; i < 160; i++) { const v = rand(55, 120) | 0; c.fillStyle = `rgba(${v},${(v * 0.88) | 0},${(v * 0.74) | 0},${rand(0.25, 0.6)})`; c.beginPath(); c.ellipse(rand(0, w), rand(0, w), rand(8, 34), rand(5, 16), rand(-0.4, 0.4), 0, Math.PI * 2); c.fill(); }
      c.strokeStyle = 'rgba(20,14,10,0.6)'; c.lineWidth = 2;
      for (let i = 0; i < 26; i++) { c.beginPath(); let x = rand(0, w), y = rand(0, w); c.moveTo(x, y); for (let k = 0; k < 4; k++) { x += rand(-30, 30); y += rand(-10, 18); c.lineTo(x, y); } c.stroke(); }
      for (let i = 0; i < 1400; i++) { c.fillStyle = `rgba(0,0,0,${rand(0.05, 0.2)})`; c.fillRect(rand(0, w), rand(0, w), rand(1, 3), rand(1, 3)); }
    });
    dunTex.wrapS = dunTex.wrapT = THREE.RepeatWrapping;
    wallMat = new THREE.MeshStandardMaterial({ map: dunTex, roughness: 0.95, color: 0xc0b0a0, flatShading: true });
  }
  const WALL_H = 5.5;
  // 階を組み立てる（d: MG.RPG.makeFloor の結果）。戻り値: 入口・階段・ポータルの位置
  W.buildDungeon = function (d) {
    ensureDungeonDecor();
    signStage = 'dungeon'; W.signs.dungeon = 0;
    const R = MG.RPG;
    // 前の階を片づける
    while (dunGroup.children.length) { const o = dunGroup.children[0]; dunGroup.remove(o); if (o.geometry && !o.isSprite) o.geometry.dispose(); if (o.material && !o.isSprite && o.material !== wallMat) o.material.dispose(); }
    dunAnim.length = 0;
    stageSolids.dungeon.length = 0;
    const N = d.N, T = R.TILE, isFloor = (x, z) => x >= 0 && z >= 0 && x < N && z < N && d.tiles[z * N + x] === 1;
    // 床に接している壁のタイルだけを、横に続く分まとめて 1 つの箱にする
    const need = (x, z) => !isFloor(x, z) && [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]].some(([a, b]) => isFloor(x + a, z + b));
    const boxes = [];
    for (let z = 0; z < N; z++) {
      let x = 0;
      while (x < N) {
        if (!need(x, z)) { x++; continue; }
        let x1 = x; while (x1 + 1 < N && need(x1 + 1, z)) x1++;
        boxes.push([x, z, x1]); x = x1 + 1;
      }
    }
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const inst = new THREE.InstancedMesh(geo, wallMat, boxes.length);
    const mtx = new THREE.Matrix4();
    boxes.forEach(([x0, z, x1], i) => {
      const [wx0, wz] = R.tileToWorld(x0, z), [wx1] = R.tileToWorld(x1, z);
      const cx = (wx0 + wx1) / 2, len = (x1 - x0 + 1) * T;
      const vh = WALL_H + 0.6 + rand(0, 2.2);
      mtx.makeScale(len, vh, T); mtx.setPosition(cx, vh / 2, wz);
      inst.setMatrixAt(i, mtx);
      addSolid(stageSolids.dungeon, cx, wz, len / 2, T / 2, WALL_H);
    });
    inst.instanceMatrix.needsUpdate = true;
    dunGroup.add(inst);
    // 壁ぎわの岩（壁をごつごつに見せる。見た目だけ）
    const rockGeo = new THREE.IcosahedronGeometry(1, 0);
    { const pa = rockGeo.attributes.position; for (let i = 0; i < pa.count; i++) pa.setXYZ(i, pa.getX(i) * rand(0.8, 1.2), pa.getY(i) * rand(0.7, 1.1), pa.getZ(i) * rand(0.8, 1.2)); rockGeo.computeVertexNormals(); }
    const edge = [];
    for (let z = 1; z < N - 1; z++) for (let x = 1; x < N - 1; x++) {
      if (isFloor(x, z)) continue;
      const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([a2, b2]) => isFloor(x + a2, z + b2));
      if (nb.length) edge.push([x, z, nb[Math.floor(Math.random() * nb.length)]]);
    }
    const rocks = new THREE.InstancedMesh(rockGeo, wallMat, Math.min(700, edge.length));
    const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new V3(), _p = new V3();
    let nr = 0;
    edge.forEach(([x, z, [nx, nz]]) => {
      if (nr >= rocks.count || Math.random() > 0.6) return;
      const [wx, wz] = R.tileToWorld(x, z), sc = rand(0.9, 1.9);
      _p.set(wx + nx * 0.7, sc * rand(0.2, 0.9), wz + nz * 0.7);
      _q.setFromEuler(_e.set(rand(0, 6), rand(0, 6), rand(0, 6))); _s.set(sc, sc * rand(0.8, 1.6), sc);
      mtx.compose(_p, _q, _s); rocks.setMatrixAt(nr++, mtx);
    });
    rocks.count = nr; rocks.instanceMatrix.needsUpdate = true; dunGroup.add(rocks);
    // 天井（空は見えない）
    const ceilTex = dunTex.clone(); ceilTex.needsUpdate = true; ceilTex.repeat.set(24, 24);
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(N * T + 20, N * T + 20), new THREE.MeshStandardMaterial({ map: ceilTex, color: 0x6a5a4c, roughness: 1, side: THREE.DoubleSide }));
    ceil.rotation.x = Math.PI / 2; ceil.position.y = WALL_H + 3.0; dunGroup.add(ceil);
    // つらら石（天井から下がる）と、石筍（壁ぎわの床から生える）
    const coneGeo = new THREE.ConeGeometry(1, 1, 6);
    const floorTiles = []; for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) if (isFloor(x, z)) floorTiles.push([x, z]);
    const stal = new THREE.InstancedMesh(coneGeo, wallMat, 220);
    let ns = 0;
    for (let k = 0; k < 160 && floorTiles.length; k++) {
      const [x, z] = floorTiles[Math.floor(Math.random() * floorTiles.length)], [wx, wz] = R.tileToWorld(x, z);
      const len = rand(0.8, 2.6), r = rand(0.18, 0.45);
      _p.set(wx + rand(-0.8, 0.8), WALL_H + 3.0 - len / 2, wz + rand(-0.8, 0.8)); _q.setFromEuler(_e.set(Math.PI, 0, 0)); _s.set(r, len, r);
      mtx.compose(_p, _q, _s); stal.setMatrixAt(ns++, mtx);
    }
    edge.slice(0, 400).forEach(([x, z, [nx, nz]]) => {
      if (ns >= stal.count || Math.random() > 0.15) return;
      const [wx, wz] = R.tileToWorld(x + nx, z + nz), len = rand(0.5, 1.4), r = rand(0.15, 0.35);
      _p.set(wx - nx * 0.6, len / 2, wz - nz * 0.6); _q.identity(); _s.set(r, len, r);
      mtx.compose(_p, _q, _s); stal.setMatrixAt(ns++, mtx);
    });
    stal.count = ns; stal.instanceMatrix.needsUpdate = true; dunGroup.add(stal);
    // 光る水晶（洞窟の明かり）
    const crysCols = [0x5ad8ff, 0xb07aff, 0x7affc8];
    for (let k = 0; k < 22 && edge.length; k++) {
      const [x, z, [nx, nz]] = edge[Math.floor(Math.random() * edge.length)], [wx, wz] = R.tileToWorld(x, z);
      const col = crysCols[k % 3];
      const cm = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.1, roughness: 0.2, flatShading: true });
      const cg = new THREE.Group(); cg.position.set(wx + nx * 1.0, 0, wz + nz * 1.0); dunGroup.add(cg);
      for (let j = 0; j < 4; j++) { const c = new THREE.Mesh(new THREE.OctahedronGeometry(rand(0.18, 0.35), 0), cm); c.scale.y = rand(2, 3.5); c.position.set(rand(-0.4, 0.4), rand(0.3, 0.8), rand(-0.4, 0.4)); c.rotation.set(rand(-0.4, 0.4), rand(0, 6), rand(-0.4, 0.4)); cg.add(c); }
      const gl = FX.glowSprite('#' + new THREE.Color(col).getHexString(), 3.2); gl.position.y = 0.7; cg.add(gl);
    }
    // たいまつ: 部屋のふちの壁ぞいに置く
    const torchMat = new THREE.MeshBasicMaterial({ color: 0xffb050 });
    let torches = 0;
    d.rooms.forEach((r) => {
      if (r.small) return;
      [[r.x0 - 1, r.z0 + Math.floor(r.h / 2), 0.7, 0], [r.x0 + r.w, r.z0 + Math.floor(r.h / 2), -0.7, 0], [r.x0 + Math.floor(r.w / 2), r.z0 - 1, 0, 0.7], [r.x0 + Math.floor(r.w / 2), r.z0 + r.h, 0, -0.7]].forEach(([tx, tzz, ox, oz]) => {
        if (isFloor(tx, tzz) || torches > 26 || Math.random() < 0.4) return;
        const [wx, wz] = R.tileToWorld(tx, tzz);
        const p = new V3(wx + ox * (T / 0.7) * 0.55, 3.2, wz + oz * (T / 0.7) * 0.55);
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.5, 0.25), torchMat); m.position.copy(p); dunGroup.add(m);
        const gl = FX.glowSprite('#ff9a3a', 3.2); gl.position.copy(p).add(new V3(0, 0.35, 0)); dunGroup.add(gl);
        dunAnim.push({ torch: gl, ph: rand(0, 10) });
        torches++;
      });
    });
    // 入口・階段・帰還ポータル
    const at = (id) => { const [tx, tzz] = d.center(d.rooms[id]); const [x, z] = R.tileToWorld(tx, tzz); return new V3(x, 0, z); };
    const start = at(d.start), stairs = at(d.stairs), portal = at(d.portal);
    const flat = (p, col, s, op) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s), new THREE.MeshBasicMaterial({ map: FX.circleTex, color: col, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.set(p.x, 0.06, p.z); dunGroup.add(m); return m; };
    const s0 = flat(start, 0x7fd8ff, 4, 0.35); dunAnim.push({ m: s0, spin: 0.2 });
    // 階段: 地面に開いた光る穴（下へ続く）
    const st1 = flat(stairs, 0xffb84a, 5, 0.9), hole = new THREE.Mesh(new THREE.CircleGeometry(1.7, 32), new THREE.MeshBasicMaterial({ color: 0x05030a }));
    hole.rotation.x = -Math.PI / 2; hole.position.set(stairs.x, 0.07, stairs.z); dunGroup.add(hole);
    const sbeam = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 6, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0xffb84a, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    sbeam.position.set(stairs.x, 3, stairs.z); dunGroup.add(sbeam);
    const slab = makeSignboard('下の階へ', { sub: '↓ DOWN', w: 2.2, h: 0.9, posts: 0.9, bg: '#3a2410', bg2: '#22140a', border: '#ffb84a' }); slab.position.set(stairs.x + 2.6, 0, stairs.z); slab.rotation.y = -Math.PI / 2; dunGroup.add(slab);
    dunAnim.push({ m: st1, spin: -0.6 });
    const stairsParts = [st1, hole, sbeam, slab];
    // 帰還ポータル: 立った青い渦
    const pg = new THREE.Group(); pg.position.set(portal.x, 0, portal.z); dunGroup.add(pg);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.8, 0.16, 8, 40), new THREE.MeshStandardMaterial({ color: 0xbfe6ff, emissive: 0x4fa8ff, emissiveIntensity: 1.2 }));
    ring.position.y = 2.2; pg.add(ring);
    const swirl = new THREE.Mesh(new THREE.CircleGeometry(1.7, 40), new THREE.MeshBasicMaterial({ map: FX.circleTex, color: 0x2f78d8, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    swirl.position.y = 2.2; pg.add(swirl);
    const pgl = FX.glowSprite('#4fa8ff', 6); pgl.position.y = 2.2; pg.add(pgl);
    const plab = makeSignboard('帰還ポータル', { sub: '街へ帰る', w: 2.6, h: 0.95, posts: 0.9, bg: '#102a4a', border: '#7fd8ff' }); plab.position.set(2.6, 0, 0.4); pg.add(plab);
    dunAnim.push({ m: swirl, spin: 1.4 }, { face: pg });
    W.dun = { data: d, start, stairs, portal, stairsOpen: !d.boss, stairsParts, portalGroup: pg };
    W.setStairsOpen(!d.boss);
    if (W.stage === 'dungeon') solids = stageSolids.dungeon;
    return W.dun;
  };
  // ボスの階では、ボスを倒すまで階段が閉じている
  W.setStairsOpen = function (v) {
    if (!W.dun) return;
    W.dun.stairsOpen = !!v;
    W.dun.stairsParts.forEach((o) => { o.visible = !!v; });
  };

  // ステージを切り替える（'practice' / 'arena' / 'town' / 'dungeon'）。地形は元どおりにする
  const STAGES = ['practice', 'arena', 'town', 'dungeon'];
  W.setStage = function (name) {
    name = STAGES.includes(name) ? name : 'practice';
    if (name === W.stage) return false;
    stashStage(W.stage);
    decor[W.stage].visible = false;
    W.stage = name;
    if (name === 'arena' && !decor.arena) buildArena();
    else if (name === 'town' && !decor.town) { buildTown(); stash.town = { props: [], pillars: [], walls: [] }; unstashStage('town'); }
    else if (name === 'dungeon' && !stash.dungeon) { ensureDungeonDecor(); }
    else unstashStage(name);
    solids = stageSolids[name] || [];
    decor[name].visible = true;
    applyGround(name);
    applyTime(timeK);
    W.resetTerrain();
    return true;
  };

  // ---- 闘技場: 石の壁と客席に囲まれた、砂の円形の広場。中には盾にできる壁・柱・岩・木箱 ----
  function buildArena() {
    const g = new THREE.Group();
    decor.arena = g; scene.add(g);
    // 砂の地面
    const sand = FX.canvasTex(256, 256, (c, w) => {
      c.fillStyle = '#b39468'; c.fillRect(0, 0, w, w);
      for (let i = 0; i < 3200; i++) { const v = rand(120, 200) | 0; c.fillStyle = `rgba(${v},${(v * 0.82) | 0},${(v * 0.6) | 0},${rand(0.08, 0.3)})`; c.fillRect(rand(0, w), rand(0, w), rand(1, 3), rand(1, 3)); }
      c.strokeStyle = 'rgba(90,64,36,0.18)'; c.lineWidth = 2;
      for (let i = 0; i < 9; i++) { c.beginPath(); const y = rand(0, w); c.moveTo(0, y); c.bezierCurveTo(w * 0.3, y + rand(-20, 20), w * 0.7, y + rand(-20, 20), w, y); c.stroke(); }
    });
    sand.wrapS = sand.wrapT = THREE.RepeatWrapping;
    sand.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    const sIn = sand.clone(); sIn.needsUpdate = true; sIn.repeat.set(CH_SIZE / TILE, CH_SIZE / TILE);
    const sOut = sand.clone(); sOut.needsUpdate = true; sOut.repeat.set(1 / TILE, 1 / TILE);
    groundTex.arena = { inner: sIn, outer: sOut };
    // 石の模様
    const stoneTex = FX.canvasTex(256, 128, (c, w, h) => {
      c.fillStyle = '#8b8172'; c.fillRect(0, 0, w, 128);
      for (let r = 0; r < 4; r++) for (let k = 0; k < 5; k++) {
        const x = k * 64 + (r % 2) * 32, y = r * 32, v = rand(115, 150) | 0;
        c.fillStyle = `rgb(${v},${(v * 0.95) | 0},${(v * 0.85) | 0})`; c.fillRect(x + 2, y + 2, 60, 28);
        c.fillRect(x - 256 + 2, y + 2, 60, 28);
      }
      for (let i = 0; i < 900; i++) { c.fillStyle = `rgba(40,34,28,${rand(0.05, 0.2)})`; c.fillRect(rand(0, w), rand(0, 128), rand(1, 4), rand(1, 3)); }
    });
    stoneTex.wrapS = stoneTex.wrapT = THREE.RepeatWrapping;
    const wallTex = stoneTex.clone(); wallTex.needsUpdate = true; wallTex.repeat.set(26, 1.4);
    const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.95, side: THREE.BackSide });
    const WR = ARENA_R + 0.8, WH = 4.6;
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(WR, WR, WH, 72, 1, true), wallMat);
    wall.position.y = WH / 2; g.add(wall);
    // 壁の上のふち
    const capMat = new THREE.MeshStandardMaterial({ color: 0x9a8f7c, roughness: 0.9, flatShading: true, side: THREE.DoubleSide });
    const cap = new THREE.Mesh(new THREE.RingGeometry(WR - 0.25, WR + 1.6, 72, 1), capMat);
    cap.rotation.x = -Math.PI / 2; cap.position.y = WH; g.add(cap);
    // 階段状の客席
    const prof = [new THREE.Vector2(WR + 1.6, WH)];
    for (let i = 0; i < 8; i++) { const r = WR + 1.6 + i * 1.7, y = WH + 0.9 + i * 1.15; prof.push(new THREE.Vector2(r, y), new THREE.Vector2(r + 1.7, y)); }
    const top = prof[prof.length - 1];
    prof.push(new THREE.Vector2(top.x, top.y + 2.4), new THREE.Vector2(top.x + 1.2, top.y + 2.4), new THREE.Vector2(top.x + 1.2, 0));
    const standTex = stoneTex.clone(); standTex.needsUpdate = true; standTex.repeat.set(40, 6);
    const stands = new THREE.Mesh(new THREE.LatheGeometry(prof, 72), new THREE.MeshStandardMaterial({ map: standTex, color: 0x9d9384, roughness: 0.95, side: THREE.DoubleSide }));
    g.add(stands);
    // 門（4つ）と旗（8枚）
    const gateMat = new THREE.MeshBasicMaterial({ color: 0x07060a });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x6e6455, roughness: 0.9, flatShading: true });
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      const gg = new THREE.Group(); gg.position.set(Math.cos(a) * (WR - 0.05), 0, Math.sin(a) * (WR - 0.05)); gg.lookAt(0, 0, 0); g.add(gg);
      const hole = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 3.6), gateMat); hole.position.y = 1.8; gg.add(hole);
      const arch = new THREE.Mesh(new THREE.CircleGeometry(2.1, 20, 0, Math.PI), gateMat); arch.position.y = 3.6; arch.position.z = 0.001; gg.add(arch);
      [-2.45, 2.45].forEach((dx) => { const col = new THREE.Mesh(new THREE.BoxGeometry(0.7, 4.6, 0.5), frameMat); col.position.set(dx, 2.3, 0.2); gg.add(col); });
    }
    const flagCols = ['#c0392b', '#2e86de', '#f1c40f', '#27ae60'];
    for (let k = 0; k < 8; k++) {
      const a = ((k + 0.5) / 8) * Math.PI * 2;
      const tex = FX.canvasTex(64, 128, (c) => {
        c.fillStyle = flagCols[k % 4]; c.fillRect(0, 0, 64, 112);
        c.beginPath(); c.moveTo(0, 112); c.lineTo(32, 128); c.lineTo(64, 112); c.fill();
        c.strokeStyle = 'rgba(255,240,200,0.8)'; c.lineWidth = 3; c.beginPath(); c.arc(32, 52, 16, 0, Math.PI * 2); c.stroke();
        c.beginPath(); c.moveTo(32, 30); c.lineTo(32, 74); c.moveTo(10, 52); c.lineTo(54, 52); c.stroke();
      });
      const fl = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 3), new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.8, side: THREE.DoubleSide }));
      fl.position.set(Math.cos(a) * (WR - 0.08), 3.1, Math.sin(a) * (WR - 0.08)); fl.lookAt(0, 3.1, 0); g.add(fl);
    }
    // かがり火（8つ）
    const stand = new THREE.CylinderGeometry(0.22, 0.32, 1.3, 8), bowl = new THREE.CylinderGeometry(0.55, 0.3, 0.4, 10);
    const ironMat = new THREE.MeshStandardMaterial({ color: 0x3a3430, roughness: 0.6, metalness: 0.5 });
    for (let k = 0; k < 8; k++) {
      const a = ((k + 0.25) / 8) * Math.PI * 2, x = Math.cos(a) * (ARENA_R - 0.9), z = Math.sin(a) * (ARENA_R - 0.9);
      const s1 = new THREE.Mesh(stand, ironMat); s1.position.set(x, 0.65, z); g.add(s1);
      const b1 = new THREE.Mesh(bowl, ironMat); b1.position.set(x, 1.45, z); g.add(b1);
      const flame = FX.glowSprite('#ff9a3a', 2.4); flame.position.set(x, 1.95, z); g.add(flame);
      const halo = FX.glowSprite('#ff6a1a', 6); halo.position.set(x, 2, z); g.add(halo);
      const f = { glow: halo, flame, x, z, ph: k * 1.3 };
      fires.push(f); lamps.push(f);
    }
    // 床の模様（中央の円と、外まわりの線）
    const emb = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.MeshBasicMaterial({ map: FX.circleTex, color: 0xffb34a, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false }));
    emb.rotation.x = -Math.PI / 2; emb.position.y = 0.05; g.add(emb); decor.arenaEmblem = emb;
    const line = new THREE.Mesh(new THREE.RingGeometry(ARENA_R - 2.2, ARENA_R - 1.9, 96), new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.35, depthWrite: false }));
    line.rotation.x = -Math.PI / 2; line.position.y = 0.04; g.add(line);

    // 盾にできる地形（壊せる。対戦のたびに元どおり）
    const tangentWall = (a, r, len, rows) => {
      const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
      const tx = -Math.sin(a), tz = Math.cos(a);
      const rotY = Math.atan2(-tz, tx);
      buildWall(cx - tx * len / 2, cz - tz * len / 2, len, rows, rotY);
    };
    [45, 135, 225, 315].forEach((d) => tangentWall((d * Math.PI) / 180, 17, 7.5, 3));
    for (let k = 0; k < 8; k++) { const a = ((k + 0.5) / 8) * Math.PI * 2; buildPillarAt(Math.cos(a) * 27, Math.sin(a) * 27, k, k % 2 ? '#ffb34a' : '#ff6b6b'); }
    [[0, 1.9], [90, 1.6], [180, 1.9], [270, 1.6]].forEach(([d, r]) => { const a = (d * Math.PI) / 180; buildRock(Math.cos(a) * 9, Math.sin(a) * 9, r); });
    [45, 135, 225, 315].forEach((d) => {
      const a = (d * Math.PI) / 180, x = Math.cos(a) * 31, z = Math.sin(a) * 31;
      const c1 = buildCrate(x, z); buildCrate(x + 1.25, z + 0.3); const top2 = buildCrate(x + 0.6, z + 0.15, 1.1); top2.support = [c1];
    });
    if (W.phys) { props.forEach((o) => { if (o.alive && !o.body) makeBody(o); }); pillars.forEach((p) => pillarBodies(p)); }
  }

  function buildCrystals() {
    const crGeo = new THREE.OctahedronGeometry(1.4, 0);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.3, r = rand(68, 82);
      const col = new THREE.Color().setHSL(rand(0.5, 0.82), 0.8, 0.6);
      const m = new THREE.Mesh(crGeo, new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.7, flatShading: true, roughness: 0.3 }));
      m.scale.set(1, 1.8, 1);
      const y = rand(7, 14);
      m.position.set(Math.cos(a) * r, y, Math.sin(a) * r); decorP.add(m);
      const gl = FX.glowSprite('#' + col.getHexString(), 9); gl.position.copy(m.position); decorP.add(gl);
      crystals.push({ mesh: m, glow: gl, base: y, ph: i * 1.7 });
    }
  }

  // ---- ダメージ ----
  function chip(o, from) {
    W.stats.chips++;
    if (!(W.phys && isDynamicProp(o))) o.shake = 0.18;
    const c = o.mesh.position;
    const cols = o.kind === 'crate' ? ['#8a5c30', '#d0a070'] : ['#77706a', '#c8c0b0'];
    FX.emit(c.clone().lerp(from, 0.3), { count: 14, c1: cols[0], c2: cols[1], speed: 5, up: 3, gravity: 16, drag: 0.5, life: 0.9, size: 0.22 });
    const k = Math.max(0, o.hp / o.maxHp);
    if (o.kind === 'rock') {
      // 当たった側をけずる
      const local = o.mesh.worldToLocal(from.clone());
      const pos = o.mesh.geometry.attributes.position;
      const dir = local.clone().normalize();
      for (let i = 0; i < pos.count; i++) {
        const v = new V3(pos.getX(i), pos.getY(i), pos.getZ(i));
        const dd = v.clone().normalize().dot(dir);
        if (dd > 0.35) v.multiplyScalar(1 - (dd - 0.35) * 0.35);
        pos.setXYZ(i, v.x, v.y, v.z);
      }
      pos.needsUpdate = true; o.mesh.geometry.computeVertexNormals();
    } else if (!(W.phys && isDynamicProp(o))) {
      o.mesh.scale.copy(o.home.scale).multiplyScalar(0.92 + k * 0.08);
      o.mesh.rotation.z = o.home.rot.z + rand(-0.06, 0.06) * (1 - k);
    }
  }

  function destroyProp(o, from) {
    if (!o.alive) return;
    o.alive = false; o.respawn = o.respawnTime || 25;
    W.stats.destroyed++;
    if (o.label) o.label.visible = false;
    const c = o.mesh.position.clone();
    const away = c.clone().sub(from); away.y = 0; if (away.lengthSq() < 1e-4) away.set(0, 0, 1); away.normalize();
    if (o.kind === 'brick' && W.phys) {
      // 物理あり: レンガはそのまま本物の物体として飛んでいき、がれきとして残る（壁ごとにあとで元に戻る）
      PH.kick(o.body, { x: away.x * rand(4, 8), y: rand(3, 6), z: away.z * rand(4, 8) }, { x: rand(-5, 5), y: rand(-5, 5), z: rand(-5, 5) });
      o.wall.respawnAt = clock + (o.respawnTime || 25);
      FX.emit(c, { count: 18, c1: '#9a8a78', c2: '#d8c8b0', speed: 4, up: 2, life: 1.2, size: 0.7, alpha: 0.4, drag: 2 });
    } else if (o.kind === 'brick') {
      // レンガそのものが飛んでいく
      addDebris(o.mesh, away.clone().multiplyScalar(rand(4, 9)).add(new V3(0, rand(4, 8), 0)), 6, { half: 0.38 });
      o.mesh = o.mesh.clone(); o.mesh.visible = false;
      FX.emit(c, { count: 18, c1: '#9a8a78', c2: '#d8c8b0', speed: 4, up: 2, life: 1.2, size: 0.7, alpha: 0.4, drag: 2 });
    } else {
      if (o.body) { PH.remove(o.body); o.body = null; }
      o.mesh.visible = false;
      const stony = o.kind === 'rock' || o.kind === 'slab';
      const n = o.kind === 'slab' ? 12 : o.kind === 'rock' ? 8 : 6;
      for (let k = 0; k < n; k++) {
        let m;
        if (stony) { m = new THREE.Mesh(chunkGeo, rockMat); m.scale.setScalar(o.size * rand(0.22, 0.4)); }
        else { m = new THREE.Mesh(new THREE.BoxGeometry(o.size, 0.12, 0.22), woodMat); }
        m.position.copy(c).add(o.kind === 'slab' ? new V3(rand(-2.3, 2.3), rand(-1.6, 1.6), rand(-0.2, 0.2)) : new V3(rand(-0.5, 0.5), rand(-0.3, 0.5), rand(-0.5, 0.5)).multiplyScalar(o.size));
        const v = away.clone().multiplyScalar(rand(3, 8)).add(new V3(rand(-3, 3), rand(4, 9), rand(-3, 3)));
        addDebris(m, v, rand(4, 7), { half: stony ? m.scale.y * 0.8 : 0.08 });
      }
      FX.emit(c, { count: 40, c1: o.kind === 'crate' ? '#a87444' : '#8a8578', c2: '#e0d0b8', speed: 7, up: 3, gravity: 10, life: 1, size: 0.3 });
      FX.emit(c, { count: 16, c1: '#8a7a68', c2: '#c9b9a0', speed: 2, up: 1, life: 1.6, size: 1.4, alpha: 0.35, drag: 1.5 });
    }
    if (MG.Audio) MG.Audio.impact('earth', 2);
    // 支えを失ったものは崩れ落ちる（物理ありのときは、本物の重力で自然に崩れる）
    if (!W.phys) props.forEach((q) => {
      if (q.alive && q.support && q.support.length && q.support.every((s) => !s.alive)) setTimeout(() => destroyProp(q, q.mesh.position.clone().add(new V3(rand(-1, 1), 1, rand(-1, 1)))), 120);
    });
  }

  function hitPillar(p, dmg, from) {
    if (!p.alive) return;
    p.hp -= dmg;
    FX.emit(new V3(p.x, 3, p.z), { count: 16, c1: '#5d6380', c2: '#a0a8c8', speed: 5, up: 3, gravity: 14, life: 1, size: 0.3 });
    if (p.hp > 0) return;
    p.alive = false; p.respawn = 30;
    W.stats.destroyed++;
    const away = new V3(p.x - from.x, 0, p.z - from.z).normalize();
    (p.bodies || []).forEach((b) => PH.remove(b)); p.bodies = [];
    p.parts.forEach((part, k) => {
      const v = away.clone().multiplyScalar(2 + k * 2.2).add(new V3(rand(-1, 1), 1 + k * 0.6, rand(-1, 1)));
      addDebris(part.m, v, 30, { half: part.half * 0.8, keep: true, spin: 0.35 });
    });
    p.parts = [];
    scene.remove(p.lamp); p.glow.visible = false;
    FX.emit(new V3(p.x, 4, p.z), { count: 60, c1: '#7a7f98', c2: '#d0d4e8', speed: 4, up: 2, life: 2, size: 1.6, alpha: 0.35, drag: 1.2 });
    if (MG.Audio) MG.Audio.rumble(1.4);
  }

  // 破壊属性の魔法が当たった場所
  W.blast = function (p, radius, dmg, opts) {
    opts = opts || {};
    for (const o of props) {
      if (!o.alive) continue;
      const d = distToProp(o, p);
      if (d >= radius) continue;
      const amount = dmg * (1 - 0.5 * Math.max(0, d) / radius);
      o.hp -= amount;
      if (o.hp <= 0) destroyProp(o, p); else { chip(o, p); blastPush(o, p, radius, dmg); }
    }
    for (const pl of pillars) {
      if (!pl.alive) continue;
      const d = Math.hypot(pl.x - p.x, pl.z - p.z) - 1.2;
      if (d < radius && p.y < 9) hitPillar(pl, dmg * (1 - 0.5 * Math.max(0, d) / radius), p);
    }
    if (opts.crater !== false) {
      const gy = W.heightAt(p.x, p.z);
      if (p.y - gy < Math.max(1.5, radius * 0.6)) W.crater(p, opts.craterR || radius * 0.55);
    }
  };

  // 弾が地形にぶつかったか
  W.collide = function (pos, r, skip) {
    for (const o of props) {
      if (!o.alive || (skip && skip.has(o))) continue;
      if (o.kind === 'slab' ? inBox(pos, slabBox(o, r)) : o.mesh.position.distanceTo(pos) < o.r + r) return o;
    }
    for (const pl of pillars) {
      if (skip && skip.has(pl)) continue;
      if (pl.alive && Math.hypot(pl.x - pos.x, pl.z - pos.z) < 1.2 + r && pos.y < 7.6) return pl;
    }
    for (const so of solids) if (inBox(pos, solidBox(so, r))) return so;
    return null;
  };

  // 視線の先にある地形までの距離
  W.raycast = function (origin, dir, maxD, owner) {
    let best = maxD;
    if (owner !== undefined) { const bh = W.barrierOnSegment(origin, origin.clone().addScaledVector(dir, maxD), 0, owner); if (bh && bh.t > 0.05) best = bh.t; }
    const test = (c, r) => {
      const oc = c.clone().sub(origin); const tca = oc.dot(dir); if (tca < 0) return;
      const d2 = oc.lengthSq() - tca * tca; if (d2 > r * r) return;
      const t = tca - Math.sqrt(r * r - d2); if (t > 0 && t < best) best = t;
    };
    for (const o of props) if (o.alive) { if (o.kind === 'slab') { const t = rayBox(origin, dir, slabBox(o, 0)); if (t != null && t > 0 && t < best) best = t; } else test(o.mesh.position, o.r); }
    for (const p of pillars) if (p.alive) for (const y of [1.2, 3.5, 5.8]) test(new V3(p.x, y, p.z), 1.3);
    for (const so of solids) { const t = solidRay(origin, dir, so); if (t != null && t > 0 && t < best) best = t; }
    return best < maxD ? best : null;
  };

  // ======================================================================
  //  上に乗れる地形（第22版）: レンガ・木箱・薄い岩壁・魔法の壁は箱、岩は形そのもの、石柱は円柱として、
  //  上面の高さ（W.floorAt）と、横からめりこまないための押し戻し（W.pushOut）を計算する
  // ======================================================================
  const barriers = [];           // 障壁の魔法で立てた壁・ドーム（game.js が作って、ここに登録する）
  W.barriers = barriers;
  const STEP = 0.45;             // この高さまでなら、足もとより少し上の面にも立てる（段差）
  const _q = new THREE.Quaternion(), _lp = new V3(), _ray = new THREE.Raycaster(), _down = new V3(0, -1, 0), _o = new V3();
  function boxHalf(o) {
    if (o.half) return o.half;
    if (o.kind === 'brick') return [0.73, 0.36, 0.4];
    if (o.kind === 'crate') return [o.size / 2, o.size / 2, o.size / 2];
    if (o.kind === 'slab') return [LANE.w / 2, LANE.h / 2, LANE.t / 2];
    return null;
  }
  // 地形の中の座標（回転と大きさを戻す）
  function toLocal(o, x, y, z) {
    const m = o.mesh; _q.copy(m.quaternion).invert();
    _lp.set(x - m.position.x, y - m.position.y, z - m.position.z).applyQuaternion(_q);
    return _lp;
  }
  const boxTop = (o, h) => o.mesh.position.y + h[1] * o.mesh.scale.y;
  // 岩の上面の高さ（真上から下へ光線を当てて調べる。けずれた形にも合う）。上にないときは null
  function rockTop(o, x, z, fromY) {
    const c = o.mesh.position;
    if (Math.hypot(x - c.x, z - c.z) > o.r * 1.25) return null;
    o.mesh.updateMatrixWorld();
    _ray.set(_o.set(x, fromY, z), _down); _ray.far = fromY + 10;
    const hit = _ray.intersectObject(o.mesh, false)[0];
    return hit ? hit.point.y : null;
  }
  function pillarTop(p) { const cap = p.parts[3]; return cap ? cap.m.position.y + 0.35 : 7.6; }
  const solidBarriers = () => barriers.filter((b) => b.alive && b.shape === 'wall');

  // (x, z) で立てる面の高さ。y は今の足の高さ（これより STEP 以上高い面には乗れない）
  W.floorAt = function (x, z, y, pad) {
    pad = pad == null ? 0.25 : pad;
    let best = W.heightAt(x, z);
    const lim = (y == null ? 1e9 : y) + STEP;
    const tryTop = (t) => { if (t != null && t <= lim && t > best) best = t; };
    const testBox = (o, h) => {
      const l = toLocal(o, x, o.mesh.position.y, z);
      if (Math.abs(l.x) <= h[0] * o.mesh.scale.x + pad && Math.abs(l.z) <= h[2] * o.mesh.scale.z + pad) tryTop(boxTop(o, h));
    };
    for (const o of props) {
      if (!o.alive || o.vanish != null) continue;
      if (o.kind === 'rock') tryTop(rockTop(o, x, z, Math.min(lim, 60)));
      else { const h = boxHalf(o); if (h) testBox(o, h); }
    }
    for (const b of solidBarriers()) testBox(b, b.half);
    for (const p of pillars) if (p.alive && p.vanish == null && p.parts.length && Math.hypot(p.x - x, p.z - z) < 1.25 + pad * 0.5) tryTop(pillarTop(p));
    for (const so of solids) if (Math.abs(x - so.x) <= so.hx + pad && Math.abs(z - so.z) <= so.hz + pad) tryTop(so.y1);
    return best;
  };

  // プレイヤー（や召喚獣）が地形にめりこまないようにする。上に乗っているときは押し戻さない
  W.pushOut = function (pos, r) {
    const boxPush = (o, h) => {
      const top = boxTop(o, h);
      if (pos.y >= top - 0.05) return;
      if (pos.y + 1.7 < o.mesh.position.y - h[1] * o.mesh.scale.y) return;
      const l = toLocal(o, pos.x, pos.y, pos.z).clone();
      const ex = h[0] * o.mesh.scale.x + r, ez = h[2] * o.mesh.scale.z + r;
      if (Math.abs(l.x) >= ex || Math.abs(l.z) >= ez) return;
      const d = new V3();
      if (ex - Math.abs(l.x) < ez - Math.abs(l.z)) d.x = (l.x >= 0 ? ex : -ex) - l.x; else d.z = (l.z >= 0 ? ez : -ez) - l.z;
      d.applyQuaternion(o.mesh.quaternion);
      pos.x += d.x; pos.z += d.z;
    };
    for (const o of props) {
      if (!o.alive || o.vanish != null) continue;
      if (o.kind !== 'rock') { const h = boxHalf(o); if (h) boxPush(o, h); continue; }
      const c = o.mesh.position;
      const dx = pos.x - c.x, dz = pos.z - c.z, d = Math.hypot(dx, dz), min = o.col + r;
      if (d >= min || d < 1e-4) continue;
      // 岩の上に乗っている（足が岩の面より上）なら押し戻さない
      const t = rockTop(o, pos.x, pos.z, pos.y + 4);
      if (t != null ? pos.y >= t - 0.1 : pos.y > c.y + o.r * 0.9) continue;
      pos.x = c.x + (dx / d) * min; pos.z = c.z + (dz / d) * min;
    }
    for (const b of solidBarriers()) boxPush(b, b.half);
    for (const p of pillars) {
      if (!p.alive || p.vanish != null || !p.parts.length || pos.y >= pillarTop(p) - 0.05) continue;
      const dx = pos.x - p.x, dz = pos.z - p.z, d = Math.hypot(dx, dz), min = 1.15 + r;
      if (d < min && d > 1e-4) { pos.x = p.x + (dx / d) * min; pos.z = p.z + (dz / d) * min; }
    }
    for (const so of solids) {
      if (pos.y >= so.y1 - 0.05 || pos.y + 1.7 < so.y0) continue;
      const lx = pos.x - so.x, lz = pos.z - so.z, ex = so.hx + r, ez = so.hz + r;
      if (Math.abs(lx) >= ex || Math.abs(lz) >= ez) continue;
      if (ex - Math.abs(lx) < ez - Math.abs(lz)) pos.x = so.x + (lx >= 0 ? ex : -ex); else pos.z = so.z + (lz >= 0 ? ez : -ez);
    }
  };

  // ---- 障壁の魔法の壁・ドーム ----
  // b = { shape: 'wall' | 'dome', mesh, half（壁の半分の大きさ）, R（ドームの半径）, owner（立てた人）, alive }
  W.addBarrier = function (b) { b.alive = true; barriers.push(b); if (!b.mesh.parent) scene.add(b.mesh); return b; };
  W.removeBarrier = function (b) { b.alive = false; const i = barriers.indexOf(b); if (i >= 0) barriers.splice(i, 1); if (b.mesh.parent) b.mesh.parent.remove(b.mesh); };
  W.clearBarriers = function () { barriers.slice().forEach((b) => W.removeBarrier(b)); };
  function wallBox(b, pad) { // 壁の中の座標での箱
    const h = b.half; return { minX: -h[0] - pad, maxX: h[0] + pad, minY: -h[1] - pad, maxY: h[1] + pad, minZ: -h[2] - pad, maxZ: h[2] + pad };
  }
  // 線分 a→b が、owner 以外の障壁にかかるか（弾が通り抜けないように、動いた分の線分で調べる）。かかった障壁と、そこまでの距離を返す
  W.barrierOnSegment = function (a, bb, r, owner) {
    let best = null;
    const d = bb.clone().sub(a), len = d.length(); if (len < 1e-6) return null; d.normalize();
    for (const b of barriers) {
      if (!b.alive || b.owner === owner) continue;
      let t = null;
      if (b.shape === 'wall') {
        const la = toLocal(b, a.x, a.y, a.z).clone();
        const ld = d.clone().applyQuaternion(_q.copy(b.mesh.quaternion).invert());
        t = rayBox(la, ld, wallBox(b, r));
      } else {
        // ドーム: 球の面をまたいだところ（外から内でも、内から外でも）。地面より下は無し
        const c = b.mesh.position, R = b.R;
        const da = a.distanceTo(c), db = bb.distanceTo(c);
        if ((da < R) !== (db < R)) {
          const oc = a.clone().sub(c), bq = oc.dot(d), cq = oc.lengthSq() - R * R, disc = bq * bq - cq;
          if (disc >= 0) { const s = Math.sqrt(disc); const t1 = -bq - s, t2 = -bq + s; t = t1 >= 0 && t1 <= len ? t1 : t2 >= 0 && t2 <= len ? t2 : null; }
          if (t != null && a.y + d.y * t < c.y - 0.2) t = null;
        }
      }
      if (t != null && t <= len && (!best || t < best.t)) best = { barrier: b, t };
    }
    return best;
  };
  W.barriersNear = function (p, radius) {
    return barriers.filter((b) => b.alive && (b.shape === 'wall' ? b.mesh.position.distanceTo(p) < radius + Math.max(b.half[0], b.half[1]) : Math.abs(b.mesh.position.distanceTo(p) - b.R) < radius));
  };

  // ---- 消滅領域: 球の内側にあるものを跡形なく消す ----
  // 球の中心 c（Vector3）と半径 R。地形はその場で縮んで消え（破片は出ない）、地面は球の形にえぐれる
  W.erase = function (c, R) {
    let n = 0;
    for (const o of props) {
      if (!o.alive || o.vanish != null) continue;
      if (o.mesh.position.distanceTo(c) < R) { o.vanish = 0; n++; }
    }
    for (const p of pillars) {
      if (!p.alive || p.vanish != null) continue;
      // 石柱は、球が柱の一部でも包みこめば消える
      const dxz = Math.hypot(p.x - c.x, p.z - c.z);
      if (dxz < R + 0.6 && c.y - R < 6) { p.vanish = 0; n++; }
    }
    W.carveSphere(c, R);
    W.stats.erased += n;
    return n;
  };
  W.carveSphere = function (c, R) {
    const Rg = G_SEG + 1;
    const x0 = Math.max(0, Math.floor((c.x - R + G_HALF) / G_STEP)), x1 = Math.min(G_SEG, Math.ceil((c.x + R + G_HALF) / G_STEP));
    const z0 = Math.max(0, Math.floor((c.z - R + G_HALF) / G_STEP)), z1 = Math.min(G_SEG, Math.ceil((c.z + R + G_HALF) / G_STEP));
    if (x0 > x1 || z0 > z1) return false;
    let changed = false;
    for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) {
      const x = -G_HALF + ix * G_STEP, z = -G_HALF + iz * G_STEP;
      const d = Math.hypot(x - c.x, z - c.z);
      if (d >= R) continue;
      const edge = Math.max(0, Math.min(1, (G_HALF - Math.max(Math.abs(x), Math.abs(z))) / 8));
      const bottom = c.y - Math.sqrt(R * R - d * d);
      const i = iz * Rg + ix;
      const target = heights[i] + (Math.min(heights[i], bottom) - heights[i]) * edge;
      if (target < heights[i]) {
        heights[i] = Math.max(-6, target); changed = true;
        // 切り口はなめらかで、少しだけ青白い
        colors[i * 3] = Math.min(colors[i * 3], 0.78); colors[i * 3 + 1] = Math.min(colors[i * 3 + 1], 0.82); colors[i * 3 + 2] = Math.min(colors[i * 3 + 2], 0.95);
      }
    }
    if (!changed) return false;
    const cx0 = Math.floor(x0 / CH_SEG), cx1 = Math.min(CH - 1, Math.floor(x1 / CH_SEG));
    const cz0 = Math.floor(z0 / CH_SEG), cz1 = Math.min(CH - 1, Math.floor(z1 / CH_SEG));
    for (let cz = Math.max(0, cz0 - (z0 % CH_SEG === 0 ? 1 : 0)); cz <= cz1; cz++) for (let cx = Math.max(0, cx0 - (x0 % CH_SEG === 0 ? 1 : 0)); cx <= cx1; cx++) {
      const ch = chunks[cz * CH + cx]; detailChunk(ch); syncChunk(ch);
    }
    W.stats.carved++;
    if (W.phys) PH.rebuildGroundSoon(W.heightAt, G_SIZE);
    return true;
  };
  function finishVanish(o) {
    o.vanish = null;
    if (o.body) { PH.remove(o.body); o.body = null; }
    o.alive = false; o.respawn = o.respawnTime || 25;
    o.mesh.visible = false;
    if (o.wall) o.wall.respawnAt = clock + (o.respawnTime || 25);
    if (o.label) o.label.visible = false;
    W.stats.destroyed++;
    // 支えを失ったものは崩れ落ちる
    props.forEach((q) => {
      if (!W.phys && q.alive && q.vanish == null && q.support && q.support.length && q.support.every((s) => !s.alive)) setTimeout(() => destroyProp(q, q.mesh.position.clone().add(new V3(rand(-1, 1), 1, rand(-1, 1)))), 120);
    });
  }

  W.resetTerrain = function () {
    resetGround();
    if (W.phys) PH.setGround(W.heightAt, G_SIZE);
    for (let i = debris.length - 1; i >= 0; i--) removeDebris(i);
    if (W.phys) props.forEach((o) => { if (isDynamicProp(o) && o.alive && o.mesh.position.distanceTo(o.home.pos) > 0.05) restoreProp(o); });
    props.forEach((o) => { if (!o.alive || o.hp < o.maxHp) restoreProp(o); });
    pillars.forEach((p) => { if (!p.alive) restorePillar(p); else p.hp = p.maxHp; });
  };

  function restoreProp(o) {
    if (o.kind === 'rock') {
      // けずれた形を作り直す
      const r = o.size;
      const geo = new THREE.IcosahedronGeometry(r, 1); const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) { const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i); const k = 0.8 + prand(vx.toFixed(3) * 1, vy.toFixed(3) * 1, vz.toFixed(3) * 1) * 0.35; pos.setXYZ(i, vx * k, vy * k * 0.8, vz * k); }
      geo.computeVertexNormals(); o.mesh.geometry.dispose(); o.mesh.geometry = geo;
    }
    if (!o.mesh.parent) scene.add(o.mesh);
    o.mesh.visible = true;
    o.mesh.position.copy(o.home.pos); o.mesh.rotation.copy(o.home.rot); o.mesh.scale.copy(o.home.scale);
    o.hp = o.maxHp; o.alive = true; o.grow = 0; o.vanish = null;
    if (W.phys) {
      o.mesh.updateMatrixWorld();
      if (o.body && o.body.alive && isDynamicProp(o)) PH.teleport(o.body, o.home.pos, o.mesh.quaternion);
      else { if (o.body) PH.remove(o.body); makeBody(o); }
    }
    if (o.label) { o.label.visible = true; o.label.scale.setScalar(0.9); }
  }
  function restorePillar(p) {
    p.hp = p.maxHp; p.alive = true; p.build(); p.rise = 0;
    if (W.phys) pillarBodies(p);
  }

  W.update = function (dt, playerPos) {
    clock += dt;
    if (timeK !== timeTarget) {
      timeK += Math.sign(timeTarget - timeK) * Math.min(Math.abs(timeTarget - timeK), dt / 1.2);
      if (Math.abs(timeK - timeTarget) < 1e-6) timeK = timeTarget;
      applyTime(timeK);
    }
    if (W.phys && playerPos) PH.step(dt);
    if (playerPos || !W.phys) updateDebris(dt);
    if (W.phys) {
      for (const o of props) {
        if (!o.alive || !isDynamicProp(o) || o.vanish != null) continue;
        if (o.mesh.position.distanceTo(o.home.pos) > 0.6) {
          o.alive = false; o.respawn = o.respawnTime || 25; W.stats.destroyed++;
          if (o.wall) o.wall.respawnAt = clock + (o.respawnTime || 25);
        }
      }
      for (const w of walls) {
        if (!w.respawnAt || clock < w.respawnAt) continue;
        const near = playerPos && w.bricks.some((b) => b.home.pos.distanceTo(playerPos) < 3);
        if (near) continue;
        w.respawnAt = 0;
        w.bricks.forEach((b) => { if (b.vanish == null) restoreProp(b); });
      }
    }
    for (const o of props) {
      if (!o.alive) {
        if (W.phys && o.kind === 'brick') continue; // レンガは壁ごとに戻す
        o.respawn -= dt;
        if (o.respawn <= 0 && (!playerPos || o.home.pos.distanceTo(playerPos) > 3)) { restoreProp(o); o.grow = 0; }
        continue;
      }
      if (o.vanish != null) {
        o.vanish += dt;
        const k = Math.max(0.001, 1 - o.vanish / 0.6);
        o.mesh.scale.copy(o.home.scale).multiplyScalar(k * k);
        if (o.label) o.label.scale.setScalar(0.9 * k);
        if (o.vanish >= 0.6) finishVanish(o);
        continue;
      }
      if (o.grow != null && o.grow < 1) { o.grow = Math.min(1, o.grow + dt * 2); o.mesh.scale.copy(o.home.scale).multiplyScalar(Math.max(0.01, o.grow)); }
      if (o.shake > 0) {
        o.shake -= dt;
        o.mesh.position.copy(o.home.pos).add(new V3(rand(-1, 1), 0, rand(-1, 1)).multiplyScalar(o.shake * 0.3));
        if (o.shake <= 0) o.mesh.position.copy(o.home.pos);
      }
    }
    for (const p of pillars) {
      if (!p.alive) { p.respawn -= dt; if (p.respawn <= 0) restorePillar(p); continue; }
      if (p.vanish != null) {
        p.vanish += dt;
        const k = Math.max(0.001, 1 - p.vanish / 0.6);
        p.parts.forEach((pt) => pt.m.scale.setScalar(k * k)); p.lamp.scale.setScalar(k); p.glow.scale.setScalar(4.5 * k);
        if (p.vanish >= 0.6) {
          p.vanish = null; p.alive = false; p.respawn = 30; W.stats.destroyed++;
          (p.bodies || []).forEach((b) => PH.remove(b)); p.bodies = [];
          p.parts.forEach((pt) => scene.remove(pt.m)); p.parts = [];
          scene.remove(p.lamp); p.glow.visible = false; p.glow.scale.setScalar(4.5);
        }
        continue;
      }
      if (p.rise < 1) { p.rise = Math.min(1, p.rise + dt * 0.8); const off = (1 - p.rise) * -8; p.parts.forEach((pt, k) => (pt.m.position.y = (k < 3 ? 1.15 + k * 2.3 : 7.25) + off)); p.lamp.position.y = 8.4 + off; }
      const y = (p.rise < 1 ? (1 - p.rise) * -8 : 0) + 8.4 + Math.sin(clock * 2 + p.ph) * 0.15;
      p.lamp.position.y = y; p.glow.position.y = y;
    }
    for (const c of W.stage === 'practice' ? crystals : []) {
      const y = c.base + Math.sin(clock * 0.6 + c.ph) * 0.8;
      c.mesh.position.y = y; c.glow.position.y = y; c.mesh.rotation.y += dt * 0.4;
    }
    W.circle.rotation.z += dt * 0.05;
    if (W.practiceGate && W.stage === 'practice') W.practiceGate.rotation.z += dt * 0.8;
    if (W.stage === 'town') for (const a of townAnim) {
      if (a.blink) { a.blink.visible = Math.sin(clock * 2.5 + a.ph) > 0.3; continue; }
      a.m.rotation.z += dt * a.spin; if (a.fill) a.fill.material.opacity = 0.2 + Math.sin(clock * 2) * 0.06;
    }
    if (W.stage === 'dungeon') for (const a of dunAnim) {
      if (a.torch) { a.torch.scale.setScalar(3.2 * (1 + Math.sin(clock * 9 + a.ph) * 0.1 + Math.sin(clock * 23 + a.ph) * 0.05)); continue; }
      if (a.face) { if (playerPos) a.face.rotation.y = Math.atan2(playerPos.x - a.face.position.x, playerPos.z - a.face.position.z); continue; }
      a.m.rotation.z += dt * a.spin;
    }
    if (W.stage === 'arena') {
      for (const f of fires) { const k = 1 + Math.sin(clock * 9 + f.ph) * 0.12 + Math.sin(clock * 23 + f.ph * 2) * 0.06; f.flame.scale.setScalar(2.4 * k); f.glow.scale.setScalar(6 * k); }
      if (decor.arenaEmblem) decor.arenaEmblem.rotation.z -= dt * 0.04;
      if (Math.random() < 0.5 && fires.length) { const f = fires[(Math.random() * fires.length) | 0]; FX.emit(new V3(f.x, 2, f.z), { count: 1, c1: '#ff7a2a', c2: '#ffd24a', speed: 0.5, up: 2.2, jitter: 0.25, life: 0.7, size: 0.28, drag: 0.4 }); }
    }
    if (timeK > 0.5 && playerPos && Math.random() < 0.35 * timeK) {
      const a = rand(0, Math.PI * 2), r = rand(5, 60);
      FX.emit(new V3(playerPos.x + Math.cos(a) * r, rand(0.3, 3), playerPos.z + Math.sin(a) * r), { count: 1, c1: '#d8ff7a', c2: '#7affd8', speed: 0.4, life: rand(2, 4), size: 0.18, drag: 0.2, alpha: 0.9 });
    }
  };

  W.follow = function (camPos) { sky.position.copy(camPos); };

  W.info = () => ({
    barriers: barriers.filter((b) => b.alive).map((b) => ({ shape: b.shape, owner: b.owner, x: Math.round(b.mesh.position.x * 100) / 100, y: Math.round(b.mesh.position.y * 100) / 100, z: Math.round(b.mesh.position.z * 100) / 100 })),
    props: props.length, alive: props.filter((o) => o.alive).length, debris: debris.length,
    pillars: pillars.filter((p) => p.alive).length, mode: W.mode, timeK, stats: Object.assign({}, W.stats), stage: W.stage, bound: W.bound(), solids: solids.length, sky: sky ? sky.visible : true, signs: Object.assign({}, W.signs),
    minHeight: heights ? Math.min.apply(null, Array.from(heights)) : 0,
    kinds: props.reduce((a, o) => { a[o.kind] = (a[o.kind] || 0) + 1; return a; }, {}),
    phys: W.phys, bodies: PH.bodyCount, active: W.phys ? PH.activeCount() : 0, physDebris: debris.filter((d) => d.body).length,
  });
  W.propList = () => props;
  // 動作確認用: 指定した場所に石を1つ落とす
  W.testDrop = function (x, y, z, r) { const m = new THREE.Mesh(chunkGeo, rockMat); m.scale.setScalar(r || 0.4); m.position.set(x, y, z); addDebris(m, new V3(0, 0, 0), 20); return m; };
  W.pillarList = () => pillars;

  // 練習場の北の端に、街へ戻る門と看板（第27版）
  function buildPracticeGate() {
    signStage = 'practice';
    const stone = new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.85, flatShading: true });
    const z = 49.5;
    [-1, 1].forEach((sd) => { const p = new THREE.Mesh(new THREE.BoxGeometry(1.2, 6, 1.2), stone); p.position.set(sd * 3.2, 3, z); decorP.add(p); });
    const top = new THREE.Mesh(new THREE.BoxGeometry(7.8, 1, 1.4), stone); top.position.set(0, 6.4, z); decorP.add(top);
    const m = new THREE.Mesh(new THREE.CircleGeometry(2.6, 40), new THREE.MeshBasicMaterial({ map: FX.circleTex, color: 0xffc860, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    m.position.set(0, 3, z); decorP.add(m); W.practiceGate = m;
    const gl = FX.glowSprite('#ffc860', 7); gl.position.set(0, 3, z); decorP.add(gl);
    const sign = makeSignboard('街へ戻る', { sub: 'TO TOWN', w: 3, h: 1.1, posts: 1.1 }); sign.position.set(5.6, 0, 46); sign.rotation.y = Math.PI - 0.3; decorP.add(sign);
  }
  W.build = function (sc, rd) {
    scene = sc; renderer = rd;
    scene.fog = new THREE.FogExp2(0x0a1030, 0.0145);
    decorP = new THREE.Group(); decor.practice = decorP; scene.add(decorP);
    buildSky();
    buildGround();
    makeMaterials();
    buildProps();
    buildPillars();
    buildCrystals();
    buildPracticeGate();
    hemi = new THREE.HemisphereLight(0x8c9cff, 0x1a1030, 0.75); scene.add(hemi);
    dirLight = new THREE.DirectionalLight(0xb8c6ff, 0.75); scene.add(dirLight);
    amb = new THREE.AmbientLight(0x30305a, 0.35); scene.add(amb);
    applyTime(timeK);
  };
})();
