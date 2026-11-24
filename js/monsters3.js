// 隠し部屋の、物凄く強いモンスター 4 体（第44版）: 深淵の魔竜・氷晶の霊獣・蜘蛛の魔女・星杭の巫神。
// ユーザーが ゲーム素材/ に入れた参考の絵（隠し部屋モンスター①〜④）から、おおまかな特徴だけを借りてこのゲーム用に作った姿。
// 絵そのものや、ほかの作品のキャラクターの細かな意匠は写していない（絵はゲームに入れない）。
(function () {
  'use strict';
  const MG = window.MG, MON = MG.Monsters, FX = MG.FX;
  if (!MON || !MON.register) return;
  const V3 = THREE.Vector3;
  const rand = (a, b) => a + Math.random() * (b - a);
  const { add, pivot, glow, jitter, tube } = MON.util;
  // 手足: 付け根から -Y へ 2 本（関節つき）
  function limb(parent, x, y, z, l1, l2, r, mat, mat2) {
    const a = pivot(parent, x, y, z);
    add(a, new THREE.CylinderGeometry(r * 0.85, r, l1, 8), mat, [0, -l1 / 2, 0]);
    add(a, new THREE.SphereGeometry(r * 1.05, 8, 6), mat);
    const b = pivot(a, 0, -l1, 0);
    add(b, new THREE.CylinderGeometry(r * 0.6, r * 0.85, l2, 8), mat2 || mat, [0, -l2 / 2, 0]);
    add(b, new THREE.SphereGeometry(r * 0.9, 8, 6), mat2 || mat);
    const end = pivot(b, 0, -l2, 0);
    return { a, b, end };
  }
  function claws(parent, n, len, r, mat, spread) {
    for (let i = 0; i < n; i++) add(parent, new THREE.ConeGeometry(r, len, 5), mat, [(i - (n - 1) / 2) * r * 2.2, -len * 0.35, len * 0.3], [1.9, 0, (i - (n - 1) / 2) * (spread || 0.25)]);
  }
  // ぼろぼろの膜の翼: 付け根から外（sd の向き）へ。指の骨と、ぎざぎざのふち
  function raggedWing(parent, sd, span, memb, boneM) {
    const root = pivot(parent, 0, 0, 0);
    const sh = new THREE.Shape(); sh.moveTo(0, 0);
    const pts = [[0.2, 0.55], [0.45, 0.95], [0.72, 1.0], [1.0, 0.7], [0.95, 0.2], [1.0, -0.35], [0.82, -0.75], [0.62, -0.5], [0.5, -1.0], [0.35, -0.55], [0.22, -0.8], [0.1, -0.3]];
    pts.forEach(([u, v]) => sh.lineTo(span * u, span * v * 0.6));
    sh.lineTo(0, 0);
    const m = add(root, new THREE.ShapeGeometry(sh, 4), memb); m.scale.x = sd;
    [[0.72, 1.0], [1.0, 0.7], [1.0, -0.35], [0.82, -0.75], [0.5, -1.0]].forEach(([u, v]) => {
      const L = Math.hypot(u, v * 0.6) * span, ang = Math.atan2(v * 0.6, u);
      add(root, new THREE.CylinderGeometry(span * 0.012, span * 0.025, L, 5), boneM, [sd * Math.cos(ang) * L / 2, Math.sin(ang) * L / 2, 0.02], [0, 0, sd * (ang - Math.PI / 2)]);
    });
    add(root, new THREE.ConeGeometry(span * 0.04, span * 0.22, 5), boneM, [sd * span * 0.74, span * 0.66, 0.02], [0, 0, -sd * 0.4]); // 翼の爪
    return root;
  }

  // ======================================================================
  //  ① 深淵の魔竜（参考: 隠し部屋モンスター①）
  //  チェック項目: 黒い鎧のような外殻の、人に近い形の竜／胸と腹に骨色の板が重なる／赤く光る大きく開いた口と、後ろへ反った長い角／
  //               左右に大きく広がる、ぼろぼろの膜の翼／かぎ爪の手足と、長くうねるしっぽ／宙に浮いている
  // ======================================================================
  // 第45版: Blender で作ったモデル（js/model-glb.js・js/model-data.js）があればそれを使い、なければ下の手作りの形にする
  const dragonProcBuild = function (std, g, P) {
    const shell = std({ color: 0x1e1c22, roughness: 0.42, metalness: 0.45, flatShading: true });
    const shellD = std({ color: 0x0e0c10, roughness: 0.5, metalness: 0.4, flatShading: true });
    const plate = std({ color: 0xb8a68c, roughness: 0.55, metalness: 0.1, flatShading: true });
    const flesh = std({ color: 0x4a2a26, roughness: 0.8, flatShading: true });
    const memb = std({ color: 0x2c2426, roughness: 0.85, side: THREE.DoubleSide, transparent: true, opacity: 0.96 });
    const horn = std({ color: 0x9a4a22, roughness: 0.5, emissive: 0x300800, emissiveIntensity: 0.6 });
    const maw = std({ color: 0xff4020, emissive: 0xff2a10, emissiveIntensity: 2.4 });
    const eyeM = std({ color: 0xffd060, emissive: 0xffa020, emissiveIntensity: 3 });
    const S = 1.5;
    const body = pivot(g, 0, 0, 0); P.body = body;
    // 胴: 腰から胸へ太くなる外殻
    const prof = [[0.22, 0.95], [0.3, 1.15], [0.36, 1.45], [0.44, 1.75], [0.46, 1.95], [0.36, 2.1], [0.16, 2.2]].map(([r, y]) => new THREE.Vector2(r * S, y * S));
    const torso = add(body, jitter(new THREE.LatheGeometry(prof, 12), 0.02 * S), shell, null, null, [1, 1, 0.75]);
    P.torso = torso;
    for (let i = 0; i < 6; i++) add(body, new THREE.TorusGeometry((0.3 + i * 0.02) * S, 0.035 * S, 4, 10, Math.PI * 0.9), plate, [0, (1.3 + i * 0.12) * S, 0.12 * S], [0.1, 0, Math.PI * 1.05]); // 胸と腹の骨色の板
    [-1, 1].forEach((sd) => { // 肩のとげの鎧
      add(body, jitter(new THREE.DodecahedronGeometry(0.2 * S, 0), 0.02), shellD, [sd * 0.5 * S, 1.98 * S, 0], null, [1.2, 0.8, 1]);
      for (let k = 0; k < 3; k++) add(body, new THREE.ConeGeometry(0.05 * S, (0.32 - k * 0.06) * S, 5), plate, [sd * (0.5 + k * 0.08) * S, (2.12 + k * 0.03) * S, (-0.08 + k * 0.06) * S], [-0.3, 0, -sd * (0.4 + k * 0.25)]);
    });
    // 腰と、宙に垂れる脚（かぎ爪）
    P.legs = [-1, 1].map((sd) => { const L = limb(body, sd * 0.22 * S, 0.95 * S, 0, 0.5 * S, 0.55 * S, 0.12 * S, shell, flesh); L.a.rotation.x = -0.4; L.b.rotation.x = 0.9; claws(L.end, 3, 0.22 * S, 0.04 * S, plate, 0.3); return L; });
    // 腕（大きなかぎ爪の手）
    P.arms = [-1, 1].map((sd) => { const L = limb(body, sd * 0.55 * S, 1.95 * S, 0.05 * S, 0.55 * S, 0.5 * S, 0.11 * S, shell, shellD); L.a.rotation.z = sd * 0.5; claws(L.end, 4, 0.28 * S, 0.035 * S, plate, 0.35); return L; });
    // 頭: 長い鼻先と、赤く光る開いた口、後ろへ反った角
    const head = pivot(body, 0, 2.3 * S, 0.12 * S); P.head = head;
    add(head, jitter(new THREE.ConeGeometry(0.22 * S, 0.7 * S, 6), 0.015), shell, [0, 0.04 * S, 0.22 * S], [Math.PI / 2, 0, 0], [1.2, 1, 0.75]);
    add(head, jitter(new THREE.SphereGeometry(0.2 * S, 10, 8), 0.015), shellD, [0, 0.06 * S, -0.06 * S], null, [1.05, 0.85, 1]);
    for (let i = 0; i < 4; i++) add(head, new THREE.ConeGeometry(0.035 * S, 0.16 * S, 4), shellD, [0, (0.17 - i * 0.01) * S, (0.3 - i * 0.12) * S], [-0.5, 0, 0]); // 鼻すじのとげ
    P.jaw = pivot(head, 0, -0.1 * S, 0.1 * S);
    add(P.jaw, new THREE.ConeGeometry(0.12 * S, 0.45 * S, 6), shellD, [0, -0.02 * S, 0.3 * S], [Math.PI / 2, 0, 0], [1, 1, 0.5]);
    add(head, new THREE.SphereGeometry(0.11 * S, 10, 8), maw, [0, -0.08 * S, 0.28 * S], null, [1, 0.6, 1.6]);
    P.mawGlow = glow(head, '#ff4020', 1.4, [0, -0.06 * S, 0.45 * S]);
    for (let i = 0; i < 6; i++) add(head, new THREE.ConeGeometry(0.015 * S, 0.08 * S, 4), plate, [(-0.08 + (i % 3) * 0.08) * S, (i < 3 ? -0.03 : -0.13) * S, 0.42 * S], [i < 3 ? Math.PI : 0, 0, 0]);
    [-1, 1].forEach((sd) => {
      add(head, new THREE.SphereGeometry(0.035 * S, 8, 6), eyeM, [sd * 0.12 * S, 0.1 * S, 0.3 * S]);
      add(head, tube([[sd * 0.12 * S, 0.12 * S, 0], [sd * 0.25 * S, 0.3 * S, -0.25 * S], [sd * 0.32 * S, 0.42 * S, -0.65 * S], [sd * 0.3 * S, 0.62 * S, -0.95 * S]], 0.045 * S, 12), horn);
      add(head, tube([[sd * 0.16 * S, 0.0, -0.05 * S], [sd * 0.3 * S, 0.05 * S, -0.35 * S], [sd * 0.36 * S, 0.2 * S, -0.6 * S]], 0.03 * S, 10), horn);
    });
    // 翼: 背中から大きく
    P.wings = [-1, 1].map((sd) => { const wr = pivot(body, sd * 0.25 * S, 1.95 * S, -0.25 * S); wr.rotation.y = -sd * 0.35; wr.add(raggedWing(wr, sd, 2.2 * S, memb, plate)); return wr; });
    // しっぽ: 長くうねる、とげつき
    const tp = [[0, 0.95, -0.2], [0, 0.6, -0.6], [0.2, 0.35, -1.1], [0.1, 0.4, -1.6], [-0.25, 0.7, -2.0], [-0.35, 1.05, -2.2]].map(([x, y, z]) => [x * S, y * S, z * S]);
    P.tail = pivot(body, 0, 0, 0);
    add(P.tail, tube(tp, 0.09 * S, 20), flesh);
    for (let i = 1; i < tp.length; i++) add(P.tail, new THREE.ConeGeometry(0.04 * S, 0.18 * S, 4), plate, [tp[i][0], tp[i][1] + 0.08 * S, tp[i][2]]);
    P.aura = glow(body, '#7a1020', 4.5, [0, 1.7 * S, 0]);
  };
  const dragonProcAnim = function (t, o) {
    const P = t.parts, tm = o.time + o.phase, strike = o.k > 0 ? Math.sin(o.k * Math.PI) : 0;
    const fl = Math.sin(tm * 2.2);
    P.body.position.y = 0.2 + Math.sin(tm * 2.2 + 0.8) * 0.18;
    P.wings.forEach((w, i) => { const sd = i ? 1 : -1; w.rotation.z = sd * (fl * 0.45 - 0.1); w.rotation.y = -sd * (0.35 + strike * 0.4); });
    P.arms.forEach((a, i) => { a.a.rotation.x = -0.3 - strike * 1.6 + Math.sin(tm * 1.5 + i) * 0.1; a.b.rotation.x = -0.6 - strike * 0.4; });
    P.legs.forEach((l, i) => { l.a.rotation.x = -0.4 + Math.sin(tm * 2.2 + i * 1.5) * 0.12; });
    P.jaw.rotation.x = 0.25 + strike * 0.5 + Math.max(0, Math.sin(tm * 3)) * 0.1;
    P.head.rotation.x = -strike * 0.3;
    P.tail.rotation.y = Math.sin(tm * 1.3) * 0.25;
    P.mawGlow.scale.setScalar(1.4 * (1 + strike * 1.2 + Math.sin(tm * 6) * 0.1));
  };
  // ---- Blender のモデル ----
  const DRAGON_SCALE = 1.2;              // Blender では 1 = 1m。ゲームの今までの魔竜と同じくらいの大きさにする
  const DRAGON_PEAK = { attack: 0.65, cast: 0.75 }; // 攻撃のため（o.k 0→1）が終わる時点の、動きの中の時刻（爪を振り下ろす・口を突き出す）
  function dragonGLBBuild(std, g, P) {
    const lin2s = (a) => new THREE.Color(a[0], a[1], a[2]).convertLinearToSRGB(); // std は sRGB の色を受け取って直すので、逆に直して渡す
    const M = MG.ModelGLB.instance('abyssdrake', (m) => std({
      color: lin2s(m.color), vertexColors: true, roughness: m.rough, metalness: Math.min(0.4, m.metal),
      side: m.double ? THREE.DoubleSide : THREE.FrontSide, emissive: m.emissive ? lin2s(m.emissive) : 0x000000, emissiveIntensity: m.emissive ? m.ei : 1,
    }));
    const root = M.root; root.scale.setScalar(DRAGON_SCALE); g.add(root);
    // 口の奥の赤い光（Blender の頭の座標で口の中 → 頭の骨につける）
    P.maw = glow(root, '#ff3010', 0.9, [0, 2.74, 0.58]);
    root.updateMatrixWorld(true);
    if (M.bones.head) M.bones.head.attach(P.maw);
    P.glb = true; P.keep = [root, ...M.meshes]; // bake で骨つきのメッシュをまとめないように
    const mixer = new THREE.AnimationMixer(root), act = {};
    for (const k of ['hover', 'attack', 'cast']) {
      const a = mixer.clipAction(M.clips[k]); act[k] = a;
      if (k === 'hover') { a.play(); a.time = Math.random() * M.clips[k].duration; }
      else { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.timeScale = 0; a.setEffectiveWeight(0); a.play(); }
    }
    // mixer と act は互いを指し合うので、bake が部品をたどるときに見えないよう、列挙しないプロパティにする
    Object.defineProperty(P, 'mixer', { value: mixer, enumerable: false });
    Object.defineProperty(P, 'act', { value: act, enumerable: false });
    Object.assign(P, { w: 0, atk: null, cur: 'attack', atkT: 0, rel: 0 });
  }
  function dragonGLBAnim(t, o) {
    const P = t.parts, dt = Math.min(0.1, Math.max(0, o.dt || 0)), A = P.act;
    // 攻撃のため（o.k）の間は、動きを「ため」の終わりまで進め、ためが終わったら残りを再生する
    if (o.k > 0) { if (!P.atk) P.atk = t.castNext ? 'cast' : 'attack'; P.cur = P.atk; P.atkT = o.k * DRAGON_PEAK[P.atk]; P.rel = 0; }
    else if (P.atk) { P.rel += dt; P.atkT = DRAGON_PEAK[P.atk] + P.rel; if (P.atkT >= A[P.atk].getClip().duration - 0.02) P.atk = null; }
    P.w += ((P.atk ? 1 : 0) - P.w) * Math.min(1, dt * 10);
    for (const k of ['attack', 'cast']) {
      const a = A[k];
      if (k === P.cur) { a.time = Math.min(P.atkT, a.getClip().duration - 0.001); a.setEffectiveWeight(P.w); } else a.setEffectiveWeight(0);
    }
    A.hover.setEffectiveWeight(1 - P.w * 0.95);
    P.mixer.update(dt);
    const tm = o.time + o.phase;
    P.maw.scale.setScalar(0.9 * (1 + P.w * (P.cur === 'cast' ? 1.6 : 0.6) + Math.sin(tm * 6) * 0.1));
  }
  MON.register('abyssdrake', function (std, g, P) {
    if (MG.ModelGLB && MG.ModelGLB.has('abyssdrake') && THREE.AnimationMixer) return dragonGLBBuild(std, g, P);
    return dragonProcBuild(std, g, P);
  }, function (t, o) { return t.parts.glb ? dragonGLBAnim(t, o) : dragonProcAnim(t, o); });

  // ======================================================================
  //  ② 氷晶の霊獣（参考: 隠し部屋モンスター②）
  //  チェック項目: 灰紫のふさふさの毛の、大きな四つ足の獣／頭と首のまわりの濃い青のたてがみ／枝分かれした大きな角／
  //               背中・肩・前脚から生える、青く光る氷の結晶／くるりと巻いた長いしっぽ／光る青い目
  // ======================================================================
  MON.register('frostbeast', function (std, g, P) {
    const fur = std({ color: 0x6e687c, roughness: 1, flatShading: true });
    const furD = std({ color: 0x48445a, roughness: 1, flatShading: true });
    const mane = std({ color: 0x2a2c86, roughness: 0.9, flatShading: true });
    const antler = std({ color: 0xa8a6b4, roughness: 0.6 });
    const crys = std({ color: 0x7ac8ff, emissive: 0x2a88e0, emissiveIntensity: 1.4, roughness: 0.1, transparent: true, opacity: 0.9, flatShading: true });
    const claw = std({ color: 0x1a1820, roughness: 0.5 });
    const eyeM = std({ color: 0xbfe8ff, emissive: 0x5ab8ff, emissiveIntensity: 3 });
    const S = 1.25;
    const body = pivot(g, 0, 0, 0); P.body = body;
    // 胴: 前が高く、毛のかたまりでふくらむ
    add(body, jitter(new THREE.SphereGeometry(0.75 * S, 12, 9), 0.06 * S), fur, [0, 1.5 * S, -0.1 * S], null, [0.95, 0.85, 1.55]);
    add(body, jitter(new THREE.SphereGeometry(0.7 * S, 12, 9), 0.07 * S), fur, [0, 1.75 * S, 0.55 * S], null, [1.05, 1.0, 1.0]);
    for (let i = 0; i < 26; i++) { const a = rand(0, Math.PI * 2), zz = rand(-1.1, 0.9); add(body, new THREE.ConeGeometry(0.12 * S, 0.45 * S, 4), i % 3 ? fur : furD, [Math.cos(a) * 0.65 * S, (1.55 + Math.sin(a) * 0.6) * S, zz * S], [Math.sin(a) * 1.2 + rand(-0.3, 0.3), 0, -Math.cos(a) * 1.2 + rand(-0.3, 0.3)]); } // 毛の房
    // 首とたてがみ・頭
    const head = pivot(body, 0, 2.0 * S, 1.2 * S); P.head = head;
    add(head, jitter(new THREE.SphereGeometry(0.34 * S, 10, 8), 0.03), fur, [0, 0, 0], null, [1, 0.95, 1.1]);
    add(head, jitter(new THREE.BoxGeometry(0.3 * S, 0.24 * S, 0.42 * S), 0.02), furD, [0, -0.08 * S, 0.32 * S]);
    add(head, new THREE.SphereGeometry(0.06 * S, 8, 6), claw, [0, -0.04 * S, 0.54 * S]);
    [-1, 1].forEach((sd) => { add(head, new THREE.SphereGeometry(0.045 * S, 8, 6), eyeM, [sd * 0.14 * S, 0.06 * S, 0.24 * S]); glow(head, '#5ab8ff', 0.5, [sd * 0.14 * S, 0.06 * S, 0.27 * S]); });
    for (let i = 0; i < 22; i++) { const a = rand(-Math.PI * 0.9, Math.PI * 0.9), r = rand(0.3, 0.5); add(head, new THREE.ConeGeometry(0.09 * S, rand(0.5, 0.9) * S, 4), mane, [Math.sin(a) * r * S, (Math.cos(a) * r - 0.1) * S, rand(-0.5, -0.05) * S], [rand(-0.4, -1.3), 0, -Math.sin(a) * 1.3]); } // たてがみ
    [-1, 1].forEach((sd) => { // 枝分かれした角
      add(head, tube([[sd * 0.15 * S, 0.25 * S, -0.05 * S], [sd * 0.35 * S, 0.65 * S, -0.15 * S], [sd * 0.5 * S, 1.05 * S, -0.35 * S], [sd * 0.55 * S, 1.35 * S, -0.6 * S]], 0.045 * S, 12), antler);
      add(head, tube([[sd * 0.3 * S, 0.55 * S, -0.12 * S], [sd * 0.55 * S, 0.7 * S, 0.05 * S], [sd * 0.7 * S, 0.85 * S, 0.1 * S]], 0.03 * S, 8), antler);
      add(head, tube([[sd * 0.45 * S, 0.95 * S, -0.3 * S], [sd * 0.7 * S, 1.1 * S, -0.25 * S], [sd * 0.85 * S, 1.3 * S, -0.2 * S]], 0.028 * S, 8), antler);
      add(head, tube([[sd * 0.5 * S, 1.15 * S, -0.45 * S], [sd * 0.45 * S, 1.45 * S, -0.4 * S]], 0.025 * S, 6), antler);
    });
    // 脚: 前は太く毛深い（氷の結晶つき）、後ろは獣の脚
    P.legs = [[-1, 0.75], [1, 0.75], [-1, -0.95], [1, -0.95]].map(([sd, z], i) => {
      const L = limb(body, sd * 0.45 * S, 1.35 * S, z * S, 0.65 * S, 0.6 * S, (i < 2 ? 0.18 : 0.15) * S, fur, furD);
      add(L.end, jitter(new THREE.SphereGeometry(0.16 * S, 8, 6), 0.02), furD, [0, -0.05 * S, 0.06 * S], null, [1, 0.6, 1.3]);
      claws(L.end, 3, 0.12 * S, 0.035 * S, claw, 0.25);
      if (i < 2) for (let k = 0; k < 3; k++) add(L.a, new THREE.ConeGeometry(0.06 * S, rand(0.3, 0.5) * S, 5), crys, [sd * 0.12 * S, -0.2 * S - k * 0.15 * S, 0.1 * S], [0.6, 0, sd * (0.6 + k * 0.2)]);
      return L;
    });
    // 背中と肩の氷の結晶
    P.crystals = [];
    for (let i = 0; i < 14; i++) { const zz = rand(-1.0, 0.8), sd = i % 2 ? 1 : -1, L = rand(0.4, 0.95); const c = add(body, new THREE.ConeGeometry(0.08 * S, L * S, 5), crys, [sd * rand(0.1, 0.5) * S, (2.1 + rand(-0.1, 0.15)) * S, zz * S], [rand(-0.4, 0.4), 0, sd * rand(0.2, 0.9)]); P.crystals.push(c); }
    P.crysGlow = glow(body, '#4ab0ff', 3.2, [0, 2.2 * S, 0]);
    // 巻いたしっぽ
    P.tail = pivot(body, 0, 1.55 * S, -1.25 * S);
    const tp = [[0, 0, 0], [0, 0.4, -0.5], [0, 1.0, -0.6], [0, 1.4, -0.2], [0, 1.25, 0.15], [0, 0.95, 0.05]].map(([x, y, z]) => [x * S, y * S, z * S]);
    add(P.tail, tube(tp, 0.13 * S, 20), fur);
    add(P.tail, jitter(new THREE.SphereGeometry(0.2 * S, 8, 6), 0.03), furD, tp[tp.length - 1], null, [0.8, 1.2, 0.8]);
  }, function (t, o) {
    const P = t.parts, tm = o.time + o.phase, strike = o.k > 0 ? Math.sin(o.k * Math.PI) : 0, sw = o.sw;
    // 歩き: 対角の脚がいっしょに動く
    P.legs.forEach((L, i) => { const ph = (i === 0 || i === 3) ? sw : -sw; L.a.rotation.x = ph * 0.5 - (i < 2 ? strike * 0.9 : 0); L.b.rotation.x = Math.max(0, -ph) * 0.6 + (i < 2 ? strike * 0.5 : 0); });
    P.body.position.y = Math.abs(sw) * 0.06 + strike * 0.25;
    P.body.rotation.x = -strike * 0.25;
    P.head.rotation.x = Math.sin(tm * 1.4) * 0.06 + strike * 0.35;
    P.head.rotation.y = Math.sin(tm * 0.7) * 0.15;
    P.tail.rotation.y = Math.sin(tm * 1.6) * 0.3;
    P.crysGlow.scale.setScalar(3.2 * (1 + Math.sin(tm * 2.5) * 0.15 + strike * 0.5));
  });

  // ======================================================================
  //  ③ 蜘蛛の魔女（参考: 隠し部屋モンスター③）
  //  チェック項目: 黒い大きな蜘蛛の体から、黒いドレスの女の上半身が生えている／銀色の短い髪と、赤く光る目／
  //               頭と体に白いばら／背中から伸びる、細長い黒い脚／糸を吐いて離れて戦う
  // ======================================================================
  MON.register('arachne', function (std, g, P) {
    const chit = std({ color: 0x141218, roughness: 0.35, metalness: 0.3, flatShading: true });
    const chitL = std({ color: 0x2a2632, roughness: 0.4, metalness: 0.3, flatShading: true });
    const silver = std({ color: 0xa8a8b8, roughness: 0.4, metalness: 0.5 });
    const dress = std({ color: 0x18161e, roughness: 0.8, side: THREE.DoubleSide, flatShading: true });
    const lace = std({ color: 0x3a3646, roughness: 0.7, side: THREE.DoubleSide });
    const skin = std({ color: 0xd8d4dc, roughness: 0.6 });
    const hair = std({ color: 0xc8c8d4, roughness: 0.55, flatShading: true });
    const rose = std({ color: 0xf0eef0, roughness: 0.7, flatShading: true });
    const eyeM = std({ color: 0xff4050, emissive: 0xff1030, emissiveIntensity: 3 });
    const S = 1.3;
    const body = pivot(g, 0, 0, 0); P.body = body;
    // 蜘蛛の体: 後ろの大きな腹と、前の胸
    add(body, jitter(new THREE.SphereGeometry(0.75 * S, 14, 10), 0.03), chit, [0, 0.95 * S, -0.85 * S], null, [1, 0.85, 1.25]);
    for (let i = 0; i < 4; i++) add(body, new THREE.TorusGeometry((0.3 - i * 0.05) * S, 0.02 * S, 4, 12), silver, [0, (1.6 - i * 0.04) * S, (-0.9 - i * 0.18) * S], [Math.PI / 2 - 0.4, 0, 0]); // 腹の銀の模様
    add(body, jitter(new THREE.SphereGeometry(0.42 * S, 12, 8), 0.02), chitL, [0, 0.9 * S, 0.1 * S], null, [1.1, 0.75, 1.1]);
    // 8 本の脚
    P.legs = [];
    for (let i = 0; i < 4; i++) [-1, 1].forEach((sd) => {
      const z = (0.3 - i * 0.24) * S, root = pivot(body, sd * 0.3 * S, 0.9 * S, z);
      const phi = 0.8 - i * 0.55, dx = sd * Math.cos(phi), dz = Math.sin(phi);
      root.rotation.y = Math.atan2(dz, -dx);
      const up = pivot(root, 0, 0, 0); up.rotation.z = 0.75;
      add(up, new THREE.CylinderGeometry(0.05 * S, 0.065 * S, 1.0 * S, 6), chit, [0, 0.5 * S, 0]);
      const kn = pivot(up, 0, 1.0 * S, 0); kn.rotation.z = 1.75;
      add(kn, new THREE.SphereGeometry(0.07 * S, 6, 5), silver);
      add(kn, new THREE.CylinderGeometry(0.02 * S, 0.045 * S, 1.55 * S, 6), chit, [0, 0.77 * S, 0]);
      P.legs.push({ root, up, kn, i, sd });
    });
    // 上半身（胸の前から立ち上がる）
    const up = pivot(body, 0, 1.15 * S, 0.35 * S); up.scale.setScalar(1.45); P.upper = up;
    add(up, new THREE.CylinderGeometry(0.17 * S, 0.24 * S, 0.7 * S, 10), dress, [0, 0.35 * S, 0]);
    add(up, new THREE.CylinderGeometry(0.5 * S, 0.25 * S, 0.35 * S, 14, 1, true), lace, [0, 0.05 * S, 0]); // 腰のフリル
    add(up, new THREE.SphereGeometry(0.2 * S, 10, 8), dress, [0, 0.72 * S, 0.02 * S], null, [1.2, 0.8, 0.9]);
    add(up, new THREE.CylinderGeometry(0.05 * S, 0.06 * S, 0.14 * S, 8), skin, [0, 0.88 * S, 0]);
    const head = pivot(up, 0, 1.05 * S, 0.02 * S); P.head = head;
    add(head, new THREE.SphereGeometry(0.14 * S, 14, 12), skin, null, null, [0.92, 1.05, 1]);
    add(head, new THREE.SphereGeometry(0.16 * S, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.6), hair, [0, 0.03 * S, -0.02 * S], null, [1.05, 1, 1.05]); // 短い銀の髪
    for (let i = 0; i < 7; i++) add(head, new THREE.ConeGeometry(0.035 * S, 0.18 * S, 4), hair, [(-0.13 + i * 0.043) * S, -0.06 * S, (i === 0 || i === 6 ? 0.02 : -0.08) * S], [0.15, 0, 0]);
    [-1, 1].forEach((sd) => { add(head, new THREE.SphereGeometry(0.018 * S, 6, 5), eyeM, [sd * 0.05 * S, 0.01 * S, 0.125 * S]); glow(head, '#ff2040', 0.35, [sd * 0.05 * S, 0.01 * S, 0.14 * S]); });
    // 頭の飾り: 小さな黒い帽子と白いばら
    add(head, new THREE.CylinderGeometry(0.16 * S, 0.17 * S, 0.03 * S, 14), dress, [0.04 * S, 0.15 * S, 0], [0, 0, 0.25]);
    const roseAt = (par, p, s) => { add(par, jitter(new THREE.DodecahedronGeometry(0.06 * s * S, 1), 0.006), rose, p); };
    [[0.12, 0.14, 0.04], [0.15, 0.08, -0.06], [0.05, 0.17, -0.1]].forEach(([x, y, z]) => roseAt(head, [x * S, y * S, z * S], 1));
    [[0.15, 0.6, 0.15], [-0.18, 0.45, 0.14], [0.3, 0.05, 0.25], [-0.32, 0.1, 0.2], [0.0, 0.1, 0.42]].forEach(([x, y, z]) => roseAt(up, [x * S, y * S, z * S], 1.3));
    // 腕（細い手、黒い長手袋）
    P.arms = [-1, 1].map((sd) => { const L = limb(up, sd * 0.22 * S, 0.7 * S, 0.02 * S, 0.33 * S, 0.33 * S, 0.04 * S, dress, chitL); L.a.rotation.z = sd * 0.25; return L; });
    // 背中から伸びる細長い黒い脚（飾り）
    P.backLegs = [-1, 1].map((sd) => { const b = pivot(up, sd * 0.15 * S, 0.65 * S, -0.15 * S); for (let k = 0; k < 2; k++) { const seg = pivot(b, 0, 0, 0); seg.rotation.set(-0.6 - k * 0.5, 0, sd * (0.8 + k * 0.5)); add(seg, new THREE.CylinderGeometry(0.012 * S, 0.03 * S, 1.1 * S, 5), chit, [0, 0.55 * S, 0]); add(seg, new THREE.ConeGeometry(0.03 * S, 0.25 * S, 5), chit, [0, 1.2 * S, 0]); } return b; });
    P.orb = glow(up, '#b060ff', 0.9, [0, 0.5 * S, 0.5 * S]);
  }, function (t, o) {
    const P = t.parts, tm = o.time + o.phase, strike = o.k > 0 ? Math.sin(o.k * Math.PI) : 0, wk = o.walk;
    P.legs.forEach((L) => { const ph = (L.i % 2 === 0 ? 0 : Math.PI) + (L.sd > 0 ? 0 : Math.PI), gs = o.speed > 0.2 ? Math.sin(wk * 1.6 + ph) : 0; L.up.rotation.z = 0.75 + Math.max(0, gs) * 0.3 + Math.sin(tm * 1.2 + L.i) * 0.02; L.root.rotation.x = gs * 0.2; });
    P.body.position.y = Math.sin(tm * 1.5) * 0.03;
    P.upper.rotation.x = -0.05 + Math.sin(tm * 1.1) * 0.04 - strike * 0.25;
    P.upper.rotation.y = Math.sin(tm * 0.8) * 0.12;
    P.arms.forEach((a, i) => { a.a.rotation.x = -0.3 - strike * 1.3 + Math.sin(tm * 1.3 + i) * 0.1; a.b.rotation.x = -0.8 + strike * 0.4; });
    P.backLegs.forEach((b, i) => { b.rotation.x = Math.sin(tm * 2 + i) * 0.12 - strike * 0.3; });
    P.orb.scale.setScalar(0.9 * (1 + strike * 1.6 + Math.sin(tm * 4) * 0.15));
  });

  // ======================================================================
  //  ④ 星杭の巫神（参考: 隠し部屋モンスター④）
  //  チェック項目: 宙に浮く背の高い人の形／白い鎧と、すそへ広がる長い白い板の衣／角のある白い仮面と長い白髪／
  //               胸に星空のような濃い紫の光／体のまわりをめぐる金の杭／紫の長い帯と、足もとに垂れる紫の触手
  // ======================================================================
  MON.register('starseer', function (std, g, P) {
    const white = std({ color: 0xe8e6f0, roughness: 0.35, metalness: 0.2, flatShading: true });
    const whiteD = std({ color: 0xb8b4c8, roughness: 0.4, metalness: 0.2, flatShading: true });
    const purple = std({ color: 0x4a2a8a, roughness: 0.6, side: THREE.DoubleSide });
    const purpleL = std({ color: 0x7a4ac8, roughness: 0.5, emissive: 0x2a0a6a, emissiveIntensity: 0.6, side: THREE.DoubleSide });
    const gold = std({ color: 0xf0c060, roughness: 0.3, metalness: 0.5, emissive: 0xa06810, emissiveIntensity: 0.9 });
    const star = std({ color: 0x2a1458, emissive: 0x6a3ad0, emissiveIntensity: 1.6, roughness: 0.2 });
    const hair = std({ color: 0xf2f0f6, roughness: 0.6, side: THREE.DoubleSide, flatShading: true });
    const S = 1.45;
    const body = pivot(g, 0, 0, 0); P.body = body;
    // すそへ広がる白い板の衣（輪に並べ、外へ反らせる）と紫の裏地
    P.panels = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2, pv = pivot(body, Math.sin(a) * 0.28 * S, 1.45 * S, Math.cos(a) * 0.22 * S); pv.rotation.y = a;
      add(pv, new THREE.BoxGeometry(0.22 * S, 1.25 * S, 0.03 * S), i % 2 ? white : whiteD, [0, -0.62 * S, 0.0]);
      add(pv, new THREE.BoxGeometry(0.2 * S, 1.2 * S, 0.02 * S), purple, [0, -0.62 * S, -0.025 * S]);
      pv.rotation.x = 0.32; P.panels.push(pv);
    }
    // 紫の触手（足もとに垂れる）
    P.tendrils = [];
    for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2, tp = pivot(body, Math.sin(a) * 0.12 * S, 0.5 * S, Math.cos(a) * 0.1 * S); add(tp, tube([[0, 0, 0], [Math.sin(a) * 0.1 * S, -0.3 * S, Math.cos(a) * 0.1 * S], [Math.sin(a) * 0.25 * S, -0.55 * S, Math.cos(a) * 0.3 * S], [Math.sin(a) * 0.45 * S, -0.7 * S, Math.cos(a) * 0.5 * S]], 0.035 * S, 10), purpleL); P.tendrils.push(tp); }
    // 胴: 白い鎧と、胸の星空
    add(body, new THREE.CylinderGeometry(0.2 * S, 0.16 * S, 0.7 * S, 10), white, [0, 1.75 * S, 0]);
    add(body, new THREE.SphereGeometry(0.26 * S, 12, 10), whiteD, [0, 2.12 * S, 0], null, [1.25, 0.75, 0.85]);
    add(body, new THREE.SphereGeometry(0.12 * S, 12, 10), star, [0, 2.0 * S, 0.14 * S], null, [1, 1.3, 0.5]);
    P.starGlow = glow(body, '#8a5aff', 1.4, [0, 2.0 * S, 0.22 * S]);
    [-1, 1].forEach((sd) => add(body, new THREE.ConeGeometry(0.16 * S, 0.32 * S, 6), white, [sd * 0.34 * S, 2.25 * S, 0], [0, 0, -sd * 1.2])); // 肩
    // 頭: 角のある白い仮面と、長い白髪
    const head = pivot(body, 0, 2.48 * S, 0.02 * S); P.head = head;
    add(head, new THREE.SphereGeometry(0.13 * S, 12, 10), whiteD);
    add(head, new THREE.BoxGeometry(0.2 * S, 0.24 * S, 0.06 * S), white, [0, 0.0, 0.11 * S]);
    [-1, 1].forEach((sd) => {
      add(head, new THREE.BoxGeometry(0.05 * S, 0.012 * S, 0.01 * S), star, [sd * 0.05 * S, 0.03 * S, 0.145 * S]);
      add(head, tube([[sd * 0.06 * S, 0.1 * S, 0.05 * S], [sd * 0.12 * S, 0.3 * S, 0.0], [sd * 0.1 * S, 0.5 * S, -0.08 * S]], 0.02 * S, 8), white);
    });
    for (let i = 0; i < 9; i++) { const a = (i / 8 - 0.5) * 2.6; add(head, new THREE.PlaneGeometry(0.07 * S, 1.1 * S), hair, [Math.sin(a) * 0.12 * S, -0.5 * S, -Math.cos(a) * 0.1 * S - 0.04 * S], [0.12, a, 0]); }
    // 腕（細い白い腕）
    P.arms = [-1, 1].map((sd) => { const L = limb(body, sd * 0.36 * S, 2.22 * S, 0, 0.45 * S, 0.42 * S, 0.045 * S, white, whiteD); L.a.rotation.z = sd * 0.5; return L; });
    // 紫の長い帯（肩から、体のまわりを流れる）
    P.ribbons = [-1, 1].map((sd) => { const rb = pivot(body, sd * 0.3 * S, 2.25 * S, -0.05 * S); add(rb, tube([[0, 0, 0], [sd * 0.4 * S, -0.2 * S, -0.3 * S], [sd * 0.65 * S, -0.7 * S, 0.1 * S], [sd * 0.55 * S, -1.3 * S, 0.4 * S], [sd * 0.75 * S, -1.8 * S, 0.1 * S]], 0.05 * S, 20), purpleL, null, null, [1, 1, 1]); return rb; });
    // まわりをめぐる金の杭
    P.ring = pivot(body, 0, 1.7 * S, 0);
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2, sp = pivot(P.ring, Math.cos(a) * 1.0 * S, Math.sin(i * 1.7) * 0.4 * S, Math.sin(a) * 1.0 * S); sp.rotation.set(0, -a, Math.PI / 2); add(sp, new THREE.ConeGeometry(0.06 * S, 0.42 * S, 6), gold, [0, 0.12 * S, 0]); add(sp, new THREE.CylinderGeometry(0.035 * S, 0.035 * S, 0.12 * S, 6), gold, [0, -0.15 * S, 0]); add(sp, new THREE.TorusGeometry(0.05 * S, 0.012 * S, 4, 8), gold, [0, -0.08 * S, 0], [Math.PI / 2, 0, 0]); }
  }, function (t, o) {
    const P = t.parts, tm = o.time + o.phase, strike = o.k > 0 ? Math.sin(o.k * Math.PI) : 0;
    P.body.position.y = 0.35 + Math.sin(tm * 1.2) * 0.15;
    P.ring.rotation.y += o.dt * (0.6 + strike * 4);
    P.ring.scale.setScalar(1 + strike * 0.25);
    P.panels.forEach((p, i) => { p.rotation.x = 0.32 + Math.sin(tm * 1.5 + i * 0.7) * 0.05; });
    P.tendrils.forEach((p, i) => { p.rotation.x = Math.sin(tm * 1.8 + i) * 0.25; p.rotation.z = Math.cos(tm * 1.4 + i * 1.3) * 0.2; });
    P.ribbons.forEach((r, i) => { r.rotation.x = Math.sin(tm * 1.3 + i) * 0.2; r.rotation.z = (i ? -1 : 1) * Math.sin(tm * 0.9 + i) * 0.15; });
    P.arms.forEach((a, i) => { a.a.rotation.x = -0.4 - strike * 1.4 + Math.sin(tm + i) * 0.08; });
    P.starGlow.scale.setScalar(1.4 * (1 + strike * 1.5 + Math.sin(tm * 3) * 0.15));
  });
})();
