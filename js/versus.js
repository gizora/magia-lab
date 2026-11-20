// 対戦: ロビー（招待コードのやりとり）、対戦の進行（撃ち合い・倒した数・制限時間）、対戦中の表示
(function () {
  'use strict';
  const MG = window.MG, G = MG.Game, N = MG.Net, AU = MG.Audio;
  const UI = MG.UI;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const COLORS = ['#7fd8ff', '#ff6b6b', '#9dff8a', '#ffd36b'];
  const colorOf = (id) => COLORS[(+String(id).slice(1)) % COLORS.length] || '#ffffff';
  const SEND_MS = 66; // 位置を送る間隔（1秒に約15回）

  const VS = (MG.VS = {
    view: 'home',      // home（最初）/ host（部屋を作った）/ guest（参加する）
    state: 'idle',     // idle / lobby / match / result
    rules: { kills: 5, minutes: 5 },
    players: {},       // ID → { name, color, kills, deaths }
    feed: [],
    endsAt: 0,
    inviteCode: '', answerCode: '',
    roomCode: '', roomBusy: false, roomErr: '', joining: false, roomEdit: false,
    remoteCasts: 0, // 相手の魔法を再現した回数（動作確認用）
  });

  const save = () => UI.getSave();
  const myName = () => N.cleanName(($('vs-name') && $('vs-name').value) || save().vsName || '');
  const knownNames = {}; // 部屋を出た人の名前も表示できるように覚えておく
  const nameOf = (id) => (VS.players[id] ? VS.players[id].name : (N.roster.find((r) => r.id === id) || {}).name || knownNames[id] || '？');

  function status(msg, cls) {
    const el = $('vs-status');
    el.textContent = msg || '';
    el.className = 'vs-status' + (cls ? ' ' + cls : '');
  }
  async function copyText(text, btn) {
    let ok = false;
    try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); ok = true; } } catch (e) { /* 下の方法で */ }
    if (!ok) {
      const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
    }
    if (btn) { const t = btn.textContent; btn.textContent = ok ? 'コピーしました' : 'コピーできませんでした（手で選んでコピーしてください）'; setTimeout(() => (btn.textContent = t), 1600); }
    return ok;
  }

  // ======================================================================
  //  ロビーの画面
  // ======================================================================
  function render() {
    const v = VS.view;
    $('vs-name').value = save().vsName || '';
    $('vs-home').hidden = v !== 'home';
    $('vs-host').hidden = v !== 'host';
    $('vs-guest').hidden = v !== 'guest';
    $('vs-unsupported').hidden = N.supported();
    $('vs-room-join').disabled = VS.joining || !N.supported();
    $('vs-guest-entry').hidden = N.role === 'guest' && N.connectedCount() > 0;
    $('vs-back').hidden = v === 'home' || !!N.role;
    $('vs-leave').hidden = !N.role;
    if (!N.supported()) { $('vs-host-btn').disabled = true; $('vs-join-btn').disabled = true; }
    renderRoster();
    if (v === 'host') {
      const n = N.connectedCount();
      const full = n + 1 >= N.maxPlayers;
      $('vs-make-invite').disabled = full || VS.state === 'match';
      $('vs-make-invite').textContent = full ? `満員です（${N.maxPlayers}人まで）` : n ? 'もう1人招待する（招待コードを作る）' : '招待コードを作る';
      $('vs-start').disabled = n < 1;
      $('vs-start').textContent = n < 1 ? '友達がつながると始められます' : `対戦開始（${n + 1}人）`;
      $('vs-kills').value = String(VS.rules.kills);
      $('vs-minutes').value = String(VS.rules.minutes);
      $('vs-invite-box').hidden = !VS.inviteCode;
      $('vs-room-code').textContent = VS.roomCode || (VS.roomBusy ? '準備中…' : '使えません');
      $('vs-room-code').classList.toggle('off', !VS.roomCode);
      $('vs-copy-room').disabled = !VS.roomCode;
      $('vs-room-hint').hidden = !VS.roomCode;
      $('vs-room-err').hidden = !!VS.roomCode || VS.roomBusy;
      $('vs-room-err').textContent = VS.roomErr;
      const locked = N.connectedCount() > 0;
      $('vs-room-edit').hidden = locked || VS.roomBusy;
      $('vs-room-edit').textContent = VS.roomEdit ? '変えるのをやめる' : '合言葉を変える';
      $('vs-room-form').hidden = !VS.roomEdit || locked;
      $('vs-room-set').disabled = VS.roomBusy; $('vs-room-auto').disabled = VS.roomBusy;
      $('vs-invite-out').value = VS.inviteCode;
    }
    if (v === 'guest') {
      $('vs-answer-box').hidden = !VS.answerCode;
      $('vs-answer-out').value = VS.answerCode;
      $('vs-guest-wait').hidden = !(N.role === 'guest' && N.connectedCount() > 0);
    }
  }
  function renderRoster() {
    const list = N.roster.length ? N.roster : [];
    const html = list.map((r) => `<li style="--pc:${colorOf(r.id)}"><span class="vs-dot"></span><b>${esc(r.name)}</b>${r.id === 'p0' ? '<small>ホスト</small>' : ''}${r.id === N.myId ? '<small>あなた</small>' : ''}</li>`).join('');
    ['vs-roster', 'vs-roster-guest'].forEach((id) => { const el = $(id); if (el) el.innerHTML = html || '<li class="vs-empty">まだだれもいません</li>'; });
  }

  function openLobby() {
    if (VS.state === 'match') { UI.toast('対戦中です。メニューの「対戦をやめる」で抜けられます'); return; }
    UI.open('versus');
  }

  $('vs-name').addEventListener('input', () => { save().vsName = N.cleanName($('vs-name').value); try { localStorage.setItem('magia-lab-v1', JSON.stringify(save())); } catch (e) { /* */ } });
  $('vs-host-btn').addEventListener('click', () => {
    AU.click();
    const custom = $('vs-room-custom').value.trim();
    if (custom && !N.roomFromText(custom)) { AU.error(); status(`合言葉は ${N.CUSTOM_MIN}〜${N.CUSTOM_MAX} 文字にしてください（空欄なら自動で決まります）。`, 'err'); $('vs-room-custom').focus(); return; }
    N.host(myName());
    VS.view = 'host'; VS.state = 'lobby'; VS.inviteCode = '';
    $('vs-code-host').open = false;
    VS.roomEdit = false;
    openRoom(custom || null);
  });
  // 合言葉を決めて部屋を開く（custom: 自分で決めた合言葉。null なら自動）
  async function openRoom(custom) {
    VS.roomCode = ''; VS.roomBusy = true; VS.roomErr = '';
    status(custom ? `合言葉「${custom}」の部屋を開いています…` : '合言葉を準備しています…');
    render();
    try {
      VS.roomCode = await N.openRoom(custom);
      if (N.role !== 'host') return;
      VS.roomEdit = false;
      status(`部屋ができました。合言葉「${VS.roomCode}」を友達に伝えてください。`, 'ok');
    } catch (e) {
      if (N.role !== 'host') return;
      VS.roomErr = e.message;
      if (custom) { VS.roomEdit = true; $('vs-room-new').value = custom; status(e.message, 'err'); }
      else { $('vs-code-host').open = true; status('合言葉は使えませんでしたが、下の「コードで招待する」でつなげます。', 'err'); }
    }
    VS.roomBusy = false;
    render();
    if (VS.roomEdit) $('vs-room-new').focus();
  }
  // 部屋を作ったあとで合言葉を変える（友達がつながる前だけ）
  $('vs-room-edit').addEventListener('click', () => {
    AU.click(); VS.roomEdit = !VS.roomEdit;
    if (VS.roomEdit) $('vs-room-new').value = '';
    render(); if (VS.roomEdit) $('vs-room-new').focus();
  });
  function setRoomWord() {
    const v = $('vs-room-new').value.trim();
    if (!v) { openRoom(null); return; }
    if (!N.roomFromText(v)) { AU.error(); status(`合言葉は ${N.CUSTOM_MIN}〜${N.CUSTOM_MAX} 文字にしてください。`, 'err'); $('vs-room-new').focus(); return; }
    if (N.connectedCount() > 0) { AU.error(); status('友達がつながったあとは、合言葉を変えられません。', 'err'); return; }
    AU.click(); openRoom(v);
  }
  $('vs-room-set').addEventListener('click', setRoomWord);
  $('vs-room-new').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); setRoomWord(); } });
  $('vs-room-auto').addEventListener('click', () => { if (N.connectedCount() > 0) return; AU.click(); openRoom(null); });
  N.onRoomError = (msg) => { if (N.role === 'host' && VS.state !== 'match' && N.connectedCount() + 1 < N.maxPlayers) status('つなぎ役のサーバーとの接続が切れました。つなぎ直しています…（だめなときは部屋を作り直すか、「コードで招待する」を使ってください）', 'err'); };
  $('vs-copy-room').addEventListener('click', () => copyText(`マギア・ラボで対戦しよう！ 合言葉: ${VS.roomCode}（「友達と対戦」→「部屋に入る」で入力）`, $('vs-copy-room')));
  $('vs-join-btn').addEventListener('click', () => {
    AU.click();
    VS.view = 'guest'; VS.answerCode = '';
    $('vs-invite-in').value = '';
    $('vs-code-guest').open = false;
    status('友達（部屋を作った人）から聞いた合言葉を入れて、「入る」を押してください。');
    render();
    $('vs-room-in').focus();
  });
  async function joinRoom() {
    if (VS.joining) return;
    AU.click();
    VS.joining = true; VS.answerCode = '';
    status('部屋をさがしています…（10秒ほどかかることがあります）');
    render();
    try {
      await N.joinRoom(myName(), $('vs-room-in').value);
      VS.state = 'lobby';
      rosterChanged();
    } catch (e) { status(e.message, 'err'); }
    VS.joining = false;
    render();
  }
  $('vs-room-join').addEventListener('click', joinRoom);
  $('vs-room-in').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); joinRoom(); } });
  $('vs-make-invite').addEventListener('click', async () => {
    AU.click();
    const b = $('vs-make-invite'); b.disabled = true;
    status('招待コードを作っています…（数秒かかります）');
    try {
      VS.inviteCode = await N.createInvite();
      $('vs-answer-in').value = '';
      status('招待コードができました。コピーして友達に送り、友達から届いた「返事コード」を下に貼り付けてください。', 'ok');
    } catch (e) { status(e.message, 'err'); }
    render();
  });
  $('vs-copy-invite').addEventListener('click', () => copyText(VS.inviteCode, $('vs-copy-invite')));
  $('vs-accept').addEventListener('click', async () => {
    AU.click();
    try {
      await N.acceptAnswer($('vs-answer-in').value);
      VS.inviteCode = '';
      status('つないでいます…（10秒ほどかかることがあります）');
      waitConnect();
    } catch (e) { status(e.message, 'err'); }
    render();
  });
  // つながらないまま時間がたったら知らせる
  let connectTimer = 0;
  function waitConnect() {
    clearTimeout(connectTimer);
    const before = N.connectedCount();
    connectTimer = setTimeout(() => {
      if (N.connectedCount() <= before && (N.pending.size || N.role === 'guest')) status('つながりませんでした。回線の組み合わせによっては、直接つながらないことがあります（会社・学校の回線や、一部のスマホのテザリングなど）。別の回線で試すか、招待コードを作り直してください。', 'err');
    }, 20000);
  }
  $('vs-make-answer').addEventListener('click', async () => {
    AU.click();
    const b = $('vs-make-answer'); b.disabled = true;
    status('返事コードを作っています…（数秒かかります）');
    try {
      VS.answerCode = await N.join(myName(), $('vs-invite-in').value);
      VS.state = 'lobby';
      status('返事コードができました。コピーしてホストに送ってください。ホストが貼り付けるとつながります。', 'ok');
      waitConnect();
    } catch (e) { status(e.message, 'err'); }
    b.disabled = false;
    render();
  });
  $('vs-copy-answer').addEventListener('click', () => copyText(VS.answerCode, $('vs-copy-answer')));
  $('vs-kills').addEventListener('change', () => { VS.rules.kills = Math.max(1, Math.min(30, +$('vs-kills').value || 5)); });
  $('vs-minutes').addEventListener('change', () => { VS.rules.minutes = Math.max(1, Math.min(30, +$('vs-minutes').value || 5)); });
  $('vs-start').addEventListener('click', () => { AU.click(); hostStart(); });
  $('vs-leave').addEventListener('click', () => { AU.click(); leaveRoom(); });
  $('vs-back').addEventListener('click', () => { AU.click(); if (N.role) leaveRoom(); else { VS.view = 'home'; render(); } });

  function leaveRoom(msg) {
    if (VS.state === 'match') endLocal();
    N.leave();
    VS.view = 'home'; VS.state = 'idle'; VS.inviteCode = ''; VS.answerCode = ''; VS.roomCode = ''; VS.roomBusy = false;
    status(msg || '部屋を出ました。');
    render();
  }

  // ======================================================================
  //  対戦の進行
  // ======================================================================
  function hostStart() {
    if (N.role !== 'host' || N.connectedCount() < 1) return;
    const players = N.roster.map((r) => ({ id: r.id, name: r.name }));
    const msg = { t: 'start', players, rules: { kills: VS.rules.kills, minutes: VS.rules.minutes }, dur: VS.rules.minutes * 60000 };
    N.send(msg);
    startMatch(msg);
  }
  function startMatch(msg) {
    const list = Array.isArray(msg.players) ? msg.players.slice(0, N.maxPlayers) : [];
    if (!list.some((p) => p.id === N.myId)) return;
    VS.rules = { kills: Math.max(1, Math.min(30, +msg.rules.kills || 5)), minutes: Math.max(1, Math.min(30, +msg.rules.minutes || 5)) };
    VS.players = {};
    list.forEach((p) => { VS.players[String(p.id)] = { name: N.cleanName(p.name), color: colorOf(p.id), kills: 0, deaths: 0 }; });
    VS.feed = []; VS.state = 'match';
    N.locked = true;
    renderFeed();
    VS.endsAt = performance.now() + Math.max(60000, Math.min(1800000, +msg.dur || 300000));
    // まだタイトル画面なら、ゲームを始める
    if (!$('title').hidden) $('btn-start').click();
    if (UI.isOpen()) UI.close(false);
    const order = list.map((p) => String(p.id));
    G.matchStart({ myId: N.myId, spawn: order.indexOf(N.myId) });
    order.forEach((id) => { if (id !== N.myId) G.addAvatar(id, VS.players[id].name, VS.players[id].color); });
    document.body.classList.add('vs-on');
    $('vs-hud').hidden = false;
    renderBoard();
    AU.start();
    UI.toast(`対戦開始！ 先に ${VS.rules.kills} 人倒した人の勝ち（制限時間 ${VS.rules.minutes} 分）`, 3200);
    if (!G.isTouch()) G.lockPointer();
  }
  function endLocal() {
    G.matchEnd();
    N.locked = false;
    VS.state = N.role ? 'lobby' : 'idle';
    document.body.classList.remove('vs-on');
    $('vs-hud').hidden = true;
    $('vs-dead').hidden = true;
  }
  function ranking() {
    return Object.keys(VS.players).map((id) => Object.assign({ id }, VS.players[id])).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  }
  function hostCheckEnd(reason) {
    if (N.role !== 'host' || VS.state !== 'match') return;
    const top = ranking()[0];
    const timeUp = performance.now() >= VS.endsAt;
    const alone = N.connectedCount() < 1;
    if ((top && top.kills >= VS.rules.kills) || timeUp || alone || reason) {
      const msg = { t: 'end', why: reason || (alone ? 'alone' : timeUp ? 'time' : 'kills'), players: VS.players };
      N.send(msg);
      finish(msg);
    }
  }
  function finish(msg) {
    if (VS.state !== 'match') return;
    if (msg.players && typeof msg.players === 'object') {
      // ホストの集計にそろえる
      for (const id in VS.players) { const p = msg.players[id]; if (p) { VS.players[id].kills = Math.max(0, +p.kills || 0); VS.players[id].deaths = Math.max(0, +p.deaths || 0); } }
    }
    endLocal();
    const r = ranking();
    const why = { kills: `${esc(r[0].name)} が ${VS.rules.kills} 人倒しました`, time: '制限時間になりました', alone: '相手がいなくなりました' }[msg.why] || '';
    $('vs-result-why').innerHTML = why;
    $('vs-result-list').innerHTML = r.map((p, i) => `<li style="--pc:${p.color}" class="${p.id === N.myId ? 'me' : ''}"><span class="vs-rank">${i + 1}</span><span class="vs-dot"></span><b>${esc(p.name)}</b><span class="vs-kd">倒した ${p.kills} ・ 倒れた ${p.deaths}</span></li>`).join('');
    const win = r[0] && r[0].id === N.myId && (r.length < 2 || r[0].kills > r[1].kills || r[0].deaths < r[1].deaths);
    $('vs-result-h').textContent = win ? 'あなたの勝ち！' : '対戦終了';
    $('vs-again').hidden = N.role !== 'host';
    $('vs-wait-host').hidden = N.role !== 'guest';
    AU.finish();
    UI.open('vs-result');
  }
  $('vs-again').addEventListener('click', () => { AU.click(); if (N.connectedCount() < 1) { UI.close(false); VS.view = 'host'; openLobby(); status('相手がいません。もう一度招待してください。', 'err'); return; } hostStart(); });
  $('vs-to-lobby').addEventListener('click', () => { AU.click(); UI.close(false); VS.view = N.role === 'host' ? 'host' : N.role === 'guest' ? 'guest' : 'home'; openLobby(); });
  $('vs-quit').addEventListener('click', () => { AU.click(); UI.close(); leaveRoom(); });

  // 倒された・倒した
  function onKill(m) {
    const k = String(m.k || ''), v = String(m.v || '');
    if (!VS.players[v]) return;
    VS.players[v].deaths++;
    if (k && k !== v && VS.players[k]) VS.players[k].kills++;
    addFeed(k, v, String(m.s || '').slice(0, 20));
    if (k === N.myId && v !== N.myId) { AU.killed(); UI.toast(`${nameOf(v)} を倒した！`, 1800); }
    renderBoard();
    hostCheckEnd();
  }
  function addFeed(k, v, spell) {
    VS.feed.unshift({ k, v, spell, t: performance.now() });
    VS.feed = VS.feed.slice(0, 5);
    renderFeed();
  }
  function renderFeed() {
    const now = performance.now();
    VS.feed = VS.feed.filter((f) => now - f.t < 7000);
    $('vs-feed').innerHTML = VS.feed.map((f) => {
      const kn = VS.players[f.k] ? `<b style="color:${VS.players[f.k].color}">${esc(VS.players[f.k].name)}</b>` : '<b>？</b>';
      const vn = VS.players[f.v] ? `<b style="color:${VS.players[f.v].color}">${esc(VS.players[f.v].name)}</b>` : '<b>？</b>';
      if (f.k === 'leave') return `<li>${vn} が部屋を出ました</li>`;
      return `<li>${kn} <span class="vs-arrow">▶</span> ${vn}${f.spell ? `<small>「${esc(f.spell)}」</small>` : ''}</li>`;
    }).join('');
  }
  function renderBoard() {
    $('vs-board').innerHTML = ranking().map((p) => `<li style="--pc:${p.color}" class="${p.id === N.myId ? 'me' : ''}"><span class="vs-dot"></span><b>${esc(p.name)}</b><span>${p.kills}</span></li>`).join('') + `<li class="vs-goal">${VS.rules.kills} 人で勝ち</li>`;
  }

  // ======================================================================
  //  ゲーム・通信からの知らせ
  // ======================================================================
  G.onLocalCast = (c) => N.send({ t: 'cast', c });
  G.onPlayerHit = (pid, h) => N.send({ t: 'hit', h }, { to: pid });
  G.onLocalDeath = (from, spell) => {
    const m = { t: 'kill', k: from || '', v: N.myId, s: spell };
    N.send(m);
    onKill(m);
    deadMsg = from && VS.players[from] ? `<b style="color:${VS.players[from].color}">${esc(VS.players[from].name)}</b> の${spell ? `「${esc(spell)}」` : '魔法'}で倒された` : '倒された';
    renderDead();
  };
  G.onRespawn = () => { $('vs-dead').hidden = true; };
  let deadMsg = '';
  function renderDead() {
    const M = G.match, dead = M.on && !M.alive;
    $('vs-dead').hidden = !dead;
    if (!dead) return;
    const html = `<div>${deadMsg}</div><small>${Math.max(1, Math.ceil(M.deadT))} 秒後に復活</small>`;
    if ($('vs-dead').innerHTML !== html) $('vs-dead').innerHTML = html;
  }

  N.onMessage = (from, m) => {
    if (m.t === 'start') { if (from === 'p0') startMatch(m); return; }
    if (m.t === 'lobby') { if (from === 'p0' && VS.state !== 'match') { VS.view = 'guest'; openLobby(); } return; }
    if (VS.state !== 'match') return;
    if (m.t === 'st') G.updateAvatar(from, m.s);
    else if (m.t === 'circle') G.avatarCircle(from, m.g, String(m.k || ''));
    else if (m.t === 'fx') G.remoteFx(from, m.f);
    else if (m.t === 'cast') { if (G.remoteCast(from, m.c)) VS.remoteCasts++; }
    else if (m.t === 'hit') { if (m.to === N.myId) G.applyHit(from, m.h); }
    else if (m.t === 'kill') { if (String(m.v) === from) onKill(m); }
    else if (m.t === 'end') { if (from === 'p0') finish(m); }
  };
  let lastRoster = [];
  N.onRoster = (list) => {
    const ids = (list || []).map((r) => r.id);
    (list || []).forEach((r) => { knownNames[r.id] = r.name; });
    if (N.role === 'guest') lastRoster.filter((id) => !ids.includes(id) && id !== N.myId).forEach((id) => N.onLeave(id));
    lastRoster = ids;
    rosterChanged();
  };
  function rosterChanged() { renderRoster(); if (UI.isOpen() === 'versus') render(); if (N.role === 'guest' && N.connectedCount() > 0) { clearTimeout(connectTimer); status('つながりました！ ホストが対戦を始めるのを待っています。', 'ok'); render(); } };
  N.onJoin = (pid, name) => { clearTimeout(connectTimer); AU.join(); status(`${name} がつながりました！`, 'ok'); UI.toast(`${name} が部屋に入りました`); render(); };
  N.onLeave = (pid) => {
    const name = nameOf(pid);
    if (pid === 'p0') return;
    AU.join();
    if (VS.state === 'match') {
      G.removeAvatar(pid);
      addFeed('leave', pid, '');
      UI.toast(`${name} が部屋を出ました`);
      hostCheckEnd();
    } else UI.toast(`${name} が部屋を出ました`);
    render();
  };
  N.onClosed = (why) => {
    const msg = why === 'host-left' ? 'ホストが部屋を閉じました。' : 'ホストとの接続が切れました。';
    if (VS.state === 'match') endLocal();
    VS.state = 'idle'; VS.view = 'home'; VS.answerCode = ''; VS.roomCode = '';
    UI.toast(msg, 3500);
    status(msg, 'err');
    render();
  };

  // 自分の魔法陣（紋章を重ねている・唱えている魔法）と、障壁がこわれたことを相手に知らせる
  G.onCircle = (words, state) => { if (VS.state === 'match' && N.role) N.send({ t: 'circle', g: words.slice(0, 4), k: state }); };
  G.onFx = (f) => { if (VS.state === 'match' && N.role) N.send({ t: 'fx', f }); };
  // 対戦中: 自分の状態を送る・表示を更新する
  setInterval(() => { if (VS.state === 'match' && N.role) N.send({ t: 'st', s: G.localState() }, { fast: true }); }, SEND_MS);
  setInterval(() => { if (VS.state === 'match') hostCheckEnd(); }, 1000);
  function hud() {
    requestAnimationFrame(hud);
    if (VS.state !== 'match') return;
    const M = G.match;
    const r = Math.max(0, M.hp / M.maxHp);
    $('vs-hp-fill').style.width = (r * 100).toFixed(1) + '%';
    $('vs-hp-fill').classList.toggle('low', r < 0.3);
    $('vs-hp-num').textContent = Math.max(0, Math.ceil(M.hp));
    const tags = [];
    if (M.prot > 0) tags.push('<span class="tag prot">守り</span>');
    if (M.burnT > 0) tags.push('<span class="tag burn">燃焼</span>');
    if (M.slowT > 0) tags.push(`<span class="tag frz">${M.slowHard ? '凍結' : '鈍足'}</span>`);
    if (M.vulnT > 0) tags.push('<span class="tag vul">腐食</span>');
    const tagHtml = tags.join('');
    if ($('vs-tags').innerHTML !== tagHtml) $('vs-tags').innerHTML = tagHtml;
    const left = Math.max(0, Math.ceil((VS.endsAt - performance.now()) / 1000));
    const txt = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    if ($('vs-timer').textContent !== txt) $('vs-timer').textContent = txt;
    $('vs-timer').classList.toggle('hurry', left <= 30);
    renderDead();
    if (VS.feed.length && performance.now() - VS.feed[VS.feed.length - 1].t > 7000) renderFeed();
  }
  requestAnimationFrame(hud);

  // 入口のボタン
  $('btn-versus-title').addEventListener('click', () => { $('btn-start').click(); openLobby(); });
  $('menu-versus').addEventListener('click', () => { AU.click(); if (VS.state === 'match') { if (confirmQuit()) leaveRoom('対戦をやめました。'); return; } openLobby(); });
  function confirmQuit() { return window.confirm('対戦をやめて部屋を出ますか？'); }

  VS.render = render;
  VS.open = openLobby;

  // 動作確認用
  window.__vs = {
    VS, N,
    host(name) { $('vs-name').value = name; $('vs-name').dispatchEvent(new Event('input')); $('vs-host-btn').click(); },
    invite: () => N.createInvite().then((c) => { VS.inviteCode = c; render(); return c; }),
    accept: (code) => N.acceptAnswer(code),
    join(name, code) { $('vs-name').value = name; $('vs-name').dispatchEvent(new Event('input')); return N.join(name, code).then((c) => { VS.view = 'guest'; VS.state = 'lobby'; VS.answerCode = c; render(); return c; }); },
    start: () => hostStart(),
    room: () => VS.roomCode,
    setRoomWord(w) { VS.roomEdit = true; render(); $('vs-room-new').value = w; setRoomWord(); },
    roomBusy: () => VS.roomBusy,
    joinRoom(name, code) { $('vs-name').value = name; $('vs-name').dispatchEvent(new Event('input')); $('vs-room-in').value = code; return joinRoom(); },
    info: () => ({ remoteCasts: VS.remoteCasts, ui: MG.UI.isOpen(), state: VS.state, role: N.role, myId: N.myId, peers: N.connectedCount(), roster: N.roster.map((r) => r.name), players: JSON.parse(JSON.stringify(VS.players)), feed: VS.feed.map((f) => f.k + '>' + f.v), endsIn: Math.round((VS.endsAt - performance.now()) / 1000) }),
    setRules(k, m) { VS.rules.kills = k; VS.rules.minutes = m; },
    forceEnd: () => hostCheckEnd('test'),
    leave: () => leaveRoom(),
    status: () => $('vs-status').textContent,
  };
})();
