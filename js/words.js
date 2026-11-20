// 単語・属性・形・効果のデータと、単語の並びから魔法を組み立てる処理
(function () {
  'use strict';
  const MG = (window.MG = window.MG || {});

  // ---- 属性（1番目の単語で決まる） ----
  MG.ELEMENTS = {
    fire:      { label: '炎',     c1: '#ff5a1f', c2: '#ffd24a', kanji: ['炎', '焔', '煉獄', '紅蓮'], kana: ['フレア', 'ブレイズ', 'イグニス', 'インフェルノ'], dmg: 1.1, spd: 1, cost: 1, fx: { burn: 0.6 }, note: '当たった的を少し燃やす' },
    ice:       { label: '氷',     c1: '#7fd8ff', c2: '#e8fbff', kanji: ['氷', '氷晶', '霜', '凍'], kana: ['フロスト', 'グラキエス', 'アイシクル', 'ブリザード'], dmg: 0.95, spd: 1, cost: 1, fx: { freeze: 0.6 }, note: '的の動きを遅くする' },
    steam:     { label: '蒸気',   c1: '#cfe3ee', c2: '#ffffff', kanji: ['蒸', '霞', '雲'], kana: ['スチーム', 'ヴェイパー', 'クラウド'], dmg: 0.9, spd: 0.95, cost: 0.95, fx: { linger: 1.25 }, note: '効果が長く残る' },
    lightning: { label: '雷',     c1: '#ffe94a', c2: '#9fd0ff', kanji: ['雷', '迅雷', '霹靂', '稲妻'], kana: ['ヴォルト', 'ライトニング', 'サンダー', 'スパーク'], dmg: 1.0, spd: 1.3, cost: 1.05, fx: { chainHit: 1 }, note: '近くの的へ1回はね移る' },
    plasma:    { label: 'プラズマ', c1: '#ff4ff0', c2: '#8a7bff', kanji: ['電漿', '烈光', '天雷'], kana: ['プラズマ', 'イオン', 'アーク'], dmg: 1.3, spd: 1.1, cost: 1.25, fx: {}, note: '威力が高いが MP を多く使う' },
    light:     { label: '光',     c1: '#fff3b8', c2: '#ffc94a', kanji: ['光', '閃', '輝', '曙'], kana: ['ルクス', 'フラッシュ', 'レイディアンス', 'シャイン'], dmg: 0.95, spd: 1.5, cost: 0.95, fx: {}, note: 'とても速い' },
    acid:      { label: '酸',     c1: '#9dff3c', c2: '#3cffb4', kanji: ['酸', '蝕', '毒'], kana: ['アシッド', 'コロード', 'ヴェノム'], dmg: 0.9, spd: 0.95, cost: 1, fx: { corrode: 1 }, note: '的をもろくして、次のダメージを増やす' },
    metal:     { label: '鋼',     c1: '#d5deea', c2: '#7f93b0', kanji: ['鋼', '鉄', '銀', '刃'], kana: ['スティール', 'アイアン', 'シルバー', 'ブレード'], dmg: 1.25, spd: 0.9, cost: 1.05, fx: { knock: 0.5 }, note: '重くて威力が高い' },
    earth:     { label: '岩',     c1: '#d08a45', c2: '#ffd08a', kanji: ['岩', '地', '巌', '礫'], kana: ['ロック', 'テラ', 'ガイア', 'ストーン'], dmg: 1.15, spd: 0.85, cost: 1, fx: { knock: 1 }, note: '的を吹き飛ばす' },
    void:      { label: '虚空',   c1: '#9b5bff', c2: '#ff5ab4', kanji: ['虚', '闇', '冥', '奈落'], kana: ['ヴォイド', 'ダーク', 'ネザー', 'アビス'], dmg: 1.05, spd: 0.95, cost: 1.1, fx: { pull: 0.5 }, note: '着弾点に的を少し引き寄せる' },
    ether:     { label: '霊気',   c1: '#c3b4ff', c2: '#eef2ff', kanji: ['霊', '幻', '魂'], kana: ['エーテル', 'ファントム', 'スピリット'], dmg: 0.95, spd: 1.05, cost: 1, fx: { pierce: 1 }, note: '的を1体すり抜ける' },
    arcane:    { label: '魔素',   c1: '#4fa8ff', c2: '#b4f0ff', kanji: ['魔', '理', '秘'], kana: ['アルカナ', 'マギア', 'ミスティック'], dmg: 1, spd: 1.05, cost: 0.8, fx: {}, note: 'MP の消費が少ない' },
    crystal:   { label: '晶',     c1: '#6ff6ff', c2: '#ff9cf2', kanji: ['晶', '金剛', '玻璃'], kana: ['クリスタル', 'ダイヤ', 'プリズマ'], dmg: 1.05, spd: 1, cost: 1.05, fx: { crit: 0.2 }, note: 'ときどき会心（2.5倍）' },
    wind:      { label: '風',     c1: '#9effd8', c2: '#e6fff6', kanji: ['風', '嵐', '颯'], kana: ['ウィンド', 'テンペスト', 'ゲイル'], dmg: 0.9, spd: 1.35, cost: 0.9, fx: { knock: 0.8 }, note: '速くて、的を押し返す' },
    prism:     { label: '虹',     c1: '#ff6b8b', c2: '#6bd0ff', kanji: ['虹', '七色', '彩'], kana: ['プリズム', 'レインボー', 'スペクトル'], dmg: 1, spd: 1.1, cost: 1.05, fx: { homing: 0.5 }, rainbow: true, note: '七色に光り、少しだけ的を追いかける' },
    sound:     { label: '音',     c1: '#ffb84a', c2: '#fff0b0', kanji: ['響', '音', '鳴'], kana: ['ソニック', 'エコー', 'ハウル'], dmg: 0.9, spd: 1.2, cost: 1, fx: { pulses: 1 }, note: '当たった後、振動がもう一度ダメージ' },
    magnet:    { label: '磁',     c1: '#ff4a5a', c2: '#4a8bff', kanji: ['磁', '極', '電磁'], kana: ['マグネ', 'ポール', 'ローレンツ'], dmg: 1, spd: 1, cost: 1.05, fx: { homing: 0.9 }, note: '的を追いかける' },
    force:     { label: '力',     c1: '#ffb347', c2: '#fff1a8', kanji: ['剛', '覇', '烈'], kana: ['フォース', 'マイト', 'ブースト'], dmg: 1.2, spd: 1, cost: 1.15, fx: { knock: 0.7 }, note: '力強く、的を押し飛ばす' },
    vacuum:    { label: '真空',   c1: '#dff6ff', c2: '#8fb8ff', kanji: ['空', '無', '虚空'], kana: ['ヴァキューム', 'ゼロ', 'エンプティ'], dmg: 1.0, spd: 1.2, cost: 1.05, fx: { pull: 0.9 }, note: '周りの的を吸い寄せる' },
    time:      { label: '時',     c1: '#a8a2ff', c2: '#7af0e0', kanji: ['刻', '時', '巡'], kana: ['クロノ', 'タイム', 'サイクル'], dmg: 0.95, spd: 1, cost: 1, fx: { freeze: 0.5 }, note: '的の時間を遅くする' },
  };

  // ---- 形（2番目の単語で決まる） ----
  MG.FORMS = {
    bolt:   { label: '魔弾', desc: 'まっすぐ飛ぶ魔弾', kanji: ['弾', '矢', '閃'], kana: ['バレット', 'アロー', 'ショット'], dmg: 22, speed: 45, size: 0.35, radius: 1.6, count: 1, cost: 8, cd: 0.3, life: 2.2 },
    lob:    { label: '砲弾', desc: '弧を描いて飛び、着弾点で爆発する砲弾', kanji: ['砲', '爆弾', '榴弾'], kana: ['キャノン', 'ボム', 'モルタル'], dmg: 34, speed: 24, size: 0.6, radius: 4.5, count: 1, cost: 16, cd: 0.8, life: 4 },
    spray:  { label: '散弾', desc: '扇形に広がる散弾', kanji: ['散弾', '飛沫', '扇'], kana: ['スプレッド', 'スキャッター', 'シャワー'], dmg: 11, speed: 40, size: 0.25, radius: 1.2, count: 5, cost: 12, cd: 0.55, life: 0.8, spreadDeg: 28 },
    beam:   { label: '光線', desc: '一瞬でまっすぐ貫く光線', kanji: ['槍', '光線', '穿'], kana: ['ランス', 'レイ', 'ビーム'], dmg: 30, size: 0.25, radius: 0.6, cost: 18, cd: 0.9, range: 75 },
    chain:  { label: '連鎖', desc: '狙った的から次々とはね移る稲妻', kanji: ['鎖', '連撃', '網'], kana: ['チェイン', 'リンク', 'ネット'], dmg: 20, size: 0.3, radius: 0.8, cost: 16, cd: 0.8, range: 60, jumps: 3, jumpRange: 18 },
    rain:   { label: '降雨', desc: '狙った場所に空から降り注ぐ', kanji: ['雨', '流星', '驟雨'], kana: ['レイン', 'メテオ', 'ストーム'], dmg: 14, speed: 34, size: 0.35, radius: 2.2, count: 12, cost: 24, cd: 1.4, area: 5, dur: 1.2 },
    pillar: { label: '柱', desc: '足もとから狙った場所へ、地面から次々と突き出す柱', kanji: ['柱', '牙', '剣山'], kana: ['ピラー', 'ファング', 'スパイク'], dmg: 26, size: 1, radius: 2, count: 7, cost: 20, cd: 1.1 },
    mist:   { label: '霧', desc: '狙った場所にしばらく残り、中の的を削り続ける霧', kanji: ['霧', '瘴気', '靄'], kana: ['ミスト', 'フォグ', 'ヘイズ'], dmg: 6, radius: 5.5, dur: 4, tick: 0.4, cost: 20, cd: 1.4 },
    vortex: { label: '渦', desc: '的を中心へ吸い込み、最後に弾ける渦', kanji: ['渦', '禍', '螺旋'], kana: ['ヴォルテクス', 'メイルシュトロム', 'スパイラル'], dmg: 5, radius: 7, dur: 2.6, tick: 0.3, burst: 28, cost: 24, cd: 1.6 },
    nova:   { label: '環', desc: '自分を中心に広がる衝撃の輪', kanji: ['環', '輪', '円舞'], kana: ['ノヴァ', 'リング', 'サークル'], dmg: 30, speed: 24, radius: 15, cost: 20, cd: 1.2 },
    orb:    { label: '宝珠', desc: 'ゆっくり的を追いかけ、大きく炸裂する宝珠', kanji: ['球', '宝珠', '星'], kana: ['オーブ', 'スフィア', 'スター'], dmg: 45, speed: 14, size: 0.9, radius: 5, count: 1, cost: 22, cd: 1.3, life: 6, homing: 1.4 },
    volley: { label: '連弾', desc: '短い間隔で続けて撃つ魔弾', kanji: ['連弾', '乱射', '三連'], kana: ['ラッシュ', 'ガトリング', 'トリプル'], dmg: 13, speed: 50, size: 0.28, radius: 1.3, count: 3, cost: 14, cd: 0.6, life: 2 },
    // 守り・回復・移動の形（support）。dmg は、障壁なら吸い取れるダメージ、再生なら回復する HP、転移なら着いた場所の衝撃の威力
    ward:   { label: '障壁', desc: '自分を守る障壁を張る（球・大盾・壁・城壁・ドーム。形は1番目の属性と3・4番目の効果で変わる。こわれると衝撃を放つ）', dmg: 60, radius: 4, dur: 6, cost: 22, cd: 5, support: true },
    heal:   { label: '再生', desc: '自分の HP を回復し、燃焼・凍結・腐食を消す', dmg: 45, dur: 3, cost: 26, cd: 7, support: true },
    warp:   { label: '転移', desc: '狙った場所へ一瞬で移り、着いた場所に衝撃を放つ（壁や柱はこえられない）', dmg: 16, radius: 3.5, range: 24, cost: 18, cd: 3.5, support: true },
    // 飛翔: dur 秒だけ空を飛べる（Space で上昇、C で下降）。纏い: dur 秒だけ属性の力をまとい、足が速くなり、まわり radius m の的に tick 秒ごとに dmg
    fly:    { label: '飛翔', desc: 'しばらくの間、空を自由に飛べる（Space で上昇、C で下降）', dmg: 0, dur: 16, cost: 24, cd: 9, support: true },
    aura:   { label: '纏い', desc: '属性の力を体にまとい、しばらく足が速くなる。まわりの的にも少しずつダメージを与える', dmg: 7, radius: 3, dur: 7, tick: 0.5, cost: 22, cd: 9, support: true },
    // 流星: 狙った場所の上空に魔法陣を描き、そこから count 個の大きな流星を dur 秒かけて落とす
    meteor: { label: '流星', desc: '狙った場所の上空に魔法陣を描き、そこから大きな流星を次々と落とす', dmg: 40, speed: 38, size: 1.3, radius: 5, count: 3, cost: 34, cd: 2.6, area: 4.5, dur: 1.1 },
    // 召喚: 属性に合った召喚獣（ゴーレム・精霊・獣）を呼び出し、dur 秒のあいだ一緒に戦わせる。dmg は1回の攻撃の威力
    summon: { label: '召喚', desc: '属性に合った召喚獣を呼び出し、しばらく一緒に戦わせる（ゴーレム・精霊・獣）', dmg: 10, size: 1, radius: 2, count: 1, dur: 15, cost: 32, cd: 8 },
  };
  MG.SUPPORT_FORMS = { ward: 1, heal: 1, warp: 1, fly: 1, aura: 1 };

  // ---- 効果（3番目・4番目の単語で決まる） ----
  MG.MODS = {
    burn:     { kanji: '灼熱', kana: 'バーニング', desc: '当たった的を燃やし続ける', apply: (s) => { s.burn += 1.5; } },
    corrode:  { kanji: '腐食', kana: 'コロージョン', desc: '的をもろくして、受けるダメージを増やす', apply: (s) => { s.corrode += 1; } },
    refund:   { kanji: '還流', kana: 'リサイクル', desc: '使った MP の半分が戻ってくる', apply: (s) => { s.refund += 0.5; } },
    merge:    { kanji: '巨大', kana: 'ギガ', desc: '大きく重くなり、威力が上がる', apply: (s) => { s.size *= 1.6; s.radius *= 1.35; s.dmg *= 1.35; s.speed *= 0.8; } },
    split:    { kanji: '分裂', kana: 'スプリット', desc: '当たると破片に分かれて飛び散る', apply: (s) => { s.split += 3; } },
    freeze:   { kanji: '凍結', kana: 'フリーズ', desc: '的を凍らせて動きを止める', apply: (s) => { s.freeze += 2; } },
    linger:   { kanji: '永続', kana: 'エターナル', desc: '効果の続く時間と広さが増える', apply: (s) => { s.dur *= 1.6; s.life *= 1.4; s.radius *= 1.15; s.burn *= 1.5; } },
    pierce:   { kanji: '貫通', kana: 'ピアシング', desc: '的を2体までつらぬく', apply: (s) => { s.pierce += 2; } },
    overload: { kanji: '過負荷', kana: 'オーバーロード', desc: '威力1.5倍。ただし MP を1.4倍使う', apply: (s) => { s.dmg *= 1.5; s.costMul *= 1.4; } },
    echo:     { kanji: '反復', kana: 'エコー', desc: '少し遅れて、もう一度発動する', apply: (s) => { s.echo += 1; } },
    crit:     { kanji: '鋭利', kana: 'クリティカル', desc: '30% の確率で会心（2.5倍）', apply: (s) => { s.crit += 0.3; } },
    radiance: { kanji: '光輝', kana: 'ラディアント', desc: '範囲と大きさが40%広がる', apply: (s) => { s.radius *= 1.4; s.size *= 1.3; s.area *= 1.3; } },
    speed:    { kanji: '神速', kana: 'ソニック', desc: '弾の速さが1.8倍、待ち時間も短くなる', apply: (s) => { s.speed *= 1.8; s.cd *= 0.7; s.dmg *= 1.1; } },
    pull:     { kanji: '引力', kana: 'グラビティ', desc: '着弾点に周りの的を引き寄せる', apply: (s) => { s.pull += 1.5; } },
    scatter:  { kanji: '多重', kana: 'マルチ', desc: '弾やはね移る回数が2つ増える', apply: (s) => { s.count += 2; s.jumps += 2; } },
    bounce:   { kanji: '跳弾', kana: 'リバウンド', desc: '当たると次の的へ2回はね返る', apply: (s) => { s.bounce += 2; } },
    resonate: { kanji: '共振', kana: 'レゾナンス', desc: '当たった後、振動で2回追加ダメージ', apply: (s) => { s.pulses += 2; } },
    area:     { kanji: '広域', kana: 'ワイド', desc: '範囲が60%広がるが、威力は少し下がる', apply: (s) => { s.radius *= 1.6; s.dmg *= 0.85; s.area *= 1.5; s.spreadDeg *= 1.4; } },
    knock:    { kanji: '衝撃', kana: 'インパクト', desc: '的を大きく吹き飛ばす', apply: (s) => { s.knock += 2; } },
    heavy:    { kanji: '重撃', kana: 'ヘヴィ', desc: '威力1.3倍、吹き飛ばしも強いが弾は遅い', apply: (s) => { s.dmg *= 1.3; s.knock += 1; s.speed *= 0.75; } },
    homing:   { kanji: '追尾', kana: 'ホーミング', desc: '弾が的を追いかける', apply: (s) => { s.homing += 1.5; } },
    chain:    { kanji: '連鎖', kana: 'チェイン', desc: '当たると近くの的へ2回連鎖する', apply: (s) => { s.chainHit += 2; } },
    compress: { kanji: '凝縮', kana: 'コンプレス', desc: '小さく速くなり、威力1.6倍', apply: (s) => { s.size *= 0.6; s.dmg *= 1.6; s.speed *= 1.3; s.radius *= 0.8; } },
    expand:   { kanji: '膨大', kana: 'エクスパンド', desc: '大きく広がるが、威力は少し下がる', apply: (s) => { s.size *= 1.8; s.radius *= 1.5; s.dmg *= 0.85; s.area *= 1.3; } },
    reinforce: { kanji: '強化', kana: 'ブースト', desc: '威力が1.3倍になり、壁の貫通力も1増える', apply: (s) => { s.dmg *= 1.3; } },
    suction:  { kanji: '吸引', kana: 'サクション', desc: '着弾点に的を強く吸い寄せ、範囲も少し広がる', apply: (s) => { s.pull += 2.5; s.radius *= 1.15; } },
    rewind:   { kanji: '回帰', kana: 'リワインド', desc: '当たった少しあとに、時が巻き戻って同じダメージをもう一度与える', apply: (s) => { s.rewind += 1; } },
    guard:    { kanji: '守護', kana: 'ガード', desc: '放ったあと3秒間、受けるダメージが半分になる', apply: (s) => { s.guard += 3; } },
    drain:    { kanji: '吸命', kana: 'ドレイン', desc: '相手に与えたダメージの30%だけ、自分の HP が回復する（対戦のとき）', apply: (s) => { s.drain += 0.3; } },
    blink:    { kanji: '瞬身', kana: 'ブリンク', desc: '放つと同時に、狙いと反対の方向へ5m 跳び退く', apply: (s) => { s.blink += 5; } },
    float:    { kanji: '浮遊', kana: 'フロート', desc: '放つと同時に、上へ高く跳び上がる', apply: (s) => { s.leap += 1; } },
    smash:    { kanji: '粉砕', kana: 'クラッシュ', desc: '威力1.2倍。岩や壁などの地形も壊せるようになる', apply: (s) => { s.dmg *= 1.2; s.smash += 1; } },
    haste:    { kanji: '迅速', kana: 'ヘイスト', desc: '放ったあと4秒間、足が速くなる', apply: (s) => { s.haste += 4; } },
    familiar: { kanji: '使い魔', kana: 'ファミリア', desc: '放つと小さな使い魔（光の玉）が現れ、10秒間そばを飛びながら近くの敵を小さな弾で撃つ', apply: (s) => { s.familiar += 1; } },
  };

  // ---- 科学の単語（化学14・物理19） ----
  // elem: 1番目に置いたときの属性 / form: 2番目に置いたときの形 / mod: 3・4番目に置いたときの効果
  MG.WORDS = [
    { id: 'combustion',      label: '燃焼', group: 'chem', elem: 'fire',      form: 'lob',    mod: 'burn',     sci: '物質が酸素と結びついて、熱と光を出す反応。' },
    { id: 'oxidation',       label: '酸化', group: 'chem', elem: 'acid',      form: 'mist',   mod: 'corrode',  sci: '物質が酸素と結びつくこと。鉄がさびるのも酸化。' },
    { id: 'reduction',       label: '還元', group: 'chem', elem: 'metal',     form: 'bolt',   mod: 'refund',   sci: '酸化物から酸素を取り除くこと。鉄鉱石から鉄を取り出すときに使う。' },
    { id: 'bonding',         label: '結合', group: 'chem', elem: 'earth',     form: 'orb',    mod: 'merge',    sci: '原子どうしが結びついて、分子や結晶をつくること。' },
    { id: 'decomposition',   label: '分解', group: 'chem', elem: 'void',      form: 'rain',   mod: 'split',    sci: '1つの物質が、2つ以上の物質に分かれる反応。' },
    { id: 'solidification',  label: '凝固', group: 'chem', elem: 'ice',       form: 'pillar', mod: 'freeze',   sci: '液体が冷えて固体になること。水が氷になるのも凝固。' },
    { id: 'evaporation',     label: '蒸発', group: 'chem', elem: 'steam',     form: 'mist',   mod: 'linger',   sci: '液体の表面から、気体になって出ていくこと。' },
    { id: 'sublimation',     label: '昇華', group: 'chem', elem: 'ether',     form: 'beam',   mod: 'pierce',   sci: '固体が液体をとばして、直接気体になること（ドライアイスなど）。' },
    { id: 'ionization',      label: '電離', group: 'chem', elem: 'plasma',    form: 'nova',   mod: 'overload', sci: '原子や分子が電子を失ったり得たりして、イオンになること。' },
    { id: 'catalyst',        label: '触媒', group: 'chem', elem: 'arcane',    form: 'volley', mod: 'echo',     sci: '自分自身は変わらずに、反応を速める物質。' },
    { id: 'crystallization', label: '結晶', group: 'chem', elem: 'crystal',   form: 'rain',   mod: 'crit',     sci: '原子が規則正しく並んだ固体（結晶）ができること。' },
    { id: 'reinforcement',   label: '強化', group: 'chem', elem: 'force',     form: 'volley', mod: 'reinforce', sci: '物の強さを高めること。ガラスを化学的に処理して強化すると、割れにくくなる。' },
    { id: 'luminescence',    label: '発光', group: 'chem', elem: 'light',     form: 'beam',   mod: 'radiance', sci: '熱をあまり出さずに光を放つこと（ホタルや蛍光ペンなど）。' },
    { id: 'acceleration',    label: '加速', group: 'phys', elem: 'wind',      form: 'bolt',   mod: 'speed',    sci: '速さがだんだん増えていくこと。' },
    { id: 'gravity',         label: '重力', group: 'phys', elem: 'void',      form: 'vortex', mod: 'pull',     sci: '地球などが、物を引っぱる力。' },
    { id: 'refraction',      label: '屈折', group: 'phys', elem: 'prism',     form: 'spray',  mod: 'scatter',  sci: '光が別の物質に入るときに曲がること。虹ができる理由。' },
    { id: 'reflection',      label: '反射', group: 'phys', elem: 'light',     form: 'bolt',   mod: 'bounce',   sci: '光や音が物に当たって、はね返ること。' },
    { id: 'resonance',       label: '共鳴', group: 'phys', elem: 'sound',     form: 'nova',   mod: 'resonate', sci: '同じ振動数のものが、つられて大きく揺れること。' },
    { id: 'diffusion',       label: '拡散', group: 'phys', elem: 'wind',      form: 'spray',  mod: 'area',     sci: '粒子が、濃いところからうすいところへ広がっていくこと。' },
    { id: 'vibration',       label: '振動', group: 'phys', elem: 'earth',     form: 'pillar', mod: 'knock',    sci: '物が細かく行ったり来たりする運動。' },
    { id: 'inertia',         label: '慣性', group: 'phys', elem: 'metal',     form: 'lob',    mod: 'heavy',    sci: '物が、今の動き（止まっているなら止まったまま）を続けようとする性質。' },
    { id: 'magnetism',       label: '磁力', group: 'phys', elem: 'magnet',    form: 'orb',    mod: 'homing',   sci: '磁石が鉄を引きつけたり、極どうしが引き合ったり反発したりする力。' },
    { id: 'discharge',       label: '放電', group: 'phys', elem: 'lightning', form: 'chain',  mod: 'chain',    sci: 'たまった電気が、一気に流れ出すこと（雷など）。' },
    { id: 'compression',     label: '圧縮', group: 'phys', elem: 'crystal',   form: 'bolt',   mod: 'compress', sci: '力を加えて体積を小さくすること。炭素を強く圧縮するとダイヤモンドになる。' },
    { id: 'expansion',       label: '膨張', group: 'phys', elem: 'fire',      form: 'nova',   mod: 'expand',   sci: '温度が上がって、体積が大きくなること。' },
    { id: 'vacuum',          label: '真空', group: 'phys', elem: 'vacuum',    form: 'vortex', mod: 'suction',  sci: '空気などの物質がほとんどない空間。宇宙空間はほぼ真空。' },
    { id: 'regression',      label: '回帰', group: 'phys', elem: 'time',      form: 'chain',  mod: 'rewind',   sci: 'もとの状態や位置にもどること。季節が一回りして同じ時期にもどる「回帰年」など。' },
    { id: 'shielding',       label: '遮蔽', group: 'phys', elem: 'magnet',    form: 'ward',   mod: 'guard',    sci: '放射線や電磁波などを、物でさえぎること。レントゲン室の壁に入っている鉛の板など。' },
    { id: 'regeneration',    label: '再生', group: 'chem', elem: 'ether',     form: 'heal',   mod: 'drain',    sci: '失われた体の一部や組織が、もとどおりにつくり直されること（トカゲのしっぽなど）。' },
    { id: 'transition',      label: '転移', group: 'phys', elem: 'arcane',    form: 'warp',   mod: 'blink',    sci: '状態や位置が、別のものへ移り変わること。水が氷になる「相転移」など。' },
    { id: 'lift',            label: '揚力', group: 'phys', elem: 'wind',      form: 'fly',    mod: 'float',    sci: '流れの中にある翼に、上向きにはたらく力。飛行機や鳥が空を飛べるのは揚力のおかげ。' },
    { id: 'collision',       label: '衝突', group: 'phys', elem: 'earth',     form: 'meteor', mod: 'smash',    sci: '物どうしがぶつかること。宇宙から落ちてきた隕石が地面に衝突すると、クレーターができる。' },
    { id: 'electrification', label: '帯電', group: 'phys', elem: 'lightning', form: 'aura',   mod: 'haste',    sci: '物が電気をおびること。下じきで髪をこすると、静電気で帯電して髪が持ち上がる。' },
    { id: 'synthesis',       label: '合成', group: 'chem', elem: 'ether',     form: 'summon', mod: 'familiar', sci: '2つ以上の物質を反応させて、新しい物質をつくること。薬やプラスチックも合成でつくられる。' },
  ];
  // 声で唱えるときの読み方（yomi）と、音声認識が出しがちな同音の言葉（alias）
  const VOICE = {
    combustion: ['ねんしょう', ['年商']], oxidation: ['さんか', ['参加', '産科', '傘下']], reduction: ['かんげん', ['甘言', '管弦']],
    bonding: ['けつごう', []], decomposition: ['ぶんかい', []], solidification: ['ぎょうこ', []], evaporation: ['じょうはつ', []],
    sublimation: ['しょうか', ['消化', '消火', '商家', '唱歌']], ionization: ['でんり', []], catalyst: ['しょくばい', []],
    crystallization: ['けっしょう', ['決勝']], luminescence: ['はっこう', ['発行', '発酵']], acceleration: ['かそく', []],
    gravity: ['じゅうりょく', ['重量']], refraction: ['くっせつ', []], reflection: ['はんしゃ', []], resonance: ['きょうめい', []],
    diffusion: ['かくさん', []], vibration: ['しんどう', ['神童', '新道', '震度']], inertia: ['かんせい', ['完成', '歓声', '管制', '官製', '感性']],
    magnetism: ['じりょく', ['自力']], discharge: ['ほうでん', []], compression: ['あっしゅく', []], expansion: ['ぼうちょう', ['傍聴']],
    reinforcement: ['きょうか', ['教化', '狂歌']], vacuum: ['しんくう', ['新空']], regression: ['かいき', ['怪奇', '皆既', '快気', '開基']],
    shielding: ['しゃへい', []], regeneration: ['さいせい', ['再製', '再成', '最盛']], transition: ['てんい', ['転位', '天意']],
    lift: ['ようりょく', ['容量', '用量']], collision: ['しょうとつ', []], electrification: ['たいでん', []],
    synthesis: ['ごうせい', ['豪勢', '剛性', '合声']],
  };
  MG.WORD_MAP = {};
  MG.WORDS.forEach((w, i) => { w.index = i; MG.WORD_MAP[w.id] = w; w.yomi = VOICE[w.id][0]; w.alias = [w.label, w.yomi].concat(VOICE[w.id][1]); });

  // ---- 隠し魔法（決まった順番で並べたときだけ発動） ----
  MG.SECRETS = [
    { id: 'redox',     seq: ['oxidation', 'reduction'], kanji: '酸化還元連鎖', kana: 'レドックス・サイクル', elem: 'magnet', cost: 45,
      desc: '酸化と還元は、必ずセットで起こる。的から的へ、赤と青の稲妻が8回はね移る。', hint: '必ずセットで起こる、2つの反応' },
    { id: 'cumulo',    seq: ['evaporation', 'discharge'], kanji: '積乱雷雲', kana: 'キュムロニンバス', elem: 'lightning', cost: 55,
      desc: '水が蒸発して空へのぼると、やがて雷雲になる。狙った場所に雷雲を呼び、雷を落とし続ける。', hint: '水が空へのぼると、やがて雷が鳴る（2語）' },
    { id: 'supernova', seq: ['compression', 'expansion', 'combustion'], kanji: '超新星', kana: 'スーパーノヴァ', elem: 'fire', cost: 70,
      desc: '重い星が一生の最後に起こす大爆発。狙った場所に星を生み、巨大な爆発を起こす。', hint: '押し縮めて、ふくらませて、燃やす（3語）' },
    { id: 'horizon',   seq: ['compression', 'gravity', 'refraction'], kanji: '事象の地平', kana: 'イベント・ホライズン', elem: 'void', cost: 70,
      desc: '押し縮められた重さは、光さえ曲げて飲み込む。狙った場所にブラックホールを生む。', hint: '押し縮めた重さは、光さえ曲げる（3語）' },
    { id: 'aurora',    seq: ['ionization', 'luminescence', 'refraction'], kanji: '極光天幕', kana: 'オーロラ・カーテン', elem: 'prism', cost: 65,
      desc: '空の上でイオンが光ると、オーロラになる。オーロラから、周りのすべての的へ光が降り注ぐ。', hint: '空でイオンが光り、七色に分かれる（3語）' },
    { id: 'zero',      seq: ['solidification', 'crystallization', 'compression'], kanji: '絶対零度', kana: 'アブソリュート・ゼロ', elem: 'ice', cost: 60,
      desc: 'これ以上冷えない、−273.15℃の世界。周りのすべての的を凍りつかせる。', hint: '固めて、並べて、押し縮める（3語）' },
    { id: 'fusion',    seq: ['compression', 'bonding', 'luminescence', 'expansion'], kanji: '太陽創造', kana: 'ソル・ジェネシス', elem: 'fire', cost: 90,
      desc: '原子を押し縮めてくっつける「核融合」は、太陽が輝くしくみ。小さな太陽を生み、落とす。', hint: '押し縮めて、くっつけて、輝かせて、広げる（4語）' },
    { id: 'erase',     seq: ['reinforcement', 'compression', 'vacuum', 'regression'], kanji: '消滅領域', kana: 'イレイズ・スフィア', elem: 'vacuum', cost: 85,
      desc: '強めた力で空間を押し縮めて真空にし、無へと還す。少し離れた場所に透明な球体を生み、その内部にあるものを、的も地形も地面も跡形なく消し去る。', hint: '強めて、押し縮め、空っぽにして、無へ還す（4語）' },
  ];

  // ---- 障壁の形（第22版）: 1番目の属性で「壁・大盾・球」が決まり、3・4番目の効果でさらに変わる ----
  const WARD_WALL_EL = { earth: 1, metal: 1, ice: 1, crystal: 1 };   // 実体のある属性は、目の前に壁を立てる
  const WARD_FRONT_EL = { force: 1, magnet: 1, sound: 1, light: 1 }; // 体の前に大盾を構える
  const WARD_SHAPE_MOD = { area: 'dome', scatter: 'fort', compress: 'front' }; // 拡散→ドーム、屈折（多重）→城壁、圧縮（凝縮）→大盾
  MG.WARD_SHAPES = {
    sphere: { label: '球', kanji: '盾', kana: 'シールド', desc: '自分のまわりを包む球。どの方向からのダメージも吸い取る' },
    front:  { label: '大盾', kanji: '大盾', kana: 'イージス', desc: '体の前に大きな盾を構える。前から来たダメージだけを、球より多く（1.6倍）吸い取る' },
    wall:   { label: '壁', kanji: '壁', kana: 'ウォール', desc: '目の前に壁を立てる。その場に残って相手の弾や光線を止め、上に乗ることもできる' },
    fort:   { label: '城壁', kanji: '城壁', kana: 'フォート', desc: '前と左右ななめに3枚の壁を立てて、自分を囲む' },
    dome:   { label: 'ドーム', kanji: '天蓋', kana: 'ドーム', desc: 'その場に大きな半球のドームを張る。外から飛んでくる相手の弾や光線を止める（自分の魔法は内側から通る）' },
  };
  MG.wardShape = function (elemId, mods) {
    for (const m of mods || []) if (WARD_SHAPE_MOD[m]) return WARD_SHAPE_MOD[m];
    return WARD_WALL_EL[elemId] ? 'wall' : WARD_FRONT_EL[elemId] ? 'front' : 'sphere';
  };
  // ---- 召喚獣（第22版）: 1番目の属性で種類が決まる ----
  const SUMMON_GOLEM = { earth: 1, metal: 1, crystal: 1, force: 1, magnet: 1 };
  const SUMMON_BEAST = { wind: 1, sound: 1, time: 1, vacuum: 1, acid: 1 };
  MG.SUMMONS = {
    golem:  { label: 'ゴーレム', kanji: '像', kana: 'ゴーレム', desc: '重くて固い。歩いて近づき、太い腕で殴る', hp: 150, dmgMul: 2.2, atkCd: 1.6, speed: 3.4, range: 2.6 },
    spirit: { label: '精霊', kanji: '精', kana: 'スピリット', desc: '宙に浮かび、少し離れた所から属性の弾を撃つ', hp: 70, dmgMul: 1, atkCd: 1.1, speed: 5.5, range: 22 },
    beast:  { label: '獣', kanji: '獣', kana: 'ビースト', desc: 'すばやく走り、飛びかかってかみつく', hp: 90, dmgMul: 1.1, atkCd: 0.8, speed: 8.5, range: 2.3 },
    wisp:   { label: '使い魔', kanji: '従', kana: 'ファミリア', desc: '小さな光の玉。そばを飛びながら小さな弾を撃つ', hp: 30, dmgMul: 0.5, atkCd: 0.9, speed: 9, range: 18 },
  };
  MG.summonType = (elemId) => (SUMMON_GOLEM[elemId] ? 'golem' : SUMMON_BEAST[elemId] ? 'beast' : 'spirit');

  MG.DESTROY_FORMS = { lob: 1, rain: 1, orb: 1, vortex: 1, pillar: 1, meteor: 1 };
  MG.DESTROY_SECRETS = ['supernova', 'horizon', 'fusion', 'cumulo', 'erase'];

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  MG.hash = hash;

  MG.findSecret = function (seq) {
    const key = seq.join('|');
    return MG.SECRETS.find((s) => s.seq.join('|') === key) || null;
  };

  // 名前に使う短い字と読み（わかりやすさ優先で、1つに固定する）
  // 属性: 漢字1字＋読み
  const NAME_ELEM = {
    fire: ['炎', 'フレア'], ice: ['氷', 'アイス'], steam: ['蒸', 'スチーム'], lightning: ['雷', 'ボルト'], plasma: ['電', 'プラズマ'],
    light: ['光', 'ライト'], acid: ['酸', 'アシッド'], metal: ['鋼', 'スチール'], earth: ['岩', 'ロック'], void: ['闇', 'ダーク'],
    ether: ['霊', 'ゴースト'], arcane: ['魔', 'マナ'], crystal: ['晶', 'クリスタル'], wind: ['風', 'ウィンド'], prism: ['虹', 'プリズム'],
    sound: ['音', 'サウンド'], magnet: ['磁', 'マグネ'], force: ['剛', 'フォース'], vacuum: ['空', 'ゼロ'], time: ['時', 'クロノ'],
  };
  // 形: 見てすぐわかる字＋読み
  const NAME_FORM = {
    bolt: ['弾', 'バレット'], lob: ['砲弾', 'キャノン'], spray: ['散弾', 'ショット'], beam: ['槍', 'ランス'], chain: ['鎖', 'チェイン'],
    rain: ['雨', 'レイン'], pillar: ['柱', 'ピラー'], mist: ['霧', 'ミスト'], vortex: ['渦', 'ボルテクス'], nova: ['環', 'ノヴァ'],
    orb: ['球', 'オーブ'], volley: ['連弾', 'ラッシュ'], ward: ['盾', 'シールド'], heal: ['癒', 'ヒール'], warp: ['転', 'ワープ'],
    fly: ['翼', 'ウィング'], aura: ['纏', 'オーラ'], meteor: ['流星', 'メテオ'], summon: ['精', 'スピリット'],
  };
  // 障壁と召喚は、形・種類によって名前の字が変わる（例: 岩壁＝ロック・ウォール、炎精＝フレア・スピリット）
  function formName(formId, elemId, modIds) {
    if (formId === 'ward') { const S = MG.WARD_SHAPES[MG.wardShape(elemId, modIds)]; return [S.kanji, S.kana]; }
    if (formId === 'summon') { const S = MG.SUMMONS[MG.summonType(elemId)]; return [S.kanji, S.kana]; }
    return NAME_FORM[formId];
  }
  // 効果: 漢字1字＋短い読み（名前の前に付く）
  const NAME_MOD = {
    burn: ['灼', 'バーン'], corrode: ['蝕', 'ラスト'], refund: ['還', 'リターン'], merge: ['巨', 'ギガ'], split: ['裂', 'シャード'],
    freeze: ['凍', 'フリーズ'], linger: ['久', 'ロング'], pierce: ['貫', 'ピアス'], overload: ['極', 'オーバー'], echo: ['双', 'エコー'],
    crit: ['鋭', 'エッジ'], radiance: ['輝', 'グロウ'], speed: ['速', 'クイック'], pull: ['引', 'プル'], scatter: ['多', 'マルチ'],
    bounce: ['跳', 'バウンド'], resonate: ['震', 'ビート'], area: ['広', 'ワイド'], knock: ['衝', 'ノック'], heavy: ['重', 'ヘヴィ'],
    homing: ['追', 'ホーミング'], chain: ['連', 'リンク'], compress: ['凝', 'コア'], expand: ['膨', 'メガ'], reinforce: ['強', 'ブースト'],
    suction: ['吸', 'サクション'], rewind: ['巻', 'リワインド'], guard: ['護', 'ガード'], drain: ['奪', 'ドレイン'], blink: ['瞬', 'ブリンク'],
    float: ['浮', 'フロート'], smash: ['砕', 'クラッシュ'], haste: ['迅', 'ヘイスト'], familiar: ['従', 'ファミリア'],
  };
  MG.NAME_PARTS = { elem: NAME_ELEM, form: NAME_FORM, mod: NAME_MOD };

  // ひとこと説明（図鑑用）: 形ごとの短い文（E は属性の名前）と、属性・効果の短い特徴
  const FORM_ACT = {
    bolt: (E) => `${E}の弾をまっすぐ撃つ`, lob: (E) => `${E}の砲弾を弧を描いて撃ち、着弾点で爆発させる`, spray: (E) => `${E}の散弾を扇形に撃つ`,
    beam: (E) => `${E}の光線で、一瞬でまっすぐつらぬく`, chain: (E) => `${E}の稲妻が、的から的へはね移る`, rain: (E) => `狙った場所に、${E}の雨を降らせる`,
    pillar: (E) => `足もとから狙った場所へ、${E}の柱を次々と突き出す`, mist: (E) => `狙った場所に${E}の霧を残し、中の的を削り続ける`,
    vortex: (E) => `${E}の渦で的を吸い込み、最後に弾けさせる`, nova: (E) => `自分のまわりに、${E}の衝撃の輪を広げる`,
    orb: (E) => `${E}の宝珠がゆっくり的を追い、大きく炸裂する`, volley: (E) => `${E}の弾を3連続で撃つ`,
    ward: (E) => `${E}の障壁を張り、ダメージを吸い取る`, heal: () => 'HP を回復し、燃焼・凍結・腐食を消す', warp: (E) => `狙った場所へ一瞬で移り、着いた場所に${E}の衝撃を放つ`,
    fly: (E) => `${E}の翼で、しばらく空を自由に飛ぶ`, aura: (E) => `${E}の力を体にまとい、足が速くなる`,
    meteor: (E) => `狙った場所の上空に魔法陣を描き、${E}の流星を落とす`,
    summon: (E) => `${E}の召喚獣を呼び出し、一緒に戦わせる`,
  };
  const ELEM_SHORT = {
    fire: '燃やす', ice: '動きを遅くする', steam: '効果が長く残る', lightning: '近くの的へはね移る', plasma: '高威力・MP 多め', light: 'とても速い',
    acid: '的をもろくする', metal: '重く強い', earth: '吹き飛ばす', void: '少し引き寄せる', ether: '1体すり抜ける', arcane: 'MP が少ない',
    crystal: 'ときどき会心', wind: '速く、押し返す', prism: '少し追いかける', sound: '振動で追加ダメージ', magnet: '追いかける', force: '押し飛ばす',
    vacuum: '吸い寄せる', time: '動きを遅くする',
  };
  const MOD_SHORT = {
    burn: '燃やし続ける', corrode: 'もろくする', refund: 'MP が半分戻る', merge: '巨大で強い', split: '破片に分かれる', freeze: '凍らせる',
    linger: '長く続く', pierce: '2体つらぬく', overload: '威力1.5倍（MP 1.4倍）', echo: 'もう一度発動', crit: '会心しやすい', radiance: '範囲が広い',
    speed: '速く、待ち時間が短い', pull: '引き寄せる', scatter: '弾が2つ増える', bounce: 'はね返る', resonate: '振動で追加ダメージ', area: '範囲がとても広い',
    knock: '大きく吹き飛ばす', heavy: '重い一撃', homing: '追いかける', chain: '近くの的へ連鎖', compress: '小さく強い', expand: '大きく広がる',
    reinforce: '威力1.3倍', suction: '強く吸い寄せる', rewind: '同じダメージをもう一度', guard: '3秒間ダメージ半分', drain: 'HP を吸い取る', blink: '後ろへ跳び退く',
    float: '上へ跳び上がる', smash: '威力1.2倍', haste: '4秒間 足が速い', familiar: '使い魔が撃つ',
  };
  const SUP_TRAITS = { fly: ['空を飛ぶ'], aura: ['足が速くなる', 'まわりにダメージ'] }; // 守り・回復・移動の形の特徴（属性の特徴の代わり）
  // 障壁・召喚のときだけ意味が変わる効果（札の言葉と、説明に足す一言）
  const CTX_TRAIT = {
    ward: { area: 'ドームになる', scatter: '壁が3枚', compress: '大盾になる', merge: '大きい', expand: '大きい', radiance: '大きい' },
    summon: { scatter: '2体呼ぶ', merge: '大きく強い', expand: '大きい', speed: 'すばやい', radiance: '大きい' },
  };
  const CTX_NOTE = {
    ward: { area: '障壁では、形がドームになる', scatter: '障壁では、壁が3枚の城壁になる', compress: '障壁では、形が大盾になる', merge: '障壁が大きくなる', expand: '障壁が大きくなる', radiance: '障壁が大きくなる' },
    summon: { scatter: '召喚では、召喚獣が2体になる', merge: '召喚獣が大きく、HP も多くなる', expand: '召喚獣が大きく、HP も多くなる', speed: '召喚獣の動きと攻撃が速くなる', radiance: '召喚獣が少し大きくなる' },
  };
  const SUM_NOUN = { crystal: '結晶', magnet: '磁力' }; // ひとこと説明の中だけ、読みやすい言い方にする（晶の弾 → 結晶の弾）
  MG.SHORT = { form: FORM_ACT, elem: ELEM_SHORT, mod: MOD_SHORT };
  const KANA_MAX = 12; // 読みが4語になるときや、これより長くなるときは、属性の読みを省いて短くする（属性は漢字と色でわかる）

  // 名前の自動生成: 「効果（1字ずつ）＋属性（1字）＋形」。例: 炎砲弾（フレア・キャノン）、灼雷渦（バーン・ボルト・ボルテクス）
  // 同じ並びなら必ず同じ名前。性能は属性・形・効果だけで決まるので、同じ名前になる並びは中身も同じ魔法
  MG.nameSpell = function (seq) {
    const sec = MG.findSecret(seq);
    if (sec) return { kanji: sec.kanji, kana: sec.kana, rank: '禁呪', secret: true };
    const words = seq.map((id) => MG.WORD_MAP[id]);
    const E = NAME_ELEM[words[0].elem], F = formName(words[1].form, words[0].elem, words.slice(2).map((w) => w.mod));
    const mods = words.slice(2).map((w) => NAME_MOD[w.mod]);
    // 同じ効果が2回並んだときは、字を重ねずに1回だけ書く
    const modK = [], modR = [];
    mods.forEach((m) => { if (!modK.includes(m[0])) { modK.push(m[0]); modR.push(m[1]); } });
    const kanji = modK.join('') + E[0] + F[0];
    let parts = modR.concat([E[1], F[1]]);
    if (parts.length > 3 || parts.join('').length > KANA_MAX) parts = modR.concat([F[1]]);
    return { kanji, kana: parts.join('・'), rank: ['', '', '初級魔法', '中級魔法', '上級魔法'][seq.length], secret: false };
  };

  // 単語の並び → 魔法の性能
  MG.buildSpell = function (seq) {
    if (!Array.isArray(seq) || seq.length < 2 || seq.length > 4) return null;
    if (new Set(seq).size !== seq.length) return null;
    const words = seq.map((id) => MG.WORD_MAP[id]);
    if (words.some((w) => !w)) return null;
    const sec = MG.findSecret(seq);
    const elemId = sec ? sec.elem : words[0].elem;
    const E = MG.ELEMENTS[elemId];
    const formId = words[1].form;
    const F = MG.FORMS[formId];
    const s = {
      seq: seq.slice(), element: elemId, form: formId,
      dmg: F.dmg, speed: F.speed || 0, size: F.size || 0.3, radius: F.radius || 0, count: F.count || 1,
      cd: F.cd, life: F.life || 2, range: F.range || 60, jumps: F.jumps || 0, jumpRange: F.jumpRange || 18,
      area: F.area || 5, dur: F.dur || 0, tick: F.tick || 0.4, spreadDeg: F.spreadDeg || 0, homing: F.homing || 0,
      burn: 0, corrode: 0, refund: 0, split: 0, freeze: 0, pierce: 0, echo: 0, crit: 0, pull: 0, bounce: 0,
      pulses: 0, knock: 0, chainHit: 0, rewind: 0, guard: 0, drain: 0, blink: 0, leap: 0, smash: 0, haste: 0, familiar: 0, costMul: 1, mods: [],
      support: F.support ? formId : null,
    };
    s.dmg *= E.dmg; s.speed *= E.spd; s.costMul *= E.cost;
    for (const k in E.fx) {
      if (k === 'linger') { s.dur *= E.fx.linger; s.life *= 1.1; }
      else s[k] += E.fx[k];
    }
    for (let i = 2; i < words.length; i++) {
      const m = MG.MODS[words[i].mod];
      m.apply(s);
      s.mods.push(words[i].mod);
    }
    s.burst = (F.burst || 0) * (s.dmg / F.dmg);
    // 障壁の形と大きさ（巨大・膨大・光輝で大きく、凝縮で小さく）
    if (formId === 'ward' && !sec) {
      s.shape = MG.wardShape(elemId, s.mods);
      s.wardScale = Math.round(Math.max(0.75, Math.min(2.2, s.size / 0.3)) * 100) / 100;
    }
    // 召喚獣の種類と数（多重で2体）
    if (formId === 'summon' && !sec) {
      s.summonType = MG.summonType(elemId);
      s.summonCount = Math.min(3, 1 + Math.floor((Math.round(s.count) - 1) / 2));
    }
    s.cost = Math.round((F.cost + (seq.length - 2) * 4) * s.costMul);
    s.cd = Math.round(s.cd * 100) / 100;
    s.name = MG.nameSpell(seq);
    if (sec) { s.secret = sec.id; s.cost = sec.cost; s.cd = 3; }

    // 破壊属性: 爆発や衝撃のある形と、爆発系の隠し魔法
    s.destroy = sec ? MG.DESTROY_SECRETS.includes(sec.id) : !!MG.DESTROY_FORMS[formId] || (s.smash > 0 && !F.support);

    // 貫通力: 壁を何枚つらぬけるか（光線は生まれつき 2 枚、貫通・凝縮・神速・重撃と鋼属性で増える）
    s.penetrate = Math.round(s.pierce) + (formId === 'beam' ? 2 : 0) + (elemId === 'metal' ? 1 : 0)
      + s.mods.filter((m) => m === 'compress' || m === 'speed' || m === 'heavy' || m === 'reinforce').length;
    if (sec) s.penetrate = 0;

    // 説明文
    const lines = [];
    if (sec) {
      lines.push(sec.desc);
    } else {
      lines.push(`${E.label}属性の、${F.desc}。`);
      if (formId === 'heal') lines.push('属性の特徴: 回復の魔法では、光の色が変わる。');
      else if (formId === 'ward') {
        const S = MG.WARD_SHAPES[s.shape];
        lines.push(`形: ${S.label} — ${S.desc}。`);
        lines.push(`属性の特徴: 障壁がこわれるとき、${E.label}の衝撃を放つ（${E.note}）。`);
      }
      else if (formId === 'summon') {
        const S = MG.SUMMONS[s.summonType];
        lines.push(`召喚獣: ${E.label}の${S.label}${s.summonCount > 1 ? `（${s.summonCount}体）` : ''} — ${S.desc}。${Math.round(s.dur)}秒で消える。相手の魔法で倒されることもある。`);
        lines.push(`属性の特徴: 召喚獣の攻撃に${E.label}の力が宿る（${E.note}）。`);
      }
      else if (formId === 'warp') lines.push(`属性の特徴: 着いた場所で${E.label}の衝撃を放つ（${E.note}）。`);
      else if (formId === 'fly') lines.push(`属性の特徴: 飛んでいる間、${E.label}の光の粒が尾を引く。時間が切れたら、ゆっくり降りる。`);
      else if (formId === 'aura') lines.push(`属性の特徴: まわりの的に、${E.label}の力で少しずつダメージを与える（${E.note}）。速い属性ほど足が速くなり、雷属性はとくに速い。`);
      else lines.push(`属性の特徴: ${E.note}。`);
      s.mods.forEach((id) => lines.push(`効果: ${MG.MODS[id].desc}。${(CTX_NOTE[formId] && CTX_NOTE[formId][id]) ? `（${CTX_NOTE[formId][id]}）` : ''}`));
    }
    if (s.destroy) lines.push('破壊: 岩や壁などの地形をこわし、地面にクレーターを作る。');
    s.desc = lines;
    // ひとこと説明と、特徴の札（図鑑用）
    if (sec) {
      const parts = sec.desc.split('。').filter(Boolean);
      s.summary = (parts.length > 1 ? parts.slice(1) : parts).join('。') + '。';
      s.traits = ['隠し魔法'];
    } else {
      const EN = SUM_NOUN[elemId] || E.label;
      s.summary = FORM_ACT[formId](EN) + '。';
      s.traits = (F.support ? (SUP_TRAITS[formId] || []) : [ELEM_SHORT[elemId]]).concat(s.mods.map((id) => MOD_SHORT[id]));
      // 障壁・召喚では、形や数を変える効果の札を、その意味の言葉に置きかえる
      if (CTX_TRAIT[formId]) s.traits = (F.support ? (SUP_TRAITS[formId] || []) : [ELEM_SHORT[elemId]]).concat(s.mods.map((id) => CTX_TRAIT[formId][id] || MOD_SHORT[id])).filter((t, i, a) => t && a.indexOf(t) === i);
      if (formId === 'ward') {
        const S = MG.WARD_SHAPES[s.shape];
        s.summary = { sphere: `${EN}の障壁で自分を包み、ダメージを吸い取る`, front: `${EN}の大盾を前に構え、前からのダメージを吸い取る`, wall: `目の前に${EN}の壁を立てて、相手の弾を止める`, fort: `${EN}の壁を3枚立てて、自分を囲む`, dome: `その場に${EN}のドームを張り、外からの弾を止める` }[s.shape] + '。';
        s.traits.unshift(S.label);
      }
      if (formId === 'summon') {
        const S = MG.SUMMONS[s.summonType];
        s.summary = `${EN}の${S.label}を呼び出し、一緒に戦わせる。`;
        s.traits.unshift(S.label + (s.summonCount > 1 ? ` ${s.summonCount}体` : ''));
      }
      s.traits = s.traits.filter((t, i, a) => t && a.indexOf(t) === i);
    }
    if (s.destroy) s.traits.push('地形を壊す');
    s.colors = [E.c1, E.c2];
    s.rainbow = !!E.rainbow;
    // 纏いの足の速さ（倍）: 速い属性ほど速く、雷はとくに速い。神速の効果でさらに上がる
    if (formId === 'aura') {
      s.moveMul = 1.25 + (E.spd - 1) * 0.5 + (elemId === 'lightning' ? 0.25 : 0) + s.mods.filter((m) => m === 'speed').length * 0.15;
      s.moveMul = Math.round(Math.max(1.15, s.moveMul) * 100) / 100;
    }

    // 表示用の数値
    let hits = s.count;
    if (formId === 'chain') hits = 1 + s.jumps;
    if (formId === 'mist') hits = Math.round(s.dur / s.tick);
    if (formId === 'vortex') hits = Math.round(s.dur / s.tick) * 0.4;
    let power = s.dmg * hits + (formId === 'vortex' ? s.burst : 0);
    power *= (1 + s.echo) * (1 + s.crit * 1.5) * (1 + s.pulses * 0.3);
    if (s.support) power = s.dmg * (1 + s.echo);
    if (formId === 'fly') power = s.dur;
    if (sec) power = { redox: 240, cumulo: 330, supernova: 200, horizon: 290, aurora: 70 * 8, zero: 320, fusion: 260, erase: 999 }[sec.id] || power;
    s.power = Math.round(power);
    if (formId === 'summon') power = s.dmg * (MG.SUMMONS[s.summonType] || MG.SUMMONS.spirit).dmgMul * 8 * (s.summonCount || 1);
    s.power = Math.round(power);
    s.areaSize = formId === 'rain' || formId === 'meteor' ? s.area : (formId === 'beam' || formId === 'chain' || formId === 'heal' || formId === 'fly' || formId === 'summon') ? 0 : s.radius;
    // 守り・回復・移動の魔法は、性能の見出しを変える（威力 → 吸収量・回復量）
    s.powerLabel = formId === 'ward' ? '吸収できるダメージ' : formId === 'heal' ? '回復する HP' : formId === 'warp' ? '着地の衝撃' : formId === 'fly' ? '飛べる時間' : formId === 'aura' ? '足の速さ' : '威力';
    // 図鑑で、実測の最大ダメージの代わりに見せる値（守り・回復・飛翔・纏い）
    s.powerShow = formId === 'ward' || formId === 'heal' ? String(Math.round(s.dmg)) : formId === 'fly' ? (Math.round(s.dur * 10) / 10) + '秒' : formId === 'aura' ? s.moveMul.toFixed(2).replace(/0$/, '') + '倍' : null;
    return s;
  };

  // ---- 杖 ----
  // dmg: 威力の倍率 / cost: MP の倍率 / cd: 待ち時間の倍率 / pen: 壁の貫通力に足す / speed: 弾の速さの倍率 / slots: スロットの数
  MG.WANDS = [
    { id: 'novice',      name: '見習いの杖', slots: 4, dmg: 1,    cost: 1,   cd: 1,   pen: 0, speed: 1,    gem: '#7fd8ff', wood: '#2e1a0e', gemScale: 1,   shaft: 1,    desc: '標準的な杖。くせがなく扱いやすい。', look: '茶色の木に、革の持ち手と金の輪、小さな宝石' },
    { id: 'destruction', name: '破壊の杖',   slots: 2, dmg: 1.4,  cost: 1.5, cd: 1.1, pen: 0, speed: 1,    gem: '#ff4a3a', wood: '#1a0c0c', gemScale: 1.6, shaft: 0.95, desc: '威力が1.4倍になる代わりに、MP を1.5倍使う。', look: '黒く太い柄に鉄の輪、先に赤いとげ4本と大きな宝石' },
    { id: 'sage',        name: '賢者の杖',   slots: 5, dmg: 0.9,  cost: 0.7, cd: 1,   pen: 0, speed: 1,    gem: '#9dffb0', wood: '#cdbb90', gemScale: 1.2, shaft: 1.15, desc: 'MP の消費が3割少なく、スロットが5つ。威力は少し下がる。', look: '長い白木に緑のつるが巻きつき、先に金の輪と葉' },
    { id: 'gale',        name: '疾風の杖',   slots: 3, dmg: 1,    cost: 1,   cd: 0.6, pen: 0, speed: 1.25, gem: '#9effe8', wood: '#4a6a70', gemScale: 0.9, shaft: 1.05, desc: '待ち時間が4割短く、弾も速い。', look: '細い柄の先に、三日月の飾りと2枚の羽根' },
    { id: 'pierce',      name: '貫きの杖',   slots: 3, dmg: 1.05, cost: 1.1, cd: 1,   pen: 1, speed: 1.1,  gem: '#c08bff', wood: '#2a2040', gemScale: 1.1, shaft: 1,    desc: '壁の貫通力が1増える。', look: '紫の金属の柄に銀の輪と鍔、先に槍のような細長い結晶' },
  ];
  // 素手: スロットなし。詠唱でしか使えず、詠唱は難しく MP は1.6倍、そのかわり効果が50%アップ
  MG.BARE = { id: 'bare', name: '素手', slots: 0, dmg: 1.5, cost: 1.6, cd: 1, pen: 0, speed: 1, desc: '詠唱でしか魔法を使えない。詠唱は難しく MP を1.6倍使うが、効果が50%アップ。', look: '杖を持たず、両手に光が宿る' };
  MG.WAND_MAP = { bare: MG.BARE };
  MG.WANDS.forEach((w) => (MG.WAND_MAP[w.id] = w));
  MG.CHANT_WAND_MUL = 0.7;  // 杖を持って詠唱したときの効果（30%ダウン）
  MG.SLOT_CHARGES = 3;      // スロットの魔法を無詠唱で使える回数
  MG.RECHARGE_SEC = 15;     // 1回分が戻るまでの秒数

  // 単語の役割の説明（工房の辞典用）
  MG.wordRoles = function (id) {
    const w = MG.WORD_MAP[id];
    const E = MG.ELEMENTS[w.elem], F = MG.FORMS[w.form], M = MG.MODS[w.mod];
    return [
      { pos: '1番目', role: '属性', value: E.label, note: E.note },
      { pos: '2番目', role: '形', value: F.label, note: F.desc },
      { pos: '3・4番目', role: '効果', value: M.kanji, note: M.desc },
    ];
  };
})();
