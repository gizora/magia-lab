// ダンジョンの深い階の敵（第36版）: 大グモ・ゴブリン・ミミック・動く鎧・レイス・ガーゴイル・サラマンダー・イフリートと、
// 守護者のミノタウロス・リッチ・ドラゴン・氷の王。宝箱の見た目もここで作る。
// ユーザーが ゲーム素材/ に入れた参考の絵の特徴を、1 体ずつチェック項目にして作った（絵そのものはゲームに入れない）。雰囲気は「リアルでダーク」
(function () {
  'use strict';
  const MG = window.MG, MON = MG.Monsters, FX = MG.FX;
  if (!MON || !MON.register) return;
  const V3 = THREE.Vector3;
  const rand = (a, b) => a + Math.random() * (b - a);
  const { add, pivot, glow, jitter, tube } = MON.util;
  const rock = (r, d) => jitter(new THREE.DodecahedronGeometry(r, d || 0), r * 0.14);
  // 手足: 付け根（pivot）から -Y へ。上と下の 2 本（関節つき）
  function limb(parent, x, y, z, l1, l2, r, mat, mat2) {
    const a = pivot(parent, x, y, z);
    add(a, new THREE.CylinderGeometry(r * 0.85, r, l1, 8), mat, [0, -l1 / 2, 0]);
    add(a, new THREE.SphereGeometry(r * 1.05, 8, 6), mat);
    const b = pivot(a, 0, -l1, 0);
    add(b, new THREE.CylinderGeometry(r * 0.7, r * 0.85, l2, 8), mat2 || mat, [0, -l2 / 2, 0]);
    add(b, new THREE.SphereGeometry(r * 0.9, 8, 6), mat2 || mat);
    const end = pivot(b, 0, -l2, 0);
    return { a, b, end };
  }
  // 膜の翼（コウモリ型）: 付け根から +X（右）へ。sd で左右
  function wing(parent, sd, span, mat, bone) {
    const root = pivot(parent, 0, 0, 0);
    const s = new THREE.Shape(); s.moveTo(0, 0);
    const tips = [[0.25, 1.0], [0.62, 0.92], [0.92, 0.55], [1.0, 0.12]];
    s.lineTo(span * 0.35, span * 0.18);
    tips.forEach(([u, v], i) => { s.lineTo(span * u, span * v * 0.55); if (i < tips.length - 1) s.quadraticCurveTo(span * (u + tips[i + 1][0]) / 2 - span * 0.05, span * (v + tips[i + 1][1]) / 2 * 0.55 - span * 0.12, span * tips[i + 1][0], span * tips[i + 1][1] * 0.55); });
    s.quadraticCurveTo(span * 0.5, -span * 0.1, 0, -span * 0.08); s.lineTo(0, 0);
    const m = add(root, new THREE.ShapeGeometry(s, 8), mat, null, [0, 0, 0]);
    m.scale.x = sd;
    tips.forEach(([u, v]) => { const len = Math.hypot(u, v * 0.55) * span; const f = add(root, new THREE.CylinderGeometry(span * 0.008, span * 0.016, len, 5), bone, [sd * span * u / 2 * 0.98, span * v * 0.55 / 2 + span * 0.04, 0.01]); f.rotation.z = -Math.atan2(sd * u, v * 0.55); });
    add(root, new THREE.CylinderGeometry(span * 0.02, span * 0.028, span * 0.4, 6), bone, [sd * span * 0.17, span * 0.09, 0.01], [0, 0, -sd * 1.1]);
    return root;
  }

  // ======================================================================
  //  宝箱（参考: 鉄の帯と鋲を打った、黒ずんだ木の宝箱）
  //  チェック項目: 丸い蓋／黒ずんだ木の板目／鉄の帯と鋲／正面の錠前の板と鍵穴／横の輪の取っ手
  // ======================================================================
  function chestBody(std, g, P, mouth) {
    const wood = std({ color: 0x4a3626, roughness: 0.85 });
    const woodD = std({ color: 0x2e2218, roughness: 0.9 });
    const iron = std({ color: 0x2a2a2c, roughness: 0.45, metalness: 0.4 });
    const rivet = std({ color: 0x5a5a5e, roughness: 0.35, metalness: 0.4 });
    const W = 1.3, H = 0.72, Dp = 0.86;
    add(g, new THREE.BoxGeometry(W, H, Dp), wood, [0, H / 2, 0]);
    for (let i = 1; i < 5; i++) add(g, new THREE.BoxGeometry(W + 0.005, 0.012, Dp + 0.005), woodD, [0, (H / 5) * i, 0]); // 板の継ぎ目
    // 蓋（後ろの辺で開く）: 半円筒の丸い蓋
    const lid = pivot(g, 0, H, -Dp / 2); P.lid = lid;
    const lg = new THREE.CylinderGeometry(Dp / 2, Dp / 2, W, 16, 1, false, 0, Math.PI); lg.rotateZ(Math.PI / 2); lg.rotateY(Math.PI / 2);
    add(lid, lg, wood, [0, 0, Dp / 2], [0, 0, 0], [1, 0.62, 1]);
    // 鉄の帯（本体と蓋）と鋲
    [-0.5, -0.17, 0.17, 0.5].forEach((x) => {
      add(g, new THREE.BoxGeometry(0.07, H + 0.01, Dp + 0.02), iron, [x * W, H / 2, 0]);
      add(lid, new THREE.TorusGeometry(Dp / 2 + 0.008, 0.03, 4, 16, Math.PI), iron, [x * W, 0, Dp / 2], [0, Math.PI / 2, 0], [1, 0.62, 1]);
      for (let k = 0; k < 3; k++) add(g, new THREE.SphereGeometry(0.018, 6, 4), rivet, [x * W, 0.12 + k * 0.24, Dp / 2 + 0.012]);
    });
    add(g, new THREE.BoxGeometry(W + 0.02, 0.06, Dp + 0.02), iron, [0, 0.03, 0]);
    add(g, new THREE.BoxGeometry(W + 0.02, 0.05, Dp + 0.02), iron, [0, H - 0.025, 0]);
    // 錠前と鍵穴、輪の取っ手
    add(g, new THREE.BoxGeometry(0.2, 0.26, 0.04), iron, [0, H - 0.1, Dp / 2 + 0.02]);
    add(g, new THREE.CylinderGeometry(0.018, 0.018, 0.05, 8), std({ color: 0x050505 }), [0, H - 0.1, Dp / 2 + 0.04], [Math.PI / 2, 0, 0]);
    [-1, 1].forEach((sd) => { add(g, new THREE.TorusGeometry(0.09, 0.015, 6, 16), iron, [sd * (W / 2 + 0.02), H * 0.55, 0], [0, Math.PI / 2, 0]); add(g, new THREE.BoxGeometry(0.03, 0.08, 0.08), iron, [sd * (W / 2 + 0.01), H * 0.68, 0]); });
    if (mouth) {
      // ミミック: 中は赤黒い口、ふちに並ぶ牙、長い舌、奥に光る目
      const flesh = std({ color: 0x3a0608, roughness: 0.6, emissive: 0x200000, emissiveIntensity: 0.5 });
      const tooth = std({ color: 0xe8e0c8, roughness: 0.4 });
      const tongue = std({ color: 0xa8303a, roughness: 0.45, emissive: 0x300008, emissiveIntensity: 0.4 });
      add(g, new THREE.BoxGeometry(W - 0.1, 0.05, Dp - 0.1), flesh, [0, H - 0.04, 0]);
      add(lid, new THREE.BoxGeometry(W - 0.1, 0.04, Dp - 0.1), flesh, [0, 0.02, Dp / 2]);
      for (let i = 0; i < 9; i++) {
        const x = -W / 2 + 0.1 + i * ((W - 0.2) / 8);
        add(g, new THREE.ConeGeometry(0.035, 0.13, 4), tooth, [x, H + 0.05, Dp / 2 - 0.06]);
        add(lid, new THREE.ConeGeometry(0.035, 0.13, 4), tooth, [x, -0.05, Dp - 0.06], [Math.PI, 0, 0]);
      }
      [-1, 1].forEach((sd) => { for (let i = 0; i < 4; i++) { add(g, new THREE.ConeGeometry(0.03, 0.11, 4), tooth, [sd * (W / 2 - 0.06), H + 0.04, -Dp / 2 + 0.15 + i * 0.18]); } });
      const tg = pivot(g, 0, H - 0.02, 0.1); P.tongue = tg;
      add(tg, tube([[0, 0, 0], [0, 0.05, 0.25], [0, 0.02, 0.5], [0, -0.12, 0.72]], 0.07, 12), tongue, null, null, [1.6, 0.6, 1]);
      [-1, 1].forEach((sd) => { add(lid, new THREE.SphereGeometry(0.035, 8, 6), std({ color: 0xffd040, emissive: 0xffa000, emissiveIntensity: 2 }), [sd * 0.25, -0.06, Dp / 2]); });
      P.eyesGlow = glow(lid, '#ffb000', 0.3, [0, -0.08, Dp / 2]);
    }
  }
  MON.chest = function (mats) {
    const g = new THREE.Group(), P = {};
    const std = (o) => { const m = new THREE.MeshStandardMaterial(o); m.color.convertSRGBToLinear(); m.emissive.convertSRGBToLinear(); if (mats) mats.push(m); return m; };
    chestBody(std, g, P, false);
    MON.util.bake(g, P);
    return { g, lid: P.lid };
  };

  // ======================================================================
  //  大グモ（参考: 長い脚の大きなクモ）
  //  チェック項目: 大きな腹と小さな頭胸部／8 本の節のある長い脚／赤く光る 8 つの目と牙／毛深い暗い体と、脚の明るい縞
  // ======================================================================
  MON.register('spider', function (std, g, P) {
    const fur = std({ color: 0x2e2620, roughness: 1, flatShading: true });
    const furL = std({ color: 0x6a5a48, roughness: 1, flatShading: true });
    const shell = std({ color: 0x1e1a16, roughness: 0.5, metalness: 0.1 });
    const eyeM = std({ color: 0xff2020, emissive: 0xff1010, emissiveIntensity: 2.2 });
    const fang = std({ color: 0x0a0806, roughness: 0.3 });
    const body = pivot(g, 0, 0.62, 0); P.body = body;
    add(body, jitter(new THREE.IcosahedronGeometry(0.55, 2), 0.04), fur, [0, 0.12, -0.62], null, [1, 0.85, 1.25]);
    for (let i = 0; i < 5; i++) add(body, new THREE.SphereGeometry(0.06, 6, 4), furL, [0, 0.55 - i * 0.02, -0.35 - i * 0.18], null, [2.2 - i * 0.2, 0.4, 0.8]); // 腹の模様
    add(body, jitter(new THREE.IcosahedronGeometry(0.3, 1), 0.02), shell, [0, 0, 0.1], null, [1, 0.7, 1.1]);
    const head = pivot(body, 0, 0.02, 0.38); P.head = head;
    add(head, new THREE.SphereGeometry(0.18, 12, 10), shell, null, null, [1.1, 0.8, 0.9]);
    [[-0.07, 0.08], [0.07, 0.08], [-0.12, 0.04], [0.12, 0.04], [-0.04, 0.12], [0.04, 0.12], [-0.15, 0.0], [0.15, 0.0]].forEach(([x, y], i) => add(head, new THREE.SphereGeometry(i < 2 ? 0.035 : 0.022, 8, 6), eyeM, [x, y, 0.15]));
    glow(head, '#ff2020', 0.4, [0, 0.08, 0.2]);
    P.fangs = [-1, 1].map((sd) => { const f = pivot(head, sd * 0.06, -0.06, 0.14); add(f, new THREE.ConeGeometry(0.035, 0.2, 5), fang, [0, -0.08, 0.02], [Math.PI - 0.3, 0, 0]); return f; });
    P.legs = [];
    for (let i = 0; i < 4; i++) [-1, 1].forEach((sd) => {
      const z = 0.22 - i * 0.14, root = pivot(body, sd * 0.2, 0, z);
      const phi = 0.75 - i * 0.55, dx = sd * Math.cos(phi), dz = Math.sin(phi); // 脚の向き（前の脚は前へ、後ろの脚は後ろへ開く）
      root.rotation.y = Math.atan2(dz, -dx); // 回したあとの -X が、脚の向きになる
      const up = pivot(root, 0, 0, 0); up.rotation.z = 0.9; // 上へ持ち上がって
      add(up, new THREE.CylinderGeometry(0.035, 0.045, 0.75, 6), fur, [0, 0.375, 0]);
      const knee = pivot(up, 0, 0.75, 0); knee.rotation.z = 1.5; // ひざで外へ折れ、床へ下りる
      add(knee, new THREE.SphereGeometry(0.05, 6, 4), furL);
      add(knee, new THREE.CylinderGeometry(0.022, 0.035, 1.3, 6), fur, [0, 0.65, 0]);
      for (let k = 0; k < 3; k++) add(knee, new THREE.CylinderGeometry(0.037, 0.037, 0.06, 6), furL, [0, 0.3 + k * 0.35, 0]);
      P.legs.push({ root, up, knee, sd, i });
    });
  }, function (t, o) {
    const P = t.parts, tm = o.time + o.phase, strike = o.k > 0 ? Math.sin(o.k * Math.PI) : 0;
    const gait = o.speed > 0.2 ? o.walk * 1.6 : 0;
    P.legs.forEach((L) => { const ph = (L.i % 2 === 0 ? 0 : Math.PI) + (L.sd > 0 ? 0 : Math.PI); L.up.rotation.z = 0.9 + Math.max(0, Math.sin(gait + ph)) * 0.35 + (L.i === 0 ? strike * 0.9 : 0); L.root.rotation.x = Math.sin(gait + ph) * 0.25; });
    P.body.position.y = 0.62 + Math.abs(Math.sin(gait)) * 0.04 + Math.sin(tm * 2) * 0.01;
    P.fangs.forEach((f, i) => { f.rotation.z = (i ? -1 : 1) * (0.15 + strike * 0.5 + Math.max(0, Math.sin(tm * 6)) * 0.05); });
    P.head.rotation.x = -strike * 0.3;
  });

  // ======================================================================
  //  ゴブリン（参考: 角の兜と手斧の小鬼）
  //  チェック項目: 緑がかった肌の小柄で前かがみの体／とがった大きな耳と黄色い目、牙の口／角のついた革と鉄の兜／
  //               胸に X 字の革帯と鋲、赤茶の腰布、だぶだぶのズボンと革の長靴／手斧
  // ======================================================================
  MON.register('goblin', function (std, g, P) {
    const skin = std({ color: 0x5e7444, roughness: 0.75 });
    const skinD = std({ color: 0x42542e, roughness: 0.8 });
    const leather = std({ color: 0x5a3a22, roughness: 0.85 });
    const iron = std({ color: 0x4a4a4e, roughness: 0.45, metalness: 0.4 });
    const horn = std({ color: 0xd8d0b8, roughness: 0.5 });
    const cloth = std({ color: 0x7a2e22, roughness: 1 });
    const pants = std({ color: 0x8a7e66, roughness: 1 });
    const eyeM = std({ color: 0xffd040, emissive: 0xc08000, emissiveIntensity: 1.2 });
    const tooth = std({ color: 0xece4cc, roughness: 0.4 });
    const body = pivot(g, 0, 0, 0); P.body = body;
    const torso = pivot(body, 0, 0.78, 0); torso.rotation.x = 0.25; P.torso = torso; // 前かがみ
    add(torso, new THREE.SphereGeometry(0.24, 12, 10), skin, [0, 0.2, 0], null, [1, 1.15, 0.85]);
    add(torso, new THREE.SphereGeometry(0.22, 12, 10), skin, [0, -0.02, 0.02], null, [1.05, 0.8, 0.9]);
    [-1, 1].forEach((sd) => add(torso, new THREE.BoxGeometry(0.06, 0.62, 0.02), leather, [0, 0.2, 0.2], [0.05, 0, sd * 0.62])); // X 字の革帯
    for (let i = 0; i < 6; i++) add(torso, new THREE.SphereGeometry(0.014, 5, 4), iron, [(i % 2 ? 1 : -1) * (0.04 + Math.floor(i / 2) * 0.06), 0.2 + (Math.floor(i / 2) - 1) * 0.08, 0.215]);
    add(torso, new THREE.CylinderGeometry(0.24, 0.26, 0.12, 12), cloth, [0, -0.17, 0]);
    add(torso, new THREE.BoxGeometry(0.14, 0.28, 0.02), cloth, [0.1, -0.33, 0.2], [0.1, 0, 0.15]);
    // 頭: 大きな耳・黄色い目・牙・角の兜
    const head = pivot(torso, 0, 0.46, 0.04); P.head = head;
    add(head, new THREE.SphereGeometry(0.17, 14, 12), skin, [0, 0.03, 0.02], null, [1.05, 1, 1.05]);
    add(head, new THREE.ConeGeometry(0.05, 0.12, 6), skin, [0, -0.01, 0.18], [Math.PI / 2, 0, 0]);
    [-1, 1].forEach((sd) => {
      add(head, new THREE.ConeGeometry(0.06, 0.3, 4), skin, [sd * 0.2, 0.03, -0.02], [0, 0, -sd * 1.25], [1, 1, 0.35]);
      add(head, new THREE.SphereGeometry(0.038, 10, 8), eyeM, [sd * 0.065, 0.05, 0.15], null, [1.2, 0.8, 0.6]);
      add(head, new THREE.SphereGeometry(0.016, 6, 4), std({ color: 0x050505 }), [sd * 0.065, 0.05, 0.172]);
      add(head, new THREE.ConeGeometry(0.014, 0.05, 4), tooth, [sd * 0.05, -0.06, 0.15], [0, 0, 0]);
    });
    add(head, new THREE.BoxGeometry(0.14, 0.03, 0.02), std({ color: 0x1a0806 }), [0, -0.07, 0.16]);
    add(head, new THREE.SphereGeometry(0.19, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), leather, [0, 0.07, 0], null, [1, 0.85, 1.05]);
    add(head, new THREE.TorusGeometry(0.19, 0.022, 5, 18), iron, [0, 0.075, 0], [Math.PI / 2, 0, 0]);
    for (let i = 0; i < 3; i++) add(head, new THREE.ConeGeometry(0.025, 0.06, 6), iron, [0, 0.16 + i * 0.0, 0.12 - i * 0.12]);
    [-1, 1].forEach((sd) => add(head, tube([[sd * 0.15, 0.14, 0], [sd * 0.26, 0.24, 0.02], [sd * 0.3, 0.38, 0.05]], 0.03, 8), horn));
    // 腕と脚
    P.arms = [1, -1].map((sd) => { const L = limb(torso, sd * 0.27, 0.32, 0, 0.26, 0.24, 0.05, skin, skinD); L.a.rotation.z = sd * 0.15; return L; });
    add(P.arms[0].end, new THREE.SphereGeometry(0.055, 8, 6), skinD);
    const axe = pivot(P.arms[0].end, 0, -0.02, 0); axe.rotation.x = Math.PI / 2 + 0.3; P.axe = axe;
    add(axe, new THREE.CylinderGeometry(0.018, 0.022, 0.62, 6), leather, [0, 0.12, 0]);
    const blade = new THREE.Shape(); blade.moveTo(0, 0); blade.lineTo(0.2, 0.06); blade.quadraticCurveTo(0.26, -0.08, 0.2, -0.22); blade.lineTo(0, -0.12); blade.closePath();
    add(axe, new THREE.ExtrudeGeometry(blade, { depth: 0.015, bevelEnabled: false }), iron, [0.01, 0.42, -0.008], [0, 0, 0]);
    P.legs = [1, -1].map((sd) => { const L = limb(body, sd * 0.13, 0.62, 0, 0.3, 0.3, 0.075, pants, leather); add(L.end, new THREE.BoxGeometry(0.12, 0.08, 0.2), leather, [0, 0.02, 0.04]); add(L.a, new THREE.SphereGeometry(0.11, 8, 6), pants, [0, -0.15, 0], null, [1, 1.3, 1]); return L; });
  }, function (t, o) {
    const P = t.parts, sw = o.sw, k = o.k, tm = o.time + o.phase;
    P.legs[0].a.rotation.x = sw * 0.6; P.legs[1].a.rotation.x = -sw * 0.6;
    P.legs[0].b.rotation.x = Math.max(0, -sw) * 0.8; P.legs[1].b.rotation.x = Math.max(0, sw) * 0.8;
    const lift = k > 0 ? (k < 0.6 ? k / 0.6 : 1 - (k - 0.6) / 0.4 * 1.7) : 0;
    P.arms[0].a.rotation.x = -sw * 0.4 - lift * 2.6; P.arms[0].b.rotation.x = -0.4 - lift * 0.4;
    P.arms[1].a.rotation.x = sw * 0.5; P.arms[1].b.rotation.x = -0.5;
    P.body.position.y = Math.abs(sw) * 0.05; P.head.rotation.y = Math.sin(tm * 0.9) * 0.25; P.head.rotation.x = -0.15;
  });

  // ======================================================================
  //  ミミック（参考: 舌を出した宝箱の怪物）。ふだんは宝箱と同じ見た目で、近づくと口を開けて正体を現す
  // ======================================================================
  MON.register('mimic', function (std, g, P) {
    chestBody(std, g, P, true);
    P.body = g;
  }, function (t, o) {
    const P = t.parts, tm = o.time + o.phase, strike = o.k > 0 ? Math.sin(o.k * Math.PI) : 0;
    const awake = t.awake ? 1 : 0;
    t._open = (t._open || 0) + ((awake ? 1 : 0) - (t._open || 0)) * Math.min(1, o.dt * 6);
    const chomp = awake ? Math.abs(Math.sin(tm * 5)) * 0.25 + strike * 0.6 : 0;
    P.lid.rotation.x = -(t._open * 0.75 + chomp);
    P.tongue.visible = t._open > 0.3; P.tongue.rotation.x = Math.sin(tm * 4) * 0.25 - strike * 0.4; P.tongue.scale.z = 0.3 + t._open * 0.7 + strike * 0.5;
    P.eyesGlow.visible = t._open > 0.3;
    if (awake) { P.body.position.y = Math.abs(Math.sin(o.walk * 1.6)) * 0.12; P.body.rotation.z = Math.sin(o.walk * 1.6) * 0.06; }
  });

  // ======================================================================
  //  動く鎧（参考: 青い装飾の鎧の騎士と大盾）
  //  チェック項目: 中身のない青い鋼の全身鎧と銀の縁飾り／兜のすき間に青白く光る目／赤いマント／縦長の大盾と長剣／とがったつま先
  // ======================================================================
  MON.register('armor', function (std, g, P) {
    const steel = std({ color: 0x34508a, roughness: 0.28, metalness: 0.4 });
    const steelD = std({ color: 0x1e2c4c, roughness: 0.35, metalness: 0.4 });
    const silver = std({ color: 0xc8ccd4, roughness: 0.25, metalness: 0.4 });
    const capeM = std({ color: 0x8a1018, roughness: 0.9, side: THREE.DoubleSide });
    const eyeM = std({ color: 0x9ad8ff, emissive: 0x5ab8ff, emissiveIntensity: 2.4 });
    const voidM = std({ color: 0x020206 });
    const body = pivot(g, 0, 0, 0); P.body = body;
    const torso = pivot(body, 0, 1.15, 0); P.torso = torso;
    add(torso, new THREE.CylinderGeometry(0.3, 0.24, 0.55, 12), steel, [0, 0.28, 0], null, [1.1, 1, 0.75]);
    add(torso, new THREE.SphereGeometry(0.29, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), steel, [0, 0.52, 0], null, [1.12, 0.5, 0.8]);
    add(torso, new THREE.BoxGeometry(0.06, 0.45, 0.04), silver, [0, 0.3, 0.2]);
    [-1, 1].forEach((sd) => add(torso, new THREE.TorusGeometry(0.12, 0.012, 5, 14, Math.PI), silver, [sd * 0.13, 0.36, 0.2], [0, 0, sd > 0 ? 0.4 : Math.PI - 0.4]));
    for (let i = 0; i < 3; i++) add(torso, new THREE.CylinderGeometry(0.25 - i * 0.01, 0.26 - i * 0.01, 0.07, 12), i % 2 ? steelD : steel, [0, -0.02 - i * 0.07, 0], null, [1.08, 1, 0.78]);
    [-1, 1].forEach((sd) => { add(torso, new THREE.CylinderGeometry(0.13, 0.2, 0.3, 10, 1, true), steel, [sd * 0.12, -0.3, 0.04], [0.1, 0, sd * 0.15]); });
    // 兜: 目のすき間から青白い光（中は空っぽ）
    const head = pivot(torso, 0, 0.62, 0); P.head = head;
    add(head, new THREE.SphereGeometry(0.17, 16, 12), steel, [0, 0.1, 0], null, [0.95, 1.15, 1.05]);
    add(head, new THREE.BoxGeometry(0.2, 0.035, 0.04), voidM, [0, 0.12, 0.165]);
    [-1, 1].forEach((sd) => { add(head, new THREE.SphereGeometry(0.018, 6, 4), eyeM, [sd * 0.05, 0.12, 0.17]); });
    glow(head, '#7ac8ff', 0.3, [0, 0.12, 0.2]);
    add(head, new THREE.BoxGeometry(0.03, 0.26, 0.02), silver, [0, 0.12, 0.18]);
    add(head, new THREE.ConeGeometry(0.05, 0.22, 6), silver, [0, 0.36, -0.02]);
    [-1, 1].forEach((sd) => add(head, new THREE.ConeGeometry(0.035, 0.18, 5), silver, [sd * 0.14, 0.28, -0.02], [0, 0, -sd * 0.6]));
    // 肩当て
    [-1, 1].forEach((sd) => { add(torso, new THREE.SphereGeometry(0.17, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), steel, [sd * 0.36, 0.5, 0], [0, 0, -sd * 0.5], [1.2, 0.9, 1.2]); add(torso, new THREE.TorusGeometry(0.17, 0.012, 4, 16), silver, [sd * 0.36, 0.5, 0], [Math.PI / 2, 0, -sd * 0.5], [1.2, 1.2, 1]); add(torso, new THREE.ConeGeometry(0.03, 0.16, 5), silver, [sd * 0.44, 0.62, 0], [0, 0, -sd * 0.7]); });
    // 赤いマント（背中）
    const cape = pivot(torso, 0, 0.55, -0.2); P.cape = cape;
    const cg = new THREE.PlaneGeometry(0.75, 1.45, 4, 8), ca = cg.attributes.position;
    for (let i = 0; i < ca.count; i++) { const y = ca.getY(i), x = ca.getX(i); ca.setZ(i, -Math.cos(x * 4) * 0.04 - (0.725 - y) * 0.12); if (y < -0.6) ca.setY(i, y - Math.random() * 0.06); }
    cg.translate(0, -0.725, 0); cg.computeVertexNormals();
    add(cape, cg, capeM);
    // 腕: 籠手。右手に長剣、左手に大盾
    P.arms = [1, -1].map((sd) => { const L = limb(torso, sd * 0.38, 0.42, 0, 0.32, 0.3, 0.075, steel, steelD); add(L.end, new THREE.BoxGeometry(0.1, 0.12, 0.1), steelD, [0, -0.02, 0]); return L; });
    const sw = pivot(P.arms[0].end, 0, -0.05, 0.02); sw.rotation.x = Math.PI / 2 + 0.25; P.sword = sw;
    add(sw, new THREE.CylinderGeometry(0.02, 0.022, 0.22, 8), steelD, [0, -0.02, 0]);
    add(sw, new THREE.BoxGeometry(0.3, 0.035, 0.05), silver, [0, 0.1, 0]);
    add(sw, new THREE.BoxGeometry(0.065, 1.05, 0.015), silver, [0, 0.64, 0]);
    add(sw, new THREE.ConeGeometry(0.033, 0.12, 4), silver, [0, 1.22, 0], [0, Math.PI / 4, 0], [1, 1, 0.22]);
    const sh = new THREE.Shape(); sh.moveTo(-0.27, 0.6); sh.quadraticCurveTo(0, 0.72, 0.27, 0.6); sh.lineTo(0.27, -0.45); sh.quadraticCurveTo(0, -0.72, -0.27, -0.45); sh.closePath();
    const shield = pivot(P.arms[1].end, -0.14, 0, 0.12); shield.rotation.set(1.55, -0.6, 0); P.shield = shield;
    add(shield, new THREE.ExtrudeGeometry(sh, { depth: 0.04, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 2, curveSegments: 10 }), steel);
    add(shield, new THREE.BoxGeometry(0.05, 1.1, 0.02), silver, [0, 0.05, 0.06]); add(shield, new THREE.BoxGeometry(0.4, 0.05, 0.02), silver, [0, 0.25, 0.06]);
    add(shield, new THREE.SphereGeometry(0.06, 10, 8), silver, [0, 0.25, 0.07]);
    // 脚: すね当てと、とがったつま先
    P.legs = [1, -1].map((sd) => { const L = limb(body, sd * 0.14, 0.95, 0, 0.46, 0.44, 0.085, steel, steelD); add(L.end, new THREE.ConeGeometry(0.07, 0.28, 6), steelD, [0, 0.03, 0.1], [Math.PI / 2, 0, 0], [1.1, 1, 0.6]); add(L.b, new THREE.SphereGeometry(0.075, 8, 6), silver, [0, 0, 0.05]); return L; });
  }, function (t, o) {
    const P = t.parts, sw = o.sw, k = o.k, tm = o.time + o.phase;
    P.legs[0].a.rotation.x = sw * 0.5; P.legs[1].a.rotation.x = -sw * 0.5; P.legs[0].b.rotation.x = Math.max(0, -sw) * 0.6; P.legs[1].b.rotation.x = Math.max(0, sw) * 0.6;
    const lift = k > 0 ? (k < 0.6 ? k / 0.6 : 1 - (k - 0.6) / 0.4 * 1.6) : 0;
    P.arms[0].a.rotation.x = -sw * 0.3 - lift * 2.5; P.arms[0].b.rotation.x = -0.3 - lift * 0.5;
    P.arms[1].a.rotation.x = -0.6 + sw * 0.2; P.arms[1].b.rotation.x = -1.0;
    P.cape.rotation.x = 0.1 + Math.abs(sw) * 0.25 + Math.sin(tm * 1.7) * 0.05;
    P.body.position.y = Math.abs(sw) * 0.04;
  });

  // ======================================================================
  //  レイス（参考: フードとマフラーの、宙に浮く黒い亡霊）
  //  チェック項目: 脚のない、すそがちぎれて流れる黒い外套／フードの闇に紫に光る目／首のぼろ布のマフラー／長い黒いかぎ爪の手
  // ======================================================================
  MON.register('wraith', function (std, g, P) {
    const cloth = std({ color: 0x14101c, roughness: 0.95, side: THREE.DoubleSide, transparent: true, opacity: 0.95 });
    const clothL = std({ color: 0x2e2640, roughness: 0.9, side: THREE.DoubleSide });
    const scarf = std({ color: 0x6a5e50, roughness: 1, side: THREE.DoubleSide });
    const trim = std({ color: 0x8a7030, roughness: 0.4, metalness: 0.6 });
    const claw = std({ color: 0x0c0a10, roughness: 0.3, metalness: 0.4 });
    const eyeM = std({ color: 0xc8a0ff, emissive: 0x9a60ff, emissiveIntensity: 2.6 });
    const body = pivot(g, 0, 0, 0); P.body = body;
    // 外套: 上から下へ広がり、すそは長くちぎれて流れる
    const prof = [[0.001, 0.95], [0.18, 0.9], [0.32, 0.6], [0.4, 0.1], [0.46, -0.5], [0.5, -1.2]].map(([r, y]) => new THREE.Vector2(r, y));
    const rg = new THREE.LatheGeometry(prof, 20), pa = rg.attributes.position;
    for (let i = 0; i < pa.count; i++) { const y = pa.getY(i); if (y < -0.4) { const a = Math.atan2(pa.getZ(i), pa.getX(i)); pa.setY(i, y - Math.abs(Math.sin(a * 3.5)) * 0.7 - rand(0, 0.15)); pa.setZ(i, pa.getZ(i) - (y < -1 ? 0.25 : 0)); } }
    rg.computeVertexNormals();
    P.robe = add(body, rg, cloth);
    add(body, new THREE.LatheGeometry(prof.map((v) => new THREE.Vector2(v.x * 0.9, v.y * 0.98)), 16), clothL, [0, 0.01, 0]);
    // 流れる尾（後ろへたなびく布）
    P.tails = [-1, 0, 1].map((sd) => { const p = pivot(body, sd * 0.2, -0.6, -0.25); const geo = new THREE.PlaneGeometry(0.22, 1.1, 1, 6); geo.translate(0, -0.55, 0); add(p, geo, cloth, null, [0.6, 0, sd * 0.2]); return p; });
    // フードとマフラー
    const head = pivot(body, 0, 1.05, 0.04); P.head = head;
    add(head, new THREE.SphereGeometry(0.2, 16, 12, Math.PI * 0.62, Math.PI * 1.76), cloth, null, null, [1, 1.2, 1.1]);
    add(head, new THREE.ConeGeometry(0.1, 0.22, 8), cloth, [0, 0.2, -0.1], [-0.7, 0, 0]);
    add(head, new THREE.TorusGeometry(0.17, 0.012, 4, 16, Math.PI * 1.2), trim, [0, 0.0, 0.12], [0, 0, Math.PI * -0.1]);
    add(head, new THREE.SphereGeometry(0.16, 12, 10), std({ color: 0x010102 }), [0, -0.02, 0.02]);
    [-1, 1].forEach((sd) => { add(head, new THREE.SphereGeometry(0.022, 8, 6), eyeM, [sd * 0.055, 0.0, 0.15], [0, 0, sd * 0.3], [1.5, 0.6, 1]); glow(head, '#a070ff', 0.3, [sd * 0.055, 0, 0.18]); });
    const sc = new THREE.TorusGeometry(0.2, 0.07, 6, 16); add(body, jitter(sc, 0.02), scarf, [0, 0.88, 0.02], [Math.PI / 2 + 0.2, 0, 0], [1, 1.1, 1]);
    add(body, new THREE.PlaneGeometry(0.12, 0.6, 1, 4), scarf, [0.15, 0.6, -0.18], [0.3, 0.3, 0.2]);
    // 腕: 袖と長いかぎ爪の手
    P.arms = [1, -1].map((sd) => {
      const sh = pivot(body, sd * 0.3, 0.75, 0.05);
      add(sh, new THREE.CylinderGeometry(0.06, 0.13, 0.5, 8, 1, true), cloth, [0, -0.25, 0]);
      const hand = pivot(sh, 0, -0.5, 0);
      add(hand, new THREE.BoxGeometry(0.06, 0.06, 0.05), claw);
      for (let i = 0; i < 4; i++) add(hand, new THREE.ConeGeometry(0.012, 0.28, 4), claw, [-0.03 + i * 0.02, -0.15, 0.05], [0.5, 0, 0]);
      return { sh, hand };
    });
  }, function (t, o) {
    const P = t.parts, tm = o.time + o.phase, strike = o.k > 0 ? Math.sin(o.k * Math.PI) : 0;
    P.body.position.y = Math.sin(tm * 1.5) * 0.08;
    P.robe.rotation.y = Math.sin(tm * 1.1) * 0.1;
    P.tails.forEach((p, i) => { p.rotation.x = 0.5 + Math.sin(tm * 2.2 + i) * 0.25; p.rotation.z = Math.sin(tm * 1.8 + i * 2) * 0.2; });
    P.arms.forEach((a, i) => { a.sh.rotation.x = -0.9 - strike * 0.9 + Math.sin(tm * 1.3 + i) * 0.12; a.sh.rotation.z = (i ? -1 : 1) * (0.3 + strike * 0.4); });
  });

  // ======================================================================
  //  ガーゴイル（参考: 翼と角のある石像の悪魔）
  //  チェック項目: 灰色の石の体（前かがみ）／2 本の角と牙のある顔、光る目／石の膜の大きな翼／かぎ爪の手足としっぽ
  // ======================================================================
  MON.register('gargoyle', function (std, g, P) {
    const stone = std({ color: 0x6e6c68, roughness: 0.95, flatShading: true });
    const stoneD = std({ color: 0x4a4846, roughness: 1, flatShading: true });
    const memb = std({ color: 0x5a5856, roughness: 0.95, side: THREE.DoubleSide, flatShading: true });
    const eyeM = std({ color: 0xffa030, emissive: 0xff7010, emissiveIntensity: 2.2 });
    const body = pivot(g, 0, 0, 0); P.body = body;
    add(body, rock(0.32, 1), stone, [0, 0.05, 0], [0.4, 0, 0], [1, 1.2, 0.9]);
    add(body, rock(0.26, 1), stone, [0, -0.28, 0.05], null, [1.1, 0.8, 0.9]);
    const head = pivot(body, 0, 0.36, 0.2); P.head = head;
    add(head, rock(0.19, 1), stone, null, null, [1.1, 0.95, 1]);
    add(head, new THREE.BoxGeometry(0.22, 0.09, 0.1), stoneD, [0, -0.08, 0.14]);
    [-1, 1].forEach((sd) => {
      add(head, tube([[sd * 0.1, 0.12, 0], [sd * 0.2, 0.25, -0.05], [sd * 0.16, 0.4, -0.15]], 0.035, 8), stoneD);
      add(head, new THREE.SphereGeometry(0.03, 8, 6), eyeM, [sd * 0.07, 0.03, 0.17]); glow(head, '#ff8020', 0.22, [sd * 0.07, 0.03, 0.2]);
      add(head, new THREE.ConeGeometry(0.015, 0.06, 4), std({ color: 0xd8d0c0 }), [sd * 0.05, -0.12, 0.19], [Math.PI, 0, 0]);
      add(head, new THREE.ConeGeometry(0.05, 0.12, 4), stone, [sd * 0.18, 0.02, -0.02], [0, 0, -sd * 1.2]);
    });
    P.wings = [1, -1].map((sd) => { const w = wing(body, sd, 1.3, memb, stoneD); w.position.set(sd * 0.18, 0.2, -0.15); w.rotation.set(0.25, sd * 0.35, 0); return w; });
    P.arms = [1, -1].map((sd) => { const L = limb(body, sd * 0.3, 0.12, 0.08, 0.26, 0.26, 0.055, stone, stoneD); for (let i = 0; i < 3; i++) add(L.end, new THREE.ConeGeometry(0.014, 0.09, 4), stoneD, [-0.025 + i * 0.025, -0.05, 0.02], [0.3, 0, 0]); return L; });
    P.legs = [1, -1].map((sd) => { const L = limb(body, sd * 0.16, -0.35, 0, 0.24, 0.26, 0.07, stone, stoneD); L.a.rotation.x = -0.9; L.b.rotation.x = 1.6; for (let i = 0; i < 3; i++) add(L.end, new THREE.ConeGeometry(0.018, 0.1, 4), stoneD, [-0.03 + i * 0.03, 0, 0.06], [Math.PI / 2, 0, 0]); return L; });
    const tail = pivot(body, 0, -0.42, -0.18); P.tail = tail;
    add(tail, tube([[0, 0, 0], [0, -0.15, -0.3], [0, -0.1, -0.6], [0, 0.05, -0.8]], 0.035, 12), stoneD);
    add(tail, new THREE.ConeGeometry(0.07, 0.14, 4), stoneD, [0, 0.08, -0.85], [-1.2, 0, 0], [1, 1, 0.4]);
  }, function (t, o) {
    const P = t.parts, tm = o.time + o.phase, strike = o.k > 0 ? Math.sin(o.k * Math.PI) : 0;
    const fl = Math.sin(tm * 7);
    P.wings.forEach((w, i) => { const sd = i ? -1 : 1; w.rotation.y = sd * (0.35 + fl * 0.6); });
    P.body.position.y = Math.sin(tm * 7 + 0.8) * 0.07;
    P.arms.forEach((a, i) => { a.a.rotation.x = -0.6 - strike * 1.4 + Math.sin(tm * 2 + i) * 0.1; a.b.rotation.x = -0.7; });
    P.tail.rotation.y = Math.sin(tm * 1.5) * 0.4; P.head.rotation.x = -strike * 0.3;
  });

  // ======================================================================
  //  サラマンダー（参考: 三つ目で、炎のえりと炎のしっぽの生き物）
  //  チェック項目: 低い四つ足の黒褐色の体に、溶岩のように光るひび／3 つの黄色い目と大きな口の牙／頭の左右と背中の炎のえり／先が燃えるしっぽ
  // ======================================================================
  MON.register('salamander', function (std, g, P) {
    const skin = std({ color: 0x3a2420, roughness: 0.85, flatShading: true });
    const belly = std({ color: 0x6a3a2a, roughness: 0.9 });
    const lava = std({ color: 0xff8a2a, emissive: 0xff5a10, emissiveIntensity: 2.0 });
    const flame = std({ color: 0xffb040, emissive: 0xff6010, emissiveIntensity: 2.4, transparent: true, opacity: 0.9 });
    const eyeM = std({ color: 0xffe040, emissive: 0xffc000, emissiveIntensity: 2.0 });
    const tooth = std({ color: 0xf0e0c0 });
    const body = pivot(g, 0, 0.42, 0); P.body = body;
    add(body, jitter(new THREE.SphereGeometry(0.42, 16, 12), 0.03), skin, [0, 0, -0.1], null, [1.0, 0.6, 1.6]);
    add(body, new THREE.SphereGeometry(0.36, 12, 8), belly, [0, -0.12, -0.1], null, [0.95, 0.4, 1.5]);
    for (let i = 0; i < 12; i++) add(body, new THREE.BoxGeometry(rand(0.15, 0.35), 0.015, 0.02), lava, [rand(-0.3, 0.3), rand(0.12, 0.24), rand(-0.6, 0.4)], [0, rand(0, 3), 0]); // 光るひび
    P.fins = [];
    for (let i = 0; i < 6; i++) { const f = add(body, new THREE.ConeGeometry(0.07, 0.3 - i * 0.025, 5), flame, [0, 0.27, 0.3 - i * 0.17], [-0.4, 0, 0]); P.fins.push(f); }
    const head = pivot(body, 0, 0.05, 0.55); P.head = head;
    add(head, jitter(new THREE.SphereGeometry(0.3, 14, 10), 0.02), skin, null, null, [1.2, 0.75, 1]);
    [-0.13, 0, 0.13].forEach((x) => { add(head, new THREE.SphereGeometry(x ? 0.055 : 0.065, 10, 8), eyeM, [x, 0.18, 0.18 + (x ? 0 : 0.03)]); add(head, new THREE.SphereGeometry(0.022, 6, 4), std({ color: 0x050505 }), [x, 0.19, 0.24 + (x ? 0 : 0.03)]); });
    glow(head, '#ffd040', 0.5, [0, 0.19, 0.24]);
    const jaw = pivot(head, 0, -0.08, 0.05); P.jaw = jaw;
    add(jaw, new THREE.SphereGeometry(0.26, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), std({ color: 0x8a2a2a, roughness: 0.6 }), [0, 0.02, 0.06], null, [1.1, 0.5, 0.9]);
    for (let i = 0; i < 8; i++) { const a = (i / 7 - 0.5) * 2.4; add(jaw, new THREE.ConeGeometry(0.018, 0.07, 4), tooth, [Math.sin(a) * 0.2, 0.04, 0.06 + Math.cos(a) * 0.2]); add(head, new THREE.ConeGeometry(0.018, 0.07, 4), tooth, [Math.sin(a) * 0.2, -0.06, 0.08 + Math.cos(a) * 0.2], [Math.PI, 0, 0]); }
    P.frills = [-1, 1].map((sd) => { const p = pivot(head, sd * 0.3, 0.05, -0.05); for (let i = 0; i < 3; i++) add(p, new THREE.ConeGeometry(0.06, 0.38 - i * 0.07, 5), flame, [sd * 0.08, 0.05 + i * 0.03, -i * 0.08], [0.3, 0, -sd * (1.0 + i * 0.25)]); return p; });
    P.legs = [];
    [[0.32, 0.3], [-0.32, 0.3], [0.34, -0.45], [-0.34, -0.45]].forEach(([x, z], i) => {
      const root = pivot(body, x, -0.05, z); root.rotation.z = Math.sign(x) * 1.0;
      add(root, new THREE.CylinderGeometry(0.06, 0.08, 0.3, 6), skin, [0, -0.15, 0]);
      const kn = pivot(root, 0, -0.3, 0); kn.rotation.z = -Math.sign(x) * 1.0;
      add(kn, new THREE.CylinderGeometry(0.05, 0.06, 0.25, 6), skin, [0, -0.12, 0]);
      for (let k = 0; k < 3; k++) add(kn, new THREE.ConeGeometry(0.02, 0.1, 4), std({ color: 0x1a1010 }), [-0.03 + k * 0.03, -0.25, 0.05], [Math.PI / 2, 0, 0]);
      P.legs.push({ root, i });
    });
    const tail = pivot(body, 0, 0, -0.75); P.tail = tail;
    add(tail, new THREE.ConeGeometry(0.17, 0.9, 8), skin, [0, 0, -0.42], [-Math.PI / 2, 0, 0]);
    P.tailFlame = add(tail, new THREE.ConeGeometry(0.12, 0.42, 6), flame, [0, 0.12, -0.9], [-1.1, 0, 0]);
    P.tailGlow = glow(tail, '#ff7a20', 1.0, [0, 0.15, -0.95]);
  }, function (t, o) {
    const P = t.parts, tm = o.time + o.phase, strike = o.k > 0 ? Math.sin(o.k * Math.PI) : 0;
    const gait = o.speed > 0.2 ? o.walk * 1.4 : 0;
    P.legs.forEach((L) => { L.root.rotation.x = Math.sin(gait + (L.i === 0 || L.i === 3 ? 0 : Math.PI)) * 0.5; });
    P.body.rotation.y = Math.sin(gait) * 0.12; P.tail.rotation.y = Math.sin(gait + tm * 1.5) * 0.4;
    P.jaw.rotation.x = 0.1 + strike * 0.6 + Math.max(0, Math.sin(tm * 2)) * 0.08;
    const fl = 1 + Math.sin(tm * 11) * 0.12;
    P.fins.forEach((f, i) => { f.scale.y = fl * (1 + Math.sin(tm * 9 + i) * 0.15); });
    P.frills.forEach((p, i) => { p.scale.setScalar(fl + strike * 0.3); p.rotation.z = Math.sin(tm * 7 + i) * 0.1; });
    P.tailFlame.scale.setScalar(fl); P.tailGlow.scale.setScalar(1.0 * fl);
  });

  // ======================================================================
  //  イフリート（参考: 全身が燃える筋骨たくましい炎の魔人）
  //  チェック項目: 黒い溶岩の芯に、オレンジに光るひびの筋肉／頭と肩・腕から燃え上がる炎／光る目／大きなこぶし
  // ======================================================================
  MON.register('ifrit', function (std, g, P) {
    const core = std({ color: 0x3a1a10, roughness: 0.7, emissive: 0x6a1a04, emissiveIntensity: 0.6, flatShading: true });
    const lava = std({ color: 0xffa040, emissive: 0xff6a10, emissiveIntensity: 2.2 });
    const flame = std({ color: 0xffc050, emissive: 0xff7010, emissiveIntensity: 2.6, transparent: true, opacity: 0.85, depthWrite: false });
    const eyeM = std({ color: 0xfff0a0, emissive: 0xffe060, emissiveIntensity: 3 });
    const body = pivot(g, 0, 0, 0); P.body = body;
    const torso = pivot(body, 0, 1.25, 0); P.torso = torso;
    add(torso, jitter(new THREE.SphereGeometry(0.42, 16, 12), 0.03), core, [0, 0.25, 0], null, [1.25, 1.05, 0.8]);
    add(torso, jitter(new THREE.SphereGeometry(0.3, 12, 10), 0.02), core, [0, -0.15, 0], null, [1.05, 0.9, 0.75]);
    for (let i = 0; i < 16; i++) add(torso, new THREE.BoxGeometry(rand(0.08, 0.25), 0.02, 0.02), lava, [rand(-0.35, 0.35), rand(-0.3, 0.5), 0.3 + rand(-0.05, 0.03)], [0, 0, rand(-1.2, 1.2)]);
    P.flames = [];
    const fire = (parent, p, h, r) => { const f = add(parent, new THREE.ConeGeometry(r, h, 6), flame, p, [rand(-0.25, 0.25), rand(0, 3), rand(-0.25, 0.25)]); P.flames.push(f); return f; };
    const head = pivot(torso, 0, 0.72, 0.05); P.head = head;
    add(head, jitter(new THREE.SphereGeometry(0.2, 12, 10), 0.02), core, null, null, [1, 1.05, 1]);
    [-1, 1].forEach((sd) => { add(head, new THREE.SphereGeometry(0.03, 8, 6), eyeM, [sd * 0.07, 0.03, 0.17], null, [1.5, 0.7, 1]); });
    glow(head, '#fff0a0', 0.5, [0, 0.03, 0.2]);
    for (let i = 0; i < 9; i++) fire(head, [rand(-0.15, 0.15), 0.2 + rand(0, 0.1), rand(-0.15, 0.1)], rand(0.3, 0.55), rand(0.06, 0.1));
    [-1, 1].forEach((sd) => { for (let i = 0; i < 4; i++) fire(torso, [sd * (0.42 + rand(-0.05, 0.08)), 0.55 + rand(0, 0.1), rand(-0.15, 0.15)], rand(0.3, 0.5), rand(0.07, 0.11)); });
    P.glows = [glow(torso, '#ff7a20', 3.2, [0, 0.4, 0]), glow(head, '#ffb040', 1.6, [0, 0.25, 0])];
    P.arms = [1, -1].map((sd) => { const L = limb(torso, sd * 0.55, 0.45, 0, 0.42, 0.4, 0.12, core, core); add(L.end, jitter(new THREE.SphereGeometry(0.15, 10, 8), 0.02), core); for (let i = 0; i < 3; i++) fire(L.b, [0, -0.15 - i * 0.12, -0.06], rand(0.2, 0.3), 0.06); add(L.a, new THREE.BoxGeometry(0.02, 0.3, 0.02), lava, [0, -0.2, 0.11]); return L; });
    P.legs = [1, -1].map((sd) => { const L = limb(body, sd * 0.2, 0.95, 0, 0.48, 0.45, 0.13, core, core); add(L.end, new THREE.BoxGeometry(0.2, 0.08, 0.3), core, [0, 0.03, 0.06]); add(L.b, new THREE.BoxGeometry(0.02, 0.3, 0.02), lava, [0, -0.2, 0.12]); return L; });
  }, function (t, o) {
    const P = t.parts, sw = o.sw, k = o.k, tm = o.time + o.phase;
    P.legs[0].a.rotation.x = sw * 0.45; P.legs[1].a.rotation.x = -sw * 0.45; P.legs[0].b.rotation.x = Math.max(0, -sw) * 0.5; P.legs[1].b.rotation.x = Math.max(0, sw) * 0.5;
    const lift = k > 0 ? (k < 0.6 ? k / 0.6 : 1 - (k - 0.6) / 0.4 * 1.6) : 0;
    P.arms[0].a.rotation.x = -sw * 0.35 - lift * 2.4; P.arms[1].a.rotation.x = sw * 0.35 - lift * 1.2; P.arms.forEach((a) => (a.b.rotation.x = -0.4 - lift * 0.4));
    P.flames.forEach((f, i) => { f.scale.y = 1 + Math.sin(tm * 12 + i * 1.7) * 0.25; f.scale.x = f.scale.z = 1 + Math.sin(tm * 9 + i) * 0.1; });
    P.glows[0].scale.setScalar(3.2 * (1 + Math.sin(tm * 8) * 0.08 + lift * 0.4));
    P.body.position.y = Math.abs(sw) * 0.05;
  });

  // ======================================================================
  //  ミノタウロス（守護者。参考: 大きな角の牛頭の巨人と両刃の大斧）
  //  チェック項目: 大きく曲がった角の牛の頭、赤く光る目、鼻輪／毛深く筋骨たくましい巨体／腰布と鎖／両刃の大斧／ひづめの脚
  // ======================================================================
  MON.register('minotaur', function (std, g, P) {
    const fur = std({ color: 0x3a2a20, roughness: 1, flatShading: true });
    const skin = std({ color: 0x5a4234, roughness: 0.8 });
    const horn = std({ color: 0xc8b898, roughness: 0.5 });
    const iron = std({ color: 0x5a5a60, roughness: 0.35, metalness: 0.4 });
    const steel = std({ color: 0xb8bcc4, roughness: 0.3, metalness: 0.4 });
    const cloth = std({ color: 0x4a1a14, roughness: 1, side: THREE.DoubleSide });
    const eyeM = std({ color: 0xff2a1a, emissive: 0xff1a0a, emissiveIntensity: 2.5 });
    const S = 1.75; // 全体の大きさ
    const body = pivot(g, 0, 0, 0); P.body = body;
    const torso = pivot(body, 0, 1.2 * S, 0); torso.rotation.x = 0.15; P.torso = torso;
    add(torso, jitter(new THREE.SphereGeometry(0.5 * S, 16, 12), 0.03 * S), fur, [0, 0.35 * S, 0], null, [1.25, 1.05, 0.85]);
    add(torso, new THREE.SphereGeometry(0.36 * S, 14, 10), skin, [0, 0.3 * S, 0.12 * S], null, [1.25, 1, 0.6]);
    add(torso, new THREE.SphereGeometry(0.4 * S, 12, 10), fur, [0, -0.05 * S, 0], null, [1.05, 0.95, 0.85]);
    [-1, 1].forEach((sd) => add(torso, new THREE.SphereGeometry(0.2 * S, 10, 8), skin, [sd * 0.17 * S, 0.42 * S, 0.22 * S], null, [1, 0.8, 0.5])); // 胸の筋肉
    add(torso, new THREE.CylinderGeometry(0.4 * S, 0.42 * S, 0.12 * S, 14), std({ color: 0x2a1a10, roughness: 0.8 }), [0, -0.3 * S, 0]);
    add(torso, new THREE.PlaneGeometry(0.4 * S, 0.55 * S), cloth, [0, -0.6 * S, 0.33 * S], [0.1, 0, 0]);
    const head = pivot(torso, 0, 0.85 * S, 0.18 * S); P.head = head;
    add(head, jitter(new THREE.SphereGeometry(0.26 * S, 14, 12), 0.02 * S), fur, null, null, [1, 1, 1.1]);
    add(head, new THREE.CylinderGeometry(0.15 * S, 0.19 * S, 0.3 * S, 12), skin, [0, -0.08 * S, 0.22 * S], [Math.PI / 2 + 0.3, 0, 0]);
    add(head, new THREE.TorusGeometry(0.06 * S, 0.012 * S, 6, 14), steel, [0, -0.17 * S, 0.37 * S]);
    [-1, 1].forEach((sd) => {
      add(head, new THREE.SphereGeometry(0.035 * S, 8, 6), eyeM, [sd * 0.12 * S, 0.06 * S, 0.2 * S]); glow(head, '#ff2010', 0.45, [sd * 0.12 * S, 0.06 * S, 0.24 * S]);
      add(head, tube([[sd * 0.2, 0.12, 0], [sd * 0.45, 0.2, -0.05], [sd * 0.62, 0.42, 0.05], [sd * 0.55, 0.65, 0.2]].map((p) => p.map((v) => v * S)), 0.05 * S, 14), horn);
      add(head, new THREE.ConeGeometry(0.07 * S, 0.14 * S, 6), skin, [sd * 0.25 * S, 0.15 * S, -0.05 * S], [0, 0, -sd * 1.3], [1, 1, 0.4]);
    });
    P.arms = [1, -1].map((sd) => { const L = limb(torso, sd * 0.62 * S, 0.55 * S, 0, 0.5 * S, 0.48 * S, 0.14 * S, fur, skin); add(L.end, jitter(new THREE.SphereGeometry(0.15 * S, 10, 8), 0.01), skin); add(L.b, new THREE.TorusGeometry(0.15 * S, 0.035 * S, 6, 14), iron, [0, -0.32 * S, 0], [Math.PI / 2, 0, 0]); for (let i = 0; i < 4; i++) add(L.b, new THREE.TorusGeometry(0.04 * S, 0.012 * S, 5, 10), iron, [sd * 0.1 * S, -0.4 * S - i * 0.06 * S, 0.1 * S], [0, i % 2 ? Math.PI / 2 : 0, 0]); return L; });
    const axe = pivot(P.arms[0].end, 0, -0.05 * S, 0); axe.rotation.x = Math.PI / 2 + 0.2; P.axe = axe;
    add(axe, new THREE.CylinderGeometry(0.035 * S, 0.035 * S, 1.6 * S, 8), std({ color: 0x3a2618, roughness: 0.8 }), [0, 0.3 * S, 0]);
    const bl = new THREE.Shape(); bl.moveTo(0, 0.18); bl.quadraticCurveTo(0.45, 0.42, 0.5, 0); bl.quadraticCurveTo(0.45, -0.42, 0, -0.18); bl.closePath();
    [-1, 1].forEach((sd) => { const m = add(axe, new THREE.ExtrudeGeometry(bl, { depth: 0.03, bevelEnabled: false }), steel, [0, 0.95 * S, -0.015 * S], [0, sd > 0 ? 0 : Math.PI, Math.PI / 2], S); void m; });
    add(axe, new THREE.ConeGeometry(0.05 * S, 0.25 * S, 6), steel, [0, 1.2 * S, 0]);
    P.legs = [1, -1].map((sd) => { const L = limb(body, sd * 0.3 * S, 1.0 * S, 0, 0.52 * S, 0.5 * S, 0.16 * S, fur, fur); add(L.end, new THREE.CylinderGeometry(0.12 * S, 0.15 * S, 0.12 * S, 8), std({ color: 0x1a1410, roughness: 0.6 }), [0, 0.05 * S, 0.03 * S]); return L; });
  }, function (t, o) {
    const P = t.parts, sw = o.sw, k = o.k, tm = o.time + o.phase;
    P.legs[0].a.rotation.x = sw * 0.4; P.legs[1].a.rotation.x = -sw * 0.4; P.legs[0].b.rotation.x = Math.max(0, -sw) * 0.5; P.legs[1].b.rotation.x = Math.max(0, sw) * 0.5;
    const lift = k > 0 ? (k > 0.55 ? (1 - k) / 0.45 : k / 0.55) : 0;
    P.arms[0].a.rotation.x = -sw * 0.3 - lift * 2.8; P.arms[0].b.rotation.x = -0.4 - lift * 0.5;
    P.arms[1].a.rotation.x = sw * 0.3 - lift * 1.6; P.arms[1].b.rotation.x = -0.5;
    P.head.rotation.x = -lift * 0.3 + Math.sin(tm * 0.8) * 0.05; P.body.position.y = Math.abs(sw) * 0.08;
  });

  // ======================================================================
  //  リッチ（守護者。参考: 紫のローブの骸骨の魔術師、青い氷の玉と炎）
  //  チェック項目: フードの中の頭蓋骨／黒と紫のローブに赤い帯、赤い数珠の首飾り／骨の手／左手に青い氷の玉、右手に炎／宙に浮く
  // ======================================================================
  MON.register('lich', function (std, g, P) {
    const robe = std({ color: 0x1e1828, roughness: 0.95, side: THREE.DoubleSide });
    const robeP = std({ color: 0x4a2a5a, roughness: 0.9, side: THREE.DoubleSide });
    const sash = std({ color: 0x8a1420, roughness: 0.8, side: THREE.DoubleSide });
    const boneM = std({ color: 0xd8d0bc, roughness: 0.75 });
    const dark = std({ color: 0x050306 });
    const bead = std({ color: 0xb01818, roughness: 0.3, emissive: 0x400404, emissiveIntensity: 0.5 });
    const eyeM = std({ color: 0x8adfff, emissive: 0x3ab8ff, emissiveIntensity: 2.5 });
    const S = 1.35;
    const body = pivot(g, 0, 0, 0); P.body = body;
    const prof = [[0.62, 0], [0.55, 0.3], [0.44, 0.8], [0.36, 1.2], [0.33, 1.45], [0.14, 1.58], [0.001, 1.6]].map(([r, y]) => new THREE.Vector2(r * S, y * S));
    const rg = new THREE.LatheGeometry(prof, 22), pa = rg.attributes.position;
    for (let i = 0; i < pa.count; i++) if (pa.getY(i) < 0.02) { const a = Math.atan2(pa.getZ(i), pa.getX(i)); pa.setY(i, 0.03 + Math.abs(Math.sin(a * 4.5)) * 0.18 * S); }
    rg.computeVertexNormals();
    P.robe = add(body, rg, robe);
    add(body, new THREE.LatheGeometry(prof.map((v) => new THREE.Vector2(v.x * 0.86, v.y * 0.95)), 16), robeP, [0, 0.01, 0]);
    [-1, 1].forEach((sd) => { const pts = []; for (let y = 0.15; y <= 1.4; y += 0.25) pts.push([sd * 0.1 * S, y * S, (0.6 - y * 0.2) * S]); add(body, tube(pts, 0.04 * S, 12), sash); });
    // 首の数珠と、ローブのあいだから見えるあばら骨
    for (let i = 0; i < 18; i++) { const a = (i / 18) * Math.PI * 2; add(body, new THREE.SphereGeometry(0.03 * S, 6, 4), bead, [Math.cos(a) * 0.2 * S, 1.42 * S - Math.max(0, Math.sin(a)) * 0.18 * S, Math.sin(a) * 0.16 * S + 0.05 * S]); }
    for (let i = 0; i < 4; i++) add(body, new THREE.TorusGeometry(0.1 * S, 0.012 * S, 4, 10, Math.PI), boneM, [0, (1.3 - i * 0.07) * S, 0.18 * S], [0.3, 0, Math.PI]);
    // 頭: フードと頭蓋骨
    const head = pivot(body, 0, 1.72 * S, 0.02 * S); P.head = head;
    add(head, new THREE.SphereGeometry(0.24 * S, 16, 12, Math.PI * 0.6, Math.PI * 1.8), robe, null, null, [1, 1.2, 1.12]);
    add(head, new THREE.ConeGeometry(0.12 * S, 0.3 * S, 8), robe, [0, 0.24 * S, -0.1 * S], [-0.7, 0, 0]);
    add(head, new THREE.SphereGeometry(0.15 * S, 14, 12), boneM, [0, 0, 0.04 * S], null, [0.92, 1, 1.05]);
    add(head, new THREE.BoxGeometry(0.15 * S, 0.06 * S, 0.12 * S), boneM, [0, -0.12 * S, 0.08 * S]);
    [-1, 1].forEach((sd) => { add(head, new THREE.SphereGeometry(0.04 * S, 10, 8), dark, [sd * 0.05 * S, 0.01 * S, 0.15 * S]); add(head, new THREE.SphereGeometry(0.012 * S, 6, 4), eyeM, [sd * 0.05 * S, 0.01 * S, 0.17 * S]); glow(head, '#4ac8ff', 0.25, [sd * 0.05 * S, 0.01 * S, 0.2 * S]); });
    for (let i = 0; i < 6; i++) add(head, new THREE.BoxGeometry(0.014 * S, 0.025 * S, 0.01 * S), boneM, [(-0.035 + i * 0.014) * S, -0.15 * S, 0.14 * S]);
    // 腕: 広い袖と骨の手。左に氷の玉、右に炎
    P.arms = [1, -1].map((sd) => {
      const sh = pivot(body, sd * 0.36 * S, 1.4 * S, 0.05 * S);
      add(sh, new THREE.CylinderGeometry(0.08 * S, 0.2 * S, 0.6 * S, 10, 1, true), robe, [0, -0.3 * S, 0]);
      const hand = pivot(sh, 0, -0.62 * S, 0.05 * S);
      add(hand, new THREE.BoxGeometry(0.07 * S, 0.06 * S, 0.04 * S), boneM);
      for (let i = 0; i < 4; i++) add(hand, new THREE.CylinderGeometry(0.008 * S, 0.006 * S, 0.12 * S, 4), boneM, [(-0.03 + i * 0.02) * S, 0.06 * S, 0.02 * S], [-0.3, 0, (i - 1.5) * 0.25]);
      return { sh, hand };
    });
    P.orbIce = add(P.arms[1].hand, new THREE.IcosahedronGeometry(0.13 * S, 2), std({ color: 0x9ae8ff, emissive: 0x3ab8ff, emissiveIntensity: 2.2, roughness: 0.1, transparent: true, opacity: 0.9 }), [0, 0.2 * S, 0.05 * S]);
    P.glowIce = glow(P.arms[1].hand, '#4ac8ff', 1.5, [0, 0.2 * S, 0.05 * S]);
    P.fire = [];
    for (let i = 0; i < 5; i++) P.fire.push(add(P.arms[0].hand, new THREE.ConeGeometry(0.05 * S, rand(0.2, 0.32) * S, 6), std({ color: 0xffb040, emissive: 0xff6010, emissiveIntensity: 2.5, transparent: true, opacity: 0.85, depthWrite: false }), [rand(-0.04, 0.04) * S, 0.2 * S, (0.05 + rand(-0.04, 0.04)) * S]));
    P.glowFire = glow(P.arms[0].hand, '#ff7a20', 1.5, [0, 0.22 * S, 0.05 * S]);
  }, function (t, o) {
    const P = t.parts, tm = o.time + o.phase, strike = o.k > 0 ? Math.sin(o.k * Math.PI) : 0;
    P.body.position.y = 0.15 + Math.sin(tm * 1.4) * 0.08;
    P.robe.rotation.y = Math.sin(tm * 1.0) * 0.08;
    P.arms.forEach((a, i) => { a.sh.rotation.x = -0.7 - strike * 0.9 + Math.sin(tm * 1.2 + i) * 0.08; a.sh.rotation.z = (i ? -1 : 1) * 0.35; });
    P.orbIce.rotation.y += o.dt * 2; P.glowIce.scale.setScalar(1.5 * (1 + Math.sin(tm * 3) * 0.12 + strike * 0.6));
    P.fire.forEach((f, i) => { f.scale.y = 1 + Math.sin(tm * 13 + i * 2) * 0.3; });
    P.glowFire.scale.setScalar(1.5 * (1 + Math.sin(tm * 9) * 0.15 + strike * 0.6));
  });

  // ======================================================================
  //  ドラゴン（守護者。参考: 黒い鱗の竜）
  //  チェック項目: 黒鉄色の鱗の巨体と、長い首・長いしっぽ／角のとげが並ぶ頭と牙の口、光る目／指の骨が通ったぼろぼろの膜の翼／太い 4 本の脚とかぎ爪
  // ======================================================================
  MON.register('dragon', function (std, g, P) {
    const scale = std({ color: 0x3e3c3e, roughness: 0.55, metalness: 0.25, flatShading: true });
    const scaleD = std({ color: 0x18181a, roughness: 0.6, metalness: 0.3, flatShading: true });
    const bellyM = std({ color: 0x4a4440, roughness: 0.7, flatShading: true });
    const memb = std({ color: 0x302a2a, roughness: 0.85, side: THREE.DoubleSide, transparent: true, opacity: 0.96 });
    const hornM = std({ color: 0x8a8070, roughness: 0.5 });
    const eyeM = std({ color: 0xffb030, emissive: 0xff8000, emissiveIntensity: 2.6 });
    const tooth = std({ color: 0xe8e0d0 });
    const S = 2.2;
    const body = pivot(g, 0, 1.15 * S, 0); P.body = body;
    add(body, jitter(new THREE.SphereGeometry(0.6 * S, 18, 14), 0.03 * S), scale, [0, 0, -0.1 * S], null, [0.9, 0.85, 1.5]);
    add(body, new THREE.SphereGeometry(0.5 * S, 14, 10), bellyM, [0, -0.18 * S, -0.05 * S], null, [0.85, 0.6, 1.4]);
    for (let i = 0; i < 9; i++) add(body, new THREE.ConeGeometry(0.06 * S, 0.22 * S, 4), scaleD, [0, 0.5 * S - Math.abs(i - 4) * 0.03 * S, (0.5 - i * 0.14) * S], [-0.5, 0, 0]); // 背中のとげ
    // 首（節をつなげる）と頭
    P.neck = [];
    let parent = body, py = 0.2 * S, pz = 0.75 * S;
    for (let i = 0; i < 5; i++) { const n = pivot(parent, 0, py, pz); n.rotation.x = -0.13; add(n, new THREE.SphereGeometry((0.28 - i * 0.025) * S, 10, 8), scale, [0, 0, 0], null, [1, 1, 1.25]); add(n, new THREE.ConeGeometry(0.05 * S, 0.16 * S, 4), scaleD, [0, (0.26 - i * 0.02) * S, -0.02 * S], [-0.4, 0, 0]); P.neck.push(n); parent = n; py = 0.08 * S; pz = 0.3 * S; }
    const head = pivot(parent, 0, 0.12 * S, 0.3 * S); P.head = head; head.rotation.x = 0.55;
    add(head, jitter(new THREE.SphereGeometry(0.25 * S, 14, 10), 0.015 * S), scale, null, null, [0.9, 0.75, 1.2]);
    add(head, new THREE.BoxGeometry(0.28 * S, 0.14 * S, 0.45 * S), scale, [0, 0.0, 0.3 * S]);
    [-1, 1].forEach((sd) => {
      add(head, new THREE.SphereGeometry(0.04 * S, 8, 6), eyeM, [sd * 0.13 * S, 0.08 * S, 0.12 * S]); glow(head, '#ff9020', 0.5, [sd * 0.13 * S, 0.08 * S, 0.16 * S]);
      add(head, tube([[sd * 0.1, 0.12, -0.05], [sd * 0.2, 0.25, -0.3], [sd * 0.22, 0.35, -0.55]].map((p) => p.map((v) => v * S)), 0.035 * S, 10), hornM);
      add(head, tube([[sd * 0.15, 0.05, -0.1], [sd * 0.3, 0.12, -0.3], [sd * 0.36, 0.15, -0.45]].map((p) => p.map((v) => v * S)), 0.022 * S, 8), hornM);
      for (let i = 0; i < 5; i++) add(head, new THREE.ConeGeometry(0.014 * S, 0.06 * S, 4), tooth, [sd * 0.12 * S, -0.08 * S, (0.15 + i * 0.08) * S], [Math.PI, 0, 0]);
    });
    const jaw = pivot(head, 0, -0.07 * S, 0.0); P.jaw = jaw;
    add(jaw, new THREE.BoxGeometry(0.24 * S, 0.07 * S, 0.48 * S), scaleD, [0, -0.03 * S, 0.28 * S]);
    [-1, 1].forEach((sd) => { for (let i = 0; i < 5; i++) add(jaw, new THREE.ConeGeometry(0.012 * S, 0.05 * S, 4), tooth, [sd * 0.1 * S, 0.02 * S, (0.15 + i * 0.08) * S]); });
    P.mouthGlow = glow(head, '#ff6a10', 0.1, [0, -0.06 * S, 0.5 * S]);
    // 翼（ぼろぼろの膜）
    P.wings = [1, -1].map((sd) => { const w = wing(body, sd, 2.4 * S, memb, scaleD); w.position.set(sd * 0.3 * S, 0.35 * S, 0.1 * S); w.rotation.set(0.15, sd * 0.25, sd * 0.15); return w; });
    // 脚（太く、かぎ爪）
    P.legs = [[0.42, 0.45], [-0.42, 0.45], [0.42, -0.6], [-0.42, -0.6]].map(([x, z], i) => {
      const L = limb(body, x * S, -0.2 * S, z * S, 0.5 * S, 0.5 * S, 0.12 * S, scale, scaleD);
      L.a.rotation.x = i < 2 ? -0.3 : 0.3; L.b.rotation.x = i < 2 ? 0.6 : -0.5;
      for (let k = 0; k < 4; k++) add(L.end, new THREE.ConeGeometry(0.03 * S, 0.16 * S, 4), hornM, [(-0.07 + k * 0.045) * S, 0, 0.1 * S], [Math.PI / 2, 0, 0]);
      add(L.end, new THREE.BoxGeometry(0.22 * S, 0.08 * S, 0.26 * S), scaleD, [0, 0.02 * S, 0.04 * S]);
      L.i = i; return L;
    });
    // しっぽ（節をつなげる）
    P.tail = []; parent = body; let tz = -0.85 * S;
    for (let i = 0; i < 7; i++) { const n = pivot(parent, 0, i ? 0 : -0.05 * S, tz); add(n, new THREE.SphereGeometry((0.26 - i * 0.032) * S, 8, 6), scale, null, null, [1, 0.9, 1.6]); add(n, new THREE.ConeGeometry(0.04 * S, 0.12 * S, 4), scaleD, [0, (0.22 - i * 0.03) * S, 0], [-0.5, 0, 0]); P.tail.push(n); parent = n; tz = -0.36 * S; }
  }, function (t, o) {
    const P = t.parts, sw = o.sw, k = o.k, tm = o.time + o.phase, strike = k > 0 ? Math.sin(k * Math.PI) : 0;
    const fl = Math.sin(tm * 1.6);
    P.wings.forEach((w, i) => { const sd = i ? -1 : 1; w.rotation.y = sd * (0.25 + fl * 0.35 - strike * 0.3); w.rotation.z = sd * (0.15 + fl * 0.15); });
    P.legs.forEach((L) => { const ph = L.i === 0 || L.i === 3 ? 0 : Math.PI; L.a.rotation.x = (L.i < 2 ? -0.3 : 0.3) + Math.sin(o.walk * 0.9 + ph) * (o.speed > 0.2 ? 0.35 : 0); });
    P.neck.forEach((n, i) => { n.rotation.x = -0.13 + strike * 0.08 + Math.sin(tm * 0.9 + i * 0.5) * 0.04; n.rotation.y = Math.sin(tm * 0.6 + i * 0.4) * 0.06; });
    P.jaw.rotation.x = 0.1 + strike * 0.7; P.mouthGlow.scale.setScalar(0.1 + strike * 3);
    P.tail.forEach((n, i) => { n.rotation.y = Math.sin(tm * 1.2 - i * 0.6) * 0.18; });
    P.body.position.y = 1.15 * 2.2 + Math.sin(tm * 1.6) * 0.05 + Math.abs(sw) * 0.06;
  });

  // ======================================================================
  //  氷の王（最後の守護者。参考: とげのある王冠と銀の鎧の、凍てつく王）
  //  チェック項目: 黒銀の装飾の鎧と、氷のとげが並ぶ王冠／兜の奥に青白く光る目／肩から生える氷の結晶／長い濃紺のマント／氷の大剣
  // ======================================================================
  MON.register('iceking', function (std, g, P) {
    const steel = std({ color: 0x5a606e, roughness: 0.3, metalness: 0.4 });
    const silver = std({ color: 0xc0c8d4, roughness: 0.2, metalness: 0.4 });
    const capeM = std({ color: 0x141c34, roughness: 0.9, side: THREE.DoubleSide });
    const ice = std({ color: 0xbfefff, emissive: 0x4ab8ff, emissiveIntensity: 1.2, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.85, flatShading: true });
    const eyeM = std({ color: 0xcff6ff, emissive: 0x6ad8ff, emissiveIntensity: 3 });
    const S = 1.55;
    const body = pivot(g, 0, 0, 0); P.body = body;
    const torso = pivot(body, 0, 1.15 * S, 0); P.torso = torso;
    add(torso, new THREE.CylinderGeometry(0.34 * S, 0.26 * S, 0.6 * S, 14), steel, [0, 0.3 * S, 0], null, [1.1, 1, 0.75]);
    add(torso, new THREE.SphereGeometry(0.33 * S, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), steel, [0, 0.58 * S, 0], null, [1.1, 0.5, 0.8]);
    for (let i = 0; i < 5; i++) add(torso, new THREE.TorusGeometry((0.12 + i * 0.03) * S, 0.008 * S, 4, 16, Math.PI), silver, [0, (0.5 - i * 0.07) * S, 0.24 * S], [0, 0, Math.PI]);
    for (let i = 0; i < 3; i++) add(torso, new THREE.CylinderGeometry((0.27 - i * 0.01) * S, (0.28 - i * 0.01) * S, 0.07 * S, 14), i % 2 ? silver : steel, [0, -(0.02 + i * 0.07) * S, 0], null, [1.08, 1, 0.78]);
    add(torso, new THREE.CylinderGeometry(0.22 * S, 0.34 * S, 0.5 * S, 14, 1, true), steel, [0, -0.38 * S, 0]);
    const head = pivot(torso, 0, 0.7 * S, 0); P.head = head;
    add(head, new THREE.SphereGeometry(0.17 * S, 16, 12), steel, [0, 0.08 * S, 0], null, [0.92, 1.1, 1.05]);
    add(head, new THREE.BoxGeometry(0.2 * S, 0.03 * S, 0.04 * S), std({ color: 0x020206 }), [0, 0.09 * S, 0.16 * S]);
    [-1, 1].forEach((sd) => add(head, new THREE.SphereGeometry(0.016 * S, 6, 4), eyeM, [sd * 0.05 * S, 0.09 * S, 0.17 * S]));
    glow(head, '#8ae0ff', 0.5, [0, 0.09 * S, 0.2 * S]);
    add(head, new THREE.TorusGeometry(0.17 * S, 0.02 * S, 5, 20), silver, [0, 0.2 * S, 0], [Math.PI / 2, 0, 0]);
    for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2, h = (i % 2 ? 0.22 : 0.38) * S; add(head, new THREE.ConeGeometry(0.035 * S, h, 4), ice, [Math.sin(a) * 0.16 * S, 0.2 * S + h / 2, Math.cos(a) * 0.16 * S], [Math.cos(a) * 0.25, 0, -Math.sin(a) * 0.25]); }
    // 肩の氷の結晶
    [-1, 1].forEach((sd) => { add(torso, new THREE.SphereGeometry(0.18 * S, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), steel, [sd * 0.4 * S, 0.55 * S, 0], [0, 0, -sd * 0.4], [1.2, 0.9, 1.2]); for (let i = 0; i < 4; i++) { const c = add(torso, new THREE.OctahedronGeometry(rand(0.06, 0.1) * S, 0), ice, [sd * (0.42 + rand(-0.05, 0.08)) * S, (0.68 + rand(0, 0.08)) * S, rand(-0.1, 0.1) * S], [rand(-0.4, 0.4), rand(0, 3), sd * rand(0.2, 0.7)]); c.scale.y = rand(2.2, 3.4); } });
    P.ices = []; torso.traverse((o) => { if (o.material === ice) P.ices.push(o); });
    // マント
    const cape = pivot(torso, 0, 0.6 * S, -0.22 * S); P.cape = cape;
    const cg = new THREE.PlaneGeometry(0.85 * S, 1.75 * S, 4, 8), ca = cg.attributes.position;
    for (let i = 0; i < ca.count; i++) { const y = ca.getY(i), x = ca.getX(i); ca.setZ(i, -Math.cos(x * 3.5) * 0.05 * S - (0.875 * S - y) * 0.12); if (y < -0.7 * S) ca.setY(i, y - Math.random() * 0.08 * S); }
    cg.translate(0, -0.875 * S, 0); cg.computeVertexNormals();
    add(cape, cg, capeM);
    P.arms = [1, -1].map((sd) => { const L = limb(torso, sd * 0.42 * S, 0.45 * S, 0, 0.34 * S, 0.32 * S, 0.08 * S, steel, steel); add(L.end, new THREE.BoxGeometry(0.11 * S, 0.12 * S, 0.11 * S), silver); return L; });
    const sw = pivot(P.arms[0].end, 0, -0.05 * S, 0.02 * S); sw.rotation.x = Math.PI / 2 + 0.25; P.sword = sw;
    add(sw, new THREE.CylinderGeometry(0.022 * S, 0.022 * S, 0.3 * S, 8), steel, [0, -0.05 * S, 0]);
    add(sw, new THREE.BoxGeometry(0.36 * S, 0.04 * S, 0.06 * S), silver, [0, 0.12 * S, 0]);
    const bl = new THREE.Shape(); bl.moveTo(-0.05, 0); bl.lineTo(-0.06, 1.2); bl.lineTo(0, 1.45); bl.lineTo(0.06, 1.2); bl.lineTo(0.05, 0); bl.closePath();
    P.blade = add(sw, new THREE.ExtrudeGeometry(bl, { depth: 0.02, bevelEnabled: true, bevelSize: 0.01, bevelThickness: 0.01, bevelSegments: 1 }), ice, [0, 0.14 * S, -0.01 * S], null, S);
    P.bladeGlow = glow(sw, '#7ad8ff', 1.4, [0, 0.9 * S, 0]);
    P.legs = [1, -1].map((sd) => { const L = limb(body, sd * 0.16 * S, 0.95 * S, 0, 0.47 * S, 0.45 * S, 0.09 * S, steel, steel); add(L.end, new THREE.BoxGeometry(0.13 * S, 0.08 * S, 0.26 * S), silver, [0, 0.03 * S, 0.05 * S]); add(L.b, new THREE.SphereGeometry(0.08 * S, 8, 6), silver, [0, 0, 0.05 * S]); return L; });
  }, function (t, o) {
    const P = t.parts, sw = o.sw, k = o.k, tm = o.time + o.phase;
    P.legs[0].a.rotation.x = sw * 0.4; P.legs[1].a.rotation.x = -sw * 0.4; P.legs[0].b.rotation.x = Math.max(0, -sw) * 0.5; P.legs[1].b.rotation.x = Math.max(0, sw) * 0.5;
    const lift = k > 0 ? (k > 0.55 ? (1 - k) / 0.45 : k / 0.55) : 0;
    P.arms[0].a.rotation.x = -sw * 0.25 - lift * 2.7; P.arms[0].b.rotation.x = -0.3 - lift * 0.5;
    P.arms[1].a.rotation.x = sw * 0.25 - 0.3 - lift * 0.8; P.arms[1].b.rotation.x = -0.6;
    P.cape.rotation.x = 0.1 + Math.abs(sw) * 0.2 + Math.sin(tm * 1.3) * 0.05;
    P.bladeGlow.scale.setScalar(1.4 * (1 + Math.sin(tm * 3) * 0.1 + lift * 0.8));
    P.body.position.y = Math.abs(sw) * 0.05;
  });
})();
