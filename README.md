# GamePita（ゲームピタ） v1.3.0

自分に合うゲームを、ピタっと見つける。好きなゲームを紹介し合う記事サイト。素の HTML/CSS/JS（`template.html` `style.css` `render.js` `app.js`）。

公開: https://kaikomziu.github.io/gamepita/

## できること
- だれでも記事を読める。書く・ピタっと！（いいね）・コメント・通報はログインが必要。
- 記事: ゲーム名・タイトル・ジャンル・機種・遊び方・時間・難しさ・値段・おすすめ度（★1〜5）・タグ（5個まで）・カバー画像 URL・公式 URL・本文。
- 本文の書き方: `## 見出し`、`**太字**`、URL だけの行は埋め込み（画像・YouTube・リンクカード）、`画像: URL` で拡張子なしの画像。
- 検索・ジャンル・タグ・並べ替え（新しい順／ピタっと！順／おすすめ度順）。
- ピタっと診断: 6問に答えると、記事の属性から相性の点数を出して上位12件を表示（`gp_diagnose`）。
  結果は8タイプ（遊び方×時間×難しさ、`render.js` の `TYPES`）。タイプページ `/shindan/type/<slug>/` と画像 `ogp/type-<slug>.png` で X・LINE にシェアできる。
- v1.2.0:
  - ゲームのまとめページ `/game/<id>/`。ゲーム名は `_gp_norm`（全角半角・大小・空白・記号を無視）で同じゲームにまとめる（トリガー `gp_posts_game`）。書くときに候補が出る（`gp_game_suggest`）。
  - 似ている記事「このゲームが好きなら、これも」（`gp_similar`、静的ページは `similarScore` で同じ計算）。
  - 気になる・プレイ中・遊んだ！（ゲーム単位、`gp_marks`）とマイリスト `/mylist/`（本人だけ）。
  - 書いた人のバッジ（記事数・もらったピタっと！・コメント数・公認ライター。`_gp_badges`）。公認は管理画面で付ける。
  - 本文の `||ネタバレ||`、見出し3つ以上で目次、ダークモード（`theme.js`、`gp_theme`）、🔔通知（自分の記事へのコメント・ピタっと！、`gp_notifs`）。

- v1.3.0: 運営者情報・クレジット `/about/`、プライバシーポリシー `/privacy/`、利用規約 `/terms/`（本文は `render.js` の `aboutHtml` など、制定日は `LEGAL_DATE`）、
  お問い合わせ `/contact/`（メールアドレスは集めない。端末ごとの番号 `gp_inbox` かアカウントで返信を見る。管理画面で返信、ログイン中なら🔔通知）。
  DB は `gp_inquiries` と `gp_inquiry_submit` `gp_inquiry_mine` `gp_admin_inquiries` `gp_admin_inquiry_reply`（`supabase/v1_3_contact.sql`）。

## URL（ページ分け）
`/`トップ ・ `/blog/` ブログ一覧（`?q=` `?tag=` `?sort=`）・ `/blog/123/` 記事 ・ `/blog/123/edit/` 編集 ・ `/genre/rpg/` ジャンル別 ・
`/shindan/` 診断 ・ `/shindan/type/<slug>/` 診断タイプ ・ `/game/<id>/` ゲーム ・ `/mylist/` マイリスト ・ `/user/ユーザー名/` 書いた人 ・ `/new/` 書く ・ `/rules/` ルール ・ `/admin/` 管理。
画面の切りかえは History API（app.js の `route()`）。前の `#/p/1` 形式は新しい URL に転送する。

## 検索エンジン向け（静的ページの生成）
- `tools/build.mjs` が `gp_export`（公開記事だけ）を読み、`_site/` にトップ・ブログ一覧・記事・ジャンル・ユーザーのページ、
  `404.html`、`sitemap.xml` を作る。各ページにタイトル・説明・canonical・OGP・JSON-LD（Review / BreadcrumbList / WebSite）入り。
- GitHub Actions（`.github/workflows/pages.yml`）が push 時と毎時17分に生成して Pages に公開する。取得に失敗したら公開しない。
  新しい記事は次の生成までは `404.html` から app.js が表示する（中身は見られる）。
- 検索結果・診断結果・書く／編集／管理は noindex。サイトマップは Search Console の `https://kaikomziu.github.io/` に登録済み。
- 注意: 公開リポジトリは60日間 push がないと定期実行が止まる。止まったら Actions の画面で有効に戻す。

## しくみ
- ログイン: かるわかGAMESアカウント（`karuwaka-account.js`、`data-keys` は空なのでクラウドセーブはしない）。
  `kaikomziu.github.io` に置くと、ほかのゲームとログイン状態を共有できる。管理者は `ka_accounts.is_admin`。
- DB: 共有 Supabase kifnzvktwbomxthzvvgy、マイグレーション `gamepita_site` `gamepita_export` `gamepita_v1_2` `gamepita_backfill_game_id` `gamepita_contact`（中身は `supabase/schema.sql` `supabase/v1_2_features.sql` `supabase/v1_3_contact.sql`）。
  テーブル `gp_posts` `gp_likes` `gp_comments` `gp_reports` `gp_games` `gp_users` `gp_marks` は RLS で全拒否、操作は SECURITY DEFINER の RPC だけ:
  `gp_me` `gp_list` `gp_get` `gp_post_save` `gp_post_delete` `gp_like_toggle` `gp_comment_add` `gp_comment_delete`
  `gp_report` `gp_admin_reports` `gp_admin_dismiss` `gp_tags` `gp_profile` `gp_diagnose` `gp_export`（静的ページ用） `gp_game` `gp_game_suggest` `gp_similar` `gp_mark_set` `gp_my_marks` `gp_notifs` `gp_notif_seen` `gp_admin_set_official` `gp_admin_writers`。
- 制限: 投稿は1日10件・コメントは1時間30件・通報は1日20件。本文8000字・コメント500字・タイトル/ゲーム名60字。

## セキュリティ
- ユーザーが書いた文字はすべてエスケープして表示（HTML は使えない）。
- URL は `https://` だけ。サーバー（`_gp_url_ok`）とブラウザ（`safeUrl`）の両方で、空白・引用符・`< >`・バックスラッシュを含むものを拒否。
- YouTube は 11文字の動画 ID だけを取り出して `youtube-nocookie.com` の iframe（sandbox つき）に入れる。
- リンクは `rel="noopener noreferrer nofollow ugc"`、画像は `referrerpolicy="no-referrer"`。
- CSP（`template.html` の meta）で、スクリプトは自サイトと kaikomziu.github.io だけ、通信は Supabase だけ、iframe は youtube-nocookie だけに制限。
- 編集は書いた本人だけ。削除は本人（完全削除）と管理者（非表示）。コメント削除は本人・記事の作者・管理者。

## テスト
ローカル: `MSYS_NO_PATHCONV=1 BASE=/ SITE=http://localhost:8812/ node tools/build.mjs` で生成し、`python tools/serve.py`（プレビュー名 `gamepita`、ポート 8812、ないパスは 404.html を返す）。Git Bash では `MSYS_NO_PATHCONV=1` がないと `BASE=/` が Windows のパスに化ける。テスト用アカウントは `e2e_gp_` で始め、終わったら
`delete from ka_accounts where username like 'e2e\_gp\_%'` で消す（gp_* は連鎖して消える）。

## 更新するとき
`app.js` の VERSION とこの README の見出しを上げる（`?v=` とフッターの表記は生成時に VERSION から入る）。OGP 画像とタイプ画像は `python tools/make_ogp.py`（タイプを変えたら render.js と make_ogp.py の両方を直す）。
