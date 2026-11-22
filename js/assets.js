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
  // 第31版: 軽い版の岩（たくさん並べる用）。近い頂点を格子ごとに 1 つにまとめて三角形を減らす（頂点の色は平均）。
  // cells: 一番長い辺を何マスに分けるか（小さいほど粗く軽い）。面はかくかくにして、岩らしく見せる
  const lods = {};
  A.lowModel = function (name, cells) {
    const key = name + ':' + cells; if (lods[key]) return lods[key];
    const mdl = A.model(name); if (!mdl) return null;
    const parts = mdl.parts.map((pt) => {
      const src = pt.geo, pos = src.attributes.position, col = src.attributes.color, idx = src.index;
      const bb = src.boundingBox, cell = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z) / cells;
      const ids = new Map(), vmap = new Int32Array(pos.count), sum = [], csum = [], cnt = [];
      for (let i = 0; i < pos.count; i++) {
        const k = Math.floor((pos.getX(i) - bb.min.x) / cell) + ',' + Math.floor((pos.getY(i) - bb.min.y) / cell) + ',' + Math.floor((pos.getZ(i) - bb.min.z) / cell);
        let id = ids.get(k);
        if (id == null) { id = cnt.length; ids.set(k, id); sum.push(0, 0, 0); csum.push(0, 0, 0); cnt.push(0); }
        vmap[i] = id; sum[id * 3] += pos.getX(i); sum[id * 3 + 1] += pos.getY(i); sum[id * 3 + 2] += pos.getZ(i); cnt[id]++;
        if (col) { csum[id * 3] += col.getX(i); csum[id * 3 + 1] += col.getY(i); csum[id * 3 + 2] += col.getZ(i); }
      }
      const vp = new Float32Array(cnt.length * 3), vc = new Float32Array(cnt.length * 3);
      for (let i = 0; i < cnt.length; i++) for (let c = 0; c < 3; c++) { vp[i * 3 + c] = sum[i * 3 + c] / cnt[i]; vc[i * 3 + c] = col ? csum[i * 3 + c] / cnt[i] : 1; }
      // 三角形: まとめたあとに 3 つの角がちがう頂点のものだけ残す。面ごとに頂点を分けて、かくかくの面にする
      const tri = idx ? idx.array : Array.from({ length: pos.count }, (_, i) => i), out = [], oc = [];
      for (let t = 0; t < tri.length; t += 3) {
        const a = vmap[tri[t]], b = vmap[tri[t + 1]], c = vmap[tri[t + 2]];
        if (a === b || b === c || a === c) continue;
        [a, b, c].forEach((v) => { out.push(vp[v * 3], vp[v * 3 + 1], vp[v * 3 + 2]); oc.push(vc[v * 3], vc[v * 3 + 1], vc[v * 3 + 2]); });
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
      if (col) geo.setAttribute('color', new THREE.Float32BufferAttribute(oc, 3));
      geo.computeVertexNormals(); geo.computeBoundingBox(); geo.computeBoundingSphere();
      const mat = pt.mat.clone(); mat.flatShading = true;
      return { geo, mat, role: pt.role };
    });
    lods[key] = { height: mdl.height, kind: mdl.kind, name: mdl.name, parts, tris: parts.reduce((n, p) => n + p.geo.attributes.position.count / 3, 0) };
    return lods[key];
  };
  // 同じ木や岩をたくさん置く（InstancedMesh）。list: [{ x, y, z, s（倍率）, ry（向き）, sy（縦の倍率）, tint（葉の色の倍率） }]
  // lod を渡すと、軽い版（A.lowModel(name, lod)）を使う
  A.instances = function (name, list, parent, lod) {
    const mdl = lod ? A.lowModel(name, lod) : A.model(name); if (!mdl || !list.length) return [];
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
  // ---- 建物（第34版。背景ガチャ）: 色ごとの形を、頂点の色を使って 1 つの形にまとめる（描く回数を減らす）。
  // 窓（glass）は winMat（夜に明かりがともる材質）、明かり（lit）は光る材質で別に作る。戻り値は Group（足もとが y=0、中心が原点、正面は +z）
  const bldgGeo = {};
  A.bldgInfo = (name) => (D && D.bldg && D.bldg[name]) || null;
  A.building = function (name, winMat) {
    const B = A.bldgInfo(name); if (!B) return null;
    if (!bldgGeo[name]) {
      const parts = { solid: { pos: [], col: [], nor: [], idx: [], hasNor: true }, glass: { pos: [], col: [], nor: [], idx: [], hasNor: true }, lit: { pos: [], col: [], nor: [], idx: [], hasNor: true } };
      B.groups.forEach((g) => {
        const P = parts[g.k === 'glass' ? 'glass' : g.k === 'lit' ? 'lit' : 'solid'], base = P.pos.length / 3;
        const q = new Uint16Array(b64(g.pos)), nr = g.nor ? new Int8Array(b64(g.nor)) : null;
        const c = g.c;
        for (let i = 0; i < q.length; i++) { const k = i % 3; P.pos.push(g.min[k] + (q[i] / 65535) * (g.max[k] - g.min[k])); P.nor.push(nr ? nr[i] / 127 : 0); }
        for (let i = 0; i < g.n; i++) P.col.push(c[0], c[1], c[2]);
        if (!nr) P.hasNor = false;
        const id = g.idx32 ? new Uint32Array(b64(g.idx)) : new Uint16Array(b64(g.idx));
        for (let i = 0; i < id.length; i++) P.idx.push(base + id[i]);
      });
      bldgGeo[name] = {};
      Object.entries(parts).forEach(([k, P]) => {
        if (!P.idx.length) return;
        // 頂点の向き（法線）は、粗くまとめた形にはないので、三角形ごとに面の向きを使う（角ばった見た目）
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(P.pos, 3));
        geo.setAttribute('color', new THREE.Float32BufferAttribute(P.col, 3));
        geo.setIndex(P.idx);
        const flat = geo.toNonIndexed(); geo.dispose(); flat.computeVertexNormals(); flat.computeBoundingBox(); flat.computeBoundingSphere();
        bldgGeo[name][k] = flat;
      });
    }
    const G = bldgGeo[name], grp = new THREE.Group();
    const mats = A._bldgMats || (A._bldgMats = { solid: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.02, side: THREE.DoubleSide }), lit: new THREE.MeshStandardMaterial({ vertexColors: true, emissive: 0xffa040, emissiveIntensity: 1.2, roughness: 0.5 }) });
    if (G.solid) grp.add(new THREE.Mesh(G.solid, mats.solid));
    if (G.glass) grp.add(new THREE.Mesh(G.glass, winMat || mats.solid));
    if (G.lit) grp.add(new THREE.Mesh(G.lit, mats.lit));
    grp.userData.size = B.size; grp.userData.tris = B.tris; grp.userData.asset = name;
    return grp;
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
