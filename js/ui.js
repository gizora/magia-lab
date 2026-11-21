// 画面まわり: 保存、タイトル、HUD、魔法工房、図鑑、メニュー、結果
(function () {
  'use strict';
  const MG = window.MG, G = MG.Game, AU = MG.Audio, W = MG.World, H = MG.Haptics, V = MG.Voice;
  const st = G.state;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const keyOf = (seq) => seq.join('|');

  // ======================================================================
  //  保存（ブラウザの localStorage）
  // ======================================================================
  const KEY = 'magia-lab-v1';
  const DEFAULT_SLOTS = [
    ['combustion', 'reduction'],
    ['solidification', 'decomposition'],
    ['ionization', 'discharge'],
    ['decomposition', 'gravity'],
  ];
  // known: 一度でも放った魔法 { 並び: { best: 1回で与えた最大ダメージ, casts: 発動回数, t: 初めて放った時刻 } }
  let save = { slots: DEFAULT_SLOTS, known: {}, secrets: [], best: 0, sound: true, sens: 1, seen: false, time: 'night', shake: 1, pad: true, voiceOk: false, voiceOn: true, bgm: 0.6, bgmOn: true };
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d && typeof d === 'object') save = Object.assign(save, d);
      }
    } catch (e) { /* 保存が使えない環境でも遊べるようにする */ }
    if (!Array.isArray(save.slots) || save.slots.length !== 4) save.slots = DEFAULT_SLOTS;
    save.slots = save.slots.map((s) => (Array.isArray(s) && MG.buildSpell(s) ? s : null));
    // 杖ごとのスロット（はじめての杖には、最初の魔法を入れておく）
    if (!save.wandSlots || typeof save.wandSlots !== 'object' || Array.isArray(save.wandSlots)) save.wandSlots = {};
    if (!save.wandSlots.novice) save.wandSlots.novice = save.slots.slice(0, 4);
    MG.WANDS.forEach((w) => {
      let a = Array.isArray(save.wandSlots[w.id]) ? save.wandSlots[w.id] : DEFAULT_SLOTS.slice(0, w.slots);
      a = a.slice(0, w.slots).map((s) => (Array.isArray(s) && MG.buildSpell(s) ? s : null));
      while (a.length < w.slots) a.push(null);
      save.wandSlots[w.id] = a;
    });
    save.slots = save.wandSlots.novice.slice(0, 4);
    if (!MG.WAND_MAP[save.wand]) save.wand = 'novice';
    if (!save.known || typeof save.known !== 'object' || Array.isArray(save.known)) save.known = {};
    for (const k in save.known) if (!MG.buildSpell(k.split('|')) || !save.known[k] || typeof save.known[k] !== 'object') delete save.known[k];
    save.secrets = Array.isArray(save.secrets) ? save.secrets.filter((id) => MG.SECRETS.some((s) => s.id === id)) : [];
    // お気に入り（図鑑の★）: 放ったことのある魔法だけ
    if (!save.fav || typeof save.fav !== 'object' || Array.isArray(save.fav)) save.fav = {};
    for (const k in save.fav) if (!save.known[k]) delete save.fav[k];
    delete save.book;
    save.time = save.time === 'day' ? 'day' : 'night';
    save.shake = [0, 0.5, 1, 1.5].includes(+save.shake) ? +save.shake : 1;
    save.pad = save.pad !== false;
    save.voiceOn = save.voiceOn !== false;
    save.bgm = typeof save.bgm === 'number' ? Math.max(0, Math.min(1, save.bgm)) : 0.6;
    save.bgmOn = save.bgmOn !== false;
    // 成長（第26版）: はじめて遊ぶ人と、前の版から続ける人は、Lv1・${MG.RPG.START_GOLD} G から
    if (!save.rpg || typeof save.rpg !== 'object') save.rpg = { gold: MG.RPG.START_GOLD };
  }
  let importing = false; // 読み込んだデータを書いたあとは、ページを開き直すまで今のデータで上書きしない
  function persist() { if (importing) return; try { localStorage.setItem(KEY, JSON.stringify(save)); } catch (e) { /* 保存できなくても続ける */ } }

  // ---- セーブデータの書き出し・読み込み（公開サイトや別のパソコンへ移すため） ----
  // ブラウザは開いた場所（index.html を直接・start.bat・公開サイト）ごとに保存を分けるので、ファイルで持ち運べるようにする
  const EXPORT_APP = 'magia-lab';
  const IMPORT_KEYS = ['slots', 'wandSlots', 'wand', 'known', 'secrets', 'fav', 'best', 'sound', 'sens', 'seen', 'time', 'shake', 'pad', 'voiceOn', 'bgm', 'bgmOn', 'vsName', 'rpg'];
  function exportText() {
    const data = {}; IMPORT_KEYS.forEach((k) => { if (save[k] !== undefined) data[k] = save[k]; });
    return JSON.stringify({ app: EXPORT_APP, format: 1, exported: new Date().toISOString(), data });
  }
  // ファイルの中身 → 読み込めるデータ（マギア・ラボのデータでなければ null）。知らない項目は捨て、型を確かめる（細かい確かめは読み込み後の load() でも行う）
  function parseImport(text) {
    let o;
    try { o = JSON.parse(String(text).replace(/^\uFEFF/, '')); } catch (e) { return null; }
    if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
    const d = o.app === EXPORT_APP && o.data && typeof o.data === 'object' && !Array.isArray(o.data) ? o.data : null;
    if (!d) return null;
    const out = {};
    IMPORT_KEYS.forEach((k) => { if (d[k] !== undefined) out[k] = d[k]; });
    if (out.known && typeof out.known === 'object' && !Array.isArray(out.known)) {
      const kn = {};
      for (const k in out.known) {
        const v = out.known[k];
        if (k.length < 200 && v && typeof v === 'object' && !Array.isArray(v)) kn[k] = Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === 'number' && isFinite(x)));
      }
      out.known = kn;
    } else delete out.known;
    if (out.fav && (typeof out.fav !== 'object' || Array.isArray(out.fav))) delete out.fav;
    if (out.fav) out.fav = Object.fromEntries(Object.keys(out.fav).filter((k) => k.length < 200).map((k) => [k, true]));
    if (typeof out.best !== 'number' || !isFinite(out.best) || out.best < 0) delete out.best;
    if (typeof out.sens !== 'number' || !isFinite(out.sens)) delete out.sens; else out.sens = Math.max(0.3, Math.min(2.5, out.sens));
    if (typeof out.bgm !== 'number' || !isFinite(out.bgm)) delete out.bgm;
    ['wand', 'time'].forEach((k) => { if (out[k] !== undefined && typeof out[k] !== 'string') delete out[k]; });
    ['sound', 'seen', 'pad', 'voiceOn', 'bgmOn'].forEach((k) => { if (out[k] !== undefined) out[k] = !!out[k]; });
    if (out.vsName !== undefined) out.vsName = MG.Net && MG.Net.cleanName ? MG.Net.cleanName(out.vsName) : String(out.vsName).replace(/[\u0000-\u001f<>]/g, '').slice(0, 12);
    const known = Object.keys(out.known || {}).filter((k) => MG.buildSpell(k.split('|'))).length;
    const secrets = Array.isArray(out.secrets) ? out.secrets.filter((id) => MG.SECRETS.some((s) => s.id === id)).length : 0;
    const day = typeof o.exported === 'string' && /^\d{4}-\d{2}-\d{2}/.test(o.exported) ? o.exported.slice(0, 10) : '';
    return { data: out, known, secrets, best: Math.round(out.best || 0), day };
  }
  // 読み込む: 保存を書き換える（反映はページを開き直したとき）
  function applyImport(p) {
    try { localStorage.setItem(KEY, JSON.stringify(p.data)); } catch (e) { return false; }
    importing = true; clearTimeout(persistTimer);
    return true;
  }
  let persistTimer = 0;
  function persistSoon() { clearTimeout(persistTimer); persistTimer = setTimeout(persist, 400); }
  const isKnown = (seq) => !!(seq && save.known[keyOf(seq)]);

  // ======================================================================
  //  オーバーレイの開け閉め
  // ======================================================================
  let current = null, unlockAt = 0;
  function open(id) {
    if (current && current !== id) $(current).hidden = true;
    current = id;
    const el = $(id);
    el.hidden = false;
    G.setPaused(true);
    G.unlockPointer();
    if (id === 'crafter') renderCrafter();
    if (id === 'book') renderBook();
    if (id === 'menu') renderMenu();
    if (id === 'wands') renderWands();
    if (id === 'temple') renderTemple();
    if (id === 'shop') renderShop();
    if (id === 'versus' && MG.VS) MG.VS.render();
    if (id === 'voice-consent') $('voice-file-note').hidden = location.protocol !== 'file:';
    const f = el.querySelector('[data-autofocus]') || el.querySelector('button:not([disabled])');
    if (f) f.focus();
  }
  function close(relock) {
    if (!current) return;
    $(current).hidden = true;
    current = null;
    G.setPaused(false);
    if (relock !== false && !G.isTouch()) G.lockPointer();
  }
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => { AU.click(); close(); }));
  // 外側をクリックすると閉じる（一時停止の画面だけは、クリックでそのまま練習場に戻る）
  document.querySelectorAll('.panel-overlay').forEach((ov) => ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(ov.id === 'pause' ? undefined : false); }));
  $('pause-menu').addEventListener('click', () => { AU.click(); open('menu'); });

  // ======================================================================
  //  HUD
  // ======================================================================
  const slotEls = [];
  function buildSlots() {
    const wrap = $('slots');
    wrap.innerHTML = '';
    slotEls.length = 0;
    const n = st.slots.length;
    wrap.style.gridTemplateColumns = `repeat(${Math.max(1, n)}, minmax(0, 1fr))`;
    wrap.style.width = n ? `min(${n * 180}px, 100%)` : 'min(720px, 100%)';
    if (!n) { wrap.innerHTML = '<div class="bare-info" id="bare-info"><b>素手</b>: 詠唱と紋章でのみ魔法を使えます ・ 効果 <b>+50%</b> ・ MP <b>×1.6</b> ・ 詠唱は名前を一字一句そのまま</div>'; return; }
    for (let i = 0; i < n; i++) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'slot';
      b.innerHTML = `<span class="s-key">${i + 1}</span><span class="s-name"></span><span class="s-meta"></span><span class="s-charge" aria-hidden="true"></span><span class="s-cd"></span>`;
      b.addEventListener('click', () => { G.selectSlot(i); if (!G.isTouch()) G.lockPointer(); });
      wrap.appendChild(b);
      slotEls.push(b);
    }
  }
  function renderSlots() {
    slotEls.forEach((b, i) => {
      const s = st.slots[i];
      const known = s && isKnown(s.seq);
      b.classList.toggle('empty', !s);
      b.classList.toggle('unknown', !!s && !known);
      b.classList.toggle('active', i === st.slot);
      b.querySelector('.s-name').textContent = !s ? '（空き）' : known ? s.name.kanji : '？？？';
      const sealed = !!s && G.isSealed(s.seq);
      b.classList.toggle('sealed', sealed);
      b.querySelector('.s-meta').textContent = !s ? '工房で登録' : sealed ? `封印中（Lv${MG.RPG.sealLevel(s.seq.length)} で解ける）` : known ? `MP ${G.costFor(s, 'slot')} ・ ${MG.ELEMENTS[s.element].label}の${s.secret ? '禁呪' : MG.FORMS[s.form].label}` : '未発動 ・ 放つと判明';
      b.style.setProperty('--c1', s ? (known ? s.colors[0] : '#8a8fb8') : '#556');
      b.setAttribute('aria-label', `スロット${i + 1}: ${!s ? '空き' : known ? s.name.kanji : 'まだ放っていない魔法'}`);
      b.setAttribute('aria-pressed', i === st.slot ? 'true' : 'false');
    });
    const s = st.slots[st.slot];
    const col = s && isKnown(s.seq) ? s.colors[0] : '#7fd8ff';
    renderWandChip();
    $('btn-cast').style.setProperty('--c1', col);
    $('crosshair').style.setProperty('--cross', col);
  }

  let lastScore = -1, lastTimer = -1;
  function updateHud() {
    if ($('hud').hidden) return;
    const r = st.mp / st.mpMax;
    $('mp-fill').style.width = (r * 100).toFixed(1) + '%';
    $('mp-num').textContent = Math.floor(st.mp);
    const cur = st.slots[st.slot];
    $('mp-fill').parentElement.classList.toggle('low', !!cur && isKnown(cur.seq) && st.mp < G.costFor(cur, 'slot'));
    slotEls.forEach((b, i) => {
      const s = st.slots[i];
      b.querySelector('.s-cd').style.setProperty('--cd', s && s.cd ? Math.min(1, st.cds[i] / s.cd).toFixed(3) : 0);
      b.classList.toggle('no-mp', !!s && isKnown(s.seq) && st.mp < G.costFor(s, 'slot'));
      // 無詠唱の残り回数（●○）と、次の1回が戻るまで
      const ch = G.charge(i), max = ch.max;
      const el = b.querySelector('.s-charge');
      const txt = s ? '●'.repeat(ch.n) + '○'.repeat(max - ch.n) + (ch.n < max ? ` ${Math.ceil(MG.RECHARGE_SEC - ch.t)}s` : '') : '';
      if (el.textContent !== txt) el.textContent = txt;
      b.classList.toggle('spent', !!s && ch.n <= 0);
    });
    if (st.score !== lastScore) { $('score').textContent = st.score.toLocaleString(); lastScore = st.score; }
    $('combo').textContent = st.combo > 1 ? `${st.combo} コンボ` : '';
    const ch = st.challenge;
    $('timer').hidden = !ch;
    if (ch) {
      const left = Math.ceil(ch.left);
      $('timer-num').textContent = left;
      $('timer').classList.toggle('hurry', left <= 10);
      if (left !== lastTimer) { if (left <= 5 && left > 0) AU.tick(); lastTimer = left; }
    }
    $('lock-hint').hidden = !(!G.isTouch() && !G.isLocked() && st.running && !st.paused);
    const S = G.sup, chips = [];
    updateWardOverlay(S);
    if (S.shield > 0) chips.push(`<span class="sup-chip ward"><b>${S.shieldShape === 'front' ? '大盾' : '障壁'}</b> ${Math.ceil(S.shield)}${S.shieldShape === 'front' ? '<small>（前だけ）</small>' : ''}<span class="sup-bar"><span style="width:${Math.round((S.shield / Math.max(1, S.shieldMax)) * 100)}%"></span></span>${S.shieldT.toFixed(1)}秒</span>`);
    // 魔法の壁（壁・城壁・ドーム）と召喚獣
    const bars = G.myBarriers ? G.myBarriers() : [];
    if (bars.length) {
      const b0 = bars.reduce((a, b) => (b.left > a.left ? b : a));
      const name = bars.length > 1 && b0.shape === 'wall' ? `壁 ×${bars.length}` : { wall: '壁', dome: 'ドーム' }[b0.shape];
      chips.push(`<span class="sup-chip ward"><b>${name}</b> ${bars.reduce((s, b) => s + b.hp, 0)}<span class="sup-bar"><span style="width:${Math.round((bars.reduce((s, b) => s + b.hp, 0) / Math.max(1, bars.reduce((s, b) => s + b.maxHp, 0))) * 100)}%"></span></span>${b0.left.toFixed(1)}秒</span>`);
    }
    (G.mySummons ? G.mySummons() : []).forEach((m) => chips.push(`<span class="sup-chip summon"><b>${m.label}</b> HP ${m.hp}<span class="sup-bar"><span style="width:${Math.round((m.hp / Math.max(1, m.maxHp)) * 100)}%"></span></span>${Math.ceil(m.left)}秒</span>`));
    if (S.guardT > 0) chips.push(`<span class="sup-chip guard"><b>守護</b> ダメージ半分 ${S.guardT.toFixed(1)}秒</span>`);
    if (S.regenT > 0) chips.push(`<span class="sup-chip heal"><b>再生中</b>${G.match.on ? '' : '（練習場では HP は減りません）'}</span>`);
    if (S.flyT > 0) chips.push(`<span class="sup-chip fly"><b>飛翔</b> Space 上昇・C 下降<span class="sup-bar"><span style="width:${Math.round((S.flyT / Math.max(0.1, S.flyMax)) * 100)}%"></span></span>${S.flyT.toFixed(1)}秒</span>`);
    if (S.auraT > 0 && S.auraSpec) chips.push(`<span class="sup-chip aura"><b>纏い</b> 速さ ×${S.auraSpec.moveMul}<span class="sup-bar"><span style="width:${Math.round((S.auraT / Math.max(0.1, S.auraMax)) * 100)}%"></span></span>${S.auraT.toFixed(1)}秒</span>`);
    if (S.hasteT > 0) chips.push(`<span class="sup-chip haste"><b>迅速</b> 足が速い ${S.hasteT.toFixed(1)}秒</span>`);
    const auraEl = $('aura-overlay');
    if (auraEl) {
      const on = S.auraT > 0 && !!S.auraSpec && (!G.match.on || G.match.alive);
      auraEl.classList.toggle('on', on);
      if (on && auraEl.dataset.el !== S.auraSpec.element) { auraEl.dataset.el = S.auraSpec.element; auraEl.style.setProperty('--aura', S.auraSpec.colors[0]); auraEl.style.setProperty('--aura2', S.auraSpec.colors[1]); }
      auraEl.classList.toggle('zap', on && (S.auraSpec.element === 'lightning' || S.auraSpec.element === 'plasma' || S.auraSpec.element === 'magnet'));
    }
    const html = chips.join('');
    if (supHtml !== html) { $('sup-hud').innerHTML = html; supHtml = html; }
  }
  let supHtml = '';
  // 自分の障壁: 画面のふちに属性の色の網目。当たると強く光り、残りが少ないとひびが入って点滅し、こわれると砕ける
  const wardEl = $('ward-overlay');
  (function initWardOverlay() {
    // 六角形の網目（平らな辺が上下の六角形を並べた模様）
    const hex = (cx, cy) => [[30, 0], [15, 26], [-15, 26], [-30, 0], [-15, -26], [15, -26]].map(([x, y]) => `${cx + x},${cy + y}`).join(' ');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="90" height="52" viewBox="0 0 90 52"><g fill="none" stroke="white" stroke-width="2.2"><polygon points="${hex(30, 26)}"/><polygon points="${hex(75, 0)}"/><polygon points="${hex(75, 52)}"/></g></svg>`;
    const url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
    const h = wardEl.querySelector('.wo-hex');
    h.style.webkitMaskImage = url; h.style.maskImage = url;
    // ひび（画面のふちから内側へ走るギザギザの線）
    let lines = '';
    let seed = 11; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 9; i++) {
      const side = i % 4; let x = side === 0 ? 0 : side === 1 ? 1600 : rnd() * 1600, y = side === 2 ? 0 : side === 3 ? 900 : rnd() * 900;
      const tx = 800 + (rnd() - 0.5) * 500, ty = 450 + (rnd() - 0.5) * 300; let d = `M${x.toFixed(0)},${y.toFixed(0)}`;
      for (let k = 1; k <= 5; k++) { const f = k / 9; x = x + (tx - x) * f + (rnd() - 0.5) * 70; y = y + (ty - y) * f + (rnd() - 0.5) * 70; d += ` L${x.toFixed(0)},${y.toFixed(0)}`; }
      lines += `<path d="${d}"/>`;
    }
    const crack = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" preserveAspectRatio="none"><g fill="none" stroke="white" stroke-width="3" stroke-linejoin="round">${lines}</g></svg>`;
    wardEl.querySelector('.wo-crack').style.backgroundImage = `url("data:image/svg+xml,${encodeURIComponent(crack)}")`;
  })();
  let wardBreaks = 0, wardCol = '';
  function updateWardOverlay(S) {
    if (S.breaks !== wardBreaks) {
      wardBreaks = S.breaks;
      wardEl.classList.remove('shatter'); void wardEl.offsetWidth; wardEl.classList.add('shatter');
      setTimeout(() => wardEl.classList.remove('shatter'), 600);
    }
    const on = S.shield > 0 && (!G.match.on || G.match.alive);
    const col = on && S.shieldSpec ? S.shieldSpec.colors[0] : wardCol;
    if (col && col !== wardCol) { wardEl.style.setProperty('--ward', col); wardCol = col; }
    if (!wardEl.classList.contains('shatter')) wardEl.style.opacity = on ? Math.min(1, 0.45 + S.hitT * 1.8).toFixed(2) : '0';
    wardEl.classList.toggle('low', on && G.wardLow());
    wardEl.classList.toggle('on', on);
    if (on || !wardEl.classList.contains('shatter')) wardEl.classList.toggle('front', on && S.shieldShape === 'front'); // 大盾: 画面の下の真ん中だけ
  }

  let toastTimer = 0;
  function toast(msg, ms) {
    const t = $('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms || 2200);
  }
  let bannerTimer = 0;
  function banner(spec) {
    const b = $('spell-banner');
    if (!spec) { b.classList.remove('show'); return; }
    const known = isKnown(spec.seq);
    b.style.setProperty('--glow', known ? spec.colors[0] : '#8a8fb8');
    b.innerHTML = known ? `<div class="b-name">${esc(spec.name.kanji)}</div><div class="b-kana">${esc(spec.name.kana)}</div>` : '<div class="b-name">？？？</div><div class="b-kana">まだ放っていない魔法</div>';
    b.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => b.classList.remove('show'), 1500);
  }

  // 初めて放ったときの「名前が明かされる」演出
  let revealTimer = 0;
  function reveal(spec) {
    const el = $('reveal');
    const chars = Array.from(spec.name.kanji).map((c, i) => `<span style="animation-delay:${0.25 + i * 0.09}s">${esc(c)}</span>`).join('');
    el.style.setProperty('--c1', spec.colors[0]);
    el.classList.toggle('secret', !!spec.secret);
    el.innerHTML = `<div class="rv-kicker">${spec.secret ? '★ 隠し魔法を発見！' : '新しい魔法が生まれた'}</div>
      <div class="rv-name">${chars}</div>
      <div class="rv-kana">${esc(spec.name.kana)}</div>
      <div class="rv-sub">${esc(spec.name.rank)} ・ ${MG.ELEMENTS[spec.element].label}属性${spec.destroy ? ' ・ 破壊' : ''}</div>`;
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    clearTimeout(revealTimer);
    revealTimer = setTimeout(() => el.classList.remove('show'), spec.secret ? 3600 : 2800);
    $('spell-banner').classList.remove('show');
    if (spec.secret) AU.secret(); else AU.reveal(spec.name.kanji.length);
  }

  // ======================================================================
  //  魔法工房
  // ======================================================================
  let seq = [];
  let lastPreviewKey = '';
  const chipEls = {};
  function buildPalette() {
    MG.WORDS.forEach((w) => {
      const E = MG.ELEMENTS[w.elem];
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'chip'; b.dataset.word = w.id;
      b.style.setProperty('--c1', E.c1); b.style.setProperty('--c2', E.c2);
      b.innerHTML = `<span class="c-label">${w.label}</span><span class="c-roles">${E.label}・${MG.FORMS[w.form].label}・${MG.MODS[w.mod].kanji}</span>`;
      b.setAttribute('aria-label', `${w.label}（1番目なら${E.label}属性、2番目なら${MG.FORMS[w.form].label}、3・4番目なら${MG.MODS[w.mod].kanji}）`);
      b.addEventListener('click', () => addWord(w.id));
      b.addEventListener('mouseenter', () => showInfo(w.id));
      b.addEventListener('focus', () => showInfo(w.id));
      b.draggable = true;
      b.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', 'w:' + w.id); });
      $(w.group === 'chem' ? 'palette-chem' : 'palette-phys').appendChild(b);
      chipEls[w.id] = b;
    });
  }

  function showInfo(id) {
    const el = $('word-info');
    if (!id) {
      el.innerHTML = `<h4>ことばの並べ方</h4><p>同じことばでも、<b>置く場所</b>で役割が変わります。名前と威力は、<b>放ってみるまで</b>わかりません。</p>
        <div class="roles"><span class="r-pos">1番目</span><span class="r-val">属性</span><span class="r-note">炎・氷・雷など、魔法の種類</span>
        <span class="r-pos">2番目</span><span class="r-val">形</span><span class="r-note">弾・光線・渦など、飛び方</span>
        <span class="r-pos">3・4番目</span><span class="r-val">効果</span><span class="r-note">連鎖・貫通・追尾などの追加効果</span></div>`;
      return;
    }
    const w = MG.WORD_MAP[id];
    const roles = MG.wordRoles(id);
    el.innerHTML = `<h4>${w.label} <span class="tag ${w.group === 'chem' ? 'tag-chem' : 'tag-phys'}">${w.group === 'chem' ? '化学' : '物理'}</span></h4>
      <p>${esc(w.sci)}</p>
      <p class="yomi">読み: <b>${esc(w.yomi)}</b></p>
      ${MG.Draw ? `<p class="glyph-row">${MG.Draw.svg(id, 40)}<span>紋章: <b>${esc(MG.Draw.GLYPHS[id].name)}</b>（右クリックを押しながら描く。● が描き始め）</span></p>` : ''}
      <div class="roles">${roles.map((r) => `<span class="r-pos">${r.pos}</span><span class="r-val">${esc(r.value)}</span><span class="r-note">${esc(r.note)}</span>`).join('')}</div>`;
  }

  function addWord(id) {
    if (seq.length >= 4) { toast('並べられるのは4つまでです'); AU.error(); return; }
    if (seq.includes(id)) return;
    seq.push(id);
    AU.addWord(seq.length - 1);
    renderCrafter(seq.length - 1);
    // 押したボタンが使えなくなるので、次に使う場所へフォーカスを移す
    if (seq.length >= 4 || document.activeElement === chipEls[id] || document.activeElement === document.body) {
      const next = seq.length >= 4 ? document.querySelector('.reg-btn') : nextChip(id);
      if (next) next.focus();
    }
  }
  function nextChip(id) {
    const ids = MG.WORDS.map((w) => w.id);
    for (let k = 1; k <= ids.length; k++) {
      const c = chipEls[ids[(ids.indexOf(id) + k) % ids.length]];
      if (!c.disabled) return c;
    }
    return null;
  }
  function removeAt(i) {
    if (i >= seq.length) return;
    seq.splice(i, 1);
    AU.removeWord();
    renderCrafter();
    const slots = document.querySelectorAll('.seq-slot');
    const f = slots[Math.min(i, Math.max(0, seq.length - 1))];
    if (seq.length && f) f.focus(); else $('btn-clear').focus();
  }
  function swap(a, b) {
    if (a === b || a < 0 || b < 0 || a >= seq.length || b >= seq.length) return;
    [seq[a], seq[b]] = [seq[b], seq[a]];
    AU.addWord(b);
    renderCrafter();
  }

  function renderCrafter(popIndex) {
    const chain = G.chainMax();
    MG.WORDS.forEach((w) => {
      const used = seq.includes(w.id);
      const c = chipEls[w.id];
      c.disabled = used || seq.length >= chain;
      c.classList.toggle('used', used);
    });
    const wrap = $('seq');
    wrap.innerHTML = '';
    const roleNames = ['属性', '形', '効果', '効果'];
    for (let i = 0; i < 4; i++) {
      const id = seq[i];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'seq-slot ' + (id ? 'filled' : 'empty');
      b.dataset.index = i;
      if (id) {
        const w = MG.WORD_MAP[id];
        const role = i === 0 ? MG.ELEMENTS[w.elem].label : i === 1 ? MG.FORMS[w.form].label : MG.MODS[w.mod].kanji;
        b.style.setProperty('--c1', MG.ELEMENTS[w.elem].c1);
        b.innerHTML = `<span class="q-pos">${i + 1} ${roleNames[i]}</span><span class="q-word">${w.label}</span><span class="q-role">→ ${esc(role)}</span>`;
        b.setAttribute('aria-label', `${i + 1}番目（${roleNames[i]}）: ${w.label}、${role}。クリックで外す。左右キーで並べかえ`);
        b.draggable = true;
        b.addEventListener('click', () => removeAt(i));
        b.addEventListener('keydown', (e) => {
          if (e.key === 'ArrowLeft' && i > 0) { e.preventDefault(); swap(i, i - 1); document.querySelectorAll('.seq-slot')[i - 1].focus(); }
          if (e.key === 'ArrowRight' && i < seq.length - 1) { e.preventDefault(); swap(i, i + 1); document.querySelectorAll('.seq-slot')[i + 1].focus(); }
          if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeAt(i); }
        });
        b.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', 's:' + i); });
        b.addEventListener('focus', () => showInfo(id));
        if (popIndex === i) b.classList.add('pop-in');
      } else if (i >= chain) {
        b.className = 'seq-slot empty sealed';
        b.innerHTML = `<span class="q-pos">${i + 1} ${roleNames[i]}</span><span class="q-word" aria-hidden="true">封</span><span class="q-role">Lv${MG.RPG.sealLevel(i + 1)} で解ける</span>`;
        b.setAttribute('aria-label', `${i + 1}番目: 封印中（Lv${MG.RPG.sealLevel(i + 1)} で解ける）`);
        b.tabIndex = -1;
      } else {
        b.innerHTML = `<span class="q-pos">${i + 1} ${roleNames[i]}</span><span class="q-word" aria-hidden="true">・</span><span class="q-role">${i < 2 ? '必要' : 'なくてもよい'}</span>`;
        b.setAttribute('aria-label', `${i + 1}番目（${roleNames[i]}）: 空き`);
        b.tabIndex = -1;
      }
      b.addEventListener('dragover', (e) => { e.preventDefault(); b.classList.add('drag-over'); });
      b.addEventListener('dragleave', () => b.classList.remove('drag-over'));
      b.addEventListener('drop', (e) => {
        e.preventDefault(); b.classList.remove('drag-over');
        const d = e.dataTransfer.getData('text/plain') || '';
        if (d.startsWith('s:')) swap(+d.slice(2), Math.min(i, seq.length - 1));
        else if (d.startsWith('w:')) {
          const wid = d.slice(2);
          if (seq.includes(wid)) return;
          if (i < seq.length) { seq[i] = wid; AU.addWord(i); renderCrafter(i); }
          else addWord(wid);
        }
      });
      wrap.appendChild(b);
    }
    $('btn-clear').disabled = seq.length === 0;
    renderPreview();
    renderRegister();
  }

  // 並べた単語そのものの役割（隠し魔法でも、ここではふつうの役割を見せる）
  function roleTags(words) {
    const tags = [];
    if (words[0]) tags.push(`<span class="p-tag">属性 <b>${MG.ELEMENTS[words[0].elem].label}</b></span>`);
    if (words[1]) tags.push(`<span class="p-tag">形 <b>${MG.FORMS[words[1].form].label}</b></span>`);
    words.slice(2).forEach((w) => tags.push(`<span class="p-tag">効果 <b>${MG.MODS[w.mod].kanji}</b></span>`));
    return tags.join('');
  }
  function areaText(spec) { return spec.secret ? '特大' : spec.areaSize ? `${Math.round(spec.areaSize)}<small>m</small>` : '—'; }
  function bestText(k) { return k && k.best > 0 ? `${Math.round(k.best)}` : '<small>まだ当てていない</small>'; }
  const powerKey = (spec) => (spec.powerShow != null ? spec.powerLabel : '最大ダメージ');
  const powerVal = (spec, k) => (spec.powerShow != null ? spec.powerShow : bestText(k));

  function renderPreview() {
    const el = $('preview');
    const spec = seq.length >= 2 ? MG.buildSpell(seq) : null;
    const key = keyOf(seq);
    el.classList.remove('secret', 'mystery');
    if (!spec) {
      el.style.removeProperty('--c1');
      el.innerHTML = `<div class="p-empty">${seq.length === 0 ? 'ことばのボタンを押して、並べましょう。' : 'もう1つ並べると、魔法になります。'}<br>名前と威力は、練習場で放ってみるまでわかりません。</div>`;
      lastPreviewKey = '';
      return;
    }
    const fresh = key !== lastPreviewKey;
    lastPreviewKey = key;
    const words = seq.map((id) => MG.WORD_MAP[id]);
    const k = save.known[key];
    if (!k) {
      // まだ放っていない魔法: 名前も性能もわからない
      el.classList.add('mystery');
      el.style.setProperty('--c1', MG.ELEMENTS[words[0].elem].c1);
      el.innerHTML = `
        <span class="p-rank">未発動の魔法</span>
        <div class="p-name p-mystery" id="preview-name" aria-label="まだわからない">？？？</div>
        <div class="p-kana" id="preview-kana">放つと名前が明かされます</div>
        <div class="p-tags">${roleTags(words)}</div>
        <div class="stats">
          <div class="stat"><div class="st-k">威力</div><div class="st-v">？？？</div></div>
          <div class="stat"><div class="st-k">消費 MP</div><div class="st-v">？？？</div></div>
          <div class="stat"><div class="st-k">範囲</div><div class="st-v">？？？</div></div>
          <div class="stat"><div class="st-k">待ち時間</div><div class="st-v">？？？</div></div>
        </div>
        <p class="p-hint">スロットに登録して、練習場で放ってみましょう。</p>`;
      return;
    }
    el.classList.toggle('secret', !!spec.secret);
    el.style.setProperty('--c1', spec.colors[0]);
    const chars = Array.from(spec.name.kanji).map((c, i) => `<span style="animation-delay:${fresh ? i * 0.05 : 0}s${fresh ? '' : ';animation-duration:0s'}">${esc(c)}</span>`).join('');
    el.innerHTML = `
      ${spec.secret ? '<div class="secret-badge">★ 隠し魔法</div>' : ''}
      <span class="p-rank">${esc(spec.name.rank)}${spec.destroy ? ' ・ 破壊' : ''}</span>
      <div class="p-name" id="preview-name" aria-label="${esc(spec.name.kanji)}">${chars}</div>
      <div class="p-kana" id="preview-kana">${esc(spec.name.kana)}</div>
      <div class="p-tags"><span class="p-tag">属性 <b>${MG.ELEMENTS[spec.element].label}</b></span><span class="p-tag">形 <b>${spec.secret ? '特殊' : MG.FORMS[spec.form].label}</b></span>${spec.mods.map((m) => `<span class="p-tag">効果 <b>${MG.MODS[m].kanji}</b></span>`).join('')}</div>
      <div class="stats">
        <div class="stat"><div class="st-k">${powerKey(spec)}</div><div class="st-v" id="stat-power">${powerVal(spec, k)}</div></div>
        <div class="stat"><div class="st-k">消費 MP</div><div class="st-v" id="stat-cost">${spec.cost}</div></div>
        <div class="stat"><div class="st-k">範囲</div><div class="st-v">${areaText(spec)}</div></div>
        <div class="stat"><div class="st-k">待ち時間</div><div class="st-v">${spec.cd.toFixed(1)}<small>秒</small></div></div>
      </div>
      <p class="p-sum">${esc(spec.summary)}</p>
      <p class="p-sub">最大貫通（壁）: <b>${pierceText(k)}</b> ・ 唱え方: 「<b>${esc(spec.name.kana)}</b>」</p>
      <ul class="desc">${spec.desc.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>`;
  }
  function pierceText(k) { return k && k.pierce > 0 ? `${k.pierce}枚` : '—'; }

  function renderRegister() {
    const wrap = $('register-btns');
    const ok = seq.length >= 2;
    wrap.innerHTML = '';
    const w = MG.WAND_MAP[st.wand];
    document.querySelector('.register-label').textContent = st.wand === 'bare' ? 'スロットに登録して使う' : `スロットに登録して使う（${w.name}・${w.slots}つ）`;
    if (!st.slots.length) { wrap.innerHTML = '<p class="reg-bare">素手のときはスロットがありません。杖を持つと登録できます（T キー）。素手では、魔法は詠唱で放ちます。</p>'; return; }
    wrap.style.gridTemplateColumns = `repeat(${Math.min(st.slots.length, 5)}, minmax(0, 1fr))`;
    for (let i = 0; i < st.slots.length; i++) {
      const s = st.slots[i];
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'reg-btn';
      b.disabled = !ok;
      const same = ok && s && keyOf(s.seq) === keyOf(seq);
      if (same) b.classList.add('done');
      const nm = !s ? '（空き）' : isKnown(s.seq) ? s.name.kanji : '？？？（未発動）';
      b.innerHTML = `<b>スロット ${i + 1}${same ? ' ✓' : ''}</b><span>${esc(nm)}</span>`;
      b.setAttribute('aria-label', `スロット${i + 1}に登録（今は${nm}）`);
      b.addEventListener('click', () => registerTo(i));
      wrap.appendChild(b);
    }
  }

  function registerTo(i, s) {
    const target = s || seq;
    if (target.length < 2) return;
    if (st.wand === 'bare' || i >= st.slots.length) { toast('素手のときはスロットに入れられません。杖を持ってください（T キー）'); AU.error(); return; }
    if (G.isSealed(target)) { toast(`${target.length}語の魔法は、まだ封印されています（Lv${MG.RPG.sealLevel(target.length)} で解ける）`); AU.error(); return; }
    G.setSlot(i, target);
    save.wandSlots[st.wand][i] = target.slice();
    if (st.wand === 'novice') save.slots[i] = target.slice();
    persist();
    G.selectSlot(i);
    AU.register();
    const known = isKnown(target);
    toast(known ? `「${st.slots[i].name.kanji}」をスロット${i + 1}に登録しました` : `スロット${i + 1}に登録しました。練習場で放つと名前がわかります`);
    if (current === 'crafter') {
      renderRegister();
      const btn = document.querySelectorAll('.reg-btn')[i];
      if (btn) btn.focus();
    }
    if (current === 'book') renderBookDetail();
    renderSlots();
  }

  $('btn-clear').addEventListener('click', () => { seq = []; AU.removeWord(); renderCrafter(); const f = nextChip(MG.WORDS[MG.WORDS.length - 1].id); if (f) f.focus(); });

  // ======================================================================
  //  図鑑（一覧 + くわしい表示）
  // ======================================================================
  // タブ: r2 / r3 / r4（ことばの数＝初級・中級・上級）と secret（隠し魔法）
  const BOOK_TABS = ['r2', 'r3', 'r4', 'secret'];
  const RANK_NAME = { r2: '初級魔法（2語）', r3: '中級魔法（3語）', r4: '上級魔法（4語）' };
  let bookTab = 'r2', bookSel = null;
  const bookFilter = { kind: 'all', elem: '', sort: 'new' };
  function madeEntries() {
    return Object.keys(save.known).map((k) => ({ key: k, seq: k.split('|'), k: save.known[k], spec: MG.buildSpell(k.split('|')) }))
      .filter((e) => e.spec).sort((a, b) => (b.k.t || 0) - (a.k.t || 0));
  }
  const tabOf = (e) => (e.spec.secret ? 'secret' : 'r' + e.seq.length);
  const isSupport = (spec) => !!spec.support;
  const powerOf = (e) => (e.spec.support === 'ward' || e.spec.support === 'heal' ? e.spec.dmg : e.k.best || 0); // 飛翔・纏いは、纏いで与えた実測のダメージ（飛翔は 0）
  function sortEntries(list) {
    const by = {
      new: (a, b) => (b.k.t || 0) - (a.k.t || 0),
      power: (a, b) => powerOf(b) - powerOf(a),
      use: (a, b) => (b.k.casts || 0) - (a.k.casts || 0),
      name: (a, b) => a.spec.name.kana.localeCompare(b.spec.name.kana, 'ja'),
    }[bookFilter.sort] || ((a, b) => 0);
    return list.slice().sort(by);
  }
  function rowRight(e) {
    if (e.spec.support === 'ward') return `<small>吸収</small>${Math.round(e.spec.dmg)}`;
    if (e.spec.support === 'heal') return `<small>回復</small>${Math.round(e.spec.dmg)}`;
    if (e.spec.support === 'fly') return `<small>飛翔</small>${e.spec.powerShow}`;
    if (e.spec.support === 'aura') return `<small>速さ</small>${e.spec.powerShow}`;
    return e.k.best > 0 ? `${Math.round(e.k.best)}` : '—';
  }
  function renderBook() {
    const made = madeEntries();
    const found = save.secrets.length, total = MG.SECRETS.length;
    const elems = new Set(made.map((e) => e.spec.element)).size;
    ['r2', 'r3', 'r4'].forEach((t) => { $('count-' + t).textContent = made.filter((e) => tabOf(e) === t).length; });
    $('count-secret').textContent = `${found}/${total}`;
    $('book-progress').innerHTML = `
      <div class="bp-item"><span class="bp-k">発動した魔法</span><span class="bp-v">${made.length}<small>種</small></span></div>
      <div class="bp-item"><span class="bp-k">隠し魔法</span><span class="bp-v">${found}<small>/ ${total}</small></span><span class="bp-bar"><span style="width:${(found / total) * 100}%"></span></span></div>
      <div class="bp-item"><span class="bp-k">見つけた属性</span><span class="bp-v">${elems}<small>/ ${Object.keys(MG.ELEMENTS).length}</small></span></div>`;
    BOOK_TABS.forEach((t) => { const b = $('tab-' + t); b.setAttribute('aria-selected', bookTab === t ? 'true' : 'false'); b.classList.toggle('on', bookTab === t); b.tabIndex = bookTab === t ? 0 : -1; });
    $('book-list').setAttribute('aria-labelledby', 'tab-' + bookTab);
    const list = $('book-list');
    const tools = $('book-tools');
    tools.hidden = bookTab === 'secret';
    let rows = [];
    if (bookTab !== 'secret') {
      const inTab = made.filter((e) => tabOf(e) === bookTab);
      // 属性の選択肢: このタブにある属性だけ
      const els = [...new Set(inTab.map((e) => e.spec.element))];
      if (bookFilter.elem && !els.includes(bookFilter.elem)) bookFilter.elem = '';
      $('bt-elem').innerHTML = '<option value="">すべての属性</option>' + els.map((id) => `<option value="${id}"${id === bookFilter.elem ? ' selected' : ''}>${esc(MG.ELEMENTS[id].label)}</option>`).join('');
      $('bt-sort').value = bookFilter.sort;
      tools.querySelectorAll('[data-kind]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.kind === bookFilter.kind ? 'true' : 'false'));
      const shown = sortEntries(inTab.filter((e) => (bookFilter.kind === 'all' || (bookFilter.kind === 'support') === isSupport(e.spec)) && (!bookFilter.elem || e.spec.element === bookFilter.elem)));
      if (!inTab.length) { list.innerHTML = `<p class="empty-note">まだ${RANK_NAME[bookTab]}はありません。<br>魔法工房でことばを ${bookTab.slice(1)} つ並べ、練習場で放つと、ここに記録されます。</p>`; $('book-detail').innerHTML = ''; bookSel = null; return; }
      if (!shown.length) { list.innerHTML = '<p class="empty-note">条件に合う魔法がありません。絞りこみを「すべて」に戻してください。</p>'; $('book-detail').innerHTML = ''; bookSel = null; return; }
      const favs = shown.filter((e) => save.fav[e.key]), rest = shown.filter((e) => !save.fav[e.key]);
      const toRow = (e) => ({ id: e.key, sealed: G.isSealed(e.seq), name: e.spec.name.kanji, fav: !!save.fav[e.key], sub: `${MG.ELEMENTS[e.spec.element].label} ・ ${MG.FORMS[e.spec.form].label}${e.spec.shape && MG.WARD_SHAPES[e.spec.shape] ? `（${MG.WARD_SHAPES[e.spec.shape].label}）` : e.spec.summonType && MG.SUMMONS[e.spec.summonType] ? `（${MG.SUMMONS[e.spec.summonType].label}）` : ''}`, right: rowRight(e), c1: e.spec.colors[0], c2: e.spec.colors[1], support: isSupport(e.spec), inSlot: (st.slots || []).some((x) => x && keyOf(x.seq) === e.key) });
      if (favs.length) rows.push({ head: '★ お気に入り' }, ...favs.map(toRow));
      if (favs.length && rest.length) rows.push({ head: 'そのほか' });
      rows.push(...rest.map(toRow));
    } else {
      rows = MG.SECRETS.map((s) => {
        const ok = save.secrets.includes(s.id); const E = MG.ELEMENTS[s.elem];
        return { id: 'secret:' + s.id, sealed: ok && G.isSealed(s.seq), name: ok ? s.kanji : '？？？', sub: ok ? `禁呪 ・ ${s.seq.length}語` : `未発見 ・ ${s.seq.length}語`, right: ok ? '★' : '', c1: ok ? E.c1 : '#3c4062', c2: ok ? E.c2 : '#2a2e48', locked: !ok, fav: false };
      });
    }
    const items = rows.filter((r) => !r.head);
    // 封印中の魔法は選べない（薄暗く表示し、「封印」の札を付ける）
    const pickable = items.filter((it) => !it.sealed);
    if (!bookSel || !pickable.some((it) => it.id === bookSel)) bookSel = pickable.length ? pickable[0].id : null;
    list.innerHTML = `<div class="bl-head"><span>名前</span><span>${bookTab === 'secret' ? '' : '最大ダメージ'}</span></div>` + rows.map((it) => it.head ? `<div class="bl-group">${esc(it.head)}</div>` : `
      <button type="button" class="bl-row${it.locked ? ' locked' : ''}${it.sealed ? ' sealed' : ''}${it.id === bookSel ? ' on' : ''}" data-id="${esc(it.id)}" style="--c1:${it.c1};--c2:${it.c2}" aria-pressed="${it.id === bookSel}"${it.sealed ? ` disabled aria-disabled="true" title="封印中（Lv${MG.RPG.sealLevel(it.id.startsWith('secret:') ? MG.SECRETS.find((x) => 'secret:' + x.id === it.id).seq.length : it.id.split('|').length)} で解ける）"` : ''}>
        <span class="bl-main"><span class="bl-name">${it.fav ? '<span class="bl-fav" aria-label="お気に入り">★</span>' : ''}${esc(it.name)}${it.sealed ? '<span class="bl-seal">封印</span>' : ''}</span><span class="bl-sub">${esc(it.sub)}${it.support ? '<span class="bl-tag sup">守り・回復・移動</span>' : ''}${it.inSlot ? '<span class="bl-tag in-slot">スロット</span>' : ''}</span></span>
        <span class="bl-right">${it.right}</span>
      </button>`).join('');
    renderBookDetail();
  }

  function seqDiagram(s) {
    const names = ['属性', '形', '効果', '効果'];
    return `<ol class="bd-seq">${s.map((id, i) => {
      const w = MG.WORD_MAP[id];
      const role = i === 0 ? MG.ELEMENTS[w.elem].label : i === 1 ? MG.FORMS[w.form].label : MG.MODS[w.mod].kanji;
      return `<li style="--c1:${MG.ELEMENTS[w.elem].c1}"><span class="bd-pos">${i + 1}. ${names[i]}</span><span class="bd-word">${w.label}</span><span class="bd-role">→ ${esc(role)}</span></li>`;
    }).join('')}</ol>`;
  }
  function slotPicker(s) {
    if (!st.slots.length) return '<div class="bd-slots-label">スロットに入れる</div><p class="reg-bare">素手のときはスロットがありません（T キーで杖を持つ）</p>';
    return `<div class="bd-slots-label">スロットに入れる（${esc(MG.WAND_MAP[st.wand].name)}）</div><div class="bd-slots" style="grid-template-columns: repeat(${Math.min(st.slots.length, 5)}, minmax(0, 1fr))">${st.slots.map((_, i) => i).map((i) => {
      const cur = st.slots[i];
      const same = cur && keyOf(cur.seq) === keyOf(s);
      const nm = !cur ? '空き' : isKnown(cur.seq) ? cur.name.kanji : '？？？';
      return `<button type="button" class="bd-slot${same ? ' done' : ''}" data-reg="${i}" aria-label="スロット${i + 1}に入れる（今: ${esc(nm)}）"><b>スロット ${i + 1}${same ? ' ✓' : ''}</b><span>今: ${esc(nm)}</span></button>`;
    }).join('')}</div>`;
  }

  function renderBookDetail() {
    const el = $('book-detail');
    if (!bookSel) { el.innerHTML = '<p class="empty-note">このタブの魔法は、すべて封印されています。レベルを上げると封印が解けます。</p>'; return; }
    if (bookSel.startsWith('secret:')) {
      const s = MG.SECRETS.find((x) => 'secret:' + x.id === bookSel);
      if (!save.secrets.includes(s.id) || !save.known[keyOf(s.seq)]) {
        el.style.setProperty('--c1', '#5a5f88');
        el.innerHTML = `<div class="bd-rank">未発見の隠し魔法</div><div class="bd-name locked">？？？</div>
          <div class="bd-hint"><b>ヒント</b><p>${esc(s.hint)}</p></div>
          <p class="bd-note">決まった ${s.seq.length} つのことばを、決まった順番で並べて放つと発見できます。</p>`;
        return;
      }
      showSpellDetail(s.seq, el);
      return;
    }
    showSpellDetail(bookSel.split('|'), el);
  }
  function showSpellDetail(s, el) {
    const spec = MG.buildSpell(s);
    const key = keyOf(s);
    const k = save.known[key];
    if (!spec || !k) { el.innerHTML = ''; return; }
    el.style.setProperty('--c1', spec.colors[0]);
    const fav = !!save.fav[key];
    const sup = spec.powerShow != null;
    el.innerHTML = `
      <div class="bd-top">
        <div class="bd-rank">${esc(spec.name.rank)} ・ ${esc(MG.ELEMENTS[spec.element].label)}属性${spec.secret ? ' ・ 隠し魔法' : ''}</div>
        <button type="button" class="bd-fav${fav ? ' on' : ''}" data-fav="${esc(key)}" aria-pressed="${fav}" title="お気に入り（一覧のいちばん上に出す）">${fav ? '★ お気に入り' : '☆ お気に入りにする'}</button>
      </div>
      <div class="bd-name">${esc(spec.name.kanji)}</div>
      <div class="bd-kana">${esc(spec.name.kana)}</div>
      <p class="bd-sum">${esc(spec.summary)}</p>
      <div class="bd-traits">${spec.traits.map((t) => `<span class="bd-trait${t === '地形を壊す' ? ' destroy' : ''}">${esc(t)}</span>`).join('')}</div>
      <div class="bd-stats main">
        <div><span>${sup ? esc(spec.powerLabel) : '最大ダメージ<small>（実測）</small>'}</span><b id="bd-best">${powerVal(spec, k)}</b></div>
        <div><span>消費 MP</span><b>${spec.cost}</b></div>
        <div><span>待ち時間</span><b>${spec.cd.toFixed(1)}<small>秒</small></b></div>
      </div>
      <div class="bd-label">ことばの並び</div>
      ${seqDiagram(s)}
      <div class="bd-how">
        <div class="bd-how-row"><span class="bd-how-k">唱える</span><b>「${esc(spec.name.kana)}」</b></div>
        ${MG.Draw ? `<div class="bd-how-row bd-draw"><span class="bd-how-k">紋章</span><span class="bd-glyphs">${s.map((id) => MG.Draw.svg(id, 26)).join('<span class="gl-plus">＋</span>')}</span><span class="bd-how-note">→ 左クリック</span></div>` : ''}
      </div>
      <details class="bd-more">
        <summary>くわしく（範囲・発動回数・くわしい説明）</summary>
        <div class="bd-stats">
          <div><span>範囲</span><b>${areaText(spec)}</b></div>
          <div><span>発動回数</span><b>${k.casts || 0}<small>回</small></b></div>
          <div><span>最大貫通<small>（壁）</small></span><b id="bd-pierce">${pierceText(k)}</b></div>
        </div>
        <ul class="desc">${spec.desc.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>
        <p class="bd-note">唱えるとき: 漢字の名前「${esc(spec.name.kanji)}」でもよい。杖なら多少の言い間違いも通り、素手は一字一句そのまま。</p>
      </details>
      ${slotPicker(s)}
      <button type="button" class="btn-secondary bd-open" data-open="${esc(key)}">工房でこの並びを開く</button>`;
  }

  BOOK_TABS.forEach((t) => $('tab-' + t).addEventListener('click', () => { if (bookTab === t) return; bookTab = t; bookSel = null; AU.click(); renderBook(); }));
  $('book').addEventListener('keydown', (e) => {
    if (e.target.getAttribute('role') === 'tab' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault();
      const i = (BOOK_TABS.indexOf(bookTab) + (e.key === 'ArrowRight' ? 1 : BOOK_TABS.length - 1)) % BOOK_TABS.length;
      bookTab = BOOK_TABS[i]; bookSel = null; renderBook(); $('tab-' + bookTab).focus();
    }
  });
  // 絞りこみ・並べ替え
  $('book-tools').addEventListener('click', (e) => {
    const b = e.target.closest('[data-kind]'); if (!b) return;
    bookFilter.kind = b.dataset.kind; bookSel = null; AU.click(); renderBook();
  });
  $('bt-elem').addEventListener('change', (e) => { bookFilter.elem = e.target.value; bookSel = null; renderBook(); });
  $('bt-sort').addEventListener('change', (e) => { bookFilter.sort = e.target.value; bookSel = null; renderBook(); });
  $('book').addEventListener('click', (e) => {
    const row = e.target.closest('.bl-row');
    if (row && (row.disabled || row.classList.contains('sealed'))) return;
    if (row) {
      bookSel = row.dataset.id; AU.click();
      document.querySelectorAll('.bl-row').forEach((r) => { r.classList.toggle('on', r === row); r.setAttribute('aria-pressed', r === row ? 'true' : 'false'); });
      renderBookDetail();
      if (window.innerWidth < 760) $('book-detail').scrollIntoView({ block: 'start', behavior: 'smooth' });
      return;
    }
    const r = e.target.closest('[data-reg]');
    if (r) {
      const s = bookSel.startsWith('secret:') ? MG.SECRETS.find((x) => 'secret:' + x.id === bookSel).seq : bookSel.split('|');
      registerTo(+r.dataset.reg, s);
      const again = document.querySelector(`#book-detail [data-reg="${r.dataset.reg}"]`); if (again) again.focus();
      return;
    }
    const f = e.target.closest('[data-fav]');
    if (f) {
      // お気に入り（★）の切り替え: 一覧のいちばん上に出す
      const key = f.dataset.fav;
      if (save.fav[key]) delete save.fav[key]; else save.fav[key] = true;
      persist(); AU.click(); renderBook();
      const again = document.querySelector('#book-detail [data-fav]'); if (again) again.focus();
      return;
    }
    const o = e.target.closest('[data-open]');
    if (o) { seq = o.dataset.open.split('|'); AU.click(); open('crafter'); }
  });

  // ======================================================================
  //  メニュー・昼夜・チャレンジ
  // ======================================================================
  // 本物の物理（Jolt）とエフェクト（Effekseer）の状態
  function engineText() {
    const e = G.engines || {};
    if (location.protocol === 'file:') return { ok: false, text: 'index.html を直接開いているため、本物の物理とエフェクトはオフです（start.bat から開くと有効になります）' };
    if (e.phys === 'loading' || e.efk === 'loading') return { ok: false, text: '本物の物理とエフェクトを読み込んでいます…' };
    const p = e.phys === 'on', f = e.efk === 'on';
    if (p && f) return { ok: true, text: '本物の物理（Jolt）とエフェクト（Effekseer）: 有効' };
    return { ok: false, text: `物理: ${p ? '有効' : '読み込めませんでした'} ／ エフェクト: ${f ? '有効' : '読み込めませんでした'}（読み込めなかったものは簡易版で動きます）` };
  }
  function renderEngines() {
    const r = engineText();
    const el = $('engine-status'); el.textContent = r.text; el.classList.toggle('on', r.ok);
    $('menu-engine').textContent = r.text;
  }
  function renderMenu() {
    $('best-score').textContent = save.best ? `最高 ${save.best.toLocaleString()} 点` : '';
    $('sens').value = save.sens;
    const on = AU.enabled;
    $('btn-sound').setAttribute('aria-pressed', on ? 'true' : 'false');
    $('btn-sound').textContent = on ? 'オン' : 'オフ';
    document.querySelectorAll('[data-time]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.time === save.time ? 'true' : 'false'));
    document.querySelectorAll('[data-shake]').forEach((b) => b.setAttribute('aria-pressed', +b.dataset.shake === save.shake ? 'true' : 'false'));
    $('btn-pad').setAttribute('aria-pressed', save.pad ? 'true' : 'false');
    $('btn-pad').textContent = save.pad ? 'オン' : 'オフ';
    const name = H.padName();
    $('pad-status').textContent = name ? `接続中: ${name.replace(/\(.*$/, '').trim().slice(0, 40)}${H.padCanRumble() ? '' : '（このパッドは振動に対応していません）'}` : 'ゲームパッドは接続されていません（つないでボタンを1回押すと認識されます）';
    $('btn-voice-menu').setAttribute('aria-pressed', V.wanted ? 'true' : 'false');
    $('btn-voice-menu').textContent = V.wanted ? 'オン' : 'オフ';
    $('btn-voice-menu').disabled = !V.supported;
    $('bgm-vol').value = save.bgm;
    $('btn-bgm').setAttribute('aria-pressed', save.bgmOn ? 'true' : 'false');
    $('btn-bgm').textContent = save.bgmOn ? 'オン' : 'オフ';
    const fsOn = !!document.fullscreenElement;
    $('btn-full-menu').setAttribute('aria-pressed', fsOn ? 'true' : 'false');
    $('btn-full-menu').textContent = fsOn ? 'オン' : 'オフ';
  }
  function setTime(mode, instant) {
    save.time = mode === 'day' ? 'day' : 'night';
    W.setTime(save.time, instant);
    AU.setMood(save.time === 'day' ? 0 : 1);
    persist();
    $('btn-time-label').textContent = save.time === 'day' ? '夜にする' : '昼にする';
    $('btn-time').setAttribute('aria-label', `昼と夜を切り替える（今は${save.time === 'day' ? '昼' : '夜'}）`);
    if (current === 'menu') renderMenu();
  }
  $('btn-time').addEventListener('click', () => { AU.click(); setTime(save.time === 'day' ? 'night' : 'day'); toast(save.time === 'day' ? '昼の練習場' : '夜の練習場'); if (!G.isTouch()) G.lockPointer(); });
  document.querySelectorAll('[data-time]').forEach((b) => b.addEventListener('click', () => { AU.click(); setTime(b.dataset.time); }));
  $('bgm-vol').addEventListener('input', (e) => { save.bgm = +e.target.value; AU.setBgmVolume(save.bgm); persistSoon(); });
  $('btn-bgm').addEventListener('click', () => { save.bgmOn = !save.bgmOn; AU.setBgmEnabled(save.bgmOn); persist(); renderMenu(); });

  // 全画面
  function renderFull() {
    const on = !!document.fullscreenElement;
    $('btn-full-label').textContent = on ? '全画面を解除' : '全画面';
    $('btn-full').setAttribute('aria-pressed', on ? 'true' : 'false');
    if (current === 'menu') renderMenu();
  }
  function toggleFullscreen() {
    const el = document.documentElement;
    if (!document.fullscreenElement) {
      if (!el.requestFullscreen) { toast('このブラウザは全画面に対応していません（F11 キーでも全画面にできます）', 3500); return; }
      const p = el.requestFullscreen({ navigationUI: 'hide' });
      if (p && p.then) p.then(() => { if (!current && !G.isTouch()) G.lockPointer(); }).catch(() => toast('全画面にできませんでした（F11 キーでも全画面にできます）', 3500));
    } else if (document.exitFullscreen) {
      const p = document.exitFullscreen(); if (p && p.catch) p.catch(() => {});
    }
  }
  $('btn-full').addEventListener('click', () => { AU.click(); toggleFullscreen(); });
  $('btn-full-menu').addEventListener('click', () => { AU.click(); toggleFullscreen(); });
  document.addEventListener('fullscreenchange', renderFull);
  $('btn-reset-terrain').addEventListener('click', () => { W.resetTerrain(); AU.register(); toast('地形を元に戻しました'); });
  document.querySelectorAll('[data-shake]').forEach((b) => b.addEventListener('click', () => {
    save.shake = +b.dataset.shake; H.setScale(save.shake); persist(); renderMenu();
    if (save.shake > 0) H.shake('earth', 0.6, 0.35);
  }));
  $('btn-pad').addEventListener('click', () => { save.pad = !save.pad; H.setPadEnabled(save.pad); persist(); renderMenu(); });
  $('btn-pad-test').addEventListener('click', () => {
    const n = H.rumble('earth', 0.9);
    setTimeout(() => H.rumble('lightning', 0.8), 600);
    toast(n ? 'ゲームパッドを振動させました（岩 → 雷）' : (save.pad ? 'ゲームパッドが見つかりません。つないでボタンを1回押してください' : 'ゲームパッドの振動はオフです'));
  });
  window.addEventListener('gamepadconnected', (e) => { toast(`ゲームパッドを認識しました。魔法に合わせて振動します`); if (current === 'menu') renderMenu(); });
  window.addEventListener('gamepaddisconnected', () => { if (current === 'menu') renderMenu(); });

  // ======================================================================
  //  声で唱える
  // ======================================================================
  const voiceBox = $('voice-box');
  let voiceHideTimer = 0;
  function voiceMsg(html, cls, ms) {
    voiceBox.innerHTML = html; voiceBox.className = 'voice-box show ' + (cls || '');
    clearTimeout(voiceHideTimer);
    if (ms) voiceHideTimer = setTimeout(() => { if (V.listening) voiceMsg(LISTEN_MSG, 'idle'); else voiceBox.className = 'voice-box'; }, ms);
  }
  const LISTEN_MSG = '<span class="vb-mic"></span>聞いています… 魔法の名前を唱えてください（V キーで止める）';
  function renderVoiceBtn() {
    const b = $('btn-voice');
    b.classList.toggle('on', V.wanted);
    b.classList.toggle('live', V.listening);
    b.setAttribute('aria-pressed', V.wanted ? 'true' : 'false');
    $('btn-voice-label').textContent = V.wanted ? '詠唱オン' : '詠唱';
    b.disabled = !V.supported;
    b.title = V.supported ? '声で唱えて魔法を放つ（V キーでオン・オフ）' : 'このブラウザは音声認識に対応していません';
    if (current === 'menu') renderMenu();
  }
  const isFile = location.protocol === 'file:';
  let fileNoticeShown = false;
  function voiceToggle() {
    if (!V.supported) { toast('このブラウザは音声認識に対応していません（Edge か Chrome を使ってください）', 3500); AU.error(); return; }
    if (V.wanted) { V.stop(); AU.micOff(); voiceMsg('詠唱を止めました', 'idle', 1500); renderVoiceBtn(); return; }
    if (!save.voiceOk) { open('voice-consent'); return; }
    if (isFile && !fileNoticeShown) { fileNoticeShown = true; toast('index.html を直接開いているため、聞き取りが止まるたびに V キーで聞き直す必要があります（そのつど許可を聞かれます）。start.bat から開くと自動で聞き続けます', 7000); }
    V.start(); AU.micOn();
    voiceMsg('<span class="vb-mic"></span>マイクを準備しています…', 'idle');
    renderVoiceBtn();
  }
  $('btn-voice').addEventListener('click', () => { voiceToggle(); if (!G.isTouch() && !current) G.lockPointer(); });
  $('btn-voice-menu').addEventListener('click', voiceToggle);
  $('btn-voice-ok').addEventListener('click', () => { save.voiceOk = true; persist(); close(); voiceToggle(); });
  V.onState = (live) => { renderVoiceBtn(); if (live) voiceMsg(LISTEN_MSG, 'idle'); };
  V.onEnded = (why) => {
    renderVoiceBtn();
    voiceMsg(why === 'file' ? '聞き取りが止まりました。V キーでもう一度聞きます（start.bat から開くと自動で聞き続けます）' : '音声認識が止まりました。V キーでもう一度始めてください', 'error', 6000);
  };
  // 唱えられる魔法: 一度でも放って名前がわかっているもの。読みが同じ魔法があるときは、今の杖のスロットにある魔法 → 最近放った魔法を優先する
  const nameCandidates = () => {
    const slotKeys = (st.slots || []).filter(Boolean).map((s) => keyOf(s.seq)).filter((k, i, a) => save.known[k] && a.indexOf(k) === i);
    const rest = Object.keys(save.known).filter((k) => !slotKeys.includes(k)).sort((a, b) => (save.known[b].last || save.known[b].t || 0) - (save.known[a].last || save.known[a].t || 0));
    return slotKeys.concat(rest).map((k) => k.split('|'));
  };
  const drawing = () => !!(MG.Draw && MG.Draw.count() > 0); // 紋章を重ねている間は、目の前の魔法陣を声で上書きしない
  V.onInterim = (text) => {
    const strict = st.wand === 'bare';
    const m = V.matchName(text, nameCandidates(), strict);
    const hit = m.miss ? null : m, guess = hit || m.near;
    if (!drawing()) G.chantBuild({ words: guess ? guess.seq : [], need: !hit, progress: 0 });
    const hint = guess ? ` → 「${esc(guess.spec.name.kana)}」${hit ? '' : '？'}` : '';
    voiceMsg(`<span class="vb-mic"></span>聞き取り中: <b>${esc(text)}</b>${hint}`, 'interim');
  };
  V.onError = (err) => {
    const msg = {
      unsupported: 'このブラウザは音声認識に対応していません（Edge か Chrome を使ってください）',
      'not-allowed': 'マイクの使用が許可されていません。アドレスバーのマイクのアイコンから許可してください',
      'service-not-allowed': 'マイクの使用が許可されていません。アドレスバーのマイクのアイコンから許可してください',
      'audio-capture': 'マイクが見つかりません。マイクがつながっているか確認してください',
      network: '音声認識にはインターネット接続が必要です',
      'start-failed': '音声認識を始められませんでした',
    }[err] || '音声認識でエラーが起きました（' + err + '）';
    voiceMsg(esc(msg), 'error', 4000);
    renderVoiceBtn();
  };
  // 聞き取った文（候補がいくつか届く）から、名前で唱えた魔法を放つ
  function onVoiceFinal(alts) {
    let first = null;
    const strict = st.wand === 'bare';
    const cands = nameCandidates();
    for (const text of alts) {
      const r = V.parse(text, cands, { strict });
      if (!first) first = { text, r };
      if (!r.seq) continue;
      AU.heard();
      if (!drawing()) G.chantBuild({ words: r.seq });
      const res = G.castSeq(r.seq);
      const spec = MG.buildSpell(r.seq);
      const said = `「${esc(spec.name.kana)}」`;
      const mode = strict ? '素手の詠唱・効果 150%' : '詠唱・効果 70%';
      if (!drawing()) G.chantBuild({ state: res === 'ok' ? 'done' : 'fail' });
      if (res === 'ok') voiceMsg(`詠唱: <b>${said}</b> <span class="vb-ok">発動！</span> <small>（${mode}）</small>`, 'ok', 2200);
      else if (res === 'mp') voiceMsg(`詠唱: ${said} … MP が足りません`, 'error', 2200);
      else if (res === 'cooldown') voiceMsg(`詠唱: ${said} … まだ唱えられません（待ち時間）`, 'error', 1800);
      else if (res === 'paused') voiceMsg(`詠唱: ${said} … 練習場に戻ってから唱えてください`, 'error', 2200);
      return { ok: res === 'ok', res, seq: r.seq, by: r.by };
    }
    if (first) { if (!drawing()) G.chantBuild({ state: 'fail' }); voiceMsg(`「${esc(first.text)}」<br>${esc(first.r.error)}`, 'error', 3200); }
    return { ok: false, error: first && first.r.error };
  }
  V.onFinal = onVoiceFinal;
  $('sens').addEventListener('input', (e) => { save.sens = +e.target.value; persist(); });
  function setSound(v) {
    AU.setEnabled(v); save.sound = v; persist();
    if (current === 'menu') renderMenu();
    toast(v ? '音: オン' : '音: オフ');
  }
  $('btn-sound').addEventListener('click', () => setSound(!AU.enabled));
  $('menu-craft').addEventListener('click', () => { AU.click(); open('crafter'); });
  $('menu-book').addEventListener('click', () => { AU.click(); open('book'); });
  $('menu-wands').addEventListener('click', () => { AU.click(); open('wands'); });

  // ======================================================================
  //  杖をえらぶ
  // ======================================================================
  let lastCastMode = null;
  const fmt = (v) => (v === 1 ? '×1' : '×' + v);
  function wandStats(w) {
    const row = (k, v, good) => `<div class="ws"><span>${k}</span><b class="${good == null ? '' : good ? 'up' : 'down'}">${v}</b></div>`;
    if (w.id === 'bare') return row('スロット', 'なし', false) + row('効果', '×1.5', true) + row('MP', '×1.6', false) + row('使い方', '詠唱のみ', null);
    return row('スロット', w.slots + ' つ', w.slots > 4 ? true : w.slots < 4 ? false : null)
      + row('威力', fmt(w.dmg), w.dmg > 1 ? true : w.dmg < 1 ? false : null)
      + row('MP', fmt(w.cost), w.cost < 1 ? true : w.cost > 1 ? false : null)
      + row('待ち時間', fmt(w.cd), w.cd < 1 ? true : w.cd > 1 ? false : null)
      + row('貫通力', w.pen ? '+' + w.pen : '±0', w.pen ? true : null)
      + row('弾の速さ', fmt(w.speed), w.speed > 1 ? true : null);
  }
  function renderWands() {
    const all = MG.WANDS.concat([MG.BARE]);
    $('wand-list').innerHTML = all.map((w) => {
      const on = st.wand === w.id;
      if (!G.ownsWand(w.id)) {
        return `<article class="wand-card locked" style="--gem:${w.gem || '#bfe6ff'}">
          <div class="wc-head"><span class="wc-gem" aria-hidden="true"></span><h3>${esc(w.name)}</h3></div>
          <p class="wc-desc">${esc(w.desc)}</p>
          <div class="wc-stats">${wandStats(w)}</div>
          <p class="wc-price">街の杖の店で買える（${(MG.RPG.WAND_PRICE[w.id] || 0).toLocaleString()} G）</p>
          <button type="button" class="btn-secondary wc-btn" disabled>まだ持っていない</button>
        </article>`;
      }
      return `<article class="wand-card${on ? ' on' : ''}" style="--gem:${w.gem || '#bfe6ff'}">
        <div class="wc-head"><span class="wc-gem" aria-hidden="true"></span><h3>${esc(w.name)}</h3>${on ? '<span class="wc-on">持っている</span>' : ''}</div>
        <p class="wc-desc">${esc(w.desc)}</p>
        ${w.look ? `<p class="wc-look">見た目: ${esc(w.look)}</p>` : ''}
        <div class="wc-stats">${wandStats(w)}</div>
        <button type="button" class="${on ? 'btn-secondary' : 'btn-primary'} wc-btn" data-wand="${w.id}" ${on ? 'aria-pressed="true"' : ''}>${on ? '持っている' : w.id === 'bare' ? '素手になる' : 'この杖を持つ'}</button>
      </article>`;
    }).join('');
  }
  $('wand-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-wand]'); if (!b) return;
    const id = b.dataset.wand;
    if (id === st.wand) return;
    G.setWand(id); save.wand = id; persist();
    AU.register();
    toast(id === 'bare' ? '素手になりました。魔法は詠唱（V キー）か紋章で放ちます' : `${MG.WAND_MAP[id].name}を持ちました`);
    renderWands();
    const again = document.querySelector(`[data-wand="${id}"]`); if (again) again.focus();
  });
  $('btn-wands').addEventListener('click', () => { AU.click(); open('wands'); });
  function renderWandChip() {
    const w = MG.WAND_MAP[st.wand];
    $('wand-chip').innerHTML = st.wand === 'bare'
      ? '<b>素手</b> ・ 詠唱（V キー）と紋章のみ ・ 効果 ×1.5 ・ MP ×1.6'
      : `<span class="wc-gem" style="--gem:${w.gem}"></span><b>${esc(w.name)}</b> ・ スロットは無詠唱で各 ${MG.SLOT_CHARGES} 回（隠し魔法は ${MG.SECRET_CHARGES} 回） ・ 詠唱は効果 ×0.7`;
  }
  function startChallenge() {
    if (G.match && G.match.on) { toast('対戦中は 60 秒チャレンジを始められません'); return; }
    close();
    G.startChallenge(60);
    AU.start();
    toast('60秒チャレンジ開始！ 的をどんどん壊そう', 2600);
  }
  $('btn-challenge').addEventListener('click', startChallenge);
  $('btn-retry').addEventListener('click', startChallenge);

  // ======================================================================
  //  ゲームからの通知
  // ======================================================================
  // ======================================================================
  //  成長・街・ダンジョンの画面（第26版）
  // ======================================================================
  const RP = MG.RPG;
  let lvHtml = '';
  function updateLvBox() {
    const p = G.prog.prog, need = RP.xpNeed(p.level), max = p.level >= RP.MAX_LV;
    const key = `${p.level}|${p.xp}|${G.prog.gold}`;
    if (key === lvHtml) return;
    lvHtml = key;
    $('lv-num').textContent = p.level;
    $('lv-gold').textContent = `${G.prog.gold.toLocaleString()} G`;
    $('lv-xp-fill').style.width = max ? '100%' : `${Math.min(100, (p.xp / need) * 100).toFixed(1)}%`;
    $('lv-xp-text').textContent = max ? '最大レベル' : `次のレベルまで ${need - p.xp}`;
  }
  function saveProgress() { save.rpg = G.getProgress(); persistSoon(); }
  let luTimer = 0;
  const luQueue = [];
  function showLevelUp(u) {
    luQueue.push(u);
    if (luQueue.length > 1) return;
    const next = () => {
      const x = luQueue[0]; if (!x) return;
      const el = $('levelup'), S = RP.STATS[x.stat];
      const der = G.derived();
      el.innerHTML = `<div class="lu-title">LEVEL UP!</div><div class="lu-sub">Lv <b>${x.level}</b> ・ 最大MP <b>+${RP.MP_PER_LV}</b> ・ ${esc(S.label)} <b>${S.fmt(S.per)}</b></div>${x.unlock ? `<div class="lu-unlock">封印が解けた！ ことばを ${x.unlock} 語までつなげられる</div>` : ''}`;
      el.classList.add('show');
      AU.secret();
      clearTimeout(luTimer);
      luTimer = setTimeout(() => { el.classList.remove('show'); luQueue.shift(); setTimeout(next, 350); }, x.unlock ? 3600 : 2400);
      void der;
    };
    next();
  }
  function renderTemple() {
    const p = G.prog.prog, d = G.derived(), need = RP.xpNeed(p.level);
    const stat = (label, val, extra) => `<div class="tp-stat"><span>${esc(label)}</span><b>${val}${extra ? `<small>${extra}</small>` : ''}</b></div>`;
    const s = p.stats;
    $('temple-body').innerHTML = `
      <div class="tp-level"><div class="tp-lv">Lv ${p.level}</div><div class="tp-xp">経験値 ${p.xp} / ${need}<div class="tp-bar"><span style="width:${Math.min(100, (p.xp / need) * 100)}%"></span></div></div></div>
      <div class="tp-grid">
        ${stat('最大HP', d.maxHp, s.hp ? RP.STATS.hp.fmt(s.hp * RP.STATS.hp.per) : '')}
        ${stat('最大MP', d.mpMax, s.mp ? RP.STATS.mp.fmt(s.mp * RP.STATS.mp.per) : '')}
        ${stat('MPの回復', d.mpRegen + '/秒', s.regen ? RP.STATS.regen.fmt(s.regen) : '')}
        ${stat('魔法の威力', '×' + d.power.toFixed(2), s.power ? RP.STATS.power.fmt(s.power * RP.STATS.power.per) : '')}
        ${stat('足の速さ', '×' + d.speed.toFixed(2), s.speed ? RP.STATS.speed.fmt(s.speed * RP.STATS.speed.per) : '')}
        ${stat('待ち時間', '×' + d.cdMul.toFixed(2), s.cd ? RP.STATS.cd.fmt(s.cd * RP.STATS.cd.per) : '')}
      </div>
      <h3 class="tp-h">ことばの封印</h3>
      <div class="tp-seals">
        <div class="ok">2 語の魔法: 使える</div>
        <div class="${d.chain >= 3 ? 'ok' : 'lock'}">3 語の魔法: ${d.chain >= 3 ? '使える' : `封印中（Lv${RP.CHAIN_LV[3]} で解ける）`}</div>
        <div class="${d.chain >= 4 ? 'ok' : 'lock'}">4 語の魔法: ${d.chain >= 4 ? '使える' : `封印中（Lv${RP.CHAIN_LV[4]} で解ける）`}</div>
      </div>
      <h3 class="tp-h">記録</h3>
      <div class="tp-grid">${stat('いちばん深く潜った階', G.prog.bestFloor ? `地下 ${G.prog.bestFloor} 階` : 'まだ挑んでいない')}${stat('お金', G.prog.gold.toLocaleString() + ' G')}</div>
      <p class="panel-lead" style="padding:12px 0 0">能力は友達との対戦にも反映されます。ダンジョンで倒れると、その回に拾った物とその回の経験値を失って、ここで蘇ります。</p>`;
  }
  function renderShop() {
    $('shop-gold').textContent = `${G.prog.gold.toLocaleString()} G`;
    const items = MG.WANDS.filter((w) => w.id !== 'novice').map((w) => {
      const owned = G.ownsWand(w.id), price = RP.WAND_PRICE[w.id] || 0, can = G.prog.gold >= price;
      return `<div class="shop-item" style="--gem:${w.gem}"><span class="si-gem" aria-hidden="true"></span><div class="si-main"><div class="si-name">${esc(w.name)}</div><div class="si-desc">${esc(w.desc)}</div></div>
        <span class="si-price">${owned ? '' : price.toLocaleString() + ' G'}</span>
        <button type="button" class="${owned ? 'btn-secondary' : 'btn-primary'}" data-buy="${w.id}" ${owned || !can ? 'disabled' : ''}>${owned ? '持っている' : can ? '買う' : 'お金が足りない'}</button></div>`;
    });
    const pp = RP.POTION;
    items.push(`<div class="shop-item" style="--gem:#9dffb0"><span class="si-gem" aria-hidden="true"></span><div class="si-main"><div class="si-name">回復薬（持っている数 ${G.prog.potions} / ${pp.max}）</div><div class="si-desc">ダンジョンの中で Q キーを押すと、HP が ${pp.heal} 回復する</div></div>
      <span class="si-price">${pp.price} G</span><button type="button" class="btn-primary" data-buy="potion" ${G.prog.gold < pp.price || G.prog.potions >= pp.max ? 'disabled' : ''}>${G.prog.potions >= pp.max ? 'これ以上持てない' : '買う'}</button></div>`);
    $('shop-list').innerHTML = items.join('');
  }
  $('shop-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-buy]'); if (!b || b.disabled) return;
    const id = b.dataset.buy;
    const r = id === 'potion' ? G.buyPotion() : G.buyWand(id);
    if (r === 'ok') { AU.register(); toast(id === 'potion' ? '回復薬を買いました' : `${MG.WAND_MAP[id].name}を買いました（T キーで持ちかえ）`); }
    else { AU.error(); toast(r === 'gold' ? 'お金が足りません' : r === 'full' ? 'これ以上持てません' : 'すでに持っています'); }
    saveProgress(); renderShop();
    const again = document.querySelector(`[data-buy="${id}"]`); if (again && !again.disabled) again.focus();
  });
  // ダンジョンの地図（見たところだけ）
  let mapT = 0;
  function drawMinimap() {
    const cv = $('minimap'), D = G.dun;
    if (!D.on || !D.data || !D.explored) return;
    const g = cv.getContext('2d'), N = D.data.N, k = cv.width / N;
    g.clearRect(0, 0, cv.width, cv.height);
    g.fillStyle = 'rgba(160,170,210,0.55)';
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) if (D.explored[z * N + x] && D.data.tiles[z * N + x]) g.fillRect(x * k, z * k, k + 0.4, k + 0.4);
    const dot = (wx, wz, col, r, need) => {
      const [tx, tz] = RP.worldToTile(wx, wz);
      if (need && !D.explored[tz * N + tx]) return;
      g.fillStyle = col; g.beginPath(); g.arc((tx + 0.5) * k, (tz + 0.5) * k, r, 0, Math.PI * 2); g.fill();
    };
    const wd = W.dun;
    if (wd) { if (wd.stairsOpen) dot(wd.stairs.x, wd.stairs.z, '#ffb84a', 5, true); dot(wd.portal.x, wd.portal.z, '#4fa8ff', 5, true); }
    D.chests.forEach((c) => { if (!c.open) dot(c.x, c.z, '#ffe39a', 3, true); });
    (G.enemyDots ? G.enemyDots() : []).forEach((e) => dot(e.x, e.z, e.boss ? '#ff5a3a' : '#ff7a7a', e.boss ? 5 : 2.5, true));
    // 自分（向きの三角）
    const p = G.playerPos(), yaw = G.playerYaw();
    const [tx, tz] = RP.worldToTile(p.x, p.z), cx = (tx + 0.5) * k, cz = (tz + 0.5) * k;
    g.save(); g.translate(cx, cz); g.rotate(-yaw); g.fillStyle = '#ffffff';
    g.beginPath(); g.moveTo(0, -7); g.lineTo(5, 5); g.lineTo(-5, 5); g.closePath(); g.fill(); g.restore();
  }
  function updateRpgHud(dt) {
    updateLvBox();
    const D = G.dun;
    const dun = D.on && !G.match.on;
    $('dun-hud').hidden = !dun; $('minimap').hidden = !dun;
    if (dun) {
      $('dun-hp-fill').style.width = `${Math.max(0, (D.hp / D.maxHp) * 100).toFixed(1)}%`;
      $('dun-hp-fill').parentElement.classList.toggle('low', D.hp < D.maxHp * 0.3);
      $('dun-hp-num').textContent = `${Math.max(0, Math.ceil(D.hp))} / ${D.maxHp}`;
      $('dun-loot').textContent = `拾った ${D.run ? D.run.gold : 0} G`;
      $('dun-pot').innerHTML = `回復薬 ×${G.prog.potions} <kbd>Q</kbd>`;
      mapT -= dt || 0.016;
      if (mapT <= 0) { mapT = 0.2; drawMinimap(); }
    }
  }

  MG.UI = {
    toast,
    onProgress() { saveProgress(); updateLvBox(); if (current === 'shop') renderShop(); if (current === 'temple') renderTemple(); renderSlots(); if (current === 'crafter') renderCrafter(); },
    onLevelUp(u) { showLevelUp(u); saveProgress(); renderSlots(); },
    onStage(name) {
      document.body.classList.remove('stage-town', 'stage-practice', 'stage-dungeon', 'stage-arena');
      document.body.classList.add('stage-' + name);
      $('spot-prompt').hidden = true;
      if (name === 'town') toast('街: 神殿・杖の店・ダンジョンの門・練習場の門に近づいて F キー', 3200);
      else if (name === 'practice') toast('練習場（門に近づいて F キーで街へ戻る）', 2600);
    },
    onSpot(sp) {
      const el = $('spot-prompt');
      el.hidden = !sp;
      if (sp) el.innerHTML = `<kbd>F</kbd><b>${esc(sp.label)}</b>${esc(sp.hint)}`;
    },
    onFloor(fl, boss) {
      $('dun-floor').textContent = `地下 ${fl} 階${boss ? '（守護者の階）' : ''}`;
      $('dun-floor').classList.toggle('boss', !!boss);
      $('dun-down').hidden = true;
      toast(boss ? `地下 ${fl} 階: 守護者を倒すと、下の階への道が開く` : `地下 ${fl} 階: 下の階への穴と、街へ帰る帰還ポータルを探そう`, 3200);
      saveProgress();
    },
    onDungeonDown(name) {
      const el = $('dun-down');
      el.innerHTML = `<div class="dd-title">倒れた…</div><div class="dd-sub">${name ? esc(name) + 'にやられた。' : ''}拾った物と、この回の経験値を失って、神殿で蘇ります</div>`;
      el.hidden = false;
    },
    onDungeonEnd(sum) {
      $('dun-down').hidden = true;
      const won = sum.how === 'portal';
      $('dun-result-h').textContent = won ? '帰還' : '神殿で蘇った';
      const lv = sum.level !== sum.startLevel ? `Lv ${sum.startLevel} → ${sum.level}` : `Lv ${sum.level}`;
      $('dun-result-body').innerHTML = won
        ? `<div class="dr-big">地下 ${sum.floor} 階から帰ってきた</div><div class="dr-gain">持ち帰ったお金: ${sum.gold} G</div><div>手に入れた経験値: ${sum.xp}（${lv}）</div><div>倒した敵: ${sum.kills} 体</div>`
        : `<div class="dr-big">地下 ${sum.floor} 階で倒れた</div><div class="dr-lost">失ったお金: ${sum.gold} G・回復薬 ${sum.potions} 個</div><div class="dr-lost">失った経験値: ${sum.xp}（レベルは Lv ${sum.level} に戻った）</div><div>倒した敵: ${sum.kills} 体</div>`;
      saveProgress();
      open('dun-result');
    },
    sens: () => save.sens || 1,
    updateHud() { updateHud(); updateRpgHud(); },
    onCast(spec, via, rec, cast) {
      const key = keyOf(spec.seq);
      lastCastMode = cast && cast.castMode;
      const first = !save.known[key];
      if (first) {
        save.known[key] = { best: 0, casts: 0, t: Date.now() };
        if (spec.secret && !save.secrets.includes(spec.secret)) save.secrets.push(spec.secret);
        reveal(spec);
        renderSlots();
      } else banner(spec);
      save.known[key].casts = (save.known[key].casts || 0) + 1;
      save.known[key].last = Date.now();
      persistSoon();
    },
    // 紋章を重ねて左クリックで放った
    onDrawCast(seq, res) {
      if (res !== 'ok') return;
      const labels = seq.map((id) => esc(MG.WORD_MAP[id].label)).join(' ＋ ');
      const mode = st.wand === 'bare' ? '素手で紋章・効果 150%' : '紋章・効果 100%';
      voiceMsg(`紋章: <b>${labels}</b> <span class="vb-ok">発動！</span> <small>（${mode}）</small>`, 'ok', 2000);
    },
    onCastDamage(rec) {
      const k = save.known[rec.key];
      if (k && rec.dmg > (k.best || 0)) { k.best = Math.round(rec.dmg); persistSoon(); }
    },
    onCastPierce(rec) {
      const k = save.known[rec.key];
      if (k && rec.pierce > (k.pierce || 0)) { k.pierce = rec.pierce; persistSoon(); }
    },
    onSelect() { renderSlots(); banner(st.slots[st.slot]); },
    onKill() {},
    flashMp() { const b = $('mp-fill').parentElement; b.animate([{ transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'none' }], { duration: 200 }); },
    onUnlock() { unlockAt = performance.now(); open('pause'); }, // Esc でマウスの固定が外れた: メニューではなく一時停止の画面（メニューは Tab）
    onWand() { buildSlots(); renderSlots(); if (current === 'crafter') renderRegister(); if (current === 'book') renderBookDetail(); },
    onEngines() { renderEngines(); },
    onChallengeEnd(score) {
      const isBest = score > (save.best || 0);
      if (isBest) { save.best = score; persist(); }
      AU.finish();
      $('result-score').textContent = score.toLocaleString();
      $('result-detail').textContent = `壊した的 ${st.kills} 個`;
      $('result-best').textContent = isBest ? '★ 最高記録を更新しました！' : `最高記録 ${save.best.toLocaleString()} 点`;
      open('result');
    },
    showStick(start, d) {
      const s = $('stick');
      if (!start) { s.hidden = true; return; }
      s.hidden = false; s.style.left = start.x + 'px'; s.style.top = start.y + 'px';
      $('stick-knob').style.transform = `translate(${d.x * 32}px, ${d.y * 32}px)`;
    },
    handleKey(e) {
      // メニューは Tab で開け閉めする。Esc は開いている画面を閉じるだけ（何も開いていなければ一時停止）
      if (e.code === 'Escape') { if (performance.now() - unlockAt < 400) return true; if (current) { close(false); return true; } open('pause'); return true; }
      if (e.code === 'Tab' && !e.shiftKey && (!current || current === 'menu' || current === 'pause')) {
        e.preventDefault();
        if (current === 'menu') close(); else open('menu');
        return true;
      }
      if (current) {
        if ((e.code === 'KeyE' && current === 'crafter') || (e.code === 'KeyG' && current === 'book')) { close(); return true; }
        return false;
      }
      // F: 入れる場所の近くでは入る（ほかでは今までどおり放つ）。Q: ダンジョンでは回復薬（ほかでは放つ）
      if (e.code === 'KeyF' && G.interact()) return true;
      if (e.code === 'KeyQ' && G.dun.on) { G.usePotion(); return true; }
      if (e.code === 'KeyE') { open('crafter'); return true; }
      if (e.code === 'KeyG') { open('book'); return true; }
      if (e.code === 'KeyM') { setSound(!AU.enabled); return true; }
      if (e.code === 'KeyV') { voiceToggle(); return true; }
      if (e.code === 'KeyT') { open('wands'); return true; }
      if (e.code === 'KeyN') { setTime(save.time === 'day' ? 'night' : 'day'); toast(save.time === 'day' ? '昼にしました' : '夜にしました'); return true; }
      return false;
    },
    isOpen: () => current,
    open, close,
    getSave: () => save,
  };

  // ======================================================================
  //  起動
  // ======================================================================
  load();
  AU.setEnabled(save.sound !== false);
  H.setScale(save.shake);
  H.setPadEnabled(save.pad);
  const ok = G.init($('world'));
  G.setProgress(save.rpg);
  buildPalette();
  buildSlots();
  showInfo(null);
  MG.WANDS.forEach((w) => save.wandSlots[w.id].forEach((s, i) => G.setSlot(i, s, w.id)));
  if (!G.setWand(save.wand)) { save.wand = 'novice'; G.setWand('novice'); }
  if (ok) setTime(save.time, true);
  G.selectSlot(0);
  renderSlots();
  renderVoiceBtn();

  if (!ok) { $('webgl-error').hidden = false; $('btn-start').disabled = true; }
  const touchCapable = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  if (touchCapable) G.setTouch(true);

  $('btn-start').addEventListener('click', () => {
    AU.unlock();
    AU.setBgmVolume(save.bgm); AU.setBgmEnabled(save.bgmOn); AU.setMood(save.time === 'day' ? 0 : 1); AU.bgmStart();
    $('title').hidden = true;
    $('hud').hidden = false;
    $('touch-ui').hidden = !G.isTouch();
    G.start();
    renderSlots();
    if (!G.isTouch()) G.lockPointer();
    if (!save.seen) { save.seen = true; persist(); setTimeout(() => toast('最初の4つの魔法も、名前はまだ不明。放って確かめよう（E キーで魔法工房）', 4500), 600); }
  });
  $('btn-start').focus();
  renderEngines();
  document.addEventListener('pointerdown', () => AU.unlock(), { capture: true });
  document.addEventListener('keydown', () => AU.unlock(), { capture: true });

  $('btn-craft').addEventListener('click', () => { AU.click(); open('crafter'); });
  $('btn-book').addEventListener('click', () => { AU.click(); open('book'); });
  $('btn-menu').addEventListener('click', () => { AU.click(); open('menu'); });
  const cast = $('btn-cast');
  let castHold = 0;
  cast.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    G.castSlot(st.slot);
    clearInterval(castHold);
    castHold = setInterval(() => G.castSlot(st.slot), 120);
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => cast.addEventListener(ev, () => clearInterval(castHold)));
  window.addEventListener('touchstart', () => { if (!G.isTouch()) { G.setTouch(true); if (!$('hud').hidden) $('touch-ui').hidden = false; } }, { passive: true });

  // 動作確認用
  // ---- メニュー: セーブデータ ----
  const DATA_NOTE = '図鑑・隠し魔法・スロット・最高記録・設定をファイルに書き出し、ほかの場所（公開サイト・別のパソコン・別のブラウザ）で読み込めます。';
  function dataStatus(text, err) { const el = $('data-status'); el.textContent = text; el.classList.toggle('err', !!err); }
  let pendingImport = null;
  function hideImportConfirm() { pendingImport = null; $('import-confirm').hidden = true; }
  $('btn-export').addEventListener('click', () => {
    persist();
    const d = new Date(), ymd = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([exportText()], { type: 'application/json' }));
    a.download = `マギア・ラボ_セーブデータ_${ymd}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    AU.register(); hideImportConfirm();
    dataStatus(`「${a.download}」を書き出しました（ふつうは「ダウンロード」フォルダーに入ります）。`);
  });
  $('btn-import').addEventListener('click', () => {
    if (G.match.on) { AU.error(); dataStatus('対戦中は読み込めません。対戦が終わってから読み込んでください。', true); return; }
    $('import-file').value = ''; $('import-file').click();
  });
  $('import-file').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const bad = (msg) => { hideImportConfirm(); AU.error(); dataStatus(msg, true); };
    if (f.size > 2000000) { bad('ファイルが大きすぎます。「書き出す」で作ったファイルを選んでください。'); return; }
    f.text().then((txt) => {
      const p = parseImport(txt);
      if (!p) { bad('マギア・ラボのセーブデータではないようです。「書き出す」で作ったファイル（.json）を選んでください。'); return; }
      pendingImport = p;
      $('import-summary').textContent = `${p.day ? p.day + ' に書き出した' : ''}データ: 発動した魔法 ${p.known} 種・隠し魔法 ${p.secrets} 個・最高記録 ${p.best.toLocaleString()} 点。読み込むと、今のデータは上書きされます。`;
      $('import-confirm').hidden = false; dataStatus(DATA_NOTE); AU.click();
      $('import-ok').focus();
    }).catch(() => bad('ファイルを読めませんでした。'));
  });
  $('import-ok').addEventListener('click', () => {
    if (!pendingImport) return;
    if (G.match.on) { AU.error(); dataStatus('対戦中は読み込めません。', true); return; }
    if (!applyImport(pendingImport)) { AU.error(); dataStatus('このブラウザでは保存ができないため、読み込めませんでした。', true); return; }
    $('import-confirm').hidden = true; AU.register();
    dataStatus('読み込みました。ページを開き直します…');
    setTimeout(() => location.reload(), 900);
  });
  $('import-cancel').addEventListener('click', () => { hideImportConfirm(); AU.click(); dataStatus(DATA_NOTE); $('btn-import').focus(); });
  dataStatus(DATA_NOTE);

  window.__mgUI = { exportText, parseImport, applyImport, open, close, current: () => current, getSeq: () => seq.slice(), setSeq(s) { seq = s.slice(); renderCrafter(); }, save: () => save, bookSel: () => bookSel, bookTab: () => bookTab, bookFilter, voiceFinal: onVoiceFinal, voiceToggle, toggleFullscreen, voiceInterim: (t) => V.onInterim(t), lastCastMode: () => lastCastMode, candidates: () => nameCandidates() };
})();
