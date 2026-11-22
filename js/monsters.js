// ダンジョンの敵の見た目と動き（第29版で作り込み、第30版でユーザーの参考の絵に合わせ、第32版でスライム・骸骨兵・コウモリをリアルでダークに作り直した）
// cutaway（Nyxera0x/cutaway、MIT）の進め方を参考にした: 1 体ずつ「らしさ」のチェック項目を決め、部品を組み、
// 同じ向きで撮った絵とくらべて直す。部品は関節ごとのグループにして、歩く・殴る・羽ばたくを動かせるようにしている。
// 参考の絵（ゲーム素材/ のスライム・骸骨兵・コウモリ・闇の魔導士・石の守護者）は見比べるためだけに使い、ゲームには入れていない
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
  // 骨（両はしにふくらみのある棒）。-Y の向きに len 伸びる
  function bone(parent, len, r, mat) {
    add(parent, new THREE.CylinderGeometry(r * 0.75, r * 0.85, len, 7), mat, [0, -len / 2, 0]);
    add(parent, new THREE.SphereGeometry(r * 1.25, 8, 6), mat, [0, 0, 0]);
    add(parent, new THREE.SphereGeometry(r * 1.15, 8, 6), mat, [0, -len, 0]);
  }
  function glow(parent, col, size, p) { const s = FX.glowSprite(col, size); if (p) s.position.set(p[0], p[1], p[2]); parent.add(s); return s; }
  // 頂点を少しずつずらして、手作りらしいゆがみを出す（同じ位置の頂点は同じだけずらし、割れ目を作らない）
  function jitter(geo, amt) {
    const pa = geo.attributes.position, memo = new Map();
    for (let i = 0; i < pa.count; i++) {
      const k = pa.getX(i).toFixed(4) + ',' + pa.getY(i).toFixed(4) + ',' + pa.getZ(i).toFixed(4);
      if (!memo.has(k)) memo.set(k, [rand(-amt, amt), rand(-amt, amt), rand(-amt, amt)]);
      const d = memo.get(k);
      pa.setXYZ(i, pa.getX(i) + d[0], pa.getY(i) + d[1], pa.getZ(i) + d[2]);
    }
    geo.computeVertexNormals();
    return geo;
  }
  const tube = (pts, r, seg) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new V3(p[0], p[1], p[2]))), seg || 16, r, 6);

  // ======================================================================
  //  スライム（第32版: リアルでダークに）
  //  チェック項目: 顔のない暗い緑の粘液／表面がゆっくりうねる／中に溶けかけた頭蓋骨と骨・泡・にぶく光る核が透ける／
  //               すそがたれて、ぬめった水たまりを作る
  // ======================================================================
  function slime(std, g, P) {
    const gel = std({ color: 0x24401a, emissive: 0x06160a, emissiveIntensity: 0.6, roughness: 0.03, metalness: 0.2, transparent: true, opacity: 0.8, depthWrite: false });
    const murk = std({ color: 0x18280c, roughness: 0.3, transparent: true, opacity: 0.55, depthWrite: false });
    const boneM = std({ color: 0xb8ab84, roughness: 0.8, transparent: true, opacity: 0.9 });
    const dark = std({ color: 0x141008, roughness: 1 });
    const nucleus = std({ color: 0xc8e070, emissive: 0x9ac030, emissiveIntensity: 1.3, roughness: 0.4 });
    const bub = std({ color: 0xd0f0a0, roughness: 0.05, transparent: true, opacity: 0.45, depthWrite: false });
    const body = new THREE.Group(); g.add(body); P.body = body;
    // 体: 下が平たく広がり、上が少したるんだ粘液のかたまり（場所ごとにふくらみがちがう）
    const bg = new THREE.SphereGeometry(0.85, 48, 32), pa = bg.attributes.position;
    const lump = (x, y, z) => Math.sin(x * 4.1 + z * 2.3) * 0.06 + Math.sin(z * 5.3 - y * 3.1) * 0.05 + Math.sin(x * 9 + y * 7) * 0.015;
    for (let i = 0; i < pa.count; i++) {
      let x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
      const k = 1 + lump(x, y, z);
      if (y < 0) y *= 0.16; else y *= 0.86 - Math.max(0, y - 0.55) * 0.18;
      const sag = y < 0.12 ? 1 + (0.12 - y) * 0.5 : 1; // すそが外へたれる
      pa.setXYZ(i, x * k * sag, y * k + 0.13, z * k * sag);
    }
    bg.computeVertexNormals();
    P.shell = add(body, bg, gel); P.shell.renderOrder = 3;
    P.ooze = { pos: pa, base: Float32Array.from(pa.array), nrm: Float32Array.from(bg.attributes.normal.array) };
    add(body, jitter(new THREE.IcosahedronGeometry(0.42, 2), 0.05), murk, [0.05, 0.4, -0.05], null, [1.2, 0.75, 1.1]).renderOrder = 2;
    // 中身: 溶けかけた頭蓋骨（目のくぼみ・あご）と骨、にぶく光る核、泡
    const skull = pivot(body, -0.18, 0.38, 0.12); skull.rotation.set(0.5, 0.6, 0.35); P.skull = skull;
    add(skull, new THREE.SphereGeometry(0.13, 14, 10), boneM, null, null, [0.95, 0.9, 1.1]);
    [-1, 1].forEach((sd) => add(skull, new THREE.SphereGeometry(0.036, 8, 6), dark, [sd * 0.045, 0.0, 0.105]));
    add(skull, new THREE.BoxGeometry(0.12, 0.04, 0.09), boneM, [0, -0.08, 0.05]);
    const b1 = pivot(body, 0.28, 0.3, -0.1); b1.rotation.set(0.3, 0.2, 1.3); bone(b1, 0.34, 0.025, boneM);
    const b2 = pivot(body, 0.05, 0.22, 0.32); b2.rotation.set(1.2, 0.8, 0.4); bone(b2, 0.22, 0.02, boneM);
    P.core = add(body, jitter(new THREE.IcosahedronGeometry(0.1, 1), 0.02), nucleus, [0.12, 0.5, -0.12]);
    P.coreGlow = glow(body, '#9ac030', 0.7, [0.12, 0.5, -0.12]);
    P.bubbles = [];
    for (let i = 0; i < 10; i++) P.bubbles.push(add(body, new THREE.SphereGeometry(rand(0.018, 0.05), 8, 6), bub, [rand(-0.45, 0.45), rand(0.1, 0.6), rand(-0.4, 0.4)]));
    // ぬめった水たまり（ふちが不ぞろい）
    const ps = new THREE.Shape();
    for (let i = 0; i <= 40; i++) { const a = (i / 40) * Math.PI * 2, r = 1.02 + Math.sin(a * 5) * 0.08 + Math.sin(a * 11 + 1) * 0.04; if (i === 0) ps.moveTo(Math.cos(a) * r, Math.sin(a) * r); else ps.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    const pud = std({ color: 0x142a0c, emissive: 0x040e02, emissiveIntensity: 0.5, roughness: 0.02, metalness: 0.3, transparent: true, opacity: 0.75, depthWrite: false });
    P.puddle = add(g, new THREE.ShapeGeometry(ps), pud, [0, 0.02, 0], [-Math.PI / 2, 0, 0]);
  }

  // ======================================================================
  //  骸骨兵（第32版: リアルでダークに）
  //  チェック項目: 眉の骨・頬骨・鼻の穴・不ぞろいの歯のある頭蓋骨と、奥に赤い光の眼窩／背骨のとげと肩甲骨・胸骨につながるあばら骨／
  //               腕と脚の 2 本の骨・指の骨／黄ばんで汚れた骨／さびた鉄の兜（鼻あて）・肩当て・刃こぼれした剣・板張りの丸盾・ぼろ布
  // ======================================================================
  function skeleton(std, g, P) {
    const grime = FX.canvasTex(128, 128, (c, w) => {
      c.fillStyle = '#ffffff'; c.fillRect(0, 0, w, w);
      for (let i = 0; i < 220; i++) { c.fillStyle = `rgba(${rand(60, 110) | 0},${rand(45, 80) | 0},${rand(25, 50) | 0},${rand(0.08, 0.3)})`; c.beginPath(); c.ellipse(rand(0, w), rand(0, w), rand(2, 12), rand(1, 6), rand(0, 3), 0, Math.PI * 2); c.fill(); }
      c.strokeStyle = 'rgba(40,28,16,0.35)'; c.lineWidth = 1; for (let i = 0; i < 30; i++) { c.beginPath(); let x = rand(0, w), y = rand(0, w); c.moveTo(x, y); for (let k = 0; k < 3; k++) { x += rand(-12, 12); y += rand(-12, 12); c.lineTo(x, y); } c.stroke(); }
    });
    grime.wrapS = grime.wrapT = THREE.RepeatWrapping;
    const boneM = std({ color: 0xcbbd98, map: grime, roughness: 0.82, emissive: 0x16120a, emissiveIntensity: 0.4 });
    const dark = std({ color: 0x080604, roughness: 1 });
    const rust = std({ color: 0x5a3a26, roughness: 0.75, metalness: 0.55 });
    const ironM = std({ color: 0x4a4440, roughness: 0.55, metalness: 0.75 });
    const steel = std({ color: 0x8a847c, roughness: 0.45, metalness: 0.8 });
    const woodM = std({ color: 0x4a3420, roughness: 0.9 });
    const cloth = std({ color: 0x2a221c, roughness: 1, side: THREE.DoubleSide });
    const eyeM = std({ color: 0xff3a1a, emissive: 0xff2a0a, emissiveIntensity: 2.4 });
    const body = new THREE.Group(); g.add(body); P.body = body;
    // 骨盤（腸骨の翼・仙骨）
    [-1, 1].forEach((sd) => add(body, new THREE.SphereGeometry(0.11, 12, 10), boneM, [sd * 0.12, 1.03, -0.01], [0.2, sd * 0.5, sd * 0.45], [1.15, 0.85, 0.38]));
    add(body, new THREE.ConeGeometry(0.06, 0.16, 6), boneM, [0, 0.96, -0.05], [Math.PI, 0, 0]);
    add(body, new THREE.TorusGeometry(0.1, 0.03, 6, 12, Math.PI), boneM, [0, 0.93, 0.04], [Math.PI / 2 + 0.3, 0, 0]);
    // 背骨（椎骨と、後ろへ出るとげ）
    for (let i = 0; i < 10; i++) { const y = 1.05 + i * 0.06, z = -0.05 + Math.sin(i * 0.35) * 0.025; add(body, new THREE.CylinderGeometry(0.035, 0.04, 0.045, 8), boneM, [0, y, z]); add(body, new THREE.BoxGeometry(0.018, 0.03, 0.06), boneM, [0, y, z - 0.05], [0.4, 0, 0]); }
    // あばら骨（7 本ずつ、下へ傾いて胸骨につながる）と胸骨・鎖骨・肩甲骨
    for (let i = 0; i < 7; i++) {
      const r = 0.165 - Math.abs(i - 2.2) * 0.014, y = 1.55 - i * 0.056;
      [-1, 1].forEach((sd) => { add(body, new THREE.TorusGeometry(r, 0.013, 5, 14, Math.PI * (i > 4 ? 0.7 : 0.88)), boneM, [0, y, -0.03], [Math.PI / 2 + 0.38, 0, sd > 0 ? -0.25 : Math.PI + 0.25]); });
    }
    add(body, new THREE.BoxGeometry(0.045, 0.26, 0.025), boneM, [0, 1.42, 0.13], [0.1, 0, 0]);
    [-1, 1].forEach((sd) => { add(body, new THREE.CylinderGeometry(0.014, 0.016, 0.24, 6), boneM, [sd * 0.12, 1.6, 0.06], [0.2, 0, Math.PI / 2 - sd * 0.12]); add(body, new THREE.ConeGeometry(0.1, 0.2, 3), boneM, [sd * 0.13, 1.5, -0.12], [Math.PI, sd * 0.4, 0], [1, 1, 0.25]); });
    for (let i = 0; i < 4; i++) add(body, new THREE.CylinderGeometry(0.026, 0.028, 0.03, 7), boneM, [0, 1.65 + i * 0.04, -0.02]); // 首の骨
    // 頭: 頭蓋骨・眉の骨・頬骨・深い眼窩（奥に赤い光）・鼻の穴・上あごの不ぞろいな歯・動く下あご
    const head = pivot(body, 0, 1.8, 0); P.head = head;
    add(head, new THREE.SphereGeometry(0.15, 22, 18), boneM, [0, 0.07, -0.01], null, [0.92, 1.0, 1.12]);
    add(head, new THREE.BoxGeometry(0.2, 0.035, 0.05), boneM, [0, 0.07, 0.12], [0.2, 0, 0]); // 眉の骨
    [-1, 1].forEach((sd) => {
      add(head, new THREE.SphereGeometry(0.038, 12, 10), dark, [sd * 0.05, 0.025, 0.122], null, [1.05, 0.9, 0.8]);
      add(head, new THREE.SphereGeometry(0.009, 6, 5), eyeM, [sd * 0.052, 0.022, 0.13]); glow(head, '#ff2a0a', 0.07, [sd * 0.052, 0.022, 0.15]);
      add(head, new THREE.CapsuleGeometry ? new THREE.CapsuleGeometry(0.018, 0.07, 4, 8) : new THREE.CylinderGeometry(0.018, 0.018, 0.09, 8), boneM, [sd * 0.085, -0.02, 0.07], [0, 0, Math.PI / 2 + sd * 0.15]); // 頬骨
    });
    add(head, new THREE.ConeGeometry(0.022, 0.05, 3), dark, [0, -0.015, 0.142], [Math.PI, 0, 0]);
    add(head, new THREE.BoxGeometry(0.13, 0.05, 0.09), boneM, [0, -0.06, 0.07]);
    for (let i = 0; i < 8; i++) add(head, new THREE.BoxGeometry(0.013, rand(0.018, 0.028), 0.01), boneM, [-0.05 + i * 0.0143, -0.09, 0.112 - Math.abs(i - 3.5) * 0.006], [0, 0, rand(-0.15, 0.15)]);
    const jaw = pivot(head, 0, -0.08, -0.03); P.jaw = jaw;
    add(jaw, new THREE.TorusGeometry(0.065, 0.016, 5, 12, Math.PI), boneM, [0, -0.025, 0.08], [Math.PI / 2, 0, 0]);
    [-1, 1].forEach((sd) => add(jaw, new THREE.BoxGeometry(0.016, 0.07, 0.03), boneM, [sd * 0.064, 0.01, 0.07]));
    for (let i = 0; i < 7; i++) add(jaw, new THREE.BoxGeometry(0.012, 0.02, 0.01), boneM, [-0.043 + i * 0.0143, -0.005, 0.14 - Math.abs(i - 3) * 0.006]);
    // さびた鉄の兜（鼻あて付き）
    add(head, new THREE.SphereGeometry(0.17, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.48), rust, [0, 0.09, -0.01], null, [0.98, 1.05, 1.12]);
    add(head, new THREE.TorusGeometry(0.168, 0.012, 5, 22), ironM, [0, 0.1, -0.01], [Math.PI / 2, 0, 0], [1, 1.12, 1]);
    add(head, new THREE.BoxGeometry(0.03, 0.13, 0.02), ironM, [0, 0.04, 0.18]);
    // 腕: 上腕骨、前腕の 2 本の骨、指の骨
    const arm = (sd) => {
      const sh = pivot(body, sd * 0.24, 1.58, -0.02); bone(sh, 0.3, 0.024, boneM);
      const el = pivot(sh, 0, -0.3, 0);
      [-1, 1].forEach((k) => { add(el, new THREE.CylinderGeometry(0.012, 0.014, 0.27, 6), boneM, [k * 0.014, -0.14, 0]); });
      add(el, new THREE.SphereGeometry(0.026, 8, 6), boneM);
      const hand = pivot(el, 0, -0.29, 0);
      add(hand, new THREE.BoxGeometry(0.05, 0.04, 0.025), boneM);
      for (let i = 0; i < 4; i++) { add(hand, new THREE.CylinderGeometry(0.006, 0.007, 0.04, 4), boneM, [-0.018 + i * 0.012, -0.04, 0.005]); add(hand, new THREE.CylinderGeometry(0.005, 0.006, 0.03, 4), boneM, [-0.018 + i * 0.012, -0.075, 0.015], [0.5, 0, 0]); }
      add(hand, new THREE.CylinderGeometry(0.006, 0.007, 0.04, 4), boneM, [sd * -0.032, -0.02, 0.012], [0, 0, sd * 0.6]);
      return { sh, el, hand };
    };
    P.arms = [arm(1), arm(-1)];
    // 左肩のさびた肩当て
    add(body, new THREE.SphereGeometry(0.1, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), rust, [-0.25, 1.6, -0.01], [0, 0, 0.35], [1.2, 0.8, 1.1]);
    // 右手の剣: 刃こぼれしたさびた刃（ぎざぎざ）、黒ずんだ柄
    const sw = pivot(P.arms[0].hand, 0, -0.05, 0.02); sw.rotation.x = Math.PI / 2 + 0.35;
    add(sw, new THREE.CylinderGeometry(0.018, 0.018, 0.16, 8), woodM, [0, -0.02, 0]);
    add(sw, new THREE.SphereGeometry(0.03, 8, 6), ironM, [0, -0.11, 0]);
    add(sw, new THREE.BoxGeometry(0.22, 0.03, 0.04), ironM, [0, 0.07, 0]);
    const bs = new THREE.Shape(); bs.moveTo(-0.028, 0); const n = 14; for (let i = 1; i <= n; i++) bs.lineTo(-0.028 + (Math.random() < 0.3 ? 0.008 : 0), (i / n) * 0.82);
    bs.lineTo(0, 0.92); for (let i = n; i >= 1; i--) bs.lineTo(0.028 - (Math.random() < 0.3 ? 0.009 : 0), (i / n) * 0.82); bs.lineTo(0.028, 0); bs.closePath();
    add(sw, new THREE.ExtrudeGeometry(bs, { depth: 0.008, bevelEnabled: false }), steel, [0, 0.085, -0.004]);
    add(sw, new THREE.BoxGeometry(0.03, 0.5, 0.0095), rust, [0.004, 0.3, 0]);
    // 左手の丸盾: 板を張った木の盾に、鉄のふちと中心の突起。割れ目
    const shield = pivot(P.arms[1].hand, -0.14, 0.0, 0.12); shield.rotation.set(1.6, -0.7, 0); P.shield = shield;
    for (let i = 0; i < 5; i++) { const w = 0.1, x = -0.2 + i * w, h = 2 * Math.sqrt(Math.max(0, 0.25 * 0.25 - x * x)); if (i === 3) continue; add(shield, new THREE.BoxGeometry(w - 0.006, Math.max(0.12, h), 0.025), woodM, [x + 0.0, 0, 0]); }
    add(shield, new THREE.BoxGeometry(0.06, 0.32, 0.025), woodM, [0.12, 0.05, 0], [0, 0, 0.08]); // 割れて短い板
    add(shield, new THREE.TorusGeometry(0.255, 0.016, 6, 26), ironM);
    add(shield, new THREE.SphereGeometry(0.06, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), ironM, [0, 0, 0.012], [Math.PI / 2, 0, 0]);
    // 脚: 大腿骨、ひざの皿、すねの 2 本の骨、足の骨
    const leg = (sd) => {
      const hip = pivot(body, sd * 0.1, 0.97, 0); bone(hip, 0.42, 0.028, boneM);
      const knee = pivot(hip, 0, -0.42, 0);
      add(knee, new THREE.SphereGeometry(0.025, 8, 6), boneM, [0, 0, 0.03], null, [1, 1, 0.6]);
      [-1, 1].forEach((k) => add(knee, new THREE.CylinderGeometry(k > 0 ? 0.017 : 0.01, k > 0 ? 0.02 : 0.012, 0.42, 6), boneM, [k * 0.018, -0.21, 0]));
      add(knee, new THREE.BoxGeometry(0.06, 0.03, 0.08), boneM, [0, -0.44, 0.015]);
      for (let i = 0; i < 4; i++) add(knee, new THREE.CylinderGeometry(0.006, 0.007, 0.07, 4), boneM, [-0.022 + i * 0.015, -0.455, 0.08], [Math.PI / 2, 0, 0]);
      return { hip, knee };
    };
    P.legs = [leg(1), leg(-1)];
    // ぼろ布（腰と背中）
    const rag = (w, h, p, r) => { const geo = new THREE.PlaneGeometry(w, h, 4, 5); const ga = geo.attributes.position; for (let i = 0; i < ga.count; i++) { const y = ga.getY(i); if (y < -h * 0.3) ga.setY(i, y - Math.random() * 0.08); ga.setZ(i, ga.getZ(i) + rand(-0.015, 0.015)); } geo.computeVertexNormals(); return add(body, geo, cloth, p, r); };
    rag(0.3, 0.34, [0, 0.83, 0.1], [0.15, 0, 0]); rag(0.32, 0.36, [0, 0.83, -0.11], [-0.15, 0, 0]);
  }

  // ======================================================================
  //  影コウモリ（第32版: リアルでダークに。吸血コウモリ）
  //  チェック項目: 黒茶の毛（腹は少し明るい）／鼻の葉としわのある大きな耳／赤みのある黒い目／赤い歯ぐきと長い牙／
  //               血管の透ける膜の翼・つめのある親指・指の骨／つめのある足と、脚のあいだの膜
  // ======================================================================
  function bat(std, g, P) {
    const fur = std({ color: 0x2a201a, roughness: 1, flatShading: true });
    const furL = std({ color: 0x4a3a2c, roughness: 1, flatShading: true });
    const skin = std({ color: 0x3e302e, roughness: 0.75 });
    const nose = std({ color: 0x5a4442, roughness: 0.6 });
    const veinTex = FX.canvasTex(256, 256, (c, w) => {
      c.fillStyle = '#ffffff'; c.fillRect(0, 0, w, w);
      c.strokeStyle = 'rgba(120,30,30,0.55)';
      for (let i = 0; i < 14; i++) { c.lineWidth = rand(0.6, 1.8); c.beginPath(); let x = rand(0, w), y = rand(0, w); c.moveTo(x, y); for (let k = 0; k < 6; k++) { x += rand(-30, 30); y += rand(-30, 30); c.lineTo(x, y); } c.stroke(); }
      for (let i = 0; i < 400; i++) { c.fillStyle = `rgba(0,0,0,${rand(0.03, 0.12)})`; c.fillRect(rand(0, w), rand(0, w), rand(1, 3), rand(1, 3)); }
    });
    veinTex.wrapS = veinTex.wrapT = THREE.RepeatWrapping; veinTex.repeat.set(2, 2);
    const memb = std({ color: 0x4a3434, map: veinTex, emissive: 0x1a0606, emissiveIntensity: 0.4, roughness: 0.7, transparent: true, opacity: 0.88, side: THREE.DoubleSide });
    const fingerM = std({ color: 0x2e2422, roughness: 0.6 });
    const eyeM = std({ color: 0x0a0404, roughness: 0.05, emissive: 0x3a0404, emissiveIntensity: 0.8 });
    const gum = std({ color: 0x6a1820, roughness: 0.6 });
    const fang = std({ color: 0xf0eadc, roughness: 0.3 });
    const claw = std({ color: 0x141010, roughness: 0.4 });
    const tufts = (parent, r, n, c, mat2) => { for (let i = 0; i < n; i++) { const u = rand(-0.9, 0.95), a = rand(0, Math.PI * 2), q = Math.sqrt(1 - u * u), d = new V3(Math.cos(a) * q, u, Math.sin(a) * q); const t = add(parent, new THREE.ConeGeometry(r * 0.16, r * 0.42, 4), i % 4 === 0 ? mat2 : fur, [c[0] + d.x * r * 0.9, c[1] + d.y * r * 0.9, c[2] + d.z * r * 0.9]); t.quaternion.setFromUnitVectors(new V3(0, 1, 0), d.add(new V3(0, -0.4, -0.3)).normalize()); } };
    const body = new THREE.Group(); g.add(body); P.body = body;
    add(body, jitter(new THREE.IcosahedronGeometry(0.22, 2), 0.02), fur, [0, -0.02, -0.06], null, [0.85, 1.25, 0.9]);
    add(body, jitter(new THREE.IcosahedronGeometry(0.16, 1), 0.015), furL, [0, -0.04, 0.06], null, [0.9, 1.3, 0.6]); // 腹
    tufts(body, 0.24, 36, [0, -0.02, -0.06], furL);
    const head = pivot(body, 0, 0.24, 0.1); P.head = head;
    add(head, jitter(new THREE.IcosahedronGeometry(0.13, 2), 0.01), fur, null, null, [1, 0.95, 1.05]);
    tufts(head, 0.13, 14, [0, 0, -0.02], fur);
    add(head, new THREE.ConeGeometry(0.065, 0.12, 8), fur, [0, -0.025, 0.12], [Math.PI / 2, 0, 0], [1, 1, 0.8]); // 鼻づら
    add(head, new THREE.ConeGeometry(0.035, 0.07, 3), nose, [0, 0.02, 0.17], [-0.3, 0, 0], [1.2, 1, 0.35]); // 鼻の葉
    [-1, 1].forEach((sd) => {
      add(head, new THREE.SphereGeometry(0.012, 6, 5), dark0(std), [sd * 0.014, -0.012, 0.18]); // 鼻の穴
      // 大きな耳（しわのすじ入り）
      const ear = pivot(head, sd * 0.08, 0.1, -0.01); ear.rotation.set(-0.2, sd * 0.3, -sd * 0.38);
      add(ear, new THREE.ConeGeometry(0.075, 0.26, 7, 1, true), skin, [0, 0.11, 0], null, [1, 1, 0.45]);
      for (let k = 0; k < 4; k++) add(ear, new THREE.BoxGeometry(0.06 - k * 0.01, 0.006, 0.006), fingerM, [0, 0.04 + k * 0.045, 0.02]);
      // 目（黒く、赤みの反射）
      add(head, new THREE.SphereGeometry(0.02, 10, 8), eyeM, [sd * 0.05, 0.035, 0.105]);
      glow(head, '#ff2020', 0.06, [sd * 0.05, 0.035, 0.125]);
      // 牙（上は長く、下は短い）
      add(head, new THREE.ConeGeometry(0.01, 0.055, 5), fang, [sd * 0.022, -0.075, 0.15], [Math.PI + 0.15, 0, 0]);
      add(head, new THREE.ConeGeometry(0.006, 0.025, 4), fang, [sd * 0.018, -0.105, 0.14], [-0.15, 0, 0]);
    });
    P.mouth = add(head, new THREE.SphereGeometry(0.042, 12, 8), gum, [0, -0.085, 0.12], null, [1.05, 0.7, 0.8]);
    // 翼: 腕の骨・つめのある親指・3 本の長い指、そのあいだの血管の透ける膜（ふちは波形）
    const wing = (sd) => {
      const root = pivot(body, sd * 0.15, 0.08, -0.02);
      const armB = pivot(root, 0, 0, 0); armB.rotation.z = -sd * Math.PI / 2;
      add(armB, new THREE.CylinderGeometry(0.016, 0.022, 0.5, 6), fingerM, [0, -0.25, 0]);
      const outer = pivot(armB, 0, -0.5, 0); P['outer' + sd] = outer;
      add(outer, new THREE.CylinderGeometry(0.011, 0.016, 0.46, 6), fingerM, [0, -0.23, 0]);
      add(outer, new THREE.SphereGeometry(0.022, 8, 6), fingerM);
      add(outer, new THREE.ConeGeometry(0.01, 0.06, 4), claw, [0, -0.47, 0.04], [0.8, 0, 0]); // 親指のつめ
      const tips = [[0.16, -0.92], [0.55, -0.78], [0.78, -0.4]];
      tips.forEach(([z, y]) => { const len = Math.hypot(z, y); const f = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.01, len, 5), fingerM); f.position.set(0, -0.46 + y / 2, z / 2); f.rotation.x = Math.atan2(z, -y); outer.add(f); });
      const inner = new THREE.Shape(); inner.moveTo(0, 0); inner.lineTo(0, -0.5); inner.lineTo(0.5, -0.56); inner.quadraticCurveTo(0.34, -0.26, 0.46, 0.02); inner.lineTo(0, 0);
      const mi = new THREE.Mesh(new THREE.ShapeGeometry(inner, 8), memb); mi.rotation.y = -Math.PI / 2; armB.add(mi);
      const os = new THREE.Shape(); os.moveTo(0, 0); os.lineTo(0, -0.46);
      tips.forEach(([z, y], i) => { os.lineTo(z, -0.46 + y); if (i < tips.length - 1) os.quadraticCurveTo((z + tips[i + 1][0]) / 2 - 0.1, -0.46 + (y + tips[i + 1][1]) / 2 + 0.16, tips[i + 1][0], -0.46 + tips[i + 1][1]); });
      os.quadraticCurveTo(0.5, -0.28, 0.5, -0.02); os.lineTo(0, 0);
      const mo = new THREE.Mesh(new THREE.ShapeGeometry(os, 8), memb); mo.rotation.y = -Math.PI / 2; outer.add(mo);
      return { root, armB, outer };
    };
    P.wings = [wing(1), wing(-1)];
    // 脚とつめ、脚のあいだの膜
    [-1, 1].forEach((sd) => { add(body, new THREE.CylinderGeometry(0.012, 0.016, 0.14, 5), skin, [sd * 0.07, -0.3, -0.08], [0.4, 0, sd * 0.2]); for (let i = 0; i < 4; i++) add(body, new THREE.ConeGeometry(0.006, 0.035, 4), claw, [sd * 0.08 + (i - 1.5) * 0.01, -0.38, -0.05], [Math.PI - 0.6, 0, 0]); });
    const tail = new THREE.Shape(); tail.moveTo(-0.1, 0); tail.lineTo(0.1, 0); tail.quadraticCurveTo(0.03, -0.12, 0, -0.18); tail.quadraticCurveTo(-0.03, -0.12, -0.1, 0);
    add(body, new THREE.ShapeGeometry(tail, 6), memb, [0, -0.3, -0.12], [0.6, 0, 0]);
  }
  function dark0(std) { return std({ color: 0x050303, roughness: 1 }); }

  // ======================================================================
  //  闇の魔導士（参考: 紫とピンクの光をまとう、フードの魔導士）
  //  チェック項目: とがった高いフード（先は後ろへ曲がる）／フードの中は闇で、赤く光る目／紫のローブとピンクのふち／
  //               とげの襟／黒いつめの手／とげのかごに包まれたピンクの宝玉の杖／まわりに浮かぶ黒い玉／なびくリボン
  // ======================================================================
  function mage(std, g, P) {
    const robe = std({ color: 0x2c1440, roughness: 0.9, emissive: 0x16061e, emissiveIntensity: 0.4, side: THREE.DoubleSide });
    const robeD = std({ color: 0x1a0a26, roughness: 0.95, side: THREE.DoubleSide });
    const trim = std({ color: 0xc02a72, roughness: 0.6, emissive: 0x7a0a40, emissiveIntensity: 0.7, side: THREE.DoubleSide });
    const thorn = std({ color: 0x1c0a22, roughness: 0.5, metalness: 0.3, emissive: 0x2a0418, emissiveIntensity: 0.3 });
    const voidM = std({ color: 0x020104, roughness: 1 });
    const eyeM = std({ color: 0xff3a50, emissive: 0xff1a30, emissiveIntensity: 2.6 });
    const claw = std({ color: 0x1e1024, roughness: 0.4, metalness: 0.5 });
    const woodM = std({ color: 0x2a1222, roughness: 0.6, metalness: 0.2, emissive: 0x1a0410, emissiveIntensity: 0.3 });
    const orbM = std({ color: 0xff7ac8, emissive: 0xff2a8a, emissiveIntensity: 2.4, roughness: 0.1 });
    const darkOrb = std({ color: 0x2a1236, roughness: 0.15, metalness: 0.4, emissive: 0x3a0a3a, emissiveIntensity: 0.5 });
    const body = new THREE.Group(); g.add(body); P.body = body;
    // ローブ（回転体。すそはぎざぎざ）
    const prof = [[0.6, 0], [0.52, 0.25], [0.41, 0.7], [0.33, 1.1], [0.28, 1.38], [0.25, 1.5], [0.12, 1.6], [0.001, 1.62]];
    const rAt = (y) => { for (let i = 1; i < prof.length; i++) if (y <= prof[i][1]) { const t = (y - prof[i - 1][1]) / (prof[i][1] - prof[i - 1][1]); return prof[i - 1][0] + (prof[i][0] - prof[i - 1][0]) * t; } return 0; };
    const rg = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 24), pa = rg.attributes.position;
    for (let i = 0; i < pa.count; i++) { if (pa.getY(i) < 0.02) { const a = Math.atan2(pa.getZ(i), pa.getX(i)); pa.setY(i, 0.04 + Math.abs(Math.sin(a * 5.5)) * 0.2 + rand(0, 0.05)); } }
    rg.computeVertexNormals();
    P.robe = add(body, rg, robe);
    add(body, new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r * 0.86, y * 0.9)), 16), robeD, [0, 0.02, 0]);
    // 前あわせのピンクのふち（ローブの表面に沿わせる）と、腰帯
    [-1, 1].forEach((sd) => { const pts = []; for (let y = 0.2; y <= 1.45; y += 0.125) { const r = rAt(y) + 0.008, x = sd * 0.07; pts.push([x, y, Math.sqrt(Math.max(0, r * r - x * x))]); } add(body, tube(pts, 0.02, 20), trim); });
    add(body, new THREE.TorusGeometry(0.345, 0.03, 6, 24), trim, [0, 1.0, 0], [Math.PI / 2, 0, 0]);
    add(body, new THREE.SphereGeometry(0.05, 10, 8), std({ color: 0xff4a8a, emissive: 0xff1a5a, emissiveIntensity: 1.4 }), [0, 1.0, 0.35], null, [1, 1, 0.5]);
    // とげの襟（肩のまわりに外と上へ）
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2; if (Math.cos(a) > 0.82) continue; // 顔の前はあける
      const len = rand(0.18, 0.42), d = new V3(Math.sin(a), 0.9 + rand(-0.2, 0.3), Math.cos(a)).normalize();
      const t = add(body, new THREE.ConeGeometry(0.035, len, 5), i % 4 === 0 ? trim : thorn, [Math.sin(a) * 0.3, 1.5 + len * 0.35 * d.y, Math.cos(a) * 0.3]);
      t.quaternion.setFromUnitVectors(new V3(0, 1, 0), d);
    }
    add(body, new THREE.CylinderGeometry(0.2, 0.43, 0.42, 18, 1, true), robe, [0, 1.38, 0]);
    // フード: とがって高く、先は後ろへ曲がる。前はあいていて、中は闇と赤い目
    const head = pivot(body, 0, 1.74, 0); P.head = head;
    const hp = []; for (let i = 0; i <= 10; i++) { const t = i / 10; hp.push(new THREE.Vector2(0.25 * (1 - t) * (1 - t * 0.2) + 0.004, t * 0.7)); }
    const hood = new THREE.LatheGeometry(hp, 22, 0.6, Math.PI * 2 - 1.2), ha = hood.attributes.position;
    for (let i = 0; i < ha.count; i++) { const y = ha.getY(i), t = y / 0.7; ha.setZ(i, ha.getZ(i) - t * t * 0.32); ha.setY(i, y - 0.12); }
    hood.computeVertexNormals();
    add(head, hood, robe);
    // フードのふち（ピンク）
    [0.6, Math.PI * 2 - 0.6].forEach((phi) => { const pts = hp.slice(0, 8).map((v) => { const t = v.y / 0.7; return [Math.sin(phi) * (v.x + 0.01), v.y - 0.12, Math.cos(phi) * (v.x + 0.01) - t * t * 0.32]; }); add(head, tube(pts, 0.016, 14), trim); });
    add(head, new THREE.SphereGeometry(0.19, 14, 10), voidM, [0, 0.02, 0.0]);
    [-1, 1].forEach((sd) => { add(head, new THREE.SphereGeometry(0.024, 8, 6), eyeM, [sd * 0.055, 0.05, 0.17], [0, 0, sd * 0.35], [1.6, 0.6, 1]); glow(head, '#ff2a40', 0.32, [sd * 0.055, 0.05, 0.2]); });
    // 袖と、黒いつめの手
    const sleeve = (sd) => {
      const sh = pivot(body, sd * 0.3, 1.42, 0.05);
      add(sh, new THREE.CylinderGeometry(0.08, 0.17, 0.5, 10, 1, true), robe, [0, -0.25, 0.05], [0.25, 0, 0]);
      add(sh, new THREE.TorusGeometry(0.165, 0.018, 5, 14), trim, [0, -0.49, 0.11], [Math.PI / 2 + 0.25, 0, 0]);
      const hand = pivot(sh, 0, -0.52, 0.12);
      add(hand, new THREE.BoxGeometry(0.07, 0.07, 0.045), claw);
      for (let i = 0; i < 4; i++) add(hand, new THREE.ConeGeometry(0.009, 0.12, 4), claw, [-0.027 + i * 0.018, -0.08, 0.015], [0.3, 0, 0]);
      return { sh, hand };
    };
    P.arms = [sleeve(1), sleeve(-1)];
    // 杖: ねじれた黒い木。上でとげのかごがピンクの宝玉を包む
    const staff = pivot(P.arms[0].hand, 0, -0.02, 0.02); P.staff = staff;
    add(staff, tube([[0, -1.0, 0], [0.03, -0.4, 0.02], [-0.02, 0.3, -0.01], [0.02, 0.85, 0.02], [0, 1.0, 0]], 0.03, 24), woodM);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const pts = [[0, 0.95, 0], [Math.cos(a) * 0.1, 1.05, Math.sin(a) * 0.1], [Math.cos(a + 0.5) * 0.15, 1.18, Math.sin(a + 0.5) * 0.15], [Math.cos(a + 1) * 0.1, 1.32, Math.sin(a + 1) * 0.1], [Math.cos(a + 1.3) * 0.03, 1.42, Math.sin(a + 1.3) * 0.03]];
      add(staff, tube(pts, 0.013, 12), woodM);
      const sp = add(staff, new THREE.ConeGeometry(0.012, 0.09, 4), woodM, [Math.cos(a + 0.5) * 0.17, 1.2, Math.sin(a + 0.5) * 0.17]); sp.rotation.z = -Math.cos(a + 0.5) * 1.2; sp.rotation.x = Math.sin(a + 0.5) * 1.2;
    }
    P.orb = add(staff, new THREE.IcosahedronGeometry(0.1, 2), orbM, [0, 1.18, 0]);
    P.orbGlow = glow(staff, '#ff4aa8', 1.5, [0, 1.18, 0]);
    // まわりに浮かぶ黒い玉（ピンクの光をまとう）
    P.orbs = new THREE.Group(); P.orbs.position.y = 1.15; body.add(P.orbs);
    for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; const o = new THREE.Group(); o.position.set(Math.cos(a) * 0.78, Math.sin(a * 2) * 0.12, Math.sin(a) * 0.78); P.orbs.add(o); add(o, new THREE.SphereGeometry(0.085, 14, 10), darkOrb); glow(o, '#c02a8a', 0.45); }
    // 背中でなびく 2 本のリボン
    P.ribbons = [-1, 1].map((sd) => {
      const pv = pivot(body, sd * 0.18, 1.5, -0.22);
      const geo = new THREE.PlaneGeometry(0.11, 1.1, 1, 10), ga = geo.attributes.position;
      for (let i = 0; i < ga.count; i++) { const y = ga.getY(i); ga.setZ(i, Math.sin((y + 0.55) * 4) * 0.06 - (0.55 - y) * 0.25); }
      geo.translate(0, -0.55, 0); geo.computeVertexNormals();
      add(pv, geo, trim, null, [0.2, 0, sd * 0.15]);
      return pv;
    });
  }

  // ======================================================================
  //  石の守護者（ボス）（参考: 苔むした岩を積んだゴーレム）
  //  チェック項目: 青緑がかった灰色の岩を積んだ体／小石を並べた顔に水色に光る 2 つの目と歯／
  //               肩や腕に苔、垂れたつる／頭から生えた若木／大きな岩のこぶし／短く太い脚と光る紋様
  // ======================================================================
  function boss(std, g, P) {
    const stone = std({ color: 0x6c7e7a, roughness: 1, flatShading: true, emissive: 0x060a0a, emissiveIntensity: 1 });
    const stoneD = std({ color: 0x46544f, roughness: 1, flatShading: true });
    const stoneL = std({ color: 0xb6c4be, roughness: 0.95, flatShading: true });
    const moss = std({ color: 0x4ea83a, roughness: 1, flatShading: true, emissive: 0x143a0a, emissiveIntensity: 0.5 });
    const eyeM = std({ color: 0x9af8ff, emissive: 0x3ae6ff, emissiveIntensity: 2.6 });
    const vein = std({ color: 0x6af0ff, emissive: 0x2ad8ff, emissiveIntensity: 1.6 });
    const woodM = std({ color: 0x5a3a24, roughness: 0.9 });
    const dark = std({ color: 0x0c1212, roughness: 1 });
    const rock = (parent, r, p, mat, sq) => add(parent, jitter(new THREE.DodecahedronGeometry(r, 0), r * 0.16), mat || stone, p, [rand(0, 3), rand(0, 3), rand(0, 3)], sq || [rand(0.9, 1.15), rand(0.85, 1.1), rand(0.9, 1.15)]);
    const mossOn = (parent, r, p) => add(parent, jitter(new THREE.IcosahedronGeometry(r, 1), r * 0.15), moss, p, [0, rand(0, 3), 0], [1.3, 0.32, 1.1]);
    const strands = (parent, p, n, len) => { for (let i = 0; i < n; i++) add(parent, new THREE.ConeGeometry(0.06, len * rand(0.6, 1.1), 4), moss, [p[0] + rand(-0.25, 0.25), p[1] - len * 0.4, p[2] + rand(-0.15, 0.15)], [Math.PI + rand(-0.15, 0.15), 0, rand(-0.15, 0.15)]); };
    const body = new THREE.Group(); g.add(body); P.body = body;
    // 胴体: 大きな胸の岩のまわりに、岩を積む
    rock(body, 1.15, [0, 4.3, -0.05], stone, [1.35, 1.0, 0.9]);
    [[-0.9, 4.75, 0.25, 0.55], [0.85, 4.85, 0.2, 0.6], [-0.6, 3.75, 0.45, 0.5], [0.65, 3.8, 0.4, 0.48], [0, 4.9, -0.5, 0.6], [-1.1, 4.1, -0.3, 0.55], [1.15, 4.0, -0.25, 0.55], [0.2, 3.65, 0.6, 0.4]].forEach(([x, y, z, r], i) => rock(body, r, [x, y, z], i % 3 === 2 ? stoneD : stone));
    rock(body, 0.8, [0, 3.15, 0], stoneD, [1.25, 0.8, 1]);
    rock(body, 0.85, [0, 2.6, 0], stone, [1.35, 0.7, 1.05]);
    // 胸のひび（水色に光る筋）と、その奥の核
    [[0.25, 4.15, 1.0, 0.04, 0.5, 0.4], [-0.3, 4.0, 1.0, 0.04, 0.42, -0.5], [0.0, 3.8, 1.02, 0.4, 0.04, 0.1], [0.55, 4.5, 0.98, 0.035, 0.35, -0.2]].forEach(([x, y, z, w, h, rz]) => add(body, new THREE.BoxGeometry(w, h, 0.05), vein, [x, y, z], [0, 0, rz]));
    P.core = add(body, new THREE.OctahedronGeometry(0.14, 0), vein, [0, 4.0, 1.05]);
    P.coreGlow = glow(body, '#3ae6ff', 0.8, [0, 4.0, 1.1]);
    // 苔とつる
    mossOn(body, 0.6, [0.75, 5.35, 0.1]); mossOn(body, 0.5, [-0.85, 5.3, -0.1]); mossOn(body, 0.45, [0.1, 3.55, 0.75]);
    strands(body, [0.0, 3.5, 0.85], 5, 0.5); strands(body, [-0.9, 4.6, 0.6], 3, 0.6);
    add(body, tube([[0.9, 5.0, 0.6], [0.7, 4.3, 0.95], [0.4, 3.6, 0.9], [0.3, 2.9, 0.75]], 0.04, 16), moss);
    // 頭: 小石を並べた顔、水色の 2 つの目、歯の並んだ口。頭のうしろの岩と、頭から生えた若木
    const head = pivot(body, 0, 5.25, 0.3); P.head = head;
    rock(head, 0.62, [0, 0.25, -0.2], stoneD, [1.1, 1, 1]);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
      const x = (c - 1.5) * 0.24 + (r % 2 ? 0.06 : -0.03), y = 0.55 - r * 0.22, z = 0.42 - Math.abs(c - 1.5) * 0.06;
      if (r === 1 && (c === 1 || c === 2)) continue; // 目の場所
      if (r === 2 && (c === 1 || c === 2)) continue; // 口の場所
      add(head, jitter(new THREE.BoxGeometry(0.22, 0.19, 0.18, 1, 1, 1), 0.025), stoneL, [x, y, z], [rand(-0.1, 0.1), rand(-0.1, 0.1), rand(-0.15, 0.15)]);
    }
    P.eye = new THREE.Group(); head.add(P.eye); P.eyeGlow = [];
    [-1, 1].forEach((sd) => {
      add(head, new THREE.SphereGeometry(0.11, 10, 8), dark, [sd * 0.15, 0.33, 0.4], null, [1, 0.8, 0.6]);
      add(P.eye, new THREE.SphereGeometry(0.075, 12, 10), eyeM, [sd * 0.15, 0.33, 0.47], null, [1.15, 0.85, 0.6]);
      P.eyeGlow.push(glow(head, '#3ae6ff', 0.9, [sd * 0.15, 0.33, 0.55]));
    });
    add(head, new THREE.BoxGeometry(0.46, 0.15, 0.08), dark, [0, 0.1, 0.43]);
    for (let i = 0; i < 6; i++) { add(head, new THREE.BoxGeometry(0.06, 0.06, 0.06), stoneL, [-0.18 + i * 0.072, 0.155, 0.47]); add(head, new THREE.BoxGeometry(0.06, 0.055, 0.06), stoneL, [-0.18 + i * 0.072, 0.045, 0.47]); }
    // 顔のまわりの光る筋
    [[-0.42, 0.2, 0.38, 0.03, 0.3, 0.3], [0.42, 0.25, 0.38, 0.03, 0.26, -0.3]].forEach(([x, y, z, w, h, rz]) => add(head, new THREE.BoxGeometry(w, h, 0.03), vein, [x, y, z], [0, 0, rz]));
    add(head, tube([[0.15, 0.7, -0.15], [0.2, 1.0, -0.2], [0.32, 1.3, -0.15], [0.4, 1.55, -0.05]], 0.035, 12), woodM);
    add(head, tube([[0.22, 1.05, -0.2], [0.05, 1.25, -0.25], [-0.05, 1.4, -0.2]], 0.022, 8), woodM);
    [[0.42, 1.6, -0.05], [0.3, 1.5, 0.05], [-0.07, 1.45, -0.2], [0.48, 1.45, -0.12]].forEach(([x, y, z]) => add(head, new THREE.SphereGeometry(0.1, 8, 6), moss, [x, y, z], [rand(0, 3), rand(0, 3), 0], [1, 0.4, 0.7]));
    // 腕: 肩の大岩・上腕・ひじから先と、岩を固めた大きなこぶし
    const arm = (sd) => {
      const sh = pivot(body, sd * 1.75, 4.75, 0);
      rock(sh, 0.78, [0, 0.05, 0]);
      mossOn(sh, 0.45, [sd * 0.1, 0.65, 0]);
      rock(sh, 0.55, [sd * 0.05, -0.7, 0], stoneD); rock(sh, 0.5, [0, -1.15, 0.05]);
      const el = pivot(sh, 0, -1.45, 0);
      rock(el, 0.58, [0, -0.35, 0.05]);
      rock(el, 0.68, [0, -1.15, 0.15], stone, [1.15, 1, 1.1]);
      [[0.4, -1.0, 0.45], [-0.38, -1.05, 0.4], [0.35, -1.5, 0.3], [-0.3, -1.5, 0.35], [0, -1.6, 0.55]].forEach(([x, y, z]) => rock(el, rand(0.3, 0.4), [x, y, z], stoneD));
      if (sd < 0) { mossOn(el, 0.4, [0.1, -0.75, 0.4]); strands(el, [0.1, -0.85, 0.5], 4, 0.4); }
      else add(el, tube([[0.3, 0.1, 0.4], [0.45, -0.6, 0.55], [0.35, -1.3, 0.75], [0.4, -1.9, 0.6]], 0.035, 14), moss);
      return { sh, el };
    };
    P.arms = [arm(1), arm(-1)];
    // 脚: 短く太い岩の柱。右脚に光る紋様
    const leg = (sd) => {
      const hip = pivot(body, sd * 0.75, 2.4, 0);
      rock(hip, 0.62, [0, -0.45, 0]);
      rock(hip, 0.66, [0, -1.25, 0.02], stoneD);
      rock(hip, 0.62, [0, -2.0, 0.18], stone, [1.2, 0.6, 1.45]);
      if (sd > 0) { add(hip, new THREE.TorusGeometry(0.13, 0.025, 6, 16), vein, [0.05, -1.25, 0.66]); add(hip, new THREE.BoxGeometry(0.03, 0.2, 0.03), vein, [0.05, -1.25, 0.67]); }
      else { mossOn(hip, 0.4, [0, -0.85, 0.35]); strands(hip, [0, -0.95, 0.5], 3, 0.35); }
      return { hip };
    };
    P.legs = [leg(1), leg(-1)];
    // 足もとの、ひびの入った地面の光
    const ring = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.MeshBasicMaterial({ map: FX.circleTex, color: 0x3ad8ff, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false }));
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
    // 第30版: 色の数値を画面で見える色として扱う（そのままだと白っぽく薄く出るので、計算用の色に直す）
    const std = (o) => { const m = new THREE.MeshStandardMaterial(o); m.color.convertSRGBToLinear(); m.emissive.convertSRGBToLinear(); m.userData.baseEmissive = m.emissive.clone(); m.userData.baseInt = o.emissiveIntensity == null ? 1 : o.emissiveIntensity; mats.push(m); return m; };
    (BUILD[kind] || (MON.extra[kind] && MON.extra[kind].build) || slime)(std, g, parts, MON.util);
    bake(g, parts);
    return { g, parts };
  };
  // 動き: o = { sw（歩きの揺れ -1〜1）, k（攻撃のため 0〜1）, speed, time, dt, phase }
  MON.animate = function (t, o) {
    if (MON.extra[t.kind]) return MON.extra[t.kind].anim(t, o); // 第36版: js/monsters2.js で足した敵
    const P = t.parts, sw = o.sw, k = o.k, tm = o.time + o.phase;
    const strike = k > 0 ? Math.sin(k * Math.PI) : 0;
    if (t.kind === 'slime') {
      // ぶるぶる・跳ねる。ためで縦にのびて、ぱっと広がる
      const hop = o.speed > 0.2 ? Math.abs(Math.sin(o.walk * 0.9)) : 0;
      const sq = 1 + Math.sin(tm * 3) * 0.04 - hop * 0.1 + strike * 0.28;
      P.body.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
      P.body.position.y = hop * 0.18;
      // 表面がゆっくりうねる（頂点を法線の向きに少しずつ動かす）
      const O = P.ooze, arr = O.pos.array;
      for (let n = 0; n < arr.length; n += 3) {
        const bx = O.base[n], by = O.base[n + 1], bz = O.base[n + 2];
        const w = (Math.sin(tm * 2.1 + bx * 5 + bz * 3) * 0.024 + Math.sin(tm * 3.4 + by * 8 + bx * 2) * 0.014) * (by > 0.1 ? 1 : 0.3);
        arr[n] = bx + O.nrm[n] * w; arr[n + 1] = by + O.nrm[n + 1] * w; arr[n + 2] = bz + O.nrm[n + 2] * w;
      }
      O.pos.needsUpdate = true;
      P.core.rotation.y += o.dt * 0.8; P.core.position.y = 0.5 + Math.sin(tm * 1.3) * 0.04;
      P.coreGlow.scale.setScalar(0.7 * (1 + Math.sin(tm * 2.5) * 0.2 + strike * 0.6));
      P.skull.rotation.y += o.dt * 0.15;
      P.bubbles.forEach((bb, n) => { bb.position.y += o.dt * (0.06 + n * 0.012); if (bb.position.y > 0.62) bb.position.y = 0.1; });
      P.puddle.scale.setScalar(1 + strike * 0.25 + Math.sin(tm * 1.5) * 0.02);
    } else if (t.kind === 'skeleton') {
      P.legs[0].hip.rotation.x = sw * 0.55; P.legs[1].hip.rotation.x = -sw * 0.55;
      P.legs[0].knee.rotation.x = Math.max(0, -sw) * 0.7; P.legs[1].knee.rotation.x = Math.max(0, sw) * 0.7;
      // 剣を振りかぶって、振り下ろす。盾は前に構える
      const lift = k > 0 ? (k < 0.6 ? k / 0.6 : 1 - (k - 0.6) / 0.4 * 1.6) : 0;
      P.arms[0].sh.rotation.x = -sw * 0.35 - lift * 2.4; P.arms[0].el.rotation.x = -0.3 - lift * 0.5;
      P.arms[1].sh.rotation.x = sw * 0.25 - 0.6; P.arms[1].el.rotation.x = -1.0;
      P.jaw.rotation.x = 0.1 + Math.max(0, Math.sin(tm * 9)) * 0.25 + strike * 0.3;
      P.head.rotation.y = Math.sin(tm * 0.7) * 0.15;
      P.body.position.y = Math.abs(sw) * 0.04;
      P.body.rotation.z = sw * 0.04;
    } else if (t.kind === 'bat') {
      const fl = Math.sin(tm * 15);
      P.wings.forEach((w, i) => { const sd = i ? -1 : 1; w.root.rotation.z = sd * (fl * 0.55 + 0.1); w.outer.rotation.z = sd * (Math.max(0, -fl) * 0.7); });
      P.body.position.y = Math.sin(tm * 15 + 0.6) * 0.06;
      P.head.rotation.x = strike * -0.5;
      P.mouth.scale.y = 0.75 + strike * 0.6 + Math.max(0, Math.sin(tm * 3)) * 0.15;
    } else if (t.kind === 'mage') {
      P.body.position.y = 0.06 + Math.sin(tm * 1.8) * 0.06;
      P.robe.rotation.y = Math.sin(tm * 1.2) * 0.08;
      P.orbs.rotation.y += o.dt * 1.2;
      P.orbs.children.forEach((c, i) => { c.position.y = Math.sin(tm * 1.6 + i * 2.1) * 0.15; });
      P.ribbons.forEach((r, i) => { r.rotation.x = 0.25 + Math.sin(tm * 2.3 + i) * 0.18; r.rotation.z = Math.sin(tm * 1.7 + i * 1.5) * 0.15; });
      const raise = strike;
      P.arms[0].sh.rotation.x = -0.4 - raise * 1.2; P.arms[1].sh.rotation.x = -0.5 - raise * 0.6;
      P.orb.rotation.y += o.dt * 3; P.orbGlow.scale.setScalar(1.5 + raise * 1.6 + Math.sin(tm * 4) * 0.15);
    } else if (t.kind === 'boss') {
      P.legs[0].hip.rotation.x = sw * 0.32; P.legs[1].hip.rotation.x = -sw * 0.32;
      const lift = k > 0 ? (k > 0.55 ? (1 - k) / 0.45 : k / 0.55) : 0;
      P.arms[0].sh.rotation.x = -sw * 0.25 - lift * 2.7; P.arms[1].sh.rotation.x = sw * 0.25 - lift * 2.7;
      P.arms[0].el.rotation.x = -0.25 - lift * 0.4; P.arms[1].el.rotation.x = -0.25 - lift * 0.4;
      P.head.rotation.x = -lift * 0.2;
      P.body.position.y = Math.abs(sw) * 0.08;
      P.core.rotation.y += o.dt * 1.5;
      const pulse = 1 + Math.sin(tm * 3) * 0.15 + lift * 0.8;
      P.coreGlow.scale.setScalar(0.8 * pulse); P.eyeGlow.forEach((e) => e.scale.setScalar(0.9 * pulse));
      P.ring.rotation.z += o.dt * 0.5;
    }
  };
  MON.KINDS = Object.keys(BUILD);
  // 第36版: ほかのファイル（js/monsters2.js）から敵を足す仕組み。部品を作る道具も渡す
  MON.util = { add, pivot, bone, glow, jitter, tube, bake };
  MON.extra = {};
  MON.register = function (kind, build, anim) { MON.extra[kind] = { build, anim }; if (!MON.KINDS.includes(kind)) MON.KINDS.push(kind); };
})();
