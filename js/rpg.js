// 成長のルール（第26版）: レベル・経験値・能力・ことばのつなげられる数・杖の値段・ダンジョンの敵
// ここは数字と計算だけ（画面や 3D には触らない）。game.js と ui.js から使う
(function () {
  'use strict';
  const MG = (window.MG = window.MG || {});
  const R = (MG.RPG = {});

  R.MAX_LV = 60;
  // レベル L から L+1 に上がるのに必要な経験値
  R.xpNeed = (L) => Math.round(30 * Math.pow(L, 1.55) + 20);
  // ことばをいくつまでつなげられるか（3 語は Lv5、4 語は Lv12 で封印が解ける）
  R.CHAIN_LV = { 3: 5, 4: 12 };
  R.chainMax = (L) => (L >= R.CHAIN_LV[4] ? 4 : L >= R.CHAIN_LV[3] ? 3 : 2);
  R.sealLevel = (n) => (n >= 4 ? R.CHAIN_LV[4] : n === 3 ? R.CHAIN_LV[3] : 1);

  // レベルアップで上がる能力。毎回 MP が上がり、さらに下のどれか 1 つがランダムで上がる
  R.MP_PER_LV = 6;
  R.HP_PER_LV = 4;
  R.STATS = {
    hp:    { label: '最大HP',     per: 14,   fmt: (v) => `+${v}`,                       max: 99 },
    mp:    { label: '最大MP',     per: 8,    fmt: (v) => `+${v}`,                       max: 99 },
    regen: { label: 'MPの回復',   per: 1,    fmt: (v) => `+${v}/秒`,                    max: 99 },
    power: { label: '魔法の威力', per: 0.04, fmt: (v) => `+${Math.round(v * 100)}%`,    max: 15 },
    speed: { label: '足の速さ',   per: 0.03, fmt: (v) => `+${Math.round(v * 100)}%`,    max: 10 },
    cd:    { label: '待ち時間',   per: 0.03, fmt: (v) => `-${Math.round(v * 100)}%`,    max: 10 },
  };
  R.STAT_IDS = Object.keys(R.STATS);
  // まだ上限に届いていない能力から 1 つ選ぶ（rnd は 0〜1 を返す関数）
  R.rollStat = function (stats, rnd) {
    const ok = R.STAT_IDS.filter((id) => (stats[id] || 0) < R.STATS[id].max);
    const pool = ok.length ? ok : ['hp', 'mp'];
    return pool[Math.floor((rnd || Math.random)() * pool.length) % pool.length];
  };
  R.newProgress = () => ({ level: 1, xp: 0, stats: { hp: 0, mp: 0, regen: 0, power: 0, speed: 0, cd: 0 } });
  // レベルと上がった能力から、実際の数値を出す
  R.derive = function (p) {
    const L = p.level, s = p.stats || {};
    return {
      maxHp: 150 + (L - 1) * R.HP_PER_LV + (s.hp || 0) * R.STATS.hp.per,
      mpMax: 60 + (L - 1) * R.MP_PER_LV + (s.mp || 0) * R.STATS.mp.per,
      mpRegen: 10 + (s.regen || 0) * R.STATS.regen.per,
      power: 1 + (s.power || 0) * R.STATS.power.per,
      speed: 1 + (s.speed || 0) * R.STATS.speed.per,
      cdMul: 1 - (s.cd || 0) * R.STATS.cd.per,
      chain: R.chainMax(L),
    };
  };
  // 経験値を足して、上がったレベルの一覧を返す（rnd を渡すと能力の選び方を決められる）
  R.addXp = function (p, n, rnd) {
    const ups = [];
    p.xp += Math.max(0, Math.round(n));
    while (p.level < R.MAX_LV && p.xp >= R.xpNeed(p.level)) {
      p.xp -= R.xpNeed(p.level);
      p.level++;
      const stat = R.rollStat(p.stats, rnd);
      p.stats[stat] = (p.stats[stat] || 0) + 1;
      ups.push({ level: p.level, stat, unlock: Object.keys(R.CHAIN_LV).find((k) => R.CHAIN_LV[k] === p.level) || null });
    }
    if (p.level >= R.MAX_LV) p.xp = 0;
    return ups;
  };
  R.cloneProgress = (p) => ({ level: p.level, xp: p.xp, stats: Object.assign({}, p.stats) });
  R.validProgress = function (p) {
    const q = R.newProgress();
    if (!p || typeof p !== 'object') return q;
    q.level = Math.max(1, Math.min(R.MAX_LV, Math.round(+p.level) || 1));
    q.xp = Math.max(0, Math.round(+p.xp) || 0);
    R.STAT_IDS.forEach((id) => { q.stats[id] = Math.max(0, Math.min(R.STATS[id].max, Math.round(+(p.stats || {})[id]) || 0)); });
    return q;
  };

  // ---- お店 ----
  R.WAND_PRICE = { novice: 0, gale: 250, pierce: 450, sage: 700, destruction: 1100 };
  R.POTION = { price: 30, heal: 70, max: 9 };
  R.START_GOLD = 100;

  // ---- ダンジョン ----
  // 敵の種類。hp・dmg は 1 階の値（深い階ほど強くなる）。range は攻撃が届く距離
  R.ENEMIES = {
    slime:    { label: 'スライム',     hp: 45,  dmg: 8,  speed: 3.0, range: 1.7, atkCd: 1.6, xp: 6,   gold: 3,  r: 0.85, cy: 0.6 },
    skeleton: { label: '骸骨兵',       hp: 70,  dmg: 12, speed: 4.3, range: 2.1, atkCd: 1.3, xp: 10,  gold: 5,  r: 0.7,  cy: 1.1 },
    bat:      { label: '影コウモリ',   hp: 30,  dmg: 6,  speed: 6.0, range: 1.6, atkCd: 1.0, xp: 7,   gold: 3,  r: 0.6,  cy: 0.1, fly: true }, // cy は飛ぶ高さからの体の中心（第33版で 2.2 → 0.1）
    mage:     { label: '闇の魔導士',   hp: 50,  dmg: 10, speed: 3.2, range: 15,  atkCd: 2.2, xp: 12,  gold: 6,  r: 0.7,  cy: 1.1, ranged: true },
    boss:     { label: '石の守護者',   hp: 480, dmg: 26, speed: 2.6, range: 4.2, atkCd: 2.4, xp: 160, gold: 120, r: 2.4, cy: 2.6, boss: true, farShot: 26, rock: true, bolt: ['#a89070'] }, // 第37版: 離れた相手に岩を投げる
    // 第36版: 深い階の敵（地下 6 階から）。bolt は撃つ弾の色、spread は一度に撃つ弾の数、flyY は飛ぶ高さ、barY は HP のバーの高さ
    spider:     { label: '大グモ',       hp: 60,  dmg: 12, speed: 5.4, range: 1.9, atkCd: 1.1, xp: 14,  gold: 7,   r: 0.9,  cy: 0.6 },
    goblin:     { label: 'ゴブリン',     hp: 72,  dmg: 13, speed: 4.6, range: 2.0, atkCd: 1.2, xp: 14,  gold: 9,   r: 0.6,  cy: 0.85 },
    mimic:      { label: 'ミミック',     hp: 120, dmg: 22, speed: 3.6, range: 2.0, atkCd: 1.4, xp: 30,  gold: 45,  r: 0.85, cy: 0.5, mimic: true },
    armor:      { label: '動く鎧',       hp: 150, dmg: 18, speed: 3.2, range: 2.4, atkCd: 1.6, xp: 24,  gold: 12,  r: 0.8,  cy: 1.2 },
    wraith:     { label: 'レイス',       hp: 75,  dmg: 15, speed: 5.0, range: 1.9, atkCd: 1.2, xp: 20,  gold: 10,  r: 0.7,  cy: 0.4, fly: true, flyY: 1.8 },
    gargoyle:   { label: 'ガーゴイル',   hp: 95,  dmg: 16, speed: 5.5, range: 1.9, atkCd: 1.2, xp: 22,  gold: 11,  r: 0.8,  cy: 0.1, fly: true },
    salamander: { label: 'サラマンダー', hp: 85,  dmg: 15, speed: 4.0, range: 13,  atkCd: 2.0, xp: 22,  gold: 11,  r: 0.9,  cy: 0.5, ranged: true, bolt: ['#ff7a20', '#ffd24a'], boltY: 0.1, boltEl: 'fire' },
    ifrit:      { label: 'イフリート',   hp: 140, dmg: 21, speed: 3.8, range: 2.5, atkCd: 1.5, xp: 30,  gold: 15,  r: 0.95, cy: 1.4 },
    // 守護者（5 階ごと）
    minotaur:   { label: 'ミノタウロス', hp: 520, dmg: 28, speed: 3.0, range: 4.4, atkCd: 2.2, xp: 220, gold: 160, r: 1.7,  cy: 2.3, boss: true, rangedEvery: 0, barY: 5.8 },
    lich:       { label: 'リッチ',       hp: 430, dmg: 24, speed: 2.6, range: 16,  atkCd: 2.0, xp: 260, gold: 200, r: 1.0,  cy: 1.6, boss: true, ranged: true, spread: 3, bolt: ['#4ac8ff', '#ff7a20'], boltY: 0.5, boltEl: 'void', barY: 3.8 },
    dragon:     { label: 'ドラゴン',     hp: 640, dmg: 30, speed: 2.4, range: 5.2, atkCd: 2.4, xp: 320, gold: 260, r: 2.8,  cy: 2.6, boss: true, rangedEvery: 2, spread: 5, bolt: ['#ff6a10', '#ffd24a'], boltY: 1.3, boltEl: 'fire', barY: 7.8 },
    iceking:    { label: '氷の王',       hp: 600, dmg: 30, speed: 2.8, range: 3.6, atkCd: 2.1, xp: 400, gold: 320, r: 1.3,  cy: 1.9, boss: true, spread: 3, bolt: ['#8ae0ff', '#ffffff'], boltY: 1.0, boltEl: 'ice', barY: 5.8 },
  };
  // 第36版: 5 階ごとの地域。地域ごとに出る敵・守護者・ダンジョンの色が変わる（地下 25 階より深い階は、守護者が順に入れかわる）
  R.AREAS = [
    { id: 0, name: '地下牢', boss: 'boss', pool: [['slime', 5], ['skeleton', 4], ['bat', 3], ['mage', 3]] },
    { id: 1, name: '古い坑道', boss: 'minotaur', pool: [['spider', 5], ['goblin', 5], ['bat', 2], ['mage', 1]] },
    { id: 2, name: '呪われた墓所', boss: 'lich', pool: [['armor', 4], ['wraith', 4], ['gargoyle', 4], ['skeleton', 2]] },
    { id: 3, name: '溶岩の深層', boss: 'dragon', pool: [['salamander', 5], ['ifrit', 4], ['gargoyle', 2], ['mage', 1]] },
    { id: 4, name: '凍てつく玉座', boss: 'iceking', pool: [['armor', 3], ['wraith', 3], ['ifrit', 3], ['spider', 2], ['goblin', 2], ['salamander', 2]] },
  ];
  R.LAST_FLOOR = 25;
  R.areaOf = (f) => R.AREAS[Math.min(R.AREAS.length - 1, Math.floor((Math.max(1, f) - 1) / 5))];
  R.bossFor = (f) => (f <= R.LAST_FLOOR ? R.areaOf(f).boss : R.AREAS[(Math.floor(f / 5) - 1) % R.AREAS.length].boss);
  R.BOSS_EVERY = 5;
  R.isBossFloor = (f) => f > 0 && f % R.BOSS_EVERY === 0;
  // 深い階ほど強くなる
  R.scale = (f) => ({ hp: 1 + 0.22 * (f - 1), dmg: 1 + 0.12 * (f - 1), xp: 1 + 0.15 * (f - 1), gold: 1 + 0.2 * (f - 1) });
  // その階に出る敵の種類（重みつき）
  R.enemyPool = function (f) {
    if (f > 5) return R.areaOf(f).pool.slice(); // 第36版: 地下 6 階からは地域ごとの敵
    const pool = [['slime', 5], ['skeleton', f >= 2 ? 4 : 2]];
    if (f >= 2) pool.push(['bat', 3]);
    if (f >= 3) pool.push(['mage', 2 + Math.min(3, f - 3)]);
    return pool;
  };
  R.pick = function (pool, rnd) {
    const tot = pool.reduce((a, [, w]) => a + w, 0);
    let v = (rnd || Math.random)() * tot;
    for (const [id, w] of pool) { v -= w; if (v <= 0) return id; }
    return pool[pool.length - 1][0];
  };

  // 決まった種（seed）から同じ乱数を出す（階の形を、何度作っても同じにするため）
  R.rng = function (seed) {
    let a = (seed >>> 0) || 1;
    return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  };

  // 階の形を作る: 3×3 のマスに部屋を置き、迷路のようにつなぐ。1 タイル 2m、42×42 タイル（84m 四方）
  R.TILE = 2; R.GRID = 42; R.CELLS = 3; R.CELL = 14; // 3×3 の部屋（84m 四方）
  R.makeFloor = function (floor, seed) {
    const rnd = R.rng(seed), N = R.GRID, C = R.CELLS, CS = R.CELL;
    const tiles = new Uint8Array(N * N); // 0 = 壁, 1 = 床
    const rooms = [];
    const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
    for (let cz = 0; cz < C; cz++) for (let cx = 0; cx < C; cx++) {
      const small = rnd() < 0.18;
      const w = small ? ri(4, 5) : ri(7, 11), h = small ? ri(4, 5) : ri(7, 11);
      const x0 = cx * CS + ri(1, CS - w - 1), z0 = cz * CS + ri(1, CS - h - 1);
      rooms.push({ id: cz * C + cx, cx, cz, x0, z0, w, h, small, links: [] });
    }
    const roomAt = (cx, cz) => rooms[cz * C + cx];
    const carve = (x, z) => { if (x > 0 && z > 0 && x < N - 1 && z < N - 1) tiles[z * N + x] = 1; };
    rooms.forEach((r) => { for (let z = r.z0; z < r.z0 + r.h; z++) for (let x = r.x0; x < r.x0 + r.w; x++) carve(x, z); });
    // 迷路（すべての部屋がつながる木）＋ 近道を 2 本
    const seen = new Set([0]), stack = [rooms[ri(0, C * C - 1)]];
    seen.clear(); seen.add(stack[0].id);
    const edges = [];
    while (stack.length) {
      const r = stack[stack.length - 1];
      const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => (r.cx + dx >= 0 && r.cx + dx < C && r.cz + dz >= 0 && r.cz + dz < C ? roomAt(r.cx + dx, r.cz + dz) : null)).filter((q) => q && !seen.has(q.id));
      if (!nb.length) { stack.pop(); continue; }
      const q = nb[Math.floor(rnd() * nb.length)];
      seen.add(q.id); edges.push([r, q]); stack.push(q);
    }
    for (let k = 0, tries = 0; k < 2 && tries < 30; tries++) {
      const r = rooms[ri(0, C * C - 1)], dir = [[1, 0], [0, 1]][ri(0, 1)];
      if (r.cx + dir[0] >= C || r.cz + dir[1] >= C) continue;
      const q = roomAt(r.cx + dir[0], r.cz + dir[1]);
      if (edges.some(([a, b]) => (a === r && b === q) || (a === q && b === r))) continue;
      edges.push([r, q]); k++;
    }
    const center = (r) => [Math.floor(r.x0 + r.w / 2), Math.floor(r.z0 + r.h / 2)];
    edges.forEach(([a, b]) => {
      a.links.push(b.id); b.links.push(a.id);
      const [ax, az] = center(a), [bx, bz] = center(b);
      // 幅 2 タイル（4m）の L 字の通路
      const midFirstX = rnd() < 0.5;
      const line = (x0, z0, x1, z1) => {
        const sx = Math.sign(x1 - x0), sz = Math.sign(z1 - z0);
        let x = x0, z = z0;
        for (;;) { carve(x, z); carve(x + 1, z); carve(x, z + 1); carve(x + 1, z + 1); if (x === x1 && z === z1) break; if (x !== x1) x += sx; else z += sz; }
      };
      if (midFirstX) { line(ax, az, bx, az); line(bx, az, bx, bz); } else { line(ax, az, ax, bz); line(ax, bz, bx, bz); }
    });
    // 部屋どうしの距離（通路の数）
    const dist = (from) => {
      const d = new Array(C * C).fill(-1); d[from.id] = 0; const q = [from];
      while (q.length) { const r = q.shift(); r.links.forEach((id) => { if (d[id] < 0) { d[id] = d[r.id] + 1; q.push(rooms[id]); } }); }
      return d;
    };
    const big = rooms.filter((r) => !r.small);
    const start = big[Math.floor(rnd() * big.length)] || rooms[0];
    const ds = dist(start);
    let stairs = rooms[0]; rooms.forEach((r) => { if (ds[r.id] > ds[stairs.id] || (ds[r.id] === ds[stairs.id] && !r.small && stairs.small)) stairs = r; });
    // 帰還ポータル: 入口から少し離れた部屋（階段の部屋とは別）
    const mids = rooms.filter((r) => r !== start && r !== stairs && ds[r.id] >= 2);
    const portal = mids.length ? mids[Math.floor(rnd() * mids.length)] : rooms.find((r) => r !== start && r !== stairs);
    // 宝箱と敵
    const chests = [], spawns = [];
    const boss = R.isBossFloor(floor);
    if (boss) {
      // 第33版: 守護者の部屋を広くする。1 マスずつ四方へ広げ、ほかの大事な部屋（入口・ポータル）に 2 マスより近づいたら止める
      const keep = [start, portal].filter((r) => r && r !== stairs);
      const hits = (x0, z0, x1, z1) => keep.some((r) => x0 <= r.x0 + r.w + 1 && x1 >= r.x0 - 2 && z0 <= r.z0 + r.h + 1 && z1 >= r.z0 - 2);
      let x0 = stairs.x0, z0 = stairs.z0, x1 = stairs.x0 + stairs.w - 1, z1 = stairs.z0 + stairs.h - 1;
      for (let k = 0; k < 20; k++) {
        if (x1 - x0 + 1 < 18 && x0 > 1 && !hits(x0 - 1, z0, x0 - 1, z1)) x0--;
        if (x1 - x0 + 1 < 18 && x1 < N - 2 && !hits(x1 + 1, z0, x1 + 1, z1)) x1++;
        if (z1 - z0 + 1 < 18 && z0 > 1 && !hits(x0, z0 - 1, x1, z0 - 1)) z0--;
        if (z1 - z0 + 1 < 18 && z1 < N - 2 && !hits(x0, z1 + 1, x1, z1 + 1)) z1++;
      }
      Object.assign(stairs, { x0, z0, w: x1 - x0 + 1, h: z1 - z0 + 1, small: false, bossRoom: true });
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) carve(x, z);
      // 第38版: 入口は 1 か所だけ。外周をすべて壁でふさぎ、それで切れた通路は部屋をよけて掘り直し、入口の部屋に近い辺に 2 マスの入口をあける
      const inB = (x, z) => x >= x0 && x <= x1 && z >= z0 && z <= z1;
      for (let x = x0; x <= x1; x++) { tiles[z0 * N + x] = 0; tiles[z1 * N + x] = 0; }
      for (let z = z0; z <= z1; z++) { tiles[z * N + x0] = 0; tiles[z * N + x1] = 0; }
      const DIR4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      // 部屋の外の床を、つながりごとに番号をつける
      const label = () => {
        const lab = new Int32Array(N * N).fill(-1); let n = 0;
        for (let i = 0; i < N * N; i++) {
          if (!tiles[i] || lab[i] >= 0 || inB(i % N, (i / N) | 0)) continue;
          const q = [i]; lab[i] = n;
          while (q.length) { const j = q.pop(), jx = j % N, jz = (j / N) | 0; for (const [dx, dz] of DIR4) { const X = jx + dx, Z = jz + dz; if (X < 0 || Z < 0 || X >= N || Z >= N) continue; const k = Z * N + X; if (!tiles[k] || lab[k] >= 0 || inB(X, Z)) continue; lab[k] = n; q.push(k); } }
          n++;
        }
        return lab;
      };
      // 2 マス幅で掘る（守護者の部屋と、そのまわり 1 マスには掘らない）
      const nearB = (x, z) => x >= x0 - 1 && x <= x1 + 1 && z >= z0 - 1 && z <= z1 + 1;
      const dig = (x, z) => { [[0, 0], [1, 0], [0, 1], [1, 1]].forEach(([dx, dz]) => { const X = x + dx, Z = z + dz; if (X > 0 && Z > 0 && X < N - 1 && Z < N - 1 && !inB(X, Z)) tiles[Z * N + X] = 1; }); };
      // 番号 c のつながりから、番号 main のつながりまで、部屋をよけて最短の道を掘る
      const route = (lab, c, main) => {
        const prev = new Int32Array(N * N).fill(-2), q = [];
        for (let i = 0; i < N * N; i++) if (lab[i] === c) { prev[i] = -1; q.push(i); }
        let head = 0, hit = -1;
        while (head < q.length) { const j = q[head++]; if (lab[j] === main) { hit = j; break; } const jx = j % N, jz = (j / N) | 0; for (const [dx, dz] of DIR4) { const X = jx + dx, Z = jz + dz; if (X < 1 || Z < 1 || X > N - 3 || Z > N - 3 || nearB(X, Z)) continue; const k = Z * N + X; if (prev[k] !== -2) continue; prev[k] = j; q.push(k); } }
        if (hit < 0) return false;
        for (let j = hit; j >= 0; j = prev[j]) dig(j % N, (j / N) | 0);
        return true;
      };
      const [sx, sz] = center(start);
      for (let tries = 0; tries < 8; tries++) {
        const lab = label(), main = lab[sz * N + sx];
        // 部屋の代表のマス: 中心（守護者の部屋に重なっているときは、部屋の中で外側に残った床）
        const rep = (r) => { const [cx, cz] = center(r); if (!inB(cx, cz) && tiles[cz * N + cx]) return [cx, cz]; for (let z = r.z0; z < r.z0 + r.h; z++) for (let x = r.x0; x < r.x0 + r.w; x++) if (!inB(x, z) && tiles[z * N + x]) return [x, z]; return null; };
        const lost = rooms.filter((r) => r !== stairs).map(rep).filter((p) => p && lab[p[1] * N + p[0]] !== main);
        if (!lost.length) break;
        const [lx, lz] = lost[0];
        if (lab[lz * N + lx] < 0) { dig(lx, lz); continue; }
        route(lab, lab[lz * N + lx], main);
      }
      // 入口: 外周の各辺（角を除く）で、外側が入口の部屋とつながった床のところ。入口の部屋に近いものを選ぶ
      const sides = [
        { side: 'N', at: (i) => [x0 + i, z0], out: [0, -1], n: x1 - x0 + 1 },
        { side: 'S', at: (i) => [x0 + i, z1], out: [0, 1], n: x1 - x0 + 1 },
        { side: 'W', at: (i) => [x0, z0 + i], out: [-1, 0], n: z1 - z0 + 1 },
        { side: 'E', at: (i) => [x1, z0 + i], out: [1, 0], n: z1 - z0 + 1 },
      ];
      let lab = label(), main = lab[sz * N + sx], best = null;
      const outLab = (sd, x, z) => { const X = x + sd.out[0], Z = z + sd.out[1]; return X >= 0 && Z >= 0 && X < N && Z < N ? lab[Z * N + X] : -1; };
      sides.forEach((sd) => { for (let i = 2; i < sd.n - 3; i++) { const p = sd.at(i), q2 = sd.at(i + 1), oa = outLab(sd, p[0], p[1]) === main, ob = outLab(sd, q2[0], q2[1]) === main; if (!oa && !ob) continue; const d = Math.hypot(p[0] - sx, p[1] - sz) + (oa && ob ? 0 : 2); if (!best || d < best.d) best = { d, sd, cells: [p, q2] }; } });
      if (!best) {
        // 外側に床がなければ、入口の部屋に近い辺のまん中から外へ掘って、つなぐ
        let bs = null; sides.forEach((sd) => { const m = Math.floor(sd.n / 2), p = sd.at(m), d = Math.hypot(p[0] - sx, p[1] - sz); if (!bs || d < bs.d) bs = { d, sd, m }; });
        const sd = bs.sd, p = sd.at(bs.m - 1), q2 = sd.at(bs.m);
        [p, q2].forEach(([x, z]) => { const X = x + sd.out[0], Z = z + sd.out[1]; if (X > 0 && Z > 0 && X < N - 1 && Z < N - 1) tiles[Z * N + X] = 1; });
        lab = label(); main = lab[sz * N + sx];
        const c = outLab(sd, p[0], p[1]); if (c >= 0 && c !== main) route(lab, c, main);
        best = { sd, cells: [p, q2] };
      }
      // 入口の 2 マスをあけ、その外側も床にする（扉の前に立てるように）
      best.cells.forEach(([x, z]) => { tiles[z * N + x] = 1; const X = x + best.sd.out[0], Z = z + best.sd.out[1]; if (X > 0 && Z > 0 && X < N - 1 && Z < N - 1) tiles[Z * N + X] = 1; });
      Object.assign(stairs, { x0: x0 + 1, z0: z0 + 1, w: x1 - x0 - 1, h: z1 - z0 - 1 }); // 部屋の中は外周の壁の内側
      stairs.doors = [{ side: best.sd.side, cells: best.cells.slice().sort((p, q2) => p[0] - q2[0] || p[1] - q2[1]), out: best.sd.out }];
      // 守護者の待つ場所: 扉と反対側の壁の近く（壁から 2 マス）。扉の方を向く
      const dc = [(best.cells[0][0] + best.cells[1][0]) / 2, (best.cells[0][1] + best.cells[1][1]) / 2], o = best.sd.out;
      const ix0 = x0 + 1, ix1 = x1 - 1, iz0 = z0 + 1, iz1 = z1 - 1, cl = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));
      stairs.bossAt = o[1] !== 0 ? [cl(dc[0], ix0 + 2, ix1 - 2), o[1] < 0 ? iz1 - 2 : iz0 + 2] : [o[0] < 0 ? ix1 - 2 : ix0 + 2, cl(dc[1], iz0 + 2, iz1 - 2)];
      stairs.bossFace = o; // 守護者から見た扉の向き（扉は、部屋の外へ向かう向き out の側にある）
    }
    const tilePos = (r) => [ri(r.x0, r.x0 + r.w - 1), ri(r.z0, r.z0 + r.h - 1)];
    const others = rooms.filter((r) => r !== start);
    const nChest = 2 + Math.floor(rnd() * 2);
    for (let k = 0; k < nChest; k++) {
      const r = others[Math.floor(rnd() * others.length)];
      // 第36版: 古い坑道より深い階では、宝箱の 3 割はミミック（宝箱のふりをした敵）
      if (floor > 5 && rnd() < 0.3) spawns.push({ type: 'mimic', room: r.id, t: tilePos(r) }); else chests.push({ room: r.id, t: tilePos(r) });
    }
    const pool = R.enemyPool(floor);
    others.forEach((r) => {
      if (boss && r === stairs) { spawns.push({ type: R.bossFor(floor), room: r.id, t: r.bossAt || center(r), face: r.bossFace || null }); return; } // 第36版: 地域ごとの守護者（第38版: 扉の反対側で、扉の方を向いて待つ）
      const n = Math.min(3, Math.floor(rnd() * (r.small ? 1.6 : 2.6)) + (floor >= 12 && rnd() < 0.4 ? 1 : 0)); // 第36版: 深い階でも増えすぎないように（前は 6 階ごとに 1 体ずつ増えた）
      for (let k = 0; k < n; k++) spawns.push({ type: R.pick(pool, rnd), room: r.id, t: tilePos(r) });
    });
    for (let i = spawns.length - 1; i >= 0; i--) { const t = spawns[i].t, inBoss = boss && stairs.bossRoom && !R.ENEMIES[spawns[i].type].boss && t[0] >= stairs.x0 - 1 && t[0] < stairs.x0 + stairs.w + 1 && t[1] >= stairs.z0 - 1 && t[1] < stairs.z0 + stairs.h + 1; if (!tiles[t[1] * N + t[0]] || inBoss) spawns.splice(i, 1); } // 守護者の部屋の中は守護者だけ
    for (let i = chests.length - 1; i >= 0; i--) if (!tiles[chests[i].t[1] * N + chests[i].t[0]]) chests.splice(i, 1);
    return { doors: boss ? stairs.doors || [] : [], area: R.areaOf(floor).id, floor, seed, N, tiles, rooms, start: start.id, stairs: stairs.id, portal: portal ? portal.id : stairs.id, chests, spawns, boss, center };
  };
  // タイル → 世界の座標（タイルの中心）
  R.tileToWorld = (x, z) => [(x + 0.5) * R.TILE - (R.GRID * R.TILE) / 2, (z + 0.5) * R.TILE - (R.GRID * R.TILE) / 2];
  R.worldToTile = (x, z) => [Math.floor((x + (R.GRID * R.TILE) / 2) / R.TILE), Math.floor((z + (R.GRID * R.TILE) / 2) / R.TILE)];
})();
