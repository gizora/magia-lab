// パーティー（第39版）: 友達と編成して、村とダンジョンを一緒に進む
//  ・部屋主（p0）が中継し、編成・出発・階の移動・全滅・宝箱の早い者勝ちを決める
//  ・敵を動かす「受け持ち」は、ダンジョンに残っている人の先頭。部屋主が先に帰還しても、中継を続けるので残りの人は進める
//  ・部屋主との通信が切れたら、全員がそこまでの成果を持って村へ帰る
//  ・ゲームの中のこと（敵・蘇生・分け前）は js/game.js の「パーティー」
(function () {
  'use strict';
  const MG = window.MG, G = MG.Game, N = MG.Net, AU = MG.Audio, UI = MG.UI;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v, a, b) => Math.max(a, Math.min(b, +v || 0));
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const PID = /^p[0-3]$/;
  const COLORS = ['#7fd8ff', '#ff8fb8', '#9dff8a', '#ffd36b'];
  const colorOf = (id) => COLORS[+String(id).slice(1)] || '#ffffff';
  const SEND_MS = 66, SYNC_MS = 100, GATHER_SEC = 0.6;

  const PT = (MG.Party = {
    on: false, view: 'home', ready: false,
    list: new Map(),  // ID → { name, lv, wand, ready, busy }
    run: null,        // { floor, ids（残っている人）, sim（敵の受け持ち）}
    seen: new Map(),  // ID → 最後に届いた様子
    down: new Set(),  // 部屋主だけが使う: 倒れている人
    claimed: new Set(), // 部屋主だけが使う: 開いた宝箱
    gatherT: 0, roomCode: '', roomBusy: false, joining: false, invite: '', answer: '', leaveArm: false,
  });
  const isHost = () => N.kind === 'party' && N.role === 'host';
  const inRun = () => !!(G.dun.on && G.dun.coop && G.coop.on);
  const save = () => UI.getSave();
  const myName = () => N.cleanName($('pt-name').value || save().vsName || '');
  const nameOf = (id) => (PT.list.get(id) || {}).name || '仲間';
  const newSeed = () => Math.floor(Math.random() * 1e9);
  const wandName = (id) => (id === 'bare' ? '素手' : own(MG.WAND_MAP, id) ? MG.WAND_MAP[id].name : '杖');

  function status(msg, cls) {
    const el = $('pt-status');
    el.textContent = msg || '';
    el.className = 'vs-status' + (cls ? ' ' + cls : '');
  }
  function profile() { return { lv: G.prog.prog.level, w: G.state.wand, r: PT.ready ? 1 : 0, b: G.dun.on ? 1 : 0 }; }
  function setProfile(id, p) {
    const m = PT.list.get(id);
    if (!m || !p || typeof p !== 'object') return;
    m.lv = Math.round(num(p.lv, 1, 999));
    m.wand = p.w === 'bare' || own(MG.WAND_MAP, p.w) ? p.w : 'novice';
    m.ready = !!p.r; m.busy = !!p.b;
  }
  function toHost(msg) { if (N.role === 'host') hostMsg(N.myId, msg); else N.send(msg, { to: 'p0' }); }
  function toAll(msg) { if (!isHost()) return; N.send(msg); control(msg); }

  // ======================================================================
  //  部屋
  // ======================================================================
  function syncRoster() {
    if (N.kind !== 'party' || !N.role || !N.myId || !N.roster.some((r) => r.id === N.myId)) return;
    if (!PT.on) {
      if (!G.partyJoin(N.myId)) return;
      PT.on = true; PT.ready = false;
      document.body.classList.add('pt-on');
      status(N.role === 'host' ? '合言葉を友達に伝えてください。' : 'パーティーに入りました。準備ができたら「準備完了」を押してください。', 'ok');
    }
    const ids = new Set();
    N.roster.forEach((r) => {
      if (!PID.test(r.id)) return;
      ids.add(r.id);
      const old = PT.list.get(r.id);
      if (old && old.name === r.name) return;
      PT.list.set(r.id, Object.assign({ lv: 1, wand: 'novice', ready: false, busy: false }, old, { name: r.name }));
      if (r.id !== N.myId) { G.removeAvatar(r.id); G.addAvatar(r.id, r.name, colorOf(r.id)); }
    });
    [...PT.list.keys()].forEach((id) => {
      if (ids.has(id)) return;
      if (id !== N.myId) { G.removeAvatar(id); UI.toast(`${nameOf(id)} がパーティーを抜けました`); }
      PT.list.delete(id); PT.seen.delete(id);
    });
    lastProfile = '';
    pushProfile();
    render();
  }
  let lastProfile = '';
  function pushProfile() {
    if (!PT.on) return;
    const p = profile(), key = JSON.stringify(p);
    if (key === lastProfile) return;
    lastProfile = key;
    setProfile(N.myId, p);
    if (isHost()) sendList(); else N.send({ t: 'me', p }, { to: 'p0' });
    render();
  }
  function sendList() {
    if (!isHost()) return;
    N.send({ t: 'pl', run: PT.run, l: [...PT.list].map(([id, m]) => ({ id, p: { lv: m.lv, w: m.wand, r: m.ready ? 1 : 0, b: m.busy ? 1 : 0 } })) });
  }
  // 部屋から出たあとの片付け（how: ダンジョンにいたときの終わり方）
  function closeParty(how) {
    if (inRun()) G.leaveDungeon(G.dun.lost ? 'death' : how || 'host');
    G.partyLeave();
    PT.on = false; PT.view = 'home'; PT.ready = false; PT.run = null; PT.roomCode = ''; PT.roomBusy = false; PT.invite = ''; PT.answer = ''; PT.leaveArm = false;
    PT.list.clear(); PT.seen.clear(); PT.down.clear(); PT.claimed.clear();
    lastProfile = '';
    document.body.classList.remove('pt-on');
    render();
  }
  function leaveRoom() {
    if (inRun()) { UI.toast('ダンジョンの中では抜けられません。帰還ポータルで村へ帰ってください'); return false; }
    N.leave();
    closeParty();
    status('パーティーを抜けました。');
    return true;
  }
  function openParty() {
    if (G.match.on || (N.role && N.kind !== 'party')) { UI.toast('対戦の部屋にいます。先に部屋を出てください'); return false; }
    if (G.dun.on) { UI.toast('パーティーの編成は、村に帰ってからできます'); return false; }
    UI.open('party');
    render();
    return true;
  }
  async function hostRoom() {
    const custom = $('pt-custom').value.trim();
    if (custom && !N.roomFromText(custom)) { AU.error(); status(`合言葉は ${N.CUSTOM_MIN}〜${N.CUSTOM_MAX} 文字にしてください（空欄なら自動で決まります）。`, 'err'); return; }
    N.host(myName(), 'party');
    PT.view = 'room'; PT.roomCode = ''; PT.roomBusy = true;
    syncRoster();
    status('合言葉を準備しています…');
    render();
    $('pt-ready').focus(); // 押したボタンが隠れるので、次に使うボタンへ
    try {
      const code = await N.openRoom(custom || null);
      if (!isHost()) return;
      PT.roomCode = code;
      status(`合言葉「${code}」を友達に伝えてください。`, 'ok');
    } catch (e) {
      if (!isHost()) return;
      $('pt-code-host').open = true;
      status(`${e.message}（下の「コードで招待する」でもつなげます）`, 'err');
    }
    PT.roomBusy = false;
    render();
  }
  async function joinRoom() {
    if (PT.joining) return;
    PT.joining = true; PT.answer = '';
    status('パーティーをさがしています…（10秒ほどかかることがあります）');
    render();
    try {
      const code = $('pt-room-in').value;
      await N.joinRoom(myName(), code, 'party');
      PT.roomCode = (N.roomFromText(code) || {}).code || '';
      PT.view = 'room';
      syncRoster();
    } catch (e) { status(e.message, 'err'); }
    PT.joining = false;
    render();
    $(PT.on ? 'pt-ready' : 'pt-room-in').focus(); // 押したボタンが使えなくなる・隠れるので移す
  }

  // ======================================================================
  //  部屋主が決めること
  // ======================================================================
  function canDepart() {
    return isHost() && !PT.run && PT.list.size >= 2 && [...PT.list.values()].every((m) => m.ready && !m.busy);
  }
  function depart() {
    if (!canDepart()) return false;
    const ids = [...PT.list.keys()].sort();
    PT.down.clear(); PT.claimed.clear(); PT.gatherT = 0;
    N.locked = true;
    toAll({ t: 'go', seed: newSeed(), floor: 1, ids, sim: ids[0] });
    return true;
  }
  function endRun(kind) {
    N.locked = false;
    PT.down.clear(); PT.claimed.clear();
    toAll({ t: kind });
    PT.list.forEach((m) => { m.ready = false; });
    sendList();
  }
  function checkWipe() {
    if (PT.run && PT.run.ids.length && PT.run.ids.every((id) => PT.down.has(id))) endRun('wipe');
  }
  function removeFromRun(id) {
    if (!PT.run || !PT.run.ids.includes(id)) return;
    const ids = PT.run.ids.filter((x) => x !== id);
    PT.down.delete(id);
    if (!ids.length) { endRun('fin'); return; }
    toAll({ t: 'pr', ids, sim: ids.includes(PT.run.sim) ? PT.run.sim : ids[0] });
    checkWipe();
  }
  function hostMsg(from, m) {
    if (!PT.list.has(from)) return;
    if (m.t === 'me') { setProfile(from, m.p); sendList(); render(); return; }
    const R = PT.run;
    if (!R || !R.ids.includes(from)) return;
    if (m.t === 'out') { removeFromRun(from); return; }
    if (m.t === 'life') {
      if (m.a) PT.down.delete(from); else PT.down.add(from);
      checkWipe();
    } else if (m.t === 'claim') {
      const i = Math.round(num(m.i, 0, 999)), key = `${R.floor}:${i}`;
      if (m.fl !== R.floor || PT.claimed.has(key)) return;
      PT.claimed.add(key);
      toAll({ t: 'chest', fl: R.floor, i, by: from });
    }
  }
  function atHole(id) {
    const R = PT.run;
    if (!R) return false;
    const s = id === N.myId ? G.partyState() : PT.seen.get(id);
    return !!s && +s.n === R.floor && !!s.g && !s.dn;
  }
  function checkDescend(dt) {
    const R = PT.run;
    if (!isHost() || !R) return;
    // 下の階へは全員集合（残っている全員が、立って穴のそばにいる）
    if (!R.ids.length || !R.ids.every((id) => !PT.down.has(id) && atHole(id))) { PT.gatherT = 0; return; }
    PT.gatherT += dt;
    if (PT.gatherT < GATHER_SEC) return;
    PT.gatherT = 0;
    toAll({ t: 'fl', seed: newSeed(), floor: R.floor + 1, ids: R.ids.slice(), sim: R.sim });
  }

  // ======================================================================
  //  部屋主からの知らせ（部屋主自身も通る）
  // ======================================================================
  function runInfo(m, floor) {
    if (!Array.isArray(m.ids)) return null;
    const ids = [...new Set(m.ids.slice(0, 4).map(String).filter((id) => PID.test(id)))];
    if (!ids.length) return null;
    return { floor: Math.round(num(floor, 1, 999)), ids, sim: ids.includes(m.sim) ? m.sim : ids[0] };
  }
  function clearReady() {
    PT.ready = false; lastProfile = '';
    PT.list.forEach((x) => { x.ready = false; });
  }
  function control(m) {
    if (m.t === 'go') {
      const R = runInfo(m, 1);
      if (!R) return;
      PT.run = R;
      clearReady();
      if (R.ids.includes(N.myId)) {
        if (!$('title').hidden) $('btn-start').click();
        if (UI.isOpen()) UI.close(false);
        if (G.partyStart(Object.assign({ seed: Math.round(num(m.seed, 0, 1e9)) }, R))) {
          AU.start();
          if (!G.isTouch()) G.lockPointer();
          UI.toast('パーティーで出発！ パーティー中は、メニューを開いても時間は止まりません', 4000);
        } else toHost({ t: 'out' });
      }
    } else if (m.t === 'fl') {
      const R = runInfo(m, m.floor);
      if (!R || !PT.run) return;
      PT.run = R;
      if (inRun()) {
        if (UI.isOpen() === 'portal-confirm') UI.close();
        if (!G.partyFloor(Object.assign({ seed: Math.round(num(m.seed, 0, 1e9)) }, R))) toHost({ t: 'out' });
      }
    } else if (m.t === 'pr') {
      if (!PT.run) return;
      const R = runInfo(m, PT.run.floor);
      if (!R) return;
      if (inRun()) PT.run.ids.filter((id) => !R.ids.includes(id) && id !== N.myId).forEach((id) => { if (PT.list.has(id)) UI.toast(`${nameOf(id)} は探索を終えました`); });
      PT.run = R;
      G.partyPresent(R.ids, R.sim);
    } else if (m.t === 'chest') {
      const by = String(m.by);
      G.partyChest(+m.fl, Math.round(num(m.i, 0, 999)), by);
      if (by !== N.myId && inRun()) UI.toast(`${nameOf(by)} が宝箱を開けた`, 1800);
    } else if (m.t === 'wipe' || m.t === 'fin') {
      if (m.t === 'wipe' && inRun()) { if (UI.isOpen() === 'portal-confirm') UI.close(false); G.partyWipe(); }
      PT.run = null;
      clearReady();
      pushProfile();
    } else if (m.t === 'pl') {
      if (Array.isArray(m.l)) m.l.slice(0, 4).forEach((x) => { if (x && PT.list.has(x.id) && x.id !== N.myId) setProfile(x.id, x.p); });
      PT.run = m.run && typeof m.run === 'object' ? runInfo(m.run, m.run.floor) : null;
    }
    render();
  }

  // 名札や見た目に使う値は、知っているものだけ通す
  function cleanState(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const s = Object.assign({}, raw), el = (v) => (own(MG.ELEMENTS, v) ? v : 0);
    s.fl = el(s.fl); s.au = el(s.au); s.wd = el(s.wd);
    if (!own(MG.WAND_MAP, s.w) && s.w !== 'bare') delete s.w;
    s.sm = Array.isArray(s.sm) ? s.sm.filter((e) => Array.isArray(e) && own(MG.ELEMENTS, e[2])).slice(0, 5) : [];
    return s;
  }
  const words = (v) => (Array.isArray(v) ? v.slice(0, 4).map(String).filter((w) => own(MG.WORD_MAP, w)) : []);
  const CONTROL = new Set(['go', 'fl', 'pr', 'chest', 'wipe', 'fin', 'pl']);
  const TO_HOST = new Set(['me', 'out', 'life', 'claim']);
  const TO_ONE = new Set(['hurt', 'shit', 'eh', 'rev']);
  function onMessage(from, m) {
    if (!PT.on || !PT.list.has(from)) return;
    if (CONTROL.has(m.t)) { if (from === 'p0' && !isHost()) control(m); return; }
    if (TO_HOST.has(m.t)) { if (isHost() && m.to === 'p0') hostMsg(from, m); return; }
    if (TO_ONE.has(m.t) && m.to !== N.myId) return;
    if (m.t === 'st') {
      const s = cleanState(m.s);
      if (!s) return;
      PT.seen.set(from, s);
      G.partyUpdate(from, s);
      return;
    }
    if (m.t === 'cast' && (!m.c || !Array.isArray(m.c.seq) || words(m.c.seq).length !== m.c.seq.length)) return;
    if (m.t === 'circle') m.g = words(m.g);
    G.partyMsg(from, m);
  }

  // 通信の知らせは、部屋の種類で対戦とパーティーに分ける
  const VS = { onMessage: N.onMessage, onJoin: N.onJoin, onLeave: N.onLeave, onRoster: N.onRoster, onClosed: N.onClosed, onRoomError: N.onRoomError };
  const mine = () => N.kind === 'party';
  N.onMessage = (f, m, fast) => (mine() ? onMessage(f, m) : VS.onMessage(f, m, fast));
  N.onRoster = (list) => (mine() ? syncRoster() : VS.onRoster(list));
  N.onJoin = (id, name) => {
    if (!mine()) return VS.onJoin(id, name);
    AU.join();
    UI.toast(`${N.cleanName(name)} がパーティーに入りました`);
    PT.invite = '';
    sendList(); render();
  };
  N.onLeave = (id, why) => {
    if (!mine()) return VS.onLeave(id, why);
    PT.seen.delete(id);
    if (isHost()) { removeFromRun(id); sendList(); }
    render();
  };
  N.onClosed = (why) => {
    if (!mine()) return VS.onClosed(why);
    const was = inRun();
    closeParty('host');
    const msg = why === 'host-left' ? '部屋主がパーティーを閉じました。' : '部屋主との通信が切れました。';
    status(msg, 'err');
    UI.toast(msg + (was ? 'そこまでの成果を持って村へ帰りました。' : ''), 4000);
  };
  N.onRoomError = (msg) => {
    if (!mine()) return VS.onRoomError(msg);
    if (isHost() && !PT.run) status('つなぎ役のサーバーとの接続が切れました。つなぎ直しています…（つながっている仲間とはそのまま遊べます）', 'err');
  };

  Object.assign(G.coop.hook, {
    send: (msg, opt) => N.send(msg, opt),
    life: (alive) => toHost({ t: 'life', a: alive ? 1 : 0 }),
    claim: (fl, i) => toHost({ t: 'claim', fl, i }),
    left: () => { if (N.role && mine()) toHost({ t: 'out' }); },
    entrance: () => {
      if (PT.run) UI.toast('仲間の探索が終わると、次の出発ができます', 3000);
      else openParty();
    },
  });

  // ======================================================================
  //  編成の画面
  // ======================================================================
  let cardsHtml = '';
  function render() {
    const inRoom = PT.on;
    if (inRoom) PT.view = 'room'; else if (PT.view === 'room' && !N.role) PT.view = 'home';
    $('pt-home').hidden = PT.view !== 'home';
    $('pt-join').hidden = PT.view !== 'join';
    $('pt-room').hidden = PT.view !== 'room';
    $('pt-back').hidden = PT.view !== 'join';
    $('pt-leave').hidden = !inRoom;
    $('pt-leave').textContent = PT.leaveArm ? (isHost() ? 'もう一度押すと部屋が閉じる' : 'もう一度押すと抜ける') : 'パーティーを抜ける';
    $('pt-host-btn').disabled = !N.supported();
    $('pt-join-btn').disabled = !N.supported();
    $('pt-room-join').disabled = PT.joining;
    $('pt-answer-box').hidden = !PT.answer;
    $('pt-answer-out').value = PT.answer;
    if (!inRoom) return;
    $('pt-code').textContent = PT.roomCode || (PT.roomBusy ? '準備中…' : 'コードで招待');
    $('pt-copy').disabled = !PT.roomCode;
    const ids = [...PT.list.keys()].sort();
    let html = ids.map((id) => {
      const m = PT.list.get(id), away = PT.run && PT.run.ids.includes(id);
      const state = away ? '探索中' : m.ready ? '準備完了' : '準備中';
      return `<li class="pt-card${m.ready ? ' ready' : ''}${id === N.myId ? ' me' : ''}" style="--pc:${colorOf(id)}"><span class="pt-role">${id === 'p0' ? 'リーダー' : 'メンバー'}${id === N.myId ? '（あなた）' : ''}</span><b class="pt-name">${esc(m.name)}</b><span class="pt-lv">Lv ${m.lv}</span><span class="pt-wand">${esc(wandName(m.wand))}</span><span class="pt-state">${state}</span></li>`;
    }).join('');
    for (let i = ids.length; i < N.maxPlayers; i++) html += '<li class="pt-card empty"><span class="pt-role">空き</span><span>合言葉で招待</span></li>';
    if (html !== cardsHtml) { cardsHtml = html; $('pt-cards').innerHTML = html; }
    const me = PT.list.get(N.myId);
    $('pt-ready').textContent = me && me.ready ? '準備完了を取り消す' : '準備完了';
    $('pt-ready').disabled = !!PT.run;
    $('pt-ready').setAttribute('aria-pressed', String(!!(me && me.ready)));
    $('pt-depart').hidden = !isHost();
    $('pt-depart').disabled = !canDepart();
    $('pt-depart').textContent = PT.run ? '仲間が探索中' : PT.list.size < 2 ? '出発（仲間を待っています）' : canDepart() ? `出発（${PT.list.size}人）` : '出発（全員の準備待ち）';
    $('pt-wait').hidden = isHost();
    $('pt-wait').textContent = PT.run ? '仲間が探索中です。戻るのを待っています。' : '全員が準備完了になると、リーダーが出発できます。';
    $('pt-host-note').hidden = !(isHost() && PT.run);
    $('pt-code-host').hidden = !isHost() || !!PT.run || PT.list.size >= N.maxPlayers;
    $('pt-invite-box').hidden = !PT.invite;
    $('pt-invite-out').value = PT.invite;
  }
  function toggleReady() { if (!PT.on || PT.run) return; PT.ready = !PT.ready; pushProfile(); }
  async function copy(text, btn) {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch (e) {
      const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
      ta.remove();
    }
    btn.textContent = ok ? 'コピーしました' : 'コピーできませんでした';
    setTimeout(() => (btn.textContent = 'コピー'), 1600);
  }
  const click = (id, fn) => $(id).addEventListener('click', () => { AU.click(); fn($(id)); });

  $('pt-name').value = save().vsName || '';
  $('pt-name').addEventListener('input', () => {
    save().vsName = N.cleanName($('pt-name').value);
    try { localStorage.setItem('magia-lab-v1', JSON.stringify(save())); } catch (e) { /* 保存できなくても続ける */ }
  });
  click('pt-host-btn', hostRoom);
  click('pt-join-btn', () => { PT.view = 'join'; status('リーダーから聞いた合言葉を入れてください。'); render(); $('pt-room-in').focus(); });
  click('pt-room-join', joinRoom);
  $('pt-room-in').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); joinRoom(); } });
  click('pt-back', () => { N.leave(); PT.view = 'home'; PT.answer = ''; status(''); render(); });
  click('pt-copy', (b) => copy(`マギア・ラボで一緒に冒険しよう！ 合言葉: ${PT.roomCode}（「友達とパーティー」→「入る」で入力）`, b));
  click('pt-ready', toggleReady);
  click('pt-depart', depart);
  click('pt-leave', () => {
    if (!PT.leaveArm) { PT.leaveArm = true; render(); setTimeout(() => { PT.leaveArm = false; render(); }, 3000); return; }
    PT.leaveArm = false; leaveRoom();
  });
  click('pt-make-invite', async () => {
    status('招待コードを作っています…（数秒かかります）');
    try { PT.invite = await N.createInvite(); $('pt-answer-in').value = ''; status('招待コードを友達に送り、届いた返事コードを貼ってください。', 'ok'); } catch (e) { status(e.message, 'err'); }
    render();
  });
  click('pt-copy-invite', (b) => copy(PT.invite, b));
  click('pt-accept', async () => {
    try { await N.acceptAnswer($('pt-answer-in').value); status('つないでいます…（10秒ほどかかることがあります）'); } catch (e) { status(e.message, 'err'); }
  });
  click('pt-make-answer', async () => {
    status('返事コードを作っています…（数秒かかります）');
    try { PT.answer = await N.join(myName(), $('pt-invite-in').value, 'party'); status('返事コードをリーダーに送ってください。', 'ok'); } catch (e) { status(e.message, 'err'); }
    render();
  });
  click('pt-copy-answer', (b) => copy(PT.answer, b));
  $('btn-party-title').addEventListener('click', () => { $('btn-start').click(); openParty(); });
  click('menu-party', openParty);

  // ======================================================================
  //  画面の表示（左上の仲間・中央下の一時的な案内）
  // ======================================================================
  let hudHtml = '', promptHtml = '';
  function hud() {
    const show = PT.on && $('title').hidden && !G.match.on;
    $('pt-hud').hidden = !show;
    if (!show) { $('pt-prompt').hidden = true; promptHtml = ''; return; }
    const run = inRun();
    let html = run ? '' : `<div class="ph-title">パーティー${PT.roomCode ? `<small>${esc(PT.roomCode)}</small>` : ''}</div>`;
    [...PT.list.keys()].sort().forEach((id) => {
      if (id === N.myId) return;
      const m = PT.list.get(id), s = PT.seen.get(id) || {};
      const here = run && !!PT.run && PT.run.ids.includes(id);
      const away = !!PT.run && PT.run.ids.includes(id);
      const state = run ? (here ? (s.dn ? '倒れている' : '') : '帰還') : away ? '探索中' : m.ready ? '準備完了' : '';
      const hp = here ? num((+s.hp / +s.mh) * 100, 0, 100) : 0;
      html += `<div class="ph-row${here && s.dn ? ' down' : ''}" style="--pc:${colorOf(id)}"><div class="ph-line"><b>${esc(m.name)}</b><span>${state || 'Lv ' + m.lv}</span></div>${here ? `<div class="ph-bar"><i style="width:${hp.toFixed(0)}%"></i></div>` : ''}</div>`;
    });
    if (html !== hudHtml) { hudHtml = html; $('pt-hud').innerHTML = html; }

    let p = '';
    if (run && G.dun.alive) {
      const r = G.reviveInfo();
      if (r) p = `<kbd>F</kbd><b>${esc(r.name)}</b> を蘇生（4秒押し続ける）<div class="pp-bar"><i style="width:${Math.round(r.k * 100)}%"></i></div>`;
      else if (PT.run && G.atStairs()) {
        const n = PT.run.ids.filter(atHole).length;
        p = `<b>下の階へは全員集合</b> ${n} / ${PT.run.ids.length}`;
      }
    }
    if (p !== promptHtml) { promptHtml = p; $('pt-prompt').innerHTML = p; }
    $('pt-prompt').hidden = !p;
  }

  // ======================================================================
  //  定期の処理（画面が隠れても止まらないよう、Worker の時計で動かす）
  // ======================================================================
  let lastTick = performance.now(), lastFrame = lastTick, lastSend = 0, lastSync = 0, lastSlow = 0;
  function tick() {
    const now = performance.now(), dt = Math.min(2, (now - lastTick) / 1000);
    lastTick = now;
    if (!PT.on) { if (!$('pt-hud').hidden) hud(); return; }
    if (document.hidden || now - lastFrame > 500) G.bgStep(dt); // 描画が止まっている
    if (now - lastSend >= SEND_MS - 4) { lastSend = now; N.send({ t: 'st', s: G.partyState() }, { fast: true }); }
    if (now - lastSync >= SYNC_MS - 4) { lastSync = now; G.partySync(); checkDescend(0.1); hud(); }
    if (now - lastSlow >= 500) { lastSlow = now; pushProfile(); }
  }
  (function frame() { lastFrame = performance.now(); requestAnimationFrame(frame); })();
  function startClock() {
    const fallback = () => setInterval(tick, 34);
    try {
      const url = URL.createObjectURL(new Blob(['setInterval(function () { postMessage(0); }, 34);'], { type: 'application/javascript' }));
      const w = new Worker(url);
      w.onmessage = tick;
      w.onerror = fallback;
    } catch (e) { fallback(); }
  }
  startClock();

  PT.open = openParty;
  PT.render = render;

  // 動作確認用
  window.__pt = {
    host(name, custom) { $('pt-name').value = name; $('pt-custom').value = custom || ''; return hostRoom(); },
    join(name, code) { $('pt-name').value = name; $('pt-room-in').value = code; return joinRoom(); },
    invite: () => N.createInvite(),
    answer(name, code) { return N.join(name, code, 'party'); },
    accept: (code) => N.acceptAnswer(code),
    ready() { if (!PT.ready) toggleReady(); },
    depart, leave: leaveRoom, hud,
    info: () => ({ on: PT.on, kind: N.kind, me: N.myId, room: PT.roomCode, run: PT.run && JSON.parse(JSON.stringify(PT.run)), list: [...PT.list].map(([id, m]) => Object.assign({ id }, m)), status: $('pt-status').textContent }),
  };
})();
