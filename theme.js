// テーマ（ライト／ダーク）を、ページを描く前に決める（ちらつき防止のため <head> で読む）
// localStorage "gp_theme" が 'light' / 'dark' ならそれ、なければ端末の設定に合わせる（CSS 側で判定）
(function () {
  try {
    var t = localStorage.getItem('gp_theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) { /* localStorage が使えないときは端末の設定のまま */ }
})();
