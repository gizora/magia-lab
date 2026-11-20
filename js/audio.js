// 効果音と環境音。Web Audio API でその場で合成した音に、第22版から音の素材（js/sfx-data.js）を重ねる
// 迫力を出すために: 残響（ホールのような響き）・ひずみ・重低音・ゆらぎ（炎のちらつき）を重ねる
// 着弾・命中の音は属性ごとに作り分け、鳴った場所に合わせて左右と音量を変える
(function () {
  'use strict';
  const MG = (window.MG = window.MG || {});

  let ctx = null, master = null, sfxBus = null, ambBus = null, revIn = null;
  let white = null, brown = null;
  let enabled = true;
  let synthK = 1;            // 合成した音の大きさ（素材の音を重ねるときは小さくする）
  const samples = {};        // 素材の音（解読済みの AudioBuffer）
  let sampleVoices = 0;      // 今鳴っている素材の音の数（鳴らしすぎないように）
  const MAX_VOICES = 16;
  const lastPlay = {};
  const shapers = {};

  function now() { return ctx.currentTime; }

  // 残響の響き方（インパルス応答）をその場で作る: 初期反射 + なめらかに消える残響
  function makeImpulse(sec, decay) {
    const len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / ctx.sampleRate;
        let v = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
        if (t < 0.08 && Math.random() < 0.004) v += (Math.random() * 2 - 1) * 1.5; // 初期反射
        d[i] = v;
      }
    }
    return buf;
  }

  function unlock() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { ctx = new AC(); } catch (e) { ctx = null; return; }
      // 出口: 音のかたまり → 圧縮 → リミッター → スピーカー
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18; comp.knee.value = 8; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.25;
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.001; limiter.release.value = 0.1;
      master = ctx.createGain(); master.gain.value = enabled ? 0.9 : 0;
      sfxBus = ctx.createGain(); sfxBus.gain.value = 0.85;
      ambBus = ctx.createGain(); ambBus.gain.value = 0.55;
      // 残響
      const conv = ctx.createConvolver(); conv.buffer = makeImpulse(2.8, 2.6);
      revIn = ctx.createGain(); revIn.gain.value = 1;
      const revHp = ctx.createBiquadFilter(); revHp.type = 'highpass'; revHp.frequency.value = 120;
      const revOut = ctx.createGain(); revOut.gain.value = 0.5;
      revIn.connect(revHp); revHp.connect(conv); conv.connect(revOut); revOut.connect(master);
      sfxBus.connect(master); ambBus.connect(master);
      master.connect(comp); comp.connect(limiter); limiter.connect(ctx.destination);
      // ノイズ（白: シャー / 茶: ゴー と低い）
      const len = ctx.sampleRate * 3;
      white = ctx.createBuffer(1, len, ctx.sampleRate);
      brown = ctx.createBuffer(1, len, ctx.sampleRate);
      const w = white.getChannelData(0), b = brown.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) { const r = Math.random() * 2 - 1; w[i] = r; last = (last + 0.02 * r) / 1.02; b[i] = last * 3.5; }
      decodeSamples();
    }
    if (ctx.state === 'suspended') { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); }
  }

  function ready() { return ctx && enabled && ctx.state === 'running'; }

  // ---- 音の素材（第22版） ----
  // js/sfx-data.js の mp3（base64）を解読しておく。解読が終わるまでは、合成した音だけが鳴る
  function decodeSamples() {
    const data = MG.SFX_DATA || {};
    Object.keys(data).forEach((key) => {
      try {
        const bin = atob(data[key]); const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const done = (buf) => { if (buf) samples[key] = buf; };
        const pr = ctx.decodeAudioData(bytes.buffer, done, () => {});
        if (pr && pr.then) pr.then(done).catch(() => {});
      } catch (e) { /* この素材は使わない */ }
    });
  }
  // 素材を鳴らす。o: { rate（速さ＝音の高さ）, offset（何秒目から）, dur（何秒分）, vol, delay, dest（出口）, rev（残響へ送る量）, fadeIn, lp（こもらせる）}
  function sample(key, o) {
    const buf = samples[key];
    if (!buf || sampleVoices >= MAX_VOICES) return false;
    o = o || {};
    const rate = o.rate || 1, off = Math.min(buf.duration - 0.05, o.offset || 0);
    const len = Math.min(o.dur || buf.duration, buf.duration - off), real = len / rate;
    const t0 = now() + (o.delay || 0), vol = Math.max(0.0002, o.vol == null ? 0.8 : o.vol);
    const src = ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = rate;
    const g = ctx.createGain();
    const fi = Math.min(o.fadeIn || 0, real * 0.5), fo = Math.min(0.3, real * 0.3);
    g.gain.setValueAtTime(fi ? 0.0002 : vol, t0);
    if (fi) g.gain.exponentialRampToValueAtTime(vol, t0 + fi);
    g.gain.setValueAtTime(vol, Math.max(t0 + fi, t0 + real - fo));
    g.gain.exponentialRampToValueAtTime(0.0002, t0 + real);
    let node = src;
    if (o.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; node.connect(f); node = f; }
    node.connect(g); g.connect(o.dest || sfxBus);
    if (o.rev) { const w = ctx.createGain(); w.gain.value = o.rev; g.connect(w); w.connect(revIn); }
    src.start(t0, off, len + 0.02);
    sampleVoices++;
    src.onended = () => { sampleVoices = Math.max(0, sampleVoices - 1); try { g.disconnect(); } catch (e) { /* */ } };
    return true;
  }
  const has = (key) => !!samples[key];
  // 合成した音を、k 倍の大きさで鳴らす（素材の音と重ねるとき）
  function soft(k, fn) { const keep = synthK; synthK = k; try { fn(); } finally { synthK = keep; } }
  function throttle(key, ms) {
    const t = performance.now();
    if (lastPlay[key] && t - lastPlay[key] < ms) return false;
    lastPlay[key] = t; return true;
  }

  // ひずみ（音を太く荒くする）
  function shaper(k) {
    k = Math.round(k);
    if (!shapers[k]) {
      const n = 1024, c = new Float32Array(n);
      for (let i = 0; i < n; i++) { const x = (i / n) * 2 - 1; c[i] = ((1 + k) * x) / (1 + k * Math.abs(x)); }
      shapers[k] = c;
    }
    const s = ctx.createWaveShaper(); s.curve = shapers[k]; s.oversample = '2x';
    return s;
  }

  // 鳴った場所に合わせた出口（ap = { pan: -1〜1, vol: 0〜1 }）と、残響への送り
  function bus(ap, rev) {
    const g = ctx.createGain(); g.gain.value = ap ? Math.max(0.05, Math.min(1, ap.vol == null ? 1 : ap.vol)) : 1;
    let out = g;
    if (ap && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, ap.pan || 0)); g.connect(p); out = p; }
    out.connect(sfxBus);
    // 遠い音ほど残響の割合を増やす（距離感）
    const wet = ctx.createGain(); wet.gain.value = (rev == null ? 0.35 : rev) * (ap ? 0.6 + (1 - (ap.vol || 1)) * 0.8 : 1);
    out.connect(wet); wet.connect(revIn);
    setTimeout(() => { try { g.disconnect(); if (out !== g) out.disconnect(); wet.disconnect(); } catch (e) { /* もう外れている */ } }, 6000);
    return g;
  }

  function env(param, t0, attack, hold, dur, vol) {
    param.setValueAtTime(0.0001, t0);
    param.exponentialRampToValueAtTime(Math.max(vol, 0.0002), t0 + attack);
    if (hold) param.setValueAtTime(Math.max(vol, 0.0002), t0 + attack + hold);
    param.exponentialRampToValueAtTime(0.0001, t0 + dur);
  }

  // 出口までの共通処理: ひずみ → 音量の形 → ゆらぎ → 出口
  function finish(src, o, t0, dur, vol) {
    let node = src;
    if (o.dist) { const s = shaper(o.dist); node.connect(s); node = s; }
    const g = ctx.createGain();
    env(g.gain, t0, o.attack || 0.005, o.hold || 0, dur, vol);
    node.connect(g);
    let out = g;
    if (o.am) { // ゆらぎ（炎のちらつき・羽音など）
      const amg = ctx.createGain(); amg.gain.value = 1 - o.am.depth / 2;
      const lfo = ctx.createOscillator(); lfo.frequency.value = o.am.freq; lfo.type = o.am.type || 'sine';
      const lg = ctx.createGain(); lg.gain.value = o.am.depth / 2;
      lfo.connect(lg); lg.connect(amg.gain); lfo.start(t0); lfo.stop(t0 + dur + 0.05);
      g.connect(amg); out = amg;
    }
    out.connect(o.dest || sfxBus);
    if (o.rev && !o.dest) { const w = ctx.createGain(); w.gain.value = o.rev; out.connect(w); w.connect(revIn); }
  }

  function tone(o) {
    const dur = o.dur || 0.3, vol = (o.vol == null ? 0.2 : o.vol) * synthK;
    const t0 = now() + (o.delay || 0);
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f0 || 440, t0);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(o.f1, 1), t0 + (o.glide || dur));
    if (o.detune) osc.detune.value = o.detune;
    if (o.vib) {
      const lfo = ctx.createOscillator(), lg = ctx.createGain();
      lfo.frequency.value = o.vib; lg.gain.value = o.vibDepth || 20;
      lfo.connect(lg); lg.connect(osc.frequency); lfo.start(t0); lfo.stop(t0 + dur + 0.05);
    }
    let node = osc;
    if (o.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; f.Q.value = o.q || 0.7; node.connect(f); node = f; }
    finish(node, o, t0, dur, vol);
    osc.start(t0); osc.stop(t0 + dur + 0.05);
  }

  function noise(o) {
    const dur = o.dur || 0.3, vol = (o.vol == null ? 0.2 : o.vol) * synthK;
    const t0 = now() + (o.delay || 0);
    const src = ctx.createBufferSource();
    src.buffer = o.brown ? brown : white;
    src.loop = true;
    src.playbackRate.value = o.rate || 1;
    const f = ctx.createBiquadFilter();
    f.type = o.type || 'bandpass';
    f.frequency.setValueAtTime(o.f0 || 1000, t0);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t0 + (o.sweep || dur));
    f.Q.value = o.q || 1;
    finish(f, o, t0, dur, vol);
    src.connect(f);
    src.start(t0, Math.random() * 2); src.stop(t0 + dur + 0.05);
  }

  const rnd = (a, b) => a + Math.random() * (b - a);

  // ---- 共通の部品 ----
  // ドンという衝撃（低音の胴鳴り + アタックの音）
  function thump(d, s, f0, f1, len) {
    tone({ f0: f0 || 120, f1: f1 || 32, glide: 0.25, dur: (len || 0.6) * (0.8 + s * 0.3), vol: 0.75 * s, dest: d });
    noise({ type: 'lowpass', f0: 3500, f1: 400, dur: 0.06, vol: 0.5 * s, dest: d });
  }
  // 爆発の本体（ひずませた低いノイズが広がる）
  function blast(d, s, color) {
    noise({ brown: true, type: 'lowpass', f0: color || 2200, f1: 90, sweep: 0.9, q: 0.8, dur: 1.2 + s * 0.6, vol: 0.9 * s, attack: 0.004, dist: 6, dest: d });
    noise({ type: 'bandpass', f0: 900, f1: 150, q: 0.6, dur: 0.5, vol: 0.45 * s, dest: d });
  }
  // 飛び散る小石・破片
  function debris(d, s, n, lo, hi, spread) {
    for (let i = 0; i < n; i++) noise({ type: 'bandpass', f0: rnd(lo, hi), q: 3, dur: rnd(0.03, 0.08), vol: rnd(0.08, 0.2) * s, delay: 0.08 + Math.random() * (spread || 0.9), dest: d });
  }
  // パチパチはぜる火の粉
  function crackles(d, s, n, spread) {
    for (let i = 0; i < n; i++) noise({ type: 'highpass', f0: rnd(2500, 7000), dur: rnd(0.008, 0.03), vol: rnd(0.06, 0.22) * s, delay: Math.random() * (spread || 1.2), dest: d });
  }

  // ---- 属性ごとの発動音（自分の手元で鳴る） ----
  const CAST = {
    fire() { // ゴオッと炎が噴き出す
      noise({ brown: true, type: 'bandpass', f0: 250, f1: 900, q: 0.7, dur: 0.75, vol: 0.9, attack: 0.04, am: { freq: 11, depth: 0.6 }, dist: 3, rev: 0.25 });
      noise({ type: 'bandpass', f0: 600, f1: 2600, q: 0.9, dur: 0.5, vol: 0.35, attack: 0.03 });
      tone({ f0: 110, f1: 45, dur: 0.4, vol: 0.45 });
      crackles(null, 0.8, 8, 0.7);
    },
    ice() { // キィン…と凍りつく
      [2093, 2637, 3136, 3951, 4699].forEach((f, i) => tone({ f0: f, f1: f * 1.01, dur: 0.9, vol: 0.06, delay: i * 0.035, rev: 0.6 }));
      noise({ type: 'highpass', f0: 6000, dur: 0.5, vol: 0.18, attack: 0.02, rev: 0.4 });
      tone({ type: 'triangle', f0: 880, f1: 1760, dur: 0.2, vol: 0.06 });
    },
    steam() { noise({ type: 'highpass', f0: 3500, f1: 1200, dur: 0.9, vol: 0.4, attack: 0.04, rev: 0.3 }); noise({ brown: true, type: 'lowpass', f0: 400, dur: 0.5, vol: 0.3 }); },
    lightning() { // バチバチッ
      for (let i = 0; i < 7; i++) noise({ type: 'bandpass', f0: rnd(1500, 6000), q: 2.5, dur: 0.05, vol: 0.45, delay: i * rnd(0.02, 0.05), dist: 8 });
      tone({ type: 'sawtooth', f0: 2400, f1: 90, glide: 0.2, dur: 0.3, vol: 0.14, dist: 4, rev: 0.3 });
    },
    plasma() { tone({ type: 'square', f0: 160, f1: 1600, dur: 0.4, vol: 0.12, vib: 34, vibDepth: 90, lp: 3200, rev: 0.3 }); tone({ f0: 80, f1: 35, dur: 0.5, vol: 0.4 }); noise({ type: 'bandpass', f0: 2000, f1: 5000, q: 3, dur: 0.3, vol: 0.15 }); },
    light() { [880, 1320, 1760, 2640, 3520].forEach((f, i) => tone({ f0: f, dur: 0.6, vol: 0.07, delay: i * 0.03, rev: 0.6 })); noise({ type: 'highpass', f0: 7000, dur: 0.4, vol: 0.12, attack: 0.05 }); },
    acid() { for (let i = 0; i < 8; i++) tone({ f0: rnd(300, 900), f1: rnd(80, 200), dur: 0.08, vol: 0.12, delay: i * 0.04 }); noise({ type: 'bandpass', f0: 3800, q: 2, dur: 0.5, vol: 0.18, am: { freq: 17, depth: 0.7 } }); },
    metal() { [523, 1307, 2093, 3170, 4400].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: 1.0 - i * 0.12, vol: 0.07, rev: 0.45 })); noise({ type: 'highpass', f0: 4000, dur: 0.06, vol: 0.3 }); },
    earth() { tone({ f0: 80, f1: 30, dur: 0.6, vol: 0.7, dist: 3 }); noise({ brown: true, type: 'lowpass', f0: 700, f1: 150, dur: 0.6, vol: 0.6 }); debris(null, 0.7, 6, 300, 1200, 0.4); },
    void() { noise({ brown: true, type: 'lowpass', f0: 120, f1: 1500, dur: 0.45, vol: 0.4, attack: 0.35 }); tone({ type: 'sawtooth', f0: 60, f1: 40, dur: 0.8, vol: 0.18, lp: 400, dist: 5, rev: 0.4 }); },
    ether() { [440, 443, 660, 664, 880].forEach((f) => tone({ f0: f, f1: f * 1.5, dur: 0.9, vol: 0.05, attack: 0.12, vib: 5, vibDepth: 8, rev: 0.7 })); },
    arcane() { tone({ f0: 400, f1: 1600, dur: 0.3, vol: 0.16, rev: 0.4 }); [2400, 3000, 3600].forEach((f, i) => tone({ f0: f, dur: 0.35, vol: 0.04, delay: 0.06 + i * 0.04, rev: 0.6 })); noise({ type: 'bandpass', f0: 2500, q: 2, dur: 0.25, vol: 0.12 }); },
    crystal() { [1568, 2093, 2637, 3136, 4186, 5274].forEach((f, i) => tone({ f0: f, dur: 1.0, vol: 0.05, delay: i * 0.05, rev: 0.7 })); },
    wind() { noise({ type: 'bandpass', f0: 350, f1: 2800, q: 1.4, dur: 0.6, vol: 0.55, attack: 0.1, rev: 0.25 }); noise({ type: 'bandpass', f0: 1200, f1: 4000, q: 4, dur: 0.4, vol: 0.12, attack: 0.15 }); },
    prism() { [523, 659, 784, 988, 1175, 1319, 1568].forEach((f, i) => tone({ f0: f * 2, dur: 0.45, vol: 0.05, delay: i * 0.025, rev: 0.6 })); },
    sound() { tone({ type: 'square', f0: 330, dur: 0.45, vol: 0.06, lp: 2000 }); tone({ type: 'square', f0: 336, dur: 0.45, vol: 0.06, lp: 2000 }); tone({ f0: 165, f1: 330, dur: 0.35, vol: 0.2, rev: 0.4 }); },
    magnet() { tone({ type: 'sawtooth', f0: 110, f1: 440, dur: 0.5, vol: 0.12, vib: 18, vibDepth: 30, lp: 1500, rev: 0.3 }); tone({ f0: 880, f1: 220, dur: 0.35, vol: 0.06 }); },
    force() { // ドンッと力を打ち出す
      tone({ f0: 95, f1: 38, dur: 0.45, vol: 0.8, dist: 4 });
      noise({ brown: true, type: 'bandpass', f0: 250, f1: 700, q: 0.8, dur: 0.35, vol: 0.6, dist: 5 });
      tone({ type: 'sawtooth', f0: 220, f1: 330, dur: 0.25, vol: 0.06, lp: 1200, rev: 0.3 });
    },
    vacuum() { // シュッと空気が吸いこまれる
      noise({ type: 'bandpass', f0: 4000, f1: 300, q: 1.5, dur: 0.45, vol: 0.45, attack: 0.02 });
      noise({ brown: true, type: 'lowpass', f0: 1200, f1: 100, dur: 0.4, vol: 0.4 });
      tone({ f0: 1800, f1: 600, dur: 0.3, vol: 0.04, rev: 0.5 });
    },
    time() { // チッ、チッと時を刻み、ふわっと巻き戻る
      [0, 0.09, 0.18].forEach((d) => tone({ type: 'square', f0: 2200, dur: 0.02, vol: 0.06, delay: d, lp: 5000 }));
      tone({ f0: 330, f1: 990, dur: 0.6, vol: 0.08, attack: 0.25, rev: 0.6 }); tone({ f0: 494, f1: 1480, dur: 0.6, vol: 0.05, attack: 0.25, rev: 0.6 });
    },
  };

  // ---- 属性ごとの着弾音（s = 大きさ 0.4〜1.6、d = 出口） ----
  const IMPACT = {
    fire(s, d) { // ドォンと爆ぜて、ゴオォォと燃え広がり、火の粉がはぜる
      thump(d, s, 130, 30, 0.8);
      blast(d, s, 2600);
      noise({ brown: true, type: 'bandpass', f0: 300, f1: 140, q: 0.6, dur: 1.6 + s * 0.6, vol: 0.7 * s, attack: 0.08, hold: 0.2, am: { freq: rnd(8, 13), depth: 0.65 }, dist: 3, dest: d });
      noise({ type: 'bandpass', f0: 1200, f1: 500, q: 0.8, dur: 1.2, vol: 0.25 * s, attack: 0.05, am: { freq: 17, depth: 0.5 }, dest: d });
      crackles(d, s, 22, 1.8);
    },
    ice(s, d) { // バキッと凍った物が割れて、破片が鈴のように散る
      thump(d, s * 0.7, 200, 60, 0.3);
      noise({ type: 'highpass', f0: 4000, f1: 2200, dur: 0.35, vol: 0.5 * s, dist: 4, dest: d });
      noise({ type: 'bandpass', f0: 2500, q: 5, dur: 0.12, vol: 0.4 * s, dest: d });
      for (let i = 0; i < 12; i++) tone({ f0: rnd(2500, 7000), f1: undefined, dur: rnd(0.3, 0.9), vol: 0.045, delay: 0.03 + Math.random() * 0.4, dest: d });
    },
    steam(s, d) { // ボフッと弾けて、シューッと噴き出す
      thump(d, s * 0.6, 100, 40, 0.4);
      noise({ type: 'highpass', f0: 3000, f1: 900, dur: 1.4, vol: 0.4 * s, attack: 0.02, hold: 0.2, dest: d });
      noise({ brown: true, type: 'lowpass', f0: 600, f1: 120, dur: 0.6, vol: 0.4 * s, dest: d });
    },
    lightning(s, d) { // バリバリッと裂けて、短くゴロッと鳴る
      noise({ type: 'highpass', f0: 1500, dur: 0.09, vol: 0.9 * s, dist: 12, dest: d });
      for (let i = 0; i < 6; i++) noise({ type: 'bandpass', f0: rnd(1500, 7000), q: 3, dur: 0.04, vol: 0.4 * s, delay: 0.03 + i * rnd(0.02, 0.05), dist: 8, dest: d });
      thump(d, s, 90, 30, 0.6);
      noise({ brown: true, type: 'lowpass', f0: 500, f1: 70, dur: 0.8, vol: 0.55 * s, delay: 0.06, attack: 0.08, am: { freq: 5, depth: 0.6, type: 'triangle' }, dest: d });
    },
    plasma(s, d) { // ビュワァンとゆがみ、低くうなる
      tone({ type: 'square', f0: 1500, f1: 60, glide: 0.35, dur: 0.5, vol: 0.14 * s, vib: 40, vibDepth: 150, lp: 2800, dist: 4, dest: d });
      thump(d, s, 100, 28, 0.7);
      noise({ type: 'bandpass', f0: 2500, f1: 600, q: 2, dur: 0.4, vol: 0.35 * s, dest: d });
    },
    light(s, d) { // パァンと光がはじけ、キラキラと響く
      noise({ type: 'highpass', f0: 2500, dur: 0.12, vol: 0.4 * s, dest: d });
      [1320, 1760, 2637, 3520, 5274].forEach((f, i) => tone({ f0: f, dur: 1.0, vol: 0.06 * s, delay: i * 0.025, dest: d }));
      tone({ f0: 220, f1: 110, dur: 0.4, vol: 0.25 * s, dest: d });
    },
    acid(s, d) { // ジュワァッと溶けて、ボコボコ泡立つ
      thump(d, s * 0.5, 120, 50, 0.3);
      noise({ type: 'bandpass', f0: 4200, q: 2.5, dur: 1.2, vol: 0.32 * s, attack: 0.02, am: { freq: 23, depth: 0.6 }, dest: d });
      for (let i = 0; i < 14; i++) tone({ f0: rnd(300, 1000), f1: rnd(120, 280), dur: 0.07, vol: 0.1 * s, delay: Math.random() * 1.1, dest: d });
    },
    metal(s, d) { // ガキィィンと金属が響き渡る
      thump(d, s, 150, 50, 0.4);
      noise({ type: 'highpass', f0: 3000, dur: 0.05, vol: 0.6 * s, dist: 6, dest: d });
      [610, 1523, 2389, 3717, 5123].forEach((f, i) => tone({ type: i % 2 ? 'sine' : 'triangle', f0: f, f1: f * 0.995, dur: 1.8 - i * 0.25, vol: 0.09 * s, dest: d }));
    },
    earth(s, d) { // ズドォンと地面が揺れ、ガラガラと岩が崩れる
      thump(d, s * 1.2, 90, 24, 1.0);
      noise({ brown: true, type: 'lowpass', f0: 900, f1: 120, dur: 1.4, vol: 0.9 * s, dist: 5, dest: d });
      debris(d, s, 22, 250, 1400, 1.4);
    },
    void(s, d) { // 空気が吸いこまれ、ズゥンと低くはじける
      noise({ brown: true, type: 'lowpass', f0: 120, f1: 2600, sweep: 0.35, dur: 0.38, vol: 0.45 * s, attack: 0.3, dest: d });
      tone({ f0: 55, f1: 20, delay: 0.32, dur: 1.4, vol: 0.85 * s, dist: 4, dest: d });
      tone({ type: 'sawtooth', f0: 70, f1: 35, delay: 0.32, dur: 1.0, vol: 0.18 * s, lp: 500, dist: 6, dest: d });
      noise({ brown: true, type: 'lowpass', f0: 1500, f1: 80, delay: 0.32, dur: 1.2, vol: 0.5 * s, dest: d });
    },
    ether(s, d) { // ふわっと霊がささやいて消える
      [520, 524, 780, 786, 1040].forEach((f) => tone({ f0: f, f1: f * 0.66, dur: 1.4, vol: 0.05 * s, attack: 0.06, vib: 6, vibDepth: 18, dest: d }));
      noise({ type: 'bandpass', f0: 1800, f1: 600, q: 1.2, dur: 1.2, vol: 0.15 * s, attack: 0.15, dest: d });
    },
    arcane(s, d) { // ボンと魔力がはじける
      thump(d, s, 160, 45, 0.5);
      tone({ f0: 700, f1: 1800, dur: 0.2, vol: 0.18 * s, dest: d });
      for (let i = 0; i < 6; i++) tone({ f0: rnd(2000, 4500), dur: 0.35, vol: 0.04, delay: 0.05 + i * 0.04, dest: d });
    },
    crystal(s, d) { // ガシャァンと結晶が砕け散る
      noise({ type: 'highpass', f0: 3500, f1: 2000, dur: 0.6, vol: 0.5 * s, dist: 3, dest: d });
      thump(d, s * 0.6, 220, 70, 0.3);
      for (let i = 0; i < 16; i++) tone({ f0: rnd(2000, 7500), dur: rnd(0.4, 1.2), vol: 0.04, delay: Math.random() * 0.45, dest: d });
    },
    wind(s, d) { // ゴウッと突風が吹き抜ける
      noise({ type: 'bandpass', f0: 1100, f1: 180, q: 1.2, dur: 1.0, vol: 0.6 * s, attack: 0.03, dest: d });
      noise({ type: 'bandpass', f0: 3000, f1: 700, q: 4, dur: 0.7, vol: 0.18 * s, delay: 0.05, dest: d });
      noise({ brown: true, type: 'lowpass', f0: 300, dur: 0.6, vol: 0.4 * s, dest: d });
    },
    prism(s, d) { // 七色の音階がこぼれ落ちる
      [1568, 1319, 1175, 988, 784, 659, 523].forEach((f, i) => tone({ f0: f * 2, dur: 0.5, vol: 0.06 * s, delay: i * 0.035, dest: d }));
      thump(d, s * 0.6, 140, 50, 0.4);
    },
    sound(s, d) { // ゴォォンと鐘のように長く響く
      [110, 220, 331, 440, 663, 1100].forEach((f, i) => tone({ f0: f, dur: 2.4 - i * 0.3, vol: (0.14 - i * 0.02) * s, dest: d }));
      tone({ type: 'square', f0: 330, dur: 0.5, vol: 0.04 * s, lp: 1500, dest: d }); tone({ type: 'square', f0: 337, dur: 0.5, vol: 0.04 * s, lp: 1500, dest: d });
      thump(d, s * 0.7, 90, 40, 0.5);
    },
    magnet(s, d) { // ブゥゥンと磁気がうなり、ガチンと引き合う
      tone({ type: 'sawtooth', f0: 110, dur: 0.6, vol: 0.15 * s, lp: 900, vib: 25, vibDepth: 10, dest: d });
      tone({ type: 'triangle', f0: 1500, f1: 1200, dur: 0.25, vol: 0.1 * s, dest: d });
      thump(d, s, 120, 40, 0.5);
    },
    force(s, d) { // ドゴォンと重い衝撃が走る
      thump(d, s * 1.3, 110, 26, 0.9);
      noise({ brown: true, type: 'lowpass', f0: 1600, f1: 120, dur: 0.9, vol: 0.8 * s, dist: 7, dest: d });
      [180, 270, 405].forEach((f) => tone({ type: 'triangle', f0: f, f1: f * 0.9, dur: 0.8, vol: 0.06 * s, dest: d }));
    },
    vacuum(s, d) { // 空気が一気に吸いこまれ、パンッと閉じる
      noise({ type: 'bandpass', f0: 300, f1: 4000, sweep: 0.3, q: 1.2, dur: 0.32, vol: 0.4 * s, attack: 0.25, dest: d });
      noise({ type: 'highpass', f0: 2500, dur: 0.05, vol: 0.6 * s, delay: 0.3, dest: d });
      tone({ f0: 70, f1: 30, delay: 0.3, dur: 0.6, vol: 0.6 * s, dest: d });
    },
    time(s, d) { // 時計の音が鳴り、和音が巻き戻るように響く
      for (let i = 0; i < 6; i++) tone({ type: 'square', f0: 2000 + i * 120, dur: 0.02, vol: 0.05, delay: i * 0.07, lp: 5000, dest: d });
      [392, 494, 587, 740].forEach((f, i) => tone({ f0: f * 2, f1: f, dur: 1.4, vol: 0.06 * s, delay: 0.05 + i * 0.05, dest: d }));
      thump(d, s * 0.6, 140, 50, 0.4);
    },
  };

  // ---- 属性ごとの命中音（小さな音） ----
  const HIT = {
    fire(d) { noise({ brown: true, type: 'bandpass', f0: 500, q: 0.8, dur: 0.22, vol: 0.4, am: { freq: 14, depth: 0.5 }, dest: d }); crackles(d, 0.6, 3, 0.2); },
    ice(d) { tone({ f0: rnd(2800, 4200), dur: 0.3, vol: 0.08, dest: d }); noise({ type: 'highpass', f0: 4000, dur: 0.05, vol: 0.2, dest: d }); },
    crystal(d) { tone({ f0: rnd(3000, 5000), dur: 0.3, vol: 0.08, dest: d }); },
    lightning(d) { noise({ type: 'bandpass', f0: rnd(2500, 5000), q: 4, dur: 0.06, vol: 0.35, dist: 8, dest: d }); },
    plasma(d) { tone({ type: 'square', f0: 900, f1: 300, dur: 0.1, vol: 0.07, lp: 2500, dest: d }); },
    metal(d) { tone({ type: 'triangle', f0: 1500, dur: 0.35, vol: 0.1, dest: d }); noise({ type: 'highpass', f0: 3500, dur: 0.03, vol: 0.25, dest: d }); },
    earth(d) { tone({ f0: 180, f1: 60, dur: 0.18, vol: 0.35, dest: d }); },
    acid(d) { noise({ type: 'bandpass', f0: 4000, q: 3, dur: 0.2, vol: 0.15, dest: d }); },
    sound(d) { tone({ f0: 660, dur: 0.4, vol: 0.09, dest: d }); },
  };

  // ---- 属性ごとの素材の音（第22版）。ない属性は、合成した音だけ ----
  // 発動（自分の手元）
  const SCAST = {
    fire() { sample('ignite', { vol: 0.75 }); sample('fire_wind', { offset: 0.75, dur: 1.2, vol: 0.55, rate: 1.1 }); },
    ice() { sample('ice', { offset: 0.45, dur: 1.4, vol: 0.7, rev: 0.25 }); },
    lightning() { sample('thunder', { offset: 0.08, dur: 0.5, vol: 0.7 }); },
    plasma() { sample('thunder', { offset: 0.08, dur: 0.4, vol: 0.6, rate: 0.75 }); },
    light() { sample('cast_holy', { offset: 0.25, dur: 1.5, vol: 0.6, rate: 1.1, rev: 0.3 }); },
    prism() { sample('cast_holy', { offset: 0.25, dur: 1.3, vol: 0.5, rate: 1.35, rev: 0.3 }); },
    arcane() { sample('chant_a', { offset: 0.2, dur: 1.2, vol: 0.55, rate: 1.15, rev: 0.3 }); },
    ether() { sample('chant_b', { offset: 0.1, dur: 1.5, vol: 0.55, rate: 0.9, rev: 0.4 }); },
    time() { sample('chant_b', { offset: 0.1, dur: 1.1, vol: 0.45, rate: 1.25, rev: 0.3 }); },
    crystal() { sample('ice', { offset: 0.45, dur: 1.1, vol: 0.6, rate: 1.35, rev: 0.3 }); },
    steam() { sample('fire_wind', { offset: 0.6, dur: 1.0, vol: 0.45, rate: 1.4 }); },
    wind() { sample('fire_wind', { offset: 0.5, dur: 1.0, vol: 0.4, rate: 1.6, lp: 5000 }); },
    void() { sample('converge', { dur: 1.2, vol: 0.5, rate: 0.7, rev: 0.3 }); },
    vacuum() { sample('converge', { dur: 0.9, vol: 0.45, rate: 1.2 }); },
  };
  // 着弾（s = 大きさ、d = 鳴った場所の出口）
  let fireAlt = 0;
  const SIMPACT = {
    fire(s, d) { sample((fireAlt++ % 2) ? 'fire_a' : 'fire_b', { vol: 0.85 * s, rate: 0.9 + Math.random() * 0.2, dest: d }); },
    ice(s, d) { sample('impact_frost', { offset: 1.15, dur: 2.4, vol: 0.8 * s, dest: d }); },
    crystal(s, d) { sample('impact_frost', { offset: 1.15, dur: 1.8, vol: 0.7 * s, rate: 1.35, dest: d }); },
    lightning(s, d) { sample('thunder', { offset: 0.1, dur: 0.7, vol: 0.8 * s, dest: d }); },
    plasma(s, d) { sample('thunder', { offset: 0.1, dur: 0.55, vol: 0.7 * s, rate: 0.7, dest: d }); },
    light(s, d) { sample('cast_holy', { offset: 0.35, dur: 1.2, vol: 0.55 * s, rate: 1.5, dest: d }); },
    earth(s, d) { sample('impact_epic', { dur: 1.6, vol: 0.6 * s, rate: 0.9, dest: d }); },
    metal(s, d) { sample('impact_epic', { dur: 1.4, vol: 0.5 * s, rate: 1.15, dest: d }); },
    force(s, d) { sample('impact_epic', { dur: 1.7, vol: 0.65 * s, rate: 0.8, dest: d }); },
    void(s, d) { sample('impact_epic', { dur: 2.0, vol: 0.6 * s, rate: 0.65, dest: d }); },
    arcane(s, d) { sample('impact_epic', { dur: 1.2, vol: 0.4 * s, rate: 1.25, dest: d }); },
  };

  const API = {
    unlock,
    get enabled() { return enabled; },
    get state() { return ctx ? ctx.state : 'none'; },
    elements: () => Object.keys(IMPACT),
    info: () => ({ reverb: !!revIn, brownNoise: !!brown, state: ctx ? ctx.state : 'none', samples: Object.keys(samples).length, sampleKeys: Object.keys(samples), voices: sampleVoices }),
    sampleCount: () => Object.keys(samples).length,
    sampleLen: (key) => (samples[key] ? Math.round(samples[key].duration * 100) / 100 : 0),
    playSample: (key, o) => (ready() ? sample(key, o) : false),
    setEnabled(v) {
      enabled = !!v;
      if (master) master.gain.setTargetAtTime(enabled ? 0.9 : 0, ctx.currentTime, 0.05);
    },
    // 素材の音がある属性は、素材を鳴らし、合成した音は小さくして重ねる（素材がまだ読めていなければ、合成した音だけ）
    cast(elem) {
      if (!ready() || !throttle('cast', 40)) return;
      const f = SCAST[elem], withS = !!f && Object.keys(samples).length > 0;
      if (withS) f();
      soft(withS ? 0.45 : 1, () => (CAST[elem] || CAST.arcane)());
    },
    impact(elem, big, ap) {
      if (!ready() || !throttle('impact', 45)) return;
      const s = Math.min(1.6, 0.45 + (big || 1) * 0.15);
      const d = bus(ap, 0.3 + s * 0.15), f = SIMPACT[elem], withS = !!f && Object.keys(samples).length > 0;
      if (withS) f(s, d);
      soft(withS ? 0.5 : 1, () => (IMPACT[elem] || IMPACT.arcane)(s, d));
    },
    // 召喚: 詠唱の声と、召喚獣ごとの音（ゴーレムは着地のドスン、精霊は光、獣はうなり声、使い魔は鈴）
    summon(type, elem, ap) {
      if (!ready()) return;
      const d = bus(ap, 0.5);
      sample('chant_b', { vol: 0.6, rate: type === 'wisp' ? 1.5 : 0.95, dur: type === 'wisp' ? 1.0 : 2.2, dest: d });
      if (type === 'golem') {
        sample('impact_epic', { delay: 0.35, vol: 0.7, rate: 0.7, dur: 2.0, dest: d });
        soft(1, () => { thump(d, 1.2, 80, 22, 1.2); debris(d, 0.8, 14, 200, 1200, 0.9); });
      } else if (type === 'spirit') {
        sample('cast_holy', { offset: 0.2, delay: 0.2, vol: 0.5, rate: 1.2, dur: 1.8, dest: d });
        [988, 1319, 1760].forEach((f, i) => tone({ f0: f, dur: 0.9, vol: 0.05, delay: 0.3 + i * 0.07, dest: d }));
      } else if (type === 'beast') {
        sample('fire_wind', { offset: 0.6, delay: 0.25, vol: 0.4, rate: 1.5, dur: 1.0, dest: d });
        tone({ type: 'sawtooth', f0: 95, f1: 70, delay: 0.35, dur: 0.9, vol: 0.18, vib: 28, vibDepth: 14, lp: 700, dist: 4, dest: d });
        noise({ brown: true, type: 'bandpass', f0: 350, q: 1.5, delay: 0.35, dur: 0.8, vol: 0.35, am: { freq: 30, depth: 0.6 }, dest: d });
      } else {
        [1568, 2093, 2637].forEach((f, i) => tone({ f0: f, dur: 0.6, vol: 0.04, delay: 0.1 + i * 0.05, dest: d }));
      }
    },
    // 障壁: 物の壁は地面からせり上がる音、光の壁・ドーム・大盾は光の音
    barrier(elem, shape, ap) {
      if (!ready() || !throttle('barrier', 60)) return;
      const d = bus(ap, 0.4);
      const solid = shape === 'wall' && (elem === 'earth' || elem === 'metal' || elem === 'ice' || elem === 'crystal');
      if (solid) {
        if (elem === 'ice' || elem === 'crystal') sample('ice', { offset: 0.5, dur: 1.2, vol: 0.6, rate: elem === 'crystal' ? 1.3 : 1, dest: d });
        else sample('impact_epic', { vol: 0.45, rate: elem === 'metal' ? 1.3 : 1.1, dur: 1.3, dest: d });
        noise({ brown: true, type: 'lowpass', f0: 500, f1: 120, dur: 0.6, vol: 0.5, attack: 0.08, dest: d });
      } else {
        sample('cast_holy', { offset: 0.2, dur: shape === 'dome' ? 2.2 : 1.0, vol: 0.5, rate: shape === 'dome' ? 0.9 : 1.5, dest: d });
        tone({ type: 'triangle', f0: 220, f1: 330, dur: 0.6, vol: 0.06, attack: 0.1, dest: d });
      }
    },
    hit(elem, ap) {
      if (!ready() || !throttle('hit', 30)) return;
      const d = bus(ap, 0.2);
      if (HIT[elem]) HIT[elem](d);
      else tone({ type: 'triangle', f0: rnd(600, 750), f1: 300, dur: 0.1, vol: 0.14, dest: d });
    },
    crackle(ap) { if (!ready() || !throttle('crackle', 90)) return; crackles(bus(ap, 0.15), 0.6, 4, 0.2); },
    // 壁をつらぬいたとき（ズドッ）
    pierce(elem, ap) {
      if (!ready() || !throttle('pierce', 40)) return;
      const d = bus(ap, 0.35);
      thump(d, 0.8, 170, 50, 0.3);
      noise({ brown: true, type: 'lowpass', f0: 2500, f1: 300, dur: 0.3, vol: 0.5, dist: 4, dest: d });
      debris(d, 0.6, 5, 400, 2000, 0.25);
    },
    blocked(ap) { if (!ready() || !throttle('blocked', 40)) return; const d = bus(ap, 0.3); tone({ type: 'triangle', f0: 420, f1: 260, dur: 0.15, vol: 0.14, dest: d }); noise({ brown: true, type: 'lowpass', f0: 1500, f1: 200, dur: 0.2, vol: 0.35, dest: d }); },
    crumble(ap) { if (!ready() || !throttle('crumble', 80)) return; IMPACT.earth(1.0, bus(ap, 0.4)); },
    crit() { if (!ready()) return; tone({ f0: 1800, f1: 2600, dur: 0.18, vol: 0.12, rev: 0.4 }); tone({ f0: 2700, dur: 0.25, vol: 0.06, delay: 0.05, rev: 0.4 }); },
    destroy(ap) {
      if (!ready() || !throttle('destroy', 60)) return;
      const d = bus(ap, 0.3);
      noise({ type: 'highpass', f0: 1200, dur: 0.3, vol: 0.35, dest: d });
      debris(d, 0.8, 8, 500, 3000, 0.4);
      [1047, 1319, 1568].forEach((f, i) => tone({ f0: f, dur: 0.35, vol: 0.08, delay: 0.05 + i * 0.06, rev: 0.4 }));
    },
    zap(ap) { if (!ready() || !throttle('zap', 50)) return; noise({ type: 'bandpass', f0: rnd(2000, 5000), q: 4, dur: 0.08, vol: 0.35, dist: 8, dest: bus(ap, 0.25) }); },
    thunder(ap) { if (!ready() || !throttle('thunder', 120)) return; const d = bus(ap, 0.6); sample('thunder', { offset: 0.1, dur: 0.8, vol: 0.8, rate: 0.85 + Math.random() * 0.2, dest: d }); soft(has('thunder') ? 0.6 : 1, () => IMPACT.lightning(1.3, d)); },
    whoosh() { if (!ready() || !throttle('whoosh', 60)) return; noise({ type: 'bandpass', f0: 500, f1: 2200, q: 1.2, dur: 0.3, vol: 0.22, attack: 0.05 }); },
    rumble(dd) { if (!ready()) return; noise({ brown: true, type: 'lowpass', f0: 300, f1: 60, dur: dd || 1.5, vol: 0.6, attack: 0.3, am: { freq: 4, depth: 0.4 } }); tone({ f0: 45, f1: 30, dur: dd || 1.5, vol: 0.4, attack: 0.3 }); },
    charge(dd) { if (!ready()) return; sample('converge', { vol: 0.5, rate: Math.max(0.6, Math.min(1.4, 2.3 / ((dd || 1) * 1.6))), rev: 0.5 }); tone({ type: 'sawtooth', f0: 70, f1: 900, dur: dd || 1, vol: 0.12, lp: 2500, attack: 0.25, rev: 0.5 }); noise({ type: 'bandpass', f0: 200, f1: 5000, q: 2, dur: dd || 1, vol: 0.18, attack: 0.4, rev: 0.5 }); },
    // 隠し魔法の大爆発（映画のような重ね方）
    bigBoom() {
      if (!ready()) return;
      const d = bus(null, 0.7);
      sample('impact_epic', { vol: 1.0, rate: 0.72, dest: d });
      sample('impact_epic', { vol: 0.5, rate: 1.0, delay: 0.04, dest: d });
      thump(d, 1.6, 110, 18, 2.0);
      noise({ brown: true, type: 'lowpass', f0: 3200, f1: 45, sweep: 2.2, dur: 3.2, vol: 1.0, dist: 8, dest: d });
      noise({ type: 'bandpass', f0: 1200, f1: 200, q: 0.5, dur: 1.2, vol: 0.5, dest: d });
      noise({ brown: true, type: 'lowpass', f0: 400, f1: 60, delay: 0.4, dur: 3.0, vol: 0.6, attack: 0.3, am: { freq: 3, depth: 0.5, type: 'triangle' }, dest: d });
      debris(d, 1.2, 30, 300, 2500, 2.5);
      crackles(d, 1, 25, 3);
    },
    // 消滅領域（第22版で壮大に）: 球が生まれると、空間が吸いこまれ（収束）、低い合唱と和音が少しずつ高まって、球が閉じる瞬間に向かう
    eraseStart() {
      if (!ready()) return;
      const d = bus(null, 1.0);
      API.duck(3.6);
      // 素材: 収束（少し低く）と、深く落とした詠唱の声を2つ重ねる
      sample('converge', { vol: 0.95, rate: 0.82, dest: d, rev: 0.6 });
      sample('chant_a', { vol: 0.75, rate: 0.6, fadeIn: 0.35, dest: d, rev: 0.8 });
      sample('chant_b', { vol: 0.5, rate: 0.5, delay: 0.35, fadeIn: 0.5, dest: d, rev: 0.8 });
      // 空気が一気に吸いこまれる
      noise({ brown: true, type: 'lowpass', f0: 100, f1: 3000, sweep: 0.6, dur: 0.8, vol: 0.6, attack: 0.5, dest: d });
      noise({ type: 'bandpass', f0: 6000, f1: 400, sweep: 0.9, q: 1.2, dur: 0.9, vol: 0.3, attack: 0.05, dest: d });
      // 地の底からせり上がる低音（球が閉じる 1.9 秒後に向かって大きくなる）
      tone({ f0: 28, f1: 58, glide: 1.9, dur: 2.0, vol: 0.6, attack: 1.2, dest: d });
      tone({ type: 'sawtooth', f0: 41, f1: 82, glide: 1.9, dur: 2.0, vol: 0.12, attack: 1.4, lp: 300, dest: d });
      // 遠くの合唱のような和音（D・A・D・F・A・E）が、ゆっくり満ちていく
      [146.8, 220, 293.7, 349.2, 440, 659.3].forEach((f, i) => {
        tone({ type: 'sawtooth', f0: f, dur: 2.1, vol: 0.035, attack: 1.1 + i * 0.05, lp: 1400, vib: 5 + i * 0.3, vibDepth: 4, dest: d });
        tone({ type: 'sawtooth', f0: f * 1.004, dur: 2.1, vol: 0.03, attack: 1.2 + i * 0.05, lp: 1100, dest: d });
      });
      // 逆回しのシンバルのような、高まっていくシャーという音
      noise({ type: 'highpass', f0: 2500, f1: 7000, sweep: 1.9, dur: 1.95, vol: 0.32, attack: 1.8, dest: d });
      // 耳鳴りのような高い音
      tone({ f0: 2637, f1: 2793, dur: 1.9, vol: 0.03, attack: 0.5, vib: 5, vibDepth: 12, dest: d });
      tone({ f0: 3951, dur: 1.7, vol: 0.018, attack: 0.6, dest: d });
    },
    // 消滅領域: 球が閉じて、すべてが消える（重い衝撃を2つの高さで重ね、地鳴りと、澄んだ鐘の余韻が長く残る）
    eraseEnd() {
      if (!ready()) return;
      const d = bus(null, 1.0);
      API.duck(4.5);
      sample('impact_epic', { vol: 1.0, rate: 0.62, dest: d, rev: 0.9 });
      sample('impact_epic', { vol: 0.65, rate: 0.95, delay: 0.02, dest: d });
      sample('cast_holy', { offset: 0.3, vol: 0.4, rate: 0.75, delay: 0.5, fadeIn: 0.6, dest: d, rev: 1 });
      noise({ type: 'highpass', f0: 3000, dur: 0.1, vol: 0.6, dest: d });
      thump(d, 1.6, 70, 16, 2.4);
      noise({ brown: true, type: 'lowpass', f0: 2400, f1: 40, sweep: 2.4, dur: 3.2, vol: 0.85, dist: 6, dest: d });
      noise({ brown: true, type: 'lowpass', f0: 300, f1: 50, delay: 0.3, dur: 3.4, vol: 0.5, attack: 0.4, am: { freq: 2.5, depth: 0.5, type: 'triangle' }, dest: d });
      [1568, 2349, 3136, 4699, 6272].forEach((f, i) => tone({ f0: f, dur: 3.6 - i * 0.4, vol: 0.055, delay: 0.05 + i * 0.03, dest: d }));
      [196, 293.7, 392].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: 3.2, vol: 0.05, attack: 0.3, delay: 0.25 + i * 0.08, dest: d }));
    },
    // まわりの音（BGM）を一時的に遠のかせる
    duck(sec) {
      if (!ctx || !bgm.bus) return;
      const t = ctx.currentTime, v = bgm.on && bgm.enabled ? bgm.vol * 0.9 : 0;
      bgm.bus.gain.cancelScheduledValues(t);
      bgm.bus.gain.setTargetAtTime(v * 0.12, t, 0.15);
      bgm.bus.gain.setTargetAtTime(v, t + (sec || 1.5), 0.8);
      bgm.ducked = t + (sec || 1.5);
    },
    // ---- 画面操作の音 ----
    click() { if (!ready()) return; tone({ type: 'triangle', f0: 900, f1: 700, dur: 0.06, vol: 0.08 }); },
    addWord(i) { if (!ready()) return; const notes = [523, 659, 784, 1047]; tone({ f0: notes[i % 4], dur: 0.3, vol: 0.12, rev: 0.3 }); tone({ f0: notes[i % 4] * 2, dur: 0.25, vol: 0.04, delay: 0.02 }); },
    removeWord() { if (!ready()) return; tone({ f0: 500, f1: 250, dur: 0.12, vol: 0.1 }); },
    reveal(len) {
      if (!ready() || !throttle('reveal', 120)) return;
      const n = Math.min(10, 4 + (len || 3));
      for (let i = 0; i < n; i++) tone({ f0: rnd(1400, 3600), dur: 0.5, vol: 0.04, delay: i * 0.045, rev: 0.6 });
      tone({ f0: 262, dur: 1.2, vol: 0.08, attack: 0.05, rev: 0.6 }); tone({ f0: 392, dur: 1.2, vol: 0.06, attack: 0.05, rev: 0.6 });
    },
    register() { if (!ready()) return; [523, 659, 784, 1047].forEach((f, i) => tone({ f0: f, dur: 0.7, vol: 0.08, delay: i * 0.05, rev: 0.4 })); },
    secret() {
      if (!ready()) return;
      [392, 523, 659, 784, 1047, 1319].forEach((f, i) => { tone({ f0: f, dur: 1.2, vol: 0.09, delay: i * 0.09, rev: 0.6 }); tone({ type: 'triangle', f0: f / 2, dur: 1.2, vol: 0.05, delay: i * 0.09 }); });
      noise({ type: 'highpass', f0: 6000, dur: 1.4, vol: 0.08, attack: 0.3, rev: 0.6 });
    },
    error() { if (!ready() || !throttle('error', 200)) return; tone({ type: 'square', f0: 140, dur: 0.15, vol: 0.06, lp: 800 }); tone({ type: 'square', f0: 120, dur: 0.15, vol: 0.06, lp: 800, delay: 0.12 }); },
    slot() { if (!ready()) return; tone({ f0: 1200, dur: 0.08, vol: 0.06 }); },
    tick() { if (!ready()) return; tone({ type: 'square', f0: 1000, dur: 0.05, vol: 0.05, lp: 3000 }); },
    // 対戦: 自分が魔法を受けた
    hurt(big) {
      if (!ready() || !throttle('hurt', 90)) return;
      tone({ type: 'sawtooth', f0: big ? 220 : 300, f1: 70, dur: 0.22, vol: big ? 0.14 : 0.09, lp: 1400 });
      noise({ brown: true, type: 'lowpass', f0: 500, dur: 0.18, vol: big ? 0.25 : 0.15 });
    },
    // 対戦: 自分が倒れた
    down() {
      if (!ready()) return;
      [392, 330, 262, 196].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: 0.5, vol: 0.09, delay: i * 0.14, rev: 0.5 }));
      noise({ brown: true, type: 'lowpass', f0: 300, dur: 1.2, vol: 0.2, attack: 0.05 });
    },
    // 対戦: 復活した
    respawn() { if (!ready()) return; [523, 659, 784].forEach((f, i) => tone({ f0: f, dur: 0.5, vol: 0.07, delay: i * 0.07, rev: 0.5 })); },
    // 対戦: 相手を倒した
    killed() { if (!ready()) return; [784, 988, 1319].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: 0.35, vol: 0.1, delay: i * 0.06, rev: 0.3 })); },
    // 対戦: だれかが部屋に入った・出た
    join() { if (!ready()) return; tone({ f0: 660, dur: 0.15, vol: 0.06 }); tone({ f0: 990, dur: 0.2, vol: 0.06, delay: 0.1 }); },
    start() { if (!ready()) return; [523, 784, 1047].forEach((f, i) => tone({ f0: f, dur: 0.4, vol: 0.1, delay: i * 0.12, rev: 0.4 })); },
    finish() { if (!ready()) return; [1047, 784, 659, 1047, 1319].forEach((f, i) => tone({ f0: f, dur: 0.5, vol: 0.1, delay: i * 0.1, rev: 0.4 })); },
    micOn() { if (!ready()) return; tone({ f0: 660, dur: 0.12, vol: 0.08 }); tone({ f0: 990, dur: 0.15, vol: 0.08, delay: 0.08 }); },
    micOff() { if (!ready()) return; tone({ f0: 990, dur: 0.12, vol: 0.08 }); tone({ f0: 660, dur: 0.15, vol: 0.08, delay: 0.08 }); },
    heard() { if (!ready()) return; tone({ f0: 1400, dur: 0.08, vol: 0.05 }); },
  };

  // ---- BGM: 神秘的な曲をその場で自動演奏する ----
  // Dマイナーの4つの和音（Dm9 → B♭maj7 → Fmaj7 → C6/9）を8秒ずつ、ゆっくり移り変わる。
  // 重ねる音: やわらかな和音（パッド）・低い持続音・ときどき鳴る鈴（こだま付き）・きらめき・遠くの合唱のような声
  const BAR = 8;
  const CHORDS = [
    { bass: 38, pad: [50, 53, 57, 64], bell: [62, 64, 65, 69, 72, 74, 76] },
    { bass: 34, pad: [46, 50, 53, 57], bell: [62, 65, 69, 70, 72, 74, 77] },
    { bass: 41, pad: [53, 57, 60, 64], bell: [60, 64, 65, 67, 69, 72, 76] },
    { bass: 36, pad: [48, 55, 62, 64], bell: [60, 62, 64, 67, 69, 72, 74] },
  ];
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const bgm = { on: false, enabled: true, vol: 0.6, mood: 1, bus: null, echo: null, timer: 0, next: 0, bar: 0, notes: 0 };

  function bgmNodes() {
    if (bgm.bus) return;
    bgm.bus = ctx.createGain(); bgm.bus.gain.value = 0;
    bgm.bus.connect(ambBus);
    // 鈴のこだま
    const d = ctx.createDelay(2); d.delayTime.value = 0.42;
    const fb = ctx.createGain(); fb.gain.value = 0.38;
    const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 3500;
    d.connect(tone); tone.connect(fb); fb.connect(d);
    const wet = ctx.createGain(); wet.gain.value = 0.55;
    tone.connect(wet); wet.connect(bgm.bus);
    bgm.echo = d;
    // 曲全体を残響にも送る
    const rs = ctx.createGain(); rs.gain.value = 0.9;
    bgm.bus.connect(rs); rs.connect(revIn);
  }
  function bgmVoice(o) { // 1つの音（オシレーター → フィルター → 音量の形 → BGM の出口）
    const osc = ctx.createOscillator(); osc.type = o.type || 'sine';
    osc.frequency.value = o.f; if (o.detune) osc.detune.value = o.detune;
    const g = ctx.createGain();
    const t0 = o.t, att = o.attack || 0.01, end = o.t + o.len;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(o.vol, t0 + att);
    if (o.sustain) g.gain.setValueAtTime(o.vol, Math.max(t0 + att, end - o.release));
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    let node = osc;
    if (o.lp) {
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = o.q || 0.6;
      f.frequency.setValueAtTime(o.lp, t0);
      if (o.lp2) { f.frequency.linearRampToValueAtTime(o.lp2, t0 + o.len * 0.5); f.frequency.linearRampToValueAtTime(o.lp, end); }
      node.connect(f); node = f;
    }
    if (o.formants) { // 「アー」という声のような響き
      const sum = ctx.createGain(); sum.gain.value = 1;
      o.formants.forEach(([fq, q, gn]) => { const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = fq; bp.Q.value = q; const gg = ctx.createGain(); gg.gain.value = gn; node.connect(bp); bp.connect(gg); gg.connect(sum); });
      node = sum;
    }
    node.connect(g); g.connect(bgm.bus);
    if (o.echo) { const e = ctx.createGain(); e.gain.value = o.echo; g.connect(e); e.connect(bgm.echo); }
    osc.start(t0); osc.stop(end + 0.1);
    bgm.notes++;
  }
  function scheduleBar(t, ch, n) {
    const bright = 1 - bgm.mood; // 昼は明るく
    const cut = 520 + bright * 600, cut2 = 1100 + bright * 1300;
    // やわらかな和音（少しずつずらした2つの音で厚みを出す）
    ch.pad.forEach((m, i) => {
      const f = mtof(m);
      bgmVoice({ t: t + i * 0.12, len: BAR + 2.5, f, type: 'sawtooth', detune: -6, vol: 0.018, attack: 2.6, sustain: true, release: 3, lp: cut, lp2: cut2 });
      bgmVoice({ t: t + i * 0.12, len: BAR + 2.5, f, type: 'sawtooth', detune: 7, vol: 0.018, attack: 2.6, sustain: true, release: 3, lp: cut, lp2: cut2 });
      bgmVoice({ t: t + i * 0.12, len: BAR + 2.5, f: f * 2, type: 'triangle', vol: 0.008, attack: 3, sustain: true, release: 3 });
    });
    // 低い持続音
    bgmVoice({ t, len: BAR + 2, f: mtof(ch.bass), type: 'sine', vol: 0.05, attack: 2, sustain: true, release: 2.5 });
    bgmVoice({ t, len: BAR + 2, f: mtof(ch.bass + 12), type: 'triangle', vol: 0.015, attack: 2.5, sustain: true, release: 2.5, lp: 400 });
    // 鈴（ときどき、和音の音から選んで鳴る。こだまが残る）
    const count = 3 + Math.floor(Math.random() * 4);
    for (let k = 0; k < count; k++) {
      const at = t + 0.5 + Math.round(Math.random() * 14) * 0.5;
      const m = ch.bell[Math.floor(Math.random() * ch.bell.length)] + (Math.random() < 0.25 + bright * 0.3 ? 12 : 0);
      const f = mtof(m);
      bgmVoice({ t: at, len: 3.2, f, type: 'sine', vol: 0.03, attack: 0.008, echo: 0.6 });
      bgmVoice({ t: at, len: 1.6, f: f * 2.756, type: 'sine', vol: 0.008, attack: 0.005, echo: 0.4 }); // 鈴らしい倍音
      bgmVoice({ t: at, len: 0.9, f: f * 5.404, type: 'sine', vol: 0.003, attack: 0.003 });
    }
    // きらめき（2小節に1回）
    if (n % 2 === 1) {
      const src = ctx.createBufferSource(); src.buffer = white; src.loop = true;
      const hp = ctx.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.setValueAtTime(5000, t); hp.frequency.linearRampToValueAtTime(9000, t + 5); hp.Q.value = 3;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t + 1); g.gain.exponentialRampToValueAtTime(0.012, t + 3.5); g.gain.exponentialRampToValueAtTime(0.0001, t + 6.5);
      src.connect(hp); hp.connect(g); g.connect(bgm.bus);
      src.start(t + 1, Math.random() * 2); src.stop(t + 6.6);
    }
    // 遠くの合唱のような声（4小節に1回）
    if (n % 4 === 2) {
      [ch.pad[1], ch.pad[3]].forEach((m) => bgmVoice({ t: t + 1, len: BAR, f: mtof(m), type: 'sawtooth', vol: 0.035, attack: 3, sustain: true, release: 3, formants: [[700, 6, 1], [1150, 8, 0.6], [2600, 10, 0.25]] }));
    }
  }
  function bgmTick() {
    if (!bgm.on || !ctx) return;
    while (bgm.next < ctx.currentTime + 1.2) {
      scheduleBar(bgm.next, CHORDS[bgm.bar % CHORDS.length], bgm.bar);
      bgm.next += BAR; bgm.bar++;
    }
  }
  function bgmApplyVolume(fade) {
    if (!bgm.bus) return;
    const v = bgm.on && bgm.enabled ? bgm.vol * 0.9 : 0;
    bgm.bus.gain.cancelScheduledValues(ctx.currentTime);
    bgm.bus.gain.setTargetAtTime(v, ctx.currentTime, fade || 0.6);
  }
  API.bgmStart = function () {
    if (!ctx) return false;
    bgmNodes();
    if (!bgm.on) { bgm.on = true; bgm.next = ctx.currentTime + 0.2; bgmTick(); clearInterval(bgm.timer); bgm.timer = setInterval(bgmTick, 300); }
    bgmApplyVolume(1.5);
    return true;
  };
  API.bgmStop = function () { bgm.on = false; clearInterval(bgm.timer); bgmApplyVolume(0.4); };
  API.setBgmVolume = function (v) { bgm.vol = Math.max(0, Math.min(1, +v || 0)); bgmApplyVolume(0.2); };
  API.setBgmEnabled = function (v) { bgm.enabled = !!v; bgmApplyVolume(0.4); };
  API.setMood = function (k) { bgm.mood = Math.max(0, Math.min(1, k)); };
  API.bgmInfo = () => ({ playing: bgm.on && bgm.enabled, scheduledBars: bgm.bar, notes: bgm.notes, volume: bgm.vol, ambientNoise: false, ducking: !!(ctx && bgm.ducked && ctx.currentTime < bgm.ducked) });

  MG.Audio = API;
})();
