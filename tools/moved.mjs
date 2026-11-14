// 引っ越し後の GitHub Pages 用：build.mjs が作った _site の各ページを「引っ越しました」の案内ページに置きかえる。
// 使い方: node tools/build.mjs のあとに  MOVED_TO=https://gamepita.pages.dev/ OLD_BASE=/gamepita/ node tools/moved.mjs
// 画像（covers/ ogp/ ogp.png icon.svg）は、外から貼られている場合のためにそのまま残す。
import { readdir, writeFile, rm } from 'node:fs/promises';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, process.env.OUT || '_site');
const NEW = (process.env.MOVED_TO || '').replace(/\/?$/, '/');
const OLD_BASE = process.env.OLD_BASE || '/gamepita/';
if (!/^https:\/\/[a-z0-9.-]+\/$/.test(NEW)) throw new Error('MOVED_TO に https://〜/ の形で新しい URL を入れてください');

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const WAIT = 3; // 何秒後に移動するか

// rel: サイトの根元からのパス（例 "blog/9/"）。null のときはブラウザの今の URL から計算する（404.html 用）
function page(rel) {
  const to = rel == null ? NEW : NEW + rel;
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GamePita は引っ越しました</title>
<link rel="canonical" href="${esc(to)}">
<meta http-equiv="refresh" content="${WAIT}; url=${esc(to)}">
<meta name="referrer" content="strict-origin-when-cross-origin">
<link rel="icon" href="${OLD_BASE}icon.svg" type="image/svg+xml">
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; box-sizing: border-box;
    font-family: system-ui, "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, sans-serif; background: #fff8f4; color: #2b2233; }
  main { max-width: 34em; background: #fff; border-radius: 20px; padding: 28px 24px; box-shadow: 0 6px 24px rgba(255, 79, 107, .15); text-align: center; }
  h1 { font-size: 1.4rem; margin: 10px 0; }
  a.url { display: inline-block; margin: 6px 0 12px; font-weight: 700; color: #ff4f6b; word-break: break-all; }
  .btn { display: inline-block; background: linear-gradient(135deg, #ff7a45, #ff4f6b); color: #fff; text-decoration: none; font-weight: 700; padding: 10px 22px; border-radius: 999px; }
  .small { font-size: .85rem; color: #6b6275; }
  @media (prefers-color-scheme: dark) { body { background: #17141c; color: #f1edf5; } main { background: #221e29; } .small { color: #a9a2b4; } }
</style>
</head>
<body>
<main>
  <img src="${OLD_BASE}icon.svg" alt="" width="56" height="56">
  <h1>GamePita は引っ越しました</h1>
  <p>新しい URL に変わりました。</p>
  <a class="url" id="to" href="${esc(to)}">${esc(to)}</a>
  <p><a class="btn" id="go" href="${esc(to)}">新しい GamePita へ</a></p>
  <p class="small"><span id="sec">${WAIT}</span> 秒後に自動で移動します。ブックマークしている人は、新しい URL に登録し直してね。<br>
    アカウントや記事はそのままです（新しいサイトでは、もう一度ログインしてください）。</p>
</main>
<script>
(function () {
  var NEW = ${JSON.stringify(NEW)}, OLD = ${JSON.stringify(OLD_BASE)};
  // 今の URL のパス・? 以降・# 以降を、新しい URL に引きつぐ
  var p = location.pathname;
  var rel = p.indexOf(OLD) === 0 ? p.slice(OLD.length) : '';
  if (!/^[A-Za-z0-9._~%\\/-]*$/.test(rel)) rel = '';
  var to = NEW + rel + location.search + location.hash;
  var a = document.getElementById('to'); a.href = to; a.textContent = NEW + rel;
  document.getElementById('go').href = to;
  var n = ${WAIT}, s = document.getElementById('sec');
  var t = setInterval(function () { n--; if (s) s.textContent = Math.max(n, 0); if (n <= 0) { clearInterval(t); location.replace(to); } }, 1000);
})();
</script>
</body>
</html>
`;
}

// _site の中の index.html をすべて案内ページにする
async function walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) { if (!['covers', 'ogp'].includes(e.name) || dir !== OUT) await walk(full); }
    else if (e.name === 'index.html') {
      const rel = relative(OUT, dirname(full)).split(sep).join('/');
      await writeFile(full, page(rel ? `${rel}/` : ''), 'utf8');
    }
  }
}
await walk(OUT);
await writeFile(join(OUT, '404.html'), page(null), 'utf8');
// 古いサイトのサイトマップ・アプリ本体は消す（検索エンジンが新しい URL に移れるように）
for (const f of ['sitemap.xml', 'app.js', 'render.js', 'theme.js', 'style.css', '_headers', '_redirects']) await rm(join(OUT, f), { force: true });
console.log(`案内ページに置きかえました → ${NEW}`);
