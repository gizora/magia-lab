// 紋章を描いて放つ: 右クリックを押しながら単語ごとの「紋章」を描き、魔法陣に重ねていく。2つ以上重ねて左クリックで発動する
// 紋章の見分け方: 描いた線を同じ数の点に打ち直し、大きさと位置をそろえて、33 個の手本とのずれ（点ごとの距離の平均）を比べる（$1 認識器と同じ考え方）。
// 円・三角などの閉じた形は、描き始めの位置と回る向きを問わない。少しの傾き（±14°）も許す。
(function () {
  'use strict';
  const MG = (window.MG = window.MG || {});
  const D = (MG.Draw = {});
  const N = 48;               // 線を打ち直す点の数
  const THRESHOLD = 0.18;     // これよりずれが大きいと「読めない」
  const ASPECT_FLAT = 0.35;   // 縦と横の短いほうが長いほうのこの割合より小さければ「細長い形」
  const CORNER_W = 0.045;     // 角の数が1つちがうごとに足すずれ
  const MAX_GLYPHS = 4;
  const IDLE_SEC = 15;        // 描き終えてから、この秒数たっても放たなければ消える

  // ---- 紋章の手本（0〜1 の四角の中、y は下向き。一筆書き） ----
  const ell = (cx, cy, rx, ry, t0, t1, n) => { const a = []; for (let i = 0; i <= n; i++) { const t = t0 + ((t1 - t0) * i) / n; a.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]); } return a; };
  const PI = Math.PI;
  const star = () => [-90, 54, 198, 342, 126, -90].map((d) => [0.5 + 0.5 * Math.cos((d * PI) / 180), 0.52 + 0.5 * Math.sin((d * PI) / 180)]);
  const lemni = () => { const a = []; for (let i = 0; i <= 64; i++) { const t = (i / 64) * PI * 2; const s = Math.sin(t), c = Math.cos(t), k = 1 + s * s; a.push([0.5 + (0.5 * c) / k, 0.5 + (0.9 * s * c) / k]); } return a; };
  // ハート（下の先から描き始める）
  const heart = () => { const a = []; for (let i = 0; i <= 64; i++) { const t = PI + (i / 64) * PI * 2; const x = 16 * Math.pow(Math.sin(t), 3), y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t); a.push([0.5 + x / 34, 0.45 - y / 34]); } return a; };
  const spiral = () => { const a = []; for (let i = 0; i <= 80; i++) { const f = i / 80, t = f * PI * 3, r = 0.08 + 0.42 * f; a.push([0.5 + r * Math.cos(t), 0.5 + r * Math.sin(t)]); } return a; };
  const GLYPHS = {
    combustion:      { name: '三角', closed: true, pts: [[0, 1], [0.5, 0], [1, 1], [0, 1]] },
    oxidation:       { name: '左向きの山', pts: [[1, 0], [0, 0.5], [1, 1]] },
    reduction:       { name: 'U', pts: [[0, 0], [0, 0.5]].concat(ell(0.5, 0.5, 0.5, 0.5, PI, 0, 16), [[1, 0]]) },
    bonding:         { name: '無限（∞）', closed: true, pts: lemni() },
    decomposition:   { name: 'W', pts: [[0, 0], [0.25, 1], [0.5, 0.35], [0.75, 1], [1, 0]] },
    solidification:  { name: '四角', closed: true, pts: [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]] },
    evaporation:     { name: 'S', pts: ell(0.5, 0.27, 0.4, 0.25, -PI / 6, -1.5 * PI, 16).concat(ell(0.5, 0.75, 0.4, 0.25, -PI / 2, (5 * PI) / 6, 16)) },
    sublimation:     { name: '上へ一直線', pts: [[0.5, 1], [0.5, 0]] },
    ionization:      { name: 'N', pts: [[0, 1], [0, 0], [1, 1], [1, 0]] },
    catalyst:        { name: 'チェック（✓）', pts: [[0, 0.6], [0.28, 1], [1, 0]] },
    crystallization: { name: 'ひし形', closed: true, pts: [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5], [0.5, 0]] },
    reinforcement:   { name: 'M', pts: [[0, 1], [0.2, 0], [0.5, 0.65], [0.8, 0], [1, 1]] },
    luminescence:    { name: '星', closed: true, pts: star() },
    acceleration:    { name: '右向きの山', pts: [[0, 0], [1, 0.5], [0, 1]] },
    gravity:         { name: '下へ一直線', pts: [[0.5, 0], [0.5, 1]] },
    refraction:      { name: 'Z', pts: [[0, 0], [1, 0], [0, 1], [1, 1]] },
    reflection:      { name: 'V', pts: [[0, 0], [0.5, 1], [1, 0]] },
    resonance:       { name: '3', pts: ell(0.5, 0.25, 0.45, 0.25, (-5 * PI) / 6, PI / 2, 16).concat(ell(0.5, 0.75, 0.45, 0.25, -PI / 2, (5 * PI) / 6, 16)) },
    diffusion:       { name: 'うずまき（中心から外へ）', pts: spiral() },
    vibration:       { name: 'ギザギザ', pts: [[0, 0.5], [0.12, 0.15], [0.26, 0.85], [0.42, 0.15], [0.58, 0.85], [0.74, 0.15], [0.88, 0.85], [1, 0.5]] },
    inertia:         { name: '右へ一直線', pts: [[0, 0.5], [1, 0.5]] },
    magnetism:       { name: '∩（アーチ）', pts: [[0, 1], [0, 0.5]].concat(ell(0.5, 0.5, 0.5, 0.5, PI, 2 * PI, 16), [[1, 1]]) },
    discharge:       { name: '稲妻', pts: [[0.75, 0], [0.2, 0.55], [0.8, 0.45], [0.25, 1]] },
    compression:     { name: '砂時計', closed: true, pts: [[0, 0], [1, 0], [0, 1], [1, 1], [0, 0]] },
    expansion:       { name: '円', closed: true, pts: ell(0.5, 0.5, 0.5, 0.5, -PI / 2, 1.5 * PI, 40) },
    vacuum:          { name: 'L', pts: [[0, 0], [0, 1], [1, 1]] },
    regression:      { name: 'J', pts: [[0.75, 0], [0.75, 0.65]].concat(ell(0.45, 0.65, 0.3, 0.3, 0, PI, 12)) },
    shielding:       { name: '門（Π）', pts: [[0, 1], [0, 0], [1, 0], [1, 1]] },
    regeneration:    { name: 'e', pts: [[0.05, 0.5], [0.95, 0.5]].concat(ell(0.5, 0.5, 0.45, 0.45, 0, -1.75 * PI, 24)) },
    transition:      { name: 'C（右が開いた円）', pts: ell(0.5, 0.5, 0.5, 0.5, -PI / 4, (-7 * PI) / 4, 24) },
    lift:            { name: 'ω（つばさ）', pts: ell(0.25, 0.5, 0.25, 0.5, PI, 0, 12).concat(ell(0.75, 0.5, 0.25, 0.5, PI, 0, 12)) },
    collision:       { name: '右下への矢（↘）', pts: [[0, 0], [1, 1], [1, 0.45], [1, 1], [0.45, 1]] },
    electrification: { name: 'α（くるりと回して右下へ）', pts: ell(0.4, 0.5, 0.38, 0.4, -PI / 6, 2 * PI - PI / 6 - 0.3, 24).concat([[1, 1]]) },
  };
  D.GLYPHS = GLYPHS;

  // ---- 線をそろえる ----
  function pathLen(p) { let d = 0; for (let i = 1; i < p.length; i++) d += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); return d; }
  function resample(pts, n) {
    const p = pts.map((q) => q.slice());
    const I = pathLen(p) / (n - 1);
    if (!(I > 0)) return new Array(n).fill(0).map(() => p[0].slice());
    const out = [p[0].slice()];
    let D2 = 0;
    for (let i = 1; i < p.length; i++) {
      const d = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
      if (D2 + d >= I && d > 0) {
        const t = (I - D2) / d;
        const q = [p[i - 1][0] + t * (p[i][0] - p[i - 1][0]), p[i - 1][1] + t * (p[i][1] - p[i - 1][1])];
        out.push(q); p.splice(i, 0, q); D2 = 0;
      } else D2 += d;
    }
    while (out.length < n) out.push(p[p.length - 1].slice());
    return out.slice(0, n);
  }
  // 大きさと位置（重心を 0）をそろえる
  function normalize(pts) {
    const p = resample(pts, N);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    p.forEach(([x, y]) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); });
    const w = maxX - minX, h = maxY - minY, s = Math.max(w, h) || 1;
    // 細長い（線のような）形は縦横の比を保つ。それ以外は縦と横を別々に 1 にそろえ、少しつぶれた四角や円も同じ形として比べる
    const flat = Math.min(w, h) / s < ASPECT_FLAT;
    const kx = flat ? s : w || 1, ky = flat ? s : h || 1;
    let cx = 0, cy = 0;
    p.forEach(([x, y]) => { cx += x; cy += y; });
    cx /= N; cy /= N;
    return p.map(([x, y]) => [(x - cx) / kx, (y - cy) / ky]);
  }
  function rotate(p, a) { const c = Math.cos(a), s = Math.sin(a); return p.map(([x, y]) => [x * c - y * s, x * s + y * c]); }
  function dist(a, b, shift) { const n = a.length; let d = 0; for (let i = 0; i < n; i++) { const q = b[(i + shift) % n]; d += Math.hypot(a[i][0] - q[0], a[i][1] - q[1]); } return d / n; }
  // 閉じた形として打ち直す: 始まりの点で輪を閉じてから N 点に打ち直し、重なる最後の点を除く（N-1 点の輪）
  function closeLoop(pts) { const a = pts[0], b = pts[pts.length - 1]; return Math.hypot(a[0] - b[0], a[1] - b[1]) > 1e-9 ? pts.concat([a]) : pts; }
  const normalizeRing = (pts) => normalize(closeLoop(pts)).slice(0, N - 1);
  // 角の数（はっきり曲がっている所）。円（0）と四角（4）、U（0）と V（1）などを見分ける手がかりにする
  function corners(p, cyclic) {
    const k = 3, n = p.length; let count = 0, inCorner = false, first = null;
    for (let j = 0; j < n; j++) {
      if (!cyclic && (j < k || j >= n - k)) { inCorner = false; continue; }
      const a = p[(j - k + n) % n], b = p[j], c = p[(j + k) % n];
      const v1x = b[0] - a[0], v1y = b[1] - a[1], v2x = c[0] - b[0], v2y = c[1] - b[1];
      const l = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
      const ang = l > 0 ? Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / l))) : 0;
      const sharp = ang > 1.0;
      if (sharp && !inCorner) { count++; if (first === null) first = j; }
      inCorner = sharp;
    }
    if (cyclic && inCorner && first === 0 && count > 1) count--; // 一周してつながった角は1つに数える
    return count;
  }
  const isClosed = (p) => Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]) < 0.2;
  const TPL = {};
  for (const id in GLYPHS) {
    const g = GLYPHS[id];
    // 閉じた形は、終わりと始まりがつながった輪として扱い、描き始めの位置をずらして比べる
    const np = g.closed ? normalizeRing(g.pts) : normalize(g.pts);
    TPL[id] = { closed: !!g.closed, pts: np, corners: corners(np, !!g.closed) };
  }
  const ROTS = [-14, -7, 0, 7, 14].map((d) => (d * PI) / 180);
  // 描いた線 → { id, score（ずれ）, second（2番目に近いもの）}
  D.recognize = function (pts) {
    if (!pts || pts.length < 2 || pathLen(pts) <= 0) return null;
    const cand = normalize(pts);
    const closed = isClosed(cand);
    const ring = normalizeRing(pts), ringRev = ring.slice().reverse();
    const cc = closed ? corners(ring, true) : corners(cand, false);
    const gap = Math.hypot(cand[0][0] - cand[N - 1][0], cand[0][1] - cand[N - 1][1]); // 始まりと終わりの離れ具合（大きさ 1 あたり）
    const scores = [];
    for (const id in TPL) {
      const t = TPL[id];
      let best = Infinity;
      for (const a of ROTS) {
        if (t.closed) {
          const r = a ? rotate(ring, a) : ring, rr = a ? rotate(ringRev, a) : ringRev;
          for (let sh = 0; sh < N - 1; sh++) best = Math.min(best, dist(r, t.pts, sh), dist(rr, t.pts, sh));
        } else best = Math.min(best, dist(a ? rotate(cand, a) : cand, t.pts, 0));
      }
      // 閉じた形の手本は、描いた線の始まりと終わりが離れているほど、ずれを足す
      const gapPenalty = t.closed ? Math.max(0, gap - 0.1) * 0.8 : 0;
      scores.push({ id, score: best + gapPenalty + CORNER_W * Math.min(3, Math.abs(cc - t.corners)) });
    }
    scores.sort((a, b) => a.score - b.score);
    return { id: scores[0].score <= THRESHOLD ? scores[0].id : null, best: scores[0].id, score: scores[0].score, second: scores[1] };
  };
  D.THRESHOLD = THRESHOLD;
  D.corners = (pts) => { const c = normalize(pts); return isClosed(c) ? corners(normalizeRing(pts), true) : corners(c, false); };
  D.tplCorners = () => Object.fromEntries(Object.entries(TPL).map(([k, v]) => [k, v.corners]));

  // 紋章の絵（SVG）。始まりの点に丸をつける
  D.svg = function (id, size, color) {
    const g = GLYPHS[id]; if (!g) return '';
    const pad = 0.12, k = 1 - pad * 2;
    const pts = g.pts.map(([x, y]) => `${(pad + x * k).toFixed(3)},${(pad + y * k).toFixed(3)}`).join(' ');
    const [sx, sy] = g.pts[0];
    const c = color || 'currentColor';
    return `<svg class="glyph" viewBox="0 0 1 1" width="${size || 32}" height="${size || 32}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${c}" stroke-width="0.07" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${(pad + sx * k).toFixed(3)}" cy="${(pad + sy * k).toFixed(3)}" r="0.065" fill="${c}"/></svg>`;
  };

  if (typeof document === 'undefined') return;

  // ======================================================================
  //  描く（ゲームの入力から呼ばれる）
  // ======================================================================
  const S = { seq: [], drawing: false, stroke: [], cx: 0, cy: 0, lastT: 0, fade: 0, fadeKind: '', pop: 0, msg: '', msgT: 0, msgErr: false };
  const now = () => performance.now() / 1000;
  let canvas = null, ctx = null, legend = null, W = 0, H = 0, dpr = 1;
  const G = () => MG.Game, UI = () => MG.UI, AU = () => MG.Audio;

  function say(msg, err) { S.msg = msg; S.msgT = now(); S.msgErr = !!err; }
  D.begin = function () {
    const g = G();
    if (!g || !g.state.running || g.state.paused) return false;
    if (g.match && g.match.on && !g.match.alive) return false;
    S.drawing = true; S.stroke = [[0, 0]]; S.cx = 0; S.cy = 0;
    S.fade = 0;
    show(true);
    return true;
  };
  D.move = function (dx, dy) {
    if (!S.drawing) return;
    const lim = Math.min(W, H) * 0.42 || 300;
    S.cx = Math.max(-lim, Math.min(lim, S.cx + dx));
    S.cy = Math.max(-lim, Math.min(lim, S.cy + dy));
    const last = S.stroke[S.stroke.length - 1];
    if (Math.hypot(S.cx - last[0], S.cy - last[1]) >= 2) S.stroke.push([S.cx, S.cy]);
  };
  D.end = function () {
    if (!S.drawing) return null;
    S.drawing = false;
    const pts = S.stroke; S.stroke = [];
    return D.feed(pts);
  };
  D.cancelStroke = function () { S.drawing = false; S.stroke = []; };
  // 描き終えた線を紋章として読み取る（動作確認からも呼ぶ）
  D.feed = function (pts) {
    S.lastT = now();
    if (pathLen(pts) < 30) {
      // 少し押しただけ（ほとんど描いていない）: 最後の紋章を1つ消す
      if (S.seq.length) { const w = S.seq.pop(); say(`「${MG.WORD_MAP[w].label}」の紋章を消しました`); AU().removeWord(); sync(); }
      return { undo: true };
    }
    const r = D.recognize(pts);
    if (!r || !r.id) { AU().error(); say('紋章が読み取れませんでした。左の一覧の形を、はっきり大きめに描いてください', true); return { ok: false, r }; }
    if (S.seq.includes(r.id)) { AU().error(); say(`「${MG.WORD_MAP[r.id].label}」の紋章は、もう重ねています`, true); return { ok: false, dup: true, r }; }
    if (S.seq.length >= MAX_GLYPHS) { AU().error(); say(`紋章は ${MAX_GLYPHS} つまでです。左クリックで発動してください（右クリックを少し押すと1つ消せます）`, true); return { ok: false, full: true, r }; }
    S.seq.push(r.id); S.pop = 1;
    AU().addWord();
    say(S.seq.length >= 2 ? '' : 'もう1つ以上、紋章を重ねてください');
    sync();
    return { ok: true, id: r.id, r };
  };
  // 3D の魔法陣（目の前の輪）も、重ねた紋章の数だけ組み上げる
  function sync() {
    const g = G(); if (!g) return;
    if (S.seq.length) g.chantBuild({ words: S.seq.slice(), need: S.seq.length >= 2, progress: 0 });
    else g.chantBuild({ state: 'idle' });
  }
  D.clear = function (kind) {
    if (!S.seq.length && !S.drawing) return;
    S.fade = 1; S.fadeKind = kind || 'clear'; S.fadeSeq = S.seq.slice();
    S.seq = []; S.drawing = false; S.stroke = [];
    if (kind !== 'done') { const g = G(); if (g) g.chantBuild({ state: kind === 'fail' ? 'fail' : 'idle' }); }
  };
  D.finish = function () { D.clear('done'); };
  D.seq = () => S.seq.slice();
  D.count = () => S.seq.length;
  D.drawing = () => S.drawing;
  D.active = () => S.drawing || S.seq.length > 0;
  D.setSeq = (seq) => { S.seq = seq.slice(); S.lastT = now(); sync(); };

  // ======================================================================
  //  表示
  // ======================================================================
  function show(on) { if (legend) legend.classList.toggle('show', !!on); }
  function resize() {
    if (!canvas) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function roleColor(seq, i) {
    const w = MG.WORD_MAP[seq[i]]; const w0 = MG.WORD_MAP[seq[0]];
    if (i === 0) return MG.ELEMENTS[w.elem].c1;
    if (i === 1) return MG.ELEMENTS[w0.elem].c2;
    return '#ffd36b';
  }
  function glyphPath(id, cx, cy, size, rot) {
    const g = GLYPHS[id];
    ctx.beginPath();
    g.pts.forEach(([x, y], i) => {
      let px = (x - 0.5) * size, py = (y - 0.5) * size;
      if (rot) { const c = Math.cos(rot), s = Math.sin(rot); const qx = px * c - py * s; py = px * s + py * c; px = qx; }
      if (i) ctx.lineTo(cx + px, cy + py); else ctx.moveTo(cx + px, cy + py);
    });
  }
  function drawCircle(seq, alpha, scale) {
    if (!seq.length) return;
    const R = Math.min(W, H) * 0.13 * scale;
    const cx = W / 2, cy = H / 2;
    const t = now();
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.shadowBlur = 14;
    // 輪（重ねた紋章の数だけ）
    seq.forEach((id, i) => {
      const col = roleColor(seq, i);
      ctx.strokeStyle = col; ctx.shadowColor = col; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, R * (1 + i * 0.09), 0, PI * 2); ctx.stroke();
      // ことばの名前を輪のまわりに
      ctx.fillStyle = col; ctx.font = `bold ${Math.round(R * 0.14)}px "Yu Gothic UI", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const a = -PI / 2 + i * (PI / 2) + t * 0.15 * (i % 2 ? -1 : 1);
      ctx.fillText(MG.WORD_MAP[id].label, cx + Math.cos(a) * R * (1.22 + i * 0.09), cy + Math.sin(a) * R * (1.22 + i * 0.09));
    });
    // 紋章を中心に重ねる
    seq.forEach((id, i) => {
      const col = roleColor(seq, i);
      const pop = i === seq.length - 1 ? S.pop : 0;
      ctx.strokeStyle = col; ctx.shadowColor = col; ctx.lineWidth = 3 + pop * 3;
      glyphPath(id, cx, cy, R * (1.1 + pop * 0.3) * (1 - i * 0.04), i * 0.12);
      ctx.stroke();
    });
    ctx.restore();
  }
  function frame() {
    requestAnimationFrame(frame);
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    const t = now();
    const g = G();
    // しばらく唱えなければ消える
    if (S.seq.length && !S.drawing && t - S.lastT > IDLE_SEC) { D.clear('idle'); say('時間がたったので、紋章が消えました', true); }
    if (S.pop > 0) S.pop = Math.max(0, S.pop - 0.06);
    drawCircle(S.seq, 0.9, 1);
    if (S.fade > 0) {
      S.fade = Math.max(0, S.fade - 0.035);
      if (S.fadeKind === 'done') drawCircle(S.fadeSeq, S.fade, 1 + (1 - S.fade) * 1.4);
      else if (S.fadeKind === 'fail') drawCircle(S.fadeSeq, S.fade, 1 - (1 - S.fade) * 0.3);
      else drawCircle(S.fadeSeq, S.fade * 0.6, 1);
    }
    // 描いている線（線のまとまりの中心が画面の中心に来るように）
    if (S.drawing && S.stroke.length > 1) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      S.stroke.forEach(([x, y]) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); });
      const ox = W / 2 - (minX + maxX) / 2, oy = H / 2 - (minY + maxY) / 2;
      ctx.save();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = '#dff6ff'; ctx.shadowColor = '#7fd8ff'; ctx.shadowBlur = 18; ctx.lineWidth = 5;
      ctx.beginPath(); S.stroke.forEach(([x, y], i) => (i ? ctx.lineTo(x + ox, y + oy) : ctx.moveTo(x + ox, y + oy))); ctx.stroke();
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(S.stroke[0][0] + ox, S.stroke[0][1] + oy, 5, 0, PI * 2); ctx.fill();
      ctx.restore();
    }
    // 案内
    let hint = '', err = false;
    if (S.msg && t - S.msgT < 2.6) { hint = S.msg; err = S.msgErr; }
    else if (S.seq.length >= 2) {
      const known = UI() && UI().getSave && UI().getSave().known[S.seq.join('|')];
      const spec = MG.buildSpell(S.seq);
      hint = spec ? (known ? `左クリックで「${spec.name.kanji}」を発動` : '左クリックで発動（まだ名前のわからない魔法）') + (S.seq.length < MAX_GLYPHS ? '・さらに重ねてもよい' : '') : 'この紋章の組み合わせでは魔法になりません';
    } else if (S.seq.length === 1) hint = 'もう1つ以上、紋章を重ねてください（右クリックを押しながら描く）';
    else if (S.drawing) hint = '右クリックを押したまま、紋章を描く（離すと読み取ります）';
    if (hint && g && g.state.running) {
      ctx.save();
      ctx.font = 'bold 16px "Yu Gothic UI", "Meiryo", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const y = H / 2 + Math.min(W, H) * 0.13 * 1.6 + 14;
      const w = ctx.measureText(hint).width + 28;
      ctx.fillStyle = 'rgba(10, 14, 40, 0.82)'; ctx.strokeStyle = err ? '#ff6b6b' : 'rgba(140, 160, 255, 0.45)'; ctx.lineWidth = 1;
      ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(W / 2 - w / 2, y - 16, w, 32, 10); else ctx.rect(W / 2 - w / 2, y - 16, w, 32); ctx.fill(); ctx.stroke();
      ctx.fillStyle = err ? '#ffb0b0' : '#eef1ff'; ctx.fillText(hint, W / 2, y);
      ctx.restore();
    }
    show(D.active());
  }
  D.init = function () {
    const hud = document.getElementById('hud');
    if (!hud || canvas) return;
    canvas = document.createElement('canvas'); canvas.id = 'draw-layer'; canvas.setAttribute('aria-hidden', 'true');
    hud.insertBefore(canvas, hud.firstChild.nextSibling);
    ctx = canvas.getContext('2d');
    legend = document.createElement('div'); legend.id = 'glyph-legend'; legend.className = 'glyph-legend';
    legend.innerHTML = '<div class="gl-title">紋章（● が描き始め）</div><div class="gl-grid">' + MG.WORDS.map((w) => `<div class="gl-item ${w.group}" title="${w.label}: ${GLYPHS[w.id].name}">${D.svg(w.id, 26)}<span>${w.label}</span></div>`).join('') + '</div>';
    hud.appendChild(legend);
    window.addEventListener('resize', resize);
    resize();
    requestAnimationFrame(frame);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', D.init); else D.init();
  D.state = S;
})();
