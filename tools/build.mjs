// GamePita の静的ページ生成（検索エンジン向け）
// Supabase の gp_export（公開中の記事だけ）を読み、/blog/123/ などのページと sitemap.xml を _site に書き出す。
// 使い方: node tools/build.mjs   （環境変数 BASE=/ SITE=https://gamepita.pages.dev/ OUT=_site。Cloudflare Pages の設定で入れる）
// 記事の取得に失敗したら終了コード 1 で止まる（GitHub Actions は公開を中止し、前の版がそのまま残る）。
import { readFile, writeFile, mkdir, copyFile, rm, cp } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const R = require(join(ROOT, 'render.js'));
const { esc, GENRES, GENRE_EMOJI, GENRE_SLUG, plainText, safeUrl, postUrl, genreUrl, userUrl, gameUrl, typeUrl, TYPES, similarScore } = R;

const BASE = process.env.BASE || '/gamepita/';
const SITE = (process.env.SITE || 'https://kaikomziu.github.io/gamepita/').replace(/\/?$/, '/');
const OUT = join(ROOT, process.env.OUT || '_site');
const SUPABASE_URL = 'https://kifnzvktwbomxthzvvgy.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Ea_sHRg6wMwO9YkDTjgOog_stQT1mfq'; // 公開用キー
const abs = path => SITE + path.slice(BASE.length);
const DEFAULT_DESC = '好きなゲームを紹介し合うサイト。だれでも記事を書けて、ピタっと診断で自分に合うゲームが見つかります。';

// app.js の VERSION をそのまま使う（キャッシュ対策の ?v=）
const appSrc = await readFile(join(ROOT, 'app.js'), 'utf8');
const VER = (appSrc.match(/const VERSION = '([\d.]+)'/) || [])[1] || '0';

// ---------- 記事・商品紹介の取得 ----------
async function fetchPosts(fn = 'gp_export') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', body: '{}',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`${fn}: ${res.status} ${await res.text()}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error(`${fn}: 配列ではありません`);
  return data;
}

// ---------- HTML 組み立て ----------
const template = await readFile(join(ROOT, 'template.html'), 'utf8');
const tpl = template.split('{{BASE}}').join(BASE).split('{{VER}}').join(VER).split('{{SITE}}').join(SITE);
const iHead = tpl.indexOf('{{HEAD}}'), iMain = tpl.indexOf('{{MAIN}}');
if (iHead < 0 || iMain < 0) throw new Error('template.html に {{HEAD}} / {{MAIN}} がありません');
// 利用者の文字に「{{MAIN}}」などが入っていても壊れないよう、置換ではなく切り貼りで組み立てる
const page = (head, main) => tpl.slice(0, iHead) + head + tpl.slice(iHead + 8, iMain) + main + tpl.slice(iMain + 8);
// JSON-LD は </script> で抜け出せないよう < をエスケープ
const ld = obj => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;

