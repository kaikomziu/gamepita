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
  // 商品紹介の種類（DB の gp_goods.category と同じ）。URL は /goods/category/<key>/
  const GOODS_CATS = {
    soft: { e: '💿', t: 'ゲームソフト' }, hard: { e: '🕹️', t: 'ゲーム機' }, acc: { e: '🎧', t: '周辺機器・アクセサリー' },
    goods: { e: '🧸', t: 'グッズ' }, book: { e: '📚', t: '本・攻略本' }, other: { e: '📦', t: 'その他' },
  };
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

  const goodsUrl = (base, id) => `${base}goods/${Number(id)}/`;
  const goodsCatUrl = (base, cat) => `${base}goods/category/${GOODS_CATS[cat] ? cat : 'other'}/`;
  const yen = n => (n == null || n === '' ? '' : `${Number(n).toLocaleString('ja-JP')}円`);

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
  // ---------- 商品紹介 ----------
  function goodsCoverHtml(g) {
    const emoji = (GOODS_CATS[g.category] || GOODS_CATS.other).e;
    const url = g.image_url ? safeUrl(g.image_url) : null;
    return `<div class="cover goods-cover" data-emoji="${esc(emoji)}">${url ? `<img src="${esc(url)}" alt="${esc(g.name)}" loading="lazy" referrerpolicy="no-referrer">` : esc(emoji)}</div>`;
  }
  const prBadge = g => (g.pr ? '<span class="pr-badge" title="メーカーなどから提供・依頼を受けて書かれた紹介です">PR</span>' : '');
  function goodsCardHtml(g, base) {
    const a = g.author || {}; const c = GOODS_CATS[g.category] || GOODS_CATS.other;
    const ex = g.excerpt != null ? plainText(g.excerpt) : plainText(g.body);
    return `<div class="card-wrap"><a class="card" href="${esc(goodsUrl(base, g.id))}">
        ${goodsCoverHtml(g)}
        <div class="card-body">
          <div><span class="genre-badge cat-badge">${c.e} ${esc(c.t)}</span> ${prBadge(g)}</div>
          <div class="card-game">🛍️ ${esc(g.name)}${g.price != null ? ` <span class="price">${esc(yen(g.price))}</span>` : ''}</div>
          <h3 class="card-title">${esc(g.title)}</h3>
          <p class="card-ex">${esc(ex)}</p>
          <div class="card-meta"><span class="who">${esc(a.avatar || '😀')} ${esc(a.display_name || a.username || '退会したユーザー')}</span>
            ${stars(Number(g.rating) || 0)} <span>🧩${Number(g.likes) || 0}</span>${g.comments != null ? ` <span>💬${Number(g.comments) || 0}</span>` : ''}</div>
        </div>
      </a></div>`;
  }
  function goodsInner(g, base) {
    const c = GOODS_CATS[g.category] || GOODS_CATS.other;
    const shop = g.shop_url ? safeUrl(g.shop_url) : null;
    const edited = g.updated_at && new Date(g.updated_at) - new Date(g.created_at) > 60000;
    return `
      <nav class="crumbs" aria-label="パンくずリスト"><a href="${esc(base)}">トップ</a> › <a href="${esc(base)}goods/">商品紹介</a> ›
        <a href="${esc(goodsCatUrl(base, g.category))}">${esc(c.t)}</a></nav>
      <div class="article-head"><a class="genre-badge cat-badge" href="${esc(goodsCatUrl(base, g.category))}">${c.e} ${esc(c.t)}</a>
        ${prBadge(g)}<span>🛍️ <b>${esc(g.name)}</b></span></div>
      <h1>${esc(g.title)}</h1>
      ${g.pr ? '<div class="pr-note">📢 この記事は、メーカーなどから商品の提供や依頼を受けて書かれた紹介（PR）です。</div>' : ''}
      <div class="article-head">${authorHtml(base, g.author)}${g.author_badges && g.author_badges.length ? `<span class="badges">${badgesHtml(g.author_badges)}</span>` : ''}
        <time datetime="${esc(g.created_at)}">${fmtDate(g.created_at)}</time>${edited ? `<span>（${fmtDate(g.updated_at)} 更新）</span>` : ''}</div>
      <dl class="spec">
        <div><dt>おすすめ度</dt><dd>${stars(Number(g.rating) || 0)}</dd></div>
        <div><dt>商品名</dt><dd>${esc(g.name)}</dd></div>
        <div><dt>種類</dt><dd>${c.e} ${esc(c.t)}</dd></div>
        ${g.maker ? `<div><dt>メーカー</dt><dd>${esc(g.maker)}</dd></div>` : ''}
        ${g.price != null ? `<div><dt>参考価格</dt><dd>${esc(yen(g.price))}<span class="small">（書いた時点・目安）</span></dd></div>` : ''}
      </dl>
      ${shop ? `<a class="linkcard shop" href="${esc(shop)}" target="_blank" rel="noopener noreferrer nofollow sponsored ugc"><span class="lc-icon">🛒</span>
        <span class="lc-text"><span class="lc-host">販売ページ・公式ページ（${esc(hostOf(shop))}）</span><span class="lc-url">${esc(shop)}</span></span></a>
        <p class="small">※ 外部のサイトが開きます。買うときは、おうちの人と相談してね。GamePita では売り買いはしていません。</p>` : ''}
      <div class="body">${renderBody(g.body)}</div>
      ${(g.tags || []).length ? `<div class="tags">${g.tags.map(t => `<a class="chip tag" href="${esc(base)}goods/?tag=${encodeURIComponent(t)}">#${esc(t)}</a>`).join('')}</div>` : ''}`;
  }
  function goodsCatLinksHtml(base, current) {
    return `<div class="chips"><a class="chip ${current ? '' : 'on'}" href="${esc(base)}goods/">すべて</a>${Object.entries(GOODS_CATS).map(([k, c]) =>
      `<a class="chip ${current === k ? 'on' : ''}" href="${esc(goodsCatUrl(base, k))}">${c.e} ${esc(c.t)}</a>`).join('')}</div>`;
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

  // ---------- 運営者情報・プライバシーポリシー・利用規約（静的ページとアプリで共通） ----------
  const LEGAL_DATE = '2026年11月13日';
  function aboutHtml(base) {
    return `<section class="rules">
      <h1>🧩 運営者情報・クレジット</h1>
      <h2>GamePita（ゲームピタ）について</h2>
      <p>GamePita は、好きなゲームを紹介し合い、自分に合うゲームを「ピタっと」見つけるためのゲーム紹介記事サイトです。
        だれでも無料で記事を読めて、かるわかGAMESアカウントでログインすると記事を書いたりコメントしたりできます。</p>
      <h2>運営者</h2>
      <dl class="info">
        <div><dt>サイト名</dt><dd>GamePita（ゲームピタ）</dd></div>
        <div><dt>運営者</dt><dd>かるわか（個人で運営しています）</dd></div>
        <div><dt>運営開始</dt><dd>2026年11月</dd></div>
        <div><dt>URL</dt><dd>https://kaikomziu.github.io/gamepita/</dd></div>
        <div><dt>お問い合わせ</dt><dd><a href="${esc(base)}contact/">お問い合わせページ</a>からどうぞ</dd></div>
      </dl>
      <h2>クレジット</h2>
      <dl class="info">
        <div><dt>企画・運営</dt><dd>かるわか</dd></div>
        <div><dt>開発</dt><dd>かるわか ＋ AI（Anthropic の Claude Code）</dd></div>
        <div><dt>ログイン</dt><dd><a href="https://kaikomziu.github.io/game-links/" target="_blank" rel="noopener">かるわかGAMES</a> アカウント</dd></div>
        <div><dt>データの保存</dt><dd>Supabase</dd></div>
        <div><dt>サイトの配信</dt><dd>GitHub Pages ／ GitHub Actions</dd></div>
        <div><dt>動画の埋め込み</dt><dd>YouTube（プライバシー強化モード）</dd></div>
        <div><dt>ロゴ・画像</dt><dd>オリジナル（絵文字は端末の絵文字フォントで表示しています）</dd></div>
        <div><dt>AI記事</dt><dd>「GamePita AI編集部」の記事は AI が書いたものです（タグ「AI記事」つき）</dd></div>
      </dl>
      <h2>商標について</h2>
      <p>サイト内に出てくるゲームの名前・会社名・サービス名は、それぞれの会社の商標または登録商標です。
        GamePita は個人が運営する非公式のファンサイトで、ゲームの会社とは関係ありません。
        記事は利用者の感想で、ゲーム会社の公式な情報ではありません。</p>
      <p class="small"><a href="${esc(base)}terms/">利用規約</a> ・ <a href="${esc(base)}privacy/">プライバシーポリシー</a> ・ <a href="${esc(base)}rules/">投稿のルール</a></p>
    </section>`;
  }
  function privacyHtml(base) {
    return `<section class="rules">
      <h1>🔒 プライバシーポリシー</h1>
      <p>GamePita（以下「このサイト」）は、利用者の情報を大切にあつかいます。このページでは、どんな情報を、何のために使うかを説明します。</p>
      <p class="small">子どもの利用者へ：むずかしいところは、おうちの人といっしょに読んでください。</p>

      <h2>1. 集める情報</h2>
      <ul>
        <li><b>アカウントの情報</b>：ユーザー名・表示名・アイコン（かるわかGAMESアカウント）。パスワードは暗号化して保存していて、運営者も見ることはできません。</li>
        <li><b>投稿した内容</b>：記事・商品紹介・コメント・ピタっと！（いいね）・「気になる／プレイ中／遊んだ！」・通報の内容。</li>
        <li><b>お問い合わせの内容</b>：名前（ニックネームでOK）・種類・本文。</li>
        <li><b>端末に保存する情報</b>：ブラウザの保存領域（localStorage）に、ログイン状態・書きかけの記事・ライト／ダークの設定・お問い合わせの返信を見るための番号を保存します。この情報はこのサイトの動作のためだけに使います。</li>
      </ul>
      <p><b>メールアドレス・本名・住所・電話番号は集めません。</b>
        アクセス解析や広告のための Cookie・追跡ツールも使っていません。</p>

      <h2>2. 情報の使い道</h2>
      <ul>
        <li>記事やコメントをサイトに表示するため</li>
        <li>ログイン・通知・マイリスト・ピタっと診断などの機能を動かすため</li>
        <li>お問い合わせに返信するため</li>
        <li>ルール違反への対応や、荒らし・不正な利用を防ぐため</li>
      </ul>

      <h2>3. 公開される情報・されない情報</h2>
      <ul>
        <li><b>だれでも見られる</b>：記事・商品紹介・コメント・表示名・アイコン・ユーザー名・バッジ・ピタっと！の数。記事は検索エンジンに表示されることがあります。</li>
        <li><b>自分（と運営者）だけ</b>：マイリスト・通知・お問い合わせ・通報の内容。</li>
      </ul>

      <h2>4. 外部のサービス</h2>
      <p>このサイトは、次のサービスを使っています。それぞれのサービスのプライバシーポリシーも適用されます。</p>
      <ul>
        <li><b>Supabase</b>：記事やアカウントなどのデータを保存しています。</li>
        <li><b>GitHub Pages</b>：サイトを配信しています。アクセスしたときの IP アドレスなどが GitHub に記録されることがあります。</li>
        <li><b>YouTube</b>：記事に動画が埋め込まれているとき、YouTube（Google）のプライバシー強化モードで表示します。動画を再生すると YouTube に情報が送られます。</li>
        <li><b>記事の中の画像</b>：画像は、記事を書いた人が指定した外部のサイトから表示しています。画像のサーバーには IP アドレスなどが送られますが、どのページから見たか（リファラ）は送らない設定にしています。</li>
        <li><b>X（旧Twitter）・LINE の共有ボタン</b>：押したときだけ、それぞれのサービスが開きます。</li>
      </ul>

      <h2>5. ほかの人に渡すこと</h2>
      <p>法律にもとづいて求められた場合などをのぞき、集めた情報を本人の同意なくほかの人や会社に渡したり、売ったりすることはありません。</p>

      <h2>6. 情報の削除</h2>
      <ul>
        <li>自分の記事・商品紹介・コメントは、いつでも自分で削除できます。</li>
        <li>かるわかGAMESアカウントを削除すると、GamePita の記事・商品紹介・コメント・ピタっと！・マイリストもすべて削除されます。</li>
        <li>そのほか、削除してほしい情報があれば<a href="${esc(base)}contact/">お問い合わせ</a>からご連絡ください。</li>
      </ul>

      <h2>7. このポリシーの変更</h2>
      <p>このポリシーは、必要に応じて変更することがあります。大きな変更のときは、サイト上でお知らせします。</p>

      <p class="small">制定日：${LEGAL_DATE}<br>運営者：かるわか ／ <a href="${esc(base)}contact/">お問い合わせ</a></p>
    </section>`;
  }
  function termsHtml(base) {
    return `<section class="rules">
      <h1>📄 利用規約</h1>
      <p>この利用規約は、GamePita（以下「このサイト」）を使うときのルールです。このサイトを使った時点で、この規約に同意したものとします。</p>

      <h2>第1条（アカウント）</h2>
      <ul>
        <li>記事を書く・コメントする・ピタっと！などには、かるわかGAMESアカウントでのログインが必要です。</li>
        <li>アカウントとパスワードは自分で管理してください。ほかの人に教えたり、貸したりしないでください。</li>
      </ul>

      <h2>第2条（禁止事項）</h2>
      <p>次のことはしないでください。</p>
      <ul>
        <li>ほかの人やゲームへの悪口・いやがらせ・差別</li>
        <li>名前・住所・学校・電話番号・SNS のIDなど、自分やほかの人の個人情報を書くこと</li>
        <li>こわい・グロい・性的な内容や画像、法律に違反する内容</li>
        <li>ほかの人の文章・画像・動画を、無断で自分のものとして使うこと（著作権の侵害）</li>
        <li>宣伝・勧誘だけを目的にした投稿、あやしいサイトへのリンク</li>
        <li>メーカーなどから商品の提供・お金・依頼を受けて書いた紹介を、「PR」の表示をせずに投稿すること（ステルスマーケティング）</li>
        <li>商品の売り買い・交換・プレゼントの呼びかけ（GamePita では、利用者どうしの取引はできません）</li>
        <li>ネタバレを、隠さずに書くこと（<code>||ネタバレ||</code> で隠してください）</li>
        <li>ほかの人になりすますこと、同じ内容を何度も投稿すること</li>
        <li>サイトに負担をかけたり、不正にアクセスしたりすること</li>
        <li>そのほか、運営者が不適切だと判断すること</li>
      </ul>
      <p>くわしくは<a href="${esc(base)}rules/">投稿のルール</a>も読んでください。</p>

      <h2>第3条（投稿の権利）</h2>
      <ul>
        <li>記事やコメントの著作権は、書いた人にあります。</li>
        <li>書いた人は、このサイトが投稿をサイト内に表示すること、検索エンジン向けのページや SNS 共有用の表示に使うことを許可するものとします。</li>
        <li>ほかの人の権利を侵害する投稿をした場合、その責任は投稿した人が負います。</li>
      </ul>

      <h2>第4条（運営者による対応）</h2>
      <p>運営者は、この規約やルールに違反していると判断した投稿を、予告なく非表示・削除することがあります。
        違反をくり返す場合は、このサイトの利用を制限することがあります。</p>

      <h2>第5条（AI記事について）</h2>
      <p>「GamePita AI編集部」の記事（タグ「AI記事」）は、AI が書いた紹介記事です。内容がまちがっている可能性があるため、ゲームの最新情報は公式サイトなどで確かめてください。</p>

      <h2>第6条（外部リンク・埋め込み・商品紹介）</h2>
      <p>記事の中のリンク先・画像・動画は、外部のサイトのものです。その内容について、このサイトは責任を負いません。</p>
      <p>商品紹介は利用者の感想です。価格・在庫・仕様は変わることがあるため、買う前に販売ページで確かめてください。
        GamePita は商品の販売をしておらず、販売ページでの買い物やトラブルについて責任を負いません。</p>

      <h2>第7条（免責）</h2>
      <ul>
        <li>このサイトは個人が運営しています。できるだけ安定して動かしますが、止まったり、データが消えたりすることがあります。</li>
        <li>記事の内容（利用者の感想）の正しさは保証しません。</li>
        <li>利用者どうしのトラブルは、当事者どうしで解決してください。</li>
      </ul>

      <h2>第8条（サービスの変更・終了）</h2>
      <p>運営者は、予告なくこのサイトの内容を変更したり、サービスを終了したりすることがあります。</p>

      <h2>第9条（規約の変更）</h2>
      <p>この規約は、必要に応じて変更することがあります。変更後にこのサイトを使った場合、変更に同意したものとします。</p>

      <h2>第10条（準拠法）</h2>
      <p>この規約は、日本の法律にもとづいて解釈します。</p>

      <p class="small">制定日：${LEGAL_DATE}<br>運営者：かるわか ／ <a href="${esc(base)}contact/">お問い合わせ</a></p>
    </section>`;
  }

  return {
    aboutHtml, privacyHtml, termsHtml,
    GOODS_CATS, goodsUrl, goodsCatUrl, yen, goodsCoverHtml, goodsCardHtml, goodsInner, goodsCatLinksHtml,
    MARKS, TYPES, typeOf, gameUrl, typeUrl, badgesHtml, similarScore,
    GENRES, GENRE_EMOJI, GENRE_SLUG, SLUG_GENRE, PLATFORMS, PLAYERS, LENGTHS, DIFFS, PRICES,
    esc, fmtDate, stars, safeUrl, youtubeId, isImageUrl, hostOf, renderBody, plainText,
    userUrl, genreUrl, postUrl, coverHtml, authorHtml, cardHtml, articleInner, heroHtml, genreLinksHtml,
  };
});
