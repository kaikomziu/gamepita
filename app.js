// GamePita ― 自分に合うゲームをピタっと見つける
// データは共有 Supabase の gp_* RPC。ログインはかるわかGAMESアカウント（window.KaAccount）
// URL は /blog/123/ のような本物のパス（History API）。公開ページは tools/build.mjs が静的 HTML も作る。
(() => {
  'use strict';
  const VERSION = '1.4.0';
  const SUPABASE_URL = 'https://kifnzvktwbomxthzvvgy.supabase.co';
  // 公開用キー（ブラウザに置いてよいキー。テーブルは RLS で閉じていて RPC しか呼べない）
  const SUPABASE_KEY = 'sb_publishable_Ea_sHRg6wMwO9YkDTjgOog_stQT1mfq';
  const HEADERS = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };
  const R = window.GPRender;
  const { GENRES, GENRE_EMOJI, GENRE_SLUG, SLUG_GENRE, PLATFORMS, PLAYERS, LENGTHS, DIFFS, PRICES,
    esc, fmtDate, safeUrl, youtubeId, isImageUrl, renderBody, plainText, userUrl, genreUrl, postUrl,
    MARKS, TYPES, typeOf, gameUrl, typeUrl, badgesHtml, GOODS_CATS, goodsUrl, goodsCatUrl } = R;
  // サイトの根元（例 "/gamepita/"）と公開 URL（canonical・共有用）
  const me$ = document.currentScript;
  const BASE = (me$ && me$.dataset.base) || '/';
  const SITE = ((me$ && me$.dataset.site) || location.origin + BASE).replace(/\/?$/, '/');
  const abs = path => SITE + path.slice(BASE.length);   // BASE からのパス → 公開 URL
  const ka = window.KaAccount || null;
  const $ = id => document.getElementById(id);
  const app = $('app');

  const REASONS = {
    auth: 'ログインが必要です（期限が切れたかもしれません）。',
    title: 'タイトルは1〜60文字にしてください。',
    game: 'ゲーム名は1〜60文字にしてください。',
    genre: 'ジャンルを選んでください。',
    attrs: '「遊び方・時間・難しさ・値段」を選んでください。',
    rating: 'おすすめ度（★）を選んでください。',
    body: '本文は1〜8000文字で書いてください。',
    url: 'URL は https:// で始まるものだけ使えます（空白や記号 < > " は入れられません）。',
    tags: 'タグは5個まで、1つ20文字までです（空白なし）。',
    platforms: '遊べる機種を1つ以上選んでください。',
    too_many_today: '記事の投稿は1日10件までです。',
    too_many: '回数が多すぎます。少し待ってからもう一度どうぞ。',
    comment: 'コメントは1〜500文字で書いてください。',
    reason: '通報の理由を1〜200文字で書いてください。',
    forbidden: 'この操作はできません。',
    not_found: '見つかりませんでした（消された可能性があります）。',
    bad: '入力の形がおかしいようです。',
    name: 'お名前（ニックネーム）は1〜40文字で書いてください。',
    inquiry: 'お問い合わせの内容は1〜2000文字で書いてください。',
    goods_name: '商品名は1〜80文字にしてください。',
    category: '商品の種類を選んでください。',
    maker: 'メーカー名は40文字までです。',
    price: '参考価格は 0〜10,000,000 円の数字で書いてください（わからなければ空でOK）。',
  };
  const reasonText = r => REASONS[r] || 'うまくいきませんでした。もう一度ためしてください。';

  // ---------- 通信 ----------
  async function rpc(fn, body = {}) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`${fn}: ${res.status}`);
    return res.json();
  }
  const token = () => (ka ? ka.token() : null);

  // ---------- 小物 ----------
  const ago = iso => {
    const s = (Date.now() - new Date(iso)) / 1000;
    if (s < 60) return 'たった今';
    if (s < 3600) return `${Math.floor(s / 60)}分前`;
    if (s < 86400) return `${Math.floor(s / 3600)}時間前`;
    if (s < 86400 * 30) return `${Math.floor(s / 86400)}日前`;
    return fmtDate(iso);
  };
  let toastTimer = 0;
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 3200);
  }
  const card = p => R.cardHtml(p, BASE);
  const gcard = g => R.goodsCardHtml(g, BASE);

  // ---------- タイトル・説明文・canonical ----------
  const DEFAULT_DESC = '好きなゲームを紹介し合うサイト。だれでも記事を書けて、ピタっと診断で自分に合うゲームが見つかります。';
  function headTag(sel, make) { let el = document.head.querySelector(sel); if (!el) { el = make(); document.head.appendChild(el); } return el; }
  function metaSet(attr, key, val) {
    const el = headTag(`meta[${attr}="${key}"]`, () => { const m = document.createElement('meta'); m.setAttribute(attr, key); return m; });
    el.setAttribute('content', val);
  }
  function setMeta({ title, desc, path, noindex }) {
    const full = title ? `${title}｜GamePita` : 'GamePita（ゲームピタ）｜自分に合うゲームをピタっと見つける';
    document.title = full;
    metaSet('name', 'description', desc || DEFAULT_DESC);
    metaSet('property', 'og:title', full);
    metaSet('property', 'og:description', desc || DEFAULT_DESC);
    metaSet('name', 'robots', noindex ? 'noindex' : 'index,follow');
    const url = abs(path || BASE);
    metaSet('property', 'og:url', url);
    headTag('link[rel="canonical"]', () => { const l = document.createElement('link'); l.rel = 'canonical'; return l; }).href = url;
  }

  // ---------- ページの移動（History API） ----------
  function go(url, replace = false) {
    if (replace) history.replaceState(null, '', url); else history.pushState(null, '', url);
    route(); if (!replace) window.scrollTo({ top: 0 });
  }
  // サイト内リンクはページを読み直さずに切りかえる
  document.addEventListener('click', e => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest('a[href]');
    if (!a || a.target || a.hasAttribute('download') || a.origin !== location.origin || !a.pathname.startsWith(BASE)) return;
    // サイトの中のファイル（sitemap.xml など）と、同じページ内の目次リンクは普通に開く
    if (/\.[a-z0-9]+$/i.test(a.pathname)) return;
    if (a.hash && a.pathname === location.pathname && a.search === location.search) return;
    e.preventDefault();
    if (a.hasAttribute('data-close')) closeModal();
    go(a.pathname + a.search);
  });
  window.addEventListener('popstate', route);

  // ---------- ネタバレ（タップで表示） ----------
  document.addEventListener('click', e => { const sp = e.target.closest('.spoiler'); if (sp) sp.classList.toggle('open'); });
  document.addEventListener('keydown', e => {
    const sp = e.target.closest && e.target.closest('.spoiler');
    if (sp && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); sp.classList.toggle('open'); }
  });

  // ---------- ダークモード ----------
  const darkMq = window.matchMedia('(prefers-color-scheme: dark)');
  const isDark = () => { const t = document.documentElement.getAttribute('data-theme'); return t ? t === 'dark' : darkMq.matches; };
  const themeIcon = () => { const b = $('themeBtn'); b.textContent = isDark() ? '☀️' : '🌙'; b.setAttribute('aria-label', isDark() ? 'ライトモードにする' : 'ダークモードにする'); };
  $('themeBtn').addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('gp_theme', next); } catch { /* 保存できなくても切りかえだけはする */ }
    themeIcon();
  });
  darkMq.addEventListener?.('change', themeIcon);
  themeIcon();

  // ---------- 画像が読めなかったら隠す（インラインの onerror は CSP で使えないのでまとめて拾う） ----------
  document.addEventListener('error', e => {
    const t = e.target;
    if (t && t.tagName === 'IMG') {
      const c = t.closest('.cover');
      if (c) c.textContent = c.dataset.emoji || '🎮'; else t.classList.add('broken');
    }
  }, true);

  // ---------- ログイン ----------
  let me = null;
  async function loadMe() {
    if (!token()) { me = null; return; }
    try { const r = await rpc('gp_me', { p_token: token() }); me = r.ok ? r : null; } catch { /* 通信失敗時はそのまま */ }
  }
  // ---------- 通知（自分の記事へのコメント・ピタっと！） ----------
  let notifs = null;
  async function loadNotifs() {
    if (!token()) { notifs = null; drawBell(); return; }
    try { const r = await rpc('gp_notifs', { p_token: token() }); notifs = r.ok ? r : null; } catch { /* 次の機会に */ }
    drawBell();
  }
  function drawBell() {
    $('bellBtn').classList.toggle('hidden', !token());
    const n = notifs ? Number(notifs.unread) : 0;
    $('bellN').textContent = n > 99 ? '99+' : String(n);
    $('bellN').classList.toggle('hidden', !n);
  }
  $('bellBtn').addEventListener('click', async () => {
    if (!token()) return;
    if (!notifs) await loadNotifs();
    const items = notifs?.items || [];
    openModal(`<h2>🔔 通知</h2><div class="notif-list">${items.length ? items.map(x => `
        ${x.kind === 'reply' ? `<a class="notif ${x.unread ? 'unread' : ''}" href="${BASE}contact/" data-close>
          📮 <b>お問い合わせに返信がありました</b><span class="small">${esc(ago(x.at))}</span>
          ${x.body ? `<span class="small">${esc(x.body)}</span>` : ''}</a>`
        : `<a class="notif ${x.unread ? 'unread' : ''}" href="${esc(x.goods_id ? goodsUrl(BASE, x.goods_id) : postUrl(BASE, x.post_id))}" data-close>
          ${esc(x.who?.avatar || '😀')} <b>${esc(x.who?.display_name || x.who?.username || 'だれか')}</b> さんが
          ${x.kind === 'comment' ? '💬 コメントしました' : '🧩 ピタっと！しました'}
          <span class="small">「${esc(x.post_title || '')}」・${esc(ago(x.at))}</span>
          ${x.body ? `<span class="small">${esc(x.body)}</span>` : ''}</a>`}`).join('')
      : '<p class="small">まだ通知はありません。記事にコメントやピタっと！がつくと、ここに届きます。</p>'}</div>
      <div class="form-actions"><button class="btn btn-ghost" type="button" data-close>閉じる</button></div>`);
    if (notifs && Number(notifs.unread)) {
      try { await rpc('gp_notif_seen', { p_token: token() }); notifs.unread = 0; notifs.items.forEach(x => { x.unread = false; }); drawBell(); } catch { /* 次に開いたとき */ }
    }
  });
  setInterval(() => { if (!document.hidden && token()) loadNotifs(); }, 60000);

  function updateHeader() {
    const u = ka?.user();
    $('userAvatar').textContent = u?.avatar || (u ? '😀' : '👤');
    $('userName').textContent = u ? (u.display_name || u.username) : 'ログイン';
  }
  async function requireLogin() {
    if (token()) return true;
    if (!ka) { toast('アカウント機能を読み込めませんでした（オフラインかもしれません）'); return false; }
    const p = await ka.requireLogin();
    if (p) { await loadMe(); updateHeader(); }
    return !!p;
  }
  $('userBtn').addEventListener('click', async () => {
    if (!ka) { toast('アカウント機能を読み込めませんでした'); return; }
    const u = ka.user();
    if (!u) { await requireLogin(); return; }
    openModal(`<h2>${esc(u.avatar || '😀')} ${esc(u.display_name || u.username)}</h2>
      <div style="display:grid;gap:8px">
        <a class="btn" href="${esc(userUrl(BASE, u.username))}" data-close>📝 自分の記事</a>
        <a class="btn" href="${BASE}mylist/" data-close>📋 マイリスト（気になる・遊んだ！）</a>
        <button class="btn" type="button" id="mAccount">⚙️ アカウント設定・ログアウト</button>
        ${me?.is_admin ? `<a class="btn" href="${BASE}admin/" data-close>🛡️ 管理（通報）</a>` : ''}
        <button class="btn btn-ghost" type="button" data-close>閉じる</button>
      </div>`);
    $('mAccount').addEventListener('click', () => { closeModal(); ka.openPanel(); });
  });

  // ---------- モーダル ----------
  function openModal(html) {
    $('modalBox').innerHTML = html; $('modal').classList.remove('hidden');
    $('modalBox').querySelectorAll('button[data-close]').forEach(b => b.addEventListener('click', closeModal));
  }
  function closeModal() { $('modal').classList.add('hidden'); $('modalBox').innerHTML = ''; }
  $('modal').addEventListener('click', e => { if (e.target === $('modal')) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('modal').classList.contains('hidden')) closeModal(); });
  function confirmBox(msg, okLabel = 'OK', danger = false) {
    return new Promise(resolve => {
      openModal(`<h2>確認</h2><p>${esc(msg)}</p><div class="form-actions">
        <button class="btn btn-ghost" type="button" id="cNo">やめる</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" type="button" id="cYes">${esc(okLabel)}</button></div>`);
      $('cNo').onclick = () => { closeModal(); resolve(false); };
      $('cYes').onclick = () => { closeModal(); resolve(true); };
    });
  }
  async function reportBox(target, id) {
    if (!(await requireLogin())) return;
    openModal(`<h2>🚩 通報</h2><p class="small">ルール違反（悪口・個人情報・不適切な画像・宣伝目的など）を管理者に知らせます。</p>
      <textarea id="rReason" rows="3" maxlength="200" placeholder="理由（200文字まで）"></textarea>
      <div class="form-actions"><button class="btn btn-ghost" type="button" data-close>やめる</button>
      <button class="btn btn-primary" type="button" id="rSend">送る</button></div>`);
    $('rSend').onclick = async () => {
      try {
        const r = await rpc('gp_report', { p_token: token(), p_target: target, p_id: id, p_reason: $('rReason').value.trim() });
        if (!r.ok) { toast(reasonText(r.reason)); return; }
        closeModal(); toast('通報しました。ご協力ありがとうございます。');
      } catch { toast('送れませんでした。通信を確かめてください。'); }
    };
  }

  // ---------- 遊んだ！・気になる ----------
  function marksHtml(gameId, my, counts) {
    return `<div class="marks" data-game="${Number(gameId)}"><span class="label">このゲーム:</span>
      ${Object.entries(MARKS).map(([k, m]) => `<button class="btn btn-sm mark-btn ${my === k ? 'on' : ''}" type="button" data-mark="${k}" aria-pressed="${my === k}">${m.e} ${esc(m.t)}${counts ? ` <span class="small">${Number(counts[k]) || 0}</span>` : ''}</button>`).join('')}
      <a class="small" href="${BASE}mylist/">マイリスト ›</a></div>`;
  }
  function bindMarks(root) {
    root.querySelectorAll('.marks').forEach(box => box.addEventListener('click', async e => {
      const b = e.target.closest('[data-mark]'); if (!b) return;
      if (!(await requireLogin())) return;
      const status = b.classList.contains('on') ? null : b.dataset.mark;
      try {
        const r = await rpc('gp_mark_set', { p_token: token(), p_game_id: Number(box.dataset.game), p_status: status });
        if (!r.ok) { toast(reasonText(r.reason)); return; }
        box.querySelectorAll('[data-mark]').forEach(x => { const on = x.dataset.mark === status; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); });
        toast(status ? `${MARKS[status].e} 「${MARKS[status].t}」に入れました` : 'マイリストから外しました');
      } catch { toast('通信できませんでした'); }
    }));
  }

  // ---------- トップ ----------
  async function renderHome() {
    setMeta({ path: BASE });
    app.innerHTML = `${R.heroHtml(BASE)}
      <form class="toolbar" id="searchForm" role="search">
        <div class="search"><input type="search" id="q" placeholder="ゲーム名・キーワードでさがす" maxlength="50">
          <button type="submit" aria-label="検索">🔍</button></div>
      </form>
      <h2 class="section-title">🆕 新着の記事</h2>
      <div id="newList" class="grid"><div class="loading">読み込み中…</div></div>
      <div class="more"><a class="btn" href="${BASE}blog/">📚 記事をもっと見る</a></div>
      <h2 class="section-title">🛍️ 新着の商品紹介</h2>
      <div id="goodsNew" class="grid"><div class="loading">読み込み中…</div></div>
      <div class="more"><a class="btn" href="${BASE}goods/">🛍️ 商品紹介をもっと見る</a></div>
      <h2 class="section-title">🧩 ピタっと！が多い記事</h2>
      <div id="popList" class="grid"><div class="loading">読み込み中…</div></div>
      <h2 class="section-title">🎮 ジャンルからさがす</h2>
      ${R.genreLinksHtml(BASE, '')}
      <h2 class="section-title">🏷️ よく使われているタグ</h2>
      <div class="chips" id="tagCloud"><span class="small">読み込み中…</span></div>`;
    $('searchForm').addEventListener('submit', e => { e.preventDefault(); go(listUrl({ q: $('q').value.trim(), genre: '', tag: '', sort: 'new' })); });
    const fill = async (id, sort) => {
      try {
        const r = await rpc('gp_list', { p_q: null, p_genre: null, p_tag: null, p_author: null, p_sort: sort, p_offset: 0 });
        const el = $(id); if (!el) return;
        const items = r.items.slice(0, 8);
        el.innerHTML = items.length ? items.map(card).join('')
          : `<div class="empty" style="grid-column:1/-1">まだ記事がありません。<br><a class="btn btn-primary" href="${BASE}new/" style="margin-top:12px">✏️ 最初の記事を書く</a></div>`;
      } catch { const el = $(id); if (el) el.innerHTML = '<div class="empty" style="grid-column:1/-1">読み込めませんでした。</div>'; }
    };
    fill('newList', 'new'); fill('popList', 'popular');
    rpc('gp_goods_list', { p_q: null, p_category: null, p_tag: null, p_author: null, p_sort: 'new', p_offset: 0 }).then(r => {
      const el = $('goodsNew'); if (!el) return;
      const items = r.items.slice(0, 4);
      el.innerHTML = items.length ? items.map(gcard).join('')
        : `<div class="empty" style="grid-column:1/-1">まだ商品紹介がありません。<br><a class="btn btn-primary" href="${BASE}goods/new/" style="margin-top:12px">🛍️ 最初の商品を紹介する</a></div>`;
    }).catch(() => { const el = $('goodsNew'); if (el) el.innerHTML = ''; });
    loadTags();
  }
  function loadTags() {
    rpc('gp_tags').then(tags => {
      const el = $('tagCloud'); if (!el) return;
      el.innerHTML = tags.length ? tags.map(t => `<a class="chip tag" href="${esc(listUrl({ tag: t.tag, q: '', genre: '', sort: 'new' }))}">#${esc(t.tag)} <span class="small">${Number(t.n)}</span></a>`).join('')
        : '<span class="small">まだタグはありません。</span>';
    }).catch(() => { const el = $('tagCloud'); if (el) el.innerHTML = ''; });
  }

  // ---------- ブログ（記事一覧）・ジャンル別 ----------
  const listState = { q: '', genre: '', tag: '', sort: 'new' };
  function listUrl(over = {}) {
    const s = { ...listState, ...over }; const qs = new URLSearchParams();
    if (s.q) qs.set('q', s.q); if (s.tag) qs.set('tag', s.tag); if (s.sort && s.sort !== 'new') qs.set('sort', s.sort);
    const str = qs.toString();
    return (s.genre ? genreUrl(BASE, s.genre) : `${BASE}blog/`) + (str ? `?${str}` : '');
  }
  async function renderList(genre) {
    const qs = new URLSearchParams(location.search);
    listState.genre = genre || '';
    listState.q = (qs.get('q') || '').slice(0, 50);
    listState.tag = (qs.get('tag') || '').slice(0, 20);
    listState.sort = ['new', 'popular', 'rating'].includes(qs.get('sort')) ? qs.get('sort') : 'new';
    const path = genre ? genreUrl(BASE, genre) : `${BASE}blog/`;
    const filtered = listState.q || listState.tag || listState.sort !== 'new';
    const heading = genre ? `${GENRE_EMOJI[genre]} ${genre}のおすすめゲーム` : '📚 ブログ（ゲーム紹介記事の一覧）';
    setMeta({
      title: genre ? `${genre}のおすすめゲーム紹介記事` : (listState.tag ? `#${listState.tag} の記事` : 'ブログ（ゲーム紹介記事の一覧）'),
      desc: genre ? `${genre}ジャンルのおすすめゲームを、みんなの紹介記事で見つけよう。GamePita のゲーム紹介記事の一覧です。`
        : 'みんなが書いたゲーム紹介記事の一覧。キーワード・ジャンル・タグでさがせます。',
      path, noindex: !!filtered,
    });
    app.innerHTML = `
      <h1 class="page-title">${esc(heading)}</h1>
      <form class="toolbar" id="searchForm" role="search">
        <div class="search"><input type="search" id="q" placeholder="ゲーム名・キーワードでさがす" maxlength="50" value="${esc(listState.q)}">
          <button type="submit" aria-label="検索">🔍</button></div>
        <select id="sort" aria-label="並べ替え">
          <option value="new">新しい順</option><option value="popular">ピタっと！が多い順</option><option value="rating">おすすめ度順</option>
        </select>
      </form>
      <div class="chips">
        <a class="chip ${genre ? '' : 'on'}" href="${BASE}blog/">すべて</a>
        ${GENRES.map(g => `<a class="chip ${genre === g ? 'on' : ''}" href="${esc(genreUrl(BASE, g))}">${GENRE_EMOJI[g]} ${esc(g)}</a>`).join('')}
      </div>
      ${listState.tag ? `<div class="filter-note">タグ <b>#${esc(listState.tag)}</b> の記事 <a class="btn btn-sm btn-ghost" href="${esc(listUrl({ tag: '' }))}">✕ 解除</a></div>` : ''}
      ${listState.q ? `<div class="filter-note">「<b>${esc(listState.q)}</b>」の検索結果 <a class="btn btn-sm btn-ghost" href="${esc(listUrl({ q: '' }))}">✕ 解除</a></div>` : ''}
      <div id="list" class="grid"><div class="loading">読み込み中…</div></div>
      <div class="more hidden" id="moreWrap"><button class="btn" type="button" id="moreBtn">もっと見る</button></div>`;
    $('sort').value = listState.sort;
    $('searchForm').addEventListener('submit', e => { e.preventDefault(); go(listUrl({ q: $('q').value.trim() })); });
    $('sort').addEventListener('change', () => go(listUrl({ sort: $('sort').value })));
    let offset = 0;
    const load = async () => {
      try {
        const r = await rpc('gp_list', { p_q: listState.q || null, p_genre: listState.genre || null, p_tag: listState.tag || null,
          p_author: null, p_sort: listState.sort, p_offset: offset });
        const list = $('list'); if (!list) return;
        if (offset === 0) list.innerHTML = '';
        if (!r.items.length && offset === 0) {
          list.innerHTML = `<div class="empty" style="grid-column:1/-1">${listState.q || listState.tag || genre ? '条件に合う記事が見つかりませんでした。' : 'まだ記事がありません。'}<br>
            <a class="btn btn-primary" href="${BASE}new/" style="margin-top:12px">✏️ 記事を書く</a></div>`;
        }
        list.insertAdjacentHTML('beforeend', r.items.map(card).join(''));
        offset += r.items.length;
        $('moreWrap').classList.toggle('hidden', !r.more);
      } catch {
        const list = $('list'); if (list) list.innerHTML = '<div class="empty" style="grid-column:1/-1">読み込めませんでした。通信を確かめて、もう一度開いてください。</div>';
      }
    };
    $('moreBtn').addEventListener('click', async e => { e.target.disabled = true; await load(); e.target.disabled = false; });
    load();
  }

  // ---------- 記事ページ ----------
  async function renderPost(id) {
    // 静的ページの中身があればそのまま見せておき、最新の内容が届いたら差しかえる
    if (!app.querySelector('.article')) app.innerHTML = '<div class="loading">読み込み中…</div>';
    let r;
    try { r = await rpc('gp_get', { p_token: token(), p_id: id }); } catch { if (!app.querySelector('.article')) app.innerHTML = '<div class="empty">読み込めませんでした。</div>'; return; }
    if (!r.ok) {
      setMeta({ title: '記事が見つかりません', noindex: true, path: postUrl(BASE, id) });
      app.innerHTML = `<div class="empty">${esc(reasonText(r.reason))}<br><a href="${BASE}blog/">ブログ一覧へ</a></div>`; return;
    }
    const p = r.post;
    setMeta({ title: `${p.title}（${p.game}）`, desc: plainText(p.body, 110) || DEFAULT_DESC, path: postUrl(BASE, p.id), noindex: p.status !== 'public' });
    const shareUrl = abs(postUrl(BASE, p.id));
    app.innerHTML = `
      <article class="article">
        ${R.coverHtml(p)}
        <div class="article-in">
          ${p.status === 'removed' ? '<div class="removed-note">この記事は管理者により非表示になっています（管理者だけに見えています）。</div>' : ''}
          ${R.articleInner(p, BASE)}
          ${p.game_id ? marksHtml(p.game_id, p.my_mark) : ''}
          <div class="actions">
            <button class="btn pita ${p.liked ? 'on' : ''}" type="button" id="pitaBtn" aria-pressed="${p.liked ? 'true' : 'false'}">🧩 ピタっと！ <b id="pitaN">${Number(p.likes) || 0}</b></button>
            <button class="btn btn-sm" type="button" id="copyBtn">🔗 リンクをコピー</button>
            <a class="btn btn-sm" target="_blank" rel="noopener noreferrer" href="https://twitter.com/intent/tweet?text=${encodeURIComponent(`${p.title}｜GamePita`)}&url=${encodeURIComponent(shareUrl)}">𝕏 ポスト</a>
            <span style="flex:1"></span>
            ${p.mine ? `<a class="btn btn-sm" href="${esc(postUrl(BASE, p.id))}edit/">✏️ 編集</a>` : ''}
            ${p.mine || (r.is_admin && p.status === 'public') ? `<button class="btn btn-sm btn-danger" type="button" id="delBtn">🗑️ ${p.mine ? '削除' : '非表示（管理）'}</button>` : ''}
            ${!p.mine ? '<button class="btn btn-sm btn-ghost" type="button" id="repBtn">🚩 通報</button>' : ''}
          </div>
        </div>
      </article>
      <section class="similar" id="similar"></section>
      <section class="comments">
        <h2>💬 コメント（${r.comments.length}）</h2>
        <div id="commentList">${r.comments.length ? r.comments.map(commentHtml).join('') : '<p class="small">まだコメントはありません。</p>'}</div>
        <form class="comment-form" id="commentForm">
          <textarea id="commentText" rows="2" maxlength="500" placeholder="${token() ? 'コメントを書く（500文字まで）' : 'ログインするとコメントできます'}"></textarea>
          <button class="btn btn-primary" type="submit">送信</button>
        </form>
      </section>
      <p style="text-align:center;margin-top:18px"><a href="${BASE}blog/">← ブログ一覧へ</a></p>`;

    bindMarks(app);
    rpc('gp_similar', { p_id: p.id }).then(list => {
      const el = $('similar'); if (!el || !list.length) return;
      el.innerHTML = `<h2 class="section-title">🧩 このゲームが好きなら、これも</h2><div class="grid">${list.map(card).join('')}</div>`;
    }).catch(() => { /* 出せなくても記事は読める */ });
    $('pitaBtn').addEventListener('click', async () => {
      if (!(await requireLogin())) return;
      try {
        const x = await rpc('gp_like_toggle', { p_token: token(), p_id: p.id });
        if (!x.ok) { toast(reasonText(x.reason)); return; }
        $('pitaBtn').classList.toggle('on', x.liked); $('pitaBtn').setAttribute('aria-pressed', String(x.liked));
        $('pitaN').textContent = x.likes;
        if (x.liked) toast('🧩 ピタっと！しました');
      } catch { toast('通信できませんでした'); }
    });
    $('copyBtn').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(shareUrl); toast('リンクをコピーしました'); } catch { toast(shareUrl); }
    });
    $('delBtn')?.addEventListener('click', async () => {
      const ok = await confirmBox(p.mine ? 'この記事を削除します。元に戻せません。よろしいですか？' : 'この記事を非表示にします（管理者操作）。', p.mine ? '削除する' : '非表示にする', true);
      if (!ok) return;
      try {
        const x = await rpc('gp_post_delete', { p_token: token(), p_id: p.id });
        if (!x.ok) { toast(reasonText(x.reason)); return; }
        toast(p.mine ? '削除しました' : '非表示にしました'); go(`${BASE}blog/`);
      } catch { toast('通信できませんでした'); }
    });
    $('repBtn')?.addEventListener('click', () => reportBox('post', p.id));
    $('commentForm').addEventListener('submit', async e => {
      e.preventDefault();
      if (!(await requireLogin())) return;
      const body = $('commentText').value.trim();
      if (!body) { toast(REASONS.comment); return; }
      const btn = e.submitter || e.target.querySelector('button'); btn.disabled = true;
      try {
        const x = await rpc('gp_comment_add', { p_token: token(), p_id: p.id, p_body: body });
        if (!x.ok) { toast(reasonText(x.reason)); return; }
        renderPost(id);
      } catch { toast('通信できませんでした'); } finally { btn.disabled = false; }
    });
    $('commentList').addEventListener('click', async e => {
      const del = e.target.closest('[data-cdel]'); const rep = e.target.closest('[data-crep]');
      if (del) {
        if (!(await confirmBox('このコメントを削除しますか？', '削除する', true))) return;
        try {
          const x = await rpc('gp_comment_delete', { p_token: token(), p_cid: Number(del.dataset.cdel) });
          if (!x.ok) { toast(reasonText(x.reason)); return; }
          renderPost(id);
        } catch { toast('通信できませんでした'); }
      } else if (rep) reportBox('comment', Number(rep.dataset.crep));
    });
  }
  function commentHtml(c) {
    return `<div class="comment"><div class="comment-head">
        ${R.authorHtml(BASE, c.author)}
        <span>${esc(ago(c.created_at))}</span>
        ${c.can_delete ? `<button class="btn btn-sm btn-ghost" type="button" data-cdel="${Number(c.id)}">削除</button>`
          : (token() ? `<button class="btn btn-sm btn-ghost" type="button" data-crep="${Number(c.id)}">🚩</button>` : '')}
      </div><p class="comment-body">${esc(c.body)}</p></div>`;
  }

  // ---------- 本文エディタのツール（見出し・太字・画像・YouTube・リンク） ----------
  function bindBodyTools(form, body, changed) {
    const insert = text => {
      const s = body.selectionStart, e = body.selectionEnd, v = body.value;
      const before = v.slice(0, s), needNl = before && !before.endsWith('\n');
      // 見出し・埋め込みは行の頭に置く必要があるので、途中なら改行を足す
      const ins = (needNl && /^(##|https|画像)/.test(text) ? '\n' : '') + text;
      body.value = before + ins + v.slice(e); body.focus();
      body.selectionStart = body.selectionEnd = s + ins.length; changed();
    };
    form.querySelectorAll('[data-ins]').forEach(b => b.addEventListener('click', () => insert(b.dataset.ins)));
    form.querySelectorAll('[data-ask]').forEach(b => b.addEventListener('click', () => {
      const kind = b.dataset.ask;
      const label = { img: '画像の URL', yt: 'YouTube 動画の URL', link: 'リンクする URL' }[kind];
      openModal(`<h2>${esc(label)}を入れる</h2><input type="url" id="askUrl" maxlength="500" placeholder="https://…">
        <p class="err" id="askErr"></p><div class="form-actions"><button class="btn btn-ghost" type="button" data-close>やめる</button>
        <button class="btn btn-primary" type="button" id="askOk">入れる</button></div>`);
      $('askUrl').focus();
      const ok = () => {
        const u = safeUrl($('askUrl').value.trim());
        if (!u) { $('askErr').textContent = REASONS.url; return; }
        if (kind === 'yt' && !youtubeId(u)) { $('askErr').textContent = 'YouTube の動画 URL ではないようです。'; return; }
        closeModal();
        insert(`${kind === 'img' && !isImageUrl(u) ? '画像: ' : ''}${u}\n`);
      };
      $('askOk').onclick = ok;
      $('askUrl').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ok(); } });
    }));
  }
  const BODY_TOOLS = `<div class="editor-tools">
      <button class="btn btn-sm" type="button" data-ins="## ">見出し</button>
      <button class="btn btn-sm" type="button" data-ins="**太字**">太字</button>
      <button class="btn btn-sm" type="button" data-ask="img">🖼️ 画像</button>
      <button class="btn btn-sm" type="button" data-ask="yt">▶️ YouTube</button>
      <button class="btn btn-sm" type="button" data-ask="link">🔗 リンク</button>
    </div>`;

  // ---------- 記事を書く・直す ----------
  const DRAFT_KEY = 'gp_draft';
  async function renderEditor(editId) {
    setMeta({ title: editId ? '記事を編集' : '記事を書く', noindex: true, path: editId ? `${postUrl(BASE, editId)}edit/` : `${BASE}new/` });
    if (!token()) {
      app.innerHTML = `<div class="empty">記事を書くには、かるわかGAMESアカウントでログインしてください。<br>
        <button class="btn btn-primary" type="button" id="loginGo" style="margin-top:12px">ログイン / 新規登録</button></div>`;
      $('loginGo').onclick = async () => { if (await requireLogin()) route(); };
      return;
    }
    let data = { title: '', game: '', genre: '', tags: [], platforms: [], players: '', length: '', difficulty: '', price: '', rating: 0, body: '', cover_url: '', official_url: '' };
    if (editId) {
      app.innerHTML = '<div class="loading">読み込み中…</div>';
      try {
        const r = await rpc('gp_get', { p_token: token(), p_id: editId });
        if (!r.ok || !r.post.mine) { app.innerHTML = `<div class="empty">${esc(r.ok ? REASONS.forbidden : reasonText(r.reason))}</div>`; return; }
        data = { ...data, ...r.post, cover_url: r.post.cover_url || '', official_url: r.post.official_url || '' };
      } catch { app.innerHTML = '<div class="empty">読み込めませんでした。</div>'; return; }
    } else {
      try { const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); if (d && typeof d === 'object') data = { ...data, ...d }; } catch { /* 下書きが壊れていたら無視 */ }
    }
    const radio = (name, map, val) => Object.entries(map).map(([k, v]) =>
      `<label class="opt"><input type="radio" name="${name}" value="${k}" ${val === k ? 'checked' : ''}><span>${esc(v)}</span></label>`).join('');
    app.innerHTML = `
      <form class="form" id="postForm" novalidate>
        <h1>${editId ? '✏️ 記事を編集' : '✏️ 好きなゲームを紹介する'}</h1>
        <div class="row2">
          <div class="field"><label for="fGame">ゲーム名 <span class="hint">必須・60文字まで</span></label>
            <input type="text" id="fGame" maxlength="60" value="${esc(data.game)}" placeholder="例: マインクラフト" list="gameList" autocomplete="off">
            <datalist id="gameList"></datalist>
            <span class="small">同じゲームの記事は自動でまとめられます。候補が出たら選んでね。</span></div>
          <div class="field"><label for="fTitle">記事のタイトル <span class="hint">必須・60文字まで</span></label>
            <input type="text" id="fTitle" maxlength="60" value="${esc(data.title)}" placeholder="例: 建築好きにはたまらない自由さ！"></div>
        </div>
        <div class="field"><span class="label">ジャンル <span class="hint">必須</span></span>
          <div class="opts">${GENRES.map(g => `<label class="opt"><input type="radio" name="genre" value="${esc(g)}" ${data.genre === g ? 'checked' : ''}><span>${GENRE_EMOJI[g]} ${esc(g)}</span></label>`).join('')}</div></div>
        <div class="field"><span class="label">遊べる機種 <span class="hint">1つ以上</span></span>
          <div class="opts">${PLATFORMS.map(pf => `<label class="opt"><input type="checkbox" name="platforms" value="${esc(pf)}" ${(data.platforms || []).includes(pf) ? 'checked' : ''}><span>${esc(pf)}</span></label>`).join('')}</div></div>
        <div class="row2">
          <div class="field"><span class="label">遊び方</span><div class="opts">${radio('players', PLAYERS, data.players)}</div></div>
          <div class="field"><span class="label">1回の時間</span><div class="opts">${radio('length', LENGTHS, data.length)}</div></div>
          <div class="field"><span class="label">難しさ</span><div class="opts">${radio('difficulty', DIFFS, data.difficulty)}</div></div>
          <div class="field"><span class="label">値段</span><div class="opts">${radio('price', PRICES, data.price)}</div></div>
        </div>
        <div class="field"><span class="label">おすすめ度</span>
          <div class="star-input" id="starInput">${[1, 2, 3, 4, 5].map(n => `<button type="button" data-n="${n}" aria-label="${n}つ星" class="${n <= data.rating ? 'on' : ''}">★</button>`).join('')}</div></div>
        <div class="row2">
          <div class="field"><label for="fCover">カバー画像の URL <span class="hint">任意・https のみ</span></label>
            <input type="url" id="fCover" maxlength="500" value="${esc(data.cover_url)}" placeholder="https://…/image.png">
            <div class="cover-preview" id="coverPrev"></div></div>
          <div class="field"><label for="fOfficial">公式サイト・ストアの URL <span class="hint">任意・https のみ</span></label>
            <input type="url" id="fOfficial" maxlength="500" value="${esc(data.official_url)}" placeholder="https://…"></div>
        </div>
        <div class="field"><label for="fTags">タグ <span class="hint">スペースか , で区切る・5個まで</span></label>
          <input type="text" id="fTags" maxlength="120" value="${esc((data.tags || []).join(' '))}" placeholder="例: 建築 協力プレイ 癒やし"></div>
        <div class="field"><label for="fBody">本文 <span class="hint">必須・8000文字まで</span></label>
          <div class="editor-tools">
            <button class="btn btn-sm" type="button" data-ins="## ">見出し</button>
            <button class="btn btn-sm" type="button" data-ins="**太字**">太字</button>
            <button class="btn btn-sm" type="button" data-ask="img">🖼️ 画像</button>
            <button class="btn btn-sm" type="button" data-ask="yt">▶️ YouTube</button>
            <button class="btn btn-sm" type="button" data-ask="link">🔗 リンク</button>
          </div>
          <div class="editor">
            <div><textarea id="fBody" maxlength="8000" placeholder="このゲームの好きなところ、どんな人におすすめか、などを自由に書こう！&#10;&#10;URL だけの行は自動で埋め込まれます（画像・YouTube・リンク）。">${esc(data.body)}</textarea>
              <div class="count" id="bodyCount"></div></div>
            <div><div class="preview-label">プレビュー</div><div class="preview body" id="preview"></div></div>
          </div>
        </div>
        <p class="err" id="formErr" role="alert"></p>
        <div class="form-actions">
          <a class="btn btn-ghost" href="${editId ? esc(postUrl(BASE, editId)) : BASE}">やめる</a>
          <button class="btn btn-primary" type="submit" id="saveBtn">${editId ? '更新する' : '投稿する'}</button>
        </div>
        <p class="small">投稿すると、<a href="${BASE}terms/" target="_blank" rel="noopener">利用規約</a>と<a href="${BASE}rules/" target="_blank" rel="noopener">投稿のルール</a>に同意したことになります。</p>
      </form>`;

    // ゲーム名の候補（すでに記事があるゲーム）
    let sugT = 0;
    $('fGame').addEventListener('input', () => {
      clearTimeout(sugT);
      sugT = setTimeout(async () => {
        const q = $('fGame').value.trim(); if (!q) return;
        try {
          const names = await rpc('gp_game_suggest', { p_q: q });
          const dl = $('gameList'); if (dl) dl.innerHTML = names.map(n => `<option value="${esc(n)}"></option>`).join('');
        } catch { /* 候補が出なくても入力はできる */ }
      }, 250);
    });
    let rating = data.rating || 0;
    const starBtns = [...$('starInput').querySelectorAll('button')];
    starBtns.forEach(b => b.addEventListener('click', () => { rating = +b.dataset.n; starBtns.forEach(x => x.classList.toggle('on', +x.dataset.n <= rating)); saveDraft(); }));
    const body = $('fBody');
    const upd = () => { $('preview').innerHTML = renderBody(body.value) || '<p class="small">ここに表示されます</p>'; $('bodyCount').textContent = `${body.value.length} / 8000`; };
    let t = 0; body.addEventListener('input', () => { clearTimeout(t); t = setTimeout(upd, 150); }); upd();
    const updCover = () => {
      const u = safeUrl($('fCover').value.trim());
      $('coverPrev').innerHTML = u ? `<img src="${esc(u)}" alt="カバー画像のプレビュー" referrerpolicy="no-referrer">` : '';
    };
    $('fCover').addEventListener('change', updCover); updCover();

    bindBodyTools($('postForm'), body, () => { upd(); saveDraft(); });

    const collect = () => ({
      title: $('fTitle').value.trim(), game: $('fGame').value.trim(),
      genre: ($('postForm').querySelector('input[name=genre]:checked') || {}).value || '',
      platforms: [...$('postForm').querySelectorAll('input[name=platforms]:checked')].map(x => x.value),
      players: ($('postForm').querySelector('input[name=players]:checked') || {}).value || '',
      length: ($('postForm').querySelector('input[name=length]:checked') || {}).value || '',
      difficulty: ($('postForm').querySelector('input[name=difficulty]:checked') || {}).value || '',
      price: ($('postForm').querySelector('input[name=price]:checked') || {}).value || '',
      rating, body: body.value, cover_url: $('fCover').value.trim(), official_url: $('fOfficial').value.trim(),
      tags: $('fTags').value.split(/[\s,、，]+/).map(x => x.replace(/^[#＃]+/, '').trim()).filter(Boolean),
    });
    // 新規のときだけ、この端末に下書きを残す
    const saveDraft = () => { if (!editId) { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(collect())); } catch { /* 容量不足は無視 */ } } };
    $('postForm').addEventListener('input', saveDraft);
    $('postForm').addEventListener('change', saveDraft);

    $('postForm').addEventListener('submit', async e => {
      e.preventDefault();
      const d = collect(); const err = $('formErr'); err.textContent = '';
      // 送る前にブラウザでも確かめる（最終チェックはサーバー）
      const check = !d.game ? 'game' : !d.title ? 'title' : !d.genre ? 'genre' : !d.platforms.length ? 'platforms'
        : !(d.players && d.length && d.difficulty && d.price) ? 'attrs' : !d.rating ? 'rating' : !d.body.trim() ? 'body'
        : (d.cover_url && !safeUrl(d.cover_url)) || (d.official_url && !safeUrl(d.official_url)) ? 'url'
        : d.tags.length > 5 || d.tags.some(x => x.length > 20) ? 'tags' : null;
      if (check) { err.textContent = REASONS[check]; return; }
      $('saveBtn').disabled = true;
      try {
        const r = await rpc('gp_post_save', { p_token: token(), p_id: editId || null, p_data: d });
        if (!r.ok) { err.textContent = reasonText(r.reason); return; }
        if (!editId) localStorage.removeItem(DRAFT_KEY);
        toast(editId ? '更新しました' : '投稿しました！');
        go(postUrl(BASE, r.id));
      } catch { err.textContent = '送れませんでした。通信を確かめてください（下書きはこの端末に残っています）。'; }
      finally { const b = $('saveBtn'); if (b) b.disabled = false; }
    });
  }

  // ---------- ピタっと診断 ----------
  const QUESTIONS = [
    { key: 'genres', multi: true, title: 'どんなジャンルが好き？（いくつでも）',
      opts: GENRES.map(g => ({ v: g, e: GENRE_EMOJI[g], t: g })) },
    { key: 'players', title: 'だれと遊びたい？',
      opts: [{ v: 'solo', e: '🙋', t: 'ひとりでじっくり' }, { v: 'multi', e: '👫', t: '友だち・みんなと' }, { v: 'any', e: '🤷', t: 'どっちでも' }] },
    { key: 'length', title: '1回にどれくらい遊ぶ？',
      opts: [{ v: 'short', e: '⏱️', t: 'すきま時間にサクッと' }, { v: 'long', e: '🌙', t: '時間を忘れてじっくり' }, { v: 'any', e: '🤷', t: 'どっちでも' }] },
    { key: 'difficulty', title: '難しさはどれくらいがいい？',
      opts: [{ v: 'easy', e: '🌱', t: 'やさしいのがいい' }, { v: 'normal', e: '🙂', t: 'ふつう' }, { v: 'hard', e: '🔥', t: '歯ごたえがほしい' }, { v: 'any', e: '🤷', t: 'こだわらない' }] },
    { key: 'platforms', multi: true, title: '持っている・遊べる機種は？（いくつでも）',
      opts: PLATFORMS.map(p => ({ v: p, e: { PC: '💻', Switch: '🎮', PlayStation: '🕹️', Xbox: '❎', 'スマホ': '📱', 'ブラウザ': '🌐', 'その他': '📦' }[p], t: p })) },
    { key: 'price', title: 'お金は？',
      opts: [{ v: 'free', e: '🆓', t: '無料で遊びたい' }, { v: 'any', e: '💰', t: '気にしない' }] },
  ];
  function renderShindan() {
    setMeta({ title: 'ピタっと診断（自分に合うゲームがわかる）', desc: '6つの質問に答えるだけで、みんなのゲーム紹介記事の中から、あなたにピタっと合うゲームを相性つきでおすすめします。', path: `${BASE}shindan/` });
    const ans = { genres: [], platforms: [] }; let step = 0;
    const draw = () => {
      const q = QUESTIONS[step];
      const sel = v => q.multi ? ans[q.key].includes(v) : ans[q.key] === v;
      app.innerHTML = `<section class="quiz">
        <h1>🧩 ピタっと診断</h1><p class="small">質問 ${step + 1} / ${QUESTIONS.length}</p>
        <div class="progress"><div style="width:${(step / QUESTIONS.length) * 100}%"></div></div>
        <div class="q-title">${esc(q.title)}</div>
        <div class="q-opts">${q.opts.map(o => `<button type="button" class="q-opt ${sel(o.v) ? 'on' : ''}" data-v="${esc(o.v)}"><span class="e">${o.e}</span>${esc(o.t)}</button>`).join('')}</div>
        <div class="q-nav">
          <button class="btn btn-ghost" type="button" id="qBack" ${step === 0 ? 'disabled' : ''}>← もどる</button>
          ${q.multi ? `<button class="btn btn-primary" type="button" id="qNext">${ans[q.key].length ? 'つぎへ →' : 'なんでもいい →'}</button>` : ''}
        </div></section>`;
      app.querySelectorAll('.q-opt').forEach(b => b.addEventListener('click', () => {
        const v = b.dataset.v;
        if (q.multi) {
          const arr = ans[q.key]; const i = arr.indexOf(v);
          if (i >= 0) arr.splice(i, 1); else arr.push(v);
          b.classList.toggle('on'); $('qNext').textContent = arr.length ? 'つぎへ →' : 'なんでもいい →';
        } else { ans[q.key] = v; next(); }
      }));
      $('qBack').addEventListener('click', () => { if (step > 0) { step--; draw(); } });
      $('qNext')?.addEventListener('click', next);
    };
    const next = () => { if (step < QUESTIONS.length - 1) { step++; draw(); } else result(); };
    const result = async () => {
      app.innerHTML = '<div class="loading">🧩 ピタっと合うゲームをさがしています…</div>';
      try {
        const r = await rpc('gp_diagnose', { p_answers: ans });
        const t = typeOf(ans);
        app.innerHTML = `${typeCardHtml(t, true)}
          <div class="result-head"><h2>🎉 あなたにピタっと合いそうなゲーム</h2>
          <p class="small">みんなの紹介記事の中から、答えに近い順に並べました。</p></div>
          ${r.items.length ? `<div class="grid">${r.items.map(card).join('')}</div>`
            : '<div class="empty">ピタっと合う記事がまだ見つかりませんでした…。<br>条件をゆるめてもう一度ためすか、あなたの好きなゲームを紹介してみてください！</div>'}
          <div class="more"><button class="btn" type="button" id="again">🔁 もう一度診断する</button>
          <a class="btn btn-primary" href="${BASE}new/" style="margin-left:8px">✏️ 記事を書く</a></div>`;
        $('again').addEventListener('click', renderShindan);
        bindShare(t);
      } catch { app.innerHTML = '<div class="empty">診断できませんでした。通信を確かめてください。</div>'; }
    };
    draw();
  }

  // ---------- 診断タイプ ----------
  function typeCardHtml(t, mine) {
    const url = abs(typeUrl(BASE, t.slug));
    const text = mine ? `わたしは「${t.e}${t.name}」でした！ #GamePita診断` : `${t.e}${t.name}｜GamePita ピタっと診断`;
    return `<section class="type-card">
        <div class="tl">${mine ? 'あなたは…' : 'ピタっと診断のタイプ'}</div>
        <div class="te">${t.e}</div>
        <h1>${esc(t.name)}</h1>
        <p>${esc(t.desc)}</p>
      </section>
      <div class="share">
        <a class="btn btn-sm" target="_blank" rel="noopener noreferrer" href="https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}">𝕏 結果をポスト</a>
        <a class="btn btn-sm" target="_blank" rel="noopener noreferrer" href="https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(url)}">💬 LINEで送る</a>
        <button class="btn btn-sm hidden" type="button" id="shareBtn">📤 シェア</button>
        <a class="btn btn-sm" href="${BASE}ogp/type-${t.slug}.png" download="gamepita-${t.slug}.png">🖼️ 画像を保存</a>
        <button class="btn btn-sm" type="button" id="copyType">🔗 リンクをコピー</button>
      </div>`;
  }
  function bindShare(t) {
    const url = abs(typeUrl(BASE, t.slug));
    const sb = $('shareBtn');
    if (sb && navigator.share) {
      sb.classList.remove('hidden');
      sb.addEventListener('click', () => navigator.share({ title: `${t.e}${t.name}｜GamePita`, text: `わたしは「${t.e}${t.name}」でした！`, url }).catch(() => {}));
    }
    $('copyType')?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(url); toast('リンクをコピーしました'); } catch { toast(url); }
    });
  }
  async function renderType(slug) {
    const t = TYPES.find(x => x.slug === slug);
    if (!t) { renderNotFound(); return; }
    setMeta({ title: `${t.name}｜ピタっと診断`, desc: `${t.e}${t.name}：${t.desc}`, path: typeUrl(BASE, t.slug) });
    app.innerHTML = `${typeCardHtml(t, false)}
      <div class="more"><a class="btn btn-primary" href="${BASE}shindan/">🧩 自分も診断してみる</a></div>
      <h2 class="section-title">🎮 ${esc(t.name)}におすすめのゲーム</h2>
      <div class="grid" id="typeList"><div class="loading">読み込み中…</div></div>
      <h2 class="section-title">ほかのタイプ</h2>
      <div class="type-list">${TYPES.filter(x => x.slug !== t.slug).map(x => `<a class="chip" href="${esc(typeUrl(BASE, x.slug))}">${x.e} ${esc(x.name)}</a>`).join('')}</div>`;
    bindShare(t);
    try {
      const r = await rpc('gp_diagnose', { p_answers: { ...t.ans, genres: [], platforms: [], price: 'any' } });
      const el = $('typeList'); if (!el) return;
      el.innerHTML = r.items.length ? r.items.map(card).join('') : '<div class="empty" style="grid-column:1/-1">まだおすすめできる記事がありません。</div>';
    } catch { const el = $('typeList'); if (el) el.innerHTML = ''; }
  }
  function renderTypeList() {
    setMeta({ title: 'ピタっと診断のタイプ一覧', desc: 'ピタっと診断でわかる8つのゲーマータイプの一覧です。あなたはどのタイプ？', path: `${BASE}shindan/type/` });
    app.innerHTML = `<h1 class="page-title">🧩 ピタっと診断のタイプ一覧</h1>
      <p class="small">遊び方（ひとり／みんな）× 時間（すきま／じっくり）× 難しさ（やさしい／歯ごたえ）で8タイプに分かれます。</p>
      <div class="type-list">${TYPES.map(x => `<a class="chip" href="${esc(typeUrl(BASE, x.slug))}">${x.e} ${esc(x.name)}</a>`).join('')}</div>
      <div class="more"><a class="btn btn-primary" href="${BASE}shindan/">🧩 診断する</a></div>`;
  }

  // ---------- ゲームのまとめページ ----------
  async function renderGame(id) {
    app.innerHTML = '<div class="loading">読み込み中…</div>';
    let r;
    try { r = await rpc('gp_game', { p_token: token(), p_id: id }); } catch { app.innerHTML = '<div class="empty">読み込めませんでした。</div>'; return; }
    if (!r.ok) { setMeta({ title: 'ゲームが見つかりません', noindex: true, path: gameUrl(BASE, id) }); app.innerHTML = `<div class="empty">${esc(reasonText(r.reason))}<br><a href="${BASE}blog/">ブログ一覧へ</a></div>`; return; }
    const g = r.game;
    setMeta({ title: `${g.name}の評価・紹介記事まとめ`, desc: `${g.name}の紹介記事 ${r.count} 件・平均おすすめ度 ★${r.avg}。みんなの感想から、${g.name}が自分に合うかチェックしよう。`, path: gameUrl(BASE, g.id) });
    app.innerHTML = `<section class="game-head">
        <nav class="crumbs"><a href="${BASE}">トップ</a> › <a href="${BASE}blog/">ブログ</a> › ゲーム</nav>
        <div>${(r.genres || []).map(x => `<a class="genre-badge" href="${esc(genreUrl(BASE, x))}">${esc(x)}</a>`).join(' ')}</div>
        <h1>🎮 ${esc(g.name)}</h1>
        <div class="game-stats"><span>おすすめ度 <b>${R.stars(Math.round(Number(r.avg) || 0))} ${esc(String(r.avg))}</b></span>
          <span>紹介記事 <b>${Number(r.count)}</b> 件</span><span>機種 <b>${(r.platforms || []).map(esc).join('・')}</b></span></div>
        ${marksHtml(g.id, r.my_mark, r.marks)}
      </section>
      <h2 class="section-title">📝 ${esc(g.name)}の紹介記事</h2>
      <div class="grid">${r.posts.map(card).join('')}</div>
      <div class="more"><a class="btn btn-primary" href="${BASE}new/">✏️ このゲームの記事を書く</a></div>`;
    bindMarks(app);
  }

  // ---------- マイリスト ----------
  async function renderMylist() {
    setMeta({ title: 'マイリスト', noindex: true, path: `${BASE}mylist/` });
    if (!token()) {
      app.innerHTML = `<div class="empty">マイリストを使うには、ログインしてください。<br>
        <button class="btn btn-primary" type="button" id="loginGo" style="margin-top:12px">ログイン / 新規登録</button></div>`;
      $('loginGo').onclick = async () => { if (await requireLogin()) route(); };
      return;
    }
    app.innerHTML = '<div class="loading">読み込み中…</div>';
    let r;
    try { r = await rpc('gp_my_marks', { p_token: token() }); } catch { app.innerHTML = '<div class="empty">読み込めませんでした。</div>'; return; }
    if (!r.ok) { app.innerHTML = `<div class="empty">${esc(reasonText(r.reason))}</div>`; return; }
    const tab = new URLSearchParams(location.search).get('s');
    const cur = MARKS[tab] ? tab : '';
    const items = r.items.filter(x => !cur || x.status === cur);
    app.innerHTML = `<h1 class="page-title">📋 マイリスト</h1>
      <p class="small">記事やゲームのページで「気になる・プレイ中・遊んだ！」を押すと、ここにたまります（自分だけが見られます）。</p>
      <div class="mylist-tabs"><a class="chip ${cur ? '' : 'on'}" href="${BASE}mylist/">すべて ${r.items.length}</a>
        ${Object.entries(MARKS).map(([k, m]) => `<a class="chip ${cur === k ? 'on' : ''}" href="${BASE}mylist/?s=${k}">${m.e} ${esc(m.t)} ${r.items.filter(x => x.status === k).length}</a>`).join('')}</div>
      ${items.length ? `<div class="mini-list">${items.map(x => `<a class="mini" href="${esc(gameUrl(BASE, x.game_id))}">
          ${R.coverHtml({ genre: x.genre, cover_url: x.cover_url, game: x.name })}
          <div><b>${esc(x.name)}</b><div class="small">${MARKS[x.status].e} ${esc(MARKS[x.status].t)} ／ 記事 ${Number(x.count)} 件${x.avg ? ` ／ ★${esc(String(x.avg))}` : ''}</div></div></a>`).join('')}</div>`
        : '<div class="empty">まだ何も入っていません。気になるゲームの記事で「👀 気になる」を押してみよう！</div>'}`;
  }

  // ---------- プロフィール ----------
  async function renderProfile(username) {
    app.innerHTML = '<div class="loading">読み込み中…</div>';
    try {
      const [pr, list, goods] = await Promise.all([rpc('gp_profile', { p_username: username }),
        rpc('gp_list', { p_q: null, p_genre: null, p_tag: null, p_author: username, p_sort: 'new', p_offset: 0 }),
        rpc('gp_goods_list', { p_q: null, p_category: null, p_tag: null, p_author: username, p_sort: 'new', p_offset: 0 }).catch(() => ({ items: [] }))]);
      if (!pr.ok) { setMeta({ title: 'ユーザーが見つかりません', noindex: true, path: userUrl(BASE, username) }); app.innerHTML = '<div class="empty">ユーザーが見つかりませんでした。</div>'; return; }
      const a = pr.author;
      const name = a.display_name || a.username;
      setMeta({ title: `${name} さんのゲーム紹介記事`, desc: `${name} さんが GamePita に書いたゲーム紹介記事の一覧です。`, path: userUrl(BASE, a.username), noindex: Number(pr.posts) === 0 });
      app.innerHTML = `<section class="profile"><div class="av">${esc(a.avatar || '😀')}</div>
        <div><h1>${esc(name)}</h1><div class="small">@${esc(a.username)} ／ 記事 ${Number(pr.posts)} 件 ／ もらったピタっと！ ${Number(pr.likes)}</div>
        ${pr.badges?.length ? `<div class="badges" style="margin-top:6px">${badgesHtml(pr.badges)}</div>` : ''}</div></section>
        <div class="grid">${list.items.length ? list.items.map(card).join('') : '<div class="empty" style="grid-column:1/-1">まだ記事がありません。</div>'}</div>
        ${list.more ? '<p class="small" style="text-align:center">最新の24件を表示しています。</p>' : ''}
        ${goods.items.length ? `<h2 class="section-title">🛍️ 紹介した商品</h2><div class="grid">${goods.items.map(gcard).join('')}</div>` : ''}`;
    } catch { app.innerHTML = '<div class="empty">読み込めませんでした。</div>'; }
  }

  // ---------- 管理 ----------
  async function renderAdmin() {
    setMeta({ title: '管理', noindex: true, path: `${BASE}admin/` });
    if (!(me?.is_admin)) { app.innerHTML = '<div class="empty">管理者だけが見られるページです。</div>'; return; }
    app.innerHTML = '<div class="loading">読み込み中…</div>';
    try {
      const r = await rpc('gp_admin_reports', { p_token: token() });
      if (!r.ok) { app.innerHTML = `<div class="empty">${esc(reasonText(r.reason))}</div>`; return; }
      let writers = [];
      try { const w = await rpc('gp_admin_writers', { p_token: token() }); if (w.ok) writers = w.writers; } catch { /* 表示だけ省く */ }
      app.innerHTML = `<h1 class="page-title">🛡️ 管理</h1>
        <section class="report-item"><h2 style="margin:0 0 8px;font-size:1.05rem">👑 公認ライター</h2>
          <div class="badges" style="margin-bottom:8px">${writers.length ? writers.map(x => `<span class="badge">${esc(x.avatar || '😀')} ${esc(x.display_name || x.username)}（@${esc(x.username)}）</span>`).join('') : '<span class="small">まだいません</span>'}</div>
          <form id="offForm" class="comment-form"><input type="text" id="offUser" maxlength="40" placeholder="ユーザー名（@のあと）">
            <button class="btn btn-sm btn-primary" type="submit" data-on="1">公認にする</button>
            <button class="btn btn-sm" type="submit" data-on="0">公認を外す</button></form></section>
        <h2 class="section-title">📮 お問い合わせ</h2>
        <div id="admInq"><div class="loading">読み込み中…</div></div>
        <h2 class="section-title">🚩 通報の一覧（${r.reports.length}）</h2>
        ${r.reports.length ? r.reports.map(x => `<div class="report-item">
          <div class="small">${esc(fmtDate(x.created_at))} ／ ${esc({ post: '記事', comment: 'コメント', goods: '商品紹介', goods_comment: '商品紹介へのコメント' }[x.target] || '')} ／ 通報者: ${esc(x.reporter?.display_name || '?')}</div>
          <div><b>${esc(x.text ?? '（消えています）')}</b></div>
          <div>理由: ${esc(x.reason)}</div>
          <div class="actions" style="margin-top:8px;padding-top:8px">
            ${x.post_id ? `<a class="btn btn-sm" href="${esc(postUrl(BASE, x.post_id))}">開く</a>` : ''}
            ${x.goods_id ? `<a class="btn btn-sm" href="${esc(goodsUrl(BASE, x.goods_id))}">開く</a>` : ''}
            <button class="btn btn-sm btn-danger" type="button" data-rm="${esc(x.target)}:${Number(x.target_id)}">${x.target === 'post' || x.target === 'goods' ? '非表示にする' : 'コメントを削除'}</button>
            <button class="btn btn-sm" type="button" data-dismiss="${Number(x.id)}">問題なし（片づける）</button>
          </div></div>`).join('') : '<div class="empty">通報はありません。</div>'}`;
      loadAdminInquiries();
      $('offForm').addEventListener('submit', async e => {
        e.preventDefault();
        const on = (e.submitter || {}).dataset?.on === '1';
        try {
          const x = await rpc('gp_admin_set_official', { p_token: token(), p_username: $('offUser').value.trim().replace(/^@/, ''), p_on: on });
          if (!x.ok) { toast(x.reason === 'not_found' ? 'そのユーザーは見つかりません' : reasonText(x.reason)); return; }
          toast(on ? '公認ライターにしました' : '公認を外しました'); renderAdmin();
        } catch { toast('通信できませんでした'); }
      });
      app.querySelectorAll('[data-dismiss]').forEach(b => b.addEventListener('click', async () => {
        try { const x = await rpc('gp_admin_dismiss', { p_token: token(), p_report_id: Number(b.dataset.dismiss) }); if (!x.ok) toast(reasonText(x.reason)); }
        catch { toast('通信できませんでした'); }
        renderAdmin();
      }));
      app.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', async () => {
        const [target, idStr] = b.dataset.rm.split(':'); const tid = Number(idStr);
        const isItem = target === 'post' || target === 'goods';
        if (!(await confirmBox(isItem ? 'この投稿を非表示にしますか？' : 'このコメントを削除しますか？', '実行する', true))) return;
        try {
          const fn = { post: 'gp_post_delete', comment: 'gp_comment_delete', goods: 'gp_goods_delete', goods_comment: 'gp_goods_comment_delete' }[target];
          if (!fn) return;
          const x = await rpc(fn, isItem ? { p_token: token(), p_id: tid } : { p_token: token(), p_cid: tid });
          if (!x.ok) toast(reasonText(x.reason));
        } catch { toast('通信できませんでした'); }
        renderAdmin();
      }));
    } catch { app.innerHTML = '<div class="empty">読み込めませんでした。</div>'; }
  }

  async function loadAdminInquiries() {
    const el = $('admInq'); if (!el) return;
    let r;
    try { r = await rpc('gp_admin_inquiries', { p_token: token() }); } catch { el.innerHTML = '<p class="small">読み込めませんでした。</p>'; return; }
    if (!r.ok) { el.innerHTML = `<p class="small">${esc(reasonText(r.reason))}</p>`; return; }
    el.innerHTML = r.items.length ? r.items.map(q => `<div class="report-item">
        <div class="small">${esc(fmtDate(q.created_at))} ／ ${esc(INQ_CATS[q.category] || '')} ／ ${esc(q.name)}
          ${q.account ? `（ログイン: @${esc(q.account.username)}）` : '（未ログイン）'} ${q.replied_at ? '✅ 返信済み' : '🆕 未返信'}</div>
        <p class="comment-body">${esc(q.body)}</p>
        <form class="comment-form" data-inq="${Number(q.id)}">
          <textarea rows="2" maxlength="2000" placeholder="返信を書く">${esc(q.reply || '')}</textarea>
          <button class="btn btn-sm btn-primary" type="submit">${q.reply ? '返信を直す' : '返信する'}</button></form></div>`).join('')
      : '<p class="small">お問い合わせはありません。</p>';
    el.querySelectorAll('form[data-inq]').forEach(f => f.addEventListener('submit', async e => {
      e.preventDefault();
      try {
        const x = await rpc('gp_admin_inquiry_reply', { p_token: token(), p_id: Number(f.dataset.inq), p_reply: f.querySelector('textarea').value.trim() });
        if (!x.ok) { toast(reasonText(x.reason)); return; }
        toast('返信しました'); loadAdminInquiries();
      } catch { toast('通信できませんでした'); }
    }));
  }

  // ---------- 商品紹介：一覧・種類別 ----------
  const goodsState = { q: '', cat: '', tag: '', sort: 'new' };
  function goodsListUrl(over = {}) {
    const s = { ...goodsState, ...over }; const qs = new URLSearchParams();
    if (s.q) qs.set('q', s.q); if (s.tag) qs.set('tag', s.tag); if (s.sort && s.sort !== 'new') qs.set('sort', s.sort);
    const str = qs.toString();
    return (s.cat ? goodsCatUrl(BASE, s.cat) : `${BASE}goods/`) + (str ? `?${str}` : '');
  }
  async function renderGoodsList(cat) {
    const qs = new URLSearchParams(location.search);
    goodsState.cat = cat || '';
    goodsState.q = (qs.get('q') || '').slice(0, 50);
    goodsState.tag = (qs.get('tag') || '').slice(0, 20);
    goodsState.sort = ['new', 'popular', 'rating'].includes(qs.get('sort')) ? qs.get('sort') : 'new';
    const c = cat ? GOODS_CATS[cat] : null;
    const filtered = goodsState.q || goodsState.tag || goodsState.sort !== 'new';
    setMeta({
      title: c ? `${c.t}のおすすめ・紹介` : (goodsState.tag ? `#${goodsState.tag} の商品紹介` : '商品紹介（ゲーム・周辺機器・グッズ）'),
      desc: c ? `みんながおすすめする${c.t}の紹介。GamePita の商品紹介の一覧です。`
        : 'ゲームソフト・ゲーム機・周辺機器・グッズ・攻略本など、みんながおすすめする商品の紹介の一覧です。',
      path: cat ? goodsCatUrl(BASE, cat) : `${BASE}goods/`, noindex: !!filtered,
    });
    app.innerHTML = `
      <h1 class="page-title">${c ? `${c.e} ${esc(c.t)}のおすすめ` : '🛍️ 商品紹介'}</h1>
      <p class="small">ゲームソフト・ゲーム機・コントローラー・グッズ・攻略本など、「買ってよかった！」をみんなで紹介するコーナーです。</p>
      <div class="more" style="margin:8px 0 14px"><a class="btn btn-primary" href="${BASE}goods/new/">🛍️ 商品を紹介する</a></div>
      <form class="toolbar" id="searchForm" role="search">
        <div class="search"><input type="search" id="q" placeholder="商品名・メーカー・キーワードでさがす" maxlength="50" value="${esc(goodsState.q)}">
          <button type="submit" aria-label="検索">🔍</button></div>
        <select id="sort" aria-label="並べ替え">
          <option value="new">新しい順</option><option value="popular">ピタっと！が多い順</option><option value="rating">おすすめ度順</option>
        </select>
      </form>
      ${R.goodsCatLinksHtml(BASE, cat || '')}
      ${goodsState.tag ? `<div class="filter-note">タグ <b>#${esc(goodsState.tag)}</b> <a class="btn btn-sm btn-ghost" href="${esc(goodsListUrl({ tag: '' }))}">✕ 解除</a></div>` : ''}
      ${goodsState.q ? `<div class="filter-note">「<b>${esc(goodsState.q)}</b>」の検索結果 <a class="btn btn-sm btn-ghost" href="${esc(goodsListUrl({ q: '' }))}">✕ 解除</a></div>` : ''}
      <div id="list" class="grid"><div class="loading">読み込み中…</div></div>
      <div class="more hidden" id="moreWrap"><button class="btn" type="button" id="moreBtn">もっと見る</button></div>`;
    $('sort').value = goodsState.sort;
    $('searchForm').addEventListener('submit', e => { e.preventDefault(); go(goodsListUrl({ q: $('q').value.trim() })); });
    $('sort').addEventListener('change', () => go(goodsListUrl({ sort: $('sort').value })));
    let offset = 0;
    const load = async () => {
      try {
        const r = await rpc('gp_goods_list', { p_q: goodsState.q || null, p_category: goodsState.cat || null, p_tag: goodsState.tag || null,
          p_author: null, p_sort: goodsState.sort, p_offset: offset });
        const list = $('list'); if (!list) return;
        if (offset === 0) list.innerHTML = '';
        if (!r.items.length && offset === 0) {
          list.innerHTML = `<div class="empty" style="grid-column:1/-1">${filtered || cat ? '条件に合う商品紹介が見つかりませんでした。' : 'まだ商品紹介がありません。'}<br>
            <a class="btn btn-primary" href="${BASE}goods/new/" style="margin-top:12px">🛍️ 商品を紹介する</a></div>`;
        }
        list.insertAdjacentHTML('beforeend', r.items.map(gcard).join(''));
        offset += r.items.length;
        $('moreWrap').classList.toggle('hidden', !r.more);
      } catch {
        const list = $('list'); if (list) list.innerHTML = '<div class="empty" style="grid-column:1/-1">読み込めませんでした。通信を確かめて、もう一度開いてください。</div>';
      }
    };
    $('moreBtn').addEventListener('click', async e => { e.target.disabled = true; await load(); e.target.disabled = false; });
    load();
  }

  // ---------- 商品紹介：1件 ----------
  async function renderGoods(id) {
    if (!app.querySelector('.article')) app.innerHTML = '<div class="loading">読み込み中…</div>';
    let r;
    try { r = await rpc('gp_goods_get', { p_token: token(), p_id: id }); } catch { if (!app.querySelector('.article')) app.innerHTML = '<div class="empty">読み込めませんでした。</div>'; return; }
    if (!r.ok) {
      setMeta({ title: '商品紹介が見つかりません', noindex: true, path: goodsUrl(BASE, id) });
      app.innerHTML = `<div class="empty">${esc(reasonText(r.reason))}<br><a href="${BASE}goods/">商品紹介の一覧へ</a></div>`; return;
    }
    const g = r.item;
    setMeta({ title: `${g.title}（${g.name}）`, desc: plainText(g.body, 110) || DEFAULT_DESC, path: goodsUrl(BASE, g.id), noindex: g.status !== 'public' });
    const shareUrl = abs(goodsUrl(BASE, g.id));
    app.innerHTML = `
      <article class="article">
        ${R.goodsCoverHtml(g)}
        <div class="article-in">
          ${g.status === 'removed' ? '<div class="removed-note">この商品紹介は管理者により非表示になっています（管理者だけに見えています）。</div>' : ''}
          ${R.goodsInner(g, BASE)}
          <div class="actions">
            <button class="btn pita ${g.liked ? 'on' : ''}" type="button" id="pitaBtn" aria-pressed="${g.liked ? 'true' : 'false'}">🧩 ピタっと！ <b id="pitaN">${Number(g.likes) || 0}</b></button>
            <button class="btn btn-sm" type="button" id="copyBtn">🔗 リンクをコピー</button>
            <a class="btn btn-sm" target="_blank" rel="noopener noreferrer" href="https://twitter.com/intent/tweet?text=${encodeURIComponent(`${g.title}｜GamePita`)}&url=${encodeURIComponent(shareUrl)}">𝕏 ポスト</a>
            <span style="flex:1"></span>
            ${g.mine ? `<a class="btn btn-sm" href="${esc(goodsUrl(BASE, g.id))}edit/">✏️ 編集</a>` : ''}
            ${g.mine || (r.is_admin && g.status === 'public') ? `<button class="btn btn-sm btn-danger" type="button" id="delBtn">🗑️ ${g.mine ? '削除' : '非表示（管理）'}</button>` : ''}
            ${!g.mine ? '<button class="btn btn-sm btn-ghost" type="button" id="repBtn">🚩 通報</button>' : ''}
          </div>
        </div>
      </article>
      <section class="comments">
        <h2>💬 コメント（${r.comments.length}）</h2>
        <div id="commentList">${r.comments.length ? r.comments.map(commentHtml).join('') : '<p class="small">まだコメントはありません。</p>'}</div>
        <form class="comment-form" id="commentForm">
          <textarea id="commentText" rows="2" maxlength="500" placeholder="${token() ? 'コメントを書く（500文字まで）' : 'ログインするとコメントできます'}"></textarea>
          <button class="btn btn-primary" type="submit">送信</button>
        </form>
      </section>
      <p style="text-align:center;margin-top:18px"><a href="${BASE}goods/">← 商品紹介の一覧へ</a></p>`;

    $('pitaBtn').addEventListener('click', async () => {
      if (!(await requireLogin())) return;
      try {
        const x = await rpc('gp_goods_like', { p_token: token(), p_id: g.id });
        if (!x.ok) { toast(reasonText(x.reason)); return; }
        $('pitaBtn').classList.toggle('on', x.liked); $('pitaBtn').setAttribute('aria-pressed', String(x.liked));
        $('pitaN').textContent = x.likes;
        if (x.liked) toast('🧩 ピタっと！しました');
      } catch { toast('通信できませんでした'); }
    });
    $('copyBtn').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(shareUrl); toast('リンクをコピーしました'); } catch { toast(shareUrl); }
    });
    $('delBtn')?.addEventListener('click', async () => {
      const ok = await confirmBox(g.mine ? 'この商品紹介を削除します。元に戻せません。よろしいですか？' : 'この商品紹介を非表示にします（管理者操作）。', g.mine ? '削除する' : '非表示にする', true);
      if (!ok) return;
      try {
        const x = await rpc('gp_goods_delete', { p_token: token(), p_id: g.id });
        if (!x.ok) { toast(reasonText(x.reason)); return; }
        toast(g.mine ? '削除しました' : '非表示にしました'); go(`${BASE}goods/`);
      } catch { toast('通信できませんでした'); }
    });
    $('repBtn')?.addEventListener('click', () => reportBox('goods', g.id));
    $('commentForm').addEventListener('submit', async e => {
      e.preventDefault();
      if (!(await requireLogin())) return;
      const body = $('commentText').value.trim();
      if (!body) { toast(REASONS.comment); return; }
      const btn = e.submitter || e.target.querySelector('button'); btn.disabled = true;
      try {
        const x = await rpc('gp_goods_comment_add', { p_token: token(), p_id: g.id, p_body: body });
        if (!x.ok) { toast(reasonText(x.reason)); return; }
        renderGoods(id);
      } catch { toast('通信できませんでした'); } finally { btn.disabled = false; }
    });
    $('commentList').addEventListener('click', async e => {
      const del = e.target.closest('[data-cdel]'); const rep = e.target.closest('[data-crep]');
      if (del) {
        if (!(await confirmBox('このコメントを削除しますか？', '削除する', true))) return;
        try {
          const x = await rpc('gp_goods_comment_delete', { p_token: token(), p_cid: Number(del.dataset.cdel) });
          if (!x.ok) { toast(reasonText(x.reason)); return; }
          renderGoods(id);
        } catch { toast('通信できませんでした'); }
      } else if (rep) reportBox('goods_comment', Number(rep.dataset.crep));
    });
  }

  // ---------- 商品紹介：書く・直す ----------
  const GOODS_DRAFT_KEY = 'gp_goods_draft';
  async function renderGoodsEditor(editId) {
    setMeta({ title: editId ? '商品紹介を編集' : '商品を紹介する', noindex: true, path: editId ? `${goodsUrl(BASE, editId)}edit/` : `${BASE}goods/new/` });
    if (!token()) {
      app.innerHTML = `<div class="empty">商品を紹介するには、かるわかGAMESアカウントでログインしてください。<br>
        <button class="btn btn-primary" type="button" id="loginGo" style="margin-top:12px">ログイン / 新規登録</button></div>`;
      $('loginGo').onclick = async () => { if (await requireLogin()) route(); };
      return;
    }
    let data = { title: '', name: '', category: '', maker: '', price: null, rating: 0, body: '', image_url: '', shop_url: '', tags: [], pr: false };
    if (editId) {
      app.innerHTML = '<div class="loading">読み込み中…</div>';
      try {
        const r = await rpc('gp_goods_get', { p_token: token(), p_id: editId });
        if (!r.ok || !r.item.mine) { app.innerHTML = `<div class="empty">${esc(r.ok ? REASONS.forbidden : reasonText(r.reason))}</div>`; return; }
        data = { ...data, ...r.item, maker: r.item.maker || '', image_url: r.item.image_url || '', shop_url: r.item.shop_url || '' };
      } catch { app.innerHTML = '<div class="empty">読み込めませんでした。</div>'; return; }
    } else {
      try { const d = JSON.parse(localStorage.getItem(GOODS_DRAFT_KEY) || 'null'); if (d && typeof d === 'object') data = { ...data, ...d }; } catch { /* 下書きが壊れていたら無視 */ }
    }
    app.innerHTML = `
      <form class="form" id="goodsForm" novalidate>
        <h1>${editId ? '✏️ 商品紹介を編集' : '🛍️ おすすめの商品を紹介する'}</h1>
        <p class="small">ゲームソフト・ゲーム機・コントローラー・ヘッドホン・グッズ・攻略本など、実際に使ってよかったものを紹介しよう。</p>
        <div class="row2">
          <div class="field"><label for="gName">商品名 <span class="hint">必須・80文字まで</span></label>
            <input type="text" id="gName" maxlength="80" value="${esc(data.name)}" placeholder="例: Nintendo Switch Proコントローラー"></div>
          <div class="field"><label for="gTitle">紹介のタイトル <span class="hint">必須・60文字まで</span></label>
            <input type="text" id="gTitle" maxlength="60" value="${esc(data.title)}" placeholder="例: 長時間遊んでも手が疲れにくい！"></div>
        </div>
        <div class="field"><span class="label">種類 <span class="hint">必須</span></span>
          <div class="opts">${Object.entries(GOODS_CATS).map(([k, c]) => `<label class="opt"><input type="radio" name="category" value="${k}" ${data.category === k ? 'checked' : ''}><span>${c.e} ${esc(c.t)}</span></label>`).join('')}</div></div>
        <div class="row2">
          <div class="field"><label for="gMaker">メーカー <span class="hint">任意・40文字まで</span></label>
            <input type="text" id="gMaker" maxlength="40" value="${esc(data.maker)}" placeholder="例: 任天堂"></div>
          <div class="field"><label for="gPrice">参考価格（円） <span class="hint">任意・数字だけ</span></label>
            <input type="text" id="gPrice" inputmode="numeric" maxlength="9" value="${data.price != null ? esc(String(data.price)) : ''}" placeholder="例: 7678"></div>
        </div>
        <div class="field"><span class="label">おすすめ度</span>
          <div class="star-input" id="starInput">${[1, 2, 3, 4, 5].map(n => `<button type="button" data-n="${n}" aria-label="${n}つ星" class="${n <= data.rating ? 'on' : ''}">★</button>`).join('')}</div></div>
        <div class="row2">
          <div class="field"><label for="gImage">商品の画像の URL <span class="hint">任意・https のみ</span></label>
            <input type="url" id="gImage" maxlength="500" value="${esc(data.image_url)}" placeholder="https://…/image.jpg">
            <span class="small">メーカーの公式サイトの画像や、自分で撮った写真の URL を使ってね。</span>
            <div class="cover-preview" id="imgPrev"></div></div>
          <div class="field"><label for="gShop">販売ページ・公式ページの URL <span class="hint">任意・https のみ</span></label>
            <input type="url" id="gShop" maxlength="500" value="${esc(data.shop_url)}" placeholder="https://…"></div>
        </div>
        <div class="field"><label for="gTags">タグ <span class="hint">スペースか , で区切る・5個まで</span></label>
          <input type="text" id="gTags" maxlength="120" value="${esc((data.tags || []).join(' '))}" placeholder="例: コントローラー Switch 快適"></div>
        <div class="field"><label for="gBody">本文 <span class="hint">必須・8000文字まで</span></label>
          ${BODY_TOOLS}
          <div class="editor">
            <div><textarea id="gBody" maxlength="8000" placeholder="どこがよかったか、どんな人におすすめか、気になったところなどを書こう！&#10;&#10;URL だけの行は自動で埋め込まれます（画像・YouTube・リンク）。">${esc(data.body)}</textarea>
              <div class="count" id="bodyCount"></div></div>
            <div><div class="preview-label">プレビュー</div><div class="preview body" id="preview"></div></div>
          </div>
        </div>
        <div class="field"><label class="opt pr-opt"><input type="checkbox" id="gPr" ${data.pr ? 'checked' : ''}>
          <span>📢 メーカーなどから、この商品やお金をもらったり、紹介を頼まれたりして書いた（「PR」と表示されます）</span></label></div>
        <p class="err" id="formErr" role="alert"></p>
        <div class="form-actions">
          <a class="btn btn-ghost" href="${editId ? esc(goodsUrl(BASE, editId)) : `${BASE}goods/`}">やめる</a>
          <button class="btn btn-primary" type="submit" id="saveBtn">${editId ? '更新する' : '投稿する'}</button>
        </div>
        <p class="small">GamePita では売り買い・交換はできません。投稿すると、<a href="${BASE}terms/" target="_blank" rel="noopener">利用規約</a>と<a href="${BASE}rules/" target="_blank" rel="noopener">投稿のルール</a>に同意したことになります。</p>
      </form>`;

    let rating = data.rating || 0;
    const starBtns = [...$('starInput').querySelectorAll('button')];
    starBtns.forEach(b => b.addEventListener('click', () => { rating = +b.dataset.n; starBtns.forEach(x => x.classList.toggle('on', +x.dataset.n <= rating)); saveDraft(); }));
    const body = $('gBody');
    const upd = () => { $('preview').innerHTML = renderBody(body.value) || '<p class="small">ここに表示されます</p>'; $('bodyCount').textContent = `${body.value.length} / 8000`; };
    let t = 0; body.addEventListener('input', () => { clearTimeout(t); t = setTimeout(upd, 150); }); upd();
    const updImg = () => {
      const u = safeUrl($('gImage').value.trim());
      $('imgPrev').innerHTML = u ? `<img src="${esc(u)}" alt="商品の画像のプレビュー" referrerpolicy="no-referrer">` : '';
    };
    $('gImage').addEventListener('change', updImg); updImg();
    bindBodyTools($('goodsForm'), body, () => { upd(); saveDraft(); });

    // 全角数字・カンマ・「円」も受けつけて、数字にする（空なら null、変な値なら NaN）
    const parsePrice = v => {
      const x = v.normalize('NFKC').replace(/[,，円\s]/g, '');
      return x === '' ? null : (/^\d{1,8}$/.test(x) ? Number(x) : NaN);
    };
    const collect = () => ({
      title: $('gTitle').value.trim(), name: $('gName').value.trim(),
      category: ($('goodsForm').querySelector('input[name=category]:checked') || {}).value || '',
      maker: $('gMaker').value.trim(), price: parsePrice($('gPrice').value),
      rating, body: body.value, image_url: $('gImage').value.trim(), shop_url: $('gShop').value.trim(), pr: $('gPr').checked,
      tags: $('gTags').value.split(/[\s,、，]+/).map(x => x.replace(/^[#＃]+/, '').trim()).filter(Boolean),
    });
    const saveDraft = () => { if (!editId) { try { const d = collect(); if (Number.isNaN(d.price)) d.price = null; localStorage.setItem(GOODS_DRAFT_KEY, JSON.stringify(d)); } catch { /* 容量不足は無視 */ } } };
    $('goodsForm').addEventListener('input', saveDraft);
    $('goodsForm').addEventListener('change', saveDraft);

    $('goodsForm').addEventListener('submit', async e => {
      e.preventDefault();
      const d = collect(); const err = $('formErr'); err.textContent = '';
      const check = !d.name ? 'goods_name' : !d.title ? 'title' : !d.category ? 'category'
        : Number.isNaN(d.price) || (d.price != null && d.price > 10000000) ? 'price' : !d.rating ? 'rating' : !d.body.trim() ? 'body'
        : (d.image_url && !safeUrl(d.image_url)) || (d.shop_url && !safeUrl(d.shop_url)) ? 'url'
        : d.tags.length > 5 || d.tags.some(x => x.length > 20) ? 'tags' : null;
      if (check) { err.textContent = REASONS[check]; return; }
      $('saveBtn').disabled = true;
      try {
        const r = await rpc('gp_goods_save', { p_token: token(), p_id: editId || null, p_data: d });
        if (!r.ok) { err.textContent = reasonText(r.reason); return; }
        if (!editId) localStorage.removeItem(GOODS_DRAFT_KEY);
        toast(editId ? '更新しました' : '投稿しました！');
        go(goodsUrl(BASE, r.id));
      } catch { err.textContent = '送れませんでした。通信を確かめてください（下書きはこの端末に残っています）。'; }
      finally { const b = $('saveBtn'); if (b) b.disabled = false; }
    });
  }

  // ---------- ルール ----------
  function renderRules() {
    setMeta({ title: '投稿のルール・本文の書き方', desc: 'GamePita に記事やコメントを書くときのルールと、本文の書き方（見出し・太字・画像・YouTube の埋め込み）です。', path: `${BASE}rules/` });
    app.innerHTML = `<section class="rules"><h1>📜 投稿のルール</h1>
      <ol>
        <li>好きなゲームを、楽しく紹介しよう。ほかの人やゲームの悪口・けんかはやめよう。</li>
        <li>名前・住所・学校・電話番号・SNS のIDなど、<b>個人情報は書かない</b>。</li>
        <li>こわい・グロい・えっちな画像や、ほかの人がいやな気持ちになる内容は貼らない。</li>
        <li>ネタバレは記事の先頭で「ネタバレあり」と書いてから。</li>
        <li>ほかの人の文章や画像を、そのまま自分のものとして使わない。画像はゲームの公式サイトなどのものを使おう。</li>
        <li>宣伝だけの記事や、あやしいサイトへのリンクは禁止。</li>
      </ol>
      <h2>🛍️ 商品紹介のルール</h2>
      <ol>
        <li>実際に使った・持っている商品の感想を書こう。</li>
        <li>メーカーなどから商品やお金をもらったり、頼まれたりして書くときは、必ず「PR」にチェックを入れる。</li>
        <li>GamePita では<b>売り買い・交換・プレゼントの呼びかけは禁止</b>。知らない人とのやりとりはトラブルのもとです。</li>
        <li>画像は、メーカーの公式サイトの画像か、自分で撮った写真を使おう。</li>
      </ol>
      <p>ルールを守らない記事やコメントは、管理者が非表示・削除することがあります。見つけたら「🚩 通報」から教えてください。</p>
      <h2>本文の書き方</h2>
      <ul>
        <li><code>## 見出し</code> … 見出しになります</li>
        <li><code>**太字**</code> … <strong>太字</strong>になります</li>
        <li>URL だけの行 … 画像（.png .jpg など）は画像、YouTube は動画、それ以外はリンクカードとして表示</li>
        <li><code>画像: https://…</code> … 拡張子がない URL でも画像として表示</li>
        <li><code>||ネタバレ||</code> … タップするまで見えない「ネタバレ」になります</li>
        <li>見出しが3つ以上あると、記事の最初に目次が自動でつきます</li>
      </ul>
      <p class="small">安全のため、使える URL は https:// で始まるものだけです。HTML は使えません（文字としてそのまま表示されます）。</p>
      <p><a href="${BASE}">← トップへ</a></p></section>`;
  }

  // ---------- 運営者情報・プライバシーポリシー・利用規約 ----------
  function renderAbout() {
    setMeta({ title: '運営者情報・クレジット', desc: 'GamePita（ゲームピタ）の運営者情報とクレジットです。', path: `${BASE}about/` });
    app.innerHTML = R.aboutHtml(BASE);
  }
  function renderPrivacy() {
    setMeta({ title: 'プライバシーポリシー', desc: 'GamePita で集める情報と、その使い道・管理のしかたについて説明します。', path: `${BASE}privacy/` });
    app.innerHTML = R.privacyHtml(BASE);
  }
  function renderTerms() {
    setMeta({ title: '利用規約', desc: 'GamePita を使うときのルール（利用規約）です。', path: `${BASE}terms/` });
    app.innerHTML = R.termsHtml(BASE);
  }

  // ---------- お問い合わせ ----------
  const INQ_CATS = { question: '❓ 使い方の質問', bug: '🐛 不具合の報告', delete: '🗑️ 削除の依頼', report: '🚩 違反の報告', other: '💬 そのほか・ご意見' };
  // 返信を見るための、この端末だけの番号（メールアドレスの代わり）
  function inboxKey() {
    try {
      let k = localStorage.getItem('gp_inbox');
      if (!k || !/^[0-9a-f-]{36}$/.test(k)) { k = crypto.randomUUID(); localStorage.setItem('gp_inbox', k); }
      return k;
    } catch { return null; }
  }
  async function renderContact() {
    setMeta({ title: 'お問い合わせ', desc: 'GamePita へのご質問・不具合の報告・削除の依頼などは、こちらからどうぞ。', path: `${BASE}contact/` });
    const u = ka?.user();
    app.innerHTML = `<section class="rules">
      <h1>📮 お問い合わせ</h1>
      <p>ご質問・不具合の報告・削除の依頼・ご意見などは、こちらから送ってください。</p>
      <ul class="small">
        <li>メールアドレスは必要ありません。<b>返信はこのページに表示されます</b>（送ったのと同じ端末・ブラウザで開いてください）。</li>
        <li>ログインして送ると、別の端末でも返信を見られて、🔔通知でもお知らせします。</li>
        <li>個人情報（本名・住所・電話番号など）は書かないでください。</li>
        <li>個人で運営しているため、返信までお時間をいただくことがあります。</li>
      </ul>
      <form id="inqForm" class="inq-form" novalidate>
        <div class="field"><label for="inqCat">種類</label>
          <select id="inqCat">${Object.entries(INQ_CATS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></div>
        <div class="field"><label for="inqName">お名前（ニックネームでOK） <span class="hint">40文字まで</span></label>
          <input type="text" id="inqName" maxlength="40" value="${esc(u ? (u.display_name || u.username) : '')}"></div>
        <div class="field"><label for="inqBody">内容 <span class="hint">2000文字まで</span></label>
          <textarea id="inqBody" rows="7" maxlength="2000" placeholder="どの記事・どのページのことかがわかると、早く対応できます（記事の URL など）"></textarea></div>
        <p class="err" id="inqErr" role="alert"></p>
        <div class="form-actions"><button class="btn btn-primary" type="submit" id="inqSend">送信する</button></div>
      </form>
      <h2>これまでのお問い合わせ</h2>
      <div id="inqList"><div class="loading">読み込み中…</div></div>
    </section>`;
    const loadMine = async () => {
      const el = $('inqList'); if (!el) return;
      try {
        const r = await rpc('gp_inquiry_mine', { p_token: token(), p_inbox_key: inboxKey() });
        el.innerHTML = r.items.length ? r.items.map(q => `<div class="inq">
            <div class="small">${esc(fmtDate(q.created_at))} ／ ${esc(INQ_CATS[q.category] || '')}</div>
            <p class="comment-body">${esc(q.body)}</p>
            ${q.reply ? `<div class="inq-reply"><b>📮 運営者からの返信</b>（${esc(fmtDate(q.replied_at))}）<p class="comment-body">${esc(q.reply)}</p></div>`
              : '<div class="small">⏳ 返信をお待ちください</div>'}</div>`).join('')
          : '<p class="small">まだありません。</p>';
      } catch { el.innerHTML = '<p class="small">読み込めませんでした。</p>'; }
    };
    $('inqForm').addEventListener('submit', async e => {
      e.preventDefault();
      const err = $('inqErr'); err.textContent = '';
      const name = $('inqName').value.trim(), body = $('inqBody').value.trim();
      if (!name) { err.textContent = REASONS.name; return; }
      if (!body) { err.textContent = REASONS.inquiry; return; }
      const key = inboxKey();
      if (!key) { err.textContent = 'この端末では送れません（ブラウザの保存機能がオフになっています）。'; return; }
      $('inqSend').disabled = true;
      try {
        const r = await rpc('gp_inquiry_submit', { p_token: token(), p_inbox_key: key, p_category: $('inqCat').value, p_name: name, p_body: body });
        if (!r.ok) { err.textContent = reasonText(r.reason); return; }
        $('inqBody').value = '';
        toast('送信しました。ありがとうございます！');
        loadMine();
      } catch { err.textContent = '送れませんでした。通信を確かめてください。'; }
      finally { const b = $('inqSend'); if (b) b.disabled = false; }
    });
    loadMine();
  }

  function renderNotFound() {
    setMeta({ title: 'ページが見つかりません', noindex: true, path: location.pathname });
    app.innerHTML = `<div class="empty">ページが見つかりませんでした。<br><a class="btn" href="${BASE}" style="margin-top:12px">トップへ</a>
      <a class="btn" href="${BASE}blog/" style="margin-top:12px">ブログ一覧へ</a></div>`;
  }

  // ---------- ルーター ----------
  // 前の「#/p/1」形式の URL を新しい URL に置きかえる
  function legacyHash() {
    const h = location.hash; if (!h.startsWith('#/')) return null; let m;
    if ((m = h.match(/^#\/p\/(\d{1,15})$/))) return postUrl(BASE, m[1]);
    if ((m = h.match(/^#\/edit\/(\d{1,15})$/))) return `${postUrl(BASE, m[1])}edit/`;
    if ((m = h.match(/^#\/u\/([^/?]{1,64})$/))) return `${BASE}user/${m[1]}/`;
    if (h === '#/new') return `${BASE}new/`;
    if (h === '#/shindan') return `${BASE}shindan/`;
    if (h === '#/admin') return `${BASE}admin/`;
    if (h === '#/rules') return `${BASE}rules/`;
    if (h.startsWith('#/?')) return `${BASE}blog/${h.slice(2)}`;
    return BASE;
  }
  function route() {
    closeModal();
    const legacy = legacyHash();
    if (legacy) { history.replaceState(null, '', legacy); }
    let path = location.pathname;
    if (!path.startsWith(BASE)) path = BASE;
    const rel = path.slice(BASE.length).replace(/index\.html$/, '');
    let m;
    if (rel === '') renderHome();
    else if (/^blog\/?$/.test(rel)) renderList('');
    else if ((m = rel.match(/^blog\/(\d{1,15})\/?$/))) renderPost(Number(m[1]));
    else if ((m = rel.match(/^blog\/(\d{1,15})\/edit\/?$/))) renderEditor(Number(m[1]));
    else if ((m = rel.match(/^genre\/([a-z-]{2,20})\/?$/)) && SLUG_GENRE[m[1]]) renderList(SLUG_GENRE[m[1]]);
    else if (/^new\/?$/.test(rel)) renderEditor(null);
    else if (/^goods\/?$/.test(rel)) renderGoodsList('');
    else if (/^goods\/new\/?$/.test(rel)) renderGoodsEditor(null);
    else if ((m = rel.match(/^goods\/category\/([a-z]{3,8})\/?$/)) && Object.hasOwn(GOODS_CATS, m[1])) renderGoodsList(m[1]);
    else if ((m = rel.match(/^goods\/(\d{1,15})\/?$/))) renderGoods(Number(m[1]));
    else if ((m = rel.match(/^goods\/(\d{1,15})\/edit\/?$/))) renderGoodsEditor(Number(m[1]));
    else if (/^shindan\/?$/.test(rel)) renderShindan();
    else if (/^shindan\/type\/?$/.test(rel)) renderTypeList();
    else if ((m = rel.match(/^shindan\/type\/([a-z-]{5,30})\/?$/))) renderType(m[1]);
    else if ((m = rel.match(/^game\/(\d{1,15})\/?$/))) renderGame(Number(m[1]));
    else if (/^mylist\/?$/.test(rel)) renderMylist();
    else if ((m = rel.match(/^user\/([^/]{1,64})\/?$/))) { let u; try { u = decodeURIComponent(m[1]); } catch { u = ''; } renderProfile(u); }
    else if (/^admin\/?$/.test(rel)) renderAdmin();
    else if (/^rules\/?$/.test(rel)) renderRules();
    else if (/^about\/?$/.test(rel)) renderAbout();
    else if (/^privacy\/?$/.test(rel)) renderPrivacy();
    else if (/^terms\/?$/.test(rel)) renderTerms();
    else if (/^contact\/?$/.test(rel)) renderContact();
    else renderNotFound();
  }

  (async () => {
    updateHeader();
    route();
    await Promise.all([loadMe(), loadNotifs()]); updateHeader();
    if (/\/admin\/?$/.test(location.pathname)) route();
    // ログイン・ログアウトしたら読み直す（書きかけの記事がある画面はそのまま）
    ka?.onChange(async () => {
      await Promise.all([loadMe(), loadNotifs()]); updateHeader();
      if (!$('postForm') && !$('goodsForm')) route();
    });
  })();
  console.info(`GamePita v${VERSION}`);
})();