function head({ title, desc, path, noindex, image, type = 'website', jsonld = [] }) {
  const full = title ? `${title}｜GamePita` : 'GamePita（ゲームピタ）｜自分に合うゲームをピタっと見つける';
  const url = abs(path);
  const img = image || `${SITE}ogp.png`;
  return [
    `<title>${esc(full)}</title>`,
    `<meta name="description" content="${esc(desc || DEFAULT_DESC)}">`,
    `<meta name="robots" content="${noindex ? 'noindex' : 'index,follow'}">`,
    `<link rel="canonical" href="${esc(url)}">`,
    `<meta property="og:type" content="${type}">`,
    `<meta property="og:title" content="${esc(full)}">`,
    `<meta property="og:description" content="${esc(desc || DEFAULT_DESC)}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    `<meta property="og:image" content="${esc(img)}">`,
    ...jsonld.map(ld),
  ].join('\n');
}
const crumbsLd = items => ({
  '@context': 'https://schema.org', '@type': 'BreadcrumbList',
  itemListElement: items.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: abs(path) })),
});
const grid = posts => `<div class="grid">${posts.map(p => R.cardHtml(p, BASE)).join('')}</div>`;
const loading = '<div class="loading">読み込み中…</div>';

async function write(path, html) {
  const rel = path.slice(BASE.length);
  const file = join(OUT, rel, rel === '' || rel.endsWith('/') ? 'index.html' : '');
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, html, 'utf8');
}

// ---------- 生成 ----------
const posts = await fetchPosts();
const goods = await fetchPosts('gp_goods_export');
const { GOODS_CATS, goodsUrl, goodsCatUrl } = R;
const ggrid = list => `<div class="grid">${list.map(g => R.goodsCardHtml(g, BASE)).join('')}</div>`;
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
for (const f of ['style.css', 'app.js', 'render.js', 'theme.js', 'icon.svg', 'ogp.png', '_headers', '_redirects', 'google638b82f251e650ee.html']) await copyFile(join(ROOT, f), join(OUT, f));
await cp(join(ROOT, 'ogp'), join(OUT, 'ogp'), { recursive: true });
await cp(join(ROOT, 'covers'), join(OUT, 'covers'), { recursive: true });

const sitemap = []; // [url, lastmod]
const latest = d => d.reduce((a, p) => (p.updated_at > a ? p.updated_at : a), '');

// トップ
await write(BASE, page(
  head({ path: BASE, jsonld: [{
    '@context': 'https://schema.org', '@type': 'WebSite', name: 'GamePita', alternateName: 'ゲームピタ', url: SITE,
    description: DEFAULT_DESC, inLanguage: 'ja',
    potentialAction: { '@type': 'SearchAction', target: `${SITE}blog/?q={search_term_string}`, 'query-input': 'required name=search_term_string' },
  }] }),
  `${R.heroHtml(BASE)}
  <h2 class="section-title">🆕 新着の記事</h2>
  ${posts.length ? grid(posts.slice(0, 8)) : '<div class="empty">まだ記事がありません。</div>'}
  <div class="more"><a class="btn" href="${BASE}blog/">📚 記事をもっと見る</a></div>
  ${goods.length ? `<h2 class="section-title">🛍️ 新着の商品紹介</h2>${ggrid(goods.slice(0, 4))}
  <div class="more"><a class="btn" href="${BASE}goods/">🛍️ 商品紹介をもっと見る</a></div>` : ''}
  <h2 class="section-title">🎮 ジャンルからさがす</h2>
  ${R.genreLinksHtml(BASE, '')}
  <section class="intro"><h2>GamePita（ゲームピタ）とは</h2>
  <p>GamePita は、好きなゲームを紹介し合うゲーム記事サイトです。だれでも無料で、おすすめのゲームの紹介記事を書けます。
  ジャンル・遊べる機種（PC・Switch・PlayStation・Xbox・スマホ・ブラウザ）・ひとりで遊ぶかみんなで遊ぶか・難しさ・値段から記事をさがせて、
  「ピタっと診断」では6つの質問に答えるだけで、あなたに合うゲームを見つけられます。</p></section>`));
sitemap.push([abs(BASE), latest(posts)]);

// ブログ一覧（最新24件のカード＋全記事へのリンク）
await write(`${BASE}blog/`, page(
  head({ title: 'ブログ（ゲーム紹介記事の一覧）', desc: 'みんなが書いたゲーム紹介記事の一覧。キーワード・ジャンル・タグでさがせます。', path: `${BASE}blog/`,
    jsonld: [crumbsLd([['トップ', BASE], ['ブログ', `${BASE}blog/`]])] }),
  `<h1 class="page-title">📚 ブログ（ゲーム紹介記事の一覧）</h1>
  ${posts.length ? grid(posts.slice(0, 24)) : '<div class="empty">まだ記事がありません。</div>'}
  ${posts.length > 24 ? `<section class="intro"><h2>すべての記事</h2><ul>${posts.map(p =>
    `<li><a href="${esc(postUrl(BASE, p.id))}">${esc(p.title)}（${esc(p.game)}）</a></li>`).join('')}</ul></section>` : ''}`));
sitemap.push([abs(`${BASE}blog/`), latest(posts)]);

// 似ている記事（DB の gp_similar と同じ計算）
function similarHtml(p) {
  const list = posts.filter(q => q.id !== p.id).map(q => [similarScore(q, p), q]).filter(([sc]) => sc >= 3)
    .sort((a, b) => b[0] - a[0] || b[1].id - a[1].id).slice(0, 4).map(([, q]) => q);
  return list.length ? `<section class="similar"><h2 class="section-title">🧩 このゲームが好きなら、これも</h2>${grid(list)}</section>` : '';
}

// 記事
for (const p of posts) {
  const path = postUrl(BASE, p.id);
  const desc = plainText(p.body, 110) || `${p.game}の紹介記事`;
  const name = p.author?.display_name || p.author?.username || 'GamePita ユーザー';
  const cover = p.cover_url ? safeUrl(p.cover_url) : null;
  await write(path, page(
    head({ title: `${p.title}（${p.game}）`, desc, path, type: 'article', image: cover, jsonld: [{
      '@context': 'https://schema.org', '@type': 'Review', name: p.title, url: abs(path),
      reviewBody: plainText(p.body, 500), datePublished: p.created_at, dateModified: p.updated_at, inLanguage: 'ja',
      ...(cover ? { image: cover } : {}),
      author: { '@type': 'Person', name, ...(p.author?.username ? { url: abs(userUrl(BASE, p.author.username)) } : {}) },
      publisher: { '@type': 'Organization', name: 'GamePita', url: SITE },
      itemReviewed: { '@type': 'VideoGame', name: p.game, genre: p.genre, gamePlatform: p.platforms,
        applicationCategory: 'Game', operatingSystem: (p.platforms || []).join(', ') },
      reviewRating: { '@type': 'Rating', ratingValue: p.rating, bestRating: 5, worstRating: 1 },
    }, crumbsLd([['トップ', BASE], ['ブログ', `${BASE}blog/`], [p.genre, genreUrl(BASE, p.genre)], [p.title, path]])] }),
    `<article class="article">${R.coverHtml(p)}<div class="article-in">${R.articleInner(p, BASE)}</div></article>
    ${similarHtml(p)}
    <section class="comments"><h2>💬 コメント</h2>${loading}</section>`));
  sitemap.push([abs(path), p.updated_at]);
}

// ジャンル別（記事が0件のジャンルは noindex にしてサイトマップに入れない）
for (const g of GENRES) {
  const list = posts.filter(p => p.genre === g);
  const path = genreUrl(BASE, g);
  await write(path, page(
    head({ title: `${g}のおすすめゲーム紹介記事`, desc: `${g}ジャンルのおすすめゲームを、みんなの紹介記事で見つけよう。GamePita のゲーム紹介記事の一覧です。`,
      path, noindex: list.length === 0, jsonld: [crumbsLd([['トップ', BASE], ['ブログ', `${BASE}blog/`], [g, path]])] }),
    `<h1 class="page-title">${GENRE_EMOJI[g]} ${esc(g)}のおすすめゲーム</h1>
    ${R.genreLinksHtml(BASE, g)}
    ${list.length ? grid(list.slice(0, 48)) : '<div class="empty">まだこのジャンルの記事はありません。</div>'}`));
  if (list.length) sitemap.push([abs(path), latest(list)]);
}

// 書いた人のページ（ユーザー名が URL に安全な文字だけのとき）
const authors = new Map();
for (const p of posts) {
  const u = p.author?.username;
  if (u && /^[A-Za-z0-9_-]{1,32}$/.test(u)) { if (!authors.has(u)) authors.set(u, []); authors.get(u).push(p); }
}
for (const [u, list] of authors) {
  const a = list[0].author; const name = a.display_name || u; const path = userUrl(BASE, u);
  await write(path, page(
    head({ title: `${name} さんのゲーム紹介記事`, desc: `${name} さんが GamePita に書いたゲーム紹介記事の一覧です。`, path }),
    `<section class="profile"><div class="av">${esc(a.avatar || '😀')}</div><div><h1>${esc(name)}</h1>
    <div class="small">@${esc(u)} ／ 記事 ${list.length} 件</div></div></section>${grid(list.slice(0, 24))}`));
  sitemap.push([abs(path), latest(list)]);
}

// ゲームのまとめページ
const games = new Map();
for (const p of posts) if (p.game_id) { if (!games.has(p.game_id)) games.set(p.game_id, []); games.get(p.game_id).push(p); }
for (const [gid, list] of games) {
  const name = list[0].game_name || list[0].game;
  const path = gameUrl(BASE, gid);
  const avg = (list.reduce((a, p) => a + Number(p.rating), 0) / list.length).toFixed(1);
  const plats = [...new Set(list.flatMap(p => p.platforms || []))];
  const genres = [...new Set(list.map(p => p.genre))];
  await write(path, page(
    head({ title: `${name}の評価・紹介記事まとめ`, desc: `${name}の紹介記事 ${list.length} 件・平均おすすめ度 ★${avg}。みんなの感想から、${name}が自分に合うかチェックしよう。`,
      path, image: list.map(p => p.cover_url && safeUrl(p.cover_url)).find(Boolean) || null, jsonld: [{
        '@context': 'https://schema.org', '@type': 'VideoGame', name, url: abs(path), genre: genres, gamePlatform: plats,
        applicationCategory: 'Game', operatingSystem: plats.join(', '),
        aggregateRating: { '@type': 'AggregateRating', ratingValue: Number(avg), reviewCount: list.length, bestRating: 5, worstRating: 1 },
      }, crumbsLd([['トップ', BASE], ['ブログ', `${BASE}blog/`], [name, path]])] }),
    `<section class="game-head"><div>${genres.map(g => `<a class="genre-badge" href="${esc(genreUrl(BASE, g))}">${esc(g)}</a>`).join(' ')}</div>
      <h1>🎮 ${esc(name)}</h1><div class="game-stats"><span>おすすめ度 <b>${R.stars(Math.round(Number(avg)))} ${avg}</b></span>
      <span>紹介記事 <b>${list.length}</b> 件</span><span>機種 <b>${plats.map(esc).join('・')}</b></span></div></section>
    <h2 class="section-title">📝 ${esc(name)}の紹介記事</h2>${grid(list.slice(0, 50))}`));
  sitemap.push([abs(path), latest(list)]);
}

// 商品紹介：一覧・種類別・1件ずつ
const goodsIntro = '<p class="small">ゲームソフト・ゲーム機・コントローラー・グッズ・攻略本など、「買ってよかった！」をみんなで紹介するコーナーです。</p>';
await write(`${BASE}goods/`, page(
  head({ title: '商品紹介（ゲーム・周辺機器・グッズ）', desc: 'ゲームソフト・ゲーム機・周辺機器・グッズ・攻略本など、みんながおすすめする商品の紹介の一覧です。',
    path: `${BASE}goods/`, jsonld: [crumbsLd([['トップ', BASE], ['商品紹介', `${BASE}goods/`]])] }),
  `<h1 class="page-title">🛍️ 商品紹介</h1>${goodsIntro}${R.goodsCatLinksHtml(BASE, '')}
  ${goods.length ? ggrid(goods.slice(0, 24)) : '<div class="empty">まだ商品紹介がありません。</div>'}
  ${goods.length > 24 ? `<section class="intro"><h2>すべての商品紹介</h2><ul>${goods.map(g =>
    `<li><a href="${esc(goodsUrl(BASE, g.id))}">${esc(g.title)}（${esc(g.name)}）</a></li>`).join('')}</ul></section>` : ''}`));
sitemap.push([abs(`${BASE}goods/`), latest(goods)]);
for (const [k, c] of Object.entries(GOODS_CATS)) {
  const list = goods.filter(g => g.category === k);
  const path = goodsCatUrl(BASE, k);
  await write(path, page(
    head({ title: `${c.t}のおすすめ・紹介`, desc: `みんながおすすめする${c.t}の紹介。GamePita の商品紹介の一覧です。`, path, noindex: list.length === 0,
      jsonld: [crumbsLd([['トップ', BASE], ['商品紹介', `${BASE}goods/`], [c.t, path]])] }),
    `<h1 class="page-title">${c.e} ${esc(c.t)}のおすすめ</h1>${R.goodsCatLinksHtml(BASE, k)}
    ${list.length ? ggrid(list.slice(0, 48)) : '<div class="empty">まだこの種類の商品紹介はありません。</div>'}`));
  if (list.length) sitemap.push([abs(path), latest(list)]);
}
for (const g of goods) {
  const path = goodsUrl(BASE, g.id);
  const c = GOODS_CATS[g.category] || GOODS_CATS.other;
  const img = g.image_url ? safeUrl(g.image_url) : null;
  const name = g.author?.display_name || g.author?.username || 'GamePita ユーザー';
  await write(path, page(
    head({ title: `${g.title}（${g.name}）`, desc: plainText(g.body, 110) || `${g.name}の紹介`, path, type: 'article', image: img, jsonld: [{
      '@context': 'https://schema.org', '@type': 'Product', name: g.name, category: c.t, url: abs(path),
      ...(img ? { image: img } : {}), ...(g.maker ? { brand: { '@type': 'Brand', name: g.maker } } : {}),
      review: { '@type': 'Review', name: g.title, reviewBody: plainText(g.body, 500), datePublished: g.created_at, inLanguage: 'ja',
        author: { '@type': 'Person', name, ...(g.author?.username ? { url: abs(userUrl(BASE, g.author.username)) } : {}) },
        reviewRating: { '@type': 'Rating', ratingValue: g.rating, bestRating: 5, worstRating: 1 } },
    }, crumbsLd([['トップ', BASE], ['商品紹介', `${BASE}goods/`], [c.t, goodsCatUrl(BASE, g.category)], [g.title, path]])] }),
    `<article class="article">${R.goodsCoverHtml(g)}<div class="article-in">${R.goodsInner(g, BASE)}</div></article>
    <section class="comments"><h2>💬 コメント</h2>${loading}</section>`));
  sitemap.push([abs(path), g.updated_at]);
}

// 診断タイプ（シェアされたときの画像・説明つきページ）
const typeLinks = t0 => `<div class="type-list">${TYPES.filter(x => x !== t0).map(x => `<a class="chip" href="${esc(typeUrl(BASE, x.slug))}">${x.e} ${esc(x.name)}</a>`).join('')}</div>`;
await write(`${BASE}shindan/type/`, page(
  head({ title: 'ピタっと診断のタイプ一覧', desc: 'ピタっと診断でわかる8つのゲーマータイプの一覧です。あなたはどのタイプ？', path: `${BASE}shindan/type/` }),
  `<h1 class="page-title">🧩 ピタっと診断のタイプ一覧</h1>${typeLinks(null)}`));
sitemap.push([abs(`${BASE}shindan/type/`), '']);
for (const t of TYPES) {
  const path = typeUrl(BASE, t.slug);
  await write(path, page(
    head({ title: `${t.name}｜ピタっと診断`, desc: `${t.e}${t.name}：${t.desc}`, path, image: `${SITE}ogp/type-${t.slug}.png`,
      jsonld: [crumbsLd([['トップ', BASE], ['ピタっと診断', `${BASE}shindan/`], [t.name, path]])] }),
    `<section class="type-card"><div class="tl">ピタっと診断のタイプ</div><div class="te">${t.e}</div><h1>${esc(t.name)}</h1><p>${esc(t.desc)}</p></section>
    <div class="more"><a class="btn btn-primary" href="${BASE}shindan/">🧩 自分も診断してみる</a></div>
    <h2 class="section-title">ほかのタイプ</h2>${typeLinks(t)}`));
  sitemap.push([abs(path), '']);
}

// 運営者情報・プライバシーポリシー・利用規約（本文も静的に入れる）
for (const [path, title, desc, html] of [
  [`${BASE}about/`, '運営者情報・クレジット', 'GamePita（ゲームピタ）の運営者情報とクレジットです。', R.aboutHtml(BASE)],
  [`${BASE}privacy/`, 'プライバシーポリシー', 'GamePita で集める情報と、その使い道・管理のしかたについて説明します。', R.privacyHtml(BASE)],
  [`${BASE}terms/`, '利用規約', 'GamePita を使うときのルール（利用規約）です。', R.termsHtml(BASE)],
]) {
  await write(path, page(head({ title, desc, path }), html));
  sitemap.push([abs(path), '']);
}

// 中身は app.js が作るページ
const shells = [
  [`${BASE}shindan/`, { title: 'ピタっと診断（自分に合うゲームがわかる）', desc: '6つの質問に答えるだけで、みんなのゲーム紹介記事の中から、あなたにピタっと合うゲームを相性つきでおすすめします。' }, true],
  [`${BASE}rules/`, { title: '投稿のルール・本文の書き方', desc: 'GamePita に記事やコメントを書くときのルールと、本文の書き方（見出し・太字・画像・YouTube の埋め込み）です。' }, true],
  [`${BASE}new/`, { title: '記事を書く', noindex: true }, false],
  [`${BASE}goods/new/`, { title: '商品を紹介する', noindex: true }, false],
  [`${BASE}goods/compare/`, { title: '商品の比較', noindex: true }, false],
  [`${BASE}ranking/`, { title: 'ランキング', desc: 'GamePita で「ピタっと！」が多かった記事・商品紹介のランキングです。' }, true],
  [`${BASE}theme/`, { title: 'お題企画', desc: 'GamePita のお題企画の一覧です。お題のタグをつけて記事や商品紹介を書いて参加しよう！' }, true],
  [`${BASE}contact/`, { title: 'お問い合わせ', desc: 'GamePita へのご質問・不具合の報告・削除の依頼などは、こちらからどうぞ。' }, true],
  [`${BASE}admin/`, { title: '管理', noindex: true }, false],
  [`${BASE}mylist/`, { title: 'マイリスト', noindex: true }, false],
];
for (const [path, h, inMap] of shells) {
  await write(path, page(head({ ...h, path }), loading));
  if (inMap) sitemap.push([abs(path), '']);
}

// 404（まだ静的ページがない新しい記事・編集画面なども、ここから app.js が表示する）
await writeFile(join(OUT, '404.html'), page(head({ title: 'ページが見つかりません', path: BASE, noindex: true }), loading), 'utf8');

// サイトマップ
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemap.map(([u, mod]) => `  <url><loc>${esc(u)}</loc>${mod ? `<lastmod>${esc(new Date(mod).toISOString())}</lastmod>` : ''}</url>`).join('\n')}
</urlset>
`;
await writeFile(join(OUT, 'sitemap.xml'), xml, 'utf8');
console.log(`GamePita v${VER}: 記事 ${posts.length} 件・商品紹介 ${goods.length} 件・ページ ${sitemap.length} 件をサイトマップに出力 → ${OUT}`);
