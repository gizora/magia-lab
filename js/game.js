// ゲーム本体: 3D の世界、プレイヤー、的、魔法の発動と当たり判定
(function () {
  'use strict';
  const MG = window.MG, FX = MG.FX, AU = MG.Audio, W = MG.World, H = MG.Haptics, PH = MG.Phys, EF = MG.Efk;
  const rgbOf = (hex) => { const c = new THREE.Color(hex); return [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)]; };
  const V3 = THREE.Vector3;
  const G = (MG.Game = {});

  const ARENA = 54;          // 動ける範囲（半径）
  const EYE = 1.65;          // 目の高さ
  // 的は前方に横一列。壊れたら同じ場所に復活する
  const ROW_Z = -2;
  const ROW = [
    { x: -15, type: 'dummy' }, { x: -10, type: 'floater' }, { x: -5, type: 'slider' }, { x: 0, type: 'golem' },
    { x: 5, type: 'slider' }, { x: 10, type: 'floater' }, { x: 15, type: 'dummy' },
    { x: W.LANE.x, z: W.LANE.target, type: 'dummy', lane: true }, // 貫通テスト場の一番奥
  ];
  const TARGET_N = ROW.length;
  const UP = new V3(0, 1, 0);

  let renderer, scene, camera, clockLast = 0;
  let wand, wandGem, wandGlow, wandTip, castCircle, aimMarker, wandInner, wandModel, handGlow, buildGroup;
  const buildRings = [];
  const targets = [], projs = [], fields = [], beams = [], bolts = [], spikes = [], timers = [], specials = [];

  const player = { pos: new V3(0, 0, 16), vy: 0, yaw: 0, pitch: -0.05, onGround: true, walk: 0, kv: new V3() };

  // ---- 対戦 ----
  // 相手のプレイヤーと自分を「的（player 型）」として targets に入れ、すべての魔法の当たり判定をそのまま使う。
  // ダメージは「撃った人の画面で当たった」ときに決まり、相手に送られる（G.onPlayerHit）。受けた側は G.applyHit で HP を減らす。
  // 相手の魔法は、自分の画面では見た目だけ再現する（spec.remote。ダメージは出さない）。
  const PLAYER_HP = 200, RESPAWN_SEC = 4, PROTECT_SEC = 2.5;
  const SPAWNS = [[0, 33, 0], [0, -33, Math.PI], [33, 0, Math.PI / 2], [-33, 0, -Math.PI / 2]]; // 闘技場の復活地点 x, z, 向き（中央を向く）
  // 守り・回復の状態（練習場でも対戦でも使う）: 障壁の残り・時間、守護（ダメージ半減）の時間、じわじわ回復
  // 飛翔（flyT 秒、時間切れのあとは glide でゆっくり降りる）、纏い（auraT 秒、足が速くなり、まわりの的にダメージ）、迅速（hasteT 秒、足が速い）
  const SUP = (G.sup = { shield: 0, shieldMax: 0, shieldT: 0, shieldSpec: null, hitT: 0, guardT: 0, regen: 0, regenT: 0, healed: 0, warps: 0, breaks: 0,
    flyT: 0, flyMax: 0, flySpec: null, glide: false, flights: 0, auraT: 0, auraMax: 0, auraSpec: null, auraTick: 0, auraZap: 0, auraHits: 0, hasteT: 0 });
  const FLY_MAX_H = 32;   // 飛翔で上がれる高さ（地面から）
  const FLY_SPEED = 1.3;  // 飛翔中の横の速さ（倍）
  const HASTE_MUL = 1.35; // 迅速の足の速さ（倍）
  const STAMINA = { max: 100, run: 24, jump: 14, regen: 20, delay: 0.8 }; // スタミナ（第28版）: 走ると 1 秒に 24、ジャンプで 14 減り、休むと 1 秒に 20 戻る
  const JUMP_V = 8.6;     // ジャンプの勢い（約 1.85m 跳べる。木箱・2段の壁・小さめの岩に跳び乗れる）
  const ZAPPY = { lightning: 1, plasma: 1, magnet: 1 }; // 纏いで小さな稲妻が走る属性
  let lastHitFrom = null; // 今受けているダメージを撃った人（障壁の波紋を、その方向から広げるため）
  function resetSup() {
    SUP.shield = 0; SUP.shieldMax = 0; SUP.shieldT = 0; SUP.shieldSpec = null; SUP.shieldShape = null; SUP.guardT = 0; SUP.regen = 0; SUP.regenT = 0;
    SUP.flyT = 0; SUP.flyMax = 0; SUP.flySpec = null; SUP.glide = false; SUP.auraT = 0; SUP.auraMax = 0; SUP.auraSpec = null; SUP.hasteT = 0;
  }
  const M = (G.match = { on: false, myId: null, hp: PLAYER_HP, maxHp: PLAYER_HP, alive: true, deadT: 0, prot: 0, slowT: 0, slowHard: false, vulnT: 0, burnT: 0, burnDps: 0, burnAcc: 0, burnFrom: null, burnSpell: '', lastFrom: null, respawnSec: RESPAWN_SEC, hurtT: 0 });
  const avatars = new Map(); // ID → 相手の的
  let selfT = null;          // 自分の的（見えない）
  let CTX = null;            // 相手の魔法を再現している間だけ: { pos, tip, aim }。発動の位置や向きを、自分ではなく相手のものにする
  const casterPos = () => (CTX ? CTX.pos : player.pos);
  const input = { keys: {}, locked: false, mouseDown: false, touch: false, move: { x: 0, y: 0 } };

  const st = (G.state = {
    running: false, paused: true, time: 0, score: 0, kills: 0,
    mp: 150, mpMax: 150, mpRegen: 15, stamina: 100, staminaMax: 100, stamT: 0, tired: false, slot: 0, slots: [null, null, null, null], cds: [0, 0, 0, 0, 0], gcd: 0,
    wand: 'novice', slotsByWand: {}, charges: {}, build: { words: [], state: 'idle', t: 0, need: false, progress: 0 },
    combo: 0, comboT: 0, challenge: null, shake: 0, recoil: 0, castGlow: 0, lastCast: null,
  });

  const rand = (a, b) => a + Math.random() * (b - a);
  // 音が鳴った場所 → 左右の位置と音量
  const _ap = new V3(), _right = new V3();
  function ap(p) {
    if (!camera || !p) return null;
    _ap.copy(p).sub(camera.position);
    const d = _ap.length();
    _right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    return { pan: d > 0.5 ? (_ap.dot(_right) / d) * 0.85 : 0, vol: 1 / (1 + d / 22) };
  }
  // 遠いほど揺れを弱くする
  const near = (p) => (camera && p ? Math.max(0.12, 1 - p.distanceTo(camera.position) / 55) : 1);
  const after = (sec, fn) => timers.push({ t: st.time + sec, fn });
  const colorsOf = (spec) => spec.colors || ['#ffffff', '#ffffff'];

  // ======================================================================
  //  世界をつくる
  // ======================================================================
  function buildWorld() { W.build(scene, renderer); }

  // ---- 杖（一人称の手元） ----
  // 障壁の球の見た目: 六角形の網目が光り、ふちが明るい。当たると、当たった所が白く光って波紋が広がる。残りが少ないと、ひびの入ったマスが点滅する
  const WARD_VS = `
    varying vec3 vP; varying vec3 vVN;
    void main() { vP = normalize(position); vVN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
  const WARD_FS = `
    uniform vec3 uColor; uniform float uTime; uniform float uAlpha; uniform float uHit; uniform vec3 uHitDir; uniform float uLow;
    varying vec3 vP; varying vec3 vVN;
    float hexDist(vec2 p) { p = abs(p); return max(dot(p, vec2(0.5, 0.8660254)), p.x); }
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main() {
      float u = atan(vP.z, vP.x) / 6.2831853 + 0.5;
      float v = acos(clamp(vP.y, -1.0, 1.0)) / 3.1415927;
      vec2 p = vec2(u * 26.0, v * 13.0);
      vec2 r = vec2(1.0, 1.7320508); vec2 h = r * 0.5;
      vec2 a = mod(p, r) - h; vec2 b = mod(p - h, r) - h;
      vec2 gv = dot(a, a) < dot(b, b) ? a : b;
      vec2 id = p - gv;
      float edge = smoothstep(0.40, 0.49, hexDist(gv));
      float rim = pow(1.0 - abs(vVN.z), 2.0);
      float ang = acos(clamp(dot(vP, uHitDir), -1.0, 1.0));
      float dd = (ang - (1.0 - uHit) * 2.4) * 5.0;
      float wave = uHit * exp(-dd * dd);
      float spot = uHit * (1.0 - smoothstep(0.0, 0.9, ang));
      float rnd = hash(id);
      float crack = uLow * step(rnd, 0.55) * (0.55 + 0.45 * sin(uTime * 23.0 + rnd * 40.0));
      float pulse = 0.85 + 0.15 * sin(uTime * 3.0 + v * 9.0);
      float al = 0.05 + rim * 0.5 + edge * (0.22 + rim * 0.35) * pulse + wave * 0.9 + spot * edge * 0.8 + crack * edge * 0.9;
      vec3 col = mix(uColor, vec3(1.0), clamp(edge * 0.25 + wave * 0.8 + spot * edge * 0.6 + crack * edge * 0.7, 0.0, 1.0));
      gl_FragColor = vec4(col, clamp(al * uAlpha, 0.0, 1.0));
    }`;
  function makeWardMesh(radius, color) {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uTime: { value: 0 }, uAlpha: { value: 0 }, uHit: { value: 0 }, uHitDir: { value: new V3(0, 0, 1) }, uLow: { value: 0 } },
      vertexShader: WARD_VS, fragmentShader: WARD_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 40, 28), mat);
    m.renderOrder = 6;
    return m;
  }
  // 障壁がこわれる: ガラスのような破片が飛び散る
  let shardGeo = null;
  function shatterFx(center, color, radius) {
    if (!shardGeo) shardGeo = new THREE.TetrahedronGeometry(0.09, 0);
    const c1 = new THREE.Color(color), shards = [];
    for (let i = 0; i < 46; i++) {
      const d = new V3(rand(-1, 1), rand(-0.6, 1), rand(-1, 1)).normalize();
      const m = new THREE.Mesh(shardGeo, new THREE.MeshBasicMaterial({ color: c1.clone().lerp(new THREE.Color(0xffffff), rand(0.2, 0.7)), transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.position.copy(center).addScaledVector(d, radius); m.scale.setScalar(rand(0.6, 1.6)); m.rotation.set(rand(0, 6), rand(0, 6), rand(0, 6));
      scene.add(m);
      shards.push({ m, v: d.multiplyScalar(rand(3, 7)).add(new V3(0, rand(1, 3), 0)), s: new V3(rand(-9, 9), rand(-9, 9), rand(-9, 9)) });
    }
    FX.emit(center, { count: 60, c1: color, c2: '#ffffff', speed: 6, life: 0.5, size: 0.25, drag: 3 });
    FX.flash(center, color, 4, 12, 0.25);
    AU.impact('crystal', 3, ap(center));
    let t = 0;
    special((dt) => {
      t += dt;
      const k = Math.max(0, 1 - t / 1.1);
      shards.forEach((s) => { s.v.y -= 9 * dt; s.m.position.addScaledVector(s.v, dt); s.m.rotation.x += s.s.x * dt; s.m.rotation.y += s.s.y * dt; s.m.material.opacity = k; });
      if (t >= 1.1) { shards.forEach((s) => { scene.remove(s.m); s.m.material.dispose(); }); return false; }
      return true;
    }, shards.map((s) => s.m));
  }

  // 杖の形: 杖ごとに、柄の太さ・長さ・色と、先の飾りを大きく変える（色を見なくても区別できるように）
  // 戻り値の Group は柄の向きが +Y。userData に gem（宝石・魔法の色に光る）, glow, tip（魔法が出る点）, base（柄の下端の高さ）, glowK（光の大きさ）
  function makeWandModel(id, gemColor) {
    const g = new THREE.Group();
    const std = (color, o) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.6, metalness: 0.1 }, o || {}));
    const add = (geo, mat, x, y, z, rx, ry, rz) => { const m = new THREE.Mesh(geo, mat); m.position.set(x || 0, y || 0, z || 0); m.rotation.set(rx || 0, ry || 0, rz || 0); g.add(m); return m; };
    const ring = (r, t, y, color, o) => add(new THREE.TorusGeometry(r, t, 6, 20), std(color, Object.assign({ metalness: 0.85, roughness: 0.3 }, o)), 0, y, 0, Math.PI / 2);
    const gemMat = new THREE.MeshBasicMaterial({ color: gemColor || 0x7fd8ff });
    let gem, tipY, base = -0.31, glowK = 1;
    if (id === 'destruction') {
      // 破壊の杖: 黒く太い柄、鉄の輪、先に赤いとげ4本と大きな宝石
      add(new THREE.CylinderGeometry(0.027, 0.037, 0.58, 8), std(0x1c1012, { roughness: 0.45, metalness: 0.35 }), 0, -0.02);
      ring(0.036, 0.009, -0.17, 0x55555e); ring(0.031, 0.009, 0.16, 0x55555e);
      add(new THREE.CylinderGeometry(0.055, 0.03, 0.07, 10), std(0x2a2226, { metalness: 0.6, roughness: 0.35 }), 0, 0.3);
      const spikeMat = std(0x9a1414, { metalness: 0.5, roughness: 0.35, emissive: 0x3a0000 });
      for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI * 2 + Math.PI / 4; const s = add(new THREE.ConeGeometry(0.017, 0.17, 6), spikeMat, Math.cos(a) * 0.052, 0.38, Math.sin(a) * 0.052); s.rotation.set(Math.sin(a) * 0.45, 0, -Math.cos(a) * 0.45); }
      gem = add(new THREE.OctahedronGeometry(0.06, 0), gemMat, 0, 0.385); gem.scale.set(1, 1.25, 1);
      tipY = 0.43; base = -0.31; glowK = 1.8;
    } else if (id === 'sage') {
      // 賢者の杖: 長い白木に緑のつるが巻きつき、先に金の輪と葉2枚
      add(new THREE.CylinderGeometry(0.014, 0.023, 0.8, 8), std(0xe0cf9f, { roughness: 0.75 }), 0, -0.05);
      const pts = []; for (let i = 0; i <= 60; i++) { const f = i / 60, a = f * Math.PI * 7; pts.push(new THREE.Vector3(Math.cos(a) * 0.024, -0.4 + f * 0.7, Math.sin(a) * 0.024)); }
      g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 90, 0.0055, 5), std(0x3f9a4a, { roughness: 0.7 })));
      add(new THREE.TorusGeometry(0.065, 0.008, 6, 28), std(0xf0e2b0, { metalness: 0.8, roughness: 0.25 }), 0, 0.44);
      const leafMat = std(0x4fbf5a, { roughness: 0.6, side: THREE.DoubleSide });
      [-1, 1].forEach((sd) => { const l = add(new THREE.SphereGeometry(1, 10, 6), leafMat, sd * 0.05, 0.35, 0, 0, sd * 0.6, sd * -0.95); l.scale.set(0.026, 0.07, 0.006); });
      gem = add(new THREE.SphereGeometry(0.032, 14, 10), gemMat, 0, 0.44);
      tipY = 0.44; base = -0.45; glowK = 1.25;
    } else if (id === 'gale') {
      // 疾風の杖: 細い柄、先に三日月の飾りと、左右に広がる2枚の羽根
      add(new THREE.CylinderGeometry(0.012, 0.019, 0.6, 8), std(0x56808a, { metalness: 0.3, roughness: 0.4 }), 0, -0.01);
      ring(0.02, 0.005, -0.22, 0xdff6ff); ring(0.019, 0.005, -0.19, 0xdff6ff); ring(0.018, 0.005, -0.16, 0xdff6ff);
      add(new THREE.TorusGeometry(0.06, 0.009, 6, 24, Math.PI * 1.25), std(0xe6fff8, { metalness: 0.7, roughness: 0.25 }), 0, 0.35, 0, 0, 0, -Math.PI * 1.125);
      const fs2 = new THREE.Shape(); fs2.moveTo(0, 0); fs2.quadraticCurveTo(0.05, 0.03, 0.15, 0.12); fs2.quadraticCurveTo(0.06, 0.07, 0, 0.035); fs2.lineTo(0, 0);
      const featherMat = std(0xf2fffb, { roughness: 0.8, side: THREE.DoubleSide, emissive: 0x204840, emissiveIntensity: 0.4 });
      [-1, 1].forEach((sd) => { const f = add(new THREE.ShapeGeometry(fs2), featherMat, sd * 0.012, 0.24, 0); f.scale.set(sd * 1.5, 1.5, 1.5); f.rotation.y = sd * 1.05; });
      gem = add(new THREE.SphereGeometry(0.027, 12, 8), gemMat, 0, 0.35); gem.scale.set(1, 1.35, 1);
      tipY = 0.38; base = -0.31; glowK = 1;
    } else if (id === 'pierce') {
      // 貫きの杖: 紫の金属の柄、銀の輪と鍔、先に槍のような細長い結晶
      add(new THREE.CylinderGeometry(0.014, 0.021, 0.64, 8), std(0x31264f, { metalness: 0.55, roughness: 0.35 }), 0, -0.01);
      ring(0.022, 0.006, -0.2, 0xc8ccdf); ring(0.02, 0.006, 0, 0xc8ccdf); ring(0.019, 0.006, 0.18, 0xc8ccdf);
      add(new THREE.BoxGeometry(0.13, 0.014, 0.024), std(0xc8ccdf, { metalness: 0.9, roughness: 0.25 }), 0, 0.31);
      gem = add(new THREE.OctahedronGeometry(0.034, 0), gemMat, 0, 0.44); gem.scale.set(0.8, 3.8, 0.8);
      tipY = 0.56; base = -0.33; glowK = 1;
    } else {
      // 見習いの杖: 茶色の木、革の持ち手、金の輪、小さな宝石
      add(new THREE.CylinderGeometry(0.016, 0.026, 0.62, 8), std(0x6a3f1e, { roughness: 0.65 }));
      add(new THREE.CylinderGeometry(0.03, 0.03, 0.17, 8), std(0x2b170a, { roughness: 0.9 }), 0, -0.19);
      ring(0.027, 0.008, 0.26, 0xd8b25a);
      gem = add(new THREE.IcosahedronGeometry(0.038, 0), gemMat, 0, 0.34);
      tipY = 0.36; base = -0.31; glowK = 1;
    }
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: FX.glowTex, color: gemColor || 0x7fd8ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    glow.position.copy(gem.position); glow.scale.setScalar(0.25 * glowK); g.add(glow);
    const tip = new THREE.Object3D(); tip.position.y = tipY; g.add(tip);
    g.userData = { id, gem, glow, tip, base, glowK, parts: g.children.length };
    return g;
  }
  function disposeTree(o) { o.traverse((c) => { if (c.geometry) c.geometry.dispose(); if (c.material && c.material.dispose) c.material.dispose(); }); }

  function buildWand() {
    wand = new THREE.Group();
    const inner = new THREE.Group();
    inner.rotation.set(-1.25, 0.1, 0.32);
    wand.add(inner);
    wandInner = inner;
    setWandModel('novice');
    wand.scale.setScalar(0.62);
    wand.position.set(0.3, -0.3, -0.6);
    camera.add(wand);

    // 素手のときに光る手もと
    handGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: FX.glowTex, color: 0xbfe6ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    handGlow.position.set(0.18, -0.24, -0.6); handGlow.scale.setScalar(0.16); handGlow.visible = false;
    camera.add(handGlow);
    // 詠唱中に組み上がっていく魔法陣（ことば1つごとに輪が1つ増える）
    buildGroup = new THREE.Group(); buildGroup.position.set(0, -0.06, -1.5); buildGroup.visible = false;
    camera.add(buildGroup);
    const core = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.32), new THREE.MeshBasicMaterial({ map: FX.circleTex, color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    buildGroup.add(core); buildGroup.userData.core = core;
    [[0.17, 0.195], [0.25, 0.27], [0.33, 0.345], [0.41, 0.425]].forEach(([a, b], i) => {
      const ring = new THREE.Mesh(new THREE.RingGeometry(a, b, 64, 1, 0, Math.PI * 2 * (i % 2 ? 0.92 : 1)), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide }));
      const rune = new THREE.Mesh(new THREE.PlaneGeometry(b * 2.25, b * 2.25), new THREE.MeshBasicMaterial({ map: FX.circleTex, color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      const g = new THREE.Group(); g.add(ring); g.add(rune); buildGroup.add(g);
      buildRings.push({ g, ring, rune, on: 0 });
    });

    castCircle = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.6), new THREE.MeshBasicMaterial({ map: FX.circleTex, color: 0x7fd8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    castCircle.position.set(0.22, -0.12, -1.1);
    camera.add(castCircle);

    aimMarker = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: FX.circleTex, color: 0xffffff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    aimMarker.rotation.x = -Math.PI / 2; aimMarker.visible = false;
    scene.add(aimMarker);

  }

  // ======================================================================
  //  的
  // ======================================================================
  const TYPES = {
    dummy:   { hp: 40,  pts: 100, r: 1.05, cy: 1.65, weight: 4, label: '木の的' },
    slider:  { hp: 40,  pts: 150, r: 1.05, cy: 1.9,  weight: 3, label: '台座の的' },
    floater: { hp: 28,  pts: 200, r: 0.95, cy: 0,    weight: 3, label: '浮遊水晶' },
    golem:   { hp: 170, pts: 500, r: 1.75, cy: 1.9,  weight: 1, label: '石像ゴーレム' },
    player:  { hp: PLAYER_HP, pts: 0, r: 0.8, cy: 1.0, weight: 0, label: 'プレイヤー' },
  };
  let targetTex = null;
  function getTargetTex() {
    if (targetTex) return targetTex;
    targetTex = FX.canvasTex(256, 256, (g, w) => {
      const c = w / 2;
      const cols = ['#e9dcc0', '#b0322e', '#e9dcc0', '#b0322e', '#ffd45a'];
      cols.forEach((cl, i) => { g.fillStyle = cl; g.beginPath(); g.arc(c, c, c * (1 - i * 0.2), 0, Math.PI * 2); g.fill(); });
      g.strokeStyle = 'rgba(60,30,10,0.6)'; g.lineWidth = 3;
      for (let i = 0; i < 5; i++) { g.beginPath(); g.arc(c, c, c * (1 - i * 0.2) - 1, 0, Math.PI * 2); g.stroke(); }
    });
    return targetTex;
  }

  function makeTarget(type, home) {
    const T = TYPES[type];
    const g = new THREE.Group();
    const mats = [];
    const std = (o) => { const m = new THREE.MeshStandardMaterial(o); m.userData.baseEmissive = new THREE.Color(o.emissive || 0x000000); m.userData.baseInt = o.emissiveIntensity == null ? 1 : o.emissiveIntensity; mats.push(m); return m; };
    let face = null, floatY = 0;
    if (type === 'dummy' || type === 'slider') {
      const wood = std({ color: 0x7a5232, roughness: 0.85 });
      if (type === 'dummy') {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.15, 1.65, 8), wood); post.position.y = 0.82; g.add(post);
        const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.18, 8), wood); foot.position.y = 0.09; g.add(foot);
      } else {
        const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.05, 0.3, 12), std({ color: 0x2e3a66, emissive: 0x2a7fff, emissiveIntensity: 0.35, roughness: 0.6 }));
        ped.position.y = 0.15; g.add(ped);
        const rune = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), new THREE.MeshBasicMaterial({ map: FX.circleTex, color: 0x4fa8ff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
        rune.rotation.x = -Math.PI / 2; rune.position.y = 0.32; g.add(rune);
      }
      face = new THREE.Group(); face.position.y = T.cy; g.add(face);
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.16, 32), [wood, std({ map: getTargetTex(), color: 0xffffff, roughness: 0.7 }), std({ map: getTargetTex(), color: 0xffffff, roughness: 0.7 })]);
      disc.rotation.x = Math.PI / 2; face.add(disc);
    } else if (type === 'floater') {
      floatY = rand(3.5, 6.5);
      face = new THREE.Group(); g.add(face);
      const cr = new THREE.Mesh(new THREE.OctahedronGeometry(0.85, 0), std({ color: 0xd9a8ff, emissive: 0x8a3cff, emissiveIntensity: 0.9, flatShading: true, roughness: 0.25, metalness: 0.1 }));
      cr.scale.set(1, 1.4, 1); face.add(cr);
      const gl = FX.glowSprite('#b77bff', 4); face.add(gl);
    } else if (type === 'golem') {
      const stone = std({ color: 0x6d6f86, roughness: 0.95, flatShading: true });
      face = new THREE.Group(); g.add(face);
      const body = new THREE.Mesh(new THREE.BoxGeometry(2.1, 2.0, 1.4), stone); body.position.y = 1.8; face.add(body);
      const head = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.0, 1.0), stone); head.position.y = 3.3; face.add(head);
      const legGeo = new THREE.BoxGeometry(0.7, 0.9, 0.8);
      [-0.55, 0.55].forEach((x) => { const l = new THREE.Mesh(legGeo, stone); l.position.set(x, 0.45, 0); face.add(l); });
      const armGeo = new THREE.BoxGeometry(0.6, 1.7, 0.7);
      [-1.4, 1.4].forEach((x) => { const a = new THREE.Mesh(armGeo, stone); a.position.set(x, 1.7, 0); face.add(a); });
      const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffa040 });
      [-0.25, 0.25].forEach((x) => { const e = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.05), eyeMat); e.position.set(x, 3.38, 0.51); face.add(e); });
      const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), new THREE.MeshBasicMaterial({ color: 0xff8a30 })); core.position.set(0, 1.95, 0.72); face.add(core);
    }
    // HP バー
    const bc = document.createElement('canvas'); bc.width = 128; bc.height = 16;
    const btex = new THREE.CanvasTexture(bc);
    const bar = new THREE.Sprite(new THREE.SpriteMaterial({ map: btex, depthTest: false, transparent: true }));
    bar.scale.set(1.8, 0.22, 1); bar.renderOrder = 20; bar.visible = false;
    const barY = type === 'golem' ? 4.3 : type === 'floater' ? 1.9 : T.cy + 1.4;
    bar.position.y = barY;
    g.add(bar);
    const t = {
      type, T, group: g, face, mats, hp: T.hp, maxHp: T.hp, r: T.r, pts: T.pts,
      home: home.clone(), pos: home.clone(), center: new V3(), floatY,
      phase: rand(0, 10), moveDir: new V3(1, 0, 0).applyAxisAngle(UP, rand(0, Math.PI * 2)),
      disp: new V3(), dispV: new V3(), mass: type === 'golem' ? 0.35 : 1,
      burnT: 0, burnDps: 0, burnAcc: 0, burnPop: 0, freezeT: 0, frozenHard: false, vulnT: 0, flash: 0,
      alive: true, dead: 0, spawnT: 0, bar, bc, btex, id: Math.random().toString(36).slice(2, 8),
    };
    g.position.copy(home);
    g.scale.setScalar(0.01);
    scene.add(g);
    updateCenter(t);
    return t;
  }

  // 対戦の相手（o.self のときは自分。見た目はなく、相手の魔法が当たる場所としてだけ使う）
  function makePlayerTarget(o) {
    const T = TYPES.player;
    const g = new THREE.Group();
    const mats = [];
    const std = (p) => { const m = new THREE.MeshStandardMaterial(p); m.userData.baseEmissive = new THREE.Color(p.emissive || 0x000000); m.userData.baseInt = p.emissiveIntensity == null ? 1 : p.emissiveIntensity; mats.push(m); return m; };
    const face = new THREE.Group(); g.add(face);
    const t = {
      type: 'player', isPlayer: true, isSelf: !!o.self, pid: o.id, name: o.name || '', color: o.color || '#7fd8ff',
      T, group: g, face, mats, hp: PLAYER_HP, maxHp: PLAYER_HP, r: T.r, pts: 0,
      home: new V3(), pos: new V3(o.x || 0, 0, o.z || 0), center: new V3(), floatY: 0, phase: rand(0, 10), moveDir: new V3(1, 0, 0),
      disp: new V3(), dispV: new V3(), mass: 1, burnT: 0, burnDps: 0, burnAcc: 0, burnPop: 0, freezeT: 0, frozenHard: false, vulnT: 0, flash: 0,
      alive: true, dead: 0, spawnT: 1, id: o.id, netPos: new V3(o.x || 0, 0, o.z || 0), yaw: 0, netYaw: 0, netPitch: 0, castGlow: 0,
      netBurn: false, netFrozen: false, netProt: false, walk: 0,
    };
    const bc = document.createElement('canvas'); bc.width = 128; bc.height = 16;
    t.bc = bc; t.btex = new THREE.CanvasTexture(bc);
    t.bar = new THREE.Sprite(new THREE.SpriteMaterial({ map: t.btex, transparent: true }));
    t.bar.scale.set(1.5, 0.18, 1); t.bar.position.y = 2.55; t.bar.renderOrder = 20; t.bar.visible = false;
    g.add(t.bar);
    if (!o.self) {
      const col = new THREE.Color(t.color);
      const robeMat = std({ color: col.clone().multiplyScalar(0.45), emissive: col, emissiveIntensity: 0.18, roughness: 0.85, flatShading: true });
      const hatMat = std({ color: col.clone().multiplyScalar(0.3), emissive: col, emissiveIntensity: 0.12, roughness: 0.8, flatShading: true });
      const skin = std({ color: 0xf1d2b6, roughness: 0.7 });
      const robe = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.5, 12), robeMat); robe.position.y = 0.75; face.add(robe);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 12), skin); head.position.y = 1.62; face.add(head);
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.04, 16), hatMat); brim.position.y = 1.8; face.add(brim);
      const hat = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.62, 12), hatMat); hat.position.set(0, 2.1, 0.04); hat.rotation.x = -0.18; face.add(hat);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.07, 16), std({ color: col, emissive: col, emissiveIntensity: 0.6 })); band.position.y = 1.86; face.add(band);
      // 杖（右手）。相手が持っている杖と同じ形（素手のときは両手が光る）
      const wandG = new THREE.Group(); wandG.position.set(0.42, 1.05, -0.18); wandG.rotation.x = -0.9; face.add(wandG);
      t.wandGroup = wandG;
      t.hands = [-1, 1].map((sd) => { const h = FX.glowSprite(t.color, 0.55); h.position.set(sd * 0.4, 1.0, -0.2); h.visible = false; face.add(h); return h; });
      setAvatarWand(t, 'novice');
      // 名前
      const lc = document.createElement('canvas'); lc.width = 256; lc.height = 48;
      const lg = lc.getContext('2d');
      lg.font = 'bold 28px "Yu Gothic UI", "Meiryo", sans-serif'; lg.textAlign = 'center'; lg.textBaseline = 'middle';
      lg.lineWidth = 6; lg.strokeStyle = 'rgba(5,8,25,0.85)'; lg.strokeText(t.name, 128, 24);
      lg.fillStyle = t.color; lg.fillText(t.name, 128, 24);
      t.labelTex = new THREE.CanvasTexture(lc);
      const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: t.labelTex, transparent: true }));
      label.scale.set(1.9, 0.36, 1); label.position.y = 2.85; label.renderOrder = 21; g.add(label);
      t.label = label;
      // 復活直後の守り
      const sh = new THREE.Mesh(new THREE.SphereGeometry(1.1, 20, 14), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }));
      sh.position.y = 1.1; sh.visible = false; g.add(sh); t.shield = sh;
      // 障壁の魔法（六角形の網目の球）
      const wd = makeWardMesh(1.3, 0x4a8bff);
      wd.position.y = 1.1; wd.visible = false; g.add(wd); t.ward = wd; t.wardA = 0; t.wardHit = 0;
      // 大盾（体の前の、つぶした六角形の網目の盾）
      const fr = makeWardMesh(1, 0x4a8bff); fr.scale.set(1.05, 1.25, 0.3); fr.position.set(0, 1.1, -0.8); fr.visible = false; face.add(fr); t.front = fr;
      // 相手が組んでいる魔法陣（紋章を重ねている・唱えている魔法）
      const cg = new THREE.Group(); cg.position.set(0, 1.3, -1.1); cg.rotation.y = Math.PI; cg.visible = false; face.add(cg);
      const ringM = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.MeshBasicMaterial({ map: FX.circleTex, color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      const glyphM = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 2.3), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, fog: false, side: THREE.DoubleSide })); // 後ろや横からも見える（後ろからは左右が逆）
      glyphM.position.z = 0.01; cg.add(ringM); cg.add(glyphM);
      t.circle = { g: cg, ring: ringM, glyph: glyphM, seq: [], key: '', on: 0, state: 'idle', t: 0, tex: null };
      drawBar(t);
    }
    g.position.copy(t.pos);
    scene.add(g);
    updateCenter(t);
    return t;
  }
  // 対戦相手の手の杖を、その杖の形にする（'bare' なら杖を消して両手を光らせる）
  const AV_WAND = 1.55;
  function setAvatarWand(t, id) {
    if (!t.wandGroup || t.netWand === id) return;
    t.netWand = id;
    if (t.wandModel) { t.wandGroup.remove(t.wandModel); disposeTree(t.wandModel); t.wandModel = null; t.wandGlow = null; }
    const bare = id === 'bare';
    t.hands.forEach((h) => (h.visible = bare));
    if (bare) return;
    const m = makeWandModel(id, new THREE.Color(t.color));
    m.scale.setScalar(AV_WAND); m.position.y = -m.userData.base * AV_WAND;
    t.wandGroup.add(m); t.wandModel = m; t.wandGlow = m.userData.glow;
  }
  function updatePlayerTarget(t, dt) {
    if (t.isSelf) {
      t.pos.copy(player.pos); t.alive = M.alive; t.dispV.set(0, 0, 0);
      t.group.position.copy(t.pos); updateCenter(t);
      return;
    }
    const k = Math.min(1, dt * 12);
    const before = t.pos.clone();
    if (t.pos.distanceTo(t.netPos) > 12) t.pos.copy(t.netPos); else t.pos.lerp(t.netPos, k);
    let dy = t.netYaw - t.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); t.yaw += dy * k;
    const sp = before.distanceTo(t.pos) / Math.max(dt, 1e-4);
    t.walk += dt * Math.min(12, sp) * 1.4;
    if (t.alive) stepSound(t, groundKind(), 0.8, sp > 0.5 && Math.abs(t.pos.y - W.floorAt(t.pos.x, t.pos.z, t.pos.y + 0.4)) < 0.2 ? sp : 0);
    t.group.position.copy(t.pos);
    t.group.visible = t.alive;
    t.face.rotation.y = t.yaw;
    t.face.position.y = sp > 0.5 ? Math.abs(Math.sin(t.walk)) * 0.06 : Math.sin(st.time * 2 + t.phase) * 0.02;
    if (t.wandGroup) t.wandGroup.rotation.x = -0.9 - t.netPitch * 0.6 - t.castGlow * 0.5;
    t.castGlow = Math.max(0, t.castGlow - dt * 3);
    if (t.wandGlow) t.wandGlow.scale.setScalar((0.55 + t.castGlow * 1.1) * (t.wandModel ? t.wandModel.userData.glowK : 1));
    if (t.hands && t.netWand === 'bare') t.hands.forEach((h) => h.scale.setScalar(0.55 + t.castGlow * 0.8 + Math.sin(st.time * 5 + h.position.x) * 0.05));
    if (t.shield) { t.shield.visible = t.netProt && t.alive; t.shield.material.opacity = 0.12 + Math.sin(st.time * 6) * 0.05; }
    if (t.ward) {
      const want = t.netWard && t.alive ? 1 : 0;
      t.wardA += (want - t.wardA) * Math.min(1, dt * (want ? 7 : 5));
      t.wardHit = Math.max(0, t.wardHit - dt * 1.6);
      const shown = t.netWardFront && t.front ? t.front : t.ward;
      t.ward.visible = shown === t.ward && t.wardA > 0.01;
      if (t.front) t.front.visible = shown === t.front && t.wardA > 0.01;
      if (shown.visible) {
        const U = shown.material.uniforms;
        U.uAlpha.value = t.wardA; U.uTime.value = st.time; U.uHit.value = t.wardHit; U.uLow.value = t.netWardLow ? 1 : 0;
        if (shown === t.ward) t.ward.scale.setScalar(0.7 + t.wardA * 0.3);
      }
    }
    if (t.circle) updateAvatarCircle(t, dt);
    updateAvatarFlyAura(t, dt);
    updateCenter(t);
    if (t.flash > 0) t.flash -= dt;
    if (t.netBurn && Math.random() < 0.4) FX.emit(t.center, { count: 1, c1: '#ff6a1a', c2: '#ffd24a', speed: 0.6, up: 2.5, jitter: 0.5, life: 0.6, size: 0.4, drag: 0.5 });
    if (t.netFrozen && Math.random() < 0.2) FX.emit(t.center, { count: 1, c1: '#bff0ff', c2: '#ffffff', speed: 0.3, jitter: 0.7, life: 0.7, size: 0.22 });
    for (const m of t.mats) {
      if (t.flash > 0) { m.emissive.setRGB(1, 1, 1); m.emissiveIntensity = 0.9; }
      else if (t.netFrozen) { m.emissive.setRGB(0.3, 0.75, 1); m.emissiveIntensity = 0.55; }
      else if (t.netBurn) { m.emissive.setRGB(1, 0.35, 0.05); m.emissiveIntensity = 0.35 + Math.random() * 0.25; }
      else { m.emissive.copy(m.userData.baseEmissive); m.emissiveIntensity = m.userData.baseInt; }
    }
  }

  // 相手の飛翔（背中の光の翼）と纏い（体を包む光と小さな稲妻）
  function wingTexture() {
    if (wingTexture.tex) return wingTexture.tex;
    const c = document.createElement('canvas'); c.width = 128; c.height = 128;
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 64, 128, 64); grd.addColorStop(0, 'rgba(255,255,255,0.95)'); grd.addColorStop(1, 'rgba(255,255,255,0.15)');
    g.fillStyle = grd;
    g.beginPath(); g.moveTo(4, 70); g.quadraticCurveTo(50, 0, 124, 8); g.quadraticCurveTo(96, 40, 110, 52); g.quadraticCurveTo(80, 64, 96, 80); g.quadraticCurveTo(60, 90, 70, 108); g.quadraticCurveTo(30, 100, 4, 70); g.fill();
    wingTexture.tex = new THREE.CanvasTexture(c);
    return wingTexture.tex;
  }
  function updateAvatarFlyAura(t, dt) {
    if (!t.face) return;
    const flyOn = !!(t.netFly && t.alive), auraOn = !!(t.netAura && t.alive);
    if (flyOn && !t.wings) {
      const gw = new THREE.Group(); gw.position.set(0, 1.35, 0.22); t.face.add(gw);
      t.wings = { g: gw, el: null, parts: [-1, 1].map((sd) => {
        const pivot = new THREE.Group(); gw.add(pivot);
        const m = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), new THREE.MeshBasicMaterial({ map: wingTexture(), color: 0xffffff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
        m.position.x = sd * 0.75; if (sd < 0) m.scale.x = -1;
        pivot.add(m); pivot.userData.sd = sd; return pivot;
      }) };
    }
    if (t.wings) {
      t.wings.g.visible = flyOn;
      if (flyOn) {
        if (t.wings.el !== t.netFly) { t.wings.el = t.netFly; t.wings.parts.forEach((p) => p.children[0].material.color.set(MG.ELEMENTS[t.netFly].c1)); }
        const flap = Math.sin(st.time * 7 + t.phase) * 0.45;
        t.wings.parts.forEach((p) => { p.rotation.y = p.userData.sd * (0.5 + flap); });
        if (Math.random() < 0.6) FX.emit(new V3(t.pos.x + rand(-0.4, 0.4), t.pos.y + rand(0, 0.4), t.pos.z + rand(-0.4, 0.4)), { count: 1, c1: MG.ELEMENTS[t.netFly].c1, c2: MG.ELEMENTS[t.netFly].c2, speed: 0.5, up: -1.5, life: 0.7, size: 0.35, drag: 1 });
      }
    }
    if (auraOn && !t.auraGlow) { t.auraGlow = FX.glowSprite('#ffffff', 3.2); t.auraGlow.position.y = 1.1; t.group.add(t.auraGlow); t.auraEl = null; t.auraZap = 0; }
    if (t.auraGlow) {
      t.auraGlow.visible = auraOn;
      if (auraOn) {
        const E = MG.ELEMENTS[t.netAura];
        if (t.auraEl !== t.netAura) { t.auraEl = t.netAura; t.auraGlow.material = FX.glowMaterial(E.c1); }
        t.auraGlow.scale.setScalar(3 + Math.sin(st.time * 18 + t.phase) * 0.35 + Math.random() * 0.3);
        if (Math.random() < 0.5) { const a = rand(0, Math.PI * 2); FX.emit(new V3(t.pos.x + Math.cos(a) * 0.8, t.pos.y + rand(0.1, 1.6), t.pos.z + Math.sin(a) * 0.8), { count: 1, c1: E.c1, c2: E.c2, speed: 0.5, up: 1.6, life: 0.45, size: 0.25, drag: 1 }); }
        t.auraZap -= dt;
        if (ZAPPY[t.netAura] && t.auraZap <= 0) {
          t.auraZap = rand(0.12, 0.25);
          const a = rand(0, Math.PI * 2), b = a + rand(0.8, 1.8);
          lightning(new V3(t.pos.x + Math.cos(a) * 0.9, t.pos.y + rand(0.2, 1.8), t.pos.z + Math.sin(a) * 0.9), new V3(t.pos.x + Math.cos(b) * 0.9, t.pos.y + rand(0.2, 1.8), t.pos.z + Math.sin(b) * 0.9), E.c1, E.c2, { life: 0.12, size: 0.16 });
        }
      }
    }
  }

  function updateCenter(t) {
    t.center.copy(t.pos);
    t.center.y = t.type === 'floater' ? t.pos.y : t.pos.y + t.T.cy;
  }

  function drawBar(t) {
    const g = t.bc.getContext('2d');
    g.clearRect(0, 0, 128, 16);
    g.fillStyle = 'rgba(5,8,25,0.75)'; g.fillRect(0, 0, 128, 16);
    const r = Math.max(0, t.hp / t.maxHp);
    g.fillStyle = t.isEnemy ? (r > 0.3 ? '#ff4a4a' : '#ff9a3a') : r > 0.5 ? '#5dff9a' : r > 0.25 ? '#ffd24a' : '#ff5a5a';
    g.fillRect(2, 2, 124 * r, 12);
    t.btex.needsUpdate = true;
    t.bar.visible = t.isPlayer ? t.alive && !t.isSelf : t.isSummon ? t.alive : t.hp < t.maxHp && t.alive;
  }

  function pickType() {
    const hasGolem = targets.some((t) => t.alive && t.type === 'golem');
    const pool = [];
    for (const k in TYPES) if (!(k === 'golem' && hasGolem)) for (let i = 0; i < TYPES[k].weight; i++) pool.push(k);
    return pool[(Math.random() * pool.length) | 0];
  }

  function freeSlot() {
    for (let i = 0; i < ROW.length; i++) if (!targets.some((t) => t.slot === i && t.alive)) return i;
    return -1;
  }
  function spawnTarget(type, at, slot) {
    if (!at && slot == null) { slot = freeSlot(); if (slot < 0) return null; }
    if (!at && slot != null) { type = ROW[slot].type; at = new V3(ROW[slot].x, 0, ROW[slot].z == null ? ROW_Z : ROW[slot].z); }
    type = type || pickType();
    let home = at ? at.clone() : null;
    if (!home) {
      for (let tries = 0; tries < 30; tries++) {
        const a = rand(0, Math.PI * 2), d = rand(14, 46);
        const p = new V3(Math.cos(a) * d, 0, Math.sin(a) * d);
        if (p.distanceTo(new V3(player.pos.x, 0, player.pos.z)) < 11) continue;
        if (targets.some((t) => t.alive && t.home.distanceTo(p) < 6)) continue;
        home = p; break;
      }
      if (!home) home = new V3(rand(-30, 30), 0, rand(-40, -15));
    }
    const t = makeTarget(type, home);
    t.slot = slot == null ? -1 : slot;
    if (type === 'floater') { t.floatY = 4; t.pos.y = t.floatY; t.home.y = 0; }
    targets.push(t);
    FX.emit(new V3(home.x, 0.3, home.z), { count: 25, c1: '#7fd8ff', c2: '#c08bff', speed: 3, up: 3, life: 0.8, size: 0.35, drag: 2 });
    return t;
  }

  function removeTargetObj(t) {
    scene.remove(t.pivot || t.group);
    if (t.body) { PH.remove(t.body); t.body = null; }
    disposeTarget(t);
  }
  function updateTargets(dt0) {
    for (let i = targets.length - 1; i >= 0; i--) {
      const t = targets[i];
      const dt = dilations.length && t.alive && !t.isPlayer && !t.puppet ? dt0 * timeK(t.center, targetOwner(t)) : dt0;
      if (t.isPlayer) { updatePlayerTarget(t, dt); continue; }
      if (t.isSummon) { if (updateSummon(t, dt)) { const j = targets.indexOf(t); removeTargetObj(t); if (j >= 0) targets.splice(j, 1); } continue; }
      if (t.isEnemy) { if (updateEnemy(t, dt)) { const j = targets.indexOf(t); removeTargetObj(t); if (j >= 0) targets.splice(j, 1); } continue; }
      if (!t.alive && t.pivot) {
        // 物理で吹き飛んだ的: しばらく転がってから小さくなって消える
        t.dead += dt;
        if (t.dead > 2.4) t.pivot.scale.setScalar(Math.max(0.001, 1 - (t.dead - 2.4) / 0.4));
        if (t.dead > 2.8) { removeTargetObj(t); targets.splice(i, 1); }
        continue;
      }
      if (!t.alive) {
        t.dead += dt;
        const k = Math.max(0.001, 1 - t.dead / 0.35);
        t.group.scale.setScalar(k);
        if (t.eraseTo) t.group.position.lerp(t.eraseTo, Math.min(1, dt * 6));
        else t.group.position.y += dt * 2;
        if (t.dead > 0.35) { removeTargetObj(t); targets.splice(i, 1); }
        continue;
      }
      t.spawnT = Math.min(1, t.spawnT + dt * 3);
      const pop = t.spawnT < 1 ? 1 - Math.pow(1 - t.spawnT, 3) * Math.cos(t.spawnT * 6) : 1;
      t.group.scale.setScalar(Math.max(0.01, pop));

      const slow = t.still ? 0 : t.freezeT > 0 ? (t.frozenHard ? 0 : 0.35) : 1;
      t.phase += dt * slow;
      // 的はその場から動かない（浮遊水晶だけ上下にゆれる）
      const off = new V3();
      if (t.type === 'floater') off.set(0, t.floatY + Math.sin(t.phase * 1.6) * 0.35, 0);

      // 吹き飛ばし・引き寄せ（ばねで元の位置に戻る）
      t.dispV.addScaledVector(t.disp, -5 * dt);
      t.dispV.multiplyScalar(Math.max(0, 1 - 2.8 * dt));
      t.disp.addScaledVector(t.dispV, dt);
      if (t.disp.length() > 14) t.disp.setLength(14);
      t.pos.copy(t.home).add(off).add(t.disp);
      const gy = W.heightAt(t.pos.x, t.pos.z);
      if (t.type !== 'floater') t.pos.y = gy + Math.max(0, t.disp.y);
      else t.pos.y = Math.max(1.2, t.pos.y);
      const flat = Math.hypot(t.pos.x, t.pos.z);
      if (flat > ARENA + 4) { t.pos.x *= (ARENA + 4) / flat; t.pos.z *= (ARENA + 4) / flat; }
      t.group.position.copy(t.pos);
      updateCenter(t);

      // 向き
      if (t.type === 'floater') t.face.rotation.y += dt * (slow * 1.5 + 0.1);
      else if (t.type === 'golem') {
        t.face.rotation.y = Math.atan2(player.pos.x - t.pos.x, player.pos.z - t.pos.z);
        t.face.position.y = Math.sin(t.phase * 1.5) * 0.05 * slow;
      } else {
        t.face.rotation.y = Math.atan2(player.pos.x - t.pos.x, player.pos.z - t.pos.z);
      }

      // 状態異常
      if (t.burnT > 0) {
        t.burnT -= dt;
        t.burnAcc += t.burnDps * dt;
        if (Math.random() < 0.5) FX.emit(t.center, { count: 1, c1: '#ff6a1a', c2: '#ffd24a', speed: 0.6, up: 2.5, jitter: t.r * 0.7, life: 0.6, size: 0.45, drag: 0.5 });
        if (t.burnAcc >= 4) { const d = Math.floor(t.burnAcc); t.burnAcc -= d; const dd = damage(t, d, '#ff9a4a', false); if (t.burnRec) t.burnRec.add(dd); AU.crackle(ap(t.center)); }
      }
      if (t.freezeT > 0) {
        t.freezeT -= dt;
        if (Math.random() < 0.25) FX.emit(t.center, { count: 1, c1: '#bff0ff', c2: '#ffffff', speed: 0.3, jitter: t.r, life: 0.7, size: 0.25 });
        if (t.freezeT <= 0) t.frozenHard = false;
      }
      if (t.vulnT > 0) t.vulnT -= dt;
      if (t.flash > 0) t.flash -= dt;

      // 色（ヒット時の白・凍結の水色・燃焼のオレンジ）
      for (const m of t.mats) {
        if (t.flash > 0) { m.emissive.setRGB(1, 1, 1); m.emissiveIntensity = 0.9; }
        else if (t.freezeT > 0) { m.emissive.setRGB(0.3, 0.75, 1); m.emissiveIntensity = 0.55; }
        else if (t.burnT > 0) { m.emissive.setRGB(1, 0.35, 0.05); m.emissiveIntensity = 0.35 + Math.random() * 0.25; }
        else if (t.goldT > 0) { m.emissive.setRGB(1, 0.7, 0.1); m.emissiveIntensity = 0.55; }
        else if (t.vulnT > 0) { m.emissive.setRGB(0.4, 1, 0.2); m.emissiveIntensity = 0.3; }
        else { m.emissive.copy(m.userData.baseEmissive); m.emissiveIntensity = m.userData.baseInt; }
      }
      if (t.goldT > 0) t.goldT -= dt;
    }
  }

  function disposeTarget(t) {
    t.group.traverse((o) => { if (o.geometry && !o.isSprite) o.geometry.dispose(); });
    t.btex.dispose(); t.bar.material.dispose();
    t.mats.forEach((m) => m.dispose());
    if (t.labelTex) { t.labelTex.dispose(); t.label.material.dispose(); }
  }

  // ダメージの数字
  const popLayer = () => document.getElementById('popups');
  let popCount = 0;
  function popup(worldPos, text, cls) {
    const layer = popLayer(); if (!layer || popCount > 40) return;
    const v = worldPos.clone().project(camera);
    if (v.z > 1 || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2) return;
    const el = document.createElement('div');
    el.className = 'pop ' + (cls || '');
    el.textContent = text;
    el.style.left = ((v.x + 1) / 2) * 100 + '%';
    el.style.top = ((1 - v.y) / 2) * 100 + '%';
    el.style.setProperty('--dx', rand(-30, 30).toFixed(0) + 'px');
    layer.appendChild(el); popCount++;
    setTimeout(() => { el.remove(); popCount--; }, 900);
  }

  function damage(t, d, color, crit) {
    if (!t.alive) return 0;
    d = Math.max(1, Math.round(d));
    t.hp -= d; t.flash = 0.1;
    const p = t.center.clone(); p.x += rand(-0.4, 0.4); p.y += t.r * 0.6;
    popup(p, crit ? d + '!' : String(d), crit ? 'crit' : '');
    drawBar(t);
    if (t.hp <= 0) killTarget(t);
    return d;
  }

  // 的に魔法が当たったとき
  function hitTarget(t, dmg, spec, o) {
    if (!t || !t.alive) return 0;
    o = o || {};
    if (spec && spec.casterT && t === spec.casterT) return 0; // 自分の魔法は自分に当たらない
    if (t.isSummon && friendly(t, spec)) return 0;             // 自分の召喚獣にも当たらない
    if (t.isSummon && t.puppet) return hitPuppet(t, dmg, spec, o); // 相手の召喚獣: ダメージを持ち主に送る
    if (t.isPlayer) return hitPlayer(t, dmg, spec, o);
    if (spec && spec.remote) return 0;                          // 相手の魔法は見た目だけ
    if (o.dir) t.lastDir = o.dir.clone();
    let d = dmg * ((spec && spec.mult) || 1);
    if (t.vulnT > 0) d *= 1.35;
    let crit = false;
    if (spec && spec.crit && !o.noCrit && Math.random() < spec.crit) { d *= 2.5; crit = true; }
    if (spec && !o.noStatus) {
      if (spec.burn > 0) { t.burnT = Math.max(t.burnT, 1.5 + spec.burn * 1.2); t.burnDps = Math.max(t.burnDps, (3 + spec.burn * 3) * (spec.mult || 1)); t.burnRec = spec.rec || null; }
      if (spec.freeze > 0) { t.freezeT = Math.max(t.freezeT, 0.8 + spec.freeze); if (spec.freeze >= 2) t.frozenHard = true; }
      if (spec.corrode > 0) t.vulnT = Math.max(t.vulnT, 3 + spec.corrode * 2);
      if (spec.knock > 0 && o.dir) {
        const k = o.dir.clone(); k.y = 0; if (k.lengthSq() < 1e-4) k.set(0, 0, -1); k.normalize();
        t.dispV.addScaledVector(k, spec.knock * 6 * t.mass); t.dispV.y += spec.knock * 1.6 * t.mass;
      }
      if (spec.rewind > 0 && !o.isPulse && !o.isRewind) {
        for (let k = 1; k <= Math.round(spec.rewind); k++) after(0.6 * k, () => {
          if (!t.alive) return;
          FX.ring(t.center.clone(), '#a8a2ff', 2.6, 0.4, 0.4, { vertical: true, lookAt: camera.position.clone() });
          FX.emit(t.center, { count: 22, c1: '#a8a2ff', c2: '#7af0e0', speed: -5, jitter: 2, life: 0.4, size: 0.35, drag: 0 });
          popup(t.center.clone().add(new V3(0, 1.4, 0)), '回帰', 'pierce');
          hitTarget(t, dmg, spec, { isRewind: true, noStatus: true, noCrit: true });
        });
      }
      if (spec.pulses > 0 && !o.isPulse) {
        const n = Math.round(spec.pulses);
        for (let k = 1; k <= n; k++) after(0.3 * k, () => {
          if (!t.alive) return;
          FX.emit(t.center, { count: 18, c1: colorsOf(spec)[0], c2: colorsOf(spec)[1], speed: 5, life: 0.35, size: 0.3, drag: 4 });
          FX.ring(t.center.clone().setY(Math.max(0.1, t.pos.y + 0.1)), colorsOf(spec)[0], 0.5, 3, 0.35);
          hitTarget(t, dmg * 0.3, spec, { isPulse: true, noStatus: true, noCrit: true });
        });
      }
    }
    if (crit) AU.crit(); else AU.hit(spec && spec.element, ap(t.center));
    const dealt = damage(t, d, null, crit);
    if (spec && spec.rec) spec.rec.add(dealt);
    return dealt;
  }

  // 対戦の相手に自分の魔法が当たった: ダメージと状態異常を計算して、相手に送る
  function hitPlayer(t, dmg, spec, o) {
    if (t.isSelf && spec && spec.reflected && !spec.remote && M.on && M.alive) return hitSelfReflected(dmg, spec);
    if (!spec || spec.remote || t.isSelf || !M.on || !t.alive || t.netProt) return 0;
    if (t.netWard && t.ward) { const hd = o.dir ? o.dir.clone().negate() : camera.position.clone().sub(t.center); wardRipple(t, hd); }
    let d = dmg * (spec.mult || 1);
    if (spec.secret && MG.SECRET_PVP[spec.secret]) d *= MG.SECRET_PVP[spec.secret]; // 強い隠し魔法は、相手プレイヤーへのダメージを下げる
    if (spec.form === 'beam' && !spec.secret && meissnerOf(targetOwner(t))) d *= 0.5;  // 完全反磁性は光線を半分防ぐ
    let crit = false;
    if (spec.crit && !o.noCrit && Math.random() < spec.crit) { d *= 2.5; crit = true; }
    d = Math.max(1, Math.round(d));
    const h = { d, c: crit ? 1 : 0, e: spec.element, n: spec.name ? spec.name.kanji : '' };
    if (!o.noStatus) {
      if (spec.burn > 0) h.burn = [1.5 + spec.burn * 1.2, (3 + spec.burn * 3) * (spec.mult || 1)];
      if (spec.freeze > 0) h.frz = [0.8 + spec.freeze, spec.freeze >= 2 ? 1 : 0];
      if (spec.corrode > 0) h.vul = 3 + spec.corrode * 2;
      if (spec.knock > 0 && o.dir) {
        const k = o.dir.clone(); k.y = 0; if (k.lengthSq() < 1e-4) k.set(0, 0, -1); k.normalize();
        h.kb = [k.x * spec.knock * 6, spec.knock * 1.6, k.z * spec.knock * 6];
      }
      if (spec.rewind > 0 && !o.isPulse && !o.isRewind) for (let k = 1; k <= Math.round(spec.rewind); k++) after(0.6 * k, () => { if (t.alive) { popup(t.center.clone().add(new V3(0, 1.4, 0)), '回帰', 'pierce'); hitPlayer(t, dmg, spec, { isRewind: true, noStatus: true, noCrit: true }); } });
      if (spec.pulses > 0 && !o.isPulse) for (let k = 1; k <= Math.round(spec.pulses); k++) after(0.3 * k, () => { if (t.alive) hitPlayer(t, dmg * 0.3, spec, { isPulse: true, noStatus: true, noCrit: true }); });
    }
    t.flash = 0.12;
    const p = t.center.clone(); p.x += rand(-0.3, 0.3); p.y += 0.6;
    popup(p, crit ? d + '!' : String(d), crit ? 'crit' : 'pvp');
    if (crit) AU.crit(); else AU.hit(spec.element, ap(t.center));
    if (spec.rec) spec.rec.add(d);
    if (G.onPlayerHit) G.onPlayerHit(t.pid, h);
    if (spec.drain > 0 && M.on && M.alive) {
      const heal = Math.round(d * spec.drain);
      if (heal > 0) { M.hp = Math.min(M.maxHp, M.hp + heal); SUP.healed += heal; popup(ahead(2.4, -0.4), '+' + heal, 'heal'); }
    }
    return d;
  }

  // 相手の完全反磁性ではね返された自分の弾が、自分に当たった（自分の画面で決まる）
  function hitSelfReflected(dmg, spec) {
    let d = dmg * (spec.mult || 1);
    if (spec.secret && MG.SECRET_PVP[spec.secret]) d *= MG.SECRET_PVP[spec.secret];
    d = Math.max(1, Math.round(d));
    popup(ahead(2.4, 0.3), '反射 ' + d, 'pvp');
    G.applyHit(spec.reflectBy || null, { d, e: spec.element, n: '反射' });
    return d;
  }
  function killTarget(t, opt) {
    opt = opt || {};
    if (!t.alive || t.isPlayer) return;
    if (t.isSummon) { summonDie(t, false); return; }
    if (t.isEnemy) { enemyDie(t); return; }
    t.alive = false; t.dead = 0; t.bar.visible = false;
    st.kills++;
    st.combo = st.comboT > 0 ? st.combo + 1 : 1;
    st.comboT = 3;
    const mul = 1 + Math.min(st.combo - 1, 10) * 0.1;
    const pts = Math.round(t.pts * mul * (t.golden ? 2 : 1));
    st.score += pts;
    const c = t.center.clone();
    popup(c.clone().add(new V3(0, 1.2, 0)), '+' + pts + (st.combo > 1 ? ' ×' + mul.toFixed(1) : '') + (t.golden ? ' 黄金×2' : ''), 'score');
    const cols = t.golden ? ['#ffd24a', '#fff3b8'] : { dummy: ['#c8925a', '#ffd88a'], slider: ['#4fa8ff', '#ffd88a'], floater: ['#c08bff', '#ffffff'], golem: ['#9a9cb4', '#ff9a40'] }[t.type];
    if (t.golden) t.mats.forEach((m) => { if (m.color) m.color.set('#ffcf4a'); m.emissive.set('#ff9a10'); m.emissiveIntensity = 0.7; m.metalness = 0.9; m.roughness = 0.25; });
    if (opt.quiet) {
      t.eraseTo = opt.to ? opt.to.clone() : null;
      FX.emit(c, { count: 30, c1: '#dff6ff', c2: '#8fb8ff', speed: 1.5, life: 0.5, size: 0.4, drag: 2 });
    } else {
      FX.emit(c, { count: t.type === 'golem' ? 90 : 50, c1: cols[0], c2: cols[1], speed: 7, up: 3, gravity: 12, drag: 0.8, life: 1.2, size: 0.4 });
      FX.emit(c, { count: 30, c1: '#ffffff', c2: cols[1], speed: 3, life: 0.4, size: 1, drag: 3 });
      FX.flash(c, cols[1], 5, 14, 0.3);
      AU.destroy(ap(c));
      if (W.phys) {
        const piv = new THREE.Group(); piv.position.copy(t.center); scene.add(piv);
        t.group.position.sub(t.center); piv.add(t.group);
        const hs = { dummy: [1, 1.3, 0.3], slider: [1, 1.1, 0.35], floater: [0.65, 0.95, 0.65], golem: [1.7, 1.9, 0.8] }[t.type];
        t.body = PH.box(piv.position, null, hs[0], hs[1], hs[2], { mesh: piv, fast: true, friction: 0.6, restitution: 0.25 });
        const dir = (t.lastDir || new V3(t.pos.x - player.pos.x, 0, t.pos.z - player.pos.z)).clone(); dir.y = 0;
        if (dir.lengthSq() < 1e-4) dir.set(0, 0, -1); dir.normalize();
        const k = t.type === 'golem' ? 4 : 7;
        PH.kick(t.body, { x: dir.x * k, y: 5 + Math.random() * 2, z: dir.z * k }, { x: rand(-7, 7), y: rand(-5, 5), z: rand(-7, 7) });
        t.pivot = piv;
      }
    }
    if (MG.UI) MG.UI.onKill(t, pts);
    const slot = t.slot;
    if (st.running) after(2.2, () => { if (G.noRespawn) return; if (slot >= 0 && !targets.some((x) => x.alive && x.slot === slot)) spawnTarget(null, null, slot); });
  }

  function aliveTargets() { return targets.filter((t) => t.alive); }
  function nearestTarget(p, maxD, exclude, filter, spec) {
    let best = null, bd = maxD;
    for (const t of targets) {
      if (!t.alive || (exclude && exclude.has(t)) || (filter && !filter(t)) || (spec && friendly(t, spec))) continue;
      const d = t.center.distanceTo(p);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }

  // ======================================================================
  //  ねらい
  // ======================================================================
  const _dir = new V3();
  function getAim(range) {
    range = range || 70;
    camera.getWorldDirection(_dir);
    const origin = camera.position.clone();
    const dir = _dir.clone();
    let best = null, bestT = range, ground = false;
    for (const t of targets) {
      if (!t.alive || t.isSelf || (t.isSummon && t.ownerKey === 'me')) continue;
      const oc = t.center.clone().sub(origin);
      const tca = oc.dot(dir); if (tca < 0) continue;
      const d2 = oc.lengthSq() - tca * tca, r = t.r * 1.15;
      if (d2 > r * r) continue;
      const tt = tca - Math.sqrt(r * r - d2);
      if (tt < bestT) { bestT = tt; best = t; }
    }
    const pt = W.raycast(origin, dir, bestT, 'me'); // 相手の魔法の壁にも、狙いが止まる
    if (pt != null) { bestT = pt; best = null; }
    if (!best && pt == null && dir.y < -0.001) { const tg = -origin.y / dir.y; if (tg < bestT) { bestT = tg; ground = true; } }
    const point = origin.clone().addScaledVector(dir, bestT);
    return { origin, dir, point, target: best, dist: bestT, ground, range };
  }
  const range0 = (aim) => (aim.range || 70) - 0.5;
  function groundPointOf(aim, maxD) {
    let p = aim.target ? aim.target.pos.clone() : aim.point.clone();
    if (!aim.target && !aim.ground && aim.dist >= range0(aim)) {
      // 空を狙ったときは、視線の先の地面（最大距離）
      const f = aim.dir.clone(); f.y = 0; if (f.lengthSq() < 1e-4) f.set(0, 0, -1); f.normalize();
      p = new V3(casterPos().x, 0, casterPos().z).addScaledVector(f, Math.min(maxD || 35, 35));
    }
    p.y = 0;
    const base = new V3(casterPos().x, 0, casterPos().z);
    if (p.distanceTo(base) > (maxD || 55)) p.sub(base).setLength(maxD || 55).add(base);
    return p;
  }
  function getTip() { if (CTX) return CTX.tip.clone(); const p = new V3(); wandTip.getWorldPosition(p); return p; }
  function nearestToRay(aim, maxAngle, range) {
    let best = null, bestA = maxAngle;
    for (const t of targets) {
      if (!t.alive || (CTX ? t === CTX.casterT : t.isSelf) || (t.isSummon && t.ownerKey === (CTX ? String(CTX.casterT.pid) : 'me'))) continue;
      const v = t.center.clone().sub(aim.origin); const d = v.length(); if (d > range) continue;
      const a = v.normalize().angleTo(aim.dir);
      if (a < bestA) { bestA = a; best = t; }
    }
    return best;
  }

  // ======================================================================
  //  魔法の部品
  // ======================================================================
  function trailOf(spec, p, s, n) {
    const [c1, c2] = colorsOf(spec);
    FX.emit(p, { count: n || 2, c1, c2, speed: 0.6, life: 0.35, size: s, drag: 2, rainbow: spec.rainbow });
    if (spec.element === 'fire' && Math.random() < 0.5) FX.emit(p, { count: 1, c1: '#ff6a1a', c2: '#ffd24a', speed: 1, up: 2, life: 0.6, size: s * 0.6 });
    if ((spec.element === 'lightning' || spec.element === 'plasma') && Math.random() < 0.3) FX.emit(p, { count: 3, c1: '#ffffff', c2: c1, speed: 6, life: 0.12, size: s * 0.4, drag: 6 });
  }

  function smallBurst(p, spec, s) {
    const [c1, c2] = colorsOf(spec);
    FX.emit(p, { count: 14, c1, c2, speed: 5 * (s || 1), life: 0.35, size: 0.35 * (s || 1), drag: 4, rainbow: spec.rainbow });
    FX.flash(p, c1, 2.5, 8, 0.15);
  }

  function explode(p, radius, dmg, spec, direct, o) {
    o = o || {};
    const [c1, c2] = colorsOf(spec);
    const pp = p.clone(); if (pp.y < 0.2) pp.y = 0.2;
    FX.emit(pp, { count: Math.min(260, 30 + radius * 14), c1, c2, speed: radius * 3.2, life: 0.6, size: 0.55 + radius * 0.12, drag: 3, rainbow: spec.rainbow });
    FX.emit(pp, { count: Math.min(80, 10 + radius * 4), c1: '#ffffff', c2, speed: radius * 1.4, life: 0.3, size: 1.1 + radius * 0.25, drag: 4 });
    const e = spec.element;
    if (e === 'fire' || e === 'plasma') FX.emit(pp, { count: 24, c1: '#ff7a2a', c2: '#ffd24a', speed: 6, up: 4, gravity: 7, life: 1.3, size: 0.22 });
    if (e === 'ice' || e === 'crystal') FX.emit(pp, { count: 30, c1: '#dff8ff', c2: c1, speed: 7, up: 3, gravity: 14, drag: 0.5, life: 1, size: 0.25 });
    if (e === 'earth' || e === 'metal') FX.emit(pp, { count: 30, c1: '#8a6a4a', c2: '#d0b090', speed: 8, up: 5, gravity: 18, drag: 0.4, life: 1.2, size: 0.3 });
    if (e === 'steam' || e === 'acid') FX.emit(pp, { count: 20, c1, c2, speed: 1.5, up: 1.5, life: 1.8, size: 1.6, drag: 1, alpha: 0.35 });
    FX.ring(new V3(pp.x, 0.08, pp.z), c1, 0.3, radius * 1.15, 0.45);
    if (radius > 3) FX.ring(new V3(pp.x, 0.1, pp.z), c2, 0.3, radius * 0.8, 0.6);
    FX.flash(pp, c1, 3 + radius * 0.8, radius * 4 + 6, 0.35);
    const dist = pp.distanceTo(camera.position);
    st.shake = Math.max(st.shake, Math.min(0.9, (radius * 0.06) * Math.max(0.15, 1 - dist / 60)));
    if (!o.silent) AU.impact(e, radius, ap(pp));
    H.feel(e, Math.min(1.3, 0.12 + radius * 0.07) * near(pp), 0.25 + radius * 0.04, Math.min(1, 0.2 + radius * 0.08) * near(pp));
    for (const t of targets) {
      if (!t.alive) continue;
      const d = t.center.distanceTo(pp) - t.r;
      let dd = 0;
      if (t === direct) dd = dmg;
      else if (d < radius) dd = dmg * (1 - 0.5 * Math.max(0, d) / radius);
      if (dd > 0) hitTarget(t, dd, spec, { dir: t.center.clone().sub(pp) });
    }
    if (spec.pull > 0) pullAt(pp, radius * 2.5, spec.pull);
    if (!o.noBarrier) W.barriersNear(pp, radius).forEach((wb) => { if (wb.game) damageBarrier(wb.game, dmg * 0.8, pp, spec); }); // 爆風は魔法の壁にも当たる
    if (spec.destroy) W.blast(pp, radius, dmg * 1.2);
    if (!o.noEfk) EF.impact(e, pp, radius);
  }

  function pullAt(p, radius, power) {
    for (const t of targets) {
      if (!t.alive) continue;
      const v = p.clone().sub(t.center); const d = v.length();
      if (d > radius || d < 0.3) continue;
      v.normalize();
      t.dispV.addScaledVector(v, power * 5 * t.mass * Math.min(1, d / 3));
    }
    FX.emit(p, { count: 20, c1: '#c08bff', c2: '#ffffff', speed: -6, life: 0.4, size: 0.4, drag: 0, jitter: 3 });
  }

  // 稲妻の見た目
  function lightning(a, b, c1, c2, opts) {
    opts = opts || {};
    const group = new THREE.Group();
    const lines = [];
    for (let k = 0; k < 3; k++) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(14 * 3), 3));
      const m = new THREE.LineBasicMaterial({ color: k === 0 ? 0xffffff : k === 1 ? c1 : c2, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
      const l = new THREE.Line(g, m); l.frustumCulled = false; group.add(l); lines.push(l);
    }
    scene.add(group);
    const bolt = { group, lines, a: a.clone(), b: b.clone(), t: 0, life: opts.life || 0.38, jt: 0 };
    jitterBolt(bolt);
    bolts.push(bolt);
    FX.emitLine(a, b, { count: Math.min(90, 10 + a.distanceTo(b) * 2.5), c1, c2, speed: 0.8, life: 0.4, size: opts.size || 0.5, drag: 3 });
    beamVisual(a, b, c1, c2, 0.07, 0.22, true);
    FX.emit(b, { count: 16, c1: '#ffffff', c2: c1, speed: 7, life: 0.25, size: 0.35, drag: 5 });
    FX.flash(b, c1, 4, 14, 0.2);
  }
  function jitterBolt(bolt) {
    const d = bolt.b.clone().sub(bolt.a), len = d.length();
    const side = new V3().crossVectors(d, UP); if (side.lengthSq() < 1e-4) side.set(1, 0, 0); side.normalize();
    const up2 = new V3().crossVectors(side, d).normalize();
    bolt.lines.forEach((l, k) => {
      const arr = l.geometry.attributes.position.array;
      for (let i = 0; i < 14; i++) {
        const f = i / 13;
        const amp = i === 0 || i === 13 ? 0 : len * 0.06 * (k === 0 ? 0.6 : 1.1);
        const p = bolt.a.clone().addScaledVector(d, f).addScaledVector(side, rand(-amp, amp)).addScaledVector(up2, rand(-amp, amp));
        arr[i * 3] = p.x; arr[i * 3 + 1] = p.y; arr[i * 3 + 2] = p.z;
      }
      l.geometry.attributes.position.needsUpdate = true;
    });
  }

  // 光線の見た目
  const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true);
  function beamVisual(a, b, c1, c2, width, life, noParticles) {
    const len = a.distanceTo(b);
    const dir = b.clone().sub(a).normalize();
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const q = new THREE.Quaternion().setFromUnitVectors(UP, dir);
    const outer = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: c1, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }));
    const inner = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
    [outer, inner].forEach((m, i) => { m.position.copy(mid); m.quaternion.copy(q); m.scale.set(width * (i ? 0.35 : 1), len, width * (i ? 0.35 : 1)); m.renderOrder = 7; scene.add(m); });
    beams.push({ meshes: [outer, inner], t: 0, life: life || 0.4, width });
    if (!noParticles) FX.emitLine(a, b, { count: Math.min(120, len * 2), c1, c2, speed: 1.2, life: 0.5, size: width * 1.6, drag: 2 });
  }

  // 地面から突き出す柱
  const coneGeo = new THREE.ConeGeometry(1, 1, 6);
  const spikeMats = {};
  function spikeMat(c) { if (!spikeMats[c]) spikeMats[c] = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.55, flatShading: true, roughness: 0.35, metalness: 0.2, transparent: true }); return spikeMats[c]; }
  function spawnSpike(p, spec, hitSet, scale) {
    const [c1, c2] = colorsOf(spec);
    const s = (scale || 1) * Math.max(0.6, Math.min(2.4, spec.size || 1));
    const gy0 = W.heightAt(p.x, p.z);
    const group = new THREE.Group(); group.position.set(p.x, gy0, p.z);
    const parts = [[0, 0, 0, 1], [0.5, 0.3, 0.6, 0.6], [-0.5, -0.4, -0.5, 0.55]];
    parts.forEach(([x, z, tilt, k]) => {
      const m = new THREE.Mesh(coneGeo, spikeMat(k === 1 ? c1 : c2));
      const h = 3.2 * s * k, r = 0.55 * s * k;
      m.scale.set(r, h, r); m.position.set(x * s, h / 2, z * s); m.rotation.z = tilt * 0.4; m.rotation.x = tilt * 0.3;
      group.add(m);
    });
    group.position.y = -3.4 * s;
    scene.add(group);
    spikes.push({ group, t: 0, life: 0.95, h: 3.4 * s, y0: gy0 });
    FX.emit(new V3(p.x, 0.2, p.z), { count: 22, c1: '#8a7a6a', c2: c1, speed: 5, up: 4, gravity: 16, life: 0.8, size: 0.3 });
    FX.ring(new V3(p.x, 0.06, p.z), c1, 0.3, spec.radius * 1.2, 0.35);
    AU.impact(spec.element, 0.6, ap(p));
    EF.impact(spec.element, new V3(p.x, gy0 + 0.3, p.z), 1.6);
    H.feel(spec.element, 0.25 * near(p), 0.22, 0.3 * near(p));
    const R = spec.radius * (scale || 1);
    if (spec.destroy) W.blast(new V3(p.x, W.heightAt(p.x, p.z) + 0.5, p.z), R * 1.1, spec.dmg, { craterR: 1.1 * (scale || 1) });
    for (const t of targets) {
      if (!t.alive || hitSet.has(t) || (t.isPlayer && meissnerOf(targetOwner(t)))) continue;
      const dx = t.center.x - p.x, dz = t.center.z - p.z;
      if (Math.hypot(dx, dz) < R + t.r * 0.5 && t.center.y < 3.6 * s + t.r) {
        hitSet.add(t);
        hitTarget(t, spec.dmg, spec, { dir: new V3(dx, 0, dz) });
        t.dispV.y += 3 * t.mass;
        extras(t, spec, spec.dmg, t.center.clone(), null);
      }
    }
  }

  // ======================================================================
  //  弾
  // ======================================================================
  function spawnProj(spec, origin, dir, o) {
    o = o || {};
    const [c1] = colorsOf(spec);
    const size = o.size || spec.size;
    const glow = FX.glowSprite(spec.rainbow ? '#ffffff' : c1, size * 5);
    const core = FX.glowSprite('#ffffff', size * 1.8);
    glow.position.copy(origin); core.position.copy(origin);
    scene.add(glow); scene.add(core);
    let rock = null;
    if (o.kind === 'meteor') {
      // 流星: 燃えながら落ちる岩（属性の色に光る）
      rock = new THREE.Mesh(new THREE.IcosahedronGeometry(size * 0.85, 0), new THREE.MeshStandardMaterial({ color: new THREE.Color(c1).multiplyScalar(0.35), emissive: c1, emissiveIntensity: 0.8, flatShading: true, roughness: 0.6 }));
      rock.position.copy(origin); scene.add(rock);
    }
    const p = {
      rock, spin: new V3(rand(-4, 4), rand(-4, 4), rand(-4, 4)),
      pos: origin.clone(), vel: o.vel ? o.vel.clone() : dir.clone().normalize().multiplyScalar((spec.speed || 40) * (o.speedMul || 1)),
      spec, life: o.life || spec.life || 2, size, gravity: o.gravity || 0, homing: o.homing == null ? spec.homing : o.homing,
      pierce: o.pierce == null ? spec.pierce : o.pierce, bounce: o.bounce == null ? spec.bounce : o.bounce,
      hit: new Set((o.hit || []).concat(spec.casterT ? [spec.casterT] : [])), dmg: o.dmg || spec.dmg, explodeR: o.radius == null ? spec.radius : o.radius,
      kind: o.kind || 'bolt', isShard: !!o.isShard, glow, core, age: 0,
      wallPierce: o.isShard ? 0 : (spec.penetrate || 0), passed: new Set(), pierced: 0,
    };
    projs.push(p);
    return p;
  }

  // 相手の完全反磁性に入った弾: 撃った人のほうへはね返す（撃った人の画面では、撃った人に当たる）
  function reflectProj(p) {
    const own = okey(ownerKey(p.spec));
    for (const m of meissners) {
      if (!m.alive || m.owner === own) continue;
      const mp = meissnerPos(m); if (!mp || p.pos.distanceTo(mp) > m.R) continue;
      const shooter = p.spec.casterT;
      const back = shooter && shooter.alive ? shooter.center.clone().sub(p.pos) : p.vel.clone().negate();
      if (back.lengthSq() < 1e-4) back.set(0, 1, 0);
      p.vel.copy(back.normalize().multiplyScalar(Math.max(30, p.vel.length())));
      p.reflected = true; p.homing = 0; p.gravity = 0;
      p.spec = Object.assign({}, p.spec, { reflected: true, reflectBy: m.owner === 'me' ? (M.myId || null) : m.owner, casterT: m.who || null });
      p.hit = new Set(m.who ? [m.who] : []);
      FX.flash(p.pos, '#9fe4ff', 3, 10, 0.2);
      FX.ring(p.pos.clone(), '#bff0ff', 0.2, 1.6, 0.25, { vertical: true, lookAt: camera.position.clone() });
      FX.emit(p.pos, { count: 16, c1: '#dff8ff', c2: '#7fd8ff', speed: 5, life: 0.3, size: 0.25, drag: 4 });
      AU.blocked(ap(p.pos));
      return true;
    }
    return false;
  }
  function removeProj(i) {
    const p = projs[i];
    scene.remove(p.glow); scene.remove(p.core);
    if (p.rock) { scene.remove(p.rock); p.rock.geometry.dispose(); p.rock.material.dispose(); }
    projs.splice(i, 1);
  }

  const EXPLOSIVE = { lob: 1, orb: 1, rain: 1, meteor: 1 };
  function projHit(p, t) {
    p.hit.add(t);
    const dir = p.vel.clone().normalize();
    if (EXPLOSIVE[p.kind]) explode(p.pos, p.explodeR, p.dmg, p.spec, t);
    else {
      hitTarget(t, p.dmg, p.spec, { dir });
      smallBurst(p.pos, p.spec, p.isShard ? 0.6 : 1);
      if (p.explodeR > 0.5) for (const o of targets) if (o !== t && o.alive && o.center.distanceTo(p.pos) < p.explodeR + o.r) hitTarget(o, p.dmg * 0.4, p.spec, { dir, noStatus: true });
    }
    extras(t, p.spec, p.dmg, p.pos.clone(), p);
    if (p.pierce > 0) { p.pierce--; return false; }
    if (p.bounce > 0) {
      const next = nearestTarget(p.pos, 26, p.hit, null, p.spec);
      if (next) {
        p.bounce--;
        const sp = Math.max(25, p.vel.length());
        p.vel.copy(next.center).sub(p.pos).normalize().multiplyScalar(sp);
        p.gravity = 0; p.life = Math.max(p.life, 1.5);
        AU.zap();
        return false;
      }
    }
    return true;
  }

  // 壁をつらぬいたとき
  function pierceFx(pos, spec, n, prop) {
    W.scratch(prop, pos);
    const [c1, c2] = colorsOf(spec);
    FX.emit(pos, { count: 26, c1, c2, speed: 7, life: 0.35, size: 0.35, drag: 4, rainbow: spec.rainbow });
    FX.ring(pos.clone(), c1, 0.3, 2.4, 0.3, { vertical: true, lookAt: pos.clone().add(new V3(0, 0, 1)) });
    popup(pos.clone().add(new V3(0, 0.6, 0)), `貫通 ${n}`, 'pierce');
    AU.pierce(spec.element, ap(pos));
    H.feel(spec.element, 0.2 * near(pos), 0.15, 0.35);
    if (spec.rec) spec.rec.setPierce(n);
  }

  // 当たったときの追加効果（連鎖・分裂・引力）
  function extras(t, spec, dmg, pos, p) {
    if (spec.chainHit > 0 && spec.form !== 'chain' && !(p && p.isShard)) chainRun(t.center.clone(), null, Math.round(spec.chainHit), 18, dmg * 0.6, spec, new Set([t]), t);
    if (spec.split > 0 && !(p && p.isShard)) {
      for (let k = 0; k < spec.split; k++) {
        const a = (k / spec.split) * Math.PI * 2 + rand(-0.3, 0.3);
        const d = new V3(Math.cos(a), rand(0.1, 0.5), Math.sin(a));
        spawnProj(spec, pos, d, { speedMul: 0.6, life: 0.6, size: Math.max(0.15, spec.size * 0.6), dmg: dmg * 0.4, isShard: true, homing: 0, pierce: 0, bounce: 0, radius: 0.8, kind: 'shard', hit: [t] });
      }
    }
    if (spec.pull > 0 && !(p && EXPLOSIVE[p.kind])) pullAt(pos, 9, spec.pull);
  }

  function updateProjs(dt0) {
    for (let i = projs.length - 1; i >= 0; i--) {
      const p = projs[i];
      const dt = dilations.length ? dt0 * timeK(p.pos, okey(ownerKey(p.spec))) : dt0;
      if (meissners.length && !p.reflected && p.kind !== 'meteor') reflectProj(p);
      p.age += dt; p.life -= dt;
      if (p.homing > 0) {
        const sp = p.vel.length();
        const fwd = p.vel.clone().normalize();
        const tg = nearestTarget(p.pos, 50, p.hit, (t) => t.center.clone().sub(p.pos).normalize().dot(fwd) > 0.2, p.spec);
        if (tg) {
          const want = tg.center.clone().sub(p.pos).normalize();
          fwd.lerp(want, Math.min(1, p.homing * dt * 2)).normalize();
          p.vel.copy(fwd).multiplyScalar(sp);
        }
      }
      p.vel.y -= p.gravity * dt;
      const prevPos = p.pos.clone();
      p.pos.addScaledVector(p.vel, dt);
      p.glow.position.copy(p.pos); p.core.position.copy(p.pos);
      if (p.kind === 'orb') { const s = p.size * (5 + Math.sin(p.age * 12) * 0.6); p.glow.scale.setScalar(s); }
      if (p.rock) {
        p.rock.position.copy(p.pos); p.rock.rotation.x += p.spin.x * dt; p.rock.rotation.y += p.spin.y * dt; p.rock.rotation.z += p.spin.z * dt;
        FX.emit(p.pos, { count: 2, c1: '#ffb060', c2: colorsOf(p.spec)[0], speed: 1.2, life: 0.6, size: p.size * 1.6, drag: 1.5, alpha: 0.6 });
        if (Math.random() < 0.5) FX.emit(p.pos, { count: 1, c1: '#3a3440', c2: '#6a6070', speed: 0.6, up: 0.5, life: 1.1, size: p.size * 2, drag: 1, alpha: 0.35 });
      }
      if (p.spec.rainbow) p.glow.material = FX.glowMaterial('#' + new THREE.Color().setHSL((p.age * 1.5) % 1, 1, 0.6).getHexString());
      trailOf(p.spec, p.pos, p.size * (p.kind === 'orb' ? 2.4 : 2.2), p.kind === 'orb' ? 4 : 2);

      let remove = false;
      // 相手の魔法の壁・ドーム（動いた分の線分で調べ、すり抜けないようにする）
      const bh = W.barrierOnSegment(prevPos, p.pos, p.size * 0.5, ownerKey(p.spec));
      if (bh) {
        const dv = p.pos.clone().sub(prevPos); if (dv.lengthSq() > 1e-8) dv.normalize();
        p.pos.copy(prevPos).addScaledVector(dv, Math.max(0, bh.t - 0.05));
        if (EXPLOSIVE[p.kind]) explode(p.pos, p.explodeR, p.dmg, p.spec, null, { noBarrier: true });
        else smallBurst(p.pos, p.spec, p.isShard ? 0.5 : 0.8);
        if (bh.barrier.game) damageBarrier(bh.barrier.game, p.dmg, p.pos.clone(), p.spec);
        AU.blocked(ap(p.pos));
        remove = true;
      }
      if (!remove) for (const t of targets) {
        if (!t.alive || p.hit.has(t) || friendly(t, p.spec)) continue;
        if (p.pos.distanceTo(t.center) < t.r + p.size) { if (projHit(p, t)) { remove = true; break; } }
      }
      if (!remove) {
        const hitProp = W.collide(p.pos, p.size, p.passed);
        if (hitProp && p.wallPierce > 0 && !hitProp.solid) {
          // 壁をつらぬく
          p.wallPierce--; p.passed.add(hitProp); p.pierced++;
          if (W.isLaneSlab(hitProp) && hitProp.index === W.LANE.slabs.length) W.setPierceBoard(p.pierced, p.spec.name.kanji);
          pierceFx(p.pos, p.spec, p.pierced, hitProp);
          if (p.spec.destroy) W.damageProp(hitProp, p.dmg * 0.6, p.pos.clone());
        } else if (hitProp) {
          if (EXPLOSIVE[p.kind]) explode(p.pos, p.explodeR, p.dmg, p.spec, null);
          else { smallBurst(p.pos, p.spec, p.isShard ? 0.5 : 0.8); AU.blocked(ap(p.pos)); }
          if (p.pierced > 0) popup(p.pos.clone().add(new V3(0, 1, 0)), `${p.pierced}枚で停止`, 'pierce-end');
          if (W.isLaneSlab(hitProp)) W.setPierceBoard(p.pierced, p.spec.name.kanji);
          remove = true;
        }
      }
      const gyP = W.heightAt(p.pos.x, p.pos.z);
      if (!remove && p.pos.y <= gyP + 0.05) {
        p.pos.y = gyP + 0.05;
        if (EXPLOSIVE[p.kind]) explode(p.pos, p.explodeR, p.dmg, p.spec, null);
        else smallBurst(p.pos, p.spec, p.isShard ? 0.5 : 0.8);
        remove = true;
      }
      if (!remove && p.life <= 0) {
        if (EXPLOSIVE[p.kind]) explode(p.pos, p.explodeR, p.dmg, p.spec, null);
        else FX.emit(p.pos, { count: 6, c1: colorsOf(p.spec)[0], c2: colorsOf(p.spec)[1], speed: 1.5, life: 0.3, size: p.size * 2 });
        remove = true;
      }
      if (!remove && p.pos.lengthSq() > 200 * 200) remove = true;
      if (remove) removeProj(i);
    }
  }

  // ======================================================================
  //  連鎖（稲妻のはね移り）
  // ======================================================================
  function chainRun(fromPos, first, jumps, jumpRange, dmg, spec, hitSet, origin, colorFn) {
    hitSet = hitSet || new Set();
    if (spec.casterT) hitSet.add(spec.casterT);
    const [c1, c2] = colorsOf(spec);
    const step = (k, from, t) => {
      if (!t || !t.alive) return;
      const cc = colorFn ? colorFn(k) : [c1, c2];
      lightning(from, t.center, cc[0], cc[1]);
      AU.zap();
      hitSet.add(t);
      hitTarget(t, dmg * (k === 0 ? 1 : 0.88), spec, { dir: t.center.clone().sub(from) });
      EF.impact(spec.element, t.center, 1.4);
      if (spec.split > 0 && spec.form === 'chain') extras(t, Object.assign({}, spec, { chainHit: 0, pull: 0 }), dmg, t.center.clone(), null);
      if (spec.pull > 0) pullAt(t.center.clone(), 7, spec.pull);
      if (k < jumps) {
        const next = nearestTarget(t.center, jumpRange, hitSet, null, spec);
        if (next) after(0.08, () => step(k + 1, t.center.clone(), next));
      }
    };
    if (first) step(0, fromPos, first);
    else if (origin) {
      const next = nearestTarget(origin.center, jumpRange, hitSet, null, spec);
      if (next) after(0.06, () => step(1, origin.center.clone(), next));
    }
  }

  // ======================================================================
  //  形ごとの発動
  // ======================================================================
  // 自分の目の前の位置（数字を出す場所など）
  function ahead(d, dy) { const f = new V3(); camera.getWorldDirection(f); return camera.position.clone().addScaledVector(f, d).add(new V3(0, dy || 0, 0)); }
  // 転移の行き先: 狙った場所（遠すぎるときは最大距離）。壁・柱・岩の手前で止まり、動ける範囲の外には出ない
  function warpDest(from, aim, range) {
    let tx, tz;
    if (aim.target || aim.ground || aim.dist < range0(aim)) { tx = aim.point.x; tz = aim.point.z; }
    else { tx = from.x + aim.dir.x * range; tz = from.z + aim.dir.z * range; }
    const v = new V3(tx - from.x, 0, tz - from.z);
    let L = v.length();
    if (L < 0.5) { v.set(aim.dir.x, 0, aim.dir.z); if (v.lengthSq() < 1e-4) v.set(0, 0, -1); L = 3; }
    v.normalize();
    L = Math.min(L, range);
    const hit = W.raycast(new V3(from.x, from.y + 1, from.z), v, L);
    if (hit != null) L = Math.max(0, hit - 1);
    if (aim.target && !aim.target.isSelf) L = Math.max(0, Math.min(L, Math.hypot(aim.target.pos.x - from.x, aim.target.pos.z - from.z) - 1.6)); // 相手の目の前に降りる
    const d = new V3(from.x + v.x * L, 0, from.z + v.z * L);
    const b = W.bound(), r = Math.hypot(d.x, d.z);
    if (r > b) { d.x *= b / r; d.z *= b / r; }
    W.pushOut(d, 0.45);
    d.y = W.heightAt(d.x, d.z);
    return d;
  }
  // 障壁がこわれた: まわりに属性の衝撃を放つ
  function breakShield() {
    const spec = SUP.shieldSpec;
    SUP.shield = 0; SUP.shieldT = 0; SUP.shieldSpec = null; SUP.shieldShape = null;
    if (!spec) return;
    const p = new V3(player.pos.x, player.pos.y + 1, player.pos.z);
    SUP.breaks++;
    shatterFx(p, colorsOf(spec)[0], 1.3);
    explode(p, spec.radius, spec.dmg * 0.35, Object.assign({}, spec, { casterT: selfT }));
    popup(ahead(2.4, 0.25), '障壁がこわれた', 'ward');
    if (M.on && G.onFx) G.onFx({ k: 'wardBreak', p: arr(p), e: spec.element, r: spec.radius });
  }
  // 受けるダメージ: 守護で半分、障壁で吸い取る。戻り値は HP から引く分
  function absorb(d) {
    if (SUP.guardT > 0) d *= 0.5;
    // 大盾は、撃った人が自分の前にいるときだけ吸い取る
    if (SUP.shield > 0 && d > 0 && (SUP.shieldShape !== 'front' || fromFront())) {
      const a = Math.min(SUP.shield, d);
      SUP.shield -= a; d -= a; SUP.hitT = 0.3;
      if (M.on && G.onFx && lastHitFrom) G.onFx({ k: 'wardHit', from: lastHitFrom }); // ほかの人の画面でも、当たった所から波紋が広がる
      if (SUP.shield <= 0.5) breakShield();
    }
    return d;
  }
  function updateSupport(dt) {
    if (SUP.shieldT > 0) { SUP.shieldT -= dt; if (SUP.shieldT <= 0) { SUP.shield = 0; SUP.shieldT = 0; SUP.shieldSpec = null; SUP.shieldShape = null; } }
    if (SUP.guardT > 0) SUP.guardT = Math.max(0, SUP.guardT - dt);
    if (SUP.regenT > 0) { const k = Math.min(dt, SUP.regenT); SUP.regenT -= dt; if (M.on && M.alive) M.hp = Math.min(M.maxHp, M.hp + SUP.regen * k); else if (D.on && D.alive) D.hp = Math.min(D.maxHp, D.hp + SUP.regen * k); }
    SUP.hitT = Math.max(0, SUP.hitT - dt);
    if (SUP.hasteT > 0) SUP.hasteT = Math.max(0, SUP.hasteT - dt);
    if (SUP.flyT > 0) {
      SUP.flyT = Math.max(0, SUP.flyT - dt);
      const spec = SUP.flySpec;
      if (spec) {
        // 足もとから属性の光の粒が尾を引く
        const [c1, c2] = colorsOf(spec);
        if (!player.onGround) FX.emit(new V3(player.pos.x + rand(-0.4, 0.4), player.pos.y + rand(-0.1, 0.3), player.pos.z + rand(-0.4, 0.4)), { count: 1, c1, c2, speed: 0.6, up: -1.5, life: 0.7, size: 0.35, drag: 1, rainbow: spec.rainbow });
      }
      if (SUP.flyT === 0) { SUP.flySpec = null; SUP.glide = !player.onGround; if (SUP.glide) popup(ahead(2.4, 0.3), '飛翔が切れた（ゆっくり降りる）', 'ward'); }
    }
    if (SUP.auraT > 0) {
      SUP.auraT = Math.max(0, SUP.auraT - dt);
      const spec = SUP.auraSpec;
      if (spec && (!M.on || M.alive)) {
        const [c1, c2] = colorsOf(spec);
        const c = new V3(player.pos.x, player.pos.y + 1, player.pos.z);
        // 体のまわりに属性の粒（見下ろすと見える）
        for (let k = 0; k < 2; k++) {
          const a = rand(0, Math.PI * 2), r = rand(0.6, 1.1);
          FX.emit(new V3(c.x + Math.cos(a) * r, player.pos.y + rand(0.05, 1.2), c.z + Math.sin(a) * r), { count: 1, c1, c2, speed: 0.5, up: 1.6, life: 0.45, size: 0.22, drag: 1, rainbow: spec.rainbow });
        }
        // 雷などの属性は、体のまわりに小さな稲妻が走る
        SUP.auraZap -= dt;
        if (ZAPPY[spec.element] && SUP.auraZap <= 0) {
          SUP.auraZap = rand(0.16, 0.3);
          const a = rand(0, Math.PI * 2), b = a + rand(0.8, 1.8);
          lightning(new V3(c.x + Math.cos(a) * 1.1, player.pos.y + rand(0.1, 0.8), c.z + Math.sin(a) * 1.1), new V3(c.x + Math.cos(b) * 1.1, player.pos.y + rand(0.1, 0.9), c.z + Math.sin(b) * 1.1), c1, c2, { life: 0.14, size: 0.18 });
        }
        // まわりの的に、少しずつダメージ
        SUP.auraTick -= dt;
        if (SUP.auraTick <= 0) {
          SUP.auraTick = spec.tick || 0.5;
          for (const t of targets) {
            if (!t.alive || t.isSelf || t === spec.casterT) continue;
            if (t.center.distanceTo(c) < (spec.radius || 3) + t.r) {
              const dealt = hitTarget(t, spec.dmg, spec, { dir: t.center.clone().sub(c), noCrit: true });
              if (dealt > 0) SUP.auraHits++;
              if (ZAPPY[spec.element]) lightning(c.clone(), t.center.clone(), c1, c2, { life: 0.18, size: 0.25 });
              else FX.emit(t.center, { count: 10, c1, c2, speed: 4, life: 0.3, size: 0.3, drag: 4, rainbow: spec.rainbow });
            }
          }
        }
      }
      if (SUP.auraT === 0) SUP.auraSpec = null;
    }
  }
  // 足の速さの倍率（纏い・迅速・飛翔）
  function moveBoost() {
    let k = 1;
    if (SUP.auraT > 0 && SUP.auraSpec) k *= SUP.auraSpec.moveMul || 1.3;
    if (SUP.hasteT > 0) k *= HASTE_MUL;
    if (SUP.flyT > 0) k *= FLY_SPEED;
    return k;
  }
  G.moveBoost = moveBoost;
  // 障壁の残りが少ない（ひびが入る）: 残り 35% 未満か、残り時間 1.2 秒未満
  const wardLow = () => SUP.shield > 0 && (SUP.shield / Math.max(1, SUP.shieldMax) < 0.35 || SUP.shieldT < 1.2);
  G.wardLow = wardLow;

  // ======================================================================
  //  障壁の形（第22版）: 壁・城壁・ドームは、その場に残る「魔法の壁」（W.addBarrier で当たり判定に入る）。
  //  大盾（体の前）と球（体のまわり）は、今までどおり SUP.shield で受けるダメージを吸い取る
  // ======================================================================
  const barrierList = [];   // 立っている魔法の壁・ドーム
  const barrierSeq = {};    // 同じ魔法から立てた壁の数（相手の画面と同じ番号をつけるため）
  let castSerial = 0;       // 自分が放った魔法の通し番号（相手の画面で、同じ壁を指すため）
  let castN = 0;            // いま発動している魔法の通し番号（相手の魔法を再現しているときは、相手の番号）
  const ownerKey = (spec) => (spec && spec.remote) || 'me'; // 魔法を放った人（自分は 'me'、相手はその ID）
  const SOLID_EL = { earth: 1, metal: 1, ice: 1, crystal: 1 }; // 見た目が「物」の壁になる属性（それ以外は光の網目の壁）
  let hexTexC = null;
  function hexTexture() {
    if (hexTexC) return hexTexC;
    // とがった頂点が上下の六角形を並べた模様（横 2 つ・縦 4 段で、端がつながる）
    hexTexC = FX.canvasTex(128, 222, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.strokeStyle = '#ffffff'; g.lineWidth = 4;
      const R = 37;
      for (let j = -1; j <= 4; j++) for (let i = -1; i <= 2; i++) {
        const cx = i * 64 + (j % 2 ? 32 : 0), cy = j * 55.5;
        g.beginPath();
        for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + (k * Math.PI) / 3; const x = cx + R * Math.cos(a) * 0.86, y = cy + R * Math.sin(a) * 0.86; if (k) g.lineTo(x, y); else g.moveTo(x, y); }
        g.closePath(); g.stroke();
      }
    });
    hexTexC.wrapS = hexTexC.wrapT = THREE.RepeatWrapping;
    return hexTexC;
  }
  // 壁の見た目: 岩・鋼・氷・晶は「物」の壁、ほかの属性は六角形の網目が光る壁
  function makeWallMesh(w, h, t, spec) {
    const [c1, c2] = colorsOf(spec), e = spec.element, base = new THREE.Color(c1);
    const g = new THREE.Group(); const mats = [];
    if (SOLID_EL[e]) {
      const geo = new THREE.BoxGeometry(w, h, t, Math.max(2, Math.round(w * 1.6)), Math.max(2, Math.round(h * 1.6)), 1);
      if (e === 'earth') { const pa = geo.attributes.position; for (let i = 0; i < pa.count; i++) { const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i); pa.setXYZ(i, x + rand(-0.05, 0.05), y + rand(-0.05, 0.05), z * (0.75 + Math.random() * 0.5)); } geo.computeVertexNormals(); }
      const mat = e === 'earth' ? new THREE.MeshStandardMaterial({ color: new THREE.Color('#6e5238').lerp(base, 0.25), roughness: 0.95, flatShading: true, emissive: base, emissiveIntensity: 0.06 })
        : e === 'metal' ? new THREE.MeshStandardMaterial({ color: 0xa8b2c2, metalness: 0.85, roughness: 0.32, emissive: base, emissiveIntensity: 0.06 })
        : e === 'ice' ? new THREE.MeshStandardMaterial({ color: 0x8fd8ff, roughness: 0.05, metalness: 0.3, emissive: 0x2a8cff, emissiveIntensity: 0.45 })
        : new THREE.MeshStandardMaterial({ color: base, roughness: 0.2, metalness: 0.2, emissive: base, emissiveIntensity: 0.45, flatShading: true });
      mat.transparent = true; mat.opacity = e === 'ice' ? 0.72 : e === 'crystal' ? 0.85 : 1;
      mats.push(mat); g.add(new THREE.Mesh(geo, mat));
      // 氷と晶は、ふちが白く光る（透きとおった板に見えるように）
      if (e === 'ice' || e === 'crystal') {
        const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, t)), new THREE.LineBasicMaterial({ color: e === 'ice' ? 0xe8fbff : c2, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
        g.add(edge); mats.push(edge.material);
        const frost = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.96, h * 0.96), new THREE.MeshBasicMaterial({ map: hexTexture(), color: e === 'ice' ? 0xbff0ff : c1, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
        frost.position.z = t * 0.52; g.add(frost); mats.push(frost.material);
      }
    } else {
      const tex = hexTexture().clone(); tex.needsUpdate = true; tex.repeat.set(w / 1.4, h / 1.25);
      const net = new THREE.MeshBasicMaterial({ map: tex, color: c1, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const fill = new THREE.MeshBasicMaterial({ color: c1, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      g.add(new THREE.Mesh(new THREE.BoxGeometry(w, h, t), fill));
      [-1, 1].forEach((sd) => { const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), net); p.position.z = sd * t * 0.51; g.add(p); });
      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, t)), new THREE.LineBasicMaterial({ color: c2, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
      g.add(edge);
      mats.push(net, fill, edge.material);
    }
    mats.forEach((m) => { m.userData.op0 = m.opacity; m.userData.ei0 = m.emissiveIntensity || 0; });
    g.userData.mats = mats;
    return g;
  }
  // o: { shape: 'wall' | 'dome', x, z, yaw, w, h, t, R, spec, hp, dur, owner, id }
  function spawnBarrier(o) {
    const gy = W.heightAt(o.x, o.z);
    const [c1, c2] = colorsOf(o.spec);
    let mesh, half = null;
    if (o.shape === 'wall') {
      mesh = makeWallMesh(o.w, o.h, o.t, o.spec);
      mesh.rotation.y = o.yaw; mesh.scale.y = 0.05; mesh.position.set(o.x, gy + o.h * 0.025, o.z);
      half = [o.w / 2, o.h / 2, o.t / 2];
      const solid = SOLID_EL[o.spec.element];
      FX.emit(new V3(o.x, gy + 0.2, o.z), { count: 34, c1: solid ? '#8a7a68' : c1, c2: solid ? c1 : c2, speed: 4, up: 4, gravity: 10, life: 0.8, size: 0.35, jitter: o.w * 0.4 });
    } else {
      mesh = makeWardMesh(o.R, c1);
      mesh.material.uniforms.uAlpha.value = 0;
      mesh.position.set(o.x, gy, o.z); mesh.scale.setScalar(0.3);
      FX.ring(new V3(o.x, gy + 0.08, o.z), c1, 0.5, o.R, 0.5);
    }
    const wb = W.addBarrier({ shape: o.shape, mesh, half, R: o.R, owner: o.owner });
    const b = { wb, shape: o.shape, spec: o.spec, hp: o.hp, maxHp: o.hp, t: 0, dur: o.dur, id: o.id, owner: o.owner, hitT: 0, gy, h: o.h || 0 };
    wb.game = b;
    barrierList.push(b);
    if (AU.barrier) AU.barrier(o.spec.element, o.shape, ap(mesh.position));
    return b;
  }
  function removeBarrier(b) {
    W.removeBarrier(b.wb); disposeTree(b.wb.mesh);
    const i = barrierList.indexOf(b); if (i >= 0) barrierList.splice(i, 1);
  }
  // 魔法の壁にダメージ（立てた人の魔法は当たらない）。こわれると、属性の衝撃を放つ
  function damageBarrier(b, d, from, spec) {
    if (!b || b.dead || ownerKey(spec) === b.owner) return 0;
    d = Math.max(1, Math.round(d * ((spec && spec.mult) || 1)));
    b.hp -= d; b.hitT = 1;
    if (b.shape === 'dome' && from) { const U = b.wb.mesh.material.uniforms; U.uHitDir.value.copy(from).sub(b.wb.mesh.position).normalize(); }
    if (from) popup(from.clone().add(new V3(0, 0.5, 0)), String(d), 'ward');
    if (b.hp <= 0) breakBarrier(b, true);
    return d;
  }
  function breakBarrier(b, shock) {
    if (b.dead) return; b.dead = true;
    const c = b.wb.mesh.position.clone(); if (b.shape === 'dome') c.y += b.wb.R * 0.45;
    const [c1] = colorsOf(b.spec);
    shatterFx(c, c1, b.shape === 'dome' ? b.wb.R * 0.6 : 1.4);
    if (b.shape === 'wall' && SOLID_EL[b.spec.element]) FX.emit(c, { count: 40, c1: '#7a7468', c2: c1, speed: 6, up: 4, gravity: 14, life: 1.1, size: 0.35, jitter: b.wb.half[0] * 0.8 });
    if (shock) explode(c, Math.min(6, b.spec.radius || 4), (b.spec.dmg || 0) * 0.3, Object.assign({}, b.spec, b.owner === 'me' ? { casterT: selfT } : { remote: b.owner }), null, { noBarrier: true });
    if (b.owner === 'me' && M.on && G.onFx) G.onFx({ k: 'barBreak', id: String(b.id).split(':').slice(1).join(':') });
    removeBarrier(b);
  }
  function updateBarriers(dt) {
    for (let i = barrierList.length - 1; i >= 0; i--) {
      const b = barrierList[i], m = b.wb.mesh;
      b.t += dt; b.hitT = Math.max(0, b.hitT - dt * 2.5);
      const rise = Math.min(1, b.t / 0.28), ease = 1 - Math.pow(1 - rise, 3);
      const fade = b.t > b.dur - 0.5 ? Math.max(0, (b.dur - b.t) / 0.5) : 1;
      const low = b.hp / b.maxHp < 0.35 || b.dur - b.t < 1.2;
      if (b.shape === 'wall') {
        m.scale.y = Math.max(0.05, ease); m.position.y = b.gy + b.h * m.scale.y / 2;
        const flick = low ? 0.55 + 0.45 * Math.abs(Math.sin(st.time * 18 + i)) : 1;
        m.userData.mats.forEach((mat) => { mat.opacity = mat.userData.op0 * fade * flick; if (mat.emissive) mat.emissiveIntensity = mat.userData.ei0 + b.hitT * 0.9; });
      } else {
        const U = m.material.uniforms;
        U.uTime.value = st.time; U.uAlpha.value = Math.min(1, rise * 1.3) * fade * 0.9; U.uHit.value = b.hitT; U.uLow.value = low ? 1 : 0;
        m.scale.setScalar(0.3 + 0.7 * ease);
      }
      if (b.t >= b.dur) {
        FX.emit(m.position.clone().add(new V3(0, b.shape === 'dome' ? b.wb.R * 0.4 : 0, 0)), { count: 24, c1: colorsOf(b.spec)[0], c2: '#ffffff', speed: 2, up: 1.5, life: 0.6, size: 0.3, drag: 2 });
        removeBarrier(b);
      }
    }
  }
  function clearBarriers() { barrierList.slice().forEach((b) => removeBarrier(b)); W.clearBarriers(); for (const k in barrierSeq) delete barrierSeq[k]; }
  // 大盾: 撃った人が自分の前（左右 75° 以内）にいるときだけ吸い取る
  function fromFront() {
    const src = lastHitPos ? { pos: lastHitPos } : lastHitFrom ? avatars.get(lastHitFrom) : null;
    if (!src) return false;
    const v = new V3(src.pos.x - player.pos.x, 0, src.pos.z - player.pos.z); if (v.lengthSq() < 1e-4) return true;
    v.normalize();
    return v.x * -Math.sin(player.yaw) + v.z * -Math.cos(player.yaw) > 0.26;
  }

  // ======================================================================
  //  召喚獣（第22版）: 的と同じ一覧（targets）に入れ、弾・爆発・光線の当たり判定をそのまま使う。
  //  自分の召喚獣は自分の画面で動かし、位置と HP を相手に送る。相手の召喚獣は、届いた位置に置くだけ（puppet）。
  //  召喚獣の攻撃のダメージも「撃った人（召喚した人）の画面」で決まる。相手の召喚獣に当てたダメージは、その持ち主に送る
  // ======================================================================
  const SUMMON_MAX = 3;
  const SUMMON_TYPES = ['golem', 'spirit', 'beast', 'wisp', 'titan'];
  let summonSerial = 0;
  const friendly = (t, spec) => !!(t && t.isSummon && t.ownerKey === ownerKey(spec)); // 自分の召喚獣（自分の魔法は当たらない）
  function makeSummonModel(type, c1, c2, mats) {
    const g = new THREE.Group(), parts = {};
    const std = (o) => { const m = new THREE.MeshStandardMaterial(o); m.userData.baseEmissive = new THREE.Color(o.emissive || 0); m.userData.baseInt = o.emissiveIntensity == null ? 1 : o.emissiveIntensity; mats.push(m); return m; };
    const C1 = new THREE.Color(c1), C2 = new THREE.Color(c2);
    const box = (w, h, d, mat, x, y, z, parent) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x || 0, y || 0, z || 0); (parent || g).add(m); return m; };
    const pivot = (x, y, z, parent) => { const p = new THREE.Group(); p.position.set(x, y, z); (parent || g).add(p); return p; };
    if (type === 'golem') {
      // 岩の巨人: 太い腕と脚、胸に属性の色の核、光る目
      const stone = std({ color: new THREE.Color('#403d48').lerp(C1, 0.22), roughness: 0.9, flatShading: true, emissive: C1, emissiveIntensity: 0.1 });
      const glow = std({ color: C2, emissive: C1, emissiveIntensity: 1.3, flatShading: true });
      box(1.7, 1.45, 1.1, stone, 0, 1.75, 0);
      box(1.2, 0.5, 0.9, stone, 0, 1.0, 0);
      const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.26, 0), glow); core.position.set(0, 1.85, 0.6); g.add(core); parts.core = core;
      const head = pivot(0, 2.5, 0.1); box(0.85, 0.7, 0.8, stone, 0, 0.35, 0, head);
      [-0.2, 0.2].forEach((x) => box(0.17, 0.09, 0.05, glow, x, 0.4, 0.41, head));
      [-1, 1].forEach((sd) => { const r = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 0), stone); r.position.set(sd * 0.95, 2.45, 0); g.add(r); });
      parts.legs = [-0.45, 0.45].map((x) => { const p = pivot(x, 0.95, 0); box(0.58, 0.95, 0.68, stone, 0, -0.47, 0, p); return p; });
      parts.arms = [-1, 1].map((sd) => { const p = pivot(sd * 1.15, 2.3, 0); box(0.52, 1.35, 0.58, stone, 0, -0.65, 0, p); box(0.72, 0.6, 0.72, stone, 0, -1.45, 0.05, p); return p; });
      parts.glow = FX.glowSprite(c1, 1.4); parts.glow.position.copy(core.position); g.add(parts.glow);
      // 体に走る、属性の色の光る筋（練習場の石像と見分けやすいように）
      [[-0.5, 1.75, 0.56, 0.07, 0.9], [0.5, 1.75, 0.56, 0.07, 0.9], [0, 1.25, 0.56, 0.9, 0.06], [0, 2.3, 0.56, 1.2, 0.06]].forEach(([x, y, z, w, h]) => box(w, h, 0.03, glow, x, y, z));
      parts.arms.forEach((a) => box(0.6, 0.08, 0.62, glow, 0, -1.05, 0, a));
    } else if (type === 'beast') {
      // 四つ足の獣: 背中に属性の色のたてがみ、光る目
      const fur = std({ color: new THREE.Color('#2a2630').lerp(C1, 0.45), roughness: 0.75, flatShading: true, emissive: C1, emissiveIntensity: 0.15 });
      const glow = std({ color: C2, emissive: C1, emissiveIntensity: 1.4, flatShading: true });
      box(0.66, 0.58, 1.45, fur, 0, 0.88, -0.05);
      box(0.74, 0.7, 0.55, fur, 0, 0.98, 0.5);
      const head = pivot(0, 1.12, 0.88); parts.head = head;
      box(0.48, 0.44, 0.52, fur, 0, 0, 0.1, head); box(0.3, 0.24, 0.36, fur, 0, -0.07, 0.46, head);
      [-0.13, 0.13].forEach((x) => box(0.08, 0.06, 0.04, glow, x, 0.07, 0.37, head));
      [-1, 1].forEach((sd) => { const ear = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.28, 4), fur); ear.position.set(sd * 0.16, 0.3, 0); head.add(ear); });
      for (let k = 0; k < 5; k++) { const sp = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.34, 4), glow); sp.position.set(0, 1.25, 0.45 - k * 0.3); sp.rotation.x = -0.5; g.add(sp); }
      const tail = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.8, 5), glow); tail.position.set(0, 1.02, -0.95); tail.rotation.x = -2.1; g.add(tail); parts.tail = tail;
      parts.legs = [[-0.24, 0.5], [0.24, 0.5], [-0.24, -0.55], [0.24, -0.55]].map(([x, z]) => { const p = pivot(x, 0.72, z); box(0.17, 0.74, 0.2, fur, 0, -0.36, 0, p); return p; });
    } else if (type === 'spirit') {
      // 精霊: 宙に浮かぶ光の核と、まわりを回るかけら。下に光の尾
      const core = std({ color: C2, emissive: C1, emissiveIntensity: 1.6, flatShading: true });
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 0), core); g.add(m); parts.core = m;
      const tail = new THREE.Mesh(new THREE.ConeGeometry(0.32, 1.1, 8, 1, true), new THREE.MeshBasicMaterial({ color: c1, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
      tail.rotation.x = Math.PI; tail.position.y = -0.75; g.add(tail);
      parts.glow = FX.glowSprite(c1, 3.2); g.add(parts.glow);
      const orbit = new THREE.Group(); g.add(orbit); parts.orbit = orbit;
      for (let k = 0; k < 3; k++) { const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.15, 0), core); const a = (k / 3) * Math.PI * 2; s.position.set(Math.cos(a) * 0.85, Math.sin(a * 2) * 0.15, Math.sin(a) * 0.85); orbit.add(s); }
    } else if (type === 'titan') {
      // 巨神（高さ約 8m）: 黒い鎧に金のふち、属性の色に光る目・胸の核・腕の紋、背中の光輪、後ろへ反った角
      const armor = std({ color: new THREE.Color('#14151d').lerp(C1, 0.05), roughness: 0.5, metalness: 0.3, flatShading: true, emissive: new THREE.Color('#06060c'), emissiveIntensity: 1 });
      const gold = std({ color: 0xe8a422, roughness: 0.35, metalness: 0.4, flatShading: true, emissive: 0x8a5200, emissiveIntensity: 0.6 });
      const glow = std({ color: C2, emissive: C1, emissiveIntensity: 1.9, flatShading: true });
      box(2.2, 0.7, 1.4, armor, 0, 3.1, 0);           // 腰
      box(2.4, 0.16, 1.5, gold, 0, 3.47, 0);          // 帯
      box(2.0, 1.0, 1.3, armor, 0, 3.95, 0);          // 腹
      box(3.3, 1.7, 1.8, armor, 0, 5.15, 0);          // 胸
      box(3.45, 0.16, 1.9, gold, 0, 4.35, 0);         // 胸の下のふち
      [-1, 1].forEach((sd) => { const pec = box(1.55, 0.95, 0.3, armor, sd * 0.78, 5.35, 0.86); pec.rotation.z = sd * 0.22; pec.rotation.y = -sd * 0.12; }); // 胸板（逆三角に見えるように）
      box(1.5, 1.0, 0.22, gold, 0, 5.2, 0.98);        // 胸当て
      [-1, 1].forEach((sd) => box(0.1, 1.2, 0.04, glow, sd * 1.25, 5.1, 1.02));
      const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0), glow); core.position.set(0, 5.25, 1.16); g.add(core); parts.core = core;
      // 肩鎧（金のふちと角）
      [-1, 1].forEach((sd) => {
        const sp = pivot(sd * 2.05, 5.75, 0);
        const pad = new THREE.Mesh(new THREE.SphereGeometry(0.95, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), armor); pad.scale.set(1.2, 0.85, 1.05); sp.add(pad);
        const rim = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.08, 6, 18), gold); rim.rotation.x = Math.PI / 2; rim.scale.set(1.2, 1.05, 1); sp.add(rim);
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.95, 5), gold); spike.position.set(sd * 0.4, 0.8, 0); spike.rotation.z = -sd * 0.55; sp.add(spike);
      });
      // 兜: 光る目のすき間、鼻当て、とさか、後ろへ反った2本の角
      const head = pivot(0, 6.15, 0.1); parts.head = head;
      box(0.95, 0.95, 1.0, armor, 0, 0.5, 0, head);
      box(1.05, 0.14, 1.08, gold, 0, 0.84, 0, head);
      box(0.78, 0.1, 0.06, glow, 0, 0.52, 0.51, head);
      box(0.12, 0.42, 0.06, gold, 0, 0.24, 0.53, head);
      box(0.12, 0.42, 0.95, gold, 0, 1.08, -0.05, head);
      [-1, 1].forEach((sd) => { const h = new THREE.Mesh(new THREE.ConeGeometry(0.13, 1.35, 6), gold); h.position.set(sd * 0.52, 1.1, -0.15); h.rotation.z = -sd * 0.5; h.rotation.x = -0.55; head.add(h); });
      // 背中の赤いマント（歩くとゆれる）
      const capeGeo = new THREE.PlaneGeometry(3.0, 5.0, 1, 8); capeGeo.translate(0, -2.5, 0);
      const cp = capeGeo.attributes.position; for (let i = 0; i < cp.count; i++) { const y = cp.getY(i); cp.setX(i, cp.getX(i) * (1 + -y * 0.08)); cp.setZ(i, -Math.pow(-y / 5, 1.6) * 0.9); }
      capeGeo.computeVertexNormals();
      const cape = new THREE.Mesh(capeGeo, std({ color: 0x7a0f1e, roughness: 0.8, emissive: 0x2a0408, emissiveIntensity: 1, side: THREE.DoubleSide }));
      cape.position.set(0, 5.95, -1.0); g.add(cape); parts.cape = cape;
      box(3.2, 0.2, 0.3, gold, 0, 5.95, -0.95); // マントの留め金
      // 背中の光輪と紋様
      const halo = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.07, 8, 48), glow); halo.position.set(0, 6.75, -0.8); g.add(halo); parts.halo = halo;
      const rune = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 2.7), new THREE.MeshBasicMaterial({ map: FX.circleTex, color: c1, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      rune.position.set(0, 6.75, -0.82); g.add(rune); parts.rune = rune;
      // 腕（上腕・光る紋・籠手・大きな拳）
      parts.arms = [-1, 1].map((sd) => {
        const p = pivot(sd * 2.2, 5.5, 0);
        box(0.78, 1.5, 0.82, armor, 0, -0.8, 0, p);
        box(0.86, 0.14, 0.9, glow, 0, -1.48, 0, p);
        box(1.0, 1.35, 1.0, armor, 0, -2.25, 0.05, p);
        box(1.06, 0.18, 1.06, gold, 0, -1.66, 0.05, p);
        box(1.12, 0.9, 1.12, gold, 0, -3.28, 0.08, p);
        return p;
      });
      // 脚（太もも・金の膝当て・すね・足）
      parts.legs = [-0.68, 0.68].map((x) => {
        const p = pivot(x, 2.92, 0);
        box(0.98, 1.5, 1.02, armor, 0, -0.75, 0, p);
        box(0.72, 0.5, 0.4, gold, 0, -1.5, 0.52, p);
        box(0.88, 1.4, 0.96, armor, 0, -2.2, 0, p);
        box(0.08, 1.0, 0.03, glow, 0, -2.15, 0.5, p);
        box(1.02, 0.36, 1.5, armor, 0, -2.74, 0.2, p);
        return p;
      });
      // 体のまわりを回る、光る紋のかけら
      const orbit = new THREE.Group(); orbit.position.y = 4.6; g.add(orbit); parts.orbit = orbit;
      for (let k = 0; k < 5; k++) { const sh = new THREE.Mesh(new THREE.OctahedronGeometry(0.24, 0), glow); const a = (k / 5) * Math.PI * 2; sh.position.set(Math.cos(a) * 3.3, Math.sin(a * 2) * 0.5, Math.sin(a) * 3.3); sh.scale.y = 1.7; orbit.add(sh); }
      parts.glow = FX.glowSprite(c1, 3.4); parts.glow.position.copy(core.position); g.add(parts.glow);
    } else {
      // 使い魔: 小さな光の玉
      const core = std({ color: C2, emissive: C1, emissiveIntensity: 1.8 });
      g.add(new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 8), core));
      parts.glow = FX.glowSprite(c1, 1.5); g.add(parts.glow);
    }
    // 足もとの召喚紋（属性の色の魔法陣。自分や相手の召喚獣だとひと目でわかるように）
    if (type === 'golem' || type === 'beast' || type === 'titan') {
      const rs = type === 'titan' ? 7.5 : type === 'golem' ? 3 : 2.2;
      const ring = new THREE.Mesh(new THREE.PlaneGeometry(rs, rs), new THREE.MeshBasicMaterial({ map: FX.circleTex, color: c1, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; g.add(ring); parts.ring = ring;
    }
    return { g, parts };
  }
  const SUM_CY = { golem: 1.6, beast: 0.85, spirit: 0, wisp: 0, titan: 4.2 };
  const SUM_R = { golem: 1.15, beast: 0.75, spirit: 0.65, wisp: 0.35, titan: 2.4 };
  const SUM_BAR = { golem: 3.5, beast: 1.75, spirit: 1.1, wisp: 0.6, titan: 9.0 };
  // o: { type, spec, owner, puppet, sid, pos, yaw, scale, hp, life, spd }
  function makeSummon(o) {
    const S = MG.SUMMONS[o.type], [c1, c2] = colorsOf(o.spec), sc = o.scale || 1;
    const mats = [];
    const { g: model, parts } = makeSummonModel(o.type, c1, c2, mats);
    model.scale.setScalar(sc * (o.type === 'golem' ? 0.88 : 1));
    if (o.type === 'titan') model.position.y = 0.05;
    const g = new THREE.Group(); g.add(model);
    const bc = document.createElement('canvas'); bc.width = 128; bc.height = 16;
    const btex = new THREE.CanvasTexture(bc);
    const bar = new THREE.Sprite(new THREE.SpriteMaterial({ map: btex, depthTest: false, transparent: true }));
    bar.scale.set(o.type === 'wisp' ? 0.8 : o.type === 'titan' ? 3 : 1.5, o.type === 'titan' ? 0.26 : 0.16, 1); bar.renderOrder = 20; bar.position.y = SUM_BAR[o.type] * sc; g.add(bar);
    const T = { cy: SUM_CY[o.type] * sc, r: SUM_R[o.type] * sc };
    const t = {
      type: 'summon', isSummon: true, kind: o.type, S, T, spec: o.spec, ownerKey: o.owner, puppet: !!o.puppet, sid: o.sid,
      group: g, face: model, parts, mats, hp: o.hp, maxHp: o.hp, r: T.r, pts: 0, home: o.pos.clone(), pos: o.pos.clone(), center: new V3(),
      floatY: 0, phase: rand(0, 10), moveDir: new V3(1, 0, 0), disp: new V3(), dispV: new V3(), mass: { golem: 0.3, beast: 0.8, spirit: 0.6, wisp: 0.5, titan: 0.06 }[o.type],
      burnT: 0, burnDps: 0, burnAcc: 0, burnPop: 0, freezeT: 0, frozenHard: false, vulnT: 0, flash: 0, alive: true, dead: 0, spawnT: 0,
      bar, bc, btex, id: 's' + Math.random().toString(36).slice(2, 7), slot: -1,
      life: o.life || 15, yaw: o.yaw || 0, netPos: o.pos.clone(), netYaw: o.yaw || 0, netSeen: 0, atkT: 0.7, animT: 0, walk: 0, tgt: null, retarget: 0,
      born: st.time, scale: sc, vy: 0, lunge: 0, spd: o.spd || 1, slotSide: 2.4,
    };
    g.position.copy(t.pos); g.scale.setScalar(0.01);
    scene.add(g);
    updateCenter(t); drawBar(t);
    targets.push(t);
    return t;
  }
  // 召喚の魔法陣（足もとに光の輪が回り、光の柱が立つ）
  function summonCircleFx(p, spec) {
    const [c1, c2] = colorsOf(spec);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial({ map: FX.circleTex, color: c1, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.set(p.x, p.y + 0.06, p.z); scene.add(m);
    FX.emitLine(new V3(p.x, p.y + 0.2, p.z), new V3(p.x, p.y + 6, p.z), { count: 40, c1, c2, speed: 0.4, up: 2, life: 0.8, size: 0.4, drag: 1, rainbow: spec.rainbow });
    FX.flash(new V3(p.x, p.y + 1, p.z), c1, 4, 14, 0.4);
    let t = 0;
    special((dt) => {
      t += dt;
      m.material.opacity = (t < 0.3 ? t / 0.3 : Math.max(0, 1 - (t - 0.3) / 0.9)) * 0.9;
      m.rotation.z += dt * 3; m.scale.setScalar(0.6 + Math.min(1, t / 0.3) * 0.5);
      if (Math.random() < 0.6) FX.emit(new V3(p.x + rand(-1.4, 1.4), p.y + 0.1, p.z + rand(-1.4, 1.4)), { count: 1, c1, c2, speed: 0.3, up: 3, life: 0.6, size: 0.3, drag: 0.5 });
      if (t >= 1.2) { scene.remove(m); m.geometry.dispose(); m.material.dispose(); return false; }
      return true;
    }, [m]);
  }
  // 自分の召喚獣を呼び出す（type: 'golem' | 'spirit' | 'beast' | 'wisp'）
  function spawnSummon(type, spec, at) {
    const S = MG.SUMMONS[type];
    const sc = type === 'wisp' || type === 'titan' ? 1 : Math.max(0.75, Math.min(1.7, spec.size || 1));
    // 数の上限: 召喚獣は3体、使い魔と巨神は1体ずつ（古いものから消える）
    const cat = (k) => (k === 'wisp' || k === 'titan' ? k : 'normal');
    const mine = targets.filter((t) => t.isSummon && !t.puppet && t.alive && cat(t.kind) === cat(type)).sort((a, b) => a.born - b.born);
    while (mine.length >= (cat(type) === 'normal' ? SUMMON_MAX : 1)) summonDie(mine.shift(), true);
    const spd = 1 + 0.35 * (spec.mods || []).filter((m) => m === 'speed').length;
    const t = makeSummon({ type, spec, owner: 'me', sid: ++summonSerial, pos: at, yaw: player.yaw + Math.PI, scale: sc, hp: Math.round(S.hp * sc), life: type === 'wisp' ? 10 : type === 'titan' ? 25 : Math.max(4, spec.dur || 15), spd });
    if (type === 'titan') t.slotSide = 5.5;
    if (AU.summon) AU.summon(type, spec.element, ap(at));
    return t;
  }
  // 召喚獣の敵: いちばん近い、自分の側でない的・相手・相手の召喚獣
  function summonEnemy(t) {
    let best = null, bd = 32;
    for (const o of targets) {
      if (!o.alive || o === t || o.isSelf || friendly(o, t.spec) || (o.isPlayer && o.netProt)) continue;
      if (t.spec.casterT && o === t.spec.casterT) continue;
      const d = o.center.distanceTo(t.center);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }
  function boltSpecOf(t) {
    if (t.boltSpec) return t.boltSpec;
    const spec = t.spec, wisp = t.kind === 'wisp';
    t.boltSpec = Object.assign({}, spec, { form: 'bolt', dmg: wisp ? 6 : spec.dmg * t.S.dmgMul, speed: wisp ? 42 : 36, size: wisp ? 0.18 : 0.3 * t.scale, radius: wisp ? 0.6 : 1.2, homing: 1.1,
      pierce: 0, bounce: 0, split: 0, pull: 0, penetrate: 0, echo: 0, destroy: false, life: 1.4, pulses: Math.min(spec.pulses || 0, 1), rewind: 0, chainHit: wisp ? 0 : spec.chainHit });
    return t.boltSpec;
  }
  // 召喚獣の攻撃（visualOnly: 相手の召喚獣の動きを見せるだけ）
  function summonAttack(t, e, visualOnly) {
    const S = t.S, spec = t.spec, [c1, c2] = colorsOf(spec);
    t.animT = 0.45;
    const dn = e.center.clone().sub(t.center); dn.y = 0; if (dn.lengthSq() < 1e-4) dn.set(0, 0, 1); dn.normalize();
    if (t.kind === 'titan') {
      t.animT = 0.9;
      after(0.62, () => {
        if (!t.alive) return;
        const p = t.pos.clone().addScaledVector(dn, 3.4); p.y = W.heightAt(p.x, p.z);
        FX.ring(new V3(p.x, p.y + 0.1, p.z), c1, 0.5, S.slamR * 1.3, 0.45);
        FX.ring(new V3(p.x, p.y + 0.12, p.z), '#ffffff', 0.5, S.slamR * 0.9, 0.3);
        FX.emit(new V3(p.x, p.y + 0.3, p.z), { count: 70, c1: '#8a6a4a', c2: c1, speed: 9, up: 6, gravity: 16, life: 1, size: 0.45, rainbow: spec.rainbow });
        EF.impact('earth', p, 3); EF.impact(spec.element, p, 2);
        st.shake = Math.max(st.shake, 0.45 * near(p));
        AU.impact('earth', 3.5, ap(p)); H.feel('earth', 0.6 * near(p), 0.3, 0.7 * near(p));
        if (visualOnly) return;
        W.blast(new V3(p.x, p.y + 0.5, p.z), 3, 90, { crater: false });
        for (const o of targets) {
          if (!o.alive || o === t || o.isSelf || friendly(o, spec) || (o.isPlayer && o.netProt) || (spec.casterT && o === spec.casterT)) continue;
          if (Math.hypot(o.center.x - p.x, o.center.z - p.z) < S.slamR + o.r * 0.5 && o.center.y - p.y < 7) hitTarget(o, S.slam, spec, { dir: o.center.clone().sub(p) });
        }
      });
    } else if (t.kind === 'golem' || t.kind === 'beast') {
      if (t.kind === 'beast') t.lunge = 0.16;
      after(t.kind === 'golem' ? 0.24 : 0.12, () => {
        if (!t.alive) return;
        const p = e.alive ? e.center.clone() : t.center.clone().addScaledVector(dn, 2);
        FX.emit(p, { count: t.kind === 'golem' ? 30 : 16, c1, c2, speed: t.kind === 'golem' ? 7 : 4, life: 0.35, size: 0.4, drag: 4, rainbow: spec.rainbow });
        if (t.kind === 'golem') {
          FX.ring(new V3(p.x, W.heightAt(p.x, p.z) + 0.08, p.z), c1, 0.3, 2.6, 0.3);
          st.shake = Math.max(st.shake, 0.14 * near(p));
          AU.impact(spec.element, 1.4, ap(p)); EF.impact(spec.element, p, 1.3);
        } else AU.hit(spec.element, ap(p));
        if (!visualOnly && e.alive && e.center.distanceTo(t.center) < (S.range * t.scale + e.r) * 1.4) hitTarget(e, spec.dmg * S.dmgMul, spec, { dir: dn });
      });
    } else {
      const from = t.center.clone();
      spawnProj(boltSpecOf(t), from, e.center.clone().sub(from), { kind: 'bolt', life: 1.4 });
      FX.emit(from, { count: 10, c1, c2, speed: 3, life: 0.25, size: 0.25, drag: 4 });
      if (t.kind === 'spirit') AU.cast(spec.element);
    }
    if (!visualOnly && !t.puppet && M.on && G.onFx) G.onFx({ k: 'sumAtk', id: t.sid, tp: arr(e.center) });
  }
  function summonDie(t, expired) {
    if (!t.alive) return;
    t.alive = false; t.dead = 0; t.bar.visible = false;
    const [c1, c2] = colorsOf(t.spec), c = t.center.clone();
    FX.emit(c, { count: t.kind === 'golem' ? 70 : 36, c1, c2, speed: 5, up: 2, life: 0.7, size: 0.4, drag: 2, rainbow: t.spec.rainbow });
    if (t.kind === 'golem' || t.kind === 'titan') { FX.emit(c, { count: t.kind === 'titan' ? 90 : 30, c1: '#7a7468', c2: t.kind === 'titan' ? '#d9a84a' : '#c8c0b0', speed: t.kind === 'titan' ? 10 : 6, up: 4, gravity: 14, life: 1.2, size: 0.45 }); AU.crumble(ap(c)); }
    FX.flash(c, c1, 3, 10, 0.25);
    if (!expired && !t.puppet) popup(c.clone().add(new V3(0, 1, 0)), MG.SUMMONS[t.kind].label + 'が倒された', 'ward');
    if (!t.puppet && M.on && G.onFx) G.onFx({ k: 'sumDie', id: t.sid });
  }
  // 召喚獣の動きの見た目（歩く・浮かぶ・殴る・飛びかかる）
  function animateSummon(t, dt, speed) {
    const P = t.parts, k = t.animT > 0 ? t.animT / (t.kind === 'titan' ? 0.9 : 0.45) : 0;
    t.animT = Math.max(0, t.animT - dt);
    t.walk += dt * Math.min(10, speed) * (t.kind === 'beast' ? 1.6 : t.kind === 'titan' ? 0.55 : 1.1);
    if (t.kind === 'golem' || t.kind === 'titan' || t.kind === 'beast') stepSound(t, t.kind === 'beast' ? 'soft' : 'heavy', t.kind === 'titan' ? 1.8 : t.kind === 'golem' ? 0.9 : 0.8, speed);
    const sw = speed > 0.3 ? Math.sin(t.walk) : 0;
    t.face.rotation.y = t.yaw;
    if (t.kind === 'golem') {
      P.legs[0].rotation.x = sw * 0.5; P.legs[1].rotation.x = -sw * 0.5;
      const punch = k > 0 ? Math.sin((1 - k) * Math.PI) : 0;
      P.arms[0].rotation.x = -sw * 0.4 - punch * 1.9; P.arms[1].rotation.x = sw * 0.4 - punch * 1.6;
      t.face.position.y = Math.abs(sw) * 0.06;
      P.core.rotation.y += dt * 2;
      P.ring.rotation.z += dt * 0.8;
    } else if (t.kind === 'titan') {
      P.legs[0].rotation.x = sw * 0.35; P.legs[1].rotation.x = -sw * 0.35;
      // 両腕を振り上げて（0.5 秒）、一気にたたきつける（0.4 秒）
      const lift = k > 0 ? (k > 0.45 ? (1 - k) / 0.55 : k / 0.45) : 0;
      P.arms[0].rotation.x = -sw * 0.3 - lift * 2.7; P.arms[1].rotation.x = sw * 0.3 - lift * 2.7;
      P.head.rotation.x = -lift * 0.25;
      t.face.position.y = Math.abs(sw) * 0.1;
      P.cape.rotation.x = -0.08 - Math.abs(sw) * 0.12 - lift * 0.25 + Math.sin(st.time * 1.7 + t.phase) * 0.04;
      P.core.rotation.y += dt * 1.5; P.halo.rotation.z += dt * 0.6; P.rune.rotation.z -= dt * 0.4; P.orbit.rotation.y += dt * 0.9; P.ring.rotation.z += dt * 0.5;
      P.glow.scale.setScalar(3.4 + Math.sin(st.time * 3 + t.phase) * 0.3 + lift * 1.5);
    } else if (t.kind === 'beast') {
      P.legs.forEach((l, i) => (l.rotation.x = (i === 0 || i === 3 ? sw : -sw) * 0.7));
      P.head.rotation.x = k > 0 ? -Math.sin((1 - k) * Math.PI) * 0.6 : Math.sin(st.time * 2 + t.phase) * 0.05;
      P.tail.rotation.z = Math.sin(st.time * 6 + t.phase) * 0.4;
      t.face.position.y = Math.abs(sw) * 0.08 + (t.lunge > 0 ? 0.25 : 0);
      P.ring.rotation.z += dt * 1.2; P.ring.position.y = 0.05 - t.face.position.y / t.scale;
    } else if (t.kind === 'spirit') {
      P.orbit.rotation.y += dt * (2 + (k > 0 ? 6 : 0));
      P.core.rotation.x += dt * 1.3; P.core.rotation.y += dt * 1.9;
      P.glow.scale.setScalar(3.2 + Math.sin(st.time * 5 + t.phase) * 0.3 + k * 1.5);
    } else {
      P.glow.scale.setScalar(1.5 + Math.sin(st.time * 7 + t.phase) * 0.2 + k * 0.8);
    }
  }
  // 戻り値 true: 消え終わったので一覧から外す
  function updateSummon(t, dt) {
    if (!t.alive) {
      t.dead += dt;
      t.group.scale.setScalar(Math.max(0.001, 1 - t.dead / 0.45));
      t.group.position.y += dt * (t.kind === 'golem' ? -1.2 : 1.2);
      return t.dead > 0.45;
    }
    t.spawnT = Math.min(1, t.spawnT + dt * 2.5);
    t.group.scale.setScalar(Math.max(0.01, t.spawnT < 1 ? 1 - Math.pow(1 - t.spawnT, 3) : 1));
    if (t.flash > 0) t.flash -= dt;
    const [c1, c2] = colorsOf(t.spec);
    let speed = 0;
    if (t.puppet) {
      const k = Math.min(1, dt * 10), before = t.pos.clone();
      if (t.pos.distanceTo(t.netPos) > 10) t.pos.copy(t.netPos); else t.pos.lerp(t.netPos, k);
      let dy = t.netYaw - t.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); t.yaw += dy * k;
      speed = before.distanceTo(t.pos) / Math.max(dt, 1e-4);
      t.netSeen += dt;
      if (t.netSeen > 2) summonDie(t, true); // 持ち主から状態が届かなくなった
    } else {
      t.life -= dt;
      if (t.life <= 0) { summonDie(t, true); return false; }
      // 燃焼・凍結
      if (t.burnT > 0) { t.burnT -= dt; t.burnAcc += t.burnDps * dt; if (t.burnAcc >= 4) { const d = Math.floor(t.burnAcc); t.burnAcc -= d; damage(t, d, null, false); if (!t.alive) return false; } }
      if (t.freezeT > 0) { t.freezeT -= dt; if (t.freezeT <= 0) t.frozenHard = false; }
      if (t.vulnT > 0) t.vulnT -= dt;
      const slow = t.freezeT > 0 ? (t.frozenHard ? 0.15 : 0.5) : 1;
      t.retarget -= dt;
      if (t.retarget <= 0 || !t.tgt || !t.tgt.alive) { t.tgt = summonEnemy(t); t.retarget = 0.4; }
      const S = t.S, e = t.tgt, spd = S.speed * t.spd * slow;
      const ow = player.pos;
      if (t.kind === 'wisp') {
        // 主の肩のあたりを回る
        const a = st.time * 1.7 + t.phase;
        const goal = new V3(ow.x + Math.cos(a) * 1.3, ow.y + 2.15 + Math.sin(a * 2) * 0.15, ow.z + Math.sin(a) * 1.3);
        const before = t.pos.clone();
        t.pos.lerp(goal, Math.min(1, dt * 6));
        speed = before.distanceTo(t.pos) / Math.max(dt, 1e-4);
        if (e) t.yaw = Math.atan2(e.center.x - t.pos.x, e.center.z - t.pos.z);
      } else {
        let goal, want = 0;
        if (e) {
          goal = e.center;
          const dist = Math.hypot(goal.x - t.pos.x, goal.z - t.pos.z);
          if (t.kind === 'spirit') want = dist > 14 ? 1 : dist < 7 ? -0.6 : 0;
          else want = dist > S.range * t.scale + e.r * 0.8 ? 1 : 0;
        } else {
          // 敵がいないときは、主の横（少し後ろ）に控える
          const sx = Math.cos(player.yaw), sz = -Math.sin(player.yaw);
          goal = new V3(ow.x + sx * t.slotSide + Math.sin(player.yaw) * 1.6, ow.y, ow.z + sz * t.slotSide + Math.cos(player.yaw) * 1.6);
          want = Math.hypot(goal.x - t.pos.x, goal.z - t.pos.z) > 1.3 ? 1 : 0;
        }
        const dir = new V3(goal.x - t.pos.x, 0, goal.z - t.pos.z), L = dir.length();
        const before = t.pos.clone();
        let stepLen = 0;
        if (L > 0.05) {
          dir.multiplyScalar(1 / L);
          // 岩や壁にぶつかって進めないときは、しばらく横へ回りこむ
          if (t.detourT > 0) dir.applyAxisAngle(UP, t.detourSign * 1.25);
          let dy = Math.atan2(dir.x, dir.z) - t.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
          t.yaw += Math.sign(dy) * Math.min(Math.abs(dy), dt * 7);
          if (want) {
            const v = spd * (t.lunge > 0 ? 3.2 : 1) * (e && !t.lunge && want > 0 && L > 20 ? 1.3 : 1);
            stepLen = Math.min(v * dt, want > 0 ? L : v * dt);
            t.pos.addScaledVector(dir, stepLen * Math.sign(want));
            speed = v;
          }
        }
        t.detourT = Math.max(0, (t.detourT || 0) - dt);
        if (t.dispV.lengthSq() > 1e-3) { t.pos.addScaledVector(t.dispV, dt); t.dispV.multiplyScalar(Math.exp(-4 * dt)); }
        const b = W.bound(), r = Math.hypot(t.pos.x, t.pos.z); if (r > b) { t.pos.x *= b / r; t.pos.z *= b / r; }
        if (t.kind === 'spirit') {
          const fy = W.floorAt(t.pos.x, t.pos.z, t.pos.y + 3) + 2.4 + Math.sin(st.time * 2 + t.phase) * 0.25;
          t.pos.y += (fy - t.pos.y) * Math.min(1, dt * 4);
        } else {
          W.pushOut(t.pos, t.r * 0.8);
          // 進もうとしたのに、ほとんど進めなかった（地形に押し戻された）
          if (stepLen > 0.01 && Math.hypot(t.pos.x - before.x, t.pos.z - before.z) < stepLen * 0.35) {
            t.stuck = (t.stuck || 0) + dt;
            if (t.stuck > 0.25 && !(t.detourT > 0)) { t.detourT = 1.0; t.detourSign = t.detourSign || (Math.random() < 0.5 ? -1 : 1); t.stuck = 0; }
          } else t.stuck = 0;
          const fl = W.floorAt(t.pos.x, t.pos.z, t.pos.y + (t.kind === 'beast' ? 0.6 : 0.3));
          t.vy -= 20 * dt; t.pos.y += t.vy * dt;
          if (t.pos.y <= fl) { t.pos.y = fl; t.vy = 0; }
        }
      }
      t.lunge = Math.max(0, t.lunge - dt);
      t.atkT -= dt * slow;
      if (e && e.alive && t.atkT <= 0) {
        const reach = t.kind === 'spirit' || t.kind === 'wisp' ? S.range : S.range * t.scale + e.r;
        // 巨神は体の中心が高いので、横の距離で測る
        const ed = t.kind === 'titan' ? Math.hypot(e.center.x - t.center.x, e.center.z - t.center.z) : e.center.distanceTo(t.center);
        if (ed <= reach) { summonAttack(t, e, false); t.atkT = S.atkCd / t.spd; }
      }
    }
    animateSummon(t, dt, speed);
    t.group.position.copy(t.pos);
    updateCenter(t);
    if ((t.kind === 'spirit' || t.kind === 'wisp') && Math.random() < 0.5) FX.emit(t.center, { count: 1, c1, c2, speed: 0.4, up: -0.6, jitter: t.r * 0.5, life: 0.5, size: t.kind === 'wisp' ? 0.15 : 0.3, drag: 1, rainbow: t.spec.rainbow });
    if (t.burnT > 0 && Math.random() < 0.4) FX.emit(t.center, { count: 1, c1: '#ff6a1a', c2: '#ffd24a', speed: 0.6, up: 2.5, jitter: t.r * 0.7, life: 0.6, size: 0.4, drag: 0.5 });
    for (const m of t.mats) {
      if (t.flash > 0) { m.emissive.setRGB(1, 1, 1); m.emissiveIntensity = 0.9; }
      else if (t.freezeT > 0) { m.emissive.setRGB(0.3, 0.75, 1); m.emissiveIntensity = 0.55; }
      else if (t.burnT > 0) { m.emissive.setRGB(1, 0.35, 0.05); m.emissiveIntensity = 0.35 + Math.random() * 0.25; }
      else { m.emissive.copy(m.userData.baseEmissive); m.emissiveIntensity = m.userData.baseInt; }
    }
    return false;
  }
  // 相手の召喚獣に自分の魔法が当たった: ダメージを計算して、持ち主に送る
  function hitPuppet(t, dmg, spec, o) {
    if (!spec || spec.remote || !M.on || !t.alive) return 0;
    let d = dmg * (spec.mult || 1), crit = false;
    if (spec.crit && !o.noCrit && Math.random() < spec.crit) { d *= 2.5; crit = true; }
    d = Math.max(1, Math.round(d));
    const h = { id: t.sid, d, e: spec.element };
    if (!o.noStatus) {
      if (spec.burn > 0) h.burn = [1.5 + spec.burn * 1.2, (3 + spec.burn * 3) * (spec.mult || 1)];
      if (spec.freeze > 0) h.frz = [0.8 + spec.freeze, spec.freeze >= 2 ? 1 : 0];
      if (spec.corrode > 0) h.vul = 3 + spec.corrode * 2;
      if (spec.knock > 0 && o.dir) { const k = o.dir.clone(); k.y = 0; if (k.lengthSq() < 1e-4) k.set(0, 0, -1); k.normalize(); h.kb = [k.x * spec.knock * 6, 0, k.z * spec.knock * 6]; }
    }
    t.flash = 0.12;
    const p = t.center.clone(); p.x += rand(-0.3, 0.3); p.y += t.r * 0.6;
    popup(p, crit ? d + '!' : String(d), crit ? 'crit' : 'pvp');
    if (crit) AU.crit(); else AU.hit(spec.element, ap(t.center));
    if (spec.rec) spec.rec.add(d);
    if (G.onSummonHit) G.onSummonHit(t.ownerKey, h);
    return d;
  }
  // 自分の召喚獣の状態（相手に送る）: [番号, 種類, 属性, x, y, z, 向き, HP, 最大HP, 大きさ]
  function summonStateList() {
    return targets.filter((t) => t.isSummon && !t.puppet && t.alive).slice(0, 5)
      .map((t) => [t.sid, SUMMON_TYPES.indexOf(t.kind), t.spec.element].concat(arr(t.pos), [Math.round(t.yaw * 100) / 100, Math.max(0, Math.round(t.hp)), Math.round(t.maxHp), Math.round(t.scale * 100) / 100]));
  }
  // 相手から届いた召喚獣の状態で、相手の召喚獣を出す・動かす・消す
  function syncPuppets(pid, list) {
    const seen = new Set();
    (Array.isArray(list) ? list.slice(0, 5) : []).forEach((e) => {
      if (!Array.isArray(e) || e.length < 10) return;
      const sid = Math.round(+e[0]) || 0, kind = SUMMON_TYPES[Math.round(+e[1])], el = MG.ELEMENTS[e[2]] ? e[2] : null;
      const p = vec([e[3], e[4], e[5]]);
      if (!kind || !el || !p) return;
      seen.add(sid);
      let t = targets.find((o) => o.isSummon && o.puppet && o.ownerKey === pid && o.sid === sid);
      if (t && !t.alive) return;
      p.set(clamp(p.x, -80, 80), clamp(p.y, -20, 60), clamp(p.z, -80, 80));
      if (!t) {
        const E = MG.ELEMENTS[el];
        const spec = { element: el, colors: [E.c1, E.c2], rainbow: !!E.rainbow, remote: pid, casterT: avatars.get(pid) || null, dmg: 0, size: 1, mods: [], pulses: 0, chainHit: 0, name: { kanji: '' } };
        t = makeSummon({ type: kind, spec, owner: pid, puppet: true, sid, pos: p, scale: clamp(e[9], 0.5, 2), hp: clamp(e[8], 1, 999), life: 999 });
        summonCircleFx(new V3(p.x, W.heightAt(p.x, p.z), p.z), spec);
      }
      t.netPos.copy(p); t.netYaw = clamp(e[6], -1e4, 1e4); t.netSeen = 0;
      const hp = clamp(e[7], 0, 999), mx = clamp(e[8], 1, 999);
      if (hp !== t.hp || mx !== t.maxHp) { t.hp = hp; t.maxHp = mx; drawBar(t); }
    });
    targets.forEach((t) => { if (t.isSummon && t.puppet && t.ownerKey === pid && t.alive && !seen.has(t.sid)) summonDie(t, true); });
  }

  const FORM = {
    // ---- 守り・回復・移動 ----
    ward(spec, aim) {
      const c = casterPos(), [c1, c2] = colorsOf(spec);
      const shape = spec.shape || 'sphere';
      FX.ring(new V3(c.x, c.y + 0.08, c.z), c1, 0.4, 3.4, 0.5);
      FX.emit(new V3(c.x, c.y + 1.1, c.z), { count: 44, c1, c2, speed: -3, jitter: 1.7, life: 0.5, size: 0.3, drag: 0, rainbow: spec.rainbow });
      if (shape === 'sphere' || shape === 'front') {
        if (CTX) return; // 相手の障壁・大盾は、相手から届く状態で表示する
        const amount = Math.max(1, Math.round(spec.dmg * (spec.mult || 1) * (shape === 'front' ? 1.6 : 1)));
        SUP.shield = SUP.shieldMax = amount; SUP.shieldT = spec.dur; SUP.shieldSpec = spec; SUP.shieldShape = shape; SUP.hitT = 0.4;
        popup(ahead(2.5, 0.1), (shape === 'front' ? '大盾 ' : '障壁 ') + amount, 'ward');
        if (AU.barrier) AU.barrier(spec.element, shape, null);
        return;
      }
      // 壁・城壁・ドーム: その場に残る魔法の壁を立てる（相手の画面でも同じ場所に立つ）
      const owner = CTX ? String(CTX.casterT.pid) : 'me';
      const f = aim.dir.clone(); f.y = 0; if (f.lengthSq() < 1e-4) f.set(0, 0, -1); f.normalize();
      const yaw = Math.atan2(f.x, f.z);
      const amount = spec.dmg * (spec.mult || 1), sc = spec.wardScale || 1;
      const key = owner + ':' + castN;
      const mk = (o) => { barrierSeq[key] = (barrierSeq[key] || 0) + 1; return spawnBarrier(Object.assign({ spec, owner, id: key + ':' + barrierSeq[key] }, o)); };
      if (shape === 'wall') {
        mk({ shape: 'wall', x: c.x + f.x * 3.2, z: c.z + f.z * 3.2, yaw, w: 5 * sc, h: Math.min(4.2, 2.8 * Math.sqrt(sc)), t: 0.7, hp: Math.round(amount * 1.5), dur: spec.dur * 1.35 });
      } else if (shape === 'fort') {
        [-1, 0, 1].forEach((sd) => {
          const a = sd * 0.95, dir = f.clone().applyAxisAngle(UP, a), d = sd ? 2.7 : 3.1;
          mk({ shape: 'wall', x: c.x + dir.x * d, z: c.z + dir.z * d, yaw: yaw + a, w: 3.4 * sc, h: Math.min(3.8, 2.4 * Math.sqrt(sc)), t: 0.6, hp: Math.round(amount), dur: spec.dur * 1.35 });
        });
      } else {
        mk({ shape: 'dome', x: c.x, z: c.z, R: 4.5 * sc, hp: Math.round(amount * 2), dur: spec.dur * 1.2 });
      }
      if (!CTX) popup(ahead(2.5, 0.1), MG.WARD_SHAPES[shape].label, 'ward');
    },
    summon(spec, aim) {
      const c = casterPos();
      const f = aim.dir.clone(); f.y = 0; if (f.lengthSq() < 1e-4) f.set(0, 0, -1); f.normalize();
      const n = spec.summonCount || 1, type = spec.summonType || 'spirit';
      for (let i = 0; i < n; i++) {
        const side = n > 1 ? (i - (n - 1) / 2) * 2.8 : 0;
        const p = new V3(c.x + f.x * 3 + f.z * side, 0, c.z + f.z * 3 - f.x * side);
        const b = W.bound(), r = Math.hypot(p.x, p.z); if (r > b - 1) { p.x *= (b - 1) / r; p.z *= (b - 1) / r; }
        p.y = W.floorAt(p.x, p.z, c.y + 1);
        summonCircleFx(p, spec);
        // 相手の召喚獣は、相手から届く状態で出す
        if (!CTX) after(0.35, () => { if (!st.running) return; const t = spawnSummon(type, spec, p); t.slotSide = (i % 2 ? -1 : 1) * (2.2 + i * 0.8); });
      }
      if (!CTX) popup(ahead(2.5, 0.1), MG.SUMMONS[type].label + (n > 1 ? ` ×${n}` : '') + 'を召喚', 'ward');
    },
    heal(spec) {
      const c = casterPos(), [c1] = colorsOf(spec);
      FX.ring(new V3(c.x, c.y + 0.08, c.z), c1, 0.3, 2.8, 0.6);
      FX.emit(new V3(c.x, c.y + 1, c.z), { count: 54, c1: '#9dffb0', c2: c1, speed: 1.2, up: 3.5, jitter: 0.8, life: 1.1, size: 0.3, drag: 0.6 });
      if (CTX) return;
      const amount = Math.max(1, Math.round(spec.dmg * (spec.mult || 1)));
      const now = Math.round(amount * 0.6);
      SUP.regenT = Math.max(0.5, spec.dur || 3); SUP.regen = (amount - now) / SUP.regenT;
      if (M.on && M.alive) { M.hp = Math.min(M.maxHp, M.hp + now); M.burnT = 0; M.slowT = 0; M.slowHard = false; M.vulnT = 0; }
      else if (D.on && D.alive) D.hp = Math.min(D.maxHp, D.hp + now);
      SUP.healed += amount;
      popup(ahead(2.5, -0.3), '+' + amount, 'heal');
      whiteFlash('#9dffb0', 0.22);
    },
    warp(spec, aim) {
      const from = casterPos().clone();
      const dest = warpDest(from, aim, spec.range || 24);
      const [c1, c2] = colorsOf(spec);
      FX.emit(new V3(from.x, from.y + 1, from.z), { count: 50, c1, c2, speed: -4, jitter: 1.2, life: 0.4, size: 0.35, drag: 0, rainbow: spec.rainbow });
      FX.ring(new V3(from.x, from.y + 0.08, from.z), c1, 1.6, 0.2, 0.35);
      FX.emitLine(new V3(from.x, from.y + 1, from.z), new V3(dest.x, dest.y + 1, dest.z), { count: 40, c1, c2, speed: 0.5, life: 0.35, size: 0.25, drag: 3 });
      if (!CTX) { player.pos.copy(dest); player.vy = 0; player.kv.set(0, 0, 0); st.shake = Math.max(st.shake, 0.15); whiteFlash(c2, 0.28); SUP.warps++; }
      explode(new V3(dest.x, dest.y + 0.6, dest.z), spec.radius, spec.dmg, spec);
    },
    fly(spec) {
      const c = casterPos(), [c1, c2] = colorsOf(spec);
      FX.ring(new V3(c.x, c.y + 0.08, c.z), c1, 0.4, 3.8, 0.5);
      FX.emit(new V3(c.x, c.y + 0.3, c.z), { count: 56, c1, c2, speed: 4, up: 6, jitter: 1, life: 0.7, size: 0.35, drag: 2, rainbow: spec.rainbow });
      // 両側に翼のような光の筋
      [-1, 1].forEach((sd) => FX.emitLine(new V3(c.x, c.y + 1.3, c.z), new V3(c.x + sd * 2.2, c.y + 2.2, c.z), { count: 18, c1, c2, speed: 0.6, life: 0.5, size: 0.3, drag: 2 }));
      AU.whoosh();
      if (CTX) return; // 相手の翼は、相手から届く状態で表示する
      const sec = Math.round(spec.dur * Math.min(1.5, spec.mult || 1) * 10) / 10;
      SUP.flyT = SUP.flyMax = sec; SUP.flySpec = spec; SUP.glide = false; SUP.flights++;
      player.vy = Math.max(player.vy, 9); player.onGround = false;
      popup(ahead(2.5, 0.1), '飛翔 ' + sec + '秒', 'ward');
    },
    aura(spec) {
      const c = casterPos(), [c1, c2] = colorsOf(spec);
      FX.ring(new V3(c.x, c.y + 0.08, c.z), c1, 3.2, 0.3, 0.45);
      FX.emit(new V3(c.x, c.y + 1, c.z), { count: 60, c1, c2, speed: -3.5, jitter: 1.8, life: 0.45, size: 0.3, drag: 0, rainbow: spec.rainbow });
      // 空から自分に、属性の力が落ちてくる（雷なら稲妻）
      if (ZAPPY[spec.element]) { lightning(new V3(c.x + rand(-1, 1), c.y + 20, c.z + rand(-1, 1)), new V3(c.x, c.y + 1, c.z), c1, c2, { life: 0.35 }); AU.zap(); }
      else FX.emitLine(new V3(c.x, c.y + 14, c.z), new V3(c.x, c.y + 0.5, c.z), { count: 40, c1, c2, speed: 0.5, life: 0.4, size: 0.4, drag: 2 });
      if (CTX) return; // 相手の纏いは、相手から届く状態で表示する
      SUP.auraT = SUP.auraMax = spec.dur; SUP.auraSpec = spec; SUP.auraTick = 0.15; SUP.auraZap = 0;
      popup(ahead(2.5, 0.1), `纏い 速さ ×${spec.moveMul}`, 'ward');
      whiteFlash(c1, 0.25);
      st.shake = Math.max(st.shake, 0.18);
    },
    meteor(spec, aim) {
      const c = groundPointOf(aim, 55);
      c.y = W.heightAt(c.x, c.z);
      const [c1, c2] = colorsOf(spec);
      const area = spec.area, n = Math.max(1, Math.round(spec.count));
      const sky = new V3(c.x, c.y + 26, c.z);
      const delay = 0.8, dur = Math.max(0.3, spec.dur);
      // 上空の魔法陣（下から見上げて見えるように両面）
      const mk = (col, s) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s), new THREE.MeshBasicMaterial({ map: FX.circleTex, color: col, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
        m.rotation.x = -Math.PI / 2; m.position.copy(sky); scene.add(m); return m;
      };
      const outer = mk(c1, area * 3.2), inner = mk(c2, area * 2);
      inner.position.y -= 0.3;
      const glow = FX.glowSprite(c1, area * 3); glow.material = glow.material.clone(); glow.position.copy(sky); glow.material.opacity = 0; scene.add(glow); // 色ごとに共有している材質なので、写してから薄くする
      meteorCircles++;
      FX.ring(new V3(c.x, c.y + 0.06, c.z), c1, area * 0.95, area * 1.05, delay + dur + 0.6);
      FX.flash(sky, c1, 4, 40, 0.5);
      let t = 0;
      const total = delay + dur + 0.9;
      special((dt) => {
        t += dt;
        const k = t < 0.35 ? t / 0.35 : t > total - 0.5 ? Math.max(0, (total - t) / 0.5) : 1;
        outer.material.opacity = k * 0.95; inner.material.opacity = k * 0.8; glow.material.opacity = k * 0.5;
        const s = 0.6 + Math.min(1, t / 0.35) * 0.4;
        outer.scale.setScalar(s); inner.scale.setScalar(s);
        outer.rotation.z += dt * 0.8; inner.rotation.z -= dt * 1.6;
        // 輪のふちから、光の粒がこぼれ落ちる
        const a = rand(0, Math.PI * 2);
        FX.emit(new V3(sky.x + Math.cos(a) * area * 1.4, sky.y - 0.2, sky.z + Math.sin(a) * area * 1.4), { count: 1, c1, c2, speed: 0.5, up: -4, life: 0.8, size: 0.4, drag: 0.5, rainbow: spec.rainbow });
        if (t >= total) {
          [outer, inner, glow].forEach((o) => { scene.remove(o); if (o.isMesh) o.geometry.dispose(); o.material.dispose(); });
          meteorCircles--;
          return false;
        }
        return true;
      }, [outer, inner, glow]);
      for (let i = 0; i < n; i++) {
        after(delay + (n > 1 ? (i * dur) / (n - 1) : 0), () => {
          const a = rand(0, Math.PI * 2), r = i === 0 ? 0 : Math.sqrt(Math.random()) * area * 0.85;
          const tgt = new V3(c.x + Math.cos(a) * r, c.y, c.z + Math.sin(a) * r);
          const start = sky.clone().add(new V3(rand(-1, 1) * area * 0.4, -0.6, rand(-1, 1) * area * 0.4));
          spawnProj(spec, start, tgt.clone().sub(start), { kind: 'meteor', life: 3 });
          FX.flash(start, c1, 3, 20, 0.2);
          AU.whoosh();
        });
      }
    },
    bolt(spec, aim, tip) {
      const base = aim.point.clone().sub(tip).normalize();
      const n = Math.round(spec.count);
      for (let i = 0; i < n; i++) {
        const ang = n > 1 ? (i - (n - 1) / 2) * 0.06 : 0;
        spawnProj(spec, tip, base.clone().applyAxisAngle(UP, ang), { kind: 'bolt' });
      }
    },
    spray(spec, aim, tip) {
      const base = aim.point.clone().sub(tip).normalize();
      const n = Math.round(spec.count), half = (spec.spreadDeg * Math.PI) / 360;
      for (let i = 0; i < n; i++) {
        const ang = n > 1 ? -half + (2 * half * i) / (n - 1) : 0;
        const d = base.clone().applyAxisAngle(UP, ang); d.y += rand(-0.03, 0.03);
        spawnProj(spec, tip, d, { kind: 'spray' });
      }
      AU.whoosh();
    },
    volley(spec, aim, tip) {
      const n = Math.round(spec.count);
      const ctx = CTX;
      for (let i = 0; i < n; i++) {
        after(i * 0.1, () => {
          const a = ctx ? ctx.aim : getAim(), tp = ctx ? ctx.tip.clone() : getTip();
          const d = a.point.clone().sub(tp).normalize(); d.x += rand(-0.03, 0.03); d.y += rand(-0.02, 0.02);
          spawnProj(spec, tp, d, { kind: 'bolt' });
          if (!ctx) st.recoil = Math.max(st.recoil, 0.6);
          if (i) AU.cast(spec.element);
        });
      }
    },
    lob(spec, aim, tip) {
      const n = Math.round(spec.count), g = 22;
      for (let i = 0; i < n; i++) {
        const tgt = aim.target ? aim.target.center.clone() : groundPointOf(aim, 50);
        if (n > 1) tgt.add(new V3(2.6, 0, 0).applyAxisAngle(UP, (i / n) * Math.PI * 2));
        const delta = tgt.clone().sub(tip);
        const T = Math.max(0.45, Math.min(2.4, delta.length() / Math.max(8, spec.speed)));
        const vel = delta.multiplyScalar(1 / T); vel.y += 0.5 * g * T;
        spawnProj(spec, tip, vel, { kind: 'lob', vel, gravity: g, life: T + 0.6 });
      }
    },
    orb(spec, aim, tip) {
      const base = aim.point.clone().sub(tip).normalize();
      const n = Math.round(spec.count);
      for (let i = 0; i < n; i++) spawnProj(spec, tip, base.clone().applyAxisAngle(UP, n > 1 ? (i - (n - 1) / 2) * 0.25 : 0), { kind: 'orb' });
    },
    beam(spec, aim, tip) {
      const dir = aim.point.clone().sub(tip).normalize();
      let len = spec.range;
      if (dir.y < -0.001) len = Math.min(len, -tip.y / dir.y);
      let end = tip.clone().addScaledVector(dir, len);
      const walls = W.propsOnSegment(tip, end, ownerKey(spec));
      let allow = spec.penetrate || 0;
      const bi = walls.findIndex((w) => w.barrier || w.solid);
      if (bi >= 0 && bi < allow) allow = bi; // 魔法の壁と、村やダンジョンの固い壁は、光線でもつらぬけない
      const passed = walls.slice(0, allow);
      if (walls.length > allow) {
        len = walls[allow].t; end = tip.clone().addScaledVector(dir, len); AU.blocked(ap(end));
        if (walls[allow].barrier && walls[allow].prop.game) damageBarrier(walls[allow].prop.game, spec.dmg, end.clone(), spec);
      }
      const [c1, c2] = colorsOf(spec);
      const width = Math.max(0.12, spec.size) * 1.1;
      passed.forEach((w, i) => after(0.02 * i, () => pierceFx(tip.clone().addScaledVector(dir, w.t), spec, i + 1, w.prop)));
      if (passed.length && walls.length > allow) after(0.02 * passed.length, () => popup(end.clone().add(new V3(0, 1, 0)), `${passed.length}枚で停止`, 'pierce-end'));
      if (walls.some((w) => W.isLaneSlab(w.prop))) W.setPierceBoard(passed.filter((w) => W.isLaneSlab(w.prop)).length, spec.name.kanji);
      const hits = [];
      for (const t of targets) {
        if (!t.alive) continue;
        const v = t.center.clone().sub(tip); const along = v.dot(dir);
        if (along < 0 || along > len + t.r) continue;
        const perp = v.addScaledVector(dir, -along).length();
        if (perp < t.r + width * 1.5 + spec.radius * 0.5) hits.push({ t, along });
      }
      hits.sort((a, b) => a.along - b.along);
      beamVisual(tip, end, c1, c2, width, 0.4);
      EF.impact(spec.element, end, 1.8);
      FX.flash(end, c1, 4, 16, 0.3);
      smallBurst(end, spec, 1.4);
      if (spec.radius > 1.5) explode(end, spec.radius, spec.dmg * 0.5, spec, null, { silent: true });
      hits.forEach((h, i) => {
        hitTarget(h.t, spec.dmg, spec, { dir });
        extras(h.t, spec, spec.dmg, h.t.center.clone(), null);
        FX.emit(h.t.center, { count: 20, c1, c2, speed: 6, life: 0.35, size: 0.4, drag: 4 });
      });
      st.shake = Math.max(st.shake, 0.12);
    },
    chain(spec, aim, tip) {
      const first = aim.target || nearestToRay(aim, 0.22, spec.range);
      const [c1, c2] = colorsOf(spec);
      if (!first) {
        const end = aim.point.clone();
        if (aim.dist > spec.range) end.copy(aim.origin).addScaledVector(aim.dir, spec.range);
        lightning(tip, end, c1, c2);
        AU.zap();
        if (end.y < 0.5) smallBurst(end, spec, 1.2);
        return;
      }
      chainRun(tip, first, Math.round(spec.jumps + spec.bounce + spec.chainHit), spec.jumpRange, spec.dmg, spec, new Set());
    },
    rain(spec, aim, tip) {
      const c = groundPointOf(aim, 50);
      const n = Math.round(spec.count);
      const area = spec.area;
      FX.ring(new V3(c.x, 0.06, c.z), colorsOf(spec)[0], area * 0.95, area * 1.05, spec.dur + 0.5);
      for (let i = 0; i < n; i++) {
        after((i * spec.dur) / n + rand(0, 0.05), () => {
          const a = rand(0, Math.PI * 2), r = Math.sqrt(Math.random()) * area;
          const tgt = new V3(c.x + Math.cos(a) * r, 0, c.z + Math.sin(a) * r);
          const start = tgt.clone().add(new V3(rand(-3, 3), 24, rand(-3, 3)));
          spawnProj(spec, start, tgt.clone().sub(start), { kind: 'rain', life: 3 });
        });
      }
    },
    pillar(spec, aim, tip) {
      const f = aim.dir.clone(); f.y = 0; if (f.lengthSq() < 1e-4) f.set(0, 0, -1); f.normalize();
      const start = new V3(casterPos().x, 0, casterPos().z).addScaledVector(f, 2.5);
      let end = groundPointOf(aim, 38);
      if (end.distanceTo(start) < 8) end = start.clone().addScaledVector(f, 8);
      const n = Math.round(spec.count);
      const hitSet = new Set();
      for (let i = 0; i < n; i++) {
        const p = start.clone().lerp(end, n > 1 ? i / (n - 1) : 1);
        after(i * 0.07, () => spawnSpike(p, spec, hitSet, i === n - 1 ? 1.25 : 1));
      }
    },
    mist(spec, aim) {
      const c = groundPointOf(aim, 45);
      fields.push({ kind: 'mist', pos: c, radius: spec.radius, t: 0, dur: spec.dur, tickT: 0, spec });
      FX.ring(new V3(c.x, 0.06, c.z), colorsOf(spec)[0], 0.5, spec.radius, 0.5);
      AU.whoosh();
    },
    vortex(spec, aim) {
      const c = groundPointOf(aim, 45);
      fields.push({ kind: 'vortex', pos: c, radius: spec.radius, t: 0, dur: spec.dur, tickT: 0, spec, ang: 0 });
      EF.play('Tornado', c, { scale: spec.radius * 0.32, color: rgbOf(colorsOf(spec)[0]) });
      FX.ring(new V3(c.x, 0.06, c.z), colorsOf(spec)[0], spec.radius * 1.3, 0.5, 0.6);
    },
    nova(spec) {
      const c = new V3(casterPos().x, 0.25, casterPos().z);
      const [c1, c2] = colorsOf(spec);
      fields.push({ kind: 'nova', pos: c, r: 0.5, maxR: spec.radius, speed: spec.speed, hit: new Set(), spec, t: 0 });
      EF.play('SonicBoom', c, { scale: spec.radius * 0.16, color: rgbOf(c1) });
      FX.ring(new V3(c.x, 0.08, c.z), c1, 0.5, spec.radius, spec.radius / spec.speed + 0.15);
      FX.ring(new V3(c.x, 0.1, c.z), c2, 0.5, spec.radius * 0.85, spec.radius / spec.speed + 0.3);
      FX.flash(c.clone().setY(1.5), c1, 6, spec.radius * 2, 0.4);
      st.shake = Math.max(st.shake, 0.2);
    },
  };

  function updateFields(dt) {
    for (let i = fields.length - 1; i >= 0; i--) {
      const f = fields[i];
      const spec = f.spec, [c1, c2] = colorsOf(spec);
      f.t += dt;
      if (f.kind === 'mist') {
        const n = 6;
        for (let k = 0; k < n; k++) {
          const a = rand(0, Math.PI * 2), r = Math.sqrt(Math.random()) * f.radius;
          FX.emit(new V3(f.pos.x + Math.cos(a) * r, rand(0.2, 1.5), f.pos.z + Math.sin(a) * r), { count: 1, c1, c2, speed: 0.4, up: 0.6, life: 1.3, size: rand(1.4, 2.6), drag: 1, alpha: 0.32, rainbow: spec.rainbow });
        }
        f.tickT -= dt;
        if (f.tickT <= 0) {
          f.tickT = spec.tick;
          for (const t of targets) {
            if (!t.alive) continue;
            if (Math.hypot(t.center.x - f.pos.x, t.center.z - f.pos.z) < f.radius + t.r * 0.5 && t.center.y < f.radius + 2.5) {
              hitTarget(t, spec.dmg, spec, { noCrit: false });
              if (spec.pull > 0) t.dispV.addScaledVector(f.pos.clone().sub(t.center).setY(0).normalize(), spec.pull * 1.5 * t.mass);
            }
          }
        }
        if (f.t >= f.dur) fields.splice(i, 1);
      } else if (f.kind === 'vortex') {
        f.ang += dt * 6;
        for (let k = 0; k < 8; k++) {
          const a = rand(0, Math.PI * 2), r = rand(0.5, f.radius);
          const p = new V3(f.pos.x + Math.cos(a) * r, rand(0.1, 2.5) + (f.radius - r) * 0.4, f.pos.z + Math.sin(a) * r);
          const tang = new V3(-Math.sin(a), 0.35, Math.cos(a)).addScaledVector(new V3(-Math.cos(a), 0, -Math.sin(a)), 0.7).normalize();
          FX.emit(p, { count: 1, dir: tang, spread: 0, speed: 7, speedVar: 0.2, c1, c2, life: 0.55, size: 0.45, drag: 0.5, rainbow: spec.rainbow });
        }
        for (const t of targets) {
          if (!t.alive) continue;
          const v = f.pos.clone().sub(t.center); v.y = (f.pos.y + 1.5) - t.center.y; const d = v.length();
          if (d < f.radius * 1.6) t.dispV.addScaledVector(v.normalize(), dt * 22 * t.mass * (1 + spec.pull * 0.5));
        }
        f.tickT -= dt;
        if (f.tickT <= 0) {
          f.tickT = spec.tick;
          for (const t of targets) if (t.alive && t.center.distanceTo(f.pos) < f.radius + t.r) hitTarget(t, spec.dmg, spec, { noStatus: true });
          AU.whoosh();
        }
        if (f.t >= f.dur) { explode(f.pos.clone().setY(1), f.radius * 0.8, spec.burst, spec, null); fields.splice(i, 1); }
      } else if (f.kind === 'nova') {
        f.r = Math.min(f.maxR, f.r + f.speed * dt);
        for (let k = 0; k < 24; k++) {
          const a = rand(0, Math.PI * 2);
          FX.emit(new V3(f.pos.x + Math.cos(a) * f.r, rand(0.2, 1.4), f.pos.z + Math.sin(a) * f.r), { count: 1, c1, c2, speed: 1, up: 1, life: 0.4, size: 0.5, drag: 2, rainbow: spec.rainbow });
        }
        for (const t of targets) {
          if (!t.alive || f.hit.has(t)) continue;
          const d = Math.hypot(t.center.x - f.pos.x, t.center.z - f.pos.z);
          if (d - t.r <= f.r && Math.abs(t.center.y - f.pos.y) < 8) {
            f.hit.add(t);
            const dir = t.center.clone().sub(f.pos);
            hitTarget(t, spec.dmg, spec, { dir });
            extras(t, spec, spec.dmg, t.center.clone(), null);
            FX.emit(t.center, { count: 16, c1, c2, speed: 5, life: 0.3, size: 0.4 });
          }
        }
        if (f.r >= f.maxR) fields.splice(i, 1);
      } else if (f.kind === 'special') {
        if (f.update(dt) === false) fields.splice(i, 1);
      }
    }
  }

  // ======================================================================
  //  隠し魔法
  // ======================================================================
  function whiteFlash(color, strength) {
    const el = document.getElementById('flash'); if (!el) return;
    el.style.background = color || '#fff';
    el.style.transition = 'none'; el.style.opacity = String(strength || 0.8);
    requestAnimationFrame(() => { el.style.transition = 'opacity 0.9s ease-out'; el.style.opacity = '0'; });
  }
  // ---- 第24版の隠し魔法で使う、しばらく残る場（時間遅延の球・完全反磁性）----
  // どちらも、放った人の画面でも相手の画面でも同じように置く（相手の画面では spec.remote の人のもの）
  const dilations = []; // { owner, c, R, alive }
  const meissners = []; // { owner, who（その人の的。練習場の自分は null）, R, alive }
  const okey = (v) => (v == null ? null : String(v));
  // そのものの持ち主（自分 'me'・相手の ID・練習用の的は null）
  const targetOwner = (t) => (t.isSummon ? okey(t.ownerKey) : t.isSelf ? 'me' : t.isPlayer ? okey(t.pid) : null);
  // 時間遅延の球の中では、球を張った人以外の時間が 1/5 になる
  function timeK(p, owner) {
    if (!dilations.length) return 1;
    for (const d of dilations) if (d.alive && d.owner !== owner && p.distanceTo(d.c) < d.R) return 0.2;
    return 1;
  }
  function meissnerOf(owner) { return meissners.find((m) => m.alive && m.owner === owner) || null; }
  function meissnerPos(m) {
    if (m.owner === 'me') return new V3(player.pos.x, player.pos.y + 1, player.pos.z);
    return m.who && m.who.alive ? m.who.center.clone() : null;
  }
  // 地面に立っているか（大地震が当たる。浮遊水晶・精霊・使い魔・跳んでいる人・反磁性で浮いている人には当たらない）
  function grounded(t) {
    if (t.type === 'floater' || (t.isSummon && (t.kind === 'spirit' || t.kind === 'wisp'))) return false;
    if (t.isPlayer) {
      if (meissnerOf(targetOwner(t))) return false;
      const p = t.isSelf ? player.pos : t.pos;
      return p.y - W.floorAt(p.x, p.z, p.y + 0.5) < 0.35;
    }
    return true;
  }
  // 隠し魔法の当たり方をそろえる（並べたことばの効果は乗せない）
  const cleanSpec = (spec, o) => Object.assign({}, spec, { burn: 0, freeze: 0, corrode: 0, knock: 0, rewind: 0, pulses: 0, pull: 0, chainHit: 0, split: 0, crit: 0, drain: 0 }, o || {});
  // 木や鳥など、いくつもの部品でできた物を片づける（光の玉の材質は色ごとに共有しているので消さない）
  function disposeObj(o) {
    scene.remove(o);
    o.traverse((m) => { if (m.isMesh) { if (m.geometry) m.geometry.dispose(); if (m.material) m.material.dispose(); } });
  }
  // 大地震のひび割れ模様
  let crackTexC = null;
  function crackTex() {
    if (crackTexC) return crackTexC;
    const c = document.createElement('canvas'); c.width = c.height = 1024;
    const g = c.getContext('2d');
    g.lineCap = 'round'; g.lineJoin = 'round';
    const branch = (x, y, a, len, w, depth) => {
      const pts = [[x, y]];
      let px = x, py = y;
      const n = 6 + depth * 2;
      for (let i = 0; i < n; i++) { a += rand(-0.45, 0.45); px += Math.cos(a) * len / n; py += Math.sin(a) * len / n; pts.push([px, py]); }
      const line = (lw, col) => { g.lineWidth = lw; g.strokeStyle = col; g.beginPath(); pts.forEach(([qx, qy], i) => (i ? g.lineTo(qx, qy) : g.moveTo(qx, qy))); g.stroke(); };
      line(w, `rgba(28,16,8,${0.9 - depth * 0.15})`);
      line(Math.max(1, w * 0.35), `rgba(255,${120 + depth * 25},40,${0.9 - depth * 0.15})`);
      if (depth < 3) for (let k = 0; k < 2; k++) if (Math.random() < 0.75) branch(px, py, a + rand(-0.9, 0.9), len * 0.55, w * 0.6, depth + 1);
    };
    for (let i = 0; i < 11; i++) branch(512, 512, (i / 11) * Math.PI * 2 + rand(-0.2, 0.2), rand(300, 470), 5, 0);
    crackTexC = new THREE.CanvasTexture(c); crackTexC.anisotropy = 4;
    return crackTexC;
  }
  // 縁が光る半透明の球（時間遅延）
  function rimSphereMat(color) {
    return new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      uniforms: { uT: { value: 0 }, uA: { value: 0 }, uC: { value: new THREE.Color(color) } },
      vertexShader: 'varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vP = position; vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }',
      fragmentShader: `uniform float uT; uniform float uA; uniform vec3 uC; varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main(){
          float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
          float rings = smoothstep(0.92, 1.0, sin(vP.y * 18.0 - uT * 1.2) * 0.5 + 0.5) * 0.35;
          gl_FragColor = vec4(mix(uC, vec3(1.0), f * 0.5), (0.03 + f * 0.55 + rings * 0.25) * uA);
        }`,
    });
  }
  // 世界樹（高さ 20m）。幹・根・枝・光る葉のかたまり・幹を流れる光の筋
  function makeYggdrasil() {
    const g = new THREE.Group();
    const bark = new THREE.MeshStandardMaterial({ color: 0x5e3c26, roughness: 0.9, flatShading: true, emissive: 0x2a170a, emissiveIntensity: 0.6 });
    const vein = new THREE.MeshBasicMaterial({ color: 0xc8ff8a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    const leaf = new THREE.MeshStandardMaterial({ color: 0x2f9a3a, emissive: 0x38c24a, emissiveIntensity: 0.45, roughness: 0.6, flatShading: true });
    const leaf2 = new THREE.MeshStandardMaterial({ color: 0xd8b040, emissive: 0xffb830, emissiveIntensity: 0.5, roughness: 0.5, flatShading: true });
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 2.0, 13, 9, 5), bark); trunk.position.y = 6.5; g.add(trunk);
    // 少しねじれた幹（頂点を回す）
    const pa = trunk.geometry.attributes.position;
    for (let i = 0; i < pa.count; i++) { const y = pa.getY(i), a = (y + 6.5) * 0.06, x = pa.getX(i), z = pa.getZ(i); pa.setX(i, x * Math.cos(a) - z * Math.sin(a)); pa.setZ(i, x * Math.sin(a) + z * Math.cos(a)); }
    trunk.geometry.computeVertexNormals();
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2 + rand(-0.2, 0.2);
      const p = new THREE.Group(); p.rotation.y = a; g.add(p);
      const root = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.75, 4.6, 6), bark); root.position.set(2.0, 0.55, 0); root.rotation.z = 1.25; p.add(root);
      const rv = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.07, 0.07), vein); rv.position.set(2.1, 0.62, 0.32); rv.rotation.z = -0.32; p.add(rv);
    }
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + rand(-0.3, 0.3);
      const p = new THREE.Group(); p.position.y = 9.5 + (k % 3) * 1.1; p.rotation.y = a; g.add(p);
      const tilt = new THREE.Group(); tilt.rotation.z = -rand(0.75, 1.05); p.add(tilt);
      const br = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.48, 6.2, 6), bark); br.position.y = 3.1; tilt.add(br);
    }
    // 光る葉のかたまり（下の輪・上の輪・てっぺん）
    const blobs = [];
    const addBlob = (x, y, z, r, m) => { const b = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), m); b.position.set(x, y, z); b.rotation.set(rand(0, 6), rand(0, 6), 0); g.add(b); blobs.push(b); };
    for (let k = 0; k < 7; k++) { const a = (k / 7) * Math.PI * 2; addBlob(Math.cos(a) * 5.6, 14.2 + rand(-0.4, 0.4), Math.sin(a) * 5.6, rand(2.6, 3.3), k % 3 ? leaf : leaf2); }
    for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2 + 0.5; addBlob(Math.cos(a) * 3.2, 17, Math.sin(a) * 3.2, rand(2.5, 3), k % 2 ? leaf : leaf2); }
    addBlob(0, 18.6, 0, 2.8, leaf);
    // 幹を流れる光の筋
    for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; const v = new THREE.Mesh(new THREE.BoxGeometry(0.08, 12, 0.08), vein); v.position.set(Math.cos(a) * 1.35, 6.2, Math.sin(a) * 1.35); v.rotation.z = Math.cos(a) * 0.08; v.rotation.x = -Math.sin(a) * 0.08; g.add(v); }
    const crown = FX.glowSprite('#b8ff7a', 18); crown.position.y = 16; g.add(crown);
    const base = FX.glowSprite('#fff3b8', 7); base.position.y = 1.5; g.add(base);
    // 足もとの輪（つるが届く範囲 12m）
    const ring = new THREE.Mesh(new THREE.PlaneGeometry(24, 24), new THREE.MeshBasicMaterial({ map: FX.circleTex, color: 0x9dff6a, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06; g.add(ring);
    return { g, blobs, ring };
  }
  // 不死鳥（+Z が前）。翼は羽ばたき用の軸に付ける
  function makePhoenix() {
    const g = new THREE.Group();
    const add = (m, mat) => new THREE.Mesh(m, mat);
    const body = new THREE.MeshBasicMaterial({ color: 0xff6a18 });
    const hot = new THREE.MeshBasicMaterial({ color: 0xffd24a });
    const b = add(new THREE.SphereGeometry(0.5, 14, 10), body); b.scale.set(0.75, 0.7, 1.7); g.add(b);
    const h = add(new THREE.SphereGeometry(0.36, 12, 8), hot); h.position.set(0, 0.25, 1.05); g.add(h);
    const beak = add(new THREE.ConeGeometry(0.11, 0.45, 6), hot); beak.rotation.x = Math.PI / 2; beak.position.set(0, 0.2, 1.5); g.add(beak);
    const crest = add(new THREE.ConeGeometry(0.08, 0.7, 5), body); crest.position.set(0, 0.7, 0.85); crest.rotation.x = -0.7; g.add(crest);
    // 翼: 外へ広がる羽の形（2枚重ねて、内側を明るく）
    const shape = new THREE.Shape();
    [[0, 0.5], [1.4, 0.75], [3.0, 0.5], [4.4, -0.1], [3.6, -0.45], [3.9, -0.8], [2.8, -0.85], [3.0, -1.2], [1.8, -1.05], [0.6, -0.7], [0, -0.4]].forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
    const wingGeo = new THREE.ShapeGeometry(shape);
    const wingMat = new THREE.MeshBasicMaterial({ color: 0xff4a10, transparent: true, opacity: 0.92, side: THREE.DoubleSide, depthWrite: false });
    const wingMat2 = new THREE.MeshBasicMaterial({ color: 0xffc040, transparent: true, opacity: 0.6, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
    const wings = [-1, 1].map((sd) => {
      const p = new THREE.Group(); p.position.set(sd * 0.3, 0.1, 0.1); g.add(p);
      [[wingMat, 1], [wingMat2, 0.7]].forEach(([m, k]) => { const w = add(wingGeo, m); w.rotation.x = Math.PI / 2; w.scale.set(sd * k, k, k); w.position.y = k < 1 ? 0.02 : 0; p.add(w); });
      return p;
    });
    // 長い尾羽
    const tails = [];
    for (let k = -2; k <= 2; k++) {
      const t = add(new THREE.ConeGeometry(0.14, 2.6 - Math.abs(k) * 0.35, 5), k % 2 ? body : wingMat);
      t.rotation.x = -Math.PI / 2 + 0.12; t.position.set(k * 0.18, -0.05 - Math.abs(k) * 0.04, -1.9 + Math.abs(k) * 0.15); t.rotation.z = k * 0.18; g.add(t); tails.push(t);
    }
    const glow = FX.glowSprite('#ff5a10', 4.5); g.add(glow);
    const core = FX.glowSprite('#ffd070', 1.4); core.position.z = 0.4; g.add(core);
    g.scale.setScalar(1.6);
    return { g, wings, tails };
  }
  const bez = (a, b, c, d, u) => {
    const v = 1 - u;
    return a.clone().multiplyScalar(v * v * v).addScaledVector(b, 3 * v * v * u).addScaledVector(c, 3 * v * u * u).addScaledVector(d, u * u * u);
  };
  // 千刃の門の武器（剣・槍・斧）と魔法陣の形。形と材質は、すべての武器で使い回す
  let bladeKitC = null;
  function bladeKit() {
    if (bladeKitC) return bladeKitC;
    const steel = new THREE.MeshStandardMaterial({ color: 0xe4eaf4, emissive: 0x5a7aa8, emissiveIntensity: 0.55, roughness: 0.25, metalness: 0.5, flatShading: true });
    const gold = new THREE.MeshStandardMaterial({ color: 0xe8a422, emissive: 0x8a5200, emissiveIntensity: 0.6, roughness: 0.35, metalness: 0.4, flatShading: true });
    const grip = new THREE.MeshStandardMaterial({ color: 0x3a2a40, emissive: 0x1a1020, emissiveIntensity: 1, roughness: 0.7 });
    const glow = new THREE.MeshBasicMaterial({ color: 0xcfe0ff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
    // どれも +Y が切っ先（飛んでいく向き）
    const tip = new THREE.ConeGeometry(0.075, 0.32, 4);
    const sword = [[new THREE.BoxGeometry(0.15, 1.5, 0.035), steel, 0.25], [tip, steel, 1.16], [new THREE.BoxGeometry(0.03, 1.3, 0.05), glow, 0.2], [new THREE.BoxGeometry(0.55, 0.09, 0.12), gold, -0.55], [new THREE.BoxGeometry(0.07, 0.4, 0.07), grip, -0.8], [new THREE.OctahedronGeometry(0.07, 0), gold, -1.03]];
    const spear = [[new THREE.CylinderGeometry(0.035, 0.035, 2.3, 6), grip, -0.35], [new THREE.ConeGeometry(0.1, 0.6, 4), steel, 1.1], [new THREE.BoxGeometry(0.3, 0.06, 0.06), gold, 0.78], [new THREE.BoxGeometry(0.02, 0.5, 0.11), glow, 1.05]];
    const axe = [[new THREE.CylinderGeometry(0.04, 0.04, 1.6, 6), grip, -0.2], [new THREE.BoxGeometry(0.55, 0.42, 0.04), steel, 0.5], [new THREE.BoxGeometry(0.1, 0.5, 0.06), gold, 0.5], [new THREE.ConeGeometry(0.06, 0.3, 4), steel, 0.75]];
    axe[1][0].translate(0.3, 0, 0);
    bladeKitC = { parts: [sword, spear, axe], portalGeo: new THREE.PlaneGeometry(1.9, 1.9), coreGeo: new THREE.CircleGeometry(0.55, 24) };
    return bladeKitC;
  }
  // 自分の HP（練習場では MP）を回復する（世界樹・不死鳥）
  function healSelf(hp, mp, at) {
    if (D.on && D.alive) {
      const h = Math.min(hp, D.maxHp - D.hp);
      if (h > 0) { D.hp += h; popup(at || ahead(2.4, -0.4), '+' + Math.round(h), 'heal'); }
    } else if (M.on) {
      if (!M.alive) return;
      const h = Math.min(hp, M.maxHp - M.hp);
      if (h > 0) { M.hp += h; SUP.healed += h; popup(at || ahead(2.4, -0.4), '+' + Math.round(h), 'heal'); }
    } else {
      const h = Math.min(mp, st.mpMax - st.mp);
      if (h > 0) { st.mp += h; popup(at || ahead(2.4, -0.4), 'MP +' + Math.round(h), 'heal'); }
    }
  }

  // objs: 途中で片づける（対戦の開始・終了やチャレンジの開始）ときに、場面から消す物体
  function special(update, objs) {
    (objs || []).forEach((o) => { if (o) o.userData.special = true; });
    fields.push({ kind: 'special', update, objs: objs || [], spec: { colors: ['#fff', '#fff'] } });
  }
  // 効果の場（霧・竜巻・特殊演出）をすべて片づける。演出の物体を残すと、上空に魔法陣や球が残ったままになる
  function clearFields() {
    for (const f of fields) {
      if (f.kind !== 'special') continue;
      for (const o of f.objs) { if (!o) continue; scene.remove(o); if (o.isMesh && o.geometry) o.geometry.dispose(); if (o.material && !o.isSprite) o.material.dispose(); }
    }
    fields.length = 0; meteorCircles = 0;
    dilations.length = 0; meissners.length = 0;
  }
  let meteorCircles = 0; // 上空に出ている流星の魔法陣の数（動作確認用）

  const SECRET = {
    redox(spec, aim, tip) {
      const first = aim.target || nearestToRay(aim, 0.12, 60);
      const cols = (k) => (k % 2 ? ['#4a8bff', '#bfe0ff'] : ['#ff4a4a', '#ffc0a0']);
      if (!first) { lightning(tip, aim.point, '#ff4a4a', '#4a8bff'); lightning(tip, aim.point, '#4a8bff', '#ff4a4a'); return; }
      chainRun(tip, first, 8, 34, 34, Object.assign({}, spec, { chainHit: 0, split: 0, pull: 0, crit: 0.15 }), new Set(), null, cols);
    },
    cumulo(spec, aim) {
      const c = groundPointOf(aim, 50);
      let t = 0, strikeT = 0.6;
      AU.rumble(4.6);
      special((dt) => {
        t += dt;
        for (let k = 0; k < 5; k++) {
          const a = rand(0, Math.PI * 2), r = Math.sqrt(Math.random()) * 10;
          FX.emit(new V3(c.x + Math.cos(a) * r, rand(15, 18), c.z + Math.sin(a) * r), { count: 1, c1: '#4a5280', c2: '#8f9ac8', speed: 0.5, life: 1.6, size: rand(4, 7), alpha: 0.28, drag: 1 });
        }
        strikeT -= dt;
        if (strikeT <= 0 && t < 4.4) {
          strikeT = 0.32;
          const cands = targets.filter((x) => x.alive && x !== spec.casterT && Math.hypot(x.center.x - c.x, x.center.z - c.z) < 24);
          const tg = cands.length ? cands[(Math.random() * cands.length) | 0] : null;
          const end = tg ? tg.center.clone() : new V3(c.x + rand(-9, 9), 0.1, c.z + rand(-9, 9));
          const top = new V3(end.x + rand(-2, 2), 17, end.z + rand(-2, 2));
          lightning(top, end, '#ffe94a', '#9fd0ff', { life: 0.3, size: 0.7 });
          EF.impact('lightning', end, 3);
          FX.ring(new V3(end.x, 0.08, end.z), '#ffe94a', 0.5, 3.5, 0.35);
          FX.flash(new V3(end.x, 6, end.z), '#cfe6ff', 10, 40, 0.25);
          AU.thunder(ap(end));
          H.feel('lightning', 0.35 * near(end), 0.3, 0.6);
          st.shake = Math.max(st.shake, 0.18);
          if (tg) hitTarget(tg, 30, spec, { dir: new V3(0, -1, 0) });
          else explode(end, 2.5, 22, spec, null, { silent: true });
        }
        return t < 4.8;
      });
    },
    supernova(spec, aim) {
      const p = aim.target ? aim.target.center.clone() : aim.point.clone();
      if (p.y < 2) p.y = 2;
      const star = FX.glowSprite('#fff4d0', 1); star.position.copy(p); scene.add(star);
      const star2 = FX.glowSprite('#ff7a2a', 1); star2.position.copy(p); scene.add(star2);
      let t = 0;
      AU.charge(1.1);
      special((dt) => {
        t += dt;
        const k = Math.min(1, t / 1.1);
        star.scale.setScalar(1 + k * 6 + Math.sin(t * 40) * 0.3); star2.scale.setScalar(2 + k * 12);
        for (let i = 0; i < 8; i++) {
          const d = new V3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
          const from = p.clone().addScaledVector(d, rand(7, 11));
          FX.emit(from, { count: 1, dir: d.clone().negate(), spread: 0, speed: 10, speedVar: 0.1, drag: 0, c1: '#ffd24a', c2: '#ff5a1f', life: 0.85, size: 0.5 });
        }
        if (t >= 1.1) {
          scene.remove(star); scene.remove(star2);
          explode(p, 15, 170, spec, null, { silent: true });
          FX.emit(p, { count: 400, c1: '#ffffff', c2: '#ffb84a', speed: 30, life: 1.2, size: 1.4, drag: 2.5 });
          FX.ring(new V3(p.x, 0.1, p.z), '#ffd24a', 1, 34, 1.2);
          FX.ring(p.clone(), '#ffffff', 1, 26, 0.9, { vertical: true, lookAt: camera.position.clone() });
          FX.flash(p, '#ffe0a0', 14, 90, 1.0);
          whiteFlash('#fff4d6', 0.9);
          st.shake = 1.1;
          AU.bigBoom();
          return false;
        }
        return true;
      }, [star, star2]);
    },
    horizon(spec, aim) {
      const p = groundPointOf(aim, 45); p.y = 3;
      const hole = new THREE.Mesh(new THREE.SphereGeometry(1.3, 24, 16), new THREE.MeshBasicMaterial({ color: 0x000000 }));
      hole.position.copy(p); scene.add(hole);
      const disk = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), new THREE.MeshBasicMaterial({ map: FX.ringTex, color: 0xb06bff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      disk.position.copy(p); disk.rotation.x = -Math.PI / 2 + 0.35; scene.add(disk);
      const halo = FX.glowSprite('#7a3cff', 10); halo.position.copy(p); scene.add(halo);
      EF.play('Phantasm', p, { scale: 1.1 });
      let t = 0, tick = 0;
      AU.rumble(3.8); AU.charge(3.5);
      special((dt) => {
        t += dt;
        const grow = Math.min(1, t / 0.5);
        hole.scale.setScalar(grow); disk.scale.setScalar(grow * (1 + Math.sin(t * 5) * 0.05)); disk.rotation.z += dt * 3;
        for (let i = 0; i < 10; i++) {
          const a = rand(0, Math.PI * 2), r = rand(6, 13);
          const from = new V3(p.x + Math.cos(a) * r, p.y + rand(-1.5, 1.5), p.z + Math.sin(a) * r);
          const dir = new V3(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(0.8).add(p.clone().sub(from).normalize()).normalize();
          FX.emit(from, { count: 1, dir, spread: 0, speed: 11, drag: 0.3, c1: '#9b5bff', c2: '#ff5ab4', life: 0.8, size: 0.45 });
        }
        for (const tg of targets) {
          if (!tg.alive) continue;
          const v = p.clone().sub(tg.center); const d = v.length();
          if (d < 22 && d > 0.5) tg.dispV.addScaledVector(v.normalize(), dt * 34 * tg.mass);
        }
        tick -= dt;
        if (tick <= 0) { tick = 0.25; for (const tg of targets) if (tg.alive && tg.center.distanceTo(p) < 6) hitTarget(tg, 9, spec, { noStatus: true, noCrit: true }); }
        st.shake = Math.max(st.shake, 0.06);
        if (t >= 3.6) {
          scene.remove(hole); scene.remove(disk); scene.remove(halo);
          hole.geometry.dispose(); hole.material.dispose(); disk.material.dispose();
          explode(p, 11, 95, spec, null, { silent: true });
          FX.emit(p, { count: 250, c1: '#ffffff', c2: '#b06bff', speed: 22, life: 1, size: 1, drag: 2.5 });
          whiteFlash('#d8c0ff', 0.6);
          AU.bigBoom();
          st.shake = 0.8;
          return false;
        }
        return true;
      }, [hole, disk, halo]);
    },
    aurora(spec, aim) {
      const f = aim.dir.clone(); f.y = 0; if (f.lengthSq() < 1e-4) f.set(0, 0, -1); f.normalize();
      const side = new V3().crossVectors(f, UP).normalize();
      const cp = casterPos().clone();
      const center = new V3(cp.x, 0, cp.z).addScaledVector(f, 22);
      let t = 0;
      AU.secret();
      special((dt) => {
        t += dt;
        for (let i = 0; i < 26; i++) {
          const s = rand(-34, 34);
          const wave = Math.sin(s * 0.15 + t * 1.5) * 5;
          const p = center.clone().addScaledVector(side, s).addScaledVector(f, wave);
          p.y = rand(16, 28);
          const hue = 0.38 + Math.sin(s * 0.05 + t) * 0.12 + (p.y - 16) * 0.012;
          const col = '#' + new THREE.Color().setHSL(hue, 1, 0.55).getHexString();
          FX.emit(p, { count: 1, c1: col, c2: col, speed: 0.3, up: -0.8, life: 1.4, size: rand(1.5, 2.8), alpha: 0.4, drag: 1 });
        }
        return t < 3.2;
      });
      const list = aliveTargets().filter((x) => x !== spec.casterT && x.center.distanceTo(cp) < 50).sort((a, b) => a.center.distanceTo(cp) - b.center.distanceTo(cp));
      const pts = list.length ? list.map((x) => x) : [];
      const n = Math.max(pts.length, 6);
      for (let i = 0; i < n; i++) {
        after(0.6 + i * 0.16, () => {
          const tg = pts[i];
          const end = tg && tg.alive ? tg.center.clone() : new V3(center.x + rand(-18, 18), 0.1, center.z + rand(-10, 10));
          const top = end.clone(); top.y = 30;
          const col = '#' + new THREE.Color().setHSL(0.35 + Math.random() * 0.5, 1, 0.6).getHexString();
          beamVisual(top, end, col, '#ffffff', 0.7, 0.5);
          EF.impact('light', end, 2.5);
          FX.ring(new V3(end.x, 0.08, end.z), col, 0.5, 4, 0.4);
          FX.flash(end, col, 6, 20, 0.3);
          AU.cast('light');
          if (tg && tg.alive) hitTarget(tg, 70, spec, { dir: new V3(0, -1, 0) });
        });
      }
    },
    zero(spec) {
      const c = new V3(casterPos().x, 0.1, casterPos().z);
      FX.ring(c.clone(), '#bff0ff', 1, 32, 0.9);
      EF.impact('ice', c, 8);
      FX.ring(c.clone().setY(0.12), '#ffffff', 1, 26, 1.1);
      whiteFlash('#9fe4ff', 0.45);
      AU.cast('ice'); AU.cast('crystal');
      for (let i = 0; i < 200; i++) {
        const a = rand(0, Math.PI * 2), r = rand(2, 30);
        FX.emit(new V3(c.x + Math.cos(a) * r, rand(0.1, 3), c.z + Math.sin(a) * r), { count: 1, c1: '#dff8ff', c2: '#7fd8ff', speed: 0.5, up: 1.2, life: rand(1, 2.2), size: rand(0.2, 0.5), drag: 1 });
      }
      for (const t of aliveTargets()) {
        if (t === spec.casterT) continue;
        const d = Math.hypot(t.center.x - c.x, t.center.z - c.z);
        if (d > 32) continue;
        after(d / 36, () => {
          if (!t.alive) return;
          t.freezeT = 6; t.frozenHard = true;
          spawnSpike(t.pos.clone(), Object.assign({}, spec, { radius: 0.1, colors: ['#bff0ff', '#ffffff'], size: 1.2 }), new Set(aliveTargets()), 1);
          if (t.isPlayer) hitTarget(t, 42, Object.assign({}, spec, { freeze: 5.2, burn: 0, knock: 0, corrode: 0, rewind: 0, pulses: 0 }), {});
          else hitTarget(t, 42, spec, { noStatus: true });
        });
      }
      st.shake = Math.max(st.shake, 0.3);
    },
    // 消滅領域: 少し離れた場所に透明な球体を生み、その内部を跡形なく消し去る
    erase(spec, aim) {
      const R = 5.5;
      const f = aim.dir.clone(); f.y = 0; if (f.lengthSq() < 1e-4) f.set(0, 0, -1); f.normalize();
      const base = new V3(casterPos().x, 0, casterPos().z);
      let c = aim.target ? aim.target.pos.clone() : aim.point.clone();
      c.y = 0;
      const dist = c.distanceTo(base);
      const aimedSomething = aim.target || aim.ground || aim.dist < (aim.range || 70) - 1;
      if (!aimedSomething || dist < 8 || dist > 26) c = base.clone().addScaledVector(f, 14);
      c.y = W.heightAt(c.x, c.z) + R * 0.45;
      G.lastErase = { x: c.x, y: c.y, z: c.z, r: R };
      const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false,
        uniforms: { uT: { value: 0 }, uA: { value: 0 } },
        vertexShader: 'varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vP = position; vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }',
        fragmentShader: `uniform float uT; uniform float uA; varying vec3 vN; varying vec3 vV; varying vec3 vP;
          void main(){
            float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.4);
            float band = 0.5 + 0.5 * sin(vP.y * 7.0 + uT * 3.0) * sin(vP.x * 5.0 - uT * 2.0);
            vec3 col = mix(vec3(0.72, 0.88, 1.0), vec3(1.0), f);
            gl_FragColor = vec4(col, (0.04 + f * 0.8 + band * 0.04) * uA);
          }`,
      });
      const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), mat);
      sphere.position.copy(c); sphere.scale.setScalar(0.01); sphere.renderOrder = 8;
      scene.add(sphere);
      const core = FX.glowSprite('#dff6ff', 0.1); core.position.copy(c); scene.add(core);
      FX.ring(new V3(c.x, W.heightAt(c.x, c.z) + 0.08, c.z), '#dff6ff', R * 1.4, R, 0.5);
      AU.eraseStart();
      let t = 0, erased = false, closing = false;
      const swallow = () => {
        let n = 0;
        for (const tg of targets) {
          if (!tg.alive) continue;
          if (tg.isPlayer) {
            // 対戦: 球の中にいた相手は消滅（倒れる）
            if (tg !== spec.casterT && tg.center.distanceTo(c) < R + tg.r * 0.3 && hitTarget(tg, 9999, spec, { noStatus: true, noCrit: true }) > 0) { popup(tg.center.clone().add(new V3(0, 1, 0)), '消滅', 'pierce'); n++; }
            continue;
          }
          if (tg.center.distanceTo(c) < R + tg.r * 0.3) {
            if (spec.rec) spec.rec.add(Math.max(0, tg.hp));
            popup(tg.center.clone().add(new V3(0, 1, 0)), '消滅', 'pierce');
            tg.hp = 0; drawBar(tg);
            killTarget(tg, { quiet: true, to: c });
            n++;
          }
        }
        // 球の中を飛んでいる弾も消える
        for (let i = projs.length - 1; i >= 0; i--) if (projs[i].pos.distanceTo(c) < R) removeProj(i);
        return n;
      };
      special((dt) => {
        t += dt;
        mat.uniforms.uT.value = t;
        if (t < 0.5) {
          const k = t / 0.5, e = 1 - Math.pow(1 - k, 3);
          sphere.scale.setScalar(Math.max(0.01, R * e)); mat.uniforms.uA.value = k;
          for (let i = 0; i < 10; i++) {
            const d = new V3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
            FX.emit(c.clone().addScaledVector(d, R * e + 2), { count: 1, dir: d.clone().negate(), spread: 0, speed: 8, drag: 0, c1: '#dff6ff', c2: '#8fb8ff', life: 0.3, size: 0.25 });
          }
        } else if (!closing) {
          if (!erased) {
            erased = true;
            swallow();
            W.erase(c, R);
            H.feel('vacuum', 0.5 * near(c), 0.6, 0.6);
            FX.flash(c, '#dff6ff', 4, 30, 0.6);
          }
          sphere.scale.setScalar(R * (1 + Math.sin(t * 9) * 0.008));
          core.scale.setScalar(0.6 + Math.sin(t * 13) * 0.2);
          // 内部のものが中心へ吸いこまれていく
          for (let i = 0; i < 8; i++) {
            const d = new V3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
            FX.emit(c.clone().addScaledVector(d, rand(1, R * 0.95)), { count: 1, dir: d.clone().negate(), spread: 0, speed: 5, drag: 0, c1: '#ffffff', c2: '#8fb8ff', life: 0.45, size: 0.18 });
          }
          if (t >= 1.7) { closing = true; t = 1.7; }
        } else {
          const k = Math.min(1, (t - 1.7) / 0.22);
          sphere.scale.setScalar(Math.max(0.01, R * (1 - k * k)));
          if (k >= 1) {
            swallow();
            scene.remove(sphere); scene.remove(core);
            sphere.geometry.dispose(); mat.dispose();
            AU.eraseEnd();
            EF.play('SonicBoom', c, { scale: 2.4, color: [230, 245, 255] });
            FX.ring(c.clone(), '#ffffff', 0.5, R * 2.2, 0.5, { vertical: true, lookAt: camera.position.clone() });
            FX.ring(new V3(c.x, W.heightAt(c.x, c.z) + 0.1, c.z), '#dff6ff', 0.5, R * 1.8, 0.6);
            FX.emit(c, { count: 120, c1: '#ffffff', c2: '#8fb8ff', speed: 10, life: 0.5, size: 0.3, drag: 3 });
            FX.flash(c, '#ffffff', 8, 40, 0.4);
            whiteFlash('#e8f6ff', 0.35);
            H.feel('vacuum', 0.8 * near(c), 0.5, 0.9);
            return false;
          }
        }
        return true;
      }, [sphere, core]);
    },
    fusion(spec, aim) {
      const f = aim.dir.clone(); f.y = 0; if (f.lengthSq() < 1e-4) f.set(0, 0, -1); f.normalize();
      const start = new V3(casterPos().x, 11, casterPos().z).addScaledVector(f, 22);
      const target = aim.target ? aim.target.center.clone() : groundPointOf(aim, 45).setY(1);
      const sun = FX.glowSprite('#ffd27a', 1), corona = FX.glowSprite('#ff6a1a', 2);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshBasicMaterial({ color: 0xfff6d8, fog: false, toneMapped: false }));
      [sun, corona, ball].forEach((o) => { o.position.copy(start); scene.add(o); });
      let t = 0;
      AU.charge(1.5);
      special((dt) => {
        t += dt;
        let pos;
        if (t < 1.4) {
          const k = t / 1.4;
          pos = start;
          ball.scale.setScalar(0.3 + k * 2.7); sun.scale.setScalar(4 + k * 16); corona.scale.setScalar(8 + k * 26 + Math.sin(t * 20));
          for (let i = 0; i < 10; i++) {
            const d = new V3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
            FX.emit(start.clone().addScaledVector(d, 3 + k * 3), { count: 1, dir: d, spread: 0.2, speed: 4, c1: '#ffd24a', c2: '#ff5a1f', life: 0.6, size: 0.7 });
          }
          FX.flash(start, '#ffcf80', 2.5 * k, 35, 0.1);
        } else {
          const k = Math.min(1, (t - 1.4) / 0.7);
          pos = start.clone().lerp(target, k * k);
          trailOf({ colors: ['#ff7a1a', '#ffd24a'], element: 'fire' }, pos, 3, 10);
          if (k >= 1) {
            [sun, corona, ball].forEach((o) => scene.remove(o));
            ball.geometry.dispose(); ball.material.dispose();
            explode(target, 17, 230, Object.assign({}, spec, { burn: Math.max(spec.burn, 2) }), null, { silent: true });
            FX.emit(target, { count: 500, c1: '#ffffff', c2: '#ff9a2a', speed: 34, life: 1.4, size: 1.6, drag: 2.2 });
            FX.ring(new V3(target.x, 0.1, target.z), '#ffb84a', 1, 40, 1.4);
            FX.flash(target, '#ffd8a0', 16, 100, 1.2);
            whiteFlash('#fff1cc', 1);
            st.shake = 1.3;
            AU.bigBoom();
            return false;
          }
        }
        [sun, corona, ball].forEach((o) => o.position.copy(pos));
        return true;
      }, [sun, corona, ball]);
    },
    // ======================== 第24版 ========================
    // 電磁加速砲: 磁場のリングで 0.6 秒ためて、壁も的もすべてつらぬく閃光を一直線に撃つ
    railgun(spec, aim, tip) {
      const t0 = tip.clone();
      const dir = aim.point.clone().sub(t0); if (dir.lengthSq() < 1e-4) dir.copy(aim.dir); dir.normalize();
      const C1 = '#ff4a5a', C2 = '#4a8bff';
      const rings = [0, 1, 2].map((i) => {
        const m = new THREE.Mesh(new THREE.TorusGeometry(0.32 + i * 0.1, 0.03, 6, 36), new THREE.MeshBasicMaterial({ color: i % 2 ? C2 : C1, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
        m.position.copy(t0).addScaledVector(dir, 0.5 + i * 0.5);
        m.quaternion.setFromUnitVectors(new V3(0, 0, 1), dir);
        scene.add(m); return m;
      });
      const S = cleanSpec(spec);
      const rem = !!CTX; // 相手の魔法の再現か（あとで動く処理の中では CTX は使えないので、ここで覚えておく）
      AU.charge(0.6);
      let t = 0, fired = false;
      const fire = () => {
        let len = 100;
        if (dir.y < -0.001) len = Math.min(len, Math.max(2, -t0.y / dir.y));
        const hs = W.solidOnSegment(t0, t0.clone().addScaledVector(dir, len)); if (hs != null) len = Math.max(0.5, hs); // 固い壁では止まる
        const end = t0.clone().addScaledVector(dir, len);
        // 壁・岩・木箱・石柱・魔法の壁: すべてつらぬいて壊す
        W.propsOnSegment(t0, end, ownerKey(spec)).forEach((w) => {
          const p = t0.clone().addScaledVector(dir, w.t);
          if (w.barrier) { if (w.prop.game) damageBarrier(w.prop.game, 400, p, spec); }
          else W.blast(p, 1.6, 400, { crater: false });
          FX.emit(p, { count: 26, c1: '#ffffff', c2: C2, speed: 8, life: 0.4, size: 0.35, drag: 4 });
        });
        // 線の近くにいる的すべて
        for (const tg of targets) {
          if (!tg.alive || tg === spec.casterT) continue;
          const v = tg.center.clone().sub(t0), along = v.dot(dir);
          if (along < 0 || along > len + tg.r) continue;
          if (v.addScaledVector(dir, -along).length() < tg.r + 0.9) hitTarget(tg, 160, S, { dir: dir.clone() });
        }
        beamVisual(t0, end, C1, '#ffffff', 0.95, 0.7);
        beamVisual(t0, end, C2, '#ffffff', 0.4, 0.95, true);
        for (let k = 3, i = 0; k < len; k += 6, i++) { const p = t0.clone().addScaledVector(dir, k); after(k / 400, () => FX.ring(p, i % 2 ? C2 : C1, 0.3, 1.9, 0.35, { vertical: true, lookAt: p.clone().add(dir) })); }
        explode(end, 3, 40, Object.assign({}, S, { destroy: true }), null, { silent: true });
        FX.flash(t0, C1, 6, 22, 0.3); FX.flash(end, '#ffffff', 8, 30, 0.4);
        AU.thunder(ap(t0)); AU.impact('lightning', 4, ap(end));
        H.feel('lightning', 0.9 * near(t0), 0.3, 0.9 * near(t0));
        if (!rem) { whiteFlash('#ffd6dc', 0.3); st.shake = Math.max(st.shake, 0.6); player.kv.addScaledVector(new V3(dir.x, 0, dir.z), -7); }
        else st.shake = Math.max(st.shake, 0.25 * near(t0));
      };
      special((dt) => {
        t += dt;
        rings.forEach((m, i) => {
          m.material.opacity = fired ? Math.max(0, 1 - (t - 0.6) / 0.3) : Math.min(0.95, t / 0.35);
          m.rotation.z += dt * (9 + i * 5) * (i % 2 ? -1 : 1);
          m.scale.setScalar(fired ? 1 + (t - 0.6) * 5 : 1 - 0.18 * Math.sin(t * 34 + i));
        });
        if (!fired) {
          const c = t0.clone().addScaledVector(dir, 0.9);
          FX.emit(c, { count: 3, c1: '#ffffff', c2: Math.random() < 0.5 ? C1 : C2, speed: -3, jitter: 0.9, life: 0.18, size: 0.14, drag: 0 });
          if (t >= 0.6) { fired = true; fire(); }
        }
        if (t >= 0.95) { rings.forEach((m) => { scene.remove(m); m.geometry.dispose(); m.material.dispose(); }); return false; }
        return true;
      }, rings);
    },
    // 大地震: 自分のまわり 25m の大地を3秒揺らし、地面にいる的を 0.5 秒ごとに打つ（合計 120）
    quake(spec) {
      const base = casterPos();
      const c = new V3(base.x, W.heightAt(base.x, base.z), base.z);
      const R = 25, S = cleanSpec(spec);
      const crack = new THREE.Mesh(new THREE.PlaneGeometry(R * 2.1, R * 2.1), new THREE.MeshBasicMaterial({ map: crackTex(), transparent: true, opacity: 0, depthWrite: false }));
      crack.rotation.x = -Math.PI / 2; crack.rotation.z = rand(0, 6); crack.position.set(c.x, c.y + 0.07, c.z);
      scene.add(crack);
      AU.rumble(3.4); AU.impact('earth', 4, ap(c));
      EF.impact('earth', c, 6);
      let t = 0, tick = 0, n = 0;
      special((dt) => {
        t += dt;
        crack.material.opacity = Math.min(1, t / 0.25) * (t > 3 ? Math.max(0, 1 - (t - 3) / 0.6) : 1);
        if (t < 3) {
          // 揺れ: 震源に近いほど強い（相手の大地震でも揺れる）
          const dl = Math.hypot(player.pos.x - c.x, player.pos.z - c.z);
          if (dl < R + 12) st.shake = Math.max(st.shake, 0.32 * Math.max(0.2, 1 - dl / (R + 12)));
          for (let i = 0; i < 7; i++) {
            const a = rand(0, Math.PI * 2), r = Math.sqrt(Math.random()) * R;
            const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
            FX.emit(new V3(x, W.heightAt(x, z) + 0.15, z), { count: 1, c1: '#8a6a4a', c2: '#d0b090', speed: 1.5, up: 3, gravity: 9, life: 0.8, size: rand(0.25, 0.6), drag: 0.6 });
          }
        }
        tick -= dt;
        if (tick <= 0 && n < 6) {
          tick = 0.5; n++;
          FX.ring(new V3(c.x, c.y + 0.1, c.z), '#d08a45', 1, R, 0.5);
          FX.ring(new V3(c.x, c.y + 0.12, c.z), '#ffd08a', 1, R * 0.6, 0.4);
          if (n === 1 || n === 4) W.blast(new V3(c.x, c.y + 0.5, c.z), R, 110, { crater: false });
          for (const tg of targets) {
            if (!tg.alive || tg === spec.casterT) continue;
            if (Math.hypot(tg.center.x - c.x, tg.center.z - c.z) > R + tg.r || !grounded(tg)) continue;
            hitTarget(tg, 20, S, { noCrit: true, dir: new V3(0, 1, 0) });
            if (!tg.isPlayer) tg.dispV.y += 2.2 * tg.mass;
          }
          AU.impact('earth', 2.5, ap(c));
        }
        if (t >= 3.6) { scene.remove(crack); crack.geometry.dispose(); crack.material.dispose(); return false; }
        return true;
      }, [crack]);
    },
    // 世界樹: 狙った場所に高さ 20m の大樹。20 秒のあいだ、まわり 12m の的をつるで打ち、近くにいる自分を回復する
    yggdrasil(spec, aim) {
      const p = groundPointOf(aim, 40); p.y = W.heightAt(p.x, p.z);
      const tree = makeYggdrasil();
      tree.g.position.copy(p); tree.g.scale.setScalar(0.01); scene.add(tree.g);
      const S = cleanSpec(spec);
      const DUR = 20, VR = 12, HR = 10;
      FX.ring(new V3(p.x, p.y + 0.08, p.z), '#9dff6a', 0.5, VR, 0.8);
      FX.emit(new V3(p.x, p.y + 0.5, p.z), { count: 80, c1: '#9dff6a', c2: '#fff3b8', speed: 4, up: 6, life: 1.2, size: 0.5, drag: 1 });
      if (AU.summon) AU.summon('spirit', 'light', ap(p));
      AU.rumble(1.2);
      let t = 0, tick = 1.2, healT = 1;
      special((dt) => {
        t += dt;
        const grow = Math.min(1, t / 1.4), e = 1 - Math.pow(1 - grow, 3);
        const fade = t > DUR ? Math.max(0, 1 - (t - DUR) / 1) : 1;
        tree.g.scale.setScalar(Math.max(0.01, e * fade));
        tree.g.rotation.y += dt * 0.03;
        tree.blobs.forEach((b, i) => { b.rotation.y += dt * (0.1 + (i % 3) * 0.05); });
        tree.ring.rotation.z -= dt * 0.15;
        if (grow < 1 && Math.random() < 0.8) FX.emit(new V3(p.x + rand(-2, 2), p.y + 0.3, p.z + rand(-2, 2)), { count: 2, c1: '#8a6a4a', c2: '#9dff6a', speed: 3, up: 4, gravity: 10, life: 0.8, size: 0.35 });
        // 光の葉が舞い落ちる
        if (t < DUR && Math.random() < 0.9) {
          const a = rand(0, Math.PI * 2), r = rand(1, 7);
          FX.emit(new V3(p.x + Math.cos(a) * r, p.y + rand(12, 18) * e, p.z + Math.sin(a) * r), { count: 1, c1: '#c8ff8a', c2: '#fff3b8', speed: 0.3, up: -1.6, life: 2.4, size: rand(0.2, 0.4), drag: 0.3 });
        }
        if (t < DUR && grow >= 1) {
          tick -= dt;
          if (tick <= 0) {
            tick = 1;
            const foes = targets.filter((x) => x.alive && x !== spec.casterT && !friendly(x, spec) && !(x.isPlayer && x.netProt) && Math.hypot(x.center.x - p.x, x.center.z - p.z) < VR + x.r)
              .sort((a, b) => a.center.distanceToSquared(p) - b.center.distanceToSquared(p)).slice(0, 4);
            foes.forEach((x) => {
              const from = new V3(p.x + rand(-1.2, 1.2), p.y + rand(0.4, 2), p.z + rand(-1.2, 1.2));
              lightning(from, x.center.clone(), '#7dff6a', '#ffe680', { life: 0.35, size: 0.35 });
              hitTarget(x, 15, S, { noCrit: true, dir: x.center.clone().sub(p) });
            });
          }
          // 回復: 自分の木の近く（10m）にいるとき
          healT -= dt;
          if (healT <= 0) {
            healT = 1;
            if (!spec.remote && Math.hypot(player.pos.x - p.x, player.pos.z - p.z) < HR) {
              healSelf(6, 8);
              FX.emit(new V3(player.pos.x, player.pos.y + 0.3, player.pos.z), { count: 10, c1: '#9dffb0', c2: '#fff3b8', speed: 0.6, up: 2.5, jitter: 0.7, life: 0.8, size: 0.2, drag: 0.6 });
            }
          }
        }
        if (t >= DUR + 1) { disposeObj(tree.g); return false; }
        return true;
      }, [tree.g]);
    },
    // 巨神像: 目の前に大きな召喚陣を描き、天から光の柱を落として巨神を呼ぶ
    titan(spec, aim) {
      const c = casterPos();
      const f = aim.dir.clone(); f.y = 0; if (f.lengthSq() < 1e-4) f.set(0, 0, -1); f.normalize();
      const p = new V3(c.x + f.x * 5, 0, c.z + f.z * 5);
      const b = W.bound(), r = Math.hypot(p.x, p.z); if (r > b - 3) { p.x *= (b - 3) / r; p.z *= (b - 3) / r; }
      p.y = W.floorAt(p.x, p.z, c.y + 1);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(11, 11), new THREE.MeshBasicMaterial({ map: FX.circleTex, color: 0xffcf6a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.position.set(p.x, p.y + 0.07, p.z); scene.add(m);
      const rem = !!CTX;
      AU.charge(0.6);
      let t = 0, spawned = false;
      special((dt) => {
        t += dt;
        m.material.opacity = Math.min(0.95, t / 0.4) * (t > 1.6 ? Math.max(0, 1 - (t - 1.6) / 0.6) : 1);
        m.rotation.z += dt * 1.4; m.scale.setScalar(0.5 + Math.min(1, t / 0.5) * 0.5);
        if (!spawned) FX.emit(new V3(p.x + rand(-4, 4), p.y + 0.2, p.z + rand(-4, 4)), { count: 2, c1: '#ffcf6a', c2: '#ffffff', speed: 0.4, up: 5, life: 0.7, size: 0.35, drag: 0.5 });
        if (!spawned && t >= 0.6) {
          spawned = true;
          beamVisual(new V3(p.x, p.y + 45, p.z), new V3(p.x, p.y, p.z), '#ffcf6a', '#ffffff', 2.6, 0.9);
          FX.flash(new V3(p.x, p.y + 3, p.z), '#ffcf6a', 8, 40, 0.5);
          FX.ring(new V3(p.x, p.y + 0.1, p.z), '#ffcf6a', 0.5, 9, 0.6);
          FX.emit(new V3(p.x, p.y + 0.5, p.z), { count: 70, c1: '#8a6a4a', c2: '#ffcf6a', speed: 8, up: 5, gravity: 14, life: 1, size: 0.45 });
          st.shake = Math.max(st.shake, 0.35 * near(p));
          if (AU.summon) AU.summon('golem', spec.element, ap(p));
          if (!rem && st.running) spawnSummon('titan', spec, p); // 相手の巨神は、相手から届く状態で出す
        }
        if (t >= 2.2) { scene.remove(m); m.geometry.dispose(); m.material.dispose(); return false; }
        return true;
      }, [m]);
      if (!CTX) popup(ahead(2.5, 0.1), '巨神を召喚', 'ward');
    },
    // 不死鳥: 前へ飛び立ち、大きく旋回して戻ってくる。通り道の的を焼き、戻ったら回復
    phoenix(spec, aim) {
      const c0 = casterPos().clone();
      const f = aim.dir.clone(); f.y = 0; if (f.lengthSq() < 1e-4) f.set(0, 0, -1); f.normalize();
      const side = new V3(-f.z, 0, f.x);
      const start = new V3(c0.x, c0.y + 2.2, c0.z).addScaledVector(f, 1.5);
      // 狙った方向へまっすぐ 36m 飛び（1.3 秒）、大きく旋回して戻ってくる（1.9 秒）
      const F = start.clone().addScaledVector(f, 36);
      const Q1 = F.clone().addScaledVector(f, 14).addScaledVector(side, 13); Q1.y += 1.5;
      const Q2 = start.clone().addScaledVector(f, 10).addScaledVector(side, 18); Q2.y += 1.5;
      const bird = makePhoenix(); bird.g.position.copy(start); scene.add(bird.g);
      const S = cleanSpec(spec, { burn: 2 });
      const hit = new Set(spec.casterT ? [spec.casterT] : []);
      const caster = CTX ? CTX.casterT : null, rem = !!CTX;
      const back = () => (rem ? (caster && caster.alive ? caster.center.clone() : c0.clone().setY(c0.y + 1)) : new V3(player.pos.x, player.pos.y + 1.2, player.pos.z));
      const T1 = 1.3, DUR = 3.2;
      const at = (tt) => {
        if (tt <= T1) { const u = tt / T1; return start.clone().lerp(F, u * (2 - u) * 0.15 + u * 0.85); }
        return bez(F, Q1, Q2, back(), Math.min(1, (tt - T1) / (DUR - T1)));
      };
      AU.cast('fire'); AU.playSample('fire_wind', { vol: 0.6, rate: 0.8, dur: 1.6 });
      let t = 0;
      special((dt) => {
        t += dt;
        const u = Math.min(1, t / DUR), P3 = back();
        const pos = at(t), nxt = at(Math.min(DUR, t + 0.06));
        bird.g.position.copy(pos);
        if (nxt.distanceToSquared(pos) > 1e-4) bird.g.lookAt(nxt);
        const flap = 0.45 + Math.sin(t * 11) * 0.6; // V 字に持ち上げて羽ばたく（後ろから見ても翼の形がわかる）
        bird.wings.forEach((w, i) => { w.rotation.z = (i ? 1 : -1) * flap; });
        bird.tails.forEach((tl, i) => { tl.rotation.y = Math.sin(t * 9 + i) * 0.15; });
        FX.emit(pos, { count: 3, c1: '#ff4a10', c2: '#ffb030', speed: 1.2, up: 0.5, jitter: 0.8, life: 0.5, size: 0.45, drag: 1.5 });
        if (Math.random() < 0.5) FX.emit(pos, { count: 1, c1: '#fff0b0', c2: '#ff7a1a', speed: 2, up: 1.5, life: 0.9, size: 0.25, gravity: 3 });
        for (const tg of targets) {
          if (!tg.alive || hit.has(tg) || friendly(tg, spec)) continue;
          if (Math.hypot(tg.center.x - pos.x, tg.center.z - pos.z) < 2.4 + tg.r && Math.abs(tg.center.y - pos.y) < 3.5) {
            hit.add(tg);
            hitTarget(tg, 50, S, { dir: nxt.clone().sub(pos) });
            FX.emit(tg.center, { count: 30, c1: '#ff6a1a', c2: '#ffd24a', speed: 6, up: 2, life: 0.5, size: 0.5, drag: 3 });
            AU.impact('fire', 2, ap(tg.center));
          }
        }
        if (u >= 1) {
          disposeObj(bird.g);
          FX.ring(new V3(P3.x, P3.y - 1.1, P3.z), '#ff9a3a', 0.4, 4, 0.5);
          FX.emit(P3, { count: 60, c1: '#ff6a1a', c2: '#fff0b0', speed: 3, up: 3, jitter: 0.8, life: 0.9, size: 0.4, drag: 1.2 });
          FX.flash(P3, '#ffb040', 4, 12, 0.35);
          if (!spec.remote) { healSelf(60, 40, ahead(2.5, -0.2)); whiteFlash('#ffb060', 0.2); }
          return false;
        }
        return true;
      }, [bird.g]);
    },
    // 時間遅延: 狙った場所に半径 10m の時の球を 8 秒張る（中では、張った人以外の時間が 1/5）
    dilation(spec, aim) {
      const c = groundPointOf(aim, 40); c.y = W.heightAt(c.x, c.z) + 1.2;
      const R = 10, DUR = 8;
      const d = { owner: okey(ownerKey(spec)), c: c.clone(), R, alive: true };
      dilations.push(d);
      const mat = rimSphereMat('#a8a2ff');
      const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 28), mat); sphere.position.copy(c); sphere.scale.setScalar(0.01); sphere.renderOrder = 8;
      const face = new THREE.Mesh(new THREE.PlaneGeometry(R * 2, R * 2), new THREE.MeshBasicMaterial({ map: FX.circleTex, color: 0x7af0e0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      face.rotation.x = -Math.PI / 2; face.position.set(c.x, c.y - 1.12, c.z);
      // 時計の針（長針と短針）
      const hands = new THREE.Group(); hands.position.set(c.x, c.y - 1.1, c.z);
      const handMat = new THREE.MeshBasicMaterial({ color: 0xdff8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.04, R * 0.85), handMat); hl.position.z = R * 0.42; const hlP = new THREE.Group(); hlP.add(hl); hands.add(hlP);
      const hs = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.04, R * 0.5), handMat); hs.position.z = R * 0.25; const hsP = new THREE.Group(); hsP.add(hs); hands.add(hsP);
      const rings = [0, 1, 2].map((i) => {
        const m = new THREE.Mesh(new THREE.TorusGeometry(R * 0.985, 0.05, 6, 80), new THREE.MeshBasicMaterial({ color: i === 1 ? 0x7af0e0 : 0xa8a2ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
        m.position.copy(c); m.rotation.set(i * 1.05, i * 0.7, 0); return m;
      });
      [sphere, face, hands, ...rings].forEach((o) => scene.add(o));
      AU.cast('time'); AU.playSample('chant_b', { vol: 0.55, rate: 0.55, dur: 2.2 }); AU.playSample('converge', { vol: 0.4, rate: 0.6 });
      let t = 0;
      special((dt) => {
        t += dt;
        const k = t < 0.5 ? t / 0.5 : t > DUR ? Math.max(0, 1 - (t - DUR) / 0.5) : 1;
        sphere.scale.setScalar(Math.max(0.01, R * (t < 0.5 ? 1 - Math.pow(1 - k, 3) : 1)));
        mat.uniforms.uT.value = t; mat.uniforms.uA.value = k;
        face.material.opacity = k * 0.45; handMat.opacity = k * 0.7; face.rotation.z -= dt * 0.05;
        hlP.rotation.y -= dt * 0.9; hsP.rotation.y -= dt * 0.08;
        rings.forEach((m, i) => { m.material.opacity = k * 0.6; m.rotation.y += dt * 0.12 * (i % 2 ? -1 : 1); m.rotation.x += dt * 0.05; });
        // ゆっくり漂う光の粒
        if (t < DUR && Math.random() < 0.8) {
          const v = new V3(rand(-1, 1), rand(-0.5, 1), rand(-1, 1)).normalize().multiplyScalar(rand(1, R * 0.95));
          FX.emit(c.clone().add(v), { count: 1, c1: '#a8a2ff', c2: '#7af0e0', speed: 0.15, life: 1.8, size: rand(0.15, 0.35), drag: 0.2 });
        }
        d.alive = t < DUR;
        if (t >= DUR + 0.5) {
          d.alive = false; const i = dilations.indexOf(d); if (i >= 0) dilations.splice(i, 1);
          [sphere, face, ...rings].forEach((o) => { scene.remove(o); o.geometry.dispose(); o.material.dispose(); });
          disposeObj(hands);
          return false;
        }
        return true;
      }, [sphere, face, hands, ...rings]);
    },
    // 完全反磁性: 15 秒のあいだ少し浮かび、まわり 3m に入った相手の弾をはね返し、近づいた敵を押し返す
    meissner(spec) {
      const owner = okey(ownerKey(spec)), isMe = owner === 'me';
      const who = CTX ? CTX.casterT : selfT;
      meissners.forEach((x) => { if (x.owner === owner) x.alive = false; }); // かけ直したら、前のものは消える
      const m = { owner, who, R: 3, alive: true };
      meissners.push(m);
      const S = cleanSpec(spec, { knock: 1.2 });
      const g = new THREE.Group(); scene.add(g);
      const ring = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 6.4), new THREE.MeshBasicMaterial({ map: FX.circleTex, color: 0x9fe4ff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = -1.5; g.add(ring);
      const iceMat = new THREE.MeshStandardMaterial({ color: 0xdff8ff, emissive: 0x7fd8ff, emissiveIntensity: 0.9, flatShading: true, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.9 });
      const orbit = new THREE.Group(); g.add(orbit);
      for (let k = 0; k < 6; k++) { const s = new THREE.Mesh(new THREE.OctahedronGeometry(isMe ? 0.09 : 0.16, 0), iceMat); const a = (k / 6) * Math.PI * 2; s.position.set(Math.cos(a) * (isMe ? 1.0 : 1.35), isMe ? -1.0 : 0, Math.sin(a) * (isMe ? 1.0 : 1.35)); s.scale.y = 1.6; orbit.add(s); }
      let shell = null;
      const lines = [];
      if (!isMe) {
        shell = makeWardMesh(1.7, 0xbff0ff); g.add(shell);
        [0xff4a5a, 0x4a8bff].forEach((col, i) => { const l = new THREE.Mesh(new THREE.TorusGeometry(m.R, 0.035, 6, 60), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false })); l.rotation.y = i * Math.PI / 2; g.add(l); lines.push(l); });
      }
      AU.cast('ice'); if (AU.barrier) AU.barrier('ice', 'sphere', null);
      if (isMe) popup(ahead(2.5, 0.1), '完全反磁性 15秒', 'ward');
      let t = 0, tick = 0.3;
      special((dt) => {
        t += dt;
        const pos = meissnerPos(m);
        if (!m.alive || t >= 15 || !pos) { m.alive = false; const i = meissners.indexOf(m); if (i >= 0) meissners.splice(i, 1); disposeObj(g); return false; }
        g.position.copy(pos);
        const blink = t > 13 ? 0.5 + 0.5 * Math.sin(t * 20) : 1;
        orbit.rotation.y += dt * 2.2; ring.rotation.z += dt * 1.5; ring.material.opacity = 0.55 * blink;
        if (shell) { shell.material.uniforms.uTime.value = t; shell.material.uniforms.uAlpha.value = 0.75 * blink; }
        lines.forEach((l, i) => { l.rotation.x += dt * (1.2 + i * 0.4); l.material.opacity = 0.5 * blink; });
        if (Math.random() < 0.5) FX.emit(pos.clone().add(new V3(rand(-1, 1), -1.2, rand(-1, 1))), { count: 1, c1: '#dff8ff', c2: '#7fd8ff', speed: 0.3, up: 0.8, life: 0.8, size: 0.15, drag: 1 });
        // 近づいた敵を押し返す（練習場の的・召喚獣・相手）
        tick -= dt;
        if (tick <= 0) {
          tick = 0.5;
          for (const tg of targets) {
            if (!tg.alive || tg === who || targetOwner(tg) === owner || friendly(tg, spec) || (tg.isPlayer && tg.netProt)) continue;
            const v = tg.center.clone().sub(pos); v.y = 0; const dd = v.length();
            if (dd < m.R + tg.r) {
              if (dd > 1e-3) v.multiplyScalar(1 / dd); else v.set(1, 0, 0);
              hitTarget(tg, 8, S, { dir: v, noCrit: true });
              beamVisual(pos.clone().addScaledVector(v, 1.2), tg.center.clone(), '#7fd8ff', '#ffffff', 0.06, 0.18, true);
            }
          }
        }
        return true;
      }, [g]);
    },
    // 千刃の門: 背後から左右の空中に鋼の魔法陣を 14 個開き、剣・槍・斧を 2.6 秒のあいだ撃ち続ける
    blades(spec, aim) {
      const rem = !!CTX, owner = okey(ownerKey(spec));
      const base = casterPos().clone();
      const f = aim.dir.clone(); f.y = 0; if (f.lengthSq() < 1e-4) f.set(0, 0, -1); f.normalize();
      const side = new V3(-f.z, 0, f.x);
      // ねらい: ねらった相手（いなければ視線の近くの相手）を追う。いなければ、ねらった地面
      const focus = aim.target || nearestToRay(aim, 0.3, 80);
      const fixed = aim.target ? aim.target.center.clone() : groundPointOf(aim, 60).setY(0.8);
      const S = cleanSpec(spec);
      const root = new THREE.Group(); scene.add(root);
      const gm = bladeKit();
      // 魔法陣: 背中側から左右へ、扇のように並べる
      const portalMat = new THREE.MeshBasicMaterial({ map: FX.circleTex, color: 0xcfe0ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const coreMat = new THREE.MeshBasicMaterial({ color: 0xfff1c0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const portals = [];
      const N = 14;
      for (let i = 0; i < N; i++) {
        const u = N > 1 ? i / (N - 1) : 0.5;
        const lat = (u - 0.5) * 13 + rand(-0.4, 0.4);
        const back = 1.6 - Math.abs(u - 0.5) * 3.2 + rand(-0.3, 0.3); // まん中ほど後ろ、はしほど横
        const up = 2.6 + (i % 3) * 1.25 + rand(-0.3, 0.3);
        const p = base.clone().addScaledVector(f, -back).addScaledVector(side, lat); p.y = base.y + up;
        const g = new THREE.Group(); g.position.copy(p); root.add(g);
        const ring = new THREE.Mesh(gm.portalGeo, portalMat); g.add(ring);
        const core = new THREE.Mesh(gm.coreGeo, coreMat); core.position.z = 0.02; g.add(core);
        g.lookAt(p.clone().addScaledVector(f, 10));
        g.scale.setScalar(0.01);
        portals.push({ g, ring, open: 0.05 + i * 0.025 + rand(0, 0.06) });
      }
      const weapons = [];
      const launch = () => {
        const pt = portals[(Math.random() * portals.length) | 0];
        const from = pt.g.position.clone();
        const dest = (focus && focus.alive ? focus.center.clone() : fixed.clone()).add(new V3(rand(-1.3, 1.3), rand(-0.5, 0.8), rand(-1.3, 1.3)));
        const dir = dest.sub(from).normalize();
        const kind = (Math.random() * 3) | 0;
        const m = new THREE.Group();
        gm.parts[kind].forEach(([geo, mat, y]) => { const mm = new THREE.Mesh(geo, mat); mm.position.y = y; m.add(mm); });
        m.position.copy(from); m.quaternion.setFromUnitVectors(UP, dir); m.scale.setScalar(1.4);
        root.add(m);
        weapons.push({ m, pos: from.clone(), vel: dir.multiplyScalar(62), life: 2.2, stuck: 0, hit: new Set(spec.casterT ? [spec.casterT] : []) });
        FX.emit(from, { count: 10, c1: '#ffffff', c2: '#cfe0ff', speed: 4, life: 0.25, size: 0.25, drag: 4 });
        AU.whoosh();
      };
      if (!rem) popup(ahead(2.5, 0.2), '千刃の門', 'ward');
      AU.charge(0.5); AU.playSample('cast_holy', { vol: 0.5, rate: 0.7, dur: 1.6 });
      const FIRE0 = 0.45, FIRE1 = 3.05;
      let t = 0, shotT = 0;
      special((dt) => {
        t += dt;
        // 魔法陣が順に開き、最後にまとめて閉じる
        const close = t > FIRE1 ? Math.max(0, 1 - (t - FIRE1) / 0.4) : 1;
        portals.forEach((p, i) => {
          const k = Math.min(1, Math.max(0, (t - p.open) / 0.22));
          p.g.scale.setScalar(Math.max(0.01, (1 - Math.pow(1 - k, 3)) * close));
          p.ring.rotation.z += dt * (i % 2 ? 2.2 : -2.2);
        });
        portalMat.opacity = 0.95 * close; coreMat.opacity = 0.55 * close;
        // 連射（1 秒に約 12 本）
        if (t >= FIRE0 && t < FIRE1) { shotT -= dt; while (shotT <= 0) { shotT += 0.085; launch(); } }
        for (let i = weapons.length - 1; i >= 0; i--) {
          const w = weapons[i];
          if (w.stuck > 0) {
            // 刺さった武器は、少しして光になって消える
            w.stuck += dt;
            if (w.stuck > 1.2) { const k = Math.max(0.001, 1 - (w.stuck - 1.2) / 0.3); w.m.scale.setScalar(1.4 * k); if (k <= 0.002) { root.remove(w.m); weapons.splice(i, 1); } }
            continue;
          }
          w.life -= dt;
          const prev = w.pos.clone();
          w.pos.addScaledVector(w.vel, dt);
          let stop = null;
          // 的・相手・召喚獣
          for (const tg of targets) {
            if (!tg.alive || w.hit.has(tg) || friendly(tg, spec) || targetOwner(tg) === owner) continue;
            const seg = w.pos.clone().sub(prev), L2 = seg.lengthSq();
            const k = L2 > 0 ? Math.max(0, Math.min(1, tg.center.clone().sub(prev).dot(seg) / L2)) : 0;
            if (prev.clone().addScaledVector(seg, k).distanceTo(tg.center) < tg.r + 0.55) {
              w.hit.add(tg);
              hitTarget(tg, 14, S, { dir: w.vel.clone().normalize() });
              FX.emit(tg.center, { count: 14, c1: '#ffffff', c2: '#cfe0ff', speed: 6, life: 0.25, size: 0.25, drag: 4 });
              AU.impact('metal', 1, ap(tg.center));
              stop = 'hit'; break;
            }
          }
          // 魔法の壁・地形・地面には突き刺さる
          if (!stop) {
            const bh = W.barrierOnSegment(prev, w.pos, 0.2, owner);
            if (bh) { if (bh.barrier.game) damageBarrier(bh.barrier.game, 14, w.pos.clone(), spec); stop = 'hit'; }
            else if (W.collide(w.pos, 0.15)) stop = 'stick';
            else if (w.pos.y <= W.heightAt(w.pos.x, w.pos.z) + 0.15) { w.pos.y = W.heightAt(w.pos.x, w.pos.z) + 0.15; stop = 'stick'; }
          }
          if (stop === 'stick') {
            w.stuck = 0.001; w.m.position.copy(w.pos).addScaledVector(w.vel.clone().normalize(), 0.5);
            FX.emit(w.pos, { count: 12, c1: '#8a7a6a', c2: '#d8d0c0', speed: 4, up: 2, gravity: 12, life: 0.6, size: 0.22 });
            AU.impact('metal', 0.6, ap(w.pos));
            continue;
          }
          if (stop === 'hit' || w.life <= 0) { root.remove(w.m); weapons.splice(i, 1); continue; }
          w.m.position.copy(w.pos);
          if (Math.random() < 0.5) FX.emit(w.pos, { count: 1, c1: '#ffffff', c2: '#cfe0ff', speed: 0.3, life: 0.18, size: 0.18, drag: 2 });
        }
        if (t >= FIRE1 + 0.4 && !weapons.length) { scene.remove(root); portalMat.dispose(); coreMat.dispose(); return false; }
        return true;
      }, [root]);
    },
    // 賢者の石: 狙った場所に赤い石を生み、まわり 9m を黄金に変える
    philosopher(spec, aim) {
      const c = groundPointOf(aim, 40); c.y = W.heightAt(c.x, c.z);
      const R = 9;
      const circle = new THREE.Mesh(new THREE.PlaneGeometry(R * 2.2, R * 2.2), new THREE.MeshBasicMaterial({ map: FX.circleTex, color: 0xffcf4a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      circle.rotation.x = -Math.PI / 2; circle.position.set(c.x, c.y + 0.07, c.z);
      const stone = new THREE.Mesh(new THREE.OctahedronGeometry(0.6, 0), new THREE.MeshStandardMaterial({ color: 0xc8102a, emissive: 0xff2a3a, emissiveIntensity: 1.2, flatShading: true, roughness: 0.15, metalness: 0.5 }));
      stone.scale.y = 1.4; stone.position.set(c.x, c.y + 2.4, c.z);
      const glow = FX.glowSprite('#ff3a4a', 4); glow.position.copy(stone.position);
      [circle, stone, glow].forEach((o) => scene.add(o));
      const rem = !!CTX;
      AU.secret(); AU.charge(1);
      let t = 0, done = false;
      const transmute = () => {
        FX.ring(new V3(c.x, c.y + 0.1, c.z), '#ffd24a', 0.5, R * 1.1, 0.6);
        FX.ring(new V3(c.x, c.y + 1.5, c.z), '#fff3b8', 0.5, R, 0.5, { vertical: true, lookAt: camera.position.clone() });
        FX.emit(new V3(c.x, c.y + 2, c.z), { count: 220, c1: '#ffd24a', c2: '#fff3b8', speed: 11, up: 5, gravity: 12, drag: 0.6, life: 1.4, size: 0.3 });
        FX.flash(new V3(c.x, c.y + 2, c.z), '#ffd24a', 10, 40, 0.6);
        if (!rem) whiteFlash('#ffe9a0', 0.3);
        AU.impact('metal', 4, ap(c)); AU.playSample('cast_holy', { vol: 0.6, rate: 0.8, dur: 2 });
        const S = cleanSpec(spec, { freeze: 1.2 });
        for (const tg of aliveTargets()) {
          if (tg === spec.casterT || friendly(tg, spec)) continue;
          if (Math.hypot(tg.center.x - c.x, tg.center.z - c.z) > R + tg.r * 0.5) continue;
          if (tg.isPlayer || (tg.isSummon && tg.puppet)) { hitTarget(tg, 120, S, { noCrit: true }); continue; }
          if (spec.remote) continue;
          tg.goldT = 4;
          if (tg.hp <= 150 && !tg.isSummon) {
            // 弱い的は黄金に変わって砕ける（得点 2 倍）
            if (spec.rec) spec.rec.add(Math.max(0, tg.hp));
            tg.golden = true;
            popup(tg.center.clone().add(new V3(0, 1, 0)), '黄金化', 'pierce');
            tg.hp = 0; drawBar(tg);
            killTarget(tg);
          } else hitTarget(tg, 120, S, { noCrit: true });
        }
      };
      special((dt) => {
        t += dt;
        circle.material.opacity = Math.min(0.9, t / 0.5 * 0.9) * (t > 1.4 ? Math.max(0, 1 - (t - 1.4) / 0.6) : 1);
        circle.rotation.z += dt * (done ? 0.6 : 2.4);
        stone.rotation.y += dt * 3; stone.position.y = c.y + 2.4 + Math.sin(t * 4) * 0.12;
        const sk = done ? Math.max(0.01, 1 - (t - 1) / 0.3) : 0.3 + Math.min(1, t) * 0.7;
        stone.scale.set(sk, sk * 1.4, sk); glow.scale.setScalar(4 * sk + (done ? 0 : Math.sin(t * 20) * 0.3));
        if (!done) {
          const a = rand(0, Math.PI * 2), r = rand(3, R);
          FX.emit(new V3(c.x + Math.cos(a) * r, c.y + 0.3, c.z + Math.sin(a) * r), { count: 1, c1: '#ffd24a', c2: '#fff3b8', speed: 0.5, up: 2, life: 0.7, size: 0.25, drag: 0.5 });
          if (t >= 1) { done = true; transmute(); }
        }
        if (t >= 2) { [circle, stone].forEach((o) => { scene.remove(o); o.geometry.dispose(); o.material.dispose(); }); scene.remove(glow); return false; }
        return true;
      }, [circle, stone, glow]);
    },
  };

  // ======================================================================
  //  発動
  // ======================================================================
  function castSpell(spec0, aim, rec) {
    const spec = rec ? Object.assign({}, spec0, { rec }) : spec0;
    const tip = getTip();
    AU.cast(spec.element);
    const [c1] = colorsOf(spec);
    if (!CTX) {
      H.feel(spec.element, 0.1, 0.14, 0.18);
      castCircle.material.color.set(c1);
      st.castGlow = 1;
      st.recoil = 1;
    }
    FX.emit(tip, { count: 14, c1, c2: colorsOf(spec)[1], speed: 2.5, life: 0.3, size: 0.12, drag: 3, rainbow: spec.rainbow });
    if (spec.secret) SECRET[spec.secret](spec, aim, tip);
    else FORM[spec.form](spec, aim, tip);
  }

  // 魔法を放つ（スロットからも、声で唱えたときも、ここを通る）
  // 杖と放ち方による補正（mode: 'slot' = 無詠唱 / 'chant' = 杖を持って詠唱 / 'bare' = 素手で詠唱）
  G.castMods = function (mode) {
    const m = baseMods(mode);
    m.dmg *= DER.power; m.cd *= DER.cdMul; // レベルで上がった威力と、短くなった待ち時間
    return m;
  };
  function baseMods(mode) {
    const w = MG.WAND_MAP[st.wand] || MG.WANDS[0];
    if (mode === 'bare' || st.wand === 'bare') return { mode: 'bare', dmg: MG.BARE.dmg, cost: MG.BARE.cost, cd: 1, pen: 0, speed: 1 };
    if (mode === 'chant') return { mode: 'chant', dmg: w.dmg * MG.CHANT_WAND_MUL, cost: w.cost, cd: w.cd, pen: w.pen, speed: w.speed };
    if (mode === 'draw') return { mode: 'draw', dmg: w.dmg, cost: w.cost, cd: w.cd, pen: w.pen, speed: w.speed }; // 描いて唱える: 効果はそのまま
    return { mode: 'slot', dmg: w.dmg, cost: w.cost, cd: w.cd, pen: w.pen, speed: w.speed };
  }
  G.costFor = function (spec, mode) { return Math.max(1, Math.round(spec.cost * G.castMods(mode).cost)); };
  function applyMods(spec, m) {
    return Object.assign({}, spec, { mult: m.dmg, cost: Math.max(1, Math.round(spec.cost * m.cost)), cd: spec.cd * m.cd, penetrate: (spec.penetrate || 0) + m.pen, speed: (spec.speed || 0) * m.speed, castMode: m.mode });
  }
  // スロットの残り回数（杖ごと・スロットごと。時間で1回ずつ戻る）。隠し魔法のスロットは1回まで
  G.chargeMax = function (i, wandId) {
    const sp = (st.slotsByWand[wandId || st.wand] || [])[i];
    return sp && sp.secret ? MG.SECRET_CHARGES : MG.SLOT_CHARGES;
  };
  G.charge = function (i, wandId) {
    const k = (wandId || st.wand) + ':' + i;
    const max = G.chargeMax(i, wandId);
    if (!st.charges[k]) st.charges[k] = { n: max, t: 0, max };
    const c = st.charges[k];
    c.max = max; if (c.n > max) c.n = max;
    return c;
  };
  function release(spec0, via, mods) {
    const spec = applyMods(spec0, mods || G.castMods('slot'));
    if (M.on) { spec.casterT = selfT; M.prot = 0; }
    st.mp -= spec.cost;
    st.gcd = 0.12;
    st.lastCast = spec;
    const rec = {
      key: spec.seq.join('|'), dmg: 0, pierce: 0,
      add(d) { this.dmg += d; if (MG.UI && MG.UI.onCastDamage) MG.UI.onCastDamage(this); },
      setPierce(n) { if (n > this.pierce) { this.pierce = n; if (MG.UI && MG.UI.onCastPierce) MG.UI.onCastPierce(this); } },
    };
    const aim = getAim(spec.range || 70);
    castN = ++castSerial; const n = castN;
    castSpell(spec, aim, rec);
    if (M.on && G.onLocalCast) G.onLocalCast(packCast(spec0, mods || G.castMods('slot'), aim));
    // 使い魔: 小さな光の玉が現れて、しばらくそばで戦う
    if (spec.familiar > 0) after(0.25, () => { if (st.running && (!M.on || M.alive)) spawnSummon('wisp', Object.assign({}, spec, { rec }), player.pos.clone().add(new V3(0, 2.2, 0))); });
    if (spec.guard > 0) { SUP.guardT = Math.max(SUP.guardT, spec.guard); popup(ahead(2.4, 0.35), '守護', 'ward'); }
    if (spec.haste > 0) { SUP.hasteT = Math.max(SUP.hasteT, spec.haste); popup(ahead(2.4, 0.5), '迅速', 'ward'); }
    if (spec.leap > 0) { player.vy = Math.max(player.vy, 9 + (spec.leap - 1) * 2); player.onGround = false; }
    if (spec.blink > 0) {
      // 瞬身: 狙いと反対へ跳び退く
      const back = aim.dir.clone().negate();
      const from = player.pos.clone();
      const to = warpDest(from, { dir: back, dist: 1e9, range: spec.blink + 1, ground: false, target: null, point: from }, spec.blink);
      FX.emitLine(new V3(from.x, from.y + 1, from.z), new V3(to.x, to.y + 1, to.z), { count: 24, c1: colorsOf(spec)[0], c2: '#ffffff', speed: 0.4, life: 0.3, size: 0.2, drag: 3 });
      player.pos.copy(to); player.kv.set(0, 0, 0);
    }
    if (spec.refund > 0) after(0.35, () => { st.mp = Math.min(st.mpMax, st.mp + spec.cost * spec.refund); FX.emit(getTip(), { count: 10, c1: '#7fd8ff', c2: '#ffffff', speed: 1.5, life: 0.4, size: 0.1 }); });
    for (let k = 1; k <= spec.echo; k++) after(0.38 * k, () => { if (st.running) { castN = n; castSpell(spec, getAim(spec.range || 70), rec); } });
    if (MG.UI) MG.UI.onCast(spec0, via, rec, spec);
    return rec;
  }

  G.castSlot = function (i) {
    if (!st.running || st.paused) return false;
    if (M.on && !M.alive) return false;
    if (st.wand === 'bare') { if (MG.UI) MG.UI.toast('素手のときは、詠唱（V キーで名前を唱える）か紋章（右クリックで描いて左クリック）で魔法を放ちます'); AU.error(); return false; }
    if (i >= st.slots.length) return false;
    const spec = st.slots[i];
    if (!spec) { if (MG.UI) MG.UI.toast('このスロットは空です。E キーの魔法工房で作りましょう'); AU.error(); return false; }
    if (st.cds[i] > 0 || st.gcd > 0) return false;
    if (D.on && !D.alive) return false;
    if (inTown()) return false;
    if (spec.seq.length > DER.chain) { if (!st.sealWarnT || st.time > st.sealWarnT) { sealedMsg(spec.seq.length); st.sealWarnT = st.time + 1; } return false; }
    const ch = G.charge(i);
    if (ch.n <= 0) { if (MG.UI) MG.UI.toast(`このスロットは使い切りました（あと ${Math.ceil(MG.RECHARGE_SEC - ch.t)} 秒で1回分戻ります）。詠唱なら放てます`); AU.error(); return false; }
    const m = G.castMods('slot');
    const cost = Math.max(1, Math.round(spec.cost * m.cost));
    if (st.mp < cost) { if (MG.UI) MG.UI.toast('MP が足りません'); AU.error(); if (MG.UI) MG.UI.flashMp(); return false; }
    st.cds[i] = spec.cd * m.cd;
    ch.n--;
    release(spec, i, m);
    return true;
  };

  // 声で唱えた並びを放つ。戻り値: 'ok' | 'paused' | 'cooldown' | 'mp' | 'invalid'
  st.vcd = {};
  // mode: 'draw' = 紋章を描いて名前を唱えた（省略すると、声だけの詠唱）
  // 村の中では魔法を使えない（第27版）
  function inTown() {
    if (W.stage !== 'town' || M.on) return false;
    if (!st.townWarnT || st.time > st.townWarnT) { if (MG.UI) MG.UI.toast('村の中では魔法を使えません（練習場やダンジョンで使えます）'); AU.error(); st.townWarnT = st.time + 1.2; }
    return true;
  }
  G.inTown = () => W.stage === 'town' && !M.on;
  G.castSeq = function (seq, how) {
    if (!st.running || st.paused) return 'paused';
    if (inTown()) return 'town';
    if (M.on && !M.alive) return 'paused';
    const spec = MG.buildSpell(seq);
    if (!spec) return 'invalid';
    if (seq.length > DER.chain) { sealedMsg(seq.length); return 'sealed'; }
    if (D.on && !D.alive) return 'paused';
    const key = seq.join('|');
    if ((st.vcd[key] || 0) > st.time || st.gcd > 0) return 'cooldown';
    const m = G.castMods(st.wand === 'bare' ? 'bare' : how === 'draw' ? 'draw' : 'chant');
    const cost = Math.max(1, Math.round(spec.cost * m.cost));
    if (st.mp < cost) { AU.error(); if (MG.UI) MG.UI.flashMp(); return 'mp'; }
    st.vcd[key] = st.time + spec.cd * m.cd;
    release(spec, how === 'draw' ? 'draw' : 'voice', m);
    return 'ok';
  };

  // 重ねた紋章の魔法を放つ（紋章があるときの左クリック）。戻り値: castSeq と同じ、または 'few' / 'invalid'
  G.castDrawn = function () {
    if (!MG.Draw) return 'none';
    const seq = MG.Draw.seq();
    const UI = MG.UI;
    if (seq.length < 2) { AU.error(); if (UI) UI.toast('紋章をもう1つ以上重ねてから、左クリックで放ちます'); return 'few'; }
    const spec = MG.buildSpell(seq);
    if (!spec) { AU.error(); MG.Draw.clear('fail'); if (UI) UI.toast('この紋章の組み合わせでは魔法になりません'); return 'invalid'; }
    const res = G.castSeq(seq, 'draw');
    if (res === 'ok') { MG.Draw.finish(); G.chantBuild({ state: 'done' }); }
    else if (res === 'mp') { if (UI) UI.toast('MP が足りません'); }
    else if (res === 'cooldown') { if (UI) UI.toast('まだ放てません（待ち時間）'); }
    if (UI && UI.onDrawCast) UI.onDrawCast(seq, res);
    return res;
  };

  G.selectSlot = function (i) {
    st.slot = Math.max(0, Math.min(i, Math.max(0, st.slots.length - 1)));
    const spec = st.slots[st.slot];
    const col = spec ? colorsOf(spec)[0] : (MG.WAND_MAP[st.wand].gem || '#bfe6ff');
    wandGem.material.color.set(col); wandGlow.material.color.set(col);
    AU.slot();
    if (MG.UI) MG.UI.onSelect(i);
  };

  function slotsOf(id) {
    const w = MG.WAND_MAP[id];
    if (!st.slotsByWand[id]) st.slotsByWand[id] = new Array(w.slots).fill(null);
    return st.slotsByWand[id];
  }
  G.setSlot = function (i, seq, wandId) {
    const id = wandId || st.wand;
    const arr = slotsOf(id);
    if (i >= arr.length) return false;
    arr[i] = seq ? MG.buildSpell(seq) : null;
    const ch = G.charge(i, id); ch.n = ch.max; ch.t = 0; // 入れ直すと回数は満タン
    if (id === st.wand && i === st.slot) G.selectSlot(i);
    return true;
  };
  // 杖を持ちかえる（'bare' で素手）
  G.setWand = function (id) {
    const w = MG.WAND_MAP[id]; if (!w) return false;
    if (!G.ownsWand(id)) return false;
    st.wand = id;
    st.slots = slotsOf(id);
    applyWandLook(w);
    G.selectSlot(0);
    if (MG.UI && MG.UI.onWand) MG.UI.onWand(id);
    return true;
  };
  function setWandModel(id) {
    const col = wandGem ? wandGem.material.color.clone() : new THREE.Color(0x7fd8ff);
    if (wandModel) { wandInner.remove(wandModel); disposeTree(wandModel); }
    wandModel = makeWandModel(id, col);
    wandInner.add(wandModel);
    wandGem = wandModel.userData.gem; wandGlow = wandModel.userData.glow; wandTip = wandModel.userData.tip;
  }
  function applyWandLook(w) {
    const bare = w.id === 'bare';
    wand.visible = !bare; handGlow.visible = bare;
    if (bare) return;
    if (!wandModel || wandModel.userData.id !== w.id) setWandModel(w.id);
  }
  // 詠唱中の魔法陣（UI から呼ぶ）: { words: [単語id], need: 名前待ち, progress: 制限時間の進み 0〜1, state: 'build' | 'done' | 'fail' | 'idle' }
  let circleKey = '';
  function tellCircle(words, state) {
    const key = state + ':' + words.join('|');
    if (key === circleKey) return;
    circleKey = key;
    if (M.on && G.onCircle) G.onCircle(words, state);
  }
  G.chantBuild = function (o) {
    const b = st.build;
    if (o.state === 'done' || o.state === 'fail') { b.state = o.state; b.t = 0; tellCircle([], o.state); return; }
    if (o.state === 'idle') { if (b.state === 'build') { b.state = 'idle'; } tellCircle([], 'idle'); return; }
    b.state = 'build'; b.words = (o.words || []).slice(0, 4); b.need = !!o.need; b.progress = o.progress || 0;
    tellCircle(b.words, 'build');
  };
  // ---- 相手の魔法陣（相手の目の前に、重ねた紋章が見える） ----
  function circleTexture(seq) {
    const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S;
    const g = cv.getContext('2d');
    g.lineCap = 'round'; g.lineJoin = 'round';
    const R = S * 0.3;
    // 明るい地面の上でも読めるように、うすい暗い円を敷く
    const bg = g.createRadialGradient(S / 2, S / 2, R * 0.2, S / 2, S / 2, S * 0.49);
    bg.addColorStop(0, 'rgba(8,6,28,0.55)'); bg.addColorStop(0.85, 'rgba(8,6,28,0.4)'); bg.addColorStop(1, 'rgba(8,6,28,0)');
    g.fillStyle = bg; g.beginPath(); g.arc(S / 2, S / 2, S * 0.49, 0, Math.PI * 2); g.fill();
    const col = (i) => { const w = MG.WORD_MAP[seq[i]], w0 = MG.WORD_MAP[seq[0]]; return i === 0 ? MG.ELEMENTS[w.elem].c1 : i === 1 ? MG.ELEMENTS[w0.elem].c2 : '#ffd36b'; };
    seq.forEach((id, i) => { g.strokeStyle = col(i); g.shadowColor = col(i); g.shadowBlur = 10; g.lineWidth = 4; g.beginPath(); g.arc(S / 2, S / 2, R * (1.25 + i * 0.1), 0, Math.PI * 2); g.stroke(); });
    seq.forEach((id, i) => {
      const gl = MG.Draw && MG.Draw.GLYPHS[id]; if (!gl) return;
      const size = R * 1.5 * (1 - i * 0.04), rot = i * 0.12, c = Math.cos(rot), s = Math.sin(rot);
      const path = () => { g.beginPath(); gl.pts.forEach(([x, y], k) => { const px = (x - 0.5) * size, py = (y - 0.5) * size; const qx = px * c - py * s, qy = px * s + py * c; if (k) g.lineTo(S / 2 + qx, S / 2 + qy); else g.moveTo(S / 2 + qx, S / 2 + qy); }); };
      g.strokeStyle = col(i); g.shadowColor = col(i); g.shadowBlur = 14; g.lineWidth = 10; path(); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.85)'; g.shadowBlur = 0; g.lineWidth = 3; path(); g.stroke();
    });
    const tex = new THREE.CanvasTexture(cv); tex.encoding = THREE.sRGBEncoding;
    return tex;
  }
  G.avatarCircle = function (pid, seq, state) {
    const t = avatars.get(pid); if (!t || !t.circle) return false;
    const C = t.circle;
    seq = (Array.isArray(seq) ? seq : []).map(String).filter((id) => MG.WORD_MAP[id]).slice(0, 4);
    if (seq.length) {
      const key = seq.join('|');
      if (key !== C.key) {
        if (C.tex) C.tex.dispose();
        C.tex = circleTexture(seq); C.glyph.material.map = C.tex; C.glyph.material.needsUpdate = true; C.key = key;
        const w0 = MG.WORD_MAP[seq[0]]; C.ring.material.color.set(MG.ELEMENTS[w0.elem].c1);
      }
      C.state = 'build'; C.seq = seq;
    } else { C.state = state === 'done' ? 'done' : 'fade'; C.t = 0; }
    return true;
  };
  function updateAvatarCircle(t, dt) {
    const C = t.circle;
    if (C.state === 'build') C.on = Math.min(1, C.on + dt * 5);
    else C.on = Math.max(0, C.on - dt * (C.state === 'done' ? 2.2 : 3));
    C.g.visible = C.on > 0.01 && t.alive && !!C.key;
    if (!C.g.visible) return;
    const big = C.state === 'done' ? 1 + (1 - C.on) * 1.2 : 0.7 + C.on * 0.3;
    C.g.scale.setScalar(big);
    C.ring.rotation.z += dt * 0.8;
    C.ring.material.opacity = C.on * 0.55;
    C.glyph.material.opacity = C.on * 0.95;
  }
  function updateBuild(dt) {
    const b = st.build;
    b.t += dt;
    const show = b.state !== 'idle' || buildRings.some((r) => r.on > 0.01);
    buildGroup.visible = show;
    if (!show) return;
    const words = b.words.map((id) => MG.WORD_MAP[id]).filter(Boolean);
    const core = buildGroup.userData.core;
    if (b.state === 'done') {
      const k = Math.min(1, b.t / 0.45);
      buildGroup.scale.setScalar(1 + k * 1.6);
      buildRings.forEach((r) => { r.ring.material.opacity = r.on * (1 - k); r.rune.material.opacity = r.on * 0.5 * (1 - k); });
      core.material.opacity = 1 - k;
      if (k >= 1) { b.state = 'idle'; b.words = []; buildRings.forEach((r) => (r.on = 0)); buildGroup.scale.setScalar(1); core.material.opacity = 0; }
      return;
    }
    if (b.state === 'fail') {
      const k = Math.min(1, b.t / 0.35);
      if (b.t < dt * 1.5) buildRings.forEach((r) => { if (r.on > 0.1) { const p = new V3(); r.g.getWorldPosition(p); FX.emit(p, { count: 18, c1: '#ff6b6b', c2: '#ffffff', speed: 2, life: 0.4, size: 0.05, drag: 2, jitter: 0.25 }); } });
      buildRings.forEach((r) => { r.ring.material.color.set('#ff6b6b'); r.ring.material.opacity = r.on * (1 - k); r.rune.material.opacity = 0; });
      core.material.opacity = 0;
      buildGroup.rotation.z += dt * 8;
      if (k >= 1) { b.state = 'idle'; b.words = []; buildRings.forEach((r) => (r.on = 0)); buildGroup.rotation.z = 0; }
      return;
    }
    buildGroup.scale.setScalar(1);
    buildRings.forEach((r, i) => {
      const target = i < words.length && b.state === 'build' ? 1 : 0;
      r.on += (target - r.on) * Math.min(1, dt * 8);
      const w = words[i];
      const col = !w ? '#ffffff' : i === 0 ? MG.ELEMENTS[w.elem].c1 : i === 1 ? MG.ELEMENTS[words[0].elem].c2 : '#ffd36b';
      r.ring.material.color.set(col); r.rune.material.color.set(col);
      r.ring.material.opacity = r.on * 0.9; r.rune.material.opacity = r.on * 0.45;
      r.g.rotation.z += dt * (i % 2 ? -1 : 1) * (0.6 + i * 0.35);
      r.g.scale.setScalar(0.6 + r.on * 0.4);
    });
    core.material.color.set(b.need ? '#ffd36b' : words[0] ? MG.ELEMENTS[words[0].elem].c2 : '#ffffff');
    core.material.opacity = words.length ? (b.need ? 0.6 + Math.sin(st.time * 10) * 0.3 : 0.5) : 0.15;
    core.rotation.z -= dt * 1.5;
  }

  // ======================================================================
  //  入力
  // ======================================================================
  function setupInput(canvas) {
    window.addEventListener('keydown', (e) => {
      input.keys[e.code] = true;
      if (!st.running) return;
      if (MG.UI && MG.UI.handleKey(e)) return;
      if (st.paused) return;
      if (e.code.startsWith('Digit')) { const n = +e.code.slice(5) - 1; if (n >= 0 && n < st.slots.length) G.selectSlot(n); }
      if (e.code === 'Space') {
        e.preventDefault();
        if (player.onGround && SUP.flyT <= 0) {
          if (st.stamina < STAMINA.jump) { if (MG.UI) MG.UI.toast('スタミナが足りなくて跳べない'); }
          else { player.vy = JUMP_V; player.onGround = false; st.stamina -= STAMINA.jump; st.stamT = STAMINA.delay; }
        } else if (player.onGround) { player.vy = JUMP_V; player.onGround = false; }
      }
      if (e.code === 'KeyF' || e.code === 'KeyQ') G.castSlot(st.slot);
    });
    window.addEventListener('keyup', (e) => { input.keys[e.code] = false; });
    window.addEventListener('blur', () => { input.keys = {}; input.mouseDown = false; if (MG.Draw) MG.Draw.cancelStroke(); });

    canvas.addEventListener('mousedown', (e) => {
      if (!st.running || st.paused || input.touch) return;
      if (e.button === 2) { if (input.locked && MG.Draw) MG.Draw.begin(); return; } // 右クリックを押しながら紋章を描く
      if (e.button !== 0) return;
      if (input.locked && MG.Draw && MG.Draw.count() > 0 && !MG.Draw.drawing()) { G.castDrawn(); return; } // 紋章を重ねているときは、紋章の魔法を放つ
      if (!input.locked) { G.lockPointer(); return; }
      input.mouseDown = true;
      G.castSlot(st.slot);
    });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) input.mouseDown = false; if (e.button === 2 && MG.Draw && MG.Draw.drawing()) MG.Draw.end(); });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('contextmenu', (e) => { if (st.running && !st.paused) e.preventDefault(); });
    document.addEventListener('mousemove', (e) => {
      if (!input.locked || st.paused) return;
      if (MG.Draw && MG.Draw.drawing()) { MG.Draw.move(e.movementX || 0, e.movementY || 0); return; } // 描いている間は視点を動かさない
      look(e.movementX || 0, e.movementY || 0, 0.0022 * (MG.UI ? MG.UI.sens() : 1));
    });
    canvas.addEventListener('wheel', (e) => {
      if (!st.running || st.paused) return;
      const n = Math.max(1, st.slots.length);
      G.selectSlot((st.slot + (e.deltaY > 0 ? 1 : n - 1)) % n);
    }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      const was = input.locked;
      input.locked = document.pointerLockElement === canvas;
      if (was && !input.locked && st.running && !st.paused && MG.UI) MG.UI.onUnlock();
    });

    // タッチ操作
    let lookId = null, lookLast = null, moveId = null, moveStart = null;
    canvas.addEventListener('touchstart', (e) => {
      input.touch = true;
      for (const tc of e.changedTouches) {
        if (tc.clientX < window.innerWidth * 0.45 && moveId === null) { moveId = tc.identifier; moveStart = { x: tc.clientX, y: tc.clientY }; MG.UI && MG.UI.showStick(moveStart, { x: 0, y: 0 }); }
        else if (lookId === null) { lookId = tc.identifier; lookLast = { x: tc.clientX, y: tc.clientY }; }
      }
      e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('touchmove', (e) => {
      for (const tc of e.changedTouches) {
        if (tc.identifier === lookId) { look(tc.clientX - lookLast.x, tc.clientY - lookLast.y, 0.005); lookLast = { x: tc.clientX, y: tc.clientY }; }
        if (tc.identifier === moveId) {
          let dx = (tc.clientX - moveStart.x) / 50, dy = (tc.clientY - moveStart.y) / 50;
          const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
          input.move.x = dx; input.move.y = dy;
          MG.UI && MG.UI.showStick(moveStart, { x: dx, y: dy });
        }
      }
      e.preventDefault();
    }, { passive: false });
    const end = (e) => {
      for (const tc of e.changedTouches) {
        if (tc.identifier === lookId) lookId = null;
        if (tc.identifier === moveId) { moveId = null; input.move.x = input.move.y = 0; MG.UI && MG.UI.showStick(null); }
      }
    };
    canvas.addEventListener('touchend', end); canvas.addEventListener('touchcancel', end);
  }

  function look(dx, dy, s) {
    player.yaw -= dx * s;
    player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - dy * s));
  }

  G.lockPointer = function () {
    const c = renderer && renderer.domElement;
    if (!c || !c.requestPointerLock || input.touch) return;
    try { const p = c.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* 使えない環境では何もしない */ }
  };
  G.unlockPointer = function () { if (document.pointerLockElement) document.exitPointerLock(); };
  G.isLocked = () => input.locked;
  G.isTouch = () => input.touch;
  G.setTouch = (v) => { input.touch = !!v; };
  G.setMouseDown = (v) => { input.mouseDown = !!v; };

  // ======================================================================
  //  毎フレームの更新
  // ======================================================================
  const groundKind = () => (W.stage === 'dungeon' ? 'cave' : W.stage === 'arena' ? 'sand' : W.stage === 'town' ? 'dirt' : 'stone');
  // 歩く動き（walk）が半周進むたびに足音を鳴らす（敵・召喚獣・友達）
  function stepSound(t, kind, k, speed) {
    const ph = Math.floor(t.walk / Math.PI);
    if (ph === t.stepPh) return;
    t.stepPh = ph;
    if (!(speed > 0.2)) return;
    const a = ap(t.center);
    if (a && a.vol > 0.22) AU.step(kind, a, k);
  }
  function updatePlayer(dt) {
    const k = input.keys;
    const dead = (M.on && !M.alive) || (D.on && !D.alive);
    let fx = 0, fz = 0;
    if (!dead) {
      if (k.KeyW || k.ArrowUp) fz -= 1;
      if (k.KeyS || k.ArrowDown) fz += 1;
      if (k.KeyA || k.ArrowLeft) fx -= 1;
      if (k.KeyD || k.ArrowRight) fx += 1;
      fx += input.move.x; fz += input.move.y;
    }
    const l = Math.hypot(fx, fz);
    const moving = l > 0.05;
    if (l > 1) { fx /= l; fz /= l; }
    // 歩く 5.2m/秒、走る 8m/秒（第28版）。走るとスタミナが減り、なくなると走れない
    const wantRun = (k.ShiftLeft || k.ShiftRight) && moving && !dead && SUP.flyT <= 0;
    const running = wantRun && !st.tired && st.stamina > 0;
    if (running) { st.stamina = Math.max(0, st.stamina - STAMINA.run * dt); st.stamT = STAMINA.delay; if (st.stamina <= 0) { st.tired = true; if (MG.UI) MG.UI.toast('息が切れた…（少し休むとまた走れる）'); } }
    else { st.stamT = Math.max(0, st.stamT - dt); if (st.stamT <= 0) st.stamina = Math.min(STAMINA.max, st.stamina + STAMINA.regen * dt); if (st.tired && st.stamina >= STAMINA.max * 0.35) st.tired = false; }
    let speed = running ? 8 : 5.2;
    if (M.on && M.slowT > 0) speed *= M.slowHard ? 0.3 : 0.55; // 凍結・氷で動きが遅くなる
    if (dilations.length && timeK(player.pos, 'me') < 1) speed *= 0.3;    // 相手の時間遅延の球の中
    if (!dead) speed *= moveBoost();                             // 纏い・迅速・飛翔で速くなる
    speed *= DER.speed;                                          // レベルで上がった足の速さ
    const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
    player.pos.x += (fx * cos + fz * sin) * speed * dt;
    player.pos.z += (-fx * sin + fz * cos) * speed * dt;
    // 吹き飛ばされた勢い
    if (player.kv.lengthSq() > 1e-4) { player.pos.addScaledVector(player.kv, dt); player.kv.multiplyScalar(Math.exp(-4 * dt)); }
    const r = Math.hypot(player.pos.x, player.pos.z);
    const bound = W.bound();
    if (r > bound) { player.pos.x *= bound / r; player.pos.z *= bound / r; }
    W.pushOut(player.pos, 0.45);
    // 足もとの面: 地面のほか、岩・木箱・壁・石柱・魔法の壁の上にも立てる
    const floor = W.floorAt(player.pos.x, player.pos.z, player.pos.y) + (meissnerOf('me') ? 0.55 : 0); // 完全反磁性: 少し浮く
    player.floor = floor;
    if (SUP.flyT > 0 && !dead) {
      // 飛翔: Space で上昇、C で下降、どちらも押さなければその高さにとどまる
      const want = ((k.Space ? 1 : 0) - (k.KeyC ? 1 : 0)) * 8;
      player.vy += (want - player.vy) * Math.min(1, dt * (want ? 6 : 10));
      player.pos.y += player.vy * dt;
      const flyMax = W.stage === 'dungeon' ? 3.2 : FLY_MAX_H; // ダンジョンでは壁より高く飛べない
      if (player.pos.y > floor + flyMax) { player.pos.y = floor + flyMax; player.vy = Math.min(0, player.vy); }
      if (player.pos.y <= floor) { player.pos.y = floor; player.vy = Math.max(0, player.vy); player.onGround = true; } else player.onGround = false;
    } else {
      // 飛翔が切れたあとは、地面に着くまでゆっくり降りる
      if (SUP.glide) { player.vy -= 7 * dt; player.vy = Math.max(player.vy, -6); } else player.vy -= 20 * dt;
      player.pos.y += player.vy * dt;
      if (player.pos.y <= floor) { player.pos.y = floor; player.vy = 0; player.onGround = true; SUP.glide = false; }
      else if (player.onGround && player.pos.y - floor < 0.4 && player.vy <= 0) { player.pos.y = floor; player.vy = 0; }
      else player.onGround = false;
    }
    if (moving && player.onGround) player.walk += dt * speed * 1.4;
    // 足音（第27版）: 歩く動きの半周ごとに 1 歩。地面の種類で音が変わる
    const sph = Math.floor(player.walk / Math.PI);
    if (sph !== player.stepPh) { player.stepPh = sph; if (moving && player.onGround && !dead) AU.step(groundKind(), null, speed > 9 ? 1.25 : 1); }

    camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
    const bob = moving && player.onGround ? Math.sin(player.walk) * 0.045 : 0;
    camera.position.set(player.pos.x, player.pos.y + EYE + bob, player.pos.z);
    if (dead) {
      // 倒れたとき: 視点が低くなって傾く
      const kd = Math.min(1, (M.respawnSec - M.deadT) / 0.6);
      camera.position.y -= kd * 1.25; camera.rotation.z += kd * 0.6;
    }
    if (M.on) { wand.visible = !dead && st.wand !== 'bare'; handGlow.visible = !dead && st.wand === 'bare'; }
    if (st.shake > 0.001) {
      const k = H.scale;
      camera.position.x += rand(-1, 1) * st.shake * 0.25 * k;
      camera.position.y += rand(-1, 1) * st.shake * 0.25 * k;
      camera.rotation.z += rand(-1, 1) * st.shake * 0.02 * k;
      st.shake *= Math.pow(0.02, dt);
    }
    const ho = H.offsets(dt);
    camera.translateX(ho.x); camera.translateY(ho.y); camera.rotation.z += ho.roll;
    // 揺れで視点（＝ねらい）もぶれる
    camera.rotation.x += ho.pitch; camera.rotation.y += ho.yaw;
    // 杖のゆれと反動
    st.recoil = Math.max(0, st.recoil - dt * 6);
    st.castGlow = Math.max(0, st.castGlow - dt * 3);
    const sway = moving ? Math.sin(player.walk * 0.5) * 0.02 : Math.sin(st.time * 1.5) * 0.005;
    wand.position.set(0.3 + sway, -0.29 + Math.abs(sway) * 0.6 - st.recoil * 0.03, -0.62 + st.recoil * 0.1);
    wand.rotation.x = st.recoil * 0.25;
    wandGlow.scale.setScalar((0.22 + st.castGlow * 0.4 + Math.sin(st.time * 4) * 0.02) * wandModel.userData.glowK);
    wandGem.rotation.y += dt * 2;
    castCircle.material.opacity = st.castGlow * 0.9;
    castCircle.scale.setScalar(0.6 + (1 - st.castGlow) * 0.8);
    castCircle.rotation.z += dt * 4;
    updateBuild(dt);
    updateSupport(dt);
    if (handGlow.visible) handGlow.scale.setScalar(0.14 + st.castGlow * 0.25 + Math.sin(st.time * 3) * 0.02);
  }

  function updateAimMarker() {
    const spec = st.slots[st.slot];
    const areaForms = { rain: 1, mist: 1, vortex: 1, lob: 1, meteor: 1 };
    const SECRET_AREA = { cumulo: 10, horizon: 10, yggdrasil: 12, dilation: 10, philosopher: 9 };
    if (!spec || !(spec.secret ? SECRET_AREA[spec.secret] : areaForms[spec.form]) || st.paused) { aimMarker.visible = false; return; }
    const aim = getAim(70);
    const p = spec.form === 'lob' && aim.target ? aim.target.pos.clone() : groundPointOf(aim, spec.form === 'lob' ? 50 : 45);
    aimMarker.visible = true;
    aimMarker.position.set(p.x, W.heightAt(p.x, p.z) + 0.07, p.z);
    const r = spec.secret ? SECRET_AREA[spec.secret] : spec.form === 'rain' || spec.form === 'meteor' ? spec.area : spec.radius;
    aimMarker.scale.setScalar(r);
    aimMarker.material.color.set(colorsOf(spec)[0]);
    aimMarker.rotation.z += 0.01;
  }

  function step(dt) {
    st.time += dt;
    for (let i = timers.length - 1; i >= 0; i--) if (timers[i].t <= st.time) { const fn = timers[i].fn; timers.splice(i, 1); fn(); }
    st.mp = Math.min(st.mpMax, st.mp + st.mpRegen * dt);
    const inDil = dilations.length > 0 && M.on && timeK(player.pos, 'me') < 1; // 相手の時間遅延の中では、魔法の待ち時間も遅れる
    if (inDil && !st.inDil) popup(ahead(2.4, 0.4), '時間が遅れている', 'pvp');
    st.inDil = inDil;
    for (let i = 0; i < st.cds.length; i++) st.cds[i] = Math.max(0, st.cds[i] - dt * (inDil ? 0.3 : 1));
    if (D.on && !D.alive) input.mouseDown = false;
    for (const k in st.charges) { const c = st.charges[k]; if (c.n < (c.max || MG.SLOT_CHARGES)) { c.t += dt; if (c.t >= MG.RECHARGE_SEC) { c.n++; c.t = 0; } } else c.t = 0; }
    st.gcd = Math.max(0, st.gcd - dt);
    if (st.comboT > 0) { st.comboT -= dt; if (st.comboT <= 0) st.combo = 0; }
    if (input.mouseDown && input.locked) G.castSlot(st.slot);
    if (M.on) updateMatch(dt);
    updatePlayer(dt);
    updateTargets(dt);
    updateDungeon(dt);
    updateSpot();
    updateProjs(dt);
    updateFields(dt);
    updateBarriers(dt);
    for (let i = beams.length - 1; i >= 0; i--) {
      const b = beams[i]; b.t += dt;
      const k = 1 - b.t / b.life;
      b.meshes.forEach((m, j) => { m.material.opacity = Math.max(0, k) * (j ? 0.95 : 0.75); const w = b.width * (j ? 0.35 : 1) * (0.6 + k * 0.6); m.scale.x = m.scale.z = w; });
      if (b.t >= b.life) { b.meshes.forEach((m) => { scene.remove(m); m.material.dispose(); }); beams.splice(i, 1); }
    }
    for (let i = bolts.length - 1; i >= 0; i--) {
      const b = bolts[i]; b.t += dt; b.jt -= dt;
      if (b.jt <= 0) { b.jt = 0.04; jitterBolt(b); }
      b.lines.forEach((l) => { l.material.opacity = Math.max(0, 1 - b.t / b.life); });
      if (b.t >= b.life) { scene.remove(b.group); b.lines.forEach((l) => { l.geometry.dispose(); l.material.dispose(); }); bolts.splice(i, 1); }
    }
    for (let i = spikes.length - 1; i >= 0; i--) {
      const s = spikes[i]; s.t += dt;
      const rise = Math.min(1, s.t / 0.12), sink = s.t > s.life - 0.3 ? (s.t - (s.life - 0.3)) / 0.3 : 0;
      s.group.position.y = s.y0 - s.h * (1 - rise) - s.h * sink;
      if (s.t >= s.life) { scene.remove(s.group); spikes.splice(i, 1); }
    }
    W.update(dt, player.pos);
    // チャレンジ
    if (st.challenge) {
      st.challenge.left -= dt;
      if (st.challenge.left <= 0) { st.challenge.left = 0; const sc = st.score; st.challenge = null; if (MG.UI) MG.UI.onChallengeEnd(sc); }
    }
    FX.update(dt);
    updateAimMarker();
  }

  function frame(ts) {
    requestAnimationFrame(frame);
    const now = ts / 1000;
    let dt = clockLast ? now - clockLast : 0.016;
    clockLast = now;
    dt = Math.min(dt, 0.05);
    // 対戦中は、メニューを開いていても世界は進み続ける（入力だけ止まる）
    if (st.running && (!st.paused || M.on)) step(dt);
    else {
      // 止まっている間も景色だけは少し動かす
      W.update(dt, null);
      camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
      camera.position.set(player.pos.x, player.pos.y + EYE, player.pos.z);
      FX.update(dt * 0.25);
    }
    W.follow(camera.position);
    renderer.render(scene, camera);
    if (EF.ready) EF.draw(st.running && (!st.paused || M.on) ? dt : 0, camera, renderer);
    if (MG.UI) MG.UI.updateHud();
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.fov = w < h ? 82 : 72;
    camera.updateProjectionMatrix();
    FX.resize(h * renderer.getPixelRatio(), camera.fov);
  }

  // ======================================================================
  //  初期化・公開する操作
  // ======================================================================
  G.init = function (container) {
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    } catch (e) {
      return false;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.domElement.id = 'game-canvas';
    renderer.domElement.setAttribute('aria-label', '3D の練習場');
    container.appendChild(renderer.domElement);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(72, 1, 0.05, 700);
    scene.add(camera);
    FX.init(scene);
    buildWorld();
    buildWand();
    setupInput(renderer.domElement);
    window.addEventListener('resize', resize);
    resize();
    for (let i = 0; i < TARGET_N; i++) spawnTarget(null, null, i);
    targets.forEach((t) => (t.spawnT = 1));
    requestAnimationFrame(frame);
    // 本物の物理（Jolt）とエフェクト（Effekseer）は、裏で読み込んで、準備できたら使い始める
    G.engines = { phys: 'loading', efk: 'loading' };
    EF.init(renderer).then((ok) => { G.engines.efk = ok ? 'on' : 'off'; if (MG.UI && MG.UI.onEngines) MG.UI.onEngines(); });
    PH.init().then((ok) => { if (ok) W.enablePhysics(); G.engines.phys = ok ? 'on' : 'off'; if (MG.UI && MG.UI.onEngines) MG.UI.onEngines(); });
    return true;
  };

  G.start = function () {
    st.running = true; st.paused = false; clockLast = 0;
    if (!st.started && !M.on) { st.started = true; G.goStage('town', W.TOWN_SPAWN); }
  };
  G.setPaused = function (v) { st.paused = !!v; if (v) { input.mouseDown = false; input.keys = {}; input.move.x = input.move.y = 0; if (MG.Draw) MG.Draw.cancelStroke(); } };

  // ======================================================================
  //  成長（第26版）: レベル・経験値・能力・お金・回復薬・持っている杖
  //  能力は対戦にも反映する（最大HP・最大MP・MPの回復・威力・足の速さ・待ち時間）
  // ======================================================================
  const RP = MG.RPG;
  const P = (G.prog = { prog: RP.newProgress(), gold: RP.START_GOLD, potions: 0, wands: ['novice'], bestFloor: 0 });
  let DER = RP.derive(P.prog);
  G.derived = () => DER;
  G.chainMax = () => DER.chain;
  function applyProgress() {
    DER = RP.derive(P.prog);
    const r = st.mpMax > 0 ? st.mp / st.mpMax : 1;
    st.mpMax = DER.mpMax; st.mpRegen = DER.mpRegen;
    st.mp = Math.min(st.mpMax, Math.max(0, r * st.mpMax));
    D.maxHp = DER.maxHp; if (D.hp > D.maxHp) D.hp = D.maxHp;
    if (MG.UI && MG.UI.onProgress) MG.UI.onProgress();
  }
  // 保存データから読み込む（ui.js が起動時に呼ぶ）
  G.setProgress = function (o) {
    o = o || {};
    P.prog = RP.validProgress(o.prog);
    P.gold = Math.max(0, Math.round(+o.gold) || 0);
    P.potions = Math.max(0, Math.min(RP.POTION.max, Math.round(+o.potions) || 0));
    P.wands = Array.isArray(o.wands) ? ['novice'].concat(o.wands.filter((id) => MG.WAND_MAP[id] && id !== 'novice' && id !== 'bare')) : ['novice'];
    P.wands = [...new Set(P.wands)];
    P.bestFloor = Math.max(0, Math.round(+o.bestFloor) || 0);
    applyProgress();
    st.mp = st.mpMax; D.hp = D.maxHp;
  };
  G.getProgress = () => ({ prog: RP.cloneProgress(P.prog), gold: P.gold, potions: P.potions, wands: P.wands.slice(), bestFloor: P.bestFloor });
  G.playerPos = () => player.pos;
  G.playerYaw = () => player.yaw;
  G.enemyDots = () => targets.filter((t) => t.isEnemy && t.alive).map((t) => ({ x: t.pos.x, z: t.pos.z, boss: !!t.E.boss }));
  G.ownsWand = (id) => id === 'bare' || P.wands.includes(id);
  // 杖を買う。戻り値: 'ok' | 'owned' | 'gold' | 'invalid'
  G.buyWand = function (id) {
    if (!MG.WAND_MAP[id] || id === 'bare') return 'invalid';
    if (P.wands.includes(id)) return 'owned';
    const price = RP.WAND_PRICE[id] || 0;
    if (P.gold < price) return 'gold';
    P.gold -= price; P.wands.push(id);
    if (MG.UI && MG.UI.onProgress) MG.UI.onProgress();
    return 'ok';
  };
  G.buyPotion = function () {
    if (P.potions >= RP.POTION.max) return 'full';
    if (P.gold < RP.POTION.price) return 'gold';
    P.gold -= RP.POTION.price; P.potions++;
    if (MG.UI && MG.UI.onProgress) MG.UI.onProgress();
    return 'ok';
  };
  // 経験値をもらう（レベルが上がると、MP と、ランダムに 1 つの能力が上がる）
  G.gainXp = function (n) {
    const ups = RP.addXp(P.prog, n);
    if (ups.length) {
      applyProgress();
      st.mp = st.mpMax; if (D.on) D.hp = Math.min(D.maxHp, D.hp + Math.round(D.maxHp * 0.3));
      AU.reveal(6);
      FX.emit(new V3(player.pos.x, player.pos.y + 0.5, player.pos.z), { count: 60, c1: '#ffe9a0', c2: '#7fd8ff', speed: 2, up: 5, jitter: 0.8, life: 1.1, size: 0.3, drag: 1 });
      FX.ring(new V3(player.pos.x, player.pos.y + 0.1, player.pos.z), '#ffe9a0', 0.4, 4, 0.6);
      ups.forEach((u) => { if (MG.UI && MG.UI.onLevelUp) MG.UI.onLevelUp(u); });
    } else if (MG.UI && MG.UI.onProgress) MG.UI.onProgress();
    return ups;
  };
  // ことばの数の封印（2 語 → Lv5 で 3 語 → Lv12 で 4 語）
  function sealedMsg(n) {
    if (MG.UI) MG.UI.toast(`${n}語の魔法は、まだ封印されています（Lv${RP.sealLevel(n)} で解ける）`);
    AU.error();
  }
  G.isSealed = (seq) => !!seq && seq.length > DER.chain;

  // ======================================================================
  //  ステージの行き来（第26版）: 村・練習場・ダンジョン・闘技場（対戦）
  // ======================================================================
  function clearStageThings() {
    projs.slice().forEach(() => removeProj(projs.length - 1));
    clearFields(); timers.length = 0;
    targets.slice().forEach((t) => removeTargetObj(t));
    targets.length = 0;
    clearBarriers(); clearDungeonThings();
    G.noRespawn = false;
  }
  G.goStage = function (name, spawn) {
    if (M.on) return false;
    clearStageThings();
    W.setStage(name);
    W.resetTerrain();
    const sp = spawn || (name === 'town' ? W.TOWN_SPAWN : name === 'practice' ? W.PRACTICE_SPAWN : [0, 16, 0]);
    placeAt(sp);
    if (name === 'practice') G.resetTargets();
    st.spot = null; if (MG.UI && MG.UI.onSpot) MG.UI.onSpot(null);
    if (MG.UI && MG.UI.onStage) MG.UI.onStage(name);
    return true;
  };
  // 近くにある「入れる場所」（村の神殿・店・門、練習場の門、ダンジョンの階段・ポータル）
  function spotsHere() {
    if (W.stage === 'dungeon' && D.on && W.dun) {
      const out = [{ id: 'portal', label: '帰還ポータル', x: W.dun.portal.x, z: W.dun.portal.z, r: 2.8, hint: '村へ帰る（拾った物を持ち帰る）' }];
      if (W.dun.stairsOpen) out.push({ id: 'stairs', label: '下の階', x: W.dun.stairs.x, z: W.dun.stairs.z, r: 2.6, hint: `下の階へ進む（地下 ${D.floor + 1} 階）` });
      return out;
    }
    return (W.SPOTS && W.SPOTS[W.stage]) || [];
  }
  function updateSpot() {
    let best = null, bd = 1e9;
    for (const s of spotsHere()) { const d = Math.hypot(player.pos.x - s.x, player.pos.z - s.z); if (d < s.r && d < bd) { bd = d; best = s; } }
    if ((best && best.id) !== (st.spot && st.spot.id)) { st.spot = best; if (MG.UI && MG.UI.onSpot) MG.UI.onSpot(best); }
  }
  // F キー: 近くの場所に入る
  G.interact = function () {
    const s = st.spot; if (!s || !st.running || st.paused || M.on) return false;
    AU.click();
    if (s.id === 'temple' || s.id === 'shop') { if (MG.UI) MG.UI.open(s.id); return true; }
    if (s.id === 'practice') return G.goStage('practice', W.PRACTICE_SPAWN);
    if (s.id === 'town') return G.goStage('town', [0, 27, 0]);
    if (s.id === 'dungeon') return G.enterDungeon();
    if (s.id === 'stairs') return nextFloor(D.floor + 1);
    if (s.id === 'portal') return leaveDungeon('portal');
    return false;
  };

  // ======================================================================
  //  ダンジョン（第26版）: 迷路の階を下へ進む。帰るには帰還ポータルを使う。
  //  ひとりで倒れると、その回に拾った物とその回の経験値を失って、神殿で蘇る
  // ======================================================================
  const D = (G.dun = { on: false, floor: 0, hp: 150, maxHp: 150, alive: true, run: null, invul: 0, explored: null, chests: [], ebolts: [], data: null, deadT: 0 });
  let lastHitPos = null; // 敵の攻撃が来た場所（大盾で前から受けたか調べる）
  function clearDungeonThings() {
    D.chests.forEach((c) => scene.remove(c.g)); D.chests.length = 0;
    D.ebolts.forEach((b) => { scene.remove(b.glow); scene.remove(b.core); }); D.ebolts.length = 0;
  }
  G.enterDungeon = function () {
    if (M.on || D.on) return false;
    D.on = true; D.alive = true;
    D.run = { snapshot: RP.cloneProgress(P.prog), gold: 0, potGain: 0, xp: 0, kills: 0, startLevel: P.prog.level, floors: 0 };
    D.hp = D.maxHp; st.mp = st.mpMax;
    resetSup();
    nextFloor(1);
    return true;
  };
  function nextFloor(f) {
    if (!D.on) return false;
    clearStageThings();
    if (W.stage !== 'dungeon') { W.setStage('dungeon'); if (MG.UI && MG.UI.onStage) MG.UI.onStage('dungeon'); }
    const seed = (Math.random() * 1e9) | 0;
    const data = RP.makeFloor(f, seed);
    D.floor = f; D.data = data; D.run.floors = Math.max(D.run.floors, f);
    W.buildDungeon(data);
    W.resetTerrain();
    D.explored = new Uint8Array(data.N * data.N);
    const s = W.dun.start;
    placeAt([s.x, s.z, Math.random() * Math.PI * 2]);
    D.invul = 1.5;
    // 敵と宝箱
    const sc = RP.scale(f);
    data.spawns.forEach((e) => { const [x, z] = RP.tileToWorld(e.t[0], e.t[1]); spawnEnemy(e.type, new V3(x + rand(-0.5, 0.5), 0, z + rand(-0.5, 0.5)), f, sc); });
    data.chests.forEach((c) => { const [x, z] = RP.tileToWorld(c.t[0], c.t[1]); spawnChest(new V3(x, 0, z), f); });
    if (f > P.bestFloor) P.bestFloor = f;
    st.spot = null; if (MG.UI && MG.UI.onSpot) MG.UI.onSpot(null);
    if (MG.UI && MG.UI.onFloor) MG.UI.onFloor(f, data.boss);
    AU.respawn();
    return true;
  }
  // ダンジョンを出る（how: 'portal' = 持ち帰る / 'death' = 失う / 'quit' = 対戦などで中断）
  function leaveDungeon(how) {
    if (!D.on) return false;
    const run = D.run;
    const sum = { how, floor: D.floor, gold: run.gold, xp: run.xp, kills: run.kills, startLevel: run.startLevel, level: P.prog.level, potions: run.potGain };
    if (how === 'portal') {
      P.gold += run.gold;
    } else {
      // 倒れた: その回の経験値（上がったレベルも）と、拾ったお金・回復薬を失う
      P.prog = RP.cloneProgress(run.snapshot);
      P.potions = Math.max(0, P.potions - run.potGain);
      sum.level = P.prog.level;
    }
    D.on = false; D.alive = true; D.run = null;
    resetSup();
    applyProgress();
    D.hp = D.maxHp; st.mp = st.mpMax;
    G.goStage('town', how === 'portal' ? [-20, -4, -Math.PI / 2] : W.TEMPLE_SPAWN);
    if (MG.UI && MG.UI.onDungeonEnd) MG.UI.onDungeonEnd(sum);
    return true;
  }
  G.leaveDungeon = leaveDungeon;
  // 敵の攻撃を受けた
  function hurtPlayer(d, from, name) {
    if (!D.on || !D.alive || D.invul > 0 || !st.running) return 0;
    lastHitPos = from || null;
    d = Math.round(absorb(d));
    lastHitPos = null;
    if (d <= 0) { popup(ahead(2.4, 0.2), '吸収', 'ward'); AU.hit('force', null); return 0; }
    D.hp -= d;
    hurtFx(d); AU.hurt(d >= 25);
    H.feel('force', Math.min(1.1, 0.25 + d / 50), 0.25, Math.min(1, 0.3 + d / 60));
    if (D.hp <= 0) dungeonDeath(name);
    return d;
  }
  function dungeonDeath(name) {
    D.hp = 0; D.alive = false; D.deadT = 2.6;
    input.mouseDown = false;
    AU.down(); whiteFlash('#5a0010', 0.6);
    if (MG.UI && MG.UI.onDungeonDown) MG.UI.onDungeonDown(name || '');
  }
  G.usePotion = function () {
    if (!D.on || !D.alive) { if (MG.UI) MG.UI.toast('回復薬はダンジョンの中で使えます'); AU.error(); return false; }
    if (P.potions <= 0) { if (MG.UI) MG.UI.toast('回復薬を持っていません（村の杖の店で買えます）'); AU.error(); return false; }
    if (D.hp >= D.maxHp) { if (MG.UI) MG.UI.toast('HP は満タンです'); return false; }
    P.potions--;
    const h = Math.min(RP.POTION.heal, D.maxHp - D.hp); D.hp += h;
    popup(ahead(2.4, -0.3), '+' + h, 'heal'); whiteFlash('#9dffb0', 0.2); AU.heal ? AU.heal() : AU.reveal(3);
    FX.emit(new V3(player.pos.x, player.pos.y + 0.5, player.pos.z), { count: 30, c1: '#9dffb0', c2: '#ffffff', speed: 1, up: 3, jitter: 0.6, life: 0.8, size: 0.25, drag: 1 });
    if (MG.UI && MG.UI.onProgress) MG.UI.onProgress();
    return true;
  };

  // ---- 宝箱 ----
  let chestMats = null;
  function spawnChest(p, f) {
    if (!chestMats) chestMats = { wood: new THREE.MeshStandardMaterial({ color: 0x7a4a24, roughness: 0.8, flatShading: true }), gold: new THREE.MeshStandardMaterial({ color: 0xe8b04a, emissive: 0x8a5a10, emissiveIntensity: 0.6, roughness: 0.35, metalness: 0.4 }) };
    const g = new THREE.Group(); g.position.set(p.x, W.heightAt(p.x, p.z), p.z); g.rotation.y = rand(0, Math.PI * 2);
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.7, 0.8), chestMats.wood); base.position.y = 0.35; g.add(base);
    const lidP = new THREE.Group(); lidP.position.set(0, 0.7, -0.4); g.add(lidP);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.3, 0.84), chestMats.wood); lid.position.set(0, 0.15, 0.4); lidP.add(lid);
    [[-0.45], [0.45]].forEach(([x]) => { const b = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.72, 0.84), chestMats.gold); b.position.set(x, 0.36, 0); g.add(b); });
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.22, 0.06), chestMats.gold); lock.position.set(0, 0.6, 0.42); g.add(lock);
    const glow = FX.glowSprite('#ffd36b', 1.8); glow.position.y = 0.9; g.add(glow);
    scene.add(g);
    D.chests.push({ g, lidP, glow, open: false, t: 0, f, x: p.x, z: p.z });
  }
  function updateChests(dt) {
    for (const c of D.chests) {
      if (c.open) { c.t += dt; c.lidP.rotation.x = -Math.min(1.9, c.t * 6); c.glow.visible = false; continue; }
      c.glow.scale.setScalar(1.8 + Math.sin(st.time * 3 + c.x) * 0.2);
      if (D.alive && Math.hypot(player.pos.x - c.x, player.pos.z - c.z) < 1.9) {
        c.open = true;
        const sc = RP.scale(c.f);
        const gold = Math.round((14 + Math.random() * 26) * sc.gold);
        D.run.gold += gold;
        let msg = `宝箱: ${gold} G`;
        if (Math.random() < 0.32 && P.potions < RP.POTION.max) { P.potions++; D.run.potGain++; msg += ' と 回復薬'; }
        popup(new V3(c.x, 1.8, c.z), msg, 'score');
        FX.emit(new V3(c.x, 1, c.z), { count: 50, c1: '#ffd24a', c2: '#fff3b8', speed: 4, up: 4, gravity: 10, life: 1, size: 0.25 });
        AU.reveal(4);
        if (MG.UI && MG.UI.onProgress) MG.UI.onProgress();
      }
    }
  }

  // ---- 敵 ----
  const ENEMY_COL = { slime: ['#5aff8a', '#c8ffd8'], skeleton: ['#e8e2d0', '#ff5a3a'], bat: ['#6a4a9a', '#ff4a8a'], mage: ['#7a3cff', '#c8a8ff'], boss: ['#ff5a3a', '#ffb07a'] };
  function makeEnemyModel(kind, mats) {
    const g = new THREE.Group(), parts = {};
    const [c1, c2] = ENEMY_COL[kind];
    const std = (o) => { const m = new THREE.MeshStandardMaterial(o); m.userData.baseEmissive = new THREE.Color(o.emissive || 0); m.userData.baseInt = o.emissiveIntensity == null ? 1 : o.emissiveIntensity; mats.push(m); return m; };
    const box = (w, h, d, m, x, y, z, p) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x || 0, y || 0, z || 0); (p || g).add(o); return o; };
    if (kind === 'slime') {
      const jelly = std({ color: c1, emissive: c1, emissiveIntensity: 0.35, roughness: 0.2, transparent: true, opacity: 0.85 });
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.75, 16, 12), jelly); body.scale.set(1, 0.75, 1); body.position.y = 0.55; g.add(body); parts.body = body;
      const eye = std({ color: 0x111111, emissive: 0x000000 });
      [-0.25, 0.25].forEach((x) => { const e = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), eye); e.position.set(x, 0.75, 0.62); g.add(e); });
    } else if (kind === 'skeleton') {
      const bone = std({ color: 0xe8e2d0, roughness: 0.7, flatShading: true });
      const red = std({ color: 0xff3a2a, emissive: 0xff3a2a, emissiveIntensity: 1.4 });
      box(0.5, 0.65, 0.3, bone, 0, 1.25, 0); box(0.18, 0.5, 0.18, bone, 0, 0.75, 0);
      const head = box(0.42, 0.42, 0.42, bone, 0, 1.8, 0);
      [-0.1, 0.1].forEach((x) => box(0.08, 0.08, 0.04, red, x, 1.83, 0.22));
      parts.legs = [-0.15, 0.15].map((x) => { const p = new THREE.Group(); p.position.set(x, 0.55, 0); g.add(p); box(0.12, 0.55, 0.12, bone, 0, -0.27, 0, p); return p; });
      parts.arm = new THREE.Group(); parts.arm.position.set(0.35, 1.45, 0); g.add(parts.arm);
      box(0.1, 0.55, 0.1, bone, 0, -0.27, 0, parts.arm);
      const blade = box(0.08, 0.9, 0.03, std({ color: 0xbfc8d8, roughness: 0.3, metalness: 0.6 }), 0, -0.65, 0.35, parts.arm); blade.rotation.x = Math.PI / 2;
      box(0.1, 0.55, 0.1, bone, -0.35, 1.2, 0);
      void head;
    } else if (kind === 'bat') {
      const fur = std({ color: 0x2a1a3a, emissive: c1, emissiveIntensity: 0.25, roughness: 0.8, flatShading: true });
      const eye = std({ color: c2, emissive: c2, emissiveIntensity: 1.5 });
      box(0.4, 0.4, 0.5, fur, 0, 0, 0);
      [-0.1, 0.1].forEach((x) => box(0.06, 0.06, 0.03, eye, x, 0.05, 0.26));
      const sh = new THREE.Shape(); [[0, 0.1], [0.5, 0.25], [1.0, 0.05], [0.85, -0.15], [0.6, -0.05], [0.4, -0.2], [0, -0.1]].forEach(([x, y], i) => (i ? sh.lineTo(x, y) : sh.moveTo(x, y)));
      const wg = new THREE.ShapeGeometry(sh);
      parts.wings = [-1, 1].map((sd) => { const p = new THREE.Group(); p.position.x = sd * 0.18; g.add(p); const w = new THREE.Mesh(wg, std({ color: 0x3a2a4a, emissive: c1, emissiveIntensity: 0.2, side: THREE.DoubleSide })); w.rotation.x = Math.PI / 2; w.scale.set(sd, 1, 1); p.add(w); return p; });
    } else if (kind === 'mage') {
      const robe = std({ color: 0x241a3a, emissive: c1, emissiveIntensity: 0.15, roughness: 0.85, flatShading: true });
      const glow = std({ color: c2, emissive: c1, emissiveIntensity: 1.6 });
      const body = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.7, 8), robe); body.position.y = 0.85; g.add(body);
      const hood = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.7, 8), robe); hood.position.y = 1.95; g.add(hood);
      [-0.08, 0.08].forEach((x) => box(0.06, 0.04, 0.03, glow, x, 1.78, 0.25));
      const staff = box(0.06, 1.8, 0.06, std({ color: 0x3a2a1a, roughness: 0.8 }), 0.45, 1.0, 0.1);
      const orb = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), glow); orb.position.set(0.45, 1.95, 0.1); g.add(orb); parts.orb = orb;
      parts.glow = FX.glowSprite(c1, 1.6); parts.glow.position.copy(orb.position); g.add(parts.glow);
      void staff;
    } else {
      // ボス: 赤く光る大きな石の守護者（召喚獣のゴーレムの形を大きく、暗く）
      const m2 = makeSummonModel('golem', c1, c2, mats);
      m2.g.scale.setScalar(2.3); g.add(m2.g);
      Object.assign(parts, m2.parts); parts.scaled = m2.g;
    }
    return { g, parts };
  }
  function spawnEnemy(kind, pos, f, sc) {
    const E = RP.ENEMIES[kind]; if (!E) return null;
    const mats = [];
    const { g: model, parts } = MG.Monsters ? MG.Monsters.build(kind, mats) : makeEnemyModel(kind, mats); // 第29版: js/monsters.js の作り込んだ見た目
    const g = new THREE.Group(); g.add(model);
    const bc = document.createElement('canvas'); bc.width = 128; bc.height = 16;
    const btex = new THREE.CanvasTexture(bc);
    const bar = new THREE.Sprite(new THREE.SpriteMaterial({ map: btex, depthTest: false, transparent: true, fog: false }));
    bar.scale.set(E.boss ? 4 : 1.4, E.boss ? 0.3 : 0.16, 1); bar.renderOrder = 20; bar.position.y = E.boss ? 7.2 : E.cy + 1.2; g.add(bar);
    const hp = Math.round(E.hp * sc.hp);
    const t = {
      type: 'enemy', isEnemy: true, kind, E, T: { cy: E.cy, r: E.r }, group: g, face: model, parts, mats, hp, maxHp: hp, r: E.r, pts: 0,
      home: pos.clone(), pos: pos.clone(), center: new V3(), floatY: 0, phase: rand(0, 10), moveDir: new V3(1, 0, 0), disp: new V3(), dispV: new V3(), mass: E.boss ? 0.1 : E.fly ? 0.9 : 0.7,
      burnT: 0, burnDps: 0, burnAcc: 0, burnPop: 0, freezeT: 0, frozenHard: false, vulnT: 0, flash: 0, alive: true, dead: 0, spawnT: 0,
      bar, bc, btex, id: 'e' + Math.random().toString(36).slice(2, 7), dmg: Math.round(E.dmg * sc.dmg), xp: Math.round(E.xp * sc.xp), gold: Math.round(E.gold * sc.gold),
      awake: false, yaw: rand(0, Math.PI * 2), atkT: rand(0.6, 1.4), windup: 0, walk: 0, vy: 0, detourT: 0, stuck: 0, shots: 0,
    };
    pos.y = E.fly ? 2.2 : W.floorAt(pos.x, pos.z, 1);
    t.pos.copy(pos);
    g.position.copy(t.pos); g.scale.setScalar(0.01);
    scene.add(g);
    updateCenter(t); drawBar(t); t.bar.visible = false;
    targets.push(t);
    return t;
  }
  // 敵の攻撃相手: 自分か、自分の召喚獣（近いほう）
  function enemyFoe(t) {
    let best = D.alive ? { player: true, center: new V3(player.pos.x, player.pos.y + 1, player.pos.z) } : null;
    let bd = best ? Math.hypot(best.center.x - t.pos.x, best.center.z - t.pos.z) : 1e9;
    for (const o of targets) {
      if (!o.alive || !o.isSummon || o.puppet || o.kind === 'wisp') continue;
      const d = Math.hypot(o.center.x - t.pos.x, o.center.z - t.pos.z);
      if (d < bd - 1.5) { bd = d; best = o; }
    }
    return best ? { foe: best, d: bd } : null;
  }
  function enemyHit(t, foe, dmg) {
    if (foe.player) return hurtPlayer(dmg, t.center.clone(), t.E.label);
    if (foe.alive) { foe.flash = 0.1; return damage(foe, dmg, null, false); }
    return 0;
  }
  function enemyAttack(t, foe) {
    const E = t.E, [c1, c2] = ENEMY_COL[t.kind];
    t.windup = E.boss ? 0.7 : 0.4;
    const fc = foe.center.clone();
    after(t.windup, () => {
      if (!t.alive || !D.on) return;
      const cur = foe.player ? new V3(player.pos.x, player.pos.y + 1, player.pos.z) : foe.center;
      if (E.ranged || (E.boss && t.shots % 3 === 2)) {
        // 魔弾（よけられる）。ボスは 3 回に 1 回、岩を投げる
        const from = t.center.clone().add(new V3(0, E.boss ? 2.5 : 0.6, 0));
        const dir = cur.clone().sub(from).normalize();
        const glow = FX.glowSprite(E.boss ? '#ffb07a' : c1, E.boss ? 2.6 : 1.4), core = FX.glowSprite('#ffffff', E.boss ? 1 : 0.5);
        glow.position.copy(from); core.position.copy(from); scene.add(glow); scene.add(core);
        D.ebolts.push({ pos: from, vel: dir.multiplyScalar(E.boss ? 16 : 19), dmg: t.dmg * (E.boss ? 0.8 : 1), life: 3, glow, core, r: E.boss ? 1.2 : 0.7, name: E.label, c1 });
        AU.cast(E.boss ? 'earth' : 'void');
      } else if (E.boss) {
        // 大地をたたく: まわり 6m
        const p = t.pos.clone().addScaledVector(fc.clone().sub(t.pos).setY(0).normalize(), 2.5); p.y = W.heightAt(p.x, p.z);
        FX.ring(new V3(p.x, p.y + 0.1, p.z), c1, 0.5, 7.5, 0.5); FX.emit(new V3(p.x, p.y + 0.3, p.z), { count: 70, c1: '#8a6a4a', c2: c1, speed: 9, up: 6, gravity: 16, life: 1, size: 0.45 });
        EF.impact('earth', p, 3); st.shake = Math.max(st.shake, 0.5); AU.impact('earth', 4, ap(p));
        if (Math.hypot(cur.x - p.x, cur.z - p.z) < 6.5 && cur.y - p.y < 3.5) enemyHit(t, foe, t.dmg);
      } else {
        // 近くの相手をたたく・かみつく
        FX.emit(t.center.clone().add(fc.clone().sub(t.center).setY(0).normalize().multiplyScalar(0.8)), { count: 12, c1, c2, speed: 4, life: 0.25, size: 0.3, drag: 4 });
        if (Math.hypot(cur.x - t.pos.x, cur.z - t.pos.z) < E.range + 0.9 && Math.abs(cur.y - t.center.y) < 2.5) { enemyHit(t, foe, t.dmg); AU.hit('force', ap(t.center)); }
      }
      t.shots++;
    });
  }
  function enemyDie(t) {
    if (!t.alive) return;
    t.alive = false; t.dead = 0; t.bar.visible = false;
    const [c1, c2] = ENEMY_COL[t.kind], c = t.center.clone();
    FX.emit(c, { count: t.E.boss ? 160 : 40, c1, c2, speed: t.E.boss ? 9 : 5, up: 2, life: 0.8, size: 0.4, drag: 2 });
    FX.flash(c, c1, 4, 12, 0.3); AU.destroy(ap(c));
    if (D.on && D.run) {
      D.run.kills++; D.run.xp += t.xp; D.run.gold += t.gold;
      popup(c.clone().add(new V3(0, 1, 0)), `+${t.xp} EXP  +${t.gold} G`, 'score');
      G.gainXp(t.xp);
      if (t.E.boss) { W.setStairsOpen(true); popup(ahead(3, 0.4), '守護者を倒した！ 下の階への道が開いた', 'pierce'); AU.secret(); }
    }
  }
  // 戻り値 true: 消え終わったので一覧から外す
  function updateEnemy(t, dt) {
    const E = t.E, P2 = t.parts;
    if (!t.alive) { t.dead += dt; t.group.scale.setScalar(Math.max(0.001, 1 - t.dead / 0.5)); t.group.position.y += dt * (E.fly ? -2 : 0.5); return t.dead > 0.5; }
    t.spawnT = Math.min(1, t.spawnT + dt * 2.5);
    t.group.scale.setScalar(Math.max(0.01, 1 - Math.pow(1 - t.spawnT, 3)));
    if (t.flash > 0) t.flash -= dt;
    if (t.burnT > 0) { t.burnT -= dt; t.burnAcc += t.burnDps * dt; if (Math.random() < 0.4) FX.emit(t.center, { count: 1, c1: '#ff6a1a', c2: '#ffd24a', speed: 0.6, up: 2.5, jitter: t.r * 0.7, life: 0.6, size: 0.4, drag: 0.5 }); if (t.burnAcc >= 4) { const d = Math.floor(t.burnAcc); t.burnAcc -= d; const dd = damage(t, d, null, false); if (t.burnRec) t.burnRec.add(dd); if (!t.alive) return false; } }
    if (t.freezeT > 0) { t.freezeT -= dt; if (t.freezeT <= 0) t.frozenHard = false; }
    if (t.vulnT > 0) t.vulnT -= dt;
    if (t.hp < t.maxHp) t.awake = true;
    const slow = t.freezeT > 0 ? (t.frozenHard ? 0.08 : 0.45) : 1;
    const eye = new V3(player.pos.x, player.pos.y + 1.4, player.pos.z);
    const pd = Math.hypot(player.pos.x - t.pos.x, player.pos.z - t.pos.z);
    if (!t.awake && D.alive && pd < (E.boss ? 22 : 15) && W.solidOnSegment(t.center, eye) == null) { t.awake = true; t.bar.visible = true; popup(t.center.clone().add(new V3(0, 1.2, 0)), '!', 'pvp'); }
    let speed = 0;
    const fr = t.awake ? enemyFoe(t) : null;
    if (fr && D.alive) {
      t.bar.visible = true;
      const foe = fr.foe, goal = foe.center;
      const sight = W.solidOnSegment(t.center, goal) == null;
      let want = 0;
      if (E.ranged) want = !sight || fr.d > 13 ? 1 : fr.d < 7 ? -0.7 : 0;
      else want = fr.d > E.range * 0.85 + (foe.player ? 0.4 : foe.r * 0.7) ? 1 : 0;
      const dir = new V3(goal.x - t.pos.x, 0, goal.z - t.pos.z); const L = dir.length();
      if (L > 0.05) {
        dir.multiplyScalar(1 / L);
        if (t.detourT > 0) dir.applyAxisAngle(UP, t.detourSign * 1.2);
        let dy = Math.atan2(dir.x, dir.z) - t.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        t.yaw += Math.sign(dy) * Math.min(Math.abs(dy), dt * 6);
        if (want && t.windup <= 0) {
          const before = t.pos.clone();
          const v = E.speed * slow * (E.fly ? 1 + Math.sin(st.time * 3 + t.phase) * 0.3 : 1);
          t.pos.addScaledVector(dir, v * dt * Math.sign(want));
          speed = v;
          W.pushOut(t.pos, t.r * 0.8);
          const moved = Math.hypot(t.pos.x - before.x, t.pos.z - before.z);
          if (moved < v * dt * 0.35) { t.stuck += dt; if (t.stuck > 0.3 && !(t.detourT > 0)) { t.detourT = 0.9; t.detourSign = t.detourSign || (Math.random() < 0.5 ? -1 : 1); t.stuck = 0; } } else t.stuck = 0;
        }
      }
      t.detourT = Math.max(0, t.detourT - dt);
      t.atkT -= dt * slow;
      const inRange = E.ranged ? fr.d < E.range && sight : fr.d <= E.range + (foe.player ? 0.5 : foe.r);
      if (inRange && t.atkT <= 0 && t.windup <= 0 && D.invul <= 0) { enemyAttack(t, foe); t.atkT = E.atkCd * (0.85 + Math.random() * 0.3); }
    }
    t.windup = Math.max(0, t.windup - dt);
    // 吹き飛ばし
    if (t.dispV.lengthSq() > 1e-3) { t.pos.x += t.dispV.x * dt; t.pos.z += t.dispV.z * dt; t.dispV.multiplyScalar(Math.exp(-4 * dt)); W.pushOut(t.pos, t.r * 0.8); }
    // 高さ: 飛ぶ敵は宙に、それ以外は床に
    if (E.fly) t.pos.y += (2.2 + Math.sin(st.time * 2.5 + t.phase) * 0.4 - t.pos.y) * Math.min(1, dt * 4);
    else { const fl = W.floorAt(t.pos.x, t.pos.z, t.pos.y + 0.4); t.vy -= 20 * dt; t.pos.y += t.vy * dt; if (t.pos.y <= fl) { t.pos.y = fl; t.vy = 0; } }
    // 見た目の動き
    t.walk += dt * Math.min(8, speed) * 1.4;
    stepSound(t, { slime: 'slime', skeleton: 'bone', mage: 'soft', boss: 'heavy', bat: 'flap' }[t.kind], E.boss ? 1.6 : 1, E.fly ? 1 : speed);
    const sw = speed > 0.2 ? Math.sin(t.walk) : 0, k = t.windup > 0 ? 1 - t.windup / (E.boss ? 0.7 : 0.4) : 0;
    t.face.rotation.y = t.yaw;
    if (MG.Monsters) MG.Monsters.animate(t, { sw, k, speed, walk: t.walk, time: st.time, phase: t.phase, dt });
    t.group.position.copy(t.pos);
    updateCenter(t);
    for (const m of t.mats) {
      if (t.flash > 0) { m.emissive.setRGB(1, 1, 1); m.emissiveIntensity = 0.9; }
      else if (t.windup > 0) { m.emissive.setRGB(1, 0.25, 0.1); m.emissiveIntensity = 0.4 + k * 0.6; }
      else if (t.freezeT > 0) { m.emissive.setRGB(0.3, 0.75, 1); m.emissiveIntensity = 0.55; }
      else if (t.burnT > 0) { m.emissive.setRGB(1, 0.35, 0.05); m.emissiveIntensity = 0.45; }
      else { m.emissive.copy(m.userData.baseEmissive); m.emissiveIntensity = m.userData.baseInt; }
    }
    return false;
  }
  function updateEbolts(dt) {
    for (let i = D.ebolts.length - 1; i >= 0; i--) {
      const b = D.ebolts[i];
      b.life -= dt;
      const prev = b.pos.clone();
      b.pos.addScaledVector(b.vel, dt * timeK(b.pos, 'enemy'));
      b.glow.position.copy(b.pos); b.core.position.copy(b.pos);
      let done = b.life <= 0;
      const pc = new V3(player.pos.x, player.pos.y + 1, player.pos.z);
      if (!done && D.alive && b.pos.distanceTo(pc) < b.r + 0.5) { hurtPlayer(b.dmg, prev, b.name); done = true; }
      if (!done) { const bh = W.barrierOnSegment(prev, b.pos, 0.2, 'enemy'); if (bh) { if (bh.barrier.game) damageBarrier(bh.barrier.game, b.dmg, b.pos.clone(), { element: 'void', colors: [b.c1, '#ffffff'] }); done = true; } }
      if (!done && (W.collide(b.pos, 0.2) || b.pos.y <= W.heightAt(b.pos.x, b.pos.z))) done = true;
      if (done) { FX.emit(b.pos, { count: 14, c1: b.c1, c2: '#ffffff', speed: 4, life: 0.3, size: 0.3, drag: 4 }); scene.remove(b.glow); scene.remove(b.core); D.ebolts.splice(i, 1); }
    }
  }
  function updateDungeon(dt) {
    if (!D.on) return;
    if (D.invul > 0) D.invul -= dt;
    updateChests(dt);
    updateEbolts(dt);
    // 地図: まわり 10m を見たことにする
    if (D.data && D.explored) {
      const [tx, tz] = RP.worldToTile(player.pos.x, player.pos.z), N = D.data.N;
      for (let z = tz - 5; z <= tz + 5; z++) for (let x = tx - 5; x <= tx + 5; x++) if (x >= 0 && z >= 0 && x < N && z < N && (x - tx) * (x - tx) + (z - tz) * (z - tz) <= 26) D.explored[z * N + x] = 1;
    }
    if (!D.alive) { D.deadT -= dt; if (D.deadT <= 0) leaveDungeon('death'); }
  }

  G.resetTargets = function () {
    targets.slice().forEach((t) => { removeTargetObj(t); });
    targets.length = 0;
    timers.length = 0;
    for (let i = 0; i < TARGET_N; i++) spawnTarget(null, null, i);
  };

  // ======================================================================
  //  対戦
  // ======================================================================
  const vec = (a) => (Array.isArray(a) && a.length === 3 && a.every((x) => Number.isFinite(+x)) ? new V3(+a[0], +a[1], +a[2]) : null);
  const arr = (v) => [Math.round(v.x * 100) / 100, Math.round(v.y * 100) / 100, Math.round(v.z * 100) / 100];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, +v || 0));
  function packCast(spec0, m, aim) {
    return {
      seq: spec0.seq.slice(), m: { dmg: m.dmg, cost: m.cost, cd: m.cd, pen: m.pen, speed: m.speed, mode: m.mode },
      tip: arr(getTip()), o: arr(aim.origin), d: arr(aim.dir), p: arr(aim.point),
      tg: aim.target && aim.target.isPlayer ? aim.target.pid : null, dist: Math.round(aim.dist * 100) / 100, ground: !!aim.ground, range: aim.range,
      pos: arr(player.pos), n: castN,
    };
  }
  function hurtFx(d) {
    const el = document.getElementById('hurt');
    if (el) { el.style.transition = 'none'; el.style.opacity = String(Math.min(0.85, 0.25 + d / 90)); requestAnimationFrame(() => { el.style.transition = 'opacity 0.6s ease-out'; el.style.opacity = '0'; }); }
    st.shake = Math.max(st.shake, Math.min(0.6, 0.1 + d / 120));
  }
  function die(from, spell) {
    if (!M.alive) return;
    M.hp = 0; M.alive = false; M.deadT = RESPAWN_SEC; M.burnT = 0; M.slowT = 0; M.vulnT = 0;
    resetSup();
    if (selfT) selfT.alive = false;
    input.mouseDown = false;
    AU.down();
    whiteFlash('#5a0010', 0.55);
    if (G.onLocalDeath) G.onLocalDeath(from, spell || '');
  }
  // いちばん相手から遠い復活地点
  function pickSpawn() {
    let best = SPAWNS[0], bd = -1;
    SPAWNS.forEach((s) => {
      let dmin = 999;
      avatars.forEach((t) => { if (t.alive) dmin = Math.min(dmin, Math.hypot(t.netPos.x - s[0], t.netPos.z - s[1])); });
      if (dmin + Math.random() * 3 > bd) { bd = dmin; best = s; }
    });
    return best;
  }
  function placeAt(s) {
    player.pos.set(s[0], W.heightAt(s[0], s[1]), s[1]); player.vy = 0; player.kv.set(0, 0, 0);
    player.yaw = s[2]; player.pitch = -0.05;
  }
  function respawn() {
    placeAt(pickSpawn());
    M.hp = M.maxHp; M.alive = true; M.prot = PROTECT_SEC; M.burnT = 0; M.slowT = 0; M.vulnT = 0;
    st.mp = st.mpMax;
    if (selfT) selfT.alive = true;
    AU.respawn();
    FX.emit(new V3(player.pos.x, 0.5, player.pos.z), { count: 40, c1: '#7fd8ff', c2: '#ffffff', speed: 3, up: 4, life: 0.8, size: 0.35, drag: 2 });
    if (G.onRespawn) G.onRespawn();
  }
  function updateMatch(dt) {
    if (M.prot > 0) M.prot -= dt;
    if (M.slowT > 0) { M.slowT -= dt; if (M.slowT <= 0) M.slowHard = false; }
    if (M.vulnT > 0) M.vulnT -= dt;
    if (M.burnT > 0 && M.alive) {
      M.burnT -= dt; M.burnAcc += M.burnDps * dt;
      if (M.burnAcc >= 4) { const d = Math.floor(M.burnAcc); M.burnAcc -= d; const dd = absorb(d); M.hp -= dd; AU.crackle(null); if (dd > 0) hurtFx(dd * 0.5); if (M.hp <= 0) die(M.burnFrom, M.burnSpell); }
    }
    if (!M.alive) { M.deadT -= dt; if (M.deadT <= 0) respawn(); }
  }

  // 対戦を始める: 練習用の的を片付け、自分の的を置き、決められた地点に立つ
  G.matchStart = function (o) {
    if (D.on) { if (D.run) P.gold += D.run.gold; D.on = false; D.alive = true; D.run = null; clearDungeonThings(); }
    M.on = true; M.myId = o.myId; M.maxHp = DER.maxHp; M.hp = DER.maxHp; M.alive = true; M.prot = PROTECT_SEC;
    M.slowT = 0; M.slowHard = false; M.vulnT = 0; M.burnT = 0; M.burnAcc = 0;
    st.challenge = null;
    projs.slice().forEach(() => removeProj(projs.length - 1));
    clearFields(); timers.length = 0;
    G.noRespawn = true;
    targets.slice().forEach((t) => removeTargetObj(t));
    targets.length = 0; avatars.clear();
    resetSup(); circleKey = ''; clearBarriers();
    W.setStage('arena');
    W.resetTerrain();
    selfT = makePlayerTarget({ self: true, id: o.myId });
    targets.push(selfT);
    placeAt(SPAWNS[Math.max(0, o.spawn || 0) % SPAWNS.length]);
    st.mp = st.mpMax; st.cds = [0, 0, 0, 0, 0]; st.gcd = 0; st.vcd = {};
    for (const k in st.charges) { st.charges[k].n = st.charges[k].max || MG.SLOT_CHARGES; st.charges[k].t = 0; }
  };
  G.matchEnd = function () {
    if (!M.on) return;
    M.on = false; M.alive = true;
    targets.slice().forEach((t) => removeTargetObj(t));
    targets.length = 0; avatars.clear(); selfT = null;
    projs.slice().forEach(() => removeProj(projs.length - 1));
    clearFields(); timers.length = 0;
    player.kv.set(0, 0, 0);
    applyWandLook(MG.WAND_MAP[st.wand]);
    resetSup(); clearBarriers();
    W.setStage('town');
    W.resetTerrain();
    G.noRespawn = false;
    placeAt(W.TOWN_SPAWN);
    if (MG.UI && MG.UI.onStage) MG.UI.onStage('town');
  };
  G.addAvatar = function (pid, name, color) {
    if (avatars.has(pid)) return avatars.get(pid);
    const t = makePlayerTarget({ id: pid, name, color, x: 0, z: -60 });
    t.alive = false; // 最初の位置が届くまで隠しておく
    avatars.set(pid, t); targets.push(t);
    return t;
  };
  G.removeAvatar = function (pid) {
    const t = avatars.get(pid); if (!t) return;
    avatars.delete(pid);
    const i = targets.indexOf(t); if (i >= 0) targets.splice(i, 1);
    removeTargetObj(t);
    // その人の召喚獣も消す
    targets.slice().forEach((o) => { if (o.isSummon && o.puppet && o.ownerKey === pid) { const j = targets.indexOf(o); removeTargetObj(o); if (j >= 0) targets.splice(j, 1); } });
  };
  // 相手から届いた状態（位置・向き・HP など）
  G.updateAvatar = function (pid, s) {
    const t = avatars.get(pid); if (!t || !s) return;
    const p = vec(s.p); if (!p) return;
    const wasAlive = t.alive;
    t.netPos.set(clamp(p.x, -80, 80), clamp(p.y, -20, 60), clamp(p.z, -80, 80)); // 高さは飛翔（地面から 32m）より余裕をもたせる
    t.netYaw = clamp(s.y, -1e6, 1e6); t.netPitch = clamp(s.pi, -1.6, 1.6);
    t.alive = !!s.a;
    if (t.alive && !wasAlive) t.pos.copy(t.netPos); // 復活したら一瞬で移す
    const mh = clamp(s.mh || PLAYER_HP, 50, 3000); // 相手の最大HP（レベルで変わる）
    const hp = clamp(s.hp, 0, mh);
    if (hp !== t.hp || mh !== t.maxHp) { t.hp = hp; t.maxHp = mh; drawBar(t); }
    t.bar.visible = t.alive;
    t.netBurn = !!s.b; t.netFrozen = !!s.fr; t.netProt = !!s.pr;
    if (typeof s.w === 'string' && MG.WAND_MAP[s.w]) setAvatarWand(t, s.w);
    const we = s.wd && MG.ELEMENTS[s.wd] ? s.wd : null;
    if (we && we !== t.netWard && t.ward) { t.ward.material.uniforms.uColor.value.set(MG.ELEMENTS[we].c1); if (t.front) t.front.material.uniforms.uColor.value.set(MG.ELEMENTS[we].c1); }
    t.netWard = we; t.netWardLow = !!s.wl; t.netWardFront = !!s.ws;
    syncPuppets(pid, s.sm);
    t.netFly = s.fl && MG.ELEMENTS[s.fl] ? s.fl : null;
    t.netAura = s.au && MG.ELEMENTS[s.au] ? s.au : null;
  };
  function wardRipple(t, dir) {
    if (!t.ward || dir.lengthSq() < 1e-6) return;
    t.wardHit = 1; t.ward.material.uniforms.uHitDir.value.copy(dir).normalize();
    if (t.front) t.front.material.uniforms.uHitDir.value.copy(dir).normalize();
  }
  // 相手の画面で起きた見た目だけの出来事（障壁に当たった・こわれた）
  G.remoteFx = function (pid, f) {
    if (!M.on || !f) return false;
    const t = avatars.get(pid);
    // 相手の召喚獣の攻撃・倒れた、相手の魔法の壁がこわれた（相手の画面で決まったこと）
    if (f.k === 'sumAtk' || f.k === 'sumDie') {
      const s = targets.find((o) => o.isSummon && o.puppet && o.ownerKey === pid && o.sid === Math.round(+f.id));
      if (!s || !s.alive) return false;
      if (f.k === 'sumDie') { summonDie(s, false); return true; }
      const tp = vec(f.tp); if (!tp) return false;
      summonAttack(s, { center: tp, alive: true, r: 0.5 }, true);
      return true;
    }
    if (f.k === 'barBreak') {
      const b = barrierList.find((x) => x.id === pid + ':' + String(f.id).slice(0, 40));
      if (!b) return false;
      breakBarrier(b, true);
      return true;
    }
    if (f.k === 'wardHit') {
      if (!t) return false;
      const src = f.from === M.myId ? player.pos : avatars.get(f.from) ? avatars.get(f.from).pos : null;
      wardRipple(t, src ? new V3(src.x, src.y + 1.1, src.z).sub(t.center) : camera.position.clone().sub(t.center));
      return true;
    }
    if (f.k !== 'wardBreak') return false;
    const p = vec(f.p); if (!p) return false;
    const e = MG.ELEMENTS[f.e] ? f.e : 'magnet';
    const spec = { element: e, colors: [MG.ELEMENTS[e].c1, MG.ELEMENTS[e].c2], remote: pid, casterT: t || null };
    shatterFx(t ? t.center.clone().add(new V3(0, 0.2, 0)) : p, MG.ELEMENTS[e].c1, 1.3);
    if (t) { t.wardA = 0; t.netWard = null; }
    explode(p, clamp(f.r, 1, 12), 0, spec, null);
    return true;
  };
  G.localState = function () {
    return { p: arr(player.pos), y: Math.round(player.yaw * 1000) / 1000, pi: Math.round(player.pitch * 1000) / 1000, hp: Math.max(0, Math.round(M.hp)), a: M.alive ? 1 : 0, b: M.burnT > 0 ? 1 : 0, fr: M.slowT > 0 ? 1 : 0, pr: M.prot > 0 ? 1 : 0, wd: SUP.shield > 0 && SUP.shieldSpec ? SUP.shieldSpec.element : 0, wl: wardLow() ? 1 : 0, w: st.wand,
      fl: SUP.flyT > 0 && SUP.flySpec ? SUP.flySpec.element : 0, au: SUP.auraT > 0 && SUP.auraSpec ? SUP.auraSpec.element : 0,
      ws: SUP.shieldShape === 'front' ? 1 : 0, sm: summonStateList(), mh: Math.round(M.maxHp) };
  };
  // 相手が魔法を放った: 自分の画面で、相手の位置と向きから同じ魔法を再現する（見た目だけ）
  G.remoteCast = function (pid, c) {
    const casterT = avatars.get(pid);
    if (!M.on || !casterT || !c || !Array.isArray(c.seq)) return false;
    const spec0 = MG.buildSpell(c.seq.map(String));
    if (!spec0) return false;
    const m = c.m || {};
    const spec = applyMods(spec0, { dmg: clamp(m.dmg, 0, 3), cost: clamp(m.cost, 0, 3), cd: clamp(m.cd, 0.1, 3), pen: Math.round(clamp(m.pen, 0, 3)), speed: clamp(m.speed, 0.5, 2), mode: String(m.mode || 'slot') });
    spec.remote = pid; spec.casterT = casterT;
    const tip = vec(c.tip), o = vec(c.o), d = vec(c.d), pt = vec(c.p), pos = vec(c.pos);
    if (!tip || !o || !d || !pt || !pos) return false;
    d.normalize();
    const target = c.tg === M.myId ? selfT : c.tg ? avatars.get(c.tg) || null : null;
    const aim = { origin: o, dir: d, point: pt, target: target && target.alive ? target : null, dist: clamp(c.dist, 0, 200), ground: !!c.ground, range: clamp(c.range, 1, 200) };
    const ctx = { pos, tip, aim, casterT };
    const run = () => { CTX = ctx; const keepN = castN; castN = Math.round(clamp(c.n, 0, 1e9)); try { castSpell(spec, aim, null); } finally { CTX = null; castN = keepN; } };
    casterT.castGlow = 1;
    run();
    for (let k = 1; k <= spec.echo; k++) after(0.38 * k, () => { if (M.on && avatars.has(pid)) run(); });
    return true;
  };
  // 相手の魔法が自分に当たった（相手の画面で決まったダメージ）
  G.applyHit = function (from, h) {
    if (!M.on || !M.alive || M.prot > 0 || !h) return false;
    let d = clamp(h.d, 0, 20000);
    if (M.vulnT > 0) d *= 1.35;
    d = Math.round(d);
    if (d <= 0) return false;
    const hadShield = SUP.shield > 0;
    lastHitFrom = from;
    d = Math.round(absorb(d));
    lastHitFrom = null;
    if (d <= 0) {
      // 障壁がすべて吸い取った（状態異常や吹き飛ばしも防ぐ）
      AU.hit(h.e || 'force', null); H.feel(h.e || 'force', 0.2, 0.15, 0.2);
      if (hadShield) popup(ahead(2.4, 0.2), '吸収', 'ward');
      return true;
    }
    M.hp -= d; M.lastFrom = from; M.hurtT = st.time;
    if (Array.isArray(h.burn)) { M.burnT = Math.max(M.burnT, clamp(h.burn[0], 0, 10)); M.burnDps = Math.max(M.burnT > 0 ? M.burnDps : 0, clamp(h.burn[1], 0, 80)); M.burnFrom = from; M.burnSpell = String(h.n || '').slice(0, 20); }
    if (Array.isArray(h.frz)) { M.slowT = Math.max(M.slowT, clamp(h.frz[0], 0, 7)); M.slowHard = M.slowHard || !!h.frz[1]; }
    if (h.vul) M.vulnT = Math.max(M.vulnT, clamp(h.vul, 0, 12));
    if (Array.isArray(h.kb)) { player.kv.x += clamp(h.kb[0], -30, 30); player.kv.z += clamp(h.kb[2], -30, 30); const up = clamp(h.kb[1], 0, 10); if (up > 0.5) { player.vy = Math.max(player.vy, up); player.onGround = false; } }
    hurtFx(d);
    AU.hurt(d >= 40);
    H.feel(h.e || 'force', Math.min(1.2, 0.25 + d / 70), 0.25, Math.min(1, 0.3 + d / 80));
    if (M.hp <= 0) die(from, String(h.n || '').slice(0, 20));
    return true;
  };
  G.avatarList = () => [...avatars.values()];
  // 相手の魔法が、自分の召喚獣に当たった（相手の画面で決まったダメージ）
  G.applySummonHit = function (from, h) {
    if (!M.on || !h) return false;
    const t = targets.find((o) => o.isSummon && !o.puppet && o.alive && o.sid === Math.round(+h.id));
    if (!t) return false;
    let d = clamp(h.d, 0, 5000); if (t.vulnT > 0) d *= 1.35;
    if (Array.isArray(h.burn)) { t.burnT = Math.max(t.burnT, clamp(h.burn[0], 0, 10)); t.burnDps = Math.max(t.burnDps, clamp(h.burn[1], 0, 80)); }
    if (Array.isArray(h.frz)) { t.freezeT = Math.max(t.freezeT, clamp(h.frz[0], 0, 7)); if (h.frz[1]) t.frozenHard = true; }
    if (h.vul) t.vulnT = Math.max(t.vulnT, clamp(h.vul, 0, 12));
    if (Array.isArray(h.kb)) { t.dispV.x += clamp(h.kb[0], -30, 30) * t.mass; t.dispV.z += clamp(h.kb[2], -30, 30) * t.mass; }
    damage(t, d, null, false);
    return true;
  };
  // 自分の召喚獣・魔法の壁の様子（画面下の表示用）
  G.mySummons = () => targets.filter((t) => t.isSummon && !t.puppet && t.alive).map((t) => ({ kind: t.kind, label: MG.SUMMONS[t.kind].label, hp: Math.max(0, Math.round(t.hp)), maxHp: t.maxHp, left: Math.max(0, t.life) }));
  G.myBarriers = () => barrierList.filter((b) => b.owner === 'me' && !b.dead).map((b) => ({ shape: b.shape, hp: Math.max(0, Math.round(b.hp)), maxHp: b.maxHp, left: Math.max(0, b.dur - b.t) }));

  G.startChallenge = function (sec) {
    if (W.stage !== 'practice' && !M.on && !D.on) G.goStage('practice', [0, 16, 0]);
    st.score = 0; st.kills = 0; st.combo = 0; st.comboT = 0; st.mp = st.mpMax;
    st.cds = [0, 0, 0, 0, 0];
    projs.slice().forEach((_, i) => removeProj(projs.length - 1));
    clearFields();
    player.pos.set(0, 0, 16); player.yaw = 0; player.pitch = -0.05;
    G.resetTargets();
    st.challenge = { left: sec || 60, total: sec || 60 };
  };
  G.stopChallenge = function () { st.challenge = null; };

  // 動作確認用（シナリオから呼ぶ）
  window.__mg = {
    state: st,
    player,
    targets: () => targets.filter((t) => t.alive && !t.isSummon).map((t) => ({ id: t.id, type: t.type, hp: t.hp, maxHp: t.maxHp, x: t.center.x, y: t.center.y, z: t.center.z, frozen: t.freezeT > 0, burning: t.burnT > 0 })),
    counts: () => ({ projs: projs.length, fields: fields.length, beams: beams.length, bolts: bolts.length, spikes: spikes.length, particles: FX.alive, timers: timers.length }),
    clearTargets() { G.noRespawn = true; targets.slice().forEach((t) => { removeTargetObj(t); }); targets.length = 0; },
    allowRespawn() { G.noRespawn = false; },
    placeTarget(type, x, z, still) { const t = spawnTarget(type, new V3(x, 0, z)); t.spawnT = 1; t.phase = 0; t.still = !!still; if (type === 'slider') t.moveDir.set(1, 0, 0); updateTargets(0); return t.id; },
    lookAt(x, y, z) {
      const eye = new V3(player.pos.x, player.pos.y + EYE, player.pos.z);
      const d = new V3(x, y, z).sub(eye).normalize();
      player.yaw = Math.atan2(-d.x, -d.z); player.pitch = Math.asin(d.y);
      camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ'); camera.position.copy(eye); camera.updateMatrixWorld(true);
    },
    setPlayer(x, z) { player.pos.set(x, 0, z); camera.position.set(x, EYE, z); camera.updateMatrixWorld(true); },
    step(sec) { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) step(1 / 60); camera.updateMatrixWorld(true); },
    aim: () => { camera.updateMatrixWorld(true); const a = getAim(); return { target: a.target ? a.target.id : null, x: a.point.x, y: a.point.y, z: a.point.z }; },
    fillMp() { st.mp = st.mpMax; st.cds = [0, 0, 0, 0, 0]; st.gcd = 0; st.vcd = {}; for (const k in st.charges) { st.charges[k].n = st.charges[k].max || MG.SLOT_CHARGES; st.charges[k].t = 0; } },
    build: () => ({ state: st.build.state, words: st.build.words.slice(), need: st.build.need, rings: buildRings.filter((r) => r.on > 0.5).length, visible: buildGroup.visible }),
    wandVisible: () => wand.visible, handVisible: () => handGlow.visible,
    renderInfo: () => renderer.info.render,
    world: () => W.info(),
    ap: (x, y, z) => ap(new V3(x, y, z)),
    camOffset: () => ({ x: camera.position.x - player.pos.x, y: camera.position.y - player.pos.y - EYE, roll: camera.rotation.z, pitch: camera.rotation.x - player.pitch, yaw: camera.rotation.y - player.yaw }),
    aimDir: () => { const d = new V3(); camera.getWorldDirection(d); return { x: d.x, y: d.y, z: d.z }; },
    respawnRow() { G.noRespawn = false; G.resetTargets(); },
    match: M,
    avatars: () => [...avatars.values()].map((t) => ({ id: t.pid, name: t.name, alive: t.alive, hp: t.hp, x: t.center.x, y: t.center.y, z: t.center.z, visible: t.group.visible, prot: t.netProt })),
    selfTarget: () => (selfT ? { alive: selfT.alive, x: selfT.center.x, z: selfT.center.z } : null),
    hasCtx: () => CTX !== null,
    sup: SUP,
    meteorCircles: () => meteorCircles,
    prog: () => ({ level: P.prog.level, xp: P.prog.xp, stats: Object.assign({}, P.prog.stats), gold: P.gold, potions: P.potions, wands: P.wands.slice(), bestFloor: P.bestFloor, der: Object.assign({}, DER) }),
    setLevel(L, stats) { P.prog.level = L; P.prog.xp = 0; if (stats) Object.assign(P.prog.stats, stats); applyProgress(); st.mp = st.mpMax; D.hp = D.maxHp; },
    giveGold(n) { P.gold += n; if (MG.UI && MG.UI.onProgress) MG.UI.onProgress(); },
    unlockAll() { P.prog.level = Math.max(P.prog.level, 20); P.wands = MG.WANDS.map((w) => w.id).filter((id) => id !== 'bare'); applyProgress(); st.mp = st.mpMax; },
    goStage: (n, sp) => G.goStage(n, sp),
    dun: () => ({ on: D.on, floor: D.floor, hp: Math.round(D.hp), maxHp: D.maxHp, alive: D.alive, run: D.run ? { gold: D.run.gold, xp: D.run.xp, kills: D.run.kills, potGain: D.run.potGain } : null, chests: D.chests.length, opened: D.chests.filter((c) => c.open).length, ebolts: D.ebolts.length, stairsOpen: W.dun ? W.dun.stairsOpen : false, explored: D.explored ? D.explored.reduce((a, v) => a + v, 0) : 0 }),
    dunPos: () => (W.dun ? { start: [W.dun.start.x, W.dun.start.z], stairs: [W.dun.stairs.x, W.dun.stairs.z], portal: [W.dun.portal.x, W.dun.portal.z] } : null),
    enemies: () => targets.filter((t) => t.isEnemy && t.alive).map((t) => ({ id: t.id, kind: t.kind, hp: t.hp, maxHp: t.maxHp, x: Math.round(t.pos.x * 10) / 10, y: Math.round(t.pos.y * 10) / 10, z: Math.round(t.pos.z * 10) / 10, awake: t.awake, dmg: t.dmg, xp: t.xp })),
    killEnemies(kind) { targets.filter((t) => t.isEnemy && t.alive && (!kind || t.kind === kind)).forEach((t) => { t.hp = 0; killTarget(t); }); },
    spawnEnemy(kind, x, z, f) { const t = spawnEnemy(kind, new V3(x, 0, z), f || 1, RP.scale(f || 1)); t.spawnT = 1; return t.id; },
    hurt: (d) => hurtPlayer(d, null, 'テスト'),
    scene: () => scene, // 動作確認用（第30版）
    // 動作確認用（第30版）: 敵の見た目だけを並べる。list = [[種類, x, z, 向き, 大きさ], ...]。空で呼ぶと片づける
    showMonsters(list) {
      (G._show || []).forEach((m) => scene.remove(m.g)); G._show = [];
      (list || []).forEach(([kind, x, z, ry, sc]) => { const m = MG.Monsters.build(kind, []); m.kind = kind; m.g.position.set(x, kind === 'bat' ? 1.6 : W.floorAt(x, z, 1), z); m.g.rotation.y = ry || 0; m.g.scale.setScalar(sc || 1); scene.add(m.g); MG.Monsters.animate({ kind, parts: m.parts }, { sw: 0.3, k: 0, speed: 0, walk: 0, time: 0.3, phase: 0, dt: 0.016 }); G._show.push(m); });
      return G._show.length;
    },
    faceEnemies(x, z) { targets.filter((t) => t.isEnemy && t.alive).forEach((t) => { t.yaw = Math.atan2(x - t.pos.x, z - t.pos.z); t.face.rotation.y = t.yaw; }); },
    spot: () => (st.spot ? st.spot.id : null),
    interact: () => G.interact(),
    nextFloor: () => nextFloor(D.floor + 1),
    setInvul(v) { D.invul = v; },
    dilations: () => dilations.filter((d) => d.alive).map((d) => ({ owner: d.owner, x: d.c.x, z: d.c.z, R: d.R })),
    meissners: () => meissners.filter((m) => m.alive).map((m) => ({ owner: m.owner })),
    timeK: (x, y, z, owner) => timeK(new V3(x, y, z), owner === undefined ? null : owner),
    projList: () => projs.map((p) => ({ x: p.pos.x, y: p.pos.y, z: p.pos.z, vx: p.vel.x, vy: p.vel.y, vz: p.vel.z, reflected: !!p.reflected, owner: okey(ownerKey(p.spec)) })),
    floatH: () => Math.round((player.pos.y - W.floorAt(player.pos.x, player.pos.z, player.pos.y)) * 100) / 100,
    leftovers: () => scene.children.filter((o) => o.userData.special).length, // 演出の物体が場面に残っている数
    startChallenge: (sec) => G.startChallenge(sec),
    rocks: () => projs.filter((p) => p.kind === 'meteor').length,
    height: () => Math.round((player.pos.y - W.heightAt(player.pos.x, player.pos.z)) * 100) / 100,
    moveBoost: () => Math.round(moveBoost() * 100) / 100,
    flyAura: () => [...avatars.values()].map((t) => ({ id: t.pid, fly: t.netFly || null, aura: t.netAura || null, wings: !!(t.wings && t.wings.g.visible), glow: !!(t.auraGlow && t.auraGlow.visible), y: Math.round(t.pos.y * 100) / 100 })),
    keys: (o) => { Object.assign(input.keys, o || {}); },
    circles: () => [...avatars.values()].map((t) => ({ id: t.pid, key: t.circle ? t.circle.key : '', on: t.circle ? Math.round(t.circle.on * 100) / 100 : 0, visible: t.circle ? t.circle.g.visible : false, ward: !!t.netWard })),
    wardVisible: () => SUP.shield > 0 && (!M.on || M.alive),
    wardFx: () => [...avatars.values()].map((t) => ({ id: t.pid, a: Math.round((t.wardA || 0) * 100) / 100, hit: Math.round((t.wardHit || 0) * 100) / 100, low: !!t.netWardLow, visible: t.ward ? t.ward.visible : false, front: t.front ? t.front.visible : false })),
    shatter: (x, y, z) => shatterFx(new V3(x, y, z), '#ff5a1f', 1.3),
    wandInfo: () => ({ id: wandModel.userData.id, parts: wandModel.userData.parts, visible: wand.visible, tipY: Math.round(wandModel.userData.tip.position.y * 100) / 100, glowK: wandModel.userData.glowK }),
    summons: () => targets.filter((t) => t.isSummon && t.alive).map((t) => ({ kind: t.kind, puppet: t.puppet, owner: t.ownerKey, sid: t.sid, hp: t.hp, maxHp: t.maxHp, x: Math.round(t.pos.x * 100) / 100, y: Math.round(t.pos.y * 100) / 100, z: Math.round(t.pos.z * 100) / 100, life: Math.round(t.life * 10) / 10, element: t.spec.element, target: t.tgt ? (t.tgt.isSummon ? 'summon' : t.tgt.isPlayer ? 'player' : t.tgt.type) : null })),
    barriers: () => barrierList.map((b) => ({ id: b.id, shape: b.shape, owner: b.owner, hp: b.hp, maxHp: b.maxHp, x: Math.round(b.wb.mesh.position.x * 100) / 100, z: Math.round(b.wb.mesh.position.z * 100) / 100, w: b.wb.half ? b.wb.half[0] * 2 : 0, h: b.h, R: b.wb.R || 0, left: Math.round((b.dur - b.t) * 10) / 10, yaw: b.wb.mesh.rotation.y })),
    floor: () => Math.round((player.floor == null ? 0 : player.floor) * 100) / 100,
    onGround: () => player.onGround,
    setPlayerY(y) { player.pos.y = y; player.vy = 0; },
    shoot(x, y, z, dx, dy, dz, remote) { // 動作確認用: 指定した位置から魔弾を1つ撃つ（remote を付けると相手の魔法として）
      const spec = Object.assign({}, MG.buildSpell(['combustion', 'reduction']), remote ? { remote, casterT: null } : {});
      spawnProj(spec, new V3(x, y, z), new V3(dx, dy, dz), { kind: 'bolt' }); return projs.length;
    },
    avatarWands: () => [...avatars.values()].map((t) => ({ id: t.pid, wand: t.netWand, model: t.wandModel ? t.wandModel.userData.id : null, hands: t.hands ? t.hands[0].visible : false })),
  };
})();
