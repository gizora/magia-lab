// 対戦の通信: WebRTC でブラウザどうしを直接つなぐ（ゲーム用のサーバーは使わない）
// つなぎ方は2つ:
//  ・合言葉（ふだん）: ホストが部屋を作ると「ほのお-1234」のような合言葉が出る → 友達が入力するとつながる。
//    最初の顔合わせ（接続情報の受け渡し）だけ、無料の PeerJS 公開サーバー（0.peerjs.com）に手伝ってもらう。対戦のデータは直接やりとりする。
//  ・コード（予備）: ホストが「招待コード」を作って友達に送る → 友達が貼り付けて「返事コード」を作り、ホストに送り返す → ホストが貼り付けるとつながる。
// 3人以上のときは、ホストが全員の通信を中継する（星形）。ホストの ID は p0、参加者は p1〜p3。
// 接続相手を見つけるために、無料の STUN サーバー（Google・Cloudflare）に自分の回線の IP アドレスを問い合わせる。
(function () {
  'use strict';
  const MG = (window.MG = window.MG || {});
  const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }, { urls: 'stun:stun.cloudflare.com:3478' }];
  const MAX_PLAYERS = 4;
  const PREFIX_I = 'MAGIA-INV-', PREFIX_A = 'MAGIA-ANS-';
  const MAX_MSG = 64 * 1024;
  const TIMEOUT_MS = 10000;

  const N = (MG.Net = {
    role: null, myId: null, myName: '', peers: new Map(), pending: new Map(), roster: [],
    ice: ICE, gatherMs: 3500, maxPlayers: MAX_PLAYERS,
    onMessage() {}, onJoin() {}, onLeave() {}, onRoster() {}, onClosed() {}, onState() {}, onRoomError() {},
    roomCode: '', rtc: null, locked: false, joinWaiter: null, roomTimeoutMs: 12000, joinTimeoutMs: 20000,
    stats: { sent: 0, recv: 0 },
  });

  // ---- コード（SDP を圧縮して文字列にする） ----
  function b64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function unb64(str) {
    const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  async function pack(obj) {
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    if (window.CompressionStream) {
      const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      return 'z' + b64(new Uint8Array(await new Response(stream).arrayBuffer()));
    }
    return 'j' + b64(bytes);
  }
  async function unpack(code, prefix) {
    const c = String(code || '').replace(/\s+/g, '');
    if (!c.startsWith(prefix)) {
      if (c.startsWith(prefix === PREFIX_I ? PREFIX_A : PREFIX_I)) throw new Error(prefix === PREFIX_I ? 'これは「返事コード」です。友達から届いた「招待コード」を貼り付けてください' : 'これは「招待コード」です。友達から届いた「返事コード」を貼り付けてください');
      throw new Error('コードの形がちがいます。最初から最後まで、まるごとコピーして貼り付けてください');
    }
    const body = c.slice(prefix.length);
    let bytes;
    try { bytes = unb64(body.slice(1)); } catch (e) { throw new Error('コードが途中で切れているようです。まるごとコピーし直してください'); }
    let json;
    try {
      if (body[0] === 'z') {
        if (!window.DecompressionStream) throw new Error('このブラウザでは読めません');
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        json = await new Response(stream).text();
      } else json = new TextDecoder().decode(bytes);
      const d = JSON.parse(json);
      if (!d || d.v !== 1 || typeof d.s !== 'string' || typeof d.id !== 'string') throw new Error('bad');
      return d;
    } catch (e) { throw new Error('コードが途中で切れているようです。まるごとコピーし直してください'); }
  }
  const cleanName = (s) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12) || '名無しの魔法使い';
  N.cleanName = cleanName;

  // ICE の候補（つなぎ先の住所）を集め終わるのを待つ。STUN に届かないときは時間で打ち切る
  function gathered(pc) {
    return new Promise((res) => {
      if (pc.iceGatheringState === 'complete') return res();
      const t = setTimeout(res, N.gatherMs);
      pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } });
    });
  }

  function reset() {
    killRtc(); roomKeys.clear(); N.joinWaiter = null;
    N.peers.forEach((p) => { try { p.close(); } catch (e) { /* 閉じ済み */ } });
    N.pending.forEach((p) => { try { p.close(); } catch (e) { /* 閉じ済み */ } });
    N.peers.clear(); N.pending.clear();
    N.role = null; N.myId = null; N.roster = []; N.hostName = '';
  }

  // ---- つなぐ ----
  function makePeer(pid) {
    const pc = new RTCPeerConnection({ iceServers: N.ice });
    const peer = { pid, pc, ev: null, st: null, name: '…', open: false, lastSeen: performance.now(), state: 'new' };
    peer.close = () => pc.close();
    pc.addEventListener('connectionstatechange', () => {
      peer.state = pc.connectionState;
      N.onState(pid, pc.connectionState);
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') drop(pid, pc.connectionState);
    });
    return peer;
  }
  function wireChannel(peer, ch, label) {
    label = label || ch.label;
    if (label === 'ev') peer.ev = ch; else peer.st = ch;
    ch.addEventListener('open', () => checkOpen(peer));
    // 頻繁な情報用（st）が切れても、確実に届く方（ev）で送り続ける
    ch.addEventListener('close', () => { if (label !== 'ev') { if (peer.st === ch) peer.st = null; return; } if (peer.open) drop(peer.pid, 'closed'); });
    ch.addEventListener('message', (e) => receive(peer, e.data, label === 'st'));
  }
  function checkOpen(peer) {
    if (peer.open || !peer.ev || peer.ev.readyState !== 'open') return;
    peer.open = true; peer.lastSeen = performance.now();
    N.pending.delete(peer.pid);
    N.peers.set(peer.pid, peer);
    if (N.role === 'guest') rawSend(peer, { t: 'hello', name: N.myName, f: N.myId });
    else {
      // 合言葉で来た人には、番号（p1〜p3）を教える。名前は、直接つながってから届く hello で知らせる（つなぎ役のサーバーには名前を渡さない）
      if (peer.room) { rawSend(peer, { t: 'welcome', id: peer.pid, h: N.myName, v: PROTO }); return; }
      publishRoster(); N.onJoin(peer.pid, peer.name);
    }
  }

  // ホスト: 部屋を作る
  N.host = function (name) {
    reset();
    N.role = 'host'; N.myId = 'p0'; N.myName = cleanName(name);
    publishRoster();
  };
  function nextPid() {
    for (let i = 1; i < MAX_PLAYERS; i++) { const id = 'p' + i; if (!N.peers.has(id) && !N.pending.has(id)) return id; }
    return null;
  }
  // ホスト: 招待コードを作る（1人につき1つ）
  N.createInvite = async function () {
    if (N.role !== 'host') throw new Error('部屋を作ってから招待してください');
    // 返事がまだ来ていない招待は作り直す（同じ番号を使い回す）
    N.pending.forEach((p, id) => { if (!p.answered) { try { p.close(); } catch (e) { /* */ } N.pending.delete(id); } });
    const pid = nextPid();
    if (!pid) throw new Error(`この部屋は満員です（${MAX_PLAYERS}人まで）`);
    const peer = makePeer(pid);
    N.pending.set(pid, peer);
    wireChannel(peer, peer.pc.createDataChannel('ev', { ordered: true }));
    wireChannel(peer, peer.pc.createDataChannel('st', { ordered: false, maxRetransmits: 0 }));
    await peer.pc.setLocalDescription(await peer.pc.createOffer());
    await gathered(peer.pc);
    return PREFIX_I + (await pack({ v: 1, s: peer.pc.localDescription.sdp, id: pid, h: N.myName }));
  };
  // ホスト: 友達の返事コードを受け取る
  N.acceptAnswer = async function (code) {
    if (N.role !== 'host') throw new Error('部屋を作ってから貼り付けてください');
    const d = await unpack(code, PREFIX_A);
    const peer = N.pending.get(d.id);
    if (!peer) throw new Error('この返事コードに対応する招待が見つかりません。招待コードを作り直して、もう一度送ってください');
    if (peer.answered) throw new Error('この返事コードは、もう受け取っています');
    peer.answered = true;
    peer.name = cleanName(d.n);
    await peer.pc.setRemoteDescription({ type: 'answer', sdp: d.s });
    return peer.pid;
  };
  // 参加者: 招待コードから返事コードを作る
  N.join = async function (name, code) {
    const d = await unpack(code, PREFIX_I);
    reset();
    N.role = 'guest'; N.myName = cleanName(name); N.myId = d.id; N.hostName = cleanName(d.h);
    const peer = makePeer('p0');
    peer.name = N.hostName;
    N.pending.set('p0', peer);
    peer.pc.addEventListener('datachannel', (e) => wireChannel(peer, e.channel));
    await peer.pc.setRemoteDescription({ type: 'offer', sdp: d.s });
    await peer.pc.setLocalDescription(await peer.pc.createAnswer());
    await gathered(peer.pc);
    return PREFIX_A + (await pack({ v: 1, s: peer.pc.localDescription.sdp, id: d.id, n: N.myName }));
  };

  // ---- 送る・受け取る ----
  function rawSend(peer, msg, fast) {
    const ch = fast && peer.st && peer.st.readyState === 'open' ? peer.st : peer.ev;
    if (!ch || ch.readyState !== 'open') return false;
    try { ch.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); N.stats.sent++; return true; } catch (e) { return false; }
  }
  // msg: { t: 種類, ... }。opt.to: 相手の ID（なければ全員）、opt.fast: 届かなくてもよい頻繁な情報（位置など）
  N.send = function (msg, opt) {
    opt = opt || {};
    if (!N.role) return;
    msg.f = N.myId;
    if (opt.to) msg.to = opt.to;
    const s = JSON.stringify(msg);
    if (N.role === 'host') {
      if (opt.to) { const p = N.peers.get(opt.to); if (p) rawSend(p, s, opt.fast); }
      else N.peers.forEach((p) => rawSend(p, s, opt.fast));
    } else {
      const h = N.peers.get('p0'); if (h) rawSend(h, s, opt.fast);
    }
  };
  function receive(peer, data, fast) {
    peer.lastSeen = performance.now();
    if (typeof data !== 'string' || data.length > MAX_MSG) return;
    let msg;
    try { msg = JSON.parse(data); } catch (e) { return; }
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
    N.stats.recv++;
    if (N.role === 'host') {
      msg.f = peer.pid; // 送り主は、つながっている相手で決める（なりすまし防止）
      if (msg.t === 'hello') { peer.name = cleanName(msg.name); publishRoster(); N.onJoin(peer.pid, peer.name); return; }
      if (msg.t === 'bye') { drop(peer.pid, 'bye'); return; }
      if (msg.t === 'ping') return;
      // ほかの参加者への中継
      if (!msg.to) { const s = JSON.stringify(msg); N.peers.forEach((p) => { if (p !== peer) rawSend(p, s, fast); }); }
      else if (msg.to !== N.myId) { const p = N.peers.get(msg.to); if (p) rawSend(p, JSON.stringify(msg), fast); return; }
    } else {
      if (msg.t === 'roster') { N.roster = Array.isArray(msg.list) ? msg.list.slice(0, MAX_PLAYERS).map((r) => ({ id: String(r.id), name: cleanName(r.name) })) : []; N.onRoster(N.roster); return; }
      if (msg.t === 'bye' && msg.f === 'p0') { drop('p0', 'bye'); return; }
      if (msg.t === 'welcome') { N.myId = String(msg.id).slice(0, 3); N.hostName = cleanName(msg.h); peer.name = N.hostName; if (N.joinWaiter) N.joinWaiter.ok(); return; }
      if (msg.t === 'deny') { if (N.joinWaiter) N.joinWaiter.fail(msg.why === 'busy' ? 'その部屋は対戦中です。対戦が終わってから入り直してください' : `その部屋は満員です（${MAX_PLAYERS}人まで）`); return; }
      if (msg.t === 'ping') return;
    }
    N.onMessage(msg.f, msg, fast);
  }
  function publishRoster() {
    if (N.role !== 'host') return;
    N.roster = [{ id: N.myId, name: N.myName }].concat([...N.peers.values()].map((p) => ({ id: p.pid, name: p.name })));
    N.send({ t: 'roster', list: N.roster });
    N.onRoster(N.roster);
  }

  function drop(pid, why) {
    const p = N.peers.get(pid) || N.pending.get(pid);
    if (!p) return;
    const wasOpen = p.open;
    p.open = false;
    // 先に一覧から外してから閉じる（閉じたときの知らせで、同じ片付けがもう一度走らないように）
    N.peers.delete(pid); N.pending.delete(pid);
    if (p.key) roomKeys.delete(p.key);
    try { p.close(); } catch (e) { /* 閉じ済み */ }
    if (N.role === 'host') { if (wasOpen) { publishRoster(); N.onLeave(pid, why); } }
    else if (pid === 'p0' && N.role) { const r = N.role; reset(); if (r) N.onClosed(why === 'bye' ? 'host-left' : 'lost'); }
  }
  N.kick = (pid) => drop(pid, 'kick');
  N.cancelInvite = function () { N.pending.forEach((p, id) => { if (!p.answered) { try { p.close(); } catch (e) { /* */ } N.pending.delete(id); } }); };

  // 定期的に呼ぶ: 応答のない相手を切る・つながっていることを知らせる
  N.tick = function () {
    if (!N.role) return;
    const now = performance.now();
    N.peers.forEach((p, id) => { if (now - p.lastSeen > TIMEOUT_MS) drop(id, 'timeout'); else rawSend(p, { t: 'ping', f: N.myId }); });
  };
  setInterval(N.tick, 2000);

  N.leave = function () {
    if (!N.role) return;
    N.send({ t: 'bye' });
    const peers = [...N.peers.values()], rtc = N.rtc;
    setTimeout(() => { peers.forEach((p) => { try { p.close(); } catch (e) { /* */ } }); if (rtc) { try { rtc.destroy(); } catch (e) { /* */ } } }, 150);
    N.pending.forEach((p) => { try { p.close(); } catch (e) { /* */ } });
    N.peers.clear(); N.pending.clear(); roomKeys.clear();
    N.rtc = null; N.roomCode = ''; N.joinWaiter = null; N.locked = false;
    N.role = null; N.myId = null; N.roster = [];
  };
  window.addEventListener('beforeunload', () => { if (N.role) N.send({ t: 'bye' }); });

  // ======================================================================
  //  合言葉の部屋
  // ======================================================================
  const PROTO = 25; // ゲームの版。版がちがうと、同じ合言葉でも別の部屋になる（混ざらない）。対戦のやりとりや、対戦の公平さにかかわる決まりが変わったら上げる
  const ID_PREFIX = 'magia-lab-' + PROTO + '-';
  // 合言葉のことば（どれも、ほかのことばの頭と重ならない）
  const WORDS = ['ほのお', 'こおり', 'かみなり', 'ほし', 'つき', 'たいよう', 'かぜ', 'みず', 'もり', 'やま', 'うみ', 'そら', 'にじ', 'ゆき', 'あめ', 'くも',
    'はな', 'いし', 'ひかり', 'りゅう', 'ねこ', 'とり', 'くじら', 'きのこ', 'りんご', 'みかん', 'さくら', 'もみじ', 'ほうき', 'つえ', 'まほう', 'おしろ'];
  N.ROOM_WORDS = WORDS;
  const roomKeys = new Map(); // 合言葉で来た相手の PeerJS の ID → p1〜p3
  // 全角・カタカナ・空白・「-」のちがいは気にしない
  function normRoom(s) {
    return String(s || '').normalize('NFKC').replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60)).replace(/[\s\-ー_・.,、。「」]/g, '');
  }
  N.parseRoom = function (s) {
    const n = normRoom(s);
    for (let i = 0; i < WORDS.length; i++) {
      if (!n.startsWith(WORDS[i])) continue;
      const d = n.slice(WORDS[i].length);
      if (/^\d{4}$/.test(d)) return { code: WORDS[i] + '-' + d, id: ID_PREFIX + i + '-' + d };
    }
    return null;
  };
  // 自分で決めた合言葉: ひらがな・カタカナ・漢字・英数字の 2〜24 文字。カタカナ／ひらがな、全角／半角、英字の大文字／小文字、空白や「-」は区別しない。
  // つなぎ役のサーバーには合言葉そのものは送らず、合言葉から計算した記号の列（部屋の番号）だけを使う。
  const CUSTOM_MIN = 2, CUSTOM_MAX = 24;
  function fnv(str, seed) { let h = seed >>> 0; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16).padStart(8, '0'); }
  // 入力された合言葉 → 部屋（自動の「ことば-4けた」の形ならその部屋、ほかは自分で決めた合言葉の部屋）。使えなければ null
  N.roomFromText = function (s) {
    const auto = N.parseRoom(s);
    if (auto) return auto;
    const shown = String(s || '').normalize('NFKC').replace(/[\u0000-\u001f<>]/g, '').trim().replace(/\s+/g, ' ');
    const n = normRoom(shown).toLowerCase();
    const len = Array.from(n).length;
    if (len < CUSTOM_MIN || len > CUSTOM_MAX) return null;
    return { code: shown, id: ID_PREFIX + 'c-' + fnv(n, 2166136261) + fnv(n, 3735928559), custom: true };
  };
  N.CUSTOM_MIN = CUSTOM_MIN; N.CUSTOM_MAX = CUSTOM_MAX;
  function newRoom() { return N.parseRoom(WORDS[Math.floor(Math.random() * WORDS.length)] + String(Math.floor(Math.random() * 10000)).padStart(4, '0')); }
  const randKey = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 8);
  const peerOpts = () => ({ debug: 0, config: { iceServers: N.ice } });
  N.roomSupported = () => typeof window.Peer === 'function' && N.supported();
  function killRtc() { if (N.rtc) { try { N.rtc.destroy(); } catch (e) { /* 片付け済み */ } } N.rtc = null; N.roomCode = ''; }
  const NAT_MSG = 'つながりませんでした。回線の組み合わせによっては、直接つながらないことがあります（会社・学校の回線や、一部のスマホのテザリングなど）。別の回線で試してください。';
  function rtcError(type) {
    if (type === 'peer-unavailable') return 'その合言葉の部屋が見つかりません。合言葉が合っているか、部屋を作った人がロビーを開いたままか、同じ版のゲームを使っているかを確かめてください。';
    if (type === 'browser-incompatible') return 'このブラウザでは使えません。Edge や Chrome の最新版で開いてください。';
    return 'つなぎ役のサーバーに届きませんでした。インターネットにつながっているか確かめてください。だめなときは、下の「コードでつなぐ（予備）」を使ってください。';
  }

  // ホスト: 合言葉を決めて、部屋を開く（N.host のあとに呼ぶ）。合言葉が返る。custom: 自分で決めた合言葉（省略すると自動で決める）
  N.openRoom = function (custom) {
    if (N.role !== 'host') return Promise.reject(new Error('部屋を作ってから開いてください'));
    if (!N.roomSupported()) return Promise.reject(new Error(rtcError('browser-incompatible')));
    let fixed = null;
    if (custom != null && String(custom).trim()) {
      fixed = N.roomFromText(custom);
      if (!fixed) return Promise.reject(new Error(`合言葉は ${CUSTOM_MIN}〜${CUSTOM_MAX} 文字にしてください（ひらがな・カタカナ・漢字・英数字）。`));
    }
    killRtc();
    return new Promise((resolve, reject) => {
      let tries = 0, done = false;
      const attempt = () => {
        const room = fixed || newRoom();
        const rtc = new window.Peer(room.id, peerOpts());
        N.rtc = rtc;
        const timer = setTimeout(() => { if (!done && N.rtc === rtc) { done = true; killRtc(); reject(new Error(rtcError('network'))); } }, N.roomTimeoutMs);
        rtc.on('open', () => { if (done || N.rtc !== rtc) return; done = true; clearTimeout(timer); N.roomCode = room.code; resolve(room.code); });
        rtc.on('error', (e) => {
          if (N.rtc !== rtc) return;
          if (!done && e.type === 'unavailable-id' && fixed) { done = true; clearTimeout(timer); killRtc(); reject(new Error(`合言葉「${fixed.code}」は、いまほかの部屋で使われています。別の合言葉にしてください。`)); return; }
          if (!done && e.type === 'unavailable-id' && tries++ < 6) { clearTimeout(timer); try { rtc.destroy(); } catch (x) { /* */ } attempt(); return; } // 自動の合言葉が使用中なら作り直す
          if (!done) { done = true; clearTimeout(timer); killRtc(); reject(new Error(rtcError(e.type))); return; }
          if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(e.type)) N.onRoomError(rtcError(e.type));
        });
        // サーバーとの接続が切れたら、同じ合言葉でつなぎ直す（つながっている友達との対戦はそのまま続く）
        rtc.on('disconnected', () => { setTimeout(() => { try { if (N.rtc === rtc && rtc.disconnected && !rtc.destroyed) rtc.reconnect(); } catch (x) { /* */ } }, 2000); });
        rtc.on('connection', (conn) => { if (N.rtc === rtc) onRoomConn(conn); else { try { conn.close(); } catch (x) { /* */ } } });
      };
      attempt();
    });
  };
  function makeRoomPeer(pid) {
    const peer = { pid, conns: [], ev: null, st: null, name: '…', open: false, lastSeen: performance.now(), state: 'new', room: true };
    peer.close = () => peer.conns.forEach((c) => { try { c.close(); } catch (e) { /* */ } });
    return peer;
  }
  function attachConn(peer, conn) {
    peer.conns.push(conn);
    const label = conn.label === 'st' ? 'st' : 'ev';
    const ready = () => { if (conn.dataChannel) { wireChannel(peer, conn.dataChannel, label); checkOpen(peer); } };
    if (conn.open) ready(); else conn.on('open', ready);
    conn.on('close', () => { if (label === 'ev' && (N.peers.get(peer.pid) === peer || N.pending.get(peer.pid) === peer)) drop(peer.pid, 'closed'); });
    conn.on('error', () => { /* 閉じたときの処理（close）にまかせる */ });
  }
  // ホスト: 合言葉で友達が来た
  function onRoomConn(conn) {
    if (N.role !== 'host') { try { conn.close(); } catch (e) { /* */ } return; }
    let pid = roomKeys.get(conn.peer);
    let peer = pid ? N.peers.get(pid) || N.pending.get(pid) : null;
    if (!peer) {
      pid = N.locked ? null : nextPid();
      if (!pid) { // 満員か、対戦中
        const why = N.locked ? 'busy' : 'full';
        conn.on('open', () => { try { conn.dataChannel.send(JSON.stringify({ t: 'deny', why, f: 'p0' })); } catch (e) { /* */ } setTimeout(() => { try { conn.close(); } catch (e) { /* */ } }, 500); });
        return;
      }
      peer = makeRoomPeer(pid);
      peer.key = conn.peer;
      roomKeys.set(conn.peer, pid);
      N.pending.set(pid, peer);
      setTimeout(() => { if (N.pending.get(pid) === peer) drop(pid, 'timeout'); }, 30000); // つながらないまま時間がたったら片付ける
    }
    attachConn(peer, conn);
  }
  // 参加者: 合言葉で部屋に入る（つながると自分の番号が返る）
  N.joinRoom = function (name, code) {
    const room = N.roomFromText(code);
    if (!room) return Promise.reject(new Error(`合言葉を入れてください（${CUSTOM_MIN}〜${CUSTOM_MAX} 文字。「ほのお-1234」や、部屋を作った人が決めた合言葉）。`));
    if (!N.roomSupported()) return Promise.reject(new Error(rtcError('browser-incompatible')));
    reset();
    N.role = 'guest'; N.myName = cleanName(name); N.myId = null;
    return new Promise((resolve, reject) => {
      let done = false, asked = false;
      const rtc = new window.Peer(ID_PREFIX + 'g-' + randKey(), peerOpts());
      N.rtc = rtc;
      const fail = (msg) => { if (done) return; done = true; clearTimeout(timer); reset(); reject(new Error(msg)); };
      const timer = setTimeout(() => fail(asked ? NAT_MSG : rtcError('network')), N.joinTimeoutMs);
      N.joinWaiter = { ok: () => { if (done) return; done = true; clearTimeout(timer); N.joinWaiter = null; resolve(N.myId); }, fail };
      rtc.on('error', (e) => { if (N.rtc === rtc && !done) fail(rtcError(e.type)); });
      rtc.on('open', () => {
        if (done || N.rtc !== rtc) return;
        asked = true;
        const peer = makeRoomPeer('p0');
        N.pending.set('p0', peer);
        const meta = { v: PROTO }; // 名前はここに入れない（サーバーを通るため）
        attachConn(peer, rtc.connect(room.id, { label: 'ev', serialization: 'raw', reliable: true, metadata: meta }));
        attachConn(peer, rtc.connect(room.id, { label: 'st', serialization: 'raw', reliable: false, metadata: meta }));
      });
    });
  };

  N.connectedCount = () => N.peers.size;
  N.supported = () => typeof RTCPeerConnection === 'function';
  N.prefixes = { invite: PREFIX_I, answer: PREFIX_A };
})();
