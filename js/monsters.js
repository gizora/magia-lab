// ダンジョンの敵の見た目と動き（第29版）
// cutaway（Nyxera0x/cutaway、MIT）の進め方を参考にした: 1 体ずつ「らしさ」のチェック項目を決め、部品を組み、
// 同じ向きで撮った絵とくらべて直す。部品は関節ごとのグループにして、歩く・殴る・羽ばたくを動かせるようにしている
(function () {
  'use strict';
  const MG = window.MG, FX = MG.FX;
  const V3 = THREE.Vector3;
  const rand = (a, b) => a + Math.random() * (b - a);
  const MON = (MG.Monsters = {});

  // 部品を置く: add(親, 形, 材質, 位置, 回転, 大きさ)
  function add(parent, geo, mat, p, r, s) {
    const m = new THREE.Mesh(geo, mat);
    if (p) m.position.set(p[0], p[1], p[2]);
    if (r) m.rotation.set(r[0], r[1], r[2]);
    if (s) { if (typeof s === 'number') m.scale.setScalar(s); else m.scale.set(s[0], s[1], s[2]); }
    parent.add(m);
    return m;
  }
  function pivot(parent, x, y, z) { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; }
  // 骨（両はしにふくらみのある棒）。+Y の向きに len 伸びる
  function bone(parent, len, r, mat) {
    add(parent, new THREE.CylinderGeometry(r * 0.75, r * 0.85, len, 7), mat, [0, -len / 2, 0]);
    add(parent, new THREE.SphereGeometry(r * 1.25, 8, 6), mat, [0, 0, 0]);
    add(parent, new THREE.SphereGeometry(r * 1.15, 8, 6), mat, [0, -len, 0]);
  }
  function glow(parent, col, size, p) { const s = FX.glowSprite(col, size); if (p) s.position.set(p[0], p[1], p[2]); parent.add(s); return s; }
  // 頂点を少しずつずらして、手作りらしいゆがみを出す
  function jitter(geo, amt) {
    const pa = geo.attributes.position;
    for (let i = 0; i < pa.count; i++) pa.setXYZ(i, pa.getX(i) + rand(-amt, amt), pa.getY(i) + rand(-amt, amt), pa.getZ(i) + rand(-amt, amt));
    geo.computeVertexNormals();
    return geo;
  }

  // ======================================================================
  //  スライム: 半透明のゼリーの体、中に光る核・泡・飲みこんだ骨と金貨、つやのある大きな目、足もとの水たまり
  // ======================================================================
  function slime(std, g, P) {
    const gel = std({ color: 0x2fae4a, emissive: 0x0e5a22, emissiveIntensity: 0.4, roughness: 0.1, metalness: 0, transparent: true, opacity: 0.66, depthWrite: false });
    const body = new THREE.Group(); body.position.y = 0; g.add(body); P.body = body;
    // 体: 下が平たく、上が少しとがった、しずくのような形
    const bg = new THREE.SphereGeometry(0.8, 36, 26);
    const pa = bg.attributes.position;
    for (let i = 0; i < pa.count; i++) {
      let x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
      if (y < 0) y *= 0.42; else { const k = y / 0.8; y *= 1.05; x *= 1 - k * k * 0.18; z *= 1 - k * k * 0.18; }
      pa.setXYZ(i, x * (1 + Math.sin(y * 9) * 0.015), y + 0.34, z);
    }
    bg.computeVertexNormals();
    const shell = add(body, bg, gel); shell.renderOrder = 3; P.shell = shell;
    // 中身（体の中にうっすら見える）
    const coreM = std({ color: 0xd8ffb0, emissive: 0x9aff6a, emissiveIntensity: 1.6, roughness: 0.3 });
    P.core = add(body, new THREE.IcosahedronGeometry(0.17, 0), coreM, [0.05, 0.45, -0.05]);
    P.coreGlow = glow(body, '#9aff6a', 1.1, [0.05, 0.45, -0.05]);
    const bub = std({ color: 0xeaffea, emissive: 0x6ac87a, emissiveIntensity: 0.4, transparent: true, opacity: 0.55, roughness: 0.1 });
    P.bubbles = [];
    for (let i = 0; i < 7; i++) P.bubbles.push(add(body, new THREE.SphereGeometry(rand(0.03, 0.07), 8, 6), bub, [rand(-0.4, 0.4), rand(0.15, 0.8), rand(-0.35, 0.3)]));
    const boneM = std({ color: 0xe8e0c8, roughness: 0.7 });
    const swallowed = pivot(body, -0.22, 0.3, -0.1); swallowed.rotation.set(0.4, 0.3, 1.1); bone(swallowed, 0.32, 0.03, boneM);
    add(body, new THREE.CylinderGeometry(0.07, 0.07, 0.015, 14), std({ color: 0xe8b84a, metalness: 0.8, roughness: 0.3, emissive: 0x6a4a10, emissiveIntensity: 0.4 }), [0.28, 0.22, 0.05], [1.2, 0.3, 0]);
    // 目: 白目・黒目・光の点（体の表面から少し出す）
    const white = std({ color: 0xffffff, roughness: 0.15 }), black = std({ color: 0x101418, roughness: 0.2 }), shine = std({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1 });
    P.eyes = new THREE.Group(); P.eyes.position.set(0, 0.74, 0.7); P.eyes.scale.setScalar(1.25); body.add(P.eyes);
    [-1, 1].forEach((sd) => {
      const e = pivot(P.eyes, sd * 0.22, 0, 0);
      add(e, new THREE.SphereGeometry(0.15, 16, 12), white, [0, 0, 0], null, [1, 1.12, 0.8]);
      add(e, new THREE.SphereGeometry(0.075, 12, 10), black, [sd * -0.015, -0.01, 0.1]);
      add(e, new THREE.SphereGeometry(0.025, 8, 6), shine, [sd * -0.03, 0.035, 0.155]);
    });
    // 口（にやりとした弧）
    P.mouth = add(body, new THREE.TorusGeometry(0.13, 0.03, 6, 14, Math.PI), black, [0, 0.5, 0.78], [0.3, 0, Math.PI]);
    // 足もとの水たまりと、したたり
    const pud = std({ color: 0x3ac85a, emissive: 0x1a6a2a, emissiveIntensity: 0.4, roughness: 0.08, transparent: true, opacity: 0.6, depthWrite: false });
    P.puddle = add(g, new THREE.CircleGeometry(1.0, 28), pud, [0, 0.02, 0], [-Math.PI / 2, 0, 0]);
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2 + 0.3; add(body, new THREE.SphereGeometry(rand(0.06, 0.1), 10, 8), gel, [Math.cos(a) * 0.78, 0.06, Math.sin(a) * 0.78], null, [1, 0.7, 1]); }
  }

  // ======================================================================
  //  骸骨兵: 頭蓋骨（赤く光る目・動くあご）、背骨とあばら骨、関節で曲がる手足、さびた兜・剣・丸い木の盾、ぼろ布
  // ======================================================================
  function skeleton(std, g, P) {
    const boneM = std({ color: 0xe6dcc4, roughness: 0.72, emissive: 0x2a2418, emissiveIntensity: 0.25 });
    const dark = std({ color: 0x14100c, roughness: 0.9 });
    const rust = std({ color: 0x6a4a34, roughness: 0.6, metalness: 0.55 });
    const steel = std({ color: 0x9aa0a8, roughness: 0.35, metalness: 0.8 });
    const woodM = std({ color: 0x6a4428, roughness: 0.85 });
    const cloth = std({ color: 0x4a3a2a, roughness: 1, side: THREE.DoubleSide });
    const eyeM = std({ color: 0xff3a1a, emissive: 0xff2a0a, emissiveIntensity: 2 });
    const body = new THREE.Group(); g.add(body); P.body = body;
    // 骨盤
    add(body, new THREE.TorusGeometry(0.13, 0.045, 6, 12), boneM, [0, 0.98, 0], [Math.PI / 2, 0, 0], [1.25, 0.85, 1]);
    // 背骨（8 つの骨）
    for (let i = 0; i < 8; i++) add(body, new THREE.CylinderGeometry(0.04, 0.045, 0.06, 7), boneM, [0, 1.05 + i * 0.07, -0.04 + Math.sin(i * 0.4) * 0.02]);
    // あばら骨（左右 5 本ずつ、前へ曲がる）
    for (let i = 0; i < 5; i++) {
      const r = 0.17 - Math.abs(i - 1.5) * 0.018, y = 1.5 - i * 0.075;
      [-1, 1].forEach((sd) => { add(body, new THREE.TorusGeometry(r, 0.016, 5, 12, Math.PI * 0.8), boneM, [0, y, -0.03], [Math.PI / 2 + 0.25, 0, sd > 0 ? -0.3 : Math.PI + 0.3]); });
    }
    add(body, new THREE.BoxGeometry(0.05, 0.3, 0.03), boneM, [0, 1.38, 0.15]);
    add(body, new THREE.CylinderGeometry(0.022, 0.022, 0.5, 6), boneM, [0, 1.6, 0], [0, 0, Math.PI / 2]); // 鎖骨
    // 頭: 頭蓋骨・あご・目のくぼみ（赤い光）・歯・さびた兜
    const head = pivot(body, 0, 1.68, 0); P.head = head;
    add(head, new THREE.SphereGeometry(0.17, 18, 14), boneM, [0, 0.12, 0], null, [0.95, 1.05, 1.12]);
    add(head, new THREE.BoxGeometry(0.2, 0.08, 0.17), boneM, [0, 0.02, 0.05]);
    [-1, 1].forEach((sd) => { add(head, new THREE.SphereGeometry(0.048, 10, 8), dark, [sd * 0.065, 0.12, 0.15]); add(head, new THREE.SphereGeometry(0.018, 8, 6), eyeM, [sd * 0.065, 0.12, 0.175]); glow(head, '#ff3a1a', 0.22, [sd * 0.065, 0.12, 0.19]); });
    add(head, new THREE.ConeGeometry(0.02, 0.05, 3), dark, [0, 0.06, 0.19], [Math.PI, 0, 0]);
    for (let i = 0; i < 6; i++) add(head, new THREE.BoxGeometry(0.018, 0.028, 0.012), boneM, [-0.05 + i * 0.02, -0.005, 0.15]);
    const jaw = pivot(head, 0, 0.0, -0.04); P.jaw = jaw;
    add(jaw, new THREE.BoxGeometry(0.17, 0.045, 0.16), boneM, [0, -0.03, 0.09]);
    for (let i = 0; i < 6; i++) add(jaw, new THREE.BoxGeometry(0.018, 0.025, 0.012), boneM, [-0.05 + i * 0.02, -0.003, 0.17]);
    add(head, new THREE.SphereGeometry(0.19, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), rust, [0, 0.14, -0.01], null, [1, 0.85, 1.12]);
    add(head, new THREE.TorusGeometry(0.19, 0.018, 5, 18), rust, [0, 0.145, -0.01], [Math.PI / 2, 0, 0], [1, 1.12, 1]);
    add(head, new THREE.BoxGeometry(0.03, 0.12, 0.02), rust, [0, 0.16, 0.21]);
    // 腕（肩・ひじの関節）
    const arm = (sd) => {
      const sh = pivot(body, sd * 0.25, 1.58, 0); bone(sh, 0.3, 0.025, boneM);
      const el = pivot(sh, 0, -0.3, 0); bone(el, 0.28, 0.022, boneM);
      const hand = pivot(el, 0, -0.3, 0);
      add(hand, new THREE.BoxGeometry(0.06, 0.06, 0.03), boneM);
      for (let i = 0; i < 3; i++) add(hand, new THREE.CylinderGeometry(0.008, 0.008, 0.06, 4), boneM, [-0.02 + i * 0.02, -0.05, 0.01]);
      return { sh, el, hand };
    };
    P.arms = [arm(1), arm(-1)];
    // 右手にさびた剣、左手に丸い木の盾
    const sw = pivot(P.arms[0].hand, 0, -0.03, 0.02); sw.rotation.x = Math.PI / 2 + 0.35; // 剣先を前へ（少し上向き）
    add(sw, new THREE.CylinderGeometry(0.02, 0.02, 0.16, 6), woodM, [0, -0.04, 0]);
    add(sw, new THREE.BoxGeometry(0.2, 0.03, 0.04), rust, [0, 0.05, 0]);
    const blade = new THREE.BoxGeometry(0.055, 0.78, 0.012); jitter(blade, 0.004);
    add(sw, blade, steel, [0, 0.45, 0]);
    add(sw, new THREE.ConeGeometry(0.028, 0.1, 4), steel, [0, 0.89, 0], [0, Math.PI / 4, 0], [1, 1, 0.22]);
    const shield = pivot(P.arms[1].hand, 0, 0.02, 0.1); shield.rotation.y = -0.2;
    add(shield, new THREE.CylinderGeometry(0.27, 0.27, 0.04, 20), woodM, null, [Math.PI / 2, 0, 0]);
    add(shield, new THREE.TorusGeometry(0.27, 0.02, 5, 22), rust);
    add(shield, new THREE.SphereGeometry(0.06, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), rust, [0, 0, 0.02], [Math.PI / 2, 0, 0]);
    [-0.12, 0.12].forEach((x) => add(shield, new THREE.BoxGeometry(0.04, 0.5, 0.012), rust, [x, 0, 0.024]));
    // 脚（股・ひざ）
    const leg = (sd) => {
      const hip = pivot(body, sd * 0.11, 0.95, 0); bone(hip, 0.42, 0.03, boneM);
      const knee = pivot(hip, 0, -0.42, 0); bone(knee, 0.42, 0.026, boneM);
      add(knee, new THREE.BoxGeometry(0.08, 0.035, 0.18), boneM, [0, -0.44, 0.05]);
      return { hip, knee };
    };
    P.legs = [leg(1), leg(-1)];
    // 腰のぼろ布
    const rag = new THREE.PlaneGeometry(0.34, 0.32, 3, 3); jitter(rag, 0.02);
    add(body, rag, cloth, [0, 0.82, 0.12], [0.1, 0, 0]); add(body, rag, cloth, [0, 0.82, -0.12], [-0.1, 0, 0]);
  }

  // ======================================================================
  //  影コウモリ: 毛の体、大きな耳、赤い目、牙、指の骨が通った膜の翼（内と外で折れる）
  // ======================================================================
  function bat(std, g, P) {
    const fur = std({ color: 0x1e1622, roughness: 0.95, flatShading: true, emissive: 0x1a0a20, emissiveIntensity: 0.3 });
    const skin = std({ color: 0x4a2a44, roughness: 0.7 });
    const memb = std({ color: 0x2a1424, emissive: 0x3a0a22, emissiveIntensity: 0.3, roughness: 0.7, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
    const eyeM = std({ color: 0xff2a4a, emissive: 0xff2a4a, emissiveIntensity: 2 });
    const fang = std({ color: 0xffffff, roughness: 0.3 });
    const body = new THREE.Group(); g.add(body); P.body = body;
    add(body, jitter(new THREE.IcosahedronGeometry(0.26, 1), 0.02), fur, [0, 0, -0.04], null, [0.9, 1.05, 1.15]);
    const head = pivot(body, 0, 0.2, 0.2); P.head = head;
    add(head, jitter(new THREE.IcosahedronGeometry(0.17, 1), 0.012), fur);
    add(head, new THREE.ConeGeometry(0.07, 0.12, 6), skin, [0, -0.02, 0.15], [Math.PI / 2, 0, 0]);
    [-1, 1].forEach((sd) => {
      add(head, new THREE.ConeGeometry(0.075, 0.28, 5), fur, [sd * 0.1, 0.2, -0.02], [0, 0, -sd * 0.35], [1, 1, 0.45]);
      add(head, new THREE.ConeGeometry(0.04, 0.2, 5), skin, [sd * 0.1, 0.19, 0.005], [0, 0, -sd * 0.35], [1, 1, 0.3]);
      add(head, new THREE.SphereGeometry(0.03, 8, 6), eyeM, [sd * 0.065, 0.04, 0.14]); glow(head, '#ff2a4a', 0.28, [sd * 0.065, 0.04, 0.16]);
      add(head, new THREE.ConeGeometry(0.012, 0.06, 4), fang, [sd * 0.025, -0.09, 0.15], [Math.PI, 0, 0]);
    });
    // 翼: 腕の骨（2 本）と指の骨（3 本）、そのあいだの膜。外側は折れる
    const wing = (sd) => {
      const root = pivot(body, sd * 0.18, 0.06, 0);
      const armB = pivot(root, 0, 0, 0); armB.rotation.z = -sd * Math.PI / 2;
      add(armB, new THREE.CylinderGeometry(0.018, 0.022, 0.42, 5), skin, [0, -0.21, 0]);
      const outer = pivot(armB, 0, -0.42, 0); P['outer' + sd] = outer;
      add(outer, new THREE.CylinderGeometry(0.012, 0.018, 0.4, 5), skin, [0, -0.2, 0]);
      // 指（翼のふちまで）
      const tips = [[0.12, -0.75], [0.45, -0.62], [0.62, -0.32]];
      tips.forEach(([z, y]) => { const len = Math.hypot(z, y); const f = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.01, len, 4), skin); f.position.set(0, -0.4 + y / 2, z / 2); f.rotation.x = Math.atan2(z, -y); outer.add(f); });
      // 膜（内側: 体から肘まで / 外側: 肘から指先まで。ふちは波形）
      const inner = new THREE.Shape(); inner.moveTo(0, 0); inner.lineTo(0, -0.42); inner.lineTo(0.42, -0.44); inner.quadraticCurveTo(0.3, -0.22, 0.38, 0.02); inner.lineTo(0, 0);
      const mi = new THREE.Mesh(new THREE.ShapeGeometry(inner, 6), memb); mi.rotation.y = -Math.PI / 2; armB.add(mi);
      const os = new THREE.Shape(); os.moveTo(0, 0); os.lineTo(0, -0.4);
      tips.forEach(([z, y], i) => { os.lineTo(z, -0.4 + y); if (i < tips.length - 1) os.quadraticCurveTo((z + tips[i + 1][0]) / 2 - 0.05, -0.4 + (y + tips[i + 1][1]) / 2 + 0.12, tips[i + 1][0], -0.4 + tips[i + 1][1]); });
      os.quadraticCurveTo(0.42, -0.25, 0.42, -0.02); os.lineTo(0, 0);
      const mo = new THREE.Mesh(new THREE.ShapeGeometry(os, 6), memb); mo.rotation.y = -Math.PI / 2; outer.add(mo);
      return { root, armB, outer };
    };
    P.wings = [wing(1), wing(-1)];
    add(body, new THREE.ConeGeometry(0.05, 0.22, 5), skin, [0, -0.06, -0.3], [-Math.PI / 2 - 0.4, 0, 0]);
    [-1, 1].forEach((sd) => add(body, new THREE.ConeGeometry(0.025, 0.1, 4), skin, [sd * 0.08, -0.26, -0.05], [0.4, 0, 0]));
  }

  // ======================================================================
  //  闇の魔導士: すそがぼろぼろのローブ、フードの中は闇で光る目だけ、骨の手、ねじれた杖と光る宝玉、まわりを回るルーン
  // ======================================================================
  function mage(std, g, P) {
    const robe = std({ color: 0x140e1c, roughness: 0.95, emissive: 0x12061e, emissiveIntensity: 0.4, side: THREE.DoubleSide });
    const robe2 = std({ color: 0x3a2050, roughness: 0.9, emissive: 0x2a1040, emissiveIntensity: 0.35, side: THREE.DoubleSide });
    const voidM = std({ color: 0x020104, roughness: 1 });
    const eyeM = std({ color: 0xd8a8ff, emissive: 0xb07aff, emissiveIntensity: 2.4 });
    const boneM = std({ color: 0xbab0c8, roughness: 0.7 });
    const woodM = std({ color: 0x3a2a1e, roughness: 0.9 });
    const gold = std({ color: 0xb8903a, metalness: 0.75, roughness: 0.35 });
    const orbM = std({ color: 0xc8a8ff, emissive: 0x8a4aff, emissiveIntensity: 2, roughness: 0.15, flatShading: true });
    const body = new THREE.Group(); g.add(body); P.body = body;
    // ローブ（回転体。すそはぎざぎざ）
    const prof = [[0.58, 0], [0.5, 0.25], [0.4, 0.7], [0.32, 1.1], [0.27, 1.38], [0.24, 1.5], [0.12, 1.6], [0.001, 1.62]].map(([r, y]) => new THREE.Vector2(r, y));
    const rg = new THREE.LatheGeometry(prof, 22);
    const pa = rg.attributes.position;
    for (let i = 0; i < pa.count; i++) { if (pa.getY(i) < 0.02) { const a = Math.atan2(pa.getZ(i), pa.getX(i)); pa.setY(i, 0.04 + Math.abs(Math.sin(a * 5.5)) * 0.18 + rand(0, 0.05)); } }
    rg.computeVertexNormals();
    P.robe = add(body, rg, robe);
    const inner = new THREE.LatheGeometry(prof.map((v) => new THREE.Vector2(v.x * 0.86, v.y * 0.9)), 16); add(body, inner, robe2, [0, 0.02, 0]);
    // 肩かけ（高いえり）
    add(body, new THREE.CylinderGeometry(0.2, 0.42, 0.42, 16, 1, true), robe2, [0, 1.38, 0]);
    add(body, new THREE.CylinderGeometry(0.21, 0.19, 0.22, 16, 1, true, -Math.PI * 0.8, Math.PI * 1.6), robe, [0, 1.62, -0.02]);
    // フード（前が開いた半球）と、中の闇・光る目
    const head = pivot(body, 0, 1.78, 0); P.head = head;
    add(head, new THREE.SphereGeometry(0.22, 18, 14, Math.PI * 0.62, Math.PI * 1.76), robe, [0, 0, -0.01], [0, 0, 0], [1, 1.15, 1.15]);
    add(head, new THREE.ConeGeometry(0.12, 0.3, 10), robe, [0, 0.2, -0.12], [-0.9, 0, 0]);
    add(head, new THREE.SphereGeometry(0.17, 14, 10), voidM, [0, -0.02, 0.02]);
    [-1, 1].forEach((sd) => { add(head, new THREE.SphereGeometry(0.022, 8, 6), eyeM, [sd * 0.06, 0.0, 0.17], null, [1.4, 0.7, 1]); glow(head, '#b07aff', 0.35, [sd * 0.06, 0, 0.19]); });
    // 袖と骨の手
    const sleeve = (sd) => {
      const sh = pivot(body, sd * 0.3, 1.42, 0.05);
      add(sh, new THREE.CylinderGeometry(0.08, 0.16, 0.5, 10, 1, true), robe, [0, -0.25, 0.05], [0.25, 0, 0]);
      const hand = pivot(sh, 0, -0.52, 0.12);
      add(hand, new THREE.BoxGeometry(0.06, 0.06, 0.04), boneM);
      for (let i = 0; i < 4; i++) add(hand, new THREE.CylinderGeometry(0.007, 0.006, 0.08, 4), boneM, [-0.024 + i * 0.016, -0.06, 0.01], [0.2, 0, 0]);
      return { sh, hand };
    };
    P.arms = [sleeve(1), sleeve(-1)];
    // 杖（ねじれた木。上で根が宝玉をつかむ）と宝玉
    const staff = pivot(P.arms[0].hand, 0, -0.02, 0.02); P.staff = staff;
    const curve = new THREE.CatmullRomCurve3([new V3(0, -1.0, 0), new V3(0.03, -0.4, 0.02), new V3(-0.02, 0.3, -0.01), new V3(0.02, 0.85, 0.02), new V3(0, 1.05, 0)]);
    add(staff, new THREE.TubeGeometry(curve, 24, 0.028, 6), woodM);
    for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2; const c2 = new THREE.CatmullRomCurve3([new V3(0, 0.95, 0), new V3(Math.cos(a) * 0.09, 1.08, Math.sin(a) * 0.09), new V3(Math.cos(a) * 0.06, 1.25, Math.sin(a) * 0.06)]); add(staff, new THREE.TubeGeometry(c2, 8, 0.012, 4), woodM); }
    P.orb = add(staff, new THREE.OctahedronGeometry(0.1, 1), orbM, [0, 1.17, 0]);
    P.orbGlow = glow(staff, '#a06aff', 1.4, [0, 1.17, 0]);
    // ベルトと小袋
    add(body, new THREE.TorusGeometry(0.33, 0.025, 5, 20), gold, [0, 0.98, 0], [Math.PI / 2, 0, 0]);
    add(body, new THREE.BoxGeometry(0.1, 0.12, 0.06), std({ color: 0x4a3020, roughness: 0.9 }), [0.25, 0.9, 0.2], [0, -0.6, 0]);
    // 腰のまわりを回るルーン（光る札）
    const runeTex = FX.circleTex;
    const runeM = new THREE.MeshBasicMaterial({ map: runeTex, color: 0xb07aff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    P.runes = new THREE.Group(); P.runes.position.y = 0.95; body.add(P.runes);
    for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2; const r = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), runeM); r.position.set(Math.cos(a) * 0.62, Math.sin(a * 2) * 0.05, Math.sin(a) * 0.62); r.rotation.y = -a + Math.PI / 2; P.runes.add(r); }
  }

  // ======================================================================
  //  石の守護者（ボス）: 切り出した石を積んだ体、ひとつ目、肩の水晶、苔、光るルーンの刻み、手首の切れた鎖
  // ======================================================================
  function boss(std, g, P) {
    const stone = std({ color: 0x4e4a44, roughness: 0.95, flatShading: true, emissive: 0x0a0806, emissiveIntensity: 1 });
    const stoneD = std({ color: 0x36332e, roughness: 1, flatShading: true });
    const moss = std({ color: 0x3a5a2a, roughness: 1, flatShading: true });
    const rune = std({ color: 0xff8a3a, emissive: 0xff5a1a, emissiveIntensity: 2.2 });
    const crys = std({ color: 0x8ae8ff, emissive: 0x3ab8ff, emissiveIntensity: 1.4, roughness: 0.15, flatShading: true });
    const iron = std({ color: 0x3a3a3e, roughness: 0.5, metalness: 0.8 });
    const block = (parent, w, h, d, p, mat) => add(parent, jitter(new THREE.BoxGeometry(w, h, d, 2, 2, 2), Math.min(w, h, d) * 0.06), mat || stone, p, [rand(-0.05, 0.05), rand(-0.08, 0.08), rand(-0.05, 0.05)]);
    const body = new THREE.Group(); g.add(body); P.body = body;
    // 腰・腹・胸（逆三角に積む）
    block(body, 1.7, 0.8, 1.2, [0, 2.65, 0]);
    block(body, 1.5, 0.9, 1.1, [0, 3.4, 0.02]);
    block(body, 2.8, 1.5, 1.6, [0, 4.55, 0]);
    block(body, 0.9, 0.7, 0.3, [0, 4.6, 0.8], stoneD);
    // 胸の核と、ルーンの刻み
    P.core = add(body, new THREE.OctahedronGeometry(0.22, 0), rune, [0, 4.6, 0.97]);
    P.coreGlow = glow(body, '#ff6a2a', 2.2, [0, 4.6, 1.0]);
    [[-0.9, 4.9, 0.81, 0.06, 0.8, -0.4], [0.9, 4.9, 0.81, 0.06, 0.8, 0.4], [0, 4.05, 0.81, 1.4, 0.06, 0], [-0.55, 3.4, 0.58, 0.05, 0.5, 0.2], [0.55, 3.4, 0.58, 0.05, 0.5, -0.2]].forEach(([x, y, z, w, h, rz]) => add(body, new THREE.BoxGeometry(w, h, 0.03), rune, [x, y, z], [0, 0, rz]));
    // 苔（上を向いた面に）
    [[0.6, 5.32, 0.2, 0.9], [-0.7, 5.32, -0.3, 0.7], [0.2, 3.88, 0.4, 0.6]].forEach(([x, y, z, s]) => add(body, jitter(new THREE.IcosahedronGeometry(0.4, 1), 0.05), moss, [x, y, z], null, [s * 1.4, 0.25, s]));
    // 頭: ひとつ目（光る）と太いまゆ
    const head = pivot(body, 0, 5.35, 0.1); P.head = head;
    block(head, 1.0, 0.85, 0.9, [0, 0.45, 0]);
    block(head, 1.1, 0.22, 0.4, [0, 0.72, 0.38], stoneD);
    P.eye = add(head, new THREE.SphereGeometry(0.16, 14, 10), rune, [0, 0.48, 0.46], null, [1.4, 0.9, 0.6]);
    P.eyeGlow = glow(head, '#ff6a2a', 1.6, [0, 0.48, 0.55]);
    // 肩の岩と水晶
    [-1, 1].forEach((sd) => {
      add(body, jitter(new THREE.DodecahedronGeometry(0.75, 0), 0.06), stone, [sd * 1.65, 5.1, 0], [0.3, sd, 0.2]);
      for (let i = 0; i < 4; i++) { const c = add(body, new THREE.OctahedronGeometry(rand(0.15, 0.26), 0), crys, [sd * (1.55 + rand(-0.25, 0.25)), 5.65 + rand(0, 0.25), rand(-0.3, 0.3)], [rand(-0.5, 0.5), rand(0, 3), sd * rand(0.1, 0.6)]); c.scale.y = rand(2.2, 3.4); }
      glow(body, '#3ab8ff', 1.8, [sd * 1.6, 6, 0]);
    });
    // 腕（肩・ひじ）と、こぶし・切れた鎖
    const arm = (sd) => {
      const sh = pivot(body, sd * 1.7, 4.95, 0);
      block(sh, 0.85, 1.4, 0.85, [0, -0.7, 0]);
      add(sh, new THREE.BoxGeometry(0.05, 0.9, 0.03), rune, [sd * 0.43, -0.7, 0.25]);
      const el = pivot(sh, 0, -1.4, 0);
      block(el, 0.95, 1.2, 0.95, [0, -0.6, 0.05]);
      block(el, 1.2, 0.9, 1.15, [0, -1.55, 0.1], stoneD);
      add(el, new THREE.TorusGeometry(0.55, 0.07, 6, 16), iron, [0, -0.95, 0.05], [Math.PI / 2, 0, 0]);
      for (let i = 0; i < 4; i++) add(el, new THREE.TorusGeometry(0.1, 0.03, 5, 10), iron, [sd * 0.5, -1.05 - i * 0.16, 0.2], [0, i % 2 ? Math.PI / 2 : 0, 0]);
      return { sh, el };
    };
    P.arms = [arm(1), arm(-1)];
    // 脚（太い柱とひざの石）
    const leg = (sd) => {
      const hip = pivot(body, sd * 0.6, 2.4, 0);
      block(hip, 0.85, 1.25, 0.9, [0, -0.6, 0]);
      block(hip, 0.7, 0.4, 0.5, [0, -1.15, 0.35], stoneD);
      block(hip, 0.8, 1.05, 0.85, [0, -1.75, 0]);
      block(hip, 1.0, 0.3, 1.3, [0, -2.25, 0.15], stoneD);
      return { hip };
    };
    P.legs = [leg(1), leg(-1)];
    // 足もとの、ひびの入った地面の光
    const ring = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.MeshBasicMaterial({ map: FX.circleTex, color: 0xff6a2a, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; g.add(ring); P.ring = ring;
  }

  // 軽くする: 動かす部品（parts に入っているもの）以外は、同じ関節の中で同じ材質どうしを 1 つの形にまとめる（描く回数を減らす）
  function bake(root, parts) {
    const keep = new Set();
    const mark = (v) => { if (!v) return; if (v.isObject3D) { keep.add(v); return; } if (Array.isArray(v)) v.forEach(mark); else if (typeof v === 'object') Object.values(v).forEach(mark); };
    mark(parts);
    const visit = (node) => {
      const groups = new Map();
      node.children.slice().forEach((c) => {
        if (c.isMesh && !keep.has(c) && !c.isSprite && c.children.length === 0 && !Array.isArray(c.material)) {
          if (!groups.has(c.material)) groups.set(c.material, []);
          groups.get(c.material).push(c);
        } else visit(c);
      });
      groups.forEach((list, mat) => {
        if (list.length < 2) return;
        const pos = [], nor = [], uv = [];
        list.forEach((m) => {
          m.updateMatrix();
          const gg = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(m.matrix);
          const p = gg.attributes.position, n = gg.attributes.normal, u = gg.attributes.uv;
          for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); if (n) nor.push(n.getX(i), n.getY(i), n.getZ(i)); else nor.push(0, 1, 0); if (u) uv.push(u.getX(i), u.getY(i)); else uv.push(0, 0); }
          node.remove(m);
        });
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        const merged = new THREE.Mesh(geo, mat); merged.renderOrder = list[0].renderOrder;
        node.add(merged);
      });
    };
    visit(root);
  }
  const BUILD = { slime, skeleton, bat, mage, boss };
  // 敵の見た目を作る。mats には色を変える材質（当たったときに白く光らせるなど）を入れる
  MON.build = function (kind, mats) {
    const g = new THREE.Group(), parts = {};
    const std = (o) => { const m = new THREE.MeshStandardMaterial(o); m.userData.baseEmissive = new THREE.Color(o.emissive || 0); m.userData.baseInt = o.emissiveIntensity == null ? 1 : o.emissiveIntensity; mats.push(m); return m; };
    (BUILD[kind] || slime)(std, g, parts);
    bake(g, parts);
    return { g, parts };
  };
  // 動き: o = { sw（歩きの揺れ -1〜1）, k（攻撃のため 0〜1）, speed, time, dt, phase }
  MON.animate = function (t, o) {
    const P = t.parts, sw = o.sw, k = o.k, tm = o.time + o.phase;
    const strike = k > 0 ? Math.sin(k * Math.PI) : 0;
    if (t.kind === 'slime') {
      // ぷるぷる・跳ねる。ためで縦にのびて、ぱっと広がる
      const hop = o.speed > 0.2 ? Math.abs(Math.sin(o.walk * 0.9)) : 0;
      const sq = 1 + Math.sin(tm * 5) * 0.05 - hop * 0.12 + strike * 0.3;
      P.body.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
      P.body.position.y = hop * 0.25;
      P.core.rotation.y += o.dt * 2; P.core.position.y = 0.45 + Math.sin(tm * 2) * 0.05;
      P.bubbles.forEach((b, i) => { b.position.y += o.dt * (0.15 + i * 0.03); if (b.position.y > 0.85) b.position.y = 0.12; });
      P.eyes.scale.y = Math.sin(tm * 1.3) > 0.97 ? 0.2 : 1; // まばたき
      P.puddle.scale.setScalar(1 + strike * 0.3);
    } else if (t.kind === 'skeleton') {
      P.legs[0].hip.rotation.x = sw * 0.55; P.legs[1].hip.rotation.x = -sw * 0.55;
      P.legs[0].knee.rotation.x = Math.max(0, -sw) * 0.7; P.legs[1].knee.rotation.x = Math.max(0, sw) * 0.7;
      // 剣を振りかぶって、振り下ろす
      const lift = k > 0 ? (k < 0.6 ? k / 0.6 : 1 - (k - 0.6) / 0.4 * 1.6) : 0;
      P.arms[0].sh.rotation.x = -sw * 0.35 - lift * 2.4; P.arms[0].el.rotation.x = -0.3 - lift * 0.5;
      P.arms[1].sh.rotation.x = sw * 0.35 - 0.5; P.arms[1].el.rotation.x = -0.9;
      P.jaw.rotation.x = 0.1 + Math.max(0, Math.sin(tm * 9)) * 0.25 + strike * 0.3;
      P.head.rotation.y = Math.sin(tm * 0.7) * 0.15;
      P.body.position.y = Math.abs(sw) * 0.04;
      P.body.rotation.z = sw * 0.04;
    } else if (t.kind === 'bat') {
      const fl = Math.sin(tm * 15);
      P.wings.forEach((w, i) => { const sd = i ? -1 : 1; w.root.rotation.z = sd * (fl * 0.55 + 0.1); w.outer.rotation.z = sd * (Math.max(0, -fl) * 0.7); });
      P.body.position.y = Math.sin(tm * 15 + 0.6) * 0.06;
      P.head.rotation.x = strike * -0.5;
    } else if (t.kind === 'mage') {
      P.body.position.y = 0.06 + Math.sin(tm * 1.8) * 0.06;
      P.robe.rotation.y = Math.sin(tm * 1.2) * 0.08;
      P.runes.rotation.y += o.dt * 1.4;
      const raise = strike;
      P.arms[0].sh.rotation.x = -0.4 - raise * 1.2; P.arms[1].sh.rotation.x = -0.5 - raise * 0.6;
      P.orb.rotation.y += o.dt * 3; P.orbGlow.scale.setScalar(1.4 + raise * 1.6 + Math.sin(tm * 4) * 0.15);
    } else if (t.kind === 'boss') {
      P.legs[0].hip.rotation.x = sw * 0.32; P.legs[1].hip.rotation.x = -sw * 0.32;
      const lift = k > 0 ? (k > 0.55 ? (1 - k) / 0.45 : k / 0.55) : 0;
      P.arms[0].sh.rotation.x = -sw * 0.25 - lift * 2.7; P.arms[1].sh.rotation.x = sw * 0.25 - lift * 2.7;
      P.arms[0].el.rotation.x = -0.25 - lift * 0.4; P.arms[1].el.rotation.x = -0.25 - lift * 0.4;
      P.head.rotation.x = -lift * 0.2;
      P.body.position.y = Math.abs(sw) * 0.08;
      P.core.rotation.y += o.dt * 1.5;
      const pulse = 1 + Math.sin(tm * 3) * 0.15 + lift * 0.8;
      P.coreGlow.scale.setScalar(2.2 * pulse); P.eyeGlow.scale.setScalar(1.6 * pulse);
      P.ring.rotation.z += o.dt * 0.5;
    }
  };
  MON.KINDS = Object.keys(BUILD);
})();
