// GamePita の共通描画処理（ブラウザの app.js と、静的ページを作る tools/build.mjs の両方で使う）
// ユーザーが書いた文字は必ず esc() を通し、URL は safeUrl() を通ったものだけ使う。
(function (root, factory) {
  const m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else root.GPRender = m;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- 決まった選択肢（DB と同じ） ----------
  const GENRES = ['アクション', 'RPG', 'シューティング', 'パズル', 'アドベンチャー', 'シミュレーション', 'ストラテジー',
    'スポーツ', 'レース', '音楽・リズム', 'ホラー', 'サンドボックス', 'カード・ボード', '格闘', 'その他'];
  const GENRE_EMOJI = { 'アクション': '⚔️', 'RPG': '🗡️', 'シューティング': '🔫', 'パズル': '🧩', 'アドベンチャー': '🗺️',
    'シミュレーション': '🏙️', 'ストラテジー': '♟️', 'スポーツ': '⚽', 'レース': '🏎️', '音楽・リズム': '🎵', 'ホラー': '👻',
    'サンドボックス': '⛏️', 'カード・ボード': '🃏', '格闘': '🥊', 'その他': '🎮' };
  // ジャンルページの URL（/genre/rpg/ など）
  const GENRE_SLUG = { 'アクション': 'action', 'RPG': 'rpg', 'シューティング': 'shooting', 'パズル': 'puzzle',
    'アドベンチャー': 'adventure', 'シミュレーション': 'simulation', 'ストラテジー': 'strategy', 'スポーツ': 'sports',
    'レース': 'racing', '音楽・リズム': 'music', 'ホラー': 'horror', 'サンドボックス': 'sandbox',
    'カード・ボード': 'card-board', '格闘': 'fighting', 'その他': 'other' };
  const SLUG_GENRE = Object.fromEntries(Object.entries(GENRE_SLUG).map(([g, s]) => [s, g]));
  const PLATFORMS = ['PC', 'Switch', 'PlayStation', 'Xbox', 'スマホ', 'ブラウザ', 'その他'];
  const PLAYERS = { solo: 'ひとりで', multi: 'みんなで', both: 'どちらも' };
  const LENGTHS = { short: 'すきま時間', long: 'じっくり', both: 'どちらも' };
  const DIFFS = { easy: 'やさしい', normal: 'ふつう', hard: 'むずかしい' };
  const PRICES = { free: '無料（基本無料）', paid: '有料' };
  const MARKS = { want: { e: '👀', t: '気になる' }, playing: { e: '🎮', t: 'プレイ中' }, done: { e: '🏁', t: '遊んだ！' } };

  // ピタっと診断のタイプ（遊び方 × 時間 × 難しさ の8種類）。画像は ogp/type-<slug>.png
  const TYPES = [
    { slug: 'solo-short-easy', e: '🌱', name: 'ゆるっとひとり時間タイプ', ans: { players: 'solo', length: 'short', difficulty: 'easy' },
      desc: 'すきま時間に、ひとりでのんびり遊ぶのが好きなあなた。むずかしすぎず、すぐ始めてすぐやめられるゲームがピタっと合います。' },
    { slug: 'solo-short-hard', e: '⚡', name: 'ひとりで腕だめしタイプ', ans: { players: 'solo', length: 'short', difficulty: 'hard' },
      desc: '短い時間でも本気で挑戦したいあなた。1回は短いけど歯ごたえのある、何度もリトライしたくなるゲームがおすすめ。' },
    { slug: 'solo-long-easy', e: '📖', name: 'じっくり物語ひたりタイプ', ans: { players: 'solo', length: 'long', difficulty: 'easy' },
      desc: 'ひとりで世界にどっぷりひたりたいあなた。ストーリーや世界観をゆっくり楽しめるゲームがピタっと合います。' },
    { slug: 'solo-long-hard', e: '🏔️', name: 'やりこみ求道者タイプ', ans: { players: 'solo', length: 'long', difficulty: 'hard' },
      desc: 'とことんやりこんで、むずかしい壁をこえるのが快感なあなた。長く遊べて手ごわいゲームが向いています。' },
    { slug: 'multi-short-easy', e: '🎉', name: 'みんなでワイワイタイプ', ans: { players: 'multi', length: 'short', difficulty: 'easy' },
      desc: '友だちや家族とサクッと盛り上がりたいあなた。ルールがかんたんで、だれでもすぐ遊べるゲームがおすすめ。' },
    { slug: 'multi-short-hard', e: '🔥', name: '白熱バトルタイプ', ans: { players: 'multi', length: 'short', difficulty: 'hard' },
      desc: '短い勝負で本気のバトルをしたいあなた。うでが試される対戦ゲームがピタっと合います。' },
    { slug: 'multi-long-easy', e: '🏕️', name: 'まったり協力タイプ', ans: { players: 'multi', length: 'long', difficulty: 'easy' },
      desc: 'みんなでのんびり、長い時間いっしょに遊びたいあなた。協力して作ったり冒険したりするゲームがおすすめ。' },
    { slug: 'multi-long-hard', e: '🛡️', name: '最強チーム攻略タイプ', ans: { players: 'multi', length: 'long', difficulty: 'hard' },
      desc: '仲間と力を合わせて、むずかしい目標をクリアしたいあなた。チームでじっくり攻略するゲームが向いています。' },
  ];
  // 診断の答えからタイプを決める（「どっちでも」はひとり・じっくり・やさしい寄りにする）
  function typeOf(ans) {
    const pl = ans.players === 'multi' ? 'multi' : 'solo';
    const ln = ans.length === 'short' ? 'short' : 'long';
    const df = ans.difficulty === 'hard' ? 'hard' : 'easy';
    return TYPES.find(t => t.slug === `${pl}-${ln}-${df}`);
  }

  // ---------- 小物 ----------
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // 日付は日本時間で表示（静的ページを作るサーバーは UTC なので、どこで作っても同じになるように）
  const fmtDate = iso => {
    if (!iso) return '';
    const d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
    return `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  };
  const stars = n => `<span class="stars" aria-label="おすすめ度 ${n} / 5">${'★'.repeat(n)}<span class="off">${'★'.repeat(5 - n)}</span></span>`;

  // ---------- URL の安全チェック ----------
  // https だけ・ホスト名は英数字と . - だけ・空白や < > " ' ` \ を含まない（DB 側の _gp_url_ok と同じ条件）
  const SAFE_URL = /^https:\/\/[A-Za-z0-9.-]+(:\d{1,5})?(\/[^\s<>"'`\\]*)?$/;
  function safeUrl(u) {
    if (typeof u !== 'string' || u.length > 500 || !SAFE_URL.test(u)) return null;
    try { const x = new URL(u); return x.protocol === 'https:' ? x.href : null; } catch { return null; }
  }
  // YouTube の動画 ID（11文字）を取り出す。取れなければ null
  function youtubeId(u) {
    let x; try { x = new URL(u); } catch { return null; }
    const host = x.hostname.replace(/^(www|m|music)\./, '');
    let id = null;
    if (host === 'youtu.be') id = x.pathname.slice(1).split('/')[0];
    else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      if (x.pathname === '/watch') id = x.searchParams.get('v');
      else { const m = x.pathname.match(/^\/(shorts|embed|live)\/([^/]+)/); if (m) id = m[2]; }
    }
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  }
  const IMG_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i;
  function isImageUrl(u) { try { return IMG_EXT.test(new URL(u).pathname); } catch { return false; } }
  const hostOf = u => { try { return new URL(u).hostname; } catch { return ''; } };

  // ---------- 本文 ----------
  // 使える書き方: 「## 見出し」「**太字**」、URL だけの行は埋め込み（画像・YouTube・リンクカード）、
  // 「画像: URL」は拡張子がなくても画像として表示。文中の URL はリンクになる。HTML はすべて文字として表示する。
  const MAX_EMBEDS = 30;
  function inline(text) {
    const out = []; const re = /https:\/\/[^\s<>"'`\\]+/g; let last = 0, m;
    // URL 以外の部分は必ずエスケープしてから太字だけ変換する
    const fmt = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\|\|(.+?)\|\|/g, '<span class="spoiler" tabindex="0" role="button" title="タップでネタバレを表示">$1</span>');
    while ((m = re.exec(text))) {
      let url = m[0];
      const trail = url.match(/[)）。、,.!！?？」』]+$/);
      if (trail) url = url.slice(0, -trail[0].length);
      out.push(fmt(text.slice(last, m.index)));
      const safe = safeUrl(url);
      out.push(safe ? `<a href="${esc(safe)}" target="_blank" rel="noopener noreferrer nofollow ugc">${esc(url)}</a>` : esc(url));
      last = m.index + url.length;
    }
    out.push(fmt(text.slice(last)));
    return out.join('');
  }
  function embedHtml(url, forceImage) {
    const safe = safeUrl(url);
    if (!safe) return null;
    const yt = forceImage ? null : youtubeId(safe);
    if (yt) {
      return `<div class="yt"><iframe src="https://www.youtube-nocookie.com/embed/${yt}" title="YouTube 動画" loading="lazy"
        allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" referrerpolicy="strict-origin-when-cross-origin"
        sandbox="allow-scripts allow-same-origin allow-presentation allow-popups" allowfullscreen></iframe></div>`;
    }
    if (forceImage || isImageUrl(safe)) {
      return `<figure><img src="${esc(safe)}" alt="" loading="lazy" referrerpolicy="no-referrer"></figure>`;
    }
    return `<a class="linkcard" href="${esc(safe)}" target="_blank" rel="noopener noreferrer nofollow ugc">
      <span class="lc-icon">🔗</span><span class="lc-text"><span class="lc-host">${esc(hostOf(safe))}</span>
      <span class="lc-url">${esc(safe)}</span></span></a>`;
  }
  function renderBody(src) {
    const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
    const html = []; let para = []; let embeds = 0; const heads = [];
    const flush = () => { if (para.length) { html.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; } };
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) { flush(); continue; }
      const h = line.match(/^##\s+(.+)$/);
      if (h) { flush(); heads.push(h[1]); html.push(`<h2 id="h-${heads.length}">${inline(h[1])}</h2>`); continue; }
      const img = line.match(/^(?:画像|img)\s*[:：]\s*(\S+)$/i);
      const bare = /^https:\/\/\S+$/.test(line);
      if ((img || bare) && embeds < MAX_EMBEDS) {
        const e = embedHtml(img ? img[1] : line, !!img);
        if (e) { flush(); html.push(e); embeds++; continue; }
      }
      para.push(line);
    }
    flush();
    // 見出しが3つ以上あれば、先頭に目次をつける
    if (heads.length >= 3) {
      html.unshift(`<nav class="toc" aria-label="目次"><b>📑 目次</b><ol>${heads.map((t, i) =>
        `<li><a href="#h-${i + 1}">${esc(t.replace(/\*\*|\|\|/g, ''))}</a></li>`).join('')}</ol></nav>`);
    }
    return html.join('\n');
  }
  // 抜粋・説明文用: 書式記号と URL を取った1行の文
  const plainText = (s, max = 120) => String(s || '').replace(/\|\|.+?\|\|/g, '（ネタバレ）').replace(/^##\s+/gm, '').replace(/\*\*/g, '')
    .replace(/(画像|img)\s*[:：]\s*/gi, '').replace(/https:\/\/\S+/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

  // ---------- 部品 ----------
  // base はサイトの根元の URL パス（例 "/gamepita/"）
  const userUrl = (base, username) => `${base}user/${encodeURIComponent(username)}/`;
  const genreUrl = (base, genre) => `${base}genre/${GENRE_SLUG[genre] || 'other'}/`;
  const postUrl = (base, id) => `${base}blog/${Number(id)}/`;
  const gameUrl = (base, id) => `${base}game/${Number(id)}/`;
  const typeUrl = (base, slug) => `${base}shindan/type/${slug}/`;
  const badgesHtml = list => (list || []).map(b => `<span class="badge" title="${esc(b.t)}">${esc(b.e)} ${esc(b.t)}</span>`).join('');

  function coverHtml(p) {
    const emoji = GENRE_EMOJI[p.genre] || '🎮';
    const url = p.cover_url ? safeUrl(p.cover_url) : null;
    return `<div class="cover" data-emoji="${esc(emoji)}">${url ? `<img src="${esc(url)}" alt="${esc(p.game)}" loading="lazy" referrerpolicy="no-referrer">` : esc(emoji)}</div>`;
  }
  function authorHtml(base, a) {
    a = a || {};
    return a.username
      ? `<a class="author" href="${esc(userUrl(base, a.username))}">${esc(a.avatar || '😀')} ${esc(a.display_name || a.username)}</a>`
      : '<span>退会したユーザー</span>';
  }
  function cardHtml(p, base) {
    const a = p.author || {};
    const ex = p.excerpt != null ? plainText(p.excerpt) : plainText(p.body);
    return `<div class="card-wrap">${p.score != null ? `<span class="score">相性 ${Number(p.score)}%</span>` : ''}
      <a class="card" href="${esc(postUrl(base, p.id))}">
        ${coverHtml(p)}
        <div class="card-body">
          <div><span class="genre-badge">${esc(p.genre)}</span></div>
          <div class="card-game">🎮 ${esc(p.game)}</div>
          <h3 class="card-title">${esc(p.title)}</h3>
          <p class="card-ex">${esc(ex)}</p>
          <div class="card-meta"><span class="who">${esc(a.avatar || '😀')} ${esc(a.display_name || a.username || '退会したユーザー')}</span>
            ${stars(Number(p.rating) || 0)} <span>🧩${Number(p.likes) || 0}</span>${p.comments != null ? ` <span>💬${Number(p.comments) || 0}</span>` : ''}</div>
        </div>
      </a></div>`;
  }
  // 記事の中身（ボタン類は除く）
  function articleInner(p, base) {
    const official = p.official_url ? safeUrl(p.official_url) : null;
    const edited = p.updated_at && new Date(p.updated_at) - new Date(p.created_at) > 60000;
    return `
      <nav class="crumbs" aria-label="パンくずリスト"><a href="${esc(base)}">トップ</a> › <a href="${esc(base)}blog/">ブログ</a> ›
        <a href="${esc(genreUrl(base, p.genre))}">${esc(p.genre)}</a></nav>
      <div class="article-head"><a class="genre-badge" href="${esc(genreUrl(base, p.genre))}">${esc(p.genre)}</a>
        ${p.game_id ? `<a class="game-link" href="${esc(gameUrl(base, p.game_id))}">🎮 <b>${esc(p.game)}</b> の記事をまとめて見る ›</a>` : `<span>🎮 <b>${esc(p.game)}</b></span>`}</div>
      <h1>${esc(p.title)}</h1>
      <div class="article-head">${authorHtml(base, p.author)}${p.author_badges && p.author_badges.length ? `<span class="badges">${badgesHtml(p.author_badges)}</span>` : ''}
        <time datetime="${esc(p.created_at)}">${fmtDate(p.created_at)}</time>${edited ? `<span>（${fmtDate(p.updated_at)} 更新）</span>` : ''}</div>
      <dl class="spec">
        <div><dt>おすすめ度</dt><dd>${stars(Number(p.rating) || 0)}</dd></div>
        <div><dt>遊べる機種</dt><dd>${(p.platforms || []).map(esc).join('・')}</dd></div>
        <div><dt>遊び方</dt><dd>${esc(PLAYERS[p.players] || '')}</dd></div>
        <div><dt>1回の時間</dt><dd>${esc(LENGTHS[p.length] || '')}</dd></div>
        <div><dt>難しさ</dt><dd>${esc(DIFFS[p.difficulty] || '')}</dd></div>
        <div><dt>値段</dt><dd>${esc(PRICES[p.price] || '')}</dd></div>
      </dl>
      ${official ? `<a class="linkcard" href="${esc(official)}" target="_blank" rel="noopener noreferrer nofollow ugc"><span class="lc-icon">🌐</span>
        <span class="lc-text"><span class="lc-host">公式サイト・ストア（${esc(hostOf(official))}）</span><span class="lc-url">${esc(official)}</span></span></a>` : ''}
      <div class="body">${renderBody(p.body)}</div>
      ${(p.tags || []).length ? `<div class="tags">${p.tags.map(t => `<a class="chip tag" href="${esc(base)}blog/?tag=${encodeURIComponent(t)}">#${esc(t)}</a>`).join('')}</div>` : ''}`;
  }
  // トップのヒーロー
  function heroHtml(base) {
    return `<section class="hero">
      <h1>自分に合うゲームを、<br>ピタっと見つけよう。</h1>
      <p>GamePita（ゲームピタ）は、みんなが「これ好き！」を紹介するゲーム記事サイト。質問に答えるだけで、合いそうなゲームがわかります。</p>
      <div class="hero-actions"><a class="btn" href="${esc(base)}shindan/">🧩 ピタっと診断をする</a><a class="btn" href="${esc(base)}new/">✏️ 好きなゲームを紹介する</a></div>
      <div class="hero-deco" aria-hidden="true">🎮</div></section>`;
  }
  function genreLinksHtml(base, current) {
    return `<div class="chips">${GENRES.map(g => `<a class="chip ${current === g ? 'on' : ''}" href="${esc(genreUrl(base, g))}">${GENRE_EMOJI[g]} ${esc(g)}</a>`).join('')}</div>`;
  }

  // 似ている記事の点数（静的ページ生成用。DB の gp_similar と同じ計算）
  function similarScore(a, b) {
    const both = (x, y) => x === y || x === 'both' || y === 'both';
    return (a.game_id && a.game_id === b.game_id ? 4 : 0) + (a.genre === b.genre ? 3 : 0)
      + (both(a.players, b.players) ? 1 : 0) + (both(a.length, b.length) ? 1 : 0) + (a.difficulty === b.difficulty ? 1 : 0)
      + ((a.platforms || []).some(x => (b.platforms || []).includes(x)) ? 1 : 0)
      + Math.min(2, (a.tags || []).filter(x => (b.tags || []).includes(x)).length);
  }

  return {
    MARKS, TYPES, typeOf, gameUrl, typeUrl, badgesHtml, similarScore,
    GENRES, GENRE_EMOJI, GENRE_SLUG, SLUG_GENRE, PLATFORMS, PLAYERS, LENGTHS, DIFFS, PRICES,
    esc, fmtDate, stars, safeUrl, youtubeId, isImageUrl, hostOf, renderBody, plainText,
    userUrl, genreUrl, postUrl, coverHtml, authorHtml, cardHtml, articleInner, heroHtml, genreLinksHtml,
  };
});
