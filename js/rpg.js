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
    bat:      { label: '影コウモリ',   hp: 30,  dmg: 6,  speed: 6.0, range: 1.6, atkCd: 1.0, xp: 7,   gold: 3,  r: 0.6,  cy: 2.2, fly: true },
    mage:     { label: '闇の魔導士',   hp: 50,  dmg: 10, speed: 3.2, range: 15,  atkCd: 2.2, xp: 12,  gold: 6,  r: 0.7,  cy: 1.1, ranged: true },
    boss:     { label: '石の守護者',   hp: 480, dmg: 26, speed: 2.6, range: 4.2, atkCd: 2.4, xp: 160, gold: 120, r: 2.4, cy: 2.6, boss: true },
  };
  R.BOSS_EVERY = 5;
  R.isBossFloor = (f) => f > 0 && f % R.BOSS_EVERY === 0;
  // 深い階ほど強くなる
  R.scale = (f) => ({ hp: 1 + 0.22 * (f - 1), dmg: 1 + 0.12 * (f - 1), xp: 1 + 0.15 * (f - 1), gold: 1 + 0.2 * (f - 1) });
  // その階に出る敵の種類（重みつき）
  R.enemyPool = function (f) {
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

  // 階の形を作る: 4×4 のマスに部屋を置き、迷路のようにつなぐ。1 タイル 2m、56×56 タイル（112m 四方）
  R.TILE = 2; R.GRID = 56; R.CELLS = 4; R.CELL = 14;
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
    const tilePos = (r) => [ri(r.x0, r.x0 + r.w - 1), ri(r.z0, r.z0 + r.h - 1)];
    const others = rooms.filter((r) => r !== start);
    const nChest = 2 + Math.floor(rnd() * 3);
    for (let k = 0; k < nChest; k++) { const r = others[Math.floor(rnd() * others.length)]; chests.push({ room: r.id, t: tilePos(r) }); }
    const pool = R.enemyPool(floor);
    others.forEach((r) => {
      if (boss && r === stairs) { spawns.push({ type: 'boss', room: r.id, t: center(r) }); return; }
      const n = Math.min(5, (r.small ? 0 : 1) + Math.floor(rnd() * 2.5) + Math.floor(floor / 5));
      for (let k = 0; k < n; k++) spawns.push({ type: R.pick(pool, rnd), room: r.id, t: tilePos(r) });
    });
    return { floor, seed, N, tiles, rooms, start: start.id, stairs: stairs.id, portal: portal ? portal.id : stairs.id, chests, spawns, boss, center };
  };
  // タイル → 世界の座標（タイルの中心）
  R.tileToWorld = (x, z) => [(x + 0.5) * R.TILE - (R.GRID * R.TILE) / 2, (z + 0.5) * R.TILE - (R.GRID * R.TILE) / 2];
  R.worldToTile = (x, z) => [Math.floor((x + (R.GRID * R.TILE) / 2) / R.TILE), Math.floor((z + (R.GRID * R.TILE) / 2) / R.TILE)];
})();
