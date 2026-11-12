// GamePita ― 自分に合うゲームをピタっと見つける
// データは共有 Supabase の gp_* RPC。ログインはかるわかGAMESアカウント（window.KaAccount）
(() => {
  'use strict';
  const VERSION = '1.0.0';
  const SUPABASE_URL = 'https://kifnzvktwbomxthzvvgy.supabase.co';
  // 公開用キー（ブラウザに置いてよいキー。テーブルは RLS で閉じていて RPC しか呼べない）
  const SUPABASE_KEY = 'sb_publishable_Ea_sHRg6wMwO9YkDTjgOog_stQT1mfq';
  const HEADERS = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };
  const ka = window.KaAccount || null;
  const $ = id => document.getElementById(id);
  const app = $('app');

  // ---------- 決まった選択肢（DB と同じ） ----------
  const GENRES = ['アクション', 'RPG', 'シューティング', 'パズル', 'アドベンチャー', 'シミュレーション', 'ストラテジー',
    'スポーツ', 'レース', '音楽・リズム', 'ホラー', 'サンドボックス', 'カード・ボード', '格闘', 'その他'];
  const GENRE_EMOJI = { 'アクション': '⚔️', 'RPG': '🗡️', 'シューティング': '🔫', 'パズル': '🧩', 'アドベンチャー': '🗺️',
    'シミュレーション': '🏙️', 'ストラテジー': '♟️', 'スポーツ': '⚽', 'レース': '🏎️', '音楽・リズム': '🎵', 'ホラー': '👻',
    'サンドボックス': '⛏️', 'カード・ボード': '🃏', '格闘': '🥊', 'その他': '🎮' };
  const PLATFORMS = ['PC', 'Switch', 'PlayStation', 'Xbox', 'スマホ', 'ブラウザ', 'その他'];
  const PLAYERS = { solo: 'ひとりで', multi: 'みんなで', both: 'どちらも' };
  const LENGTHS = { short: 'すきま時間', long: 'じっくり', both: 'どちらも' };
  const DIFFS = { easy: 'やさしい', normal: 'ふつう', hard: 'むずかしい' };
  const PRICES = { free: '無料（基本無料）', paid: '有料' };

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
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDate = iso => {
    if (!iso) return '';
    const d = new Date(iso);
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  };
  const ago = iso => {
    const s = (Date.now() - new Date(iso)) / 1000;
    if (s < 60) return 'たった今';
    if (s < 3600) return `${Math.floor(s / 60)}分前`;
    if (s < 86400) return `${Math.floor(s / 3600)}時間前`;
    if (s < 86400 * 30) return `${Math.floor(s / 86400)}日前`;
    return fmtDate(iso);
  };
  const stars = n => `<span class="stars" aria-label="おすすめ度 ${n} / 5">${'★'.repeat(n)}<span class="off">${'★'.repeat(5 - n)}</span></span>`;
  let toastTimer = 0;
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 3200);
  }
  function setTitle(t) { document.title = t ? `${t}｜GamePita` : 'GamePita（ゲームピタ）｜自分に合うゲームをピタっと見つける'; }

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

  // ---------- 本文の表示 ----------
  // 使える書き方: 「## 見出し」「**太字**」、URL だけの行は埋め込み（画像・YouTube・リンクカード）、
  // 「画像: URL」は拡張子がなくても画像として表示。文中の URL はリンクになる。HTML はすべて文字として表示する。
  const MAX_EMBEDS = 30;
  function inline(text) {
    // 文中の URL をリンクに。URL 以外は必ずエスケープしてから太字だけ変換する
    const out = []; const re = /https:\/\/[^\s<>"'`\\]+/g; let last = 0, m;
    const fmt = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
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
    const html = []; let para = []; let embeds = 0;
    const flush = () => { if (para.length) { html.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; } };
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) { flush(); continue; }
      const h = line.match(/^##\s+(.+)$/);
      if (h) { flush(); html.push(`<h2>${inline(h[1])}</h2>`); continue; }
      const img = line.match(/^(?:画像|img)\s*[:：]\s*(\S+)$/i);
      const bare = /^https:\/\/\S+$/.test(line);
      if ((img || bare) && embeds < MAX_EMBEDS) {
        const e = embedHtml(img ? img[1] : line, !!img);
        if (e) { flush(); html.push(e); embeds++; continue; }
      }
      para.push(line);
    }
    flush();
    return html.join('\n');
  }
  // 画像が読めなかったら隠す（インラインの onerror は CSP で使えないのでまとめて拾う）
  document.addEventListener('error', e => {
    const t = e.target;
    if (t && t.tagName === 'IMG') {
      if (t.closest('.cover')) { const c = t.closest('.cover'); c.textContent = c.dataset.emoji || '🎮'; }
      else t.classList.add('broken');
    }
  }, true);

  // ---------- ログイン ----------
  let me = null;
  async function loadMe() {
    if (!token()) { me = null; return; }
    try { const r = await rpc('gp_me', { p_token: token() }); me = r.ok ? r : null; } catch { /* 通信失敗時はそのまま */ }
  }
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
        <a class="btn" href="#/u/${encodeURIComponent(u.username)}" data-close>📝 自分の記事</a>
        <button class="btn" type="button" id="mAccount">⚙️ アカウント設定・ログアウト</button>
        ${me?.is_admin ? '<a class="btn" href="#/admin" data-close>🛡️ 管理（通報）</a>' : ''}
        <button class="btn btn-ghost" type="button" data-close>閉じる</button>
      </div>`);
    $('mAccount').addEventListener('click', () => { closeModal(); ka.openPanel(); });
  });

  // ---------- モーダル ----------
  function openModal(html) {
    $('modalBox').innerHTML = html; $('modal').classList.remove('hidden');
    $('modalBox').querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeModal));
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
      const reason = $('rReason').value.trim();
      try {
        const r = await rpc('gp_report', { p_token: token(), p_target: target, p_id: id, p_reason: reason });
        if (!r.ok) { toast(reasonText(r.reason)); return; }
        closeModal(); toast('通報しました。ご協力ありがとうございます。');
      } catch { toast('送れませんでした。通信を確かめてください。'); }
    };
  }

  // ---------- カード ----------
  function coverHtml(p) {
    const emoji = GENRE_EMOJI[p.genre] || '🎮';
    const url = p.cover_url ? safeUrl(p.cover_url) : null;
    return `<div class="cover" data-emoji="${esc(emoji)}">${url ? `<img src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : esc(emoji)}</div>`;
  }
  function cardHtml(p) {
    const a = p.author || {};
    return `<div class="card-wrap">${p.score != null ? `<span class="score">相性 ${Number(p.score)}%</span>` : ''}
      <a class="card" href="#/p/${Number(p.id)}">
        ${coverHtml(p)}
        <div class="card-body">
          <div><span class="genre-badge">${esc(p.genre)}</span></div>
          <div class="card-game">🎮 ${esc(p.game)}</div>
          <h3 class="card-title">${esc(p.title)}</h3>
          <p class="card-ex">${esc(stripMarks(p.excerpt))}</p>
          <div class="card-meta"><span class="who">${esc(a.avatar || '😀')} ${esc(a.display_name || a.username || '退会したユーザー')}</span>
            ${stars(Number(p.rating) || 0)} <span>🧩${Number(p.likes) || 0}</span> <span>💬${Number(p.comments) || 0}</span></div>
        </div>
      </a></div>`;
  }
  // 抜粋から書式記号と URL を取る
  const stripMarks = s => String(s || '').replace(/^##\s+/g, '').replace(/\*\*/g, '').replace(/(画像|img)\s*[:：]\s*/gi, '').replace(/https:\/\/\S+/g, '').trim();

  // ---------- トップ（一覧） ----------
  const listState = { q: '', genre: '', tag: '', sort: 'new' };
  function readListParams() {
    const qs = new URLSearchParams(location.hash.split('?')[1] || '');
    listState.q = (qs.get('q') || '').slice(0, 50);
    listState.genre = GENRES.includes(qs.get('genre')) ? qs.get('genre') : '';
    listState.tag = (qs.get('tag') || '').slice(0, 20);
    listState.sort = ['new', 'popular', 'rating'].includes(qs.get('sort')) ? qs.get('sort') : 'new';
  }
  function listHash(over = {}) {
    const s = { ...listState, ...over }; const qs = new URLSearchParams();
    if (s.q) qs.set('q', s.q); if (s.genre) qs.set('genre', s.genre); if (s.tag) qs.set('tag', s.tag);
    if (s.sort !== 'new') qs.set('sort', s.sort);
    const str = qs.toString(); return str ? `#/?${str}` : '#/';
  }
  async function renderHome() {
    readListParams(); setTitle('');
    const filtered = listState.q || listState.genre || listState.tag;
    app.innerHTML = `
      ${filtered ? '' : `<section class="hero">
        <h1>自分に合うゲームを、<br>ピタっと見つけよう。</h1>
        <p>みんなが「これ好き！」を紹介するゲーム記事サイト。質問に答えるだけで、合いそうなゲームがわかります。</p>
        <div class="hero-actions"><a class="btn" href="#/shindan">🧩 ピタっと診断をする</a><a class="btn" href="#/new">✏️ 好きなゲームを紹介する</a></div>
        <div class="hero-deco" aria-hidden="true">🎮</div></section>`}
      <form class="toolbar" id="searchForm" role="search">
        <div class="search"><input type="search" id="q" placeholder="ゲーム名・キーワードでさがす" maxlength="50" value="${esc(listState.q)}">
          <button type="submit" aria-label="検索">🔍</button></div>
        <select id="sort" aria-label="並べ替え">
          <option value="new">新しい順</option><option value="popular">ピタっと！が多い順</option><option value="rating">おすすめ度順</option>
        </select>
      </form>
      <div class="chips" id="genreChips">
        <a class="chip ${listState.genre ? '' : 'on'}" href="${esc(listHash({ genre: '' }))}">すべて</a>
        ${GENRES.map(g => `<a class="chip ${listState.genre === g ? 'on' : ''}" href="${esc(listHash({ genre: g }))}">${GENRE_EMOJI[g]} ${esc(g)}</a>`).join('')}
      </div>
      ${listState.tag ? `<div class="filter-note">タグ <b>#${esc(listState.tag)}</b> の記事 <a class="btn btn-sm btn-ghost" href="${esc(listHash({ tag: '' }))}">✕ 解除</a></div>` : ''}
      <div id="list" class="grid"><div class="loading">読み込み中…</div></div>
      <div class="more hidden" id="moreWrap"><button class="btn" type="button" id="moreBtn">もっと見る</button></div>
      <h2 class="section-title">🏷️ よく使われているタグ</h2>
      <div class="chips" id="tagCloud"><span class="small">読み込み中…</span></div>`;
    $('sort').value = listState.sort;
    $('searchForm').addEventListener('submit', e => { e.preventDefault(); location.hash = listHash({ q: $('q').value.trim() }); });
    $('sort').addEventListener('change', () => { location.hash = listHash({ sort: $('sort').value }); });

    let offset = 0;
    const load = async () => {
      try {
        const r = await rpc('gp_list', { p_q: listState.q || null, p_genre: listState.genre || null, p_tag: listState.tag || null,
          p_author: null, p_sort: listState.sort, p_offset: offset });
        const list = $('list'); if (!list) return;
        if (offset === 0) list.innerHTML = '';
        if (!r.items.length && offset === 0) {
          list.innerHTML = `<div class="empty" style="grid-column:1/-1">${filtered ? '条件に合う記事が見つかりませんでした。' : 'まだ記事がありません。'}<br>
            <a class="btn btn-primary" href="#/new" style="margin-top:12px">✏️ 最初の記事を書く</a></div>`;
        }
        list.insertAdjacentHTML('beforeend', r.items.map(cardHtml).join(''));
        offset += r.items.length;
        $('moreWrap').classList.toggle('hidden', !r.more);
      } catch {
        $('list').innerHTML = '<div class="empty" style="grid-column:1/-1">読み込めませんでした。通信を確かめて、もう一度開いてください。</div>';
      }
    };
    $('moreBtn').addEventListener('click', async e => { e.target.disabled = true; await load(); e.target.disabled = false; });
    load();
    rpc('gp_tags').then(tags => {
      const el = $('tagCloud'); if (!el) return;
      el.innerHTML = tags.length ? tags.map(t => `<a class="chip tag" href="${esc(listHash({ tag: t.tag, q: '', genre: '' }))}">#${esc(t.tag)} <span class="small">${Number(t.n)}</span></a>`).join('')
        : '<span class="small">まだタグはありません。</span>';
    }).catch(() => { const el = $('tagCloud'); if (el) el.innerHTML = ''; });
  }

  // ---------- 記事ページ ----------
  async function renderPost(id) {
    app.innerHTML = '<div class="loading">読み込み中…</div>';
    let r;
    try { r = await rpc('gp_get', { p_token: token(), p_id: id }); } catch { app.innerHTML = '<div class="empty">読み込めませんでした。</div>'; return; }
    if (!r.ok) { app.innerHTML = `<div class="empty">${esc(reasonText(r.reason))}<br><a href="#/">トップへ</a></div>`; setTitle('見つかりません'); return; }
    const p = r.post, a = p.author || {};
    setTitle(`${p.title}（${p.game}）`);
    const official = p.official_url ? safeUrl(p.official_url) : null;
    const shareUrl = location.href.split('#')[0] + `#/p/${Number(p.id)}`;
    app.innerHTML = `
      <article class="article">
        ${coverHtml(p)}
        <div class="article-in">
          ${p.status === 'removed' ? '<div class="removed-note">この記事は管理者により非表示になっています（管理者だけに見えています）。</div>' : ''}
          <div class="article-head"><span class="genre-badge">${esc(p.genre)}</span><span>🎮 <b>${esc(p.game)}</b></span></div>
          <h1>${esc(p.title)}</h1>
          <div class="article-head">
            ${a.username ? `<a class="author" href="#/u/${encodeURIComponent(a.username)}">${esc(a.avatar || '😀')} ${esc(a.display_name || a.username)}</a>` : '<span>退会したユーザー</span>'}
            <span>${fmtDate(p.created_at)}${p.updated_at && new Date(p.updated_at) - new Date(p.created_at) > 60000 ? `（${fmtDate(p.updated_at)} 更新）` : ''}</span>
          </div>
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
          ${(p.tags || []).length ? `<div class="tags">${p.tags.map(t => `<a class="chip tag" href="#/?tag=${encodeURIComponent(t)}">#${esc(t)}</a>`).join('')}</div>` : ''}
          <div class="actions">
            <button class="btn pita ${p.liked ? 'on' : ''}" type="button" id="pitaBtn" aria-pressed="${p.liked ? 'true' : 'false'}">🧩 ピタっと！ <b id="pitaN">${Number(p.likes) || 0}</b></button>
            <button class="btn btn-sm" type="button" id="copyBtn">🔗 リンクをコピー</button>
            <a class="btn btn-sm" target="_blank" rel="noopener noreferrer" href="https://twitter.com/intent/tweet?text=${encodeURIComponent(`${p.title}｜GamePita`)}&url=${encodeURIComponent(shareUrl)}">𝕏 ポスト</a>
            <span style="flex:1"></span>
            ${p.mine ? `<a class="btn btn-sm" href="#/edit/${Number(p.id)}">✏️ 編集</a>` : ''}
            ${p.mine || (r.is_admin && p.status === 'public') ? `<button class="btn btn-sm btn-danger" type="button" id="delBtn">🗑️ ${p.mine ? '削除' : '非表示（管理）'}</button>` : ''}
            ${!p.mine ? '<button class="btn btn-sm btn-ghost" type="button" id="repBtn">🚩 通報</button>' : ''}
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
      <p style="text-align:center;margin-top:18px"><a href="#/">← 記事一覧へ</a></p>`;

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
        toast(p.mine ? '削除しました' : '非表示にしました'); location.hash = '#/';
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
    const a = c.author || {};
    return `<div class="comment"><div class="comment-head">
        ${a.username ? `<a class="author" href="#/u/${encodeURIComponent(a.username)}">${esc(a.avatar || '😀')} ${esc(a.display_name || a.username)}</a>` : '<span>退会したユーザー</span>'}
        <span>${esc(ago(c.created_at))}</span>
        ${c.can_delete ? `<button class="btn btn-sm btn-ghost" type="button" data-cdel="${Number(c.id)}">削除</button>`
          : (token() ? `<button class="btn btn-sm btn-ghost" type="button" data-crep="${Number(c.id)}">🚩</button>` : '')}
      </div><p class="comment-body">${esc(c.body)}</p></div>`;
  }

  // ---------- 記事を書く・直す ----------
  const DRAFT_KEY = 'gp_draft';
  async function renderEditor(editId) {
    setTitle(editId ? '記事を編集' : '記事を書く');
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
            <input type="text" id="fGame" maxlength="60" value="${esc(data.game)}" placeholder="例: マインクラフト"></div>
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
          <a class="btn btn-ghost" href="${editId ? `#/p/${Number(editId)}` : '#/'}">やめる</a>
          <button class="btn btn-primary" type="submit" id="saveBtn">${editId ? '更新する' : '投稿する'}</button>
        </div>
        <p class="small">投稿すると、<a href="#/rules" target="_blank">投稿のルール</a>に同意したことになります。</p>
      </form>`;

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

    // 本文に文字を差し込む
    const insert = text => {
      const s = body.selectionStart, e = body.selectionEnd, v = body.value;
      const before = v.slice(0, s), needNl = before && !before.endsWith('\n');
      // 見出し・埋め込みは行の頭に置く必要があるので、途中なら改行を足す
      const ins = (needNl && /^(##|https|画像)/.test(text) ? '\n' : '') + text;
      body.value = before + ins + v.slice(e); body.focus();
      body.selectionStart = body.selectionEnd = s + ins.length; upd(); saveDraft();
    };
    $('postForm').querySelectorAll('[data-ins]').forEach(b => b.addEventListener('click', () => insert(b.dataset.ins)));
    $('postForm').querySelectorAll('[data-ask]').forEach(b => b.addEventListener('click', () => {
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
        location.hash = `#/p/${Number(r.id)}`;
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
    setTitle('ピタっと診断');
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
        app.innerHTML = `<div class="result-head"><h1>🎉 あなたにピタっと合いそうなゲーム</h1>
          <p class="small">みんなの紹介記事の中から、答えに近い順に並べました。</p></div>
          ${r.items.length ? `<div class="grid">${r.items.map(cardHtml).join('')}</div>`
            : `<div class="empty">ピタっと合う記事がまだ見つかりませんでした…。<br>条件をゆるめてもう一度ためすか、あなたの好きなゲームを紹介してみてください！</div>`}
          <div class="more"><button class="btn" type="button" id="again">🔁 もう一度診断する</button>
          <a class="btn btn-primary" href="#/new" style="margin-left:8px">✏️ 記事を書く</a></div>`;
        $('again').addEventListener('click', renderShindan);
      } catch { app.innerHTML = '<div class="empty">診断できませんでした。通信を確かめてください。</div>'; }
    };
    draw();
  }

  // ---------- プロフィール ----------
  async function renderProfile(username) {
    app.innerHTML = '<div class="loading">読み込み中…</div>';
    try {
      const [pr, list] = await Promise.all([rpc('gp_profile', { p_username: username }),
        rpc('gp_list', { p_q: null, p_genre: null, p_tag: null, p_author: username, p_sort: 'new', p_offset: 0 })]);
      if (!pr.ok) { app.innerHTML = '<div class="empty">ユーザーが見つかりませんでした。</div>'; return; }
      const a = pr.author;
      setTitle(`${a.display_name || a.username} さんの記事`);
      app.innerHTML = `<section class="profile"><div class="av">${esc(a.avatar || '😀')}</div>
        <div><h1>${esc(a.display_name || a.username)}</h1><div class="small">@${esc(a.username)} ／ 記事 ${Number(pr.posts)} 件 ／ もらったピタっと！ ${Number(pr.likes)}</div></div></section>
        <div class="grid">${list.items.length ? list.items.map(cardHtml).join('') : '<div class="empty" style="grid-column:1/-1">まだ記事がありません。</div>'}</div>
        ${list.more ? '<p class="small" style="text-align:center">最新の24件を表示しています。</p>' : ''}`;
    } catch { app.innerHTML = '<div class="empty">読み込めませんでした。</div>'; }
  }

  // ---------- 管理 ----------
  async function renderAdmin() {
    setTitle('管理');
    if (!(me?.is_admin)) { app.innerHTML = '<div class="empty">管理者だけが見られるページです。</div>'; return; }
    app.innerHTML = '<div class="loading">読み込み中…</div>';
    try {
      const r = await rpc('gp_admin_reports', { p_token: token() });
      if (!r.ok) { app.innerHTML = `<div class="empty">${esc(reasonText(r.reason))}</div>`; return; }
      app.innerHTML = `<h1>🛡️ 通報の一覧（${r.reports.length}）</h1>
        ${r.reports.length ? r.reports.map(x => `<div class="report-item">
          <div class="small">${esc(fmtDate(x.created_at))} ／ ${x.target === 'post' ? '記事' : 'コメント'} ／ 通報者: ${esc(x.reporter?.display_name || '?')}</div>
          <div><b>${esc(x.text ?? '（消えています）')}</b></div>
          <div>理由: ${esc(x.reason)}</div>
          <div class="actions" style="margin-top:8px;padding-top:8px">
            ${x.post_id ? `<a class="btn btn-sm" href="#/p/${Number(x.post_id)}">開く</a>` : ''}
            <button class="btn btn-sm btn-danger" type="button" data-rm="${esc(x.target)}:${Number(x.target_id)}">${x.target === 'post' ? '記事を非表示' : 'コメントを削除'}</button>
            <button class="btn btn-sm" type="button" data-dismiss="${Number(x.id)}">問題なし（片づける）</button>
          </div></div>`).join('') : '<div class="empty">通報はありません。</div>'}`;
      app.querySelectorAll('[data-dismiss]').forEach(b => b.addEventListener('click', async () => {
        const x = await rpc('gp_admin_dismiss', { p_token: token(), p_report_id: Number(b.dataset.dismiss) });
        if (!x.ok) toast(reasonText(x.reason)); renderAdmin();
      }));
      app.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', async () => {
        const [target, idStr] = b.dataset.rm.split(':'); const tid = Number(idStr);
        if (!(await confirmBox(target === 'post' ? 'この記事を非表示にしますか？' : 'このコメントを削除しますか？', '実行する', true))) return;
        const x = target === 'post' ? await rpc('gp_post_delete', { p_token: token(), p_id: tid })
          : await rpc('gp_comment_delete', { p_token: token(), p_cid: tid });
        if (!x.ok) toast(reasonText(x.reason)); renderAdmin();
      }));
    } catch { app.innerHTML = '<div class="empty">読み込めませんでした。</div>'; }
  }

  // ---------- ルール ----------
  function renderRules() {
    setTitle('投稿のルール');
    app.innerHTML = `<section class="rules"><h1>📜 投稿のルール</h1>
      <ol>
        <li>好きなゲームを、楽しく紹介しよう。ほかの人やゲームの悪口・けんかはやめよう。</li>
        <li>名前・住所・学校・電話番号・SNS のIDなど、<b>個人情報は書かない</b>。</li>
        <li>こわい・グロい・えっちな画像や、ほかの人がいやな気持ちになる内容は貼らない。</li>
        <li>ネタバレは記事の先頭で「ネタバレあり」と書いてから。</li>
        <li>ほかの人の文章や画像を、そのまま自分のものとして使わない。画像はゲームの公式サイトなどのものを使おう。</li>
        <li>宣伝だけの記事や、あやしいサイトへのリンクは禁止。</li>
      </ol>
      <p>ルールを守らない記事やコメントは、管理者が非表示・削除することがあります。見つけたら「🚩 通報」から教えてください。</p>
      <h2>本文の書き方</h2>
      <ul>
        <li><code>## 見出し</code> … 見出しになります</li>
        <li><code>**太字**</code> … <strong>太字</strong>になります</li>
        <li>URL だけの行 … 画像（.png .jpg など）は画像、YouTube は動画、それ以外はリンクカードとして表示</li>
        <li><code>画像: https://…</code> … 拡張子がない URL でも画像として表示</li>
      </ul>
      <p class="small">安全のため、使える URL は https:// で始まるものだけです。HTML は使えません（文字としてそのまま表示されます）。</p>
      <p><a href="#/">← トップへ</a></p></section>`;
  }

  // ---------- ルーター ----------
  function route() {
    closeModal();
    const h = location.hash || '#/'; let m;
    if ((m = h.match(/^#\/p\/(\d{1,15})$/))) renderPost(Number(m[1]));
    else if ((m = h.match(/^#\/edit\/(\d{1,15})$/))) renderEditor(Number(m[1]));
    else if (h === '#/new') renderEditor(null);
    else if (h === '#/shindan') renderShindan();
    else if ((m = h.match(/^#\/u\/([^/?]{1,64})$/))) { let u; try { u = decodeURIComponent(m[1]); } catch { u = ''; } renderProfile(u); }
    else if (h === '#/admin') renderAdmin();
    else if (h === '#/rules') renderRules();
    else renderHome();
  }
  window.addEventListener('hashchange', () => { route(); window.scrollTo({ top: 0 }); });

  (async () => {
    updateHeader();
    route();
    await loadMe(); updateHeader();
    if (location.hash === '#/admin') route();
    // ログイン・ログアウトしたら読み直す
    ka?.onChange(async () => { await loadMe(); updateHeader(); route(); });
  })();
  console.info(`GamePita v${VERSION}`);
})();
