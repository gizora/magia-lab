// 声で唱えて魔法を放つ: ブラウザの音声認識（Web Speech API）を使う
// 唱えるのは魔法の名前だけ（一度放って名前がわかった魔法）。杖を持っていれば多少の言い間違いも通り、素手のときは一字一句そのまま唱える
(function () {
  'use strict';
  const MG = (window.MG = window.MG || {});

  // ---- 文字をそろえる（カタカナ→ひらがな、記号や空白を消す） ----
  function norm(s) {
    s = String(s || '').normalize('NFKC');
    s = s.replace(/ヴァ/g, 'バ').replace(/ヴィ/g, 'ビ').replace(/ヴェ/g, 'ベ').replace(/ヴォ/g, 'ボ').replace(/ヴ/g, 'ブ');
    s = s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
    return s.replace(/[\s・、。，．,.!！?？「」『』（）()〜~ー\-]/g, '');
  }
  function bigrams(s) { const a = []; for (let i = 0; i < s.length - 1; i++) a.push(s.slice(i, i + 2)); return a; }
  function similarity(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.length < 2 || b.length < 2) return 0;
    const A = bigrams(a), B = bigrams(b).slice();
    let hit = 0;
    A.forEach((x) => { const i = B.indexOf(x); if (i >= 0) { hit++; B.splice(i, 1); } });
    return (2 * hit) / (A.length + bigrams(b).length);
  }

  // 聞き取った文から、唱えた単語を順番どおりに取り出す
  // strict: 素手の詠唱。同音の言葉は受け付けず、ことばそのもの（漢字か読み）だけを数える
  function findWords(text, strict) {
    const t = norm(text);
    const hits = [];
    MG.WORDS.forEach((w) => {
      (strict ? [w.label, w.yomi] : w.alias).forEach((a) => {
        const k = norm(a);
        let from = 0, i;
        while (k && (i = t.indexOf(k, from)) >= 0) { hits.push({ i, len: k.length, id: w.id }); from = i + 1; }
      });
    });
    hits.sort((x, y) => x.i - y.i || y.len - x.len);
    const seq = [];
    let end = -1;
    for (const h of hits) {
      if (h.i < end) continue;
      end = h.i + h.len;
      if (!seq.includes(h.id)) seq.push(h.id);
    }
    const out = seq.slice(0, 4);
    out.end = end;
    return out;
  }

  // 名前の唱え方: 読み（フレア・キャノン）が本命。漢字の名前（超新星 など）で唱えてもよい
  function nameForms(s) { return [norm(s.name.kana), norm(s.name.kanji), norm(s.name.kanji.replace(/の/g, ''))].filter((f) => f && f.length >= 2); }
  // 文の中で、名前にいちばん近い部分の似ている度合い（0〜1）
  function nearScore(t, f) {
    if (!t || !f) return 0;
    if (t.includes(f)) return 1;
    if (t.length <= f.length + 1) return similarity(t, f);
    let best = 0;
    for (let L = Math.max(2, f.length - 1); L <= f.length + 1; L++) for (let i = 0; i + L <= t.length; i++) best = Math.max(best, similarity(t.slice(i, i + L), f));
    return best;
  }
  const LOOSE = 0.6; // 杖を持っているとき: 名前にこれだけ似ていれば発動する
  // 聞き取った文 → 名前で唱えた魔法（candidates: 唱えられる魔法の並びの一覧。前にあるものほど優先）
  // strict（素手）: 名前を一字一句そのまま唱えたときだけ。杖: 多少の言い間違いも許す
  // 戻り値: { seq, spec, score, exact } か、見つからなければ { miss: true, near: いちばん近かった魔法 }
  function matchName(text, candidates, strict) {
    const t = norm(text);
    let best = null, bestScore = 0, near = null, nearSc = 0;
    (candidates || []).forEach((seq) => {
      const s = MG.buildSpell(seq); if (!s) return;
      let exact = 0, loose = 0;
      nameForms(s).forEach((f) => { if (t.includes(f)) exact = Math.max(exact, 1 + f.length / 100); loose = Math.max(loose, nearScore(t, f)); });
      const sc = strict ? exact : Math.max(exact, loose);
      if (sc > bestScore) { bestScore = sc; best = { seq, spec: s, score: sc, exact: exact > 0 }; }
      if (loose > nearSc) { nearSc = loose; near = { seq, spec: s, score: loose }; }
    });
    if (best && (strict ? best.exact : best.score >= LOOSE)) return best;
    return { miss: true, near: nearSc >= 0.45 ? near : null };
  }
  const findName = (text, candidates) => { const m = matchName(text, candidates, false); return m.miss ? null : m; };
  // 名前が文の中に入っているか（似ている度合い need 以上）
  function nameIn(tail, seq, need) {
    const s = MG.buildSpell(seq); if (!s) return false;
    return nameForms(s).some((f) => tail.includes(f) || similarity(tail, f) >= need);
  }
  // 聞き取った文 → 放つ魔法。戻り値: { seq, by: 'name' } または { error: '…' }
  function parse(text, candidates, opts) {
    opts = opts || {};
    if (!candidates || !candidates.length) return { error: 'まだ唱えられる魔法がありません。工房で作った魔法を、スロットか紋章で一度放つと、その名前で唱えられるようになります' };
    const m = matchName(text, candidates, !!opts.strict);
    if (!m.miss) return { seq: m.seq, by: 'name', score: m.score };
    if (opts.strict && m.near) return { error: `素手の詠唱: 名前を一字一句そのまま唱えてください（「${m.near.spec.name.kana}」？）`, near: m.near.seq };
    if (findWords(text).length >= 2) return { error: '詠唱は、魔法の名前だけで唱えます（ことばを並べて唱える方法はなくなりました）。名前は図鑑で確かめられます' };
    return { error: '魔法の名前が聞き取れませんでした（図鑑にある魔法の名前を唱えてください）' };
  }

  // ---- マイクと音声認識（V キーでオン／オフ。オンの間は聞き続ける） ----
  // 音声認識は、しばらく黙っていると自動で止まる。
  //  ・start.bat（http://localhost）で開いたとき: 許可を覚えているので、止まったら自動で聞き直す
  //  ・index.html を直接開いたとき: 聞き直すたびに許可を聞かれるので、自動では聞き直さず知らせる
  let rec = null, want = false, listening = false, restartTimer = 0, failCount = 0, lastErr = '';
  const V = {
    supported: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
    autoRestart: location.protocol !== 'file:',
    get listening() { return listening; },
    get wanted() { return want; },
    norm, findWords, findName, matchName, parse, similarity, nameIn, LOOSE,
    onInterim: null, onFinal: null, onState: null, onError: null, onEnded: null,
    starts: 0,
    start() {
      const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!Rec) { if (V.onError) V.onError('unsupported'); return false; }
      want = true; failCount = 0;
      begin();
      return true;
    },
    stop() {
      want = false; clearTimeout(restartTimer);
      if (rec) { try { rec.abort(); } catch (e) { /* もう止まっている */ } }
      setListening(false);
    },
    // 動作確認用: 聞き取った結果が届いたことにする
    simulate(alternatives) { if (V.onFinal) V.onFinal(Array.isArray(alternatives) ? alternatives : [alternatives]); },
  };
  function setListening(x) { listening = x; if (V.onState) V.onState(x, want); }

  function begin() {
    if (!want) return;
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    try {
      rec = new Rec();
      rec.lang = 'ja-JP';
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 4;
      lastErr = '';
      rec.onstart = () => { failCount = 0; setListening(true); };
      rec.onresult = (e) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) {
            const alts = [];
            for (let k = 0; k < r.length; k++) alts.push(r[k].transcript);
            if (V.onFinal) V.onFinal(alts.filter(Boolean));
          } else if (V.onInterim) V.onInterim(r[0].transcript);
        }
      };
      rec.onerror = (e) => {
        const err = e.error || 'unknown';
        if (err === 'no-speech' || err === 'aborted') return;
        lastErr = err;
        if (err === 'not-allowed' || err === 'service-not-allowed' || err === 'audio-capture') want = false;
        failCount++;
        if (V.onError) V.onError(err);
      };
      rec.onend = () => {
        rec = null;
        setListening(false);
        if (!want) return;
        if (V.autoRestart && failCount < 4) { clearTimeout(restartTimer); restartTimer = setTimeout(begin, 250 + failCount * 600); }
        else { want = false; setListening(false); if (V.onEnded) V.onEnded(V.autoRestart ? 'failed' : 'file'); }
      };
      V.starts++;
      rec.start();
    } catch (e) {
      want = false; setListening(false);
      if (V.onError) V.onError('start-failed');
    }
  }

  MG.Voice = V;
})();
