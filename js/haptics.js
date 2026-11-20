// 振動: 属性ごとの画面の揺れ方と、ゲームパッドの振動
(function () {
  'use strict';
  const MG = (window.MG = window.MG || {});

  // 属性 → 揺れ方
  //  jitter: 細かく速い小刻み（雷・プラズマ） / thump: 重く縦にドスン（岩・鋼・虚空）
  //  rumble: ゴゴゴと不規則（炎・蒸気・酸） / snap: 一瞬だけ鋭く（氷・結晶・光）
  //  sway: 横にゆさぶる（風・霊気・虹） / pulse: 一定のリズムで震える（音・磁・魔素）
  const PROFILE = {
    lightning: 'jitter', plasma: 'jitter', earth: 'thump', metal: 'thump', void: 'thump',
    fire: 'rumble', steam: 'rumble', acid: 'rumble', ice: 'snap', crystal: 'snap', light: 'snap',
    wind: 'sway', ether: 'sway', prism: 'sway', sound: 'pulse', magnet: 'pulse', arcane: 'pulse',
    force: 'thump', vacuum: 'sway', time: 'pulse',
  };
  // ゲームパッドの振動パターン [開始ms, 長さms, 強い側(低音), 弱い側(高音)]
  const PAD = {
    jitter: [[0, 50, 0.1, 1], [80, 50, 0.1, 0.9], [160, 50, 0.1, 0.8], [240, 40, 0.1, 0.6]],
    thump: [[0, 220, 1, 0.3], [260, 120, 0.4, 0.1]],
    rumble: [[0, 200, 0.55, 0.7], [220, 160, 0.35, 0.5], [400, 120, 0.2, 0.3]],
    snap: [[0, 70, 0, 1]],
    sway: [[0, 300, 0.25, 0.55]],
    pulse: [[0, 70, 0.6, 0.6], [140, 70, 0.6, 0.6], [280, 70, 0.5, 0.5]],
  };

  const shakes = [];
  let scale = 1, padOn = true;
  const H = {
    profileOf: (elem) => PROFILE[elem] || 'rumble',
    get scale() { return scale; },
    setScale(v) { scale = Math.max(0, Math.min(2, +v || 0)); },
    get padEnabled() { return padOn; },
    setPadEnabled(v) { padOn = !!v; },
    activeCount: () => shakes.length,
    lastPad: null,
    // 画面を揺らす（amp: 0〜1.5 くらい、dur: 秒）
    shake(elem, amp, dur) {
      if (scale <= 0 || amp <= 0) return;
      shakes.push({ kind: H.profileOf(elem), amp: Math.min(1.5, amp) * scale, dur: Math.max(0.08, dur || 0.3), t: 0, seed: Math.random() * 100 });
      if (shakes.length > 12) shakes.shift();
    },
    // カメラに加えるずれ { x, y, roll }
    offsets(dt) {
      const o = { x: 0, y: 0, roll: 0, yaw: 0, pitch: 0 };
      for (let i = shakes.length - 1; i >= 0; i--) {
        const s = shakes[i]; s.t += dt;
        const k = 1 - s.t / s.dur;
        if (k <= 0) { shakes.splice(i, 1); continue; }
        const e = k * k, a = s.amp, t = s.t + s.seed;
        const r = () => Math.random() * 2 - 1;
        if (s.kind === 'jitter') { o.x += r() * a * 0.07 * e; o.y += r() * a * 0.07 * e; o.roll += r() * a * 0.012 * e; o.yaw += r() * a * 0.007 * e; o.pitch += r() * a * 0.007 * e; }
        else if (s.kind === 'thump') { const b = Math.abs(Math.sin(s.t * 26)); o.y -= b * a * 0.3 * e; o.x += Math.sin(t * 13) * a * 0.04 * e; o.pitch -= b * a * 0.022 * e; o.yaw += Math.sin(t * 11) * a * 0.006 * e; }
        else if (s.kind === 'snap') { o.x += r() * a * 0.14 * e * e; o.y += r() * a * 0.14 * e * e; o.yaw += r() * a * 0.014 * e * e; o.pitch += r() * a * 0.014 * e * e; }
        else if (s.kind === 'sway') { o.x += Math.sin(s.t * 9) * a * 0.22 * e; o.roll += Math.sin(s.t * 7) * a * 0.03 * e; o.yaw += Math.sin(s.t * 9) * a * 0.018 * e; }
        else if (s.kind === 'pulse') { const p = Math.sin(s.t * 38) * (Math.sin(s.t * 12) > 0 ? 1 : 0.2); o.y += p * a * 0.12 * e; o.x += p * a * 0.05 * e; o.pitch += p * a * 0.009 * e; }
        else { o.x += (Math.sin(t * 31) + r() * 0.5) * a * 0.12 * e; o.y += (Math.sin(t * 23) + r() * 0.5) * a * 0.1 * e; o.roll += r() * a * 0.01 * e; o.yaw += (Math.sin(t * 17) + r() * 0.4) * a * 0.008 * e; o.pitch += (Math.sin(t * 21) + r() * 0.4) * a * 0.008 * e; }
      }
      return o;
    },
    pads() {
      try {
        const list = navigator.getGamepads ? navigator.getGamepads() : [];
        return Array.from(list || []).filter((g) => g && g.connected);
      } catch (e) { return []; }
    },
    padName() { const p = H.pads()[0]; return p ? p.id : ''; },
    padCanRumble() { return H.pads().some((g) => g.vibrationActuator || (g.hapticActuators && g.hapticActuators.length)); },
    // ゲームパッドを振動させる（strength: 0〜1）
    rumble(elem, strength) {
      if (!padOn) return 0;
      const pads = H.pads();
      if (!pads.length) return 0;
      const pat = PAD[H.profileOf(elem)];
      const k = Math.max(0.05, Math.min(1, strength == null ? 0.6 : strength));
      let n = 0;
      pads.forEach((g) => {
        pat.forEach(([at, ms, strong, weak]) => {
          const fire = () => {
            const p = { startDelay: 0, duration: ms, strongMagnitude: Math.min(1, strong * k), weakMagnitude: Math.min(1, weak * k) };
            H.lastPad = p;
            try {
              if (g.vibrationActuator && g.vibrationActuator.playEffect) {
                const r = g.vibrationActuator.playEffect(g.vibrationActuator.type || 'dual-rumble', p);
                if (r && r.catch) r.catch(() => {});
              } else if (g.hapticActuators && g.hapticActuators[0]) {
                const r = g.hapticActuators[0].pulse(Math.max(strong, weak) * k, ms);
                if (r && r.catch) r.catch(() => {});
              }
            } catch (e) { /* 振動に対応していないパッド */ }
          };
          if (at) setTimeout(fire, at); else fire();
          n++;
        });
      });
      return n;
    },
    // 両方まとめて
    feel(elem, amp, dur, padStrength) {
      H.shake(elem, amp, dur);
      H.rumble(elem, padStrength == null ? Math.min(1, amp) : padStrength);
    },
  };
  MG.Haptics = H;
})();
