// ダンジョンの敵の見た目と動き（第29版で作り込み、第30版でユーザーの参考の絵に合わせて作り直した）
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
  //  スライム（参考: 青いぷるぷるのスライム）
  //  チェック項目: 青くつやのある平たいドーム／こげ茶のふち取り／白い光のつぶ／すそがたれて広がる／
  //               困り顔（垂れた眉・黒い楕円の目・波打つ口）／口のはしのよだれ
  // ======================================================================
  function slime(std, g, P) {
    const gel = std({ color: 0x3f6cf0, emissive: 0x0c1c70, emissiveIntensity: 0.35, roughness: 0.1, metalness: 0, transparent: true, opacity: 0.93 });
    const lineM = std({ color: 0x2a140a, roughness: 1, side: THREE.BackSide });
    const ink = std({ color: 0x24120a, roughness: 0.4 });
    const shine = std({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.2 });
    const drop = std({ color: 0x7aa8ff, emissive: 0x2a4aaa, emissiveIntensity: 0.4, roughness: 0.05, transparent: true, opacity: 0.85 });
    const body = new THREE.Group(); g.add(body); P.body = body;
    // 体の形: 単位球の向き → 平たいドーム（すそは外へ広がり、ふちが少し波打つ）
    const R = 0.85;
    const dome = (dx, dy, dz) => {
      const y = dy < 0 ? dy * R * 0.14 : dy * R * 0.98;
      const k = Math.max(0, 0.3 - dy) / 1.3, a = Math.atan2(dz, dx);
      const f = 0.95 + k * 0.38 + (dy < 0.25 ? Math.sin(a * 7) * 0.03 * Math.min(1, (0.25 - dy) / 0.25) : 0);
      return new V3(dx * R * f, y + 0.12, dz * R * f);
    };
    const bg = new THREE.SphereGeometry(1, 44, 30), pa = bg.attributes.position;
    for (let i = 0; i < pa.count; i++) { const v = dome(pa.getX(i), pa.getY(i), pa.getZ(i)); pa.setXYZ(i, v.x, v.y, v.z); }
    bg.computeVertexNormals();
    P.shell = add(body, bg, gel); P.shell.renderOrder = 3;
    add(body, bg, lineM, [0, -0.004, 0], null, [1.035, 1.03, 1.035]); // ふち取り（裏返した一回り大きい形）
    // 表面に部品を貼る: dir の向きの表面に置き、外を向かせる
    const onSurf = (m, dir, out, spin) => {
      const d = new V3(dir[0], dir[1], dir[2]).normalize(), p = dome(d.x, d.y, d.z), n = p.clone().sub(new V3(0, 0.2, 0)).normalize();
      m.position.copy(p).addScaledVector(n, out); m.lookAt(m.position.clone().add(n)); if (spin) m.rotateZ(spin); return m;
    };
    // 目: 黒い楕円と光の点、眉は内側が上がった困り顔
    P.eyes = [];
    [-1, 1].forEach((sd) => {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), ink); e.scale.set(0.9, 1.3, 0.4); body.add(e); onSurf(e, [sd * 0.27, 0.43, 0.88], 0.012, sd * 0.15);
      e.userData.sy = 1.3; P.eyes.push(e);
      onSurf(add(body, new THREE.SphereGeometry(0.022, 8, 6), shine), [sd * 0.27 - 0.03, 0.49, 0.88], 0.045);
      onSurf(add(body, new THREE.BoxGeometry(0.15, 0.022, 0.02), ink), [sd * 0.26, 0.64, 0.78], 0.01, -sd * 0.38);
    });
    // 口: 波打つ線（表面に沿わせる）と、右のはしからたれるよだれ
    const mp = [];
    for (let i = 0; i <= 12; i++) { const x = -0.17 + (i / 12) * 0.34, w = Math.sin(i * 1.6) * 0.022; const d = new V3(x, 0.27 + w, 0.95).normalize(), p = dome(d.x, d.y, d.z); const n = p.clone().sub(new V3(0, 0.2, 0)).normalize(); mp.push(p.addScaledVector(n, 0.012)); }
    add(body, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(mp), 30, 0.013, 5), ink);
    const dp = mp[mp.length - 2];
    P.drool = add(body, new THREE.SphereGeometry(0.034, 10, 8), drop, [dp.x, dp.y - 0.05, dp.z + 0.01], null, [1, 1.6, 1]);
    // 光のつぶ（左上に大きめ、まわりに小さめ）
    [[-0.45, 0.55, 0.4, 0.06], [-0.32, 0.72, 0.35, 0.035], [0.5, 0.5, 0.45, 0.03], [-0.6, 0.2, 0.55, 0.028], [0.62, 0.15, 0.5, 0.025]].forEach(([x, y, z, r]) => {
      const m = add(body, new THREE.SphereGeometry(r, 10, 8), shine, null, null, [1.5, 0.9, 0.35]); onSurf(m, [x, y, z], 0.004, 0.5);
    });
    // すそのたれ（ふちのしずく）と、足もとの水たまり
    for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2 + 0.4; const p = dome(Math.cos(a) * 0.99, -0.12, Math.sin(a) * 0.99); add(body, new THREE.SphereGeometry(rand(0.06, 0.1), 10, 8), gel, [p.x * 1.02, 0.05, p.z * 1.02], null, [1.3, 0.6, 1.3]); }
    const pud = std({ color: 0x2a50c8, emissive: 0x0a1a6a, emissiveIntensity: 0.4, roughness: 0.05, transparent: true, opacity: 0.55, depthWrite: false });
    P.puddle = add(g, new THREE.CircleGeometry(1.0, 32), pud, [0, 0.02, 0], [-Math.PI / 2, 0, 0]);
  }

  // ======================================================================
  //  骸骨兵（参考: 剣を振り上げ、赤い盾を構えた骸骨）
  //  チェック項目: 兜なしの頭蓋骨／黒い大きな目のくぼみと歯／あばら骨と骨盤／茶色の長靴と手袋／
  //               金のつばの剣／下がとがった赤い盾とグレーのふち
  // ======================================================================
  function skeleton(std, g, P) {
    const boneM = std({ color: 0xece4d0, roughness: 0.7, emissive: 0x2a2418, emissiveIntensity: 0.22 });
    const dark = std({ color: 0x0c0a08, roughness: 0.9 });
    const leather = std({ color: 0x9a6438, roughness: 0.85 });
    const leatherD = std({ color: 0x6a4224, roughness: 0.9 });
    const steel = std({ color: 0xb4bac4, roughness: 0.3, metalness: 0.85 });
    const gold = std({ color: 0xd0a040, roughness: 0.35, metalness: 0.8 });
    const red = std({ color: 0xc01818, roughness: 0.45, metalness: 0.1, emissive: 0x3a0404, emissiveIntensity: 0.4 });
    const rim = std({ color: 0x3e3e46, roughness: 0.45, metalness: 0.7 });
    const eyeM = std({ color: 0xff3a1a, emissive: 0xff2a0a, emissiveIntensity: 1.6 });
    const body = new THREE.Group(); g.add(body); P.body = body;
    // 骨盤（左右の羽のような骨）
    add(body, new THREE.TorusGeometry(0.13, 0.045, 6, 12), boneM, [0, 0.98, 0], [Math.PI / 2, 0, 0], [1.25, 0.85, 1]);
    [-1, 1].forEach((sd) => add(body, new THREE.SphereGeometry(0.1, 10, 8), boneM, [sd * 0.12, 1.02, 0], [0, 0, sd * 0.4], [1.2, 0.8, 0.45]));
    // 背骨（8 つの骨）
    for (let i = 0; i < 8; i++) add(body, new THREE.CylinderGeometry(0.04, 0.045, 0.06, 7), boneM, [0, 1.05 + i * 0.07, -0.04 + Math.sin(i * 0.4) * 0.02]);
    // あばら骨（左右 6 本ずつ、前へ曲がる）
    for (let i = 0; i < 6; i++) {
      const r = 0.175 - Math.abs(i - 1.8) * 0.016, y = 1.52 - i * 0.065;
      [-1, 1].forEach((sd) => { add(body, new THREE.TorusGeometry(r, 0.016, 5, 12, Math.PI * 0.82), boneM, [0, y, -0.03], [Math.PI / 2 + 0.22, 0, sd > 0 ? -0.3 : Math.PI + 0.3]); });
    }
    add(body, new THREE.BoxGeometry(0.05, 0.32, 0.03), boneM, [0, 1.37, 0.15]);
    add(body, new THREE.CylinderGeometry(0.022, 0.022, 0.5, 6), boneM, [0, 1.6, 0], [0, 0, Math.PI / 2]); // 鎖骨
    // 頭: 丸い頭蓋骨・大きな黒い目のくぼみ（奥にかすかな赤い光）・鼻の穴・歯・動くあご
    const head = pivot(body, 0, 1.68, 0); P.head = head;
    add(head, new THREE.SphereGeometry(0.18, 20, 16), boneM, [0, 0.13, 0], null, [0.98, 1.05, 1.1]);
    add(head, new THREE.BoxGeometry(0.22, 0.09, 0.18), boneM, [0, 0.02, 0.05]);
    [-1, 1].forEach((sd) => { add(head, new THREE.SphereGeometry(0.06, 12, 10), dark, [sd * 0.068, 0.12, 0.148], null, [1, 1.05, 0.7]); add(head, new THREE.SphereGeometry(0.012, 6, 5), eyeM, [sd * 0.068, 0.115, 0.175]); glow(head, '#ff3a1a', 0.08, [sd * 0.068, 0.115, 0.19]); });
    add(head, new THREE.ConeGeometry(0.022, 0.05, 3), dark, [0, 0.055, 0.19], [Math.PI, 0, 0]);
    for (let i = 0; i < 7; i++) add(head, new THREE.BoxGeometry(0.017, 0.03, 0.012), boneM, [-0.054 + i * 0.018, -0.008, 0.155]);
    const jaw = pivot(head, 0, 0.0, -0.04); P.jaw = jaw;
    add(jaw, new THREE.BoxGeometry(0.18, 0.05, 0.16), boneM, [0, -0.035, 0.09]);
    for (let i = 0; i < 7; i++) add(jaw, new THREE.BoxGeometry(0.017, 0.026, 0.012), boneM, [-0.054 + i * 0.018, -0.004, 0.17]);
    // 腕（肩・ひじの関節）
    const arm = (sd) => {
      const sh = pivot(body, sd * 0.25, 1.58, 0); bone(sh, 0.3, 0.025, boneM);
      const el = pivot(sh, 0, -0.3, 0); bone(el, 0.28, 0.022, boneM);
      const hand = pivot(el, 0, -0.3, 0);
      return { sh, el, hand };
    };
    P.arms = [arm(1), arm(-1)];
    // 右手: 茶色の手袋で剣を握る（金のつばと柄頭、まっすぐな刃）
    add(P.arms[0].hand, new THREE.BoxGeometry(0.085, 0.09, 0.07), leather, [0, -0.02, 0.01]);
    add(P.arms[0].hand, new THREE.CylinderGeometry(0.05, 0.045, 0.06, 8), leatherD, [0, 0.04, 0]);
    // 左手: 骨の指
    add(P.arms[1].hand, new THREE.BoxGeometry(0.06, 0.06, 0.03), boneM);
    for (let i = 0; i < 3; i++) add(P.arms[1].hand, new THREE.CylinderGeometry(0.008, 0.008, 0.06, 4), boneM, [-0.02 + i * 0.02, -0.05, 0.01]);
    const sw = pivot(P.arms[0].hand, 0, -0.03, 0.02); sw.rotation.x = Math.PI / 2 + 0.35; // 剣先を前へ（少し上向き）
    add(sw, new THREE.CylinderGeometry(0.022, 0.022, 0.17, 8), leatherD, [0, -0.03, 0]);
    add(sw, new THREE.SphereGeometry(0.035, 10, 8), gold, [0, -0.13, 0]);
    add(sw, new THREE.BoxGeometry(0.26, 0.035, 0.05), gold, [0, 0.07, 0]);
    [-1, 1].forEach((sd) => add(sw, new THREE.SphereGeometry(0.025, 8, 6), gold, [sd * 0.13, 0.07, 0]));
    add(sw, new THREE.BoxGeometry(0.06, 0.88, 0.012), steel, [0, 0.53, 0]);
    add(sw, new THREE.BoxGeometry(0.012, 0.8, 0.014), std({ color: 0x6a707a, roughness: 0.4, metalness: 0.8 }), [0, 0.5, 0]);
    add(sw, new THREE.ConeGeometry(0.0305, 0.11, 4), steel, [0, 1.025, 0], [0, Math.PI / 4, 0], [1, 1, 0.22]);
    // 盾: 上がまっすぐで下がとがった赤い盾。グレーの金属のふち
    const shieldShape = (k) => { const s = new THREE.Shape(); s.moveTo(-0.26 * k, 0.3 * k); s.lineTo(0.26 * k, 0.3 * k); s.quadraticCurveTo(0.28 * k, -0.06 * k, 0, -0.44 * k); s.quadraticCurveTo(-0.28 * k, -0.06 * k, -0.26 * k, 0.3 * k); return s; };
    const shield = pivot(P.arms[1].hand, -0.16, 0.0, 0.13); shield.rotation.set(1.6, -0.75, 0); P.shield = shield; // 腕を前に出したとき、盾の面が前を向く（外へ少しひらく）
    const face = new THREE.ExtrudeGeometry(shieldShape(1), { depth: 0.03, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.01, bevelSegments: 2, curveSegments: 10 });
    add(shield, face, red, [0, 0, 0.012]);
    add(shield, new THREE.ExtrudeGeometry(shieldShape(1.1), { depth: 0.03, bevelEnabled: false, curveSegments: 10 }), rim, [0, -0.01, -0.005]);
    add(shield, new THREE.BoxGeometry(0.05, 0.12, 0.05), leatherD, [0, 0, -0.03]);
    // 脚（股・ひざ）と、茶色の長靴
    const leg = (sd) => {
      const hip = pivot(body, sd * 0.11, 0.95, 0); bone(hip, 0.42, 0.03, boneM);
      const knee = pivot(hip, 0, -0.42, 0); bone(knee, 0.2, 0.026, boneM);
      add(knee, new THREE.CylinderGeometry(0.065, 0.07, 0.26, 10), leather, [0, -0.32, 0.005]);
      add(knee, new THREE.TorusGeometry(0.067, 0.014, 5, 12), leatherD, [0, -0.19, 0.005], [Math.PI / 2, 0, 0]);
      add(knee, new THREE.BoxGeometry(0.12, 0.08, 0.24), leather, [0, -0.44, 0.06]);
      add(knee, new THREE.BoxGeometry(0.125, 0.025, 0.25), leatherD, [0, -0.475, 0.06]);
      return { hip, knee };
    };
    P.legs = [leg(1), leg(-1)];
  }

  // ======================================================================
  //  影コウモリ（参考: 大きな耳のふわふわのコウモリ）
  //  チェック項目: ベージュのふわふわの丸い体／茶色の顔／内側がピンクの大きな耳／黒くつやのある目／
  //               口を開けて牙／灰色の膜の翼と赤茶の指の骨／ピンクの小さな足
  // ======================================================================
  function bat(std, g, P) {
    const fur = std({ color: 0xe8d8b0, roughness: 1, flatShading: true });
    const furD = std({ color: 0xc8ac80, roughness: 1, flatShading: true });
    const faceM = std({ color: 0x7a4628, roughness: 0.9 });
    const pink = std({ color: 0xf0a2a6, roughness: 0.7 });
    const memb = std({ color: 0x3c3c46, roughness: 0.8, transparent: true, opacity: 0.96, side: THREE.DoubleSide });
    const finger = std({ color: 0xa86c5c, roughness: 0.7 });
    const eyeM = std({ color: 0x080606, roughness: 0.08 });
    const shine = std({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.8 });
    const mouthM = std({ color: 0x5a141e, roughness: 0.8 });
    const fang = std({ color: 0xffffff, roughness: 0.3 });
    const fluff = (parent, r, n, c, sy) => {
      add(parent, jitter(new THREE.IcosahedronGeometry(r, 2), r * 0.08), fur, c, null, sy);
      for (let i = 0; i < n; i++) {
        const u = rand(-0.95, 0.95), a = rand(0, Math.PI * 2), q = Math.sqrt(1 - u * u), d = new V3(Math.cos(a) * q, u, Math.sin(a) * q);
        const t = add(parent, new THREE.ConeGeometry(r * 0.22, r * 0.45, 4), i % 3 ? fur : furD, [c[0] + d.x * r * 0.92, c[1] + d.y * r * 0.92 * (sy ? sy[1] : 1), c[2] + d.z * r * 0.92]);
        t.quaternion.setFromUnitVectors(new V3(0, 1, 0), d);
      }
    };
    const body = new THREE.Group(); g.add(body); P.body = body;
    fluff(body, 0.27, 30, [0, -0.02, -0.04], [0.95, 1.05, 1.05]);
    const head = pivot(body, 0, 0.22, 0.17); P.head = head;
    fluff(head, 0.17, 16, [0, 0, 0]);
    add(head, new THREE.SphereGeometry(0.12, 16, 12), faceM, [0, -0.015, 0.1], null, [1.2, 0.9, 0.55]);
    [-1, 1].forEach((sd) => {
      // 大きな耳（外は毛、内はピンク）
      add(head, new THREE.ConeGeometry(0.095, 0.34, 6), furD, [sd * 0.11, 0.21, -0.01], [0, 0, -sd * 0.42], [1, 1, 0.42]);
      add(head, new THREE.ConeGeometry(0.065, 0.27, 6), pink, [sd * 0.105, 0.2, 0.012], [0, 0, -sd * 0.42], [1, 1, 0.3]);
      // 目（黒くつやがある）と光の点
      add(head, new THREE.SphereGeometry(0.034, 12, 10), eyeM, [sd * 0.058, 0.025, 0.155]);
      add(head, new THREE.SphereGeometry(0.01, 6, 5), shine, [sd * 0.058 - 0.01, 0.038, 0.186]);
      // 上の牙（下向き）と下の牙（上向き）
      add(head, new THREE.ConeGeometry(0.012, 0.05, 4), fang, [sd * 0.03, -0.055, 0.175], [Math.PI, 0, 0]);
      add(head, new THREE.ConeGeometry(0.008, 0.03, 4), fang, [sd * 0.024, -0.105, 0.165]);
    });
    add(head, new THREE.SphereGeometry(0.02, 8, 6), pink, [0, -0.02, 0.195], null, [1.3, 0.8, 1]);
    P.mouth = add(head, new THREE.SphereGeometry(0.05, 12, 8), mouthM, [0, -0.08, 0.15], null, [1.1, 0.75, 0.5]);
    // 翼: 腕の骨（2 本）と指の骨（3 本）、そのあいだの膜。外側は折れる
    const wing = (sd) => {
      const root = pivot(body, sd * 0.18, 0.06, 0);
      const armB = pivot(root, 0, 0, 0); armB.rotation.z = -sd * Math.PI / 2;
      add(armB, new THREE.CylinderGeometry(0.02, 0.026, 0.42, 6), finger, [0, -0.21, 0]);
      const outer = pivot(armB, 0, -0.42, 0); P['outer' + sd] = outer;
      add(outer, new THREE.CylinderGeometry(0.014, 0.02, 0.4, 6), finger, [0, -0.2, 0]);
      add(outer, new THREE.SphereGeometry(0.026, 8, 6), finger);
      const tips = [[0.12, -0.78], [0.47, -0.64], [0.66, -0.32]];
      tips.forEach(([z, y]) => { const len = Math.hypot(z, y); const f = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.012, len, 5), finger); f.position.set(0, -0.4 + y / 2, z / 2); f.rotation.x = Math.atan2(z, -y); outer.add(f); });
      add(outer, new THREE.ConeGeometry(0.014, 0.07, 4), finger, [0, -0.36, -0.05], [-0.8, 0, 0]); // 親指のつめ
      const inner = new THREE.Shape(); inner.moveTo(0, 0); inner.lineTo(0, -0.42); inner.lineTo(0.44, -0.46); inner.quadraticCurveTo(0.3, -0.22, 0.4, 0.02); inner.lineTo(0, 0);
      const mi = new THREE.Mesh(new THREE.ShapeGeometry(inner, 6), memb); mi.rotation.y = -Math.PI / 2; armB.add(mi);
      const os = new THREE.Shape(); os.moveTo(0, 0); os.lineTo(0, -0.4);
      tips.forEach(([z, y], i) => { os.lineTo(z, -0.4 + y); if (i < tips.length - 1) os.quadraticCurveTo((z + tips[i + 1][0]) / 2 - 0.06, -0.4 + (y + tips[i + 1][1]) / 2 + 0.13, tips[i + 1][0], -0.4 + tips[i + 1][1]); });
      os.quadraticCurveTo(0.44, -0.25, 0.44, -0.02); os.lineTo(0, 0);
      const mo = new THREE.Mesh(new THREE.ShapeGeometry(os, 6), memb); mo.rotation.y = -Math.PI / 2; outer.add(mo);
      return { root, armB, outer };
    };
    P.wings = [wing(1), wing(-1)];
    [-1, 1].forEach((sd) => { add(body, new THREE.CylinderGeometry(0.018, 0.022, 0.12, 5), pink, [sd * 0.09, -0.29, -0.04], [0.3, 0, 0]); for (let i = 0; i < 3; i++) add(body, new THREE.ConeGeometry(0.008, 0.04, 4), pink, [sd * 0.09 + (i - 1) * 0.014, -0.36, -0.02], [Math.PI - 0.4, 0, 0]); });
  }

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
      const blink = Math.sin(tm * 1.3) > 0.993 ? 0.15 : 1; // まばたき
      P.eyes.forEach((e) => (e.scale.y = e.userData.sy * blink));
      P.drool.scale.y = 1.6 + Math.sin(tm * 2.2) * 0.5; P.drool.position.y += Math.cos(tm * 2.2) * 0.0005;
      P.puddle.scale.setScalar(1 + strike * 0.3);
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
})();
