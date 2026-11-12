# GamePita（ゲームピタ） v1.0.0

自分に合うゲームを、ピタっと見つける。好きなゲームを紹介し合う記事サイト。素の HTML/CSS/JS（`index.html` `style.css` `app.js`）。

公開: https://kaikomziu.github.io/gamepita/

## できること
- だれでも記事を読める。書く・ピタっと！（いいね）・コメント・通報はログインが必要。
- 記事: ゲーム名・タイトル・ジャンル・機種・遊び方・時間・難しさ・値段・おすすめ度（★1〜5）・タグ（5個まで）・カバー画像 URL・公式 URL・本文。
- 本文の書き方: `## 見出し`、`**太字**`、URL だけの行は埋め込み（画像・YouTube・リンクカード）、`画像: URL` で拡張子なしの画像。
- 検索・ジャンル・タグ・並べ替え（新しい順／ピタっと！順／おすすめ度順）。
- ピタっと診断: 6問に答えると、記事の属性から相性の点数を出して上位12件を表示（`gp_diagnose`）。
- 書いた人のページ `#/u/ユーザー名`、管理者の通報一覧 `#/admin`、投稿のルール `#/rules`。

## しくみ
- ログイン: かるわかGAMESアカウント（`karuwaka-account.js`、`data-keys` は空なのでクラウドセーブはしない）。
  `kaikomziu.github.io` に置くと、ほかのゲームとログイン状態を共有できる。管理者は `ka_accounts.is_admin`。
- DB: 共有 Supabase kifnzvktwbomxthzvvgy、マイグレーション `gamepita_site`（中身は `supabase/schema.sql`）。
  テーブル `gp_posts` `gp_likes` `gp_comments` `gp_reports` は RLS で全拒否、操作は SECURITY DEFINER の RPC だけ:
  `gp_me` `gp_list` `gp_get` `gp_post_save` `gp_post_delete` `gp_like_toggle` `gp_comment_add` `gp_comment_delete`
  `gp_report` `gp_admin_reports` `gp_admin_dismiss` `gp_tags` `gp_profile` `gp_diagnose`。
- 制限: 投稿は1日10件・コメントは1時間30件・通報は1日20件。本文8000字・コメント500字・タイトル/ゲーム名60字。

## セキュリティ
- ユーザーが書いた文字はすべてエスケープして表示（HTML は使えない）。
- URL は `https://` だけ。サーバー（`_gp_url_ok`）とブラウザ（`safeUrl`）の両方で、空白・引用符・`< >`・バックスラッシュを含むものを拒否。
- YouTube は 11文字の動画 ID だけを取り出して `youtube-nocookie.com` の iframe（sandbox つき）に入れる。
- リンクは `rel="noopener noreferrer nofollow ugc"`、画像は `referrerpolicy="no-referrer"`。
- CSP（`index.html` の meta）で、スクリプトは自サイトと kaikomziu.github.io だけ、通信は Supabase だけ、iframe は youtube-nocookie だけに制限。
- 編集は書いた本人だけ。削除は本人（完全削除）と管理者（非表示）。コメント削除は本人・記事の作者・管理者。

## テスト
ローカル: `python -m http.server 8812`（プレビュー名 `gamepita`）。テスト用アカウントは `e2e_gp_` で始め、終わったら
`delete from ka_accounts where username like 'e2e\_gp\_%'` で消す（gp_* は連鎖して消える）。

## 更新するとき
バージョンを上げる（`index.html` のフッター `.ver` と `?v=`、`app.js` の VERSION、この README の見出し）。
