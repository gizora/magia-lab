// エフェクト: Effekseer（EffekseerForWebGL 1.70e, MIT）で、本格的なエフェクトを重ねる
// エフェクト素材は Effekseer 公式サンプル（CC0）。start.bat（http://localhost）で開いたときだけ有効。
(function () {
  'use strict';
  const MG = (window.MG = window.MG || {});
  const E = (MG.Efk = { ready: false, failed: null, loaded: 0, total: 0, plays: 0, errors: [] });
  let ctx = null;
  const effects = {};

  // 使うエフェクト（effects/ フォルダーの中）
  const FILES = {
    Benediction: 'Pierre02/Benediction',
    SonicBoom: 'Pierre01/SonicBoom', Phantasm: 'Pierre01/PhantasmMeteor_Single',
    Fire: 'NextSoft01/MagicFire1', Cold: 'NextSoft01/MagicCold', Thunder: 'NextSoft01/MagicThunder', Dark: 'NextSoft01/MagicDark', Water: 'NextSoft01/MagicWater',
    Tornado: 'NextSoft01/MagicTornade', Light: 'NextSoft01/MagicLight', Meteo: 'NextSoft01/MagicMeteo', PowerUp: 'NextSoft01/PowerUp',
    Spark: 'AndrewFM01/electric_dust',
  };
  // 属性 → 着弾のエフェクト（k: 大きさの係数, c: 色合い [r,g,b]）
  // k: 爆発の半径 1m あたりの大きさ（大きさ 1 のときの見た目の幅から決めた）、c: 色合い [r,g,b]
  const IMPACT = {
    // 炎: その場で立ち上る炎（MagicFire1）。以前の FireBall は「溜めてから前へ撃ち出す」動きの入った素材で、着弾後にプレイヤー側へ飛んできた。
    // Flame も試したが、時間がたつと練習場全体に燃え広がる素材だったので使わない
    fire: { n: 'Fire', k: 0.3 }, plasma: { n: 'Thunder', k: 0.45, c: [255, 120, 255] }, force: { n: 'SonicBoom', k: 0.2, c: [255, 200, 110] },
    ice: { n: 'Cold', k: 0.4 }, crystal: { n: 'Cold', k: 0.38, c: [210, 255, 255] },
    lightning: { n: 'Thunder', k: 0.5 }, magnet: { n: 'Spark', k: 0.3, c: [255, 160, 170] },
    light: { n: 'Benediction', k: 0.11 }, prism: { n: 'Light', k: 0.26 }, arcane: { n: 'Light', k: 0.26, c: [140, 200, 255] }, time: { n: 'Light', k: 0.26, c: [190, 170, 255] },
    void: { n: 'Dark', k: 0.5 }, vacuum: { n: 'SonicBoom', k: 0.2, c: [220, 245, 255] }, ether: { n: 'Phantasm', k: 0.28, c: [210, 200, 255] },
    steam: { n: 'Water', k: 0.32, c: [235, 245, 255] }, acid: { n: 'Water', k: 0.32, c: [150, 255, 110] },
    wind: { n: 'Tornado', k: 0.26 }, sound: { n: 'SonicBoom', k: 0.2 }, earth: { n: 'SonicBoom', k: 0.2, c: [220, 170, 120] }, metal: { n: 'SonicBoom', k: 0.2, c: [210, 220, 235] },
  };
  // 長く続くエフェクトは、この秒数で新しい粒を出すのをやめ、残りは自然に消えるのを待つ
  const MAX_LIFE = { SonicBoom: 2.2, Phantasm: 3, Tornado: 3, Spark: 2.4, Benediction: 2.4 };
  const live = [];
  E.impactTable = IMPACT;

  E.init = function (renderer) {
    return new Promise((resolve) => {
      if (location.protocol === 'file:') { E.failed = 'file'; return resolve(false); }
      if (!window.effekseer) { E.failed = 'no-runtime'; return resolve(false); }
      try {
        window.effekseer.initRuntime('vendor/effekseer/effekseer.wasm', () => {
          try {
            ctx = window.effekseer.createContext();
            ctx.init(renderer.getContext(), { instanceMaxCount: 4000, squareMaxCount: 12000 });
            ctx.setRestorationOfStatesFlag(false);
            const names = Object.keys(FILES);
            E.total = names.length;
            names.forEach((n) => {
              effects[n] = ctx.loadEffect('effects/' + FILES[n] + '.efk', 1, () => { E.loaded++; }, (m, url) => { E.errors.push(n + ': ' + m + ' ' + url); });
            });
            E.ready = true;
            resolve(true);
          } catch (e) { E.failed = String(e); resolve(false); }
        }, () => { E.failed = 'wasm'; resolve(false); });
      } catch (e) { E.failed = String(e); resolve(false); }
    });
  };

  // 再生する（o: { scale, color: [r,g,b], rotY, speed }）
  E.play = function (name, pos, o) {
    if (!E.ready || !effects[name]) return null;
    o = o || {};
    const h = ctx.play(effects[name], pos.x, pos.y, pos.z);
    if (!h) return null;
    const s = o.scale || 1;
    h.setScale(s, s, s);
    if (o.rotY) h.setRotation(0, o.rotY, 0);
    if (o.color) h.setAllColor(o.color[0], o.color[1], o.color[2], 255);
    if (o.speed) h.setSpeed(o.speed);
    const ml = o.life || MAX_LIFE[name];
    if (ml) live.push({ h, t: ml });
    E.plays++;
    return h;
  };
  // 属性の着弾エフェクト（radius = 爆発の半径）
  E.impact = function (elem, pos, radius) {
    const d = IMPACT[elem] || IMPACT.arcane;
    const s = Math.max(0.3, Math.min(2.5, (radius || 2) * d.k));
    return E.play(d.n, pos, { scale: s, color: d.c });
  };

  // three.js が描いたあとに重ねて描く
  E.draw = function (dt, camera, renderer) {
    if (!E.ready || !ctx) return;
    ctx.update(Math.max(0, dt) * 60);
    for (let i = live.length - 1; i >= 0; i--) { live[i].t -= dt; if (live[i].t <= 0 || !live[i].h.exists) { if (live[i].h.exists) live[i].h.stopRoot(); live.splice(i, 1); } }
    ctx.setProjectionMatrix(camera.projectionMatrix.elements);
    ctx.setCameraMatrix(camera.matrixWorldInverse.elements);
    ctx.draw();
    renderer.resetState();
  };
  E.stopAll = function () { if (ctx) ctx.stopAll(); };
  E.restCount = function () { return ctx && ctx.getRestInstancesCount ? ctx.getRestInstancesCount() : -1; };
})();
