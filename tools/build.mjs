// GamePita の静的ページ生成（検索エンジン向け）
// Supabase の gp_export（公開中の記事だけ）を読み、/blog/123/ などのページと sitemap.xml を _site に書き出す。
// 使い方: node tools/build.mjs   （環境変数 BASE=/gamepita/ SITE=https://kaikomziu.github.io/gamepita/ OUT=_site）
// 記事の取得に失敗したら終了コード 1 で止まる（GitHub Actions は公開を中止し、前の版がそのまま残る）。
import { readFile, writeFile, mkdir, copyFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const R = require(join(ROOT, 'render.js'));
const { esc, GENRES, GENRE_EMOJI, GENRE_SLUG, plainText, safeUrl, postUrl, genreUrl, userUrl } = R;

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

// ---------- 記事の取得 ----------
async function fetchPosts() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/gp_export`, {
    method: 'POST', body: '{}',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`gp_export: ${res.status} ${await res.text()}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('gp_export: 配列ではありません');
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
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
for (const f of ['style.css', 'app.js', 'render.js', 'icon.svg', 'ogp.png']) await copyFile(join(ROOT, f), join(OUT, f));

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

// 中身は app.js が作るページ
const shells = [
  [`${BASE}shindan/`, { title: 'ピタっと診断（自分に合うゲームがわかる）', desc: '6つの質問に答えるだけで、みんなのゲーム紹介記事の中から、あなたにピタっと合うゲームを相性つきでおすすめします。' }, true],
  [`${BASE}rules/`, { title: '投稿のルール・本文の書き方', desc: 'GamePita に記事やコメントを書くときのルールと、本文の書き方（見出し・太字・画像・YouTube の埋め込み）です。' }, true],
  [`${BASE}new/`, { title: '記事を書く', noindex: true }, false],
  [`${BASE}admin/`, { title: '管理', noindex: true }, false],
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
console.log(`GamePita v${VER}: 記事 ${posts.length} 件・ページ ${sitemap.length} 件をサイトマップに出力 → ${OUT}`);
