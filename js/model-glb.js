// Blender で作ったモンスターの形（GLB）を読み込む（第45版）。three.min.js（r149）の THREE だけで動く小さな読み込み。
// 対応: 骨つきメッシュ・頂点の色・材質（色・粗さ・金属・光・両面）・動き（位置・回転・大きさ）。
// 形のデータは js/model-data.js（tests/build-models.js で作る。約 1.5MB）。最初の表示を遅らせないよう、ページを読み終わってから読み込む。
// まだ読み込めていないときは、今までの手作りの形を使う（MG.ModelGLB.has が false）。
(function () {
  'use strict';
  const MG = window.MG = window.MG || {};
  const CT = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
  const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
  const PATH = { translation: 'position', rotation: 'quaternion', scale: 'scale' };
  const cache = {};

  // 1 種類につき 1 回だけ: 形（ジオメトリ）・材質の値・動きを取り出す。形と動きは、同じ種類の敵みんなで使い回す
  function template(kind) {
    if (cache[kind]) return cache[kind];
    const s = atob(MG.MODEL_DATA[kind]), u8 = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
    const buf = u8.buffer, dv = new DataView(buf), jl = dv.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jl)));
    const b0 = 20 + jl + 8, bin = buf.slice(b0, b0 + dv.getUint32(20 + jl, true));
    const acc = (i) => {
      const a = json.accessors[i], bv = json.bufferViews[a.bufferView], T = CT[a.componentType], n = NC[a.type];
      const off = (bv.byteOffset || 0) + (a.byteOffset || 0);
      return { arr: new T(bin.slice(off, off + a.count * n * T.BYTES_PER_ELEMENT)), n, norm: !!a.normalized };
    };
    const attr = (i) => { const a = acc(i); return new THREE.BufferAttribute(a.arr, a.n, a.norm); };
    const prims = [];
    json.nodes.forEach((n, ni) => {
      if (n.mesh == null) return;
      json.meshes[n.mesh].primitives.forEach((p) => {
        const g = new THREE.BufferGeometry(), A = p.attributes;
        g.setAttribute('position', attr(A.POSITION));
        if (A.NORMAL != null) g.setAttribute('normal', attr(A.NORMAL));
        if (A.COLOR_0 != null) g.setAttribute('color', attr(A.COLOR_0));
        if (A.JOINTS_0 != null) g.setAttribute('skinIndex', attr(A.JOINTS_0));
        if (A.WEIGHTS_0 != null) g.setAttribute('skinWeight', attr(A.WEIGHTS_0));
        if (p.indices != null) g.setIndex(attr(p.indices));
        g.computeBoundingSphere();
        prims.push({ node: ni, geo: g, mat: p.material, skin: n.skin });
      });
    });
    const mats = (json.materials || []).map((m) => {
      const p = m.pbrMetallicRoughness || {}, e = m.extensions && m.extensions.KHR_materials_emissive_strength;
      return { name: m.name || '', color: p.baseColorFactor || [1, 1, 1, 1], metal: p.metallicFactor == null ? 1 : p.metallicFactor, rough: p.roughnessFactor == null ? 1 : p.roughnessFactor,
        emissive: m.emissiveFactor || null, ei: e ? e.emissiveStrength : 1, double: !!m.doubleSided };
    });
    const names = json.nodes.map((n, i) => THREE.PropertyBinding.sanitizeNodeName(n.name || 'node' + i));
    const clips = {};
    (json.animations || []).forEach((an) => {
      const tracks = an.channels.filter((c) => PATH[c.target.path]).map((c) => {
        const sm = an.samplers[c.sampler], prop = PATH[c.target.path];
        const T = prop === 'quaternion' ? THREE.QuaternionKeyframeTrack : THREE.VectorKeyframeTrack;
        return new T(names[c.target.node] + '.' + prop, Array.from(acc(sm.input).arr), Array.from(acc(sm.output).arr));
      });
      const short = an.name.replace(/^.*_/, ''); // 「魔竜_hover」→「hover」
      clips[short] = new THREE.AnimationClip(short, -1, tracks);
    });
    const skins = (json.skins || []).map((sk) => ({ joints: sk.joints, ibm: acc(sk.inverseBindMatrices).arr }));
    cache[kind] = { json, prims, mats, names, clips, skins };
    return cache[kind];
  }

  MG.ModelGLB = {
    has: (kind) => !!(MG.MODEL_DATA && MG.MODEL_DATA[kind] && window.THREE),
    // 1 体分を作る。makeMat(値) で材質を作る（敵の材質は、当たったときに光らせるので 1 体ごとに別にする）
    instance(kind, makeMat) {
      const T = template(kind), json = T.json;
      const joint = new Set(); T.skins.forEach((s) => s.joints.forEach((j) => joint.add(j)));
      const nodes = json.nodes.map((n, i) => {
        const o = joint.has(i) ? new THREE.Bone() : new THREE.Group();
        o.name = T.names[i];
        if (n.translation) o.position.fromArray(n.translation);
        if (n.rotation) o.quaternion.fromArray(n.rotation);
        if (n.scale) o.scale.fromArray(n.scale);
        return o;
      });
      json.nodes.forEach((n, i) => (n.children || []).forEach((c) => nodes[i].add(nodes[c])));
      const root = new THREE.Group();
      json.scenes[json.scene || 0].nodes.forEach((i) => root.add(nodes[i]));
      const mats = T.mats.map((m) => makeMat(m)), meshes = [];
      T.prims.forEach((p) => {
        const mesh = p.skin != null ? new THREE.SkinnedMesh(p.geo, mats[p.mat]) : new THREE.Mesh(p.geo, mats[p.mat]);
        mesh.userData.skin = p.skin; nodes[p.node].add(mesh); meshes.push(mesh);
      });
      root.updateMatrixWorld(true);
      meshes.forEach((m) => {
        if (m.userData.skin == null) return;
        const s = T.skins[m.userData.skin], bones = s.joints.map((j) => nodes[j]);
        m.bind(new THREE.Skeleton(bones, bones.map((b, k) => new THREE.Matrix4().fromArray(s.ibm, k * 16))), m.matrixWorld);
        m.frustumCulled = false; // 骨で動くと、もとの形の範囲から出ることがある
      });
      const bones = {}; nodes.forEach((o) => { if (o.isBone) bones[o.name] = o; });
      return { root, meshes, mats, bones, clips: T.clips };
    },
  };

  // ページを読み終わってから、形のデータを読み込む（index.html を開くだけでも動くよう、script を足す形にする）
  function loadData() {
    if (MG.MODEL_DATA || document.getElementById('model-data')) return;
    const s = document.createElement('script'); s.id = 'model-data'; s.src = 'js/model-data.js'; document.body.appendChild(s);
  }
  if (document.readyState === 'complete') setTimeout(loadData, 200);
  else window.addEventListener('load', () => setTimeout(loadData, 200));
})();
