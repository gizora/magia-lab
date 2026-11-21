// 見た目の素材（js/asset-data.js の空・模様・木・岩）を、three.js の模様と形にする（第30版）
// 素材が入っていないとき（asset-data.js がない・読めない）は null を返し、world.js は今までの手作りの見た目のまま動く
(function () {
  'use strict';
  const MG = window.MG;
  const D = MG.ASSET_DATA || null;
  const A = (MG.Assets = { has: !!D });
  let pending = 0;
  const images = {};
  // 画像は data URL から非同期に読みこむ。読み終わったら、その画像を使う模様をすべて描き直す
  function image(url) {
    if (images[url]) return images[url];
    const rec = { im: new Image(), texs: [], ok: false, cbs: [] };
    pending++;
    rec.im.onload = () => { rec.ok = true; pending--; rec.texs.forEach((t) => (t.needsUpdate = true)); rec.cbs.forEach((f) => f(rec.im)); };
    rec.im.onerror = () => { pending--; };
    rec.im.src = url;
    images[url] = rec;
    return rec;
  }
  function texFrom(url, o) {
    o = o || {};
    const rec = image(url), t = new THREE.Texture(rec.im);
    t.wrapS = o.clampS ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    t.wrapT = o.clampT ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    if (o.srgb !== false) t.encoding = THREE.sRGBEncoding;
    if (o.flipY === false) t.flipY = false;
    if (o.noMips) { t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; }
    t.anisotropy = A.aniso || 4;
    if (o.rx != null) t.repeat.set(o.rx, o.ry == null ? o.rx : o.ry);
    if (rec.ok) t.needsUpdate = true;
    rec.texs.push(t);
    return t;
  }
  // 全部の画像を読み終えたか（動作確認で待つのに使う）
  A.loaded = () => pending === 0;
  A.pending = () => pending;

  // ---- 模様（地面・壁・屋根）: 1 枚が何 m 四方かを知っているので、貼る面の大きさ（m）から繰り返しの数を決められる ----
  A.texInfo = (name) => (D && D.tex[name]) || null;
  // tex(名前, { m: [幅m, 高さm] で面の大きさ ／ rx, ry で繰り返しの数を直接 })
  A.tex = function (name, o) {
    const info = A.texInfo(name); if (!info) return null;
    o = Object.assign({}, o);
    if (o.m) { o.rx = o.m[0] / info.w; o.ry = o.m[1] / info.h; }
    return texFrom(info.url, o);
  };

  // ---- 空（正距円筒のパノラマの上半分）。空の色合いは shader でそのまま出すので、色の変換はしない ----
  A.skyInfo = (name) => (D && D.sky[name]) || null;
  A.sky = function (name) {
    const info = A.skyInfo(name); if (!info) return null;
    return texFrom(info.url, { srgb: false, clampT: true, noMips: true });
  };

  // ---- 木と岩: 詰めた数値を形に戻す。同じ素材は 1 回だけ作って使い回す ----
  const b64 = (s) => { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; };
  function decodePrim(p) {
    const geo = new THREE.BufferGeometry();
    const q = new Uint16Array(b64(p.pos)), pos = new Float32Array(q.length);
    for (let i = 0; i < q.length; i++) { const c = i % 3; pos[i] = p.min[c] + (q[i] / 65535) * (p.max[c] - p.min[c]); }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    if (p.nor) { const qn = new Int8Array(b64(p.nor)), nr = new Float32Array(qn.length); for (let i = 0; i < qn.length; i++) nr[i] = qn[i] / 127; geo.setAttribute('normal', new THREE.BufferAttribute(nr, 3)); }
    if (p.uv) { const qu = new Uint16Array(b64(p.uv)), uv = new Float32Array(qu.length); for (let i = 0; i < qu.length; i++) uv[i] = p.uvMin + (qu[i] / 65535) * (p.uvMax - p.uvMin); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); }
    if (p.col) { const qc = new Uint8Array(b64(p.col)), co = new Float32Array(qc.length); for (let i = 0; i < qc.length; i++) co[i] = qc[i] / 255; geo.setAttribute('color', new THREE.BufferAttribute(co, 3)); }
    if (p.idx) geo.setIndex(new THREE.BufferAttribute(p.idx32 ? new Uint32Array(b64(p.idx)) : new Uint16Array(b64(p.idx)), 1));
    if (!p.nor) geo.computeVertexNormals();
    geo.computeBoundingBox(); geo.computeBoundingSphere();
    return geo;
  }
  const models = {};
  A.modelInfo = (name) => (D && D.models[name]) || null;
  // model(名前) → { height, kind, parts: [{ geo, mat, role: 'bark' | 'leaf' | 'rock' }] }
  A.model = function (name) {
    if (models[name]) return models[name];
    const m = A.modelInfo(name); if (!m) return null;
    const im = m.images;
    const parts = m.prims.map((p) => {
      let mat;
      if (p.mat === 'leaf') mat = new THREE.MeshStandardMaterial({ map: texFrom(im.leaf, { flipY: false }), alphaTest: p.alpha || 0.5, side: THREE.DoubleSide, roughness: p.rough });
      else if (p.mat === 'bark') mat = new THREE.MeshStandardMaterial({ map: texFrom(im.bark, { flipY: false }), normalMap: im.barkN ? texFrom(im.barkN, { flipY: false, srgb: false }) : null, roughness: p.rough });
      else mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: p.rough || 0.95 });
      return { geo: decodePrim(p), mat, role: p.mat };
    });
    models[name] = { height: m.height, kind: m.kind, name: m.name, parts };
    return models[name];
  };
  // 同じ木や岩をたくさん置く（InstancedMesh）。list: [{ x, y, z, s（倍率）, ry（向き）, sy（縦の倍率）, tint（葉の色の倍率） }]
  A.instances = function (name, list, parent) {
    const mdl = A.model(name); if (!mdl || !list.length) return [];
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
    return mdl.parts.map((pt) => {
      const im = new THREE.InstancedMesh(pt.geo, pt.mat, list.length);
      list.forEach((o, i) => {
        q.setFromAxisAngle(up, o.ry || 0); p.set(o.x, o.y || 0, o.z); s.set(o.s, o.s * (o.sy || 1), o.s);
        mtx.compose(p, q, s); im.setMatrixAt(i, mtx);
        if (pt.role === 'leaf' || pt.role === 'rock') { col.setRGB(1, 1, 1); if (o.tint) col.multiply(o.tint); im.setColorAt(i, col); }
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.frustumCulled = false; // 置いた場所ぜんたいが入るように（InstancedMesh は元の形の大きさでしか見えるかを判断しない）
      im.userData.asset = name;
      parent.add(im);
      return im;
    });
  };
  // 岩の形を 1 つだけ取り出す（壊せる岩用。けずるので形は毎回複製する）。中心を原点に、半径 r ほどの大きさにする
  A.rockGeometry = function (name, r, stretch) {
    const mdl = A.model(name); if (!mdl) return null;
    const g = mdl.parts[0].geo.clone();
    const bb = g.boundingBox, cx = (bb.min.x + bb.max.x) / 2, cy = (bb.min.y + bb.max.y) / 2, cz = (bb.min.z + bb.max.z) / 2;
    const half = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) / 2;
    g.translate(-cx, -cy, -cz);
    const k = r / half, st = stretch || [1, 1, 1];
    g.scale(k * st[0], k * st[1], k * st[2]);
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  };
})();
