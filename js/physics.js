// 物理: Jolt Physics（JoltPhysics.js, MIT）で、壊れた地形や的を本物の物理で動かす
// start.bat（http://localhost）で開いたときだけ有効。index.html を直接開いたときは使わず、今までの動きになる。
(function () {
  'use strict';
  const MG = (window.MG = window.MG || {});
  const P = (MG.Phys = { ready: false, failed: null, bodyCount: 0, steps: 0, groundBuilds: 0 });
  let Jolt = null, jolt = null, system = null, bi = null;
  const L_STATIC = 0, L_MOVING = 1;
  const handles = new Set();
  let ground = [], groundTimer = 0;

  // ---- 初期化 ----
  P.init = async function () {
    if (location.protocol === 'file:') { P.failed = 'file'; return false; }
    try {
      const mod = await import(new URL('vendor/jolt/jolt-physics.wasm-compat.js', location.href).href);
      Jolt = await mod.default();
      const settings = new Jolt.JoltSettings();
      settings.mMaxBodies = 2048; settings.mMaxBodyPairs = 8192; settings.mMaxContactConstraints = 8192;
      const pair = new Jolt.ObjectLayerPairFilterTable(2);
      pair.EnableCollision(L_STATIC, L_MOVING);
      pair.EnableCollision(L_MOVING, L_MOVING);
      const bpStatic = new Jolt.BroadPhaseLayer(0), bpMoving = new Jolt.BroadPhaseLayer(1);
      const bpi = new Jolt.BroadPhaseLayerInterfaceTable(2, 2);
      bpi.MapObjectToBroadPhaseLayer(L_STATIC, bpStatic);
      bpi.MapObjectToBroadPhaseLayer(L_MOVING, bpMoving);
      settings.mObjectLayerPairFilter = pair;
      settings.mBroadPhaseLayerInterface = bpi;
      settings.mObjectVsBroadPhaseLayerFilter = new Jolt.ObjectVsBroadPhaseLayerFilterTable(settings.mBroadPhaseLayerInterface, 2, settings.mObjectLayerPairFilter, 2);
      jolt = new Jolt.JoltInterface(settings);
      Jolt.destroy(settings);
      system = jolt.GetPhysicsSystem();
      bi = system.GetBodyInterface();
      const g = new Jolt.Vec3(0, -20, 0); system.SetGravity(g); Jolt.destroy(g);
      P.ready = true;
      return true;
    } catch (e) {
      P.failed = String(e && e.message || e);
      P.ready = false;
      return false;
    }
  };

  // ---- 物体を作る ----
  function create(shape, pos, quat, motion, o) {
    o = o || {};
    const p = new Jolt.RVec3(pos.x, pos.y, pos.z);
    const q = new Jolt.Quat(quat ? quat.x : 0, quat ? quat.y : 0, quat ? quat.z : 0, quat ? quat.w : 1);
    const cs = new Jolt.BodyCreationSettings(shape, p, q, motion, motion === Jolt.EMotionType_Static ? L_STATIC : L_MOVING);
    cs.mFriction = o.friction == null ? 0.7 : o.friction;
    cs.mRestitution = o.restitution == null ? 0.15 : o.restitution;
    cs.mLinearDamping = o.linearDamping == null ? 0.08 : o.linearDamping;
    cs.mAngularDamping = o.angularDamping == null ? 0.12 : o.angularDamping;
    if (o.fast) cs.mMotionQuality = Jolt.EMotionQuality_LinearCast;
    const body = bi.CreateBody(cs);
    Jolt.destroy(cs); Jolt.destroy(p); Jolt.destroy(q);
    const id = body.GetID();
    bi.AddBody(id, o.sleep ? Jolt.EActivation_DontActivate : Jolt.EActivation_Activate);
    const h = { body, id, mesh: o.mesh || null, dynamic: motion === Jolt.EMotionType_Dynamic, alive: true, tag: o.tag || '' };
    if (h.dynamic) handles.add(h);
    P.bodyCount++;
    if (o.vel || o.ang) P.setVelocity(h, o.vel, o.ang);
    return h;
  }
  const motionOf = (o) => (o && o.static ? Jolt.EMotionType_Static : Jolt.EMotionType_Dynamic);

  // 箱（hx, hy, hz は半分の大きさ）
  P.box = function (pos, quat, hx, hy, hz, o) {
    if (!P.ready) return null;
    const v = new Jolt.Vec3(hx, hy, hz);
    const shape = new Jolt.BoxShape(v, Math.min(0.05, hx * 0.2, hy * 0.2, hz * 0.2), null);
    Jolt.destroy(v);
    return create(shape, pos, quat, motionOf(o), o);
  };
  P.sphere = function (pos, r, o) {
    if (!P.ready) return null;
    return create(new Jolt.SphereShape(r, null), pos, null, motionOf(o), o);
  };
  P.cylinder = function (pos, quat, halfH, r, o) {
    if (!P.ready) return null;
    return create(new Jolt.CylinderShape(halfH, r, Math.min(0.05, r * 0.2), null), pos, quat, motionOf(o), o);
  };
  // 凸形（three.js の形の頂点から）
  P.convex = function (pos, quat, geometry, scale, o) {
    if (!P.ready) return null;
    const st = new Jolt.ConvexHullShapeSettings();
    const a = geometry.attributes.position, seen = new Set();
    for (let i = 0; i < a.count; i++) {
      const k = a.getX(i).toFixed(2) + ',' + a.getY(i).toFixed(2) + ',' + a.getZ(i).toFixed(2);
      if (seen.has(k)) continue; seen.add(k);
      const v = new Jolt.Vec3(a.getX(i) * scale.x, a.getY(i) * scale.y, a.getZ(i) * scale.z);
      st.mPoints.push_back(v); Jolt.destroy(v);
    }
    const res = st.Create();
    if (!res.IsValid()) { Jolt.destroy(st); return P.sphere(pos, 0.5 * Math.max(scale.x, scale.y, scale.z), o); }
    const shape = res.Get();
    const h = create(shape, pos, quat, motionOf(o), o);
    Jolt.destroy(st);
    return h;
  };

  P.remove = function (h) {
    if (!h || !h.alive || !P.ready) return;
    h.alive = false;
    bi.RemoveBody(h.id); bi.DestroyBody(h.id);
    handles.delete(h);
    P.bodyCount--;
  };
  P.setVelocity = function (h, vel, ang) {
    if (!h || !h.alive) return;
    if (vel) { const v = new Jolt.Vec3(vel.x, vel.y, vel.z); bi.SetLinearVelocity(h.id, v); Jolt.destroy(v); }
    if (ang) { const v = new Jolt.Vec3(ang.x, ang.y, ang.z); bi.SetAngularVelocity(h.id, v); Jolt.destroy(v); }
    bi.ActivateBody(h.id);
  };
  // 衝撃を加える（Δ速度で指定。重さに関係なく同じだけ動く）
  P.kick = function (h, dv, spin) {
    if (!h || !h.alive || !h.dynamic) return;
    const lv = h.body.GetLinearVelocity();
    const v = new Jolt.Vec3(lv.GetX() + dv.x, lv.GetY() + dv.y, lv.GetZ() + dv.z);
    bi.SetLinearVelocity(h.id, v); Jolt.destroy(v);
    if (spin) { const a = new Jolt.Vec3(spin.x, spin.y, spin.z); bi.SetAngularVelocity(h.id, a); Jolt.destroy(a); }
    bi.ActivateBody(h.id);
  };
  // 元の場所へ戻して眠らせる
  P.teleport = function (h, pos, quat) {
    if (!h || !h.alive) return;
    const p = new Jolt.RVec3(pos.x, pos.y, pos.z), q = new Jolt.Quat(quat.x, quat.y, quat.z, quat.w), z = new Jolt.Vec3(0, 0, 0);
    bi.SetPositionAndRotation(h.id, p, q, Jolt.EActivation_DontActivate);
    bi.SetLinearVelocity(h.id, z); bi.SetAngularVelocity(h.id, z);
    bi.DeactivateBody(h.id);
    Jolt.destroy(p); Jolt.destroy(q); Jolt.destroy(z);
  };
  P.position = function (h) { const p = h.body.GetPosition(); return { x: p.GetX(), y: p.GetY(), z: p.GetZ() }; };
  P.isActive = (h) => !!(h && h.alive && bi.IsActive(h.id));
  P.speed = function (h) { const v = h.body.GetLinearVelocity(); return Math.hypot(v.GetX(), v.GetY(), v.GetZ()); };

  // ---- へこむ地面（高さの表）と、その外側の床 ----
  // sample(x, z) で高さを返す関数から作る。クレーターができたら作り直す（少しまとめてから）
  P.setGround = function (sample, size) {
    if (!P.ready) return;
    ground.forEach((h) => P.remove(h)); ground = [];
    const N = 128, half = size / 2, step = size / (N - 1);
    const st = new Jolt.HeightFieldShapeSettings();
    st.mOffset.Set(-half, 0, -half);
    st.mScale.Set(step, 1, step);
    st.mSampleCount = N;
    st.mHeightSamples.resize(N * N);
    const hs = new Float32Array(Jolt.HEAPF32.buffer, Jolt.getPointer(st.mHeightSamples.data()), N * N);
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) hs[z * N + x] = sample(-half + x * step, -half + z * step);
    const res = st.Create();
    if (res.IsValid()) ground.push(create(res.Get(), { x: 0, y: 0, z: 0 }, null, Jolt.EMotionType_Static, { friction: 0.8 }));
    Jolt.destroy(st);
    // 外側の床（真ん中に穴のあいた4枚の板。上面が y = 0）
    const R = 260, t = 1;
    [[0, half + (R - half) / 2, R, (R - half) / 2], [0, -half - (R - half) / 2, R, (R - half) / 2], [half + (R - half) / 2, 0, (R - half) / 2, half], [-half - (R - half) / 2, 0, (R - half) / 2, half]]
      .forEach(([x, z, hx, hz]) => ground.push(P.box({ x, y: -t, z }, null, hx, t, hz, { static: true, friction: 0.8 })));
    P.groundBuilds++;
  };
  P.rebuildGroundSoon = function (sample, size) {
    if (!P.ready) return;
    clearTimeout(groundTimer);
    groundTimer = setTimeout(() => { P.setGround(sample, size); handles.forEach((h) => { if (h.alive) bi.ActivateBody(h.id); }); }, 120);
  };

  // ---- 1コマ進めて、three.js の形に位置を写す ----
  P.step = function (dt) {
    if (!P.ready || dt <= 0) return;
    jolt.Step(Math.min(dt, 1 / 30), dt > 1 / 45 ? 2 : 1);
    P.steps++;
    handles.forEach((h) => {
      if (!h.mesh || !bi.IsActive(h.id)) return;
      const p = h.body.GetPosition(), q = h.body.GetRotation();
      h.mesh.position.set(p.GetX(), p.GetY(), p.GetZ());
      h.mesh.quaternion.set(q.GetX(), q.GetY(), q.GetZ(), q.GetW());
      // 地面の下へ落ちすぎたものは止める（念のため）
      if (p.GetY() < -40) P.remove(h);
    });
  };
  P.activeCount = function () { let n = 0; handles.forEach((h) => { if (bi.IsActive(h.id)) n++; }); return n; };
  P.dynamicCount = () => handles.size;
})();
