-- GamePita（ゲーム紹介記事サイト）のDB
-- 共有 Supabase kifnzvktwbomxthzvvgy、マイグレーション名 gamepita_site
-- テーブルは RLS 有効＋権限なし（直接は読み書きできない）。操作はすべて SECURITY DEFINER の RPC 経由。
-- ログインはかるわかGAMESアカウント（_ka_from_token でトークンを確かめる）。

-- ========== テーブル ==========
create table public.gp_posts (
  id bigint generated always as identity primary key,
  ka_id uuid not null references public.ka_accounts(id) on delete cascade,
  title text not null,
  game text not null,
  genre text not null,
  tags text[] not null default '{}',
  platforms text[] not null default '{}',
  players text not null,      -- solo / multi / both
  length text not null,       -- short / long / both
  difficulty text not null,   -- easy / normal / hard
  price text not null,        -- free / paid
  rating smallint not null check (rating between 1 and 5),
  body text not null,
  cover_url text,
  official_url text,
  status text not null default 'public' check (status in ('public', 'removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index gp_posts_list_idx on public.gp_posts (status, created_at desc);
create index gp_posts_ka_idx on public.gp_posts (ka_id);
create index gp_posts_tags_idx on public.gp_posts using gin (tags);

create table public.gp_likes (
  post_id bigint not null references public.gp_posts(id) on delete cascade,
  ka_id uuid not null references public.ka_accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, ka_id)
);
create index gp_likes_ka_idx on public.gp_likes (ka_id);

create table public.gp_comments (
  id bigint generated always as identity primary key,
  post_id bigint not null references public.gp_posts(id) on delete cascade,
  ka_id uuid not null references public.ka_accounts(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);
create index gp_comments_post_idx on public.gp_comments (post_id, created_at);
create index gp_comments_ka_idx on public.gp_comments (ka_id, created_at);

create table public.gp_reports (
  id bigint generated always as identity primary key,
  target text not null check (target in ('post', 'comment')),
  target_id bigint not null,
  ka_id uuid not null references public.ka_accounts(id) on delete cascade,
  reason text not null,
  created_at timestamptz not null default now(),
  unique (target, target_id, ka_id)
);
create index gp_reports_ka_idx on public.gp_reports (ka_id, created_at);

alter table public.gp_posts enable row level security;
alter table public.gp_likes enable row level security;
alter table public.gp_comments enable row level security;
alter table public.gp_reports enable row level security;
revoke all on public.gp_posts, public.gp_likes, public.gp_comments, public.gp_reports from anon, authenticated, public;

-- ========== 内部用の小物 ==========
create or replace function public._gp_genres() returns text[] language sql immutable set search_path = '' as $$
  select array['アクション','RPG','シューティング','パズル','アドベンチャー','シミュレーション','ストラテジー',
               'スポーツ','レース','音楽・リズム','ホラー','サンドボックス','カード・ボード','格闘','その他']
$$;
create or replace function public._gp_platforms() returns text[] language sql immutable set search_path = '' as $$
  select array['PC','Switch','PlayStation','Xbox','スマホ','ブラウザ','その他']
$$;

-- https の URL だけ許可（空白・引用符・山かっこ・バックスラッシュなし、500文字まで）
create or replace function public._gp_url_ok(t text) returns boolean language sql immutable set search_path = '' as $$
  select t is not null and char_length(t) <= 500
     and t ~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[^[:space:]<>"''`\\]*)?$'
$$;

create or replace function public._gp_author(p_ka uuid) returns jsonb language sql stable
  security definer set search_path = 'public' as $$
  select jsonb_build_object('username', a.username, 'display_name', a.display_name, 'avatar', a.avatar)
  from public.ka_accounts a where a.id = p_ka
$$;

-- 一覧用のカード
create or replace function public._gp_card(p public.gp_posts) returns jsonb language sql stable
  security definer set search_path = 'public' as $$
  select jsonb_build_object(
    'id', p.id, 'title', p.title, 'game', p.game, 'genre', p.genre, 'tags', p.tags,
    'platforms', p.platforms, 'rating', p.rating, 'cover_url', p.cover_url,
    'excerpt', left(regexp_replace(p.body, '\s+', ' ', 'g'), 120),
    'created_at', p.created_at, 'author', public._gp_author(p.ka_id),
    'likes', (select count(*) from public.gp_likes l where l.post_id = p.id),
    'comments', (select count(*) from public.gp_comments c where c.post_id = p.id))
$$;

revoke all on function public._gp_genres(), public._gp_platforms(), public._gp_url_ok(text),
  public._gp_author(uuid), public._gp_card(public.gp_posts) from public, anon, authenticated;

-- ========== 公開 RPC ==========

-- 自分の情報
create or replace function public.gp_me(p_token text) returns jsonb language plpgsql
  security definer set search_path = 'public', 'extensions' as $$
declare a public.ka_accounts;
begin
  a := public._ka_from_token(p_token);
  if a.id is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  return jsonb_build_object('ok', true, 'username', a.username, 'display_name', a.display_name,
    'avatar', a.avatar, 'is_admin', coalesce(a.is_admin, false));
end $$;

-- 記事の一覧（検索・ジャンル・タグ・書いた人・並べ替え）
create or replace function public.gp_list(p_q text default null, p_genre text default null, p_tag text default null,
  p_author text default null, p_sort text default 'new', p_offset int default 0) returns jsonb language plpgsql
  security definer set search_path = 'public', 'extensions' as $$
declare q text := btrim(coalesce(p_q, '')); pat text; off int := greatest(0, least(coalesce(p_offset, 0), 5000));
  items jsonb; total int;
begin
  if char_length(q) > 50 then q := left(q, 50); end if;
  -- LIKE の特殊文字を無効にする
  pat := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  select coalesce(jsonb_agg(public._gp_card(s.p) order by s.rn), '[]'::jsonb), count(*)
    into items, total
  from (
    select x.p, row_number() over (
      order by case when p_sort = 'popular' then x.lk end desc nulls last,
               case when p_sort = 'rating' then (x.p).rating end desc nulls last,
               (x.p).created_at desc, (x.p).id desc) as rn
    from (
      select p, (select count(*) from public.gp_likes l where l.post_id = p.id) as lk
      from public.gp_posts p
      left join public.ka_accounts a on a.id = p.ka_id
      where p.status = 'public'
        and (q = '' or p.title ilike pat or p.game ilike pat or p.body ilike pat
             or exists (select 1 from unnest(p.tags) t where t ilike pat))
        and (p_genre is null or p_genre = '' or p.genre = p_genre)
        and (p_tag is null or p_tag = '' or p.tags @> array[p_tag])
        and (p_author is null or p_author = '' or a.username = p_author)
    ) x
  ) s
  where s.rn > off and s.rn <= off + 25;
  return jsonb_build_object('ok', true,
    'items', case when total > 24 then items - 24 else items end,
    'more', total > 24);
end $$;

-- 記事1件（コメントつき）
create or replace function public.gp_get(p_token text, p_id bigint) returns jsonb language plpgsql
  security definer set search_path = 'public', 'extensions' as $$
declare a public.ka_accounts; p public.gp_posts; adm boolean;
begin
  a := public._ka_from_token(p_token);
  adm := coalesce(a.is_admin, false);
  select * into p from public.gp_posts where id = p_id;
  if p.id is null or (p.status <> 'public' and not adm) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  return jsonb_build_object('ok', true, 'post', public._gp_card(p) || jsonb_build_object(
      'body', p.body, 'official_url', p.official_url, 'players', p.players, 'length', p.length,
      'difficulty', p.difficulty, 'price', p.price, 'status', p.status, 'updated_at', p.updated_at,
      'mine', a.id is not null and a.id = p.ka_id,
      'liked', a.id is not null and exists (select 1 from public.gp_likes l where l.post_id = p.id and l.ka_id = a.id)),
    'is_admin', adm,
    'comments', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'body', c.body, 'created_at', c.created_at, 'author', public._gp_author(c.ka_id),
        'can_delete', a.id is not null and (c.ka_id = a.id or p.ka_id = a.id or adm))
      order by c.created_at)
      from (select * from public.gp_comments where post_id = p.id order by created_at desc limit 300) c), '[]'::jsonb));
end $$;

-- 記事を書く／直す（p_id が null なら新規）
create or replace function public.gp_post_save(p_token text, p_id bigint, p_data jsonb) returns jsonb language plpgsql
  security definer set search_path = 'public', 'extensions' as $$
declare a public.ka_accounts; d jsonb := coalesce(p_data, '{}'::jsonb);
  v_title text; v_game text; v_genre text; v_tags text[]; v_plats text[]; v_players text; v_length text;
  v_diff text; v_price text; v_rating int; v_body text; v_cover text; v_official text; v_id bigint; owner uuid;
begin
  a := public._ka_from_token(p_token);
  if a.id is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if jsonb_typeof(d) <> 'object' then return jsonb_build_object('ok', false, 'reason', 'bad'); end if;

  v_title := btrim(coalesce(d->>'title', ''));
  v_game := btrim(coalesce(d->>'game', ''));
  v_genre := coalesce(d->>'genre', '');
  v_players := coalesce(d->>'players', '');
  v_length := coalesce(d->>'length', '');
  v_diff := coalesce(d->>'difficulty', '');
  v_price := coalesce(d->>'price', '');
  v_body := btrim(coalesce(d->>'body', ''));
  v_cover := nullif(btrim(coalesce(d->>'cover_url', '')), '');
  v_official := nullif(btrim(coalesce(d->>'official_url', '')), '');
  begin v_rating := (d->>'rating')::int; exception when others then v_rating := null; end;

  if char_length(v_title) not between 1 and 60 then return jsonb_build_object('ok', false, 'reason', 'title'); end if;
  if char_length(v_game) not between 1 and 60 then return jsonb_build_object('ok', false, 'reason', 'game'); end if;
  if not (v_genre = any(public._gp_genres())) then return jsonb_build_object('ok', false, 'reason', 'genre'); end if;
  if v_players not in ('solo', 'multi', 'both') or v_length not in ('short', 'long', 'both')
     or v_diff not in ('easy', 'normal', 'hard') or v_price not in ('free', 'paid') then
    return jsonb_build_object('ok', false, 'reason', 'attrs');
  end if;
  if v_rating is null or v_rating not between 1 and 5 then return jsonb_build_object('ok', false, 'reason', 'rating'); end if;
  if char_length(v_body) not between 1 and 8000 then return jsonb_build_object('ok', false, 'reason', 'body'); end if;
  if v_cover is not null and not public._gp_url_ok(v_cover) then return jsonb_build_object('ok', false, 'reason', 'url'); end if;
  if v_official is not null and not public._gp_url_ok(v_official) then return jsonb_build_object('ok', false, 'reason', 'url'); end if;

  -- タグ: 前後の空白と # を取り、重複を除いて最大5個・各1〜20文字
  if d ? 'tags' and jsonb_typeof(d->'tags') <> 'array' then
    return jsonb_build_object('ok', false, 'reason', 'tags');
  end if;
  select coalesce(array_agg(t order by ord), '{}') into v_tags from (
    select distinct on (t) t, ord from (
      select btrim(regexp_replace(x, '^[#＃]+', '')) as t, ord
      from jsonb_array_elements_text(coalesce(d->'tags', '[]'::jsonb)) with ordinality as e(x, ord)) s
    where t <> '' order by t, ord) u;
  if array_length(v_tags, 1) > 5 or exists (select 1 from unnest(v_tags) t where char_length(t) > 20 or t ~ '[[:space:]<>]') then
    return jsonb_build_object('ok', false, 'reason', 'tags');
  end if;

  -- 機種: 決まった中から1つ以上
  if jsonb_typeof(d->'platforms') is distinct from 'array' then return jsonb_build_object('ok', false, 'reason', 'platforms'); end if;
  select coalesce(array_agg(distinct x), '{}') into v_plats from jsonb_array_elements_text(d->'platforms') x;
  if cardinality(v_plats) < 1 or not (v_plats <@ public._gp_platforms()) then
    return jsonb_build_object('ok', false, 'reason', 'platforms');
  end if;

  if p_id is null then
    if (select count(*) from public.gp_posts where ka_id = a.id and created_at > now() - interval '1 day') >= 10 then
      return jsonb_build_object('ok', false, 'reason', 'too_many_today');
    end if;
    insert into public.gp_posts (ka_id, title, game, genre, tags, platforms, players, length, difficulty, price,
      rating, body, cover_url, official_url)
    values (a.id, v_title, v_game, v_genre, v_tags, v_plats, v_players, v_length, v_diff, v_price,
      v_rating, v_body, v_cover, v_official)
    returning id into v_id;
  else
    select ka_id into owner from public.gp_posts where id = p_id and status = 'public';
    if owner is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
    if owner <> a.id then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
    update public.gp_posts set title = v_title, game = v_game, genre = v_genre, tags = v_tags, platforms = v_plats,
      players = v_players, length = v_length, difficulty = v_diff, price = v_price, rating = v_rating,
      body = v_body, cover_url = v_cover, official_url = v_official, updated_at = now()
    where id = p_id;
    v_id := p_id;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- 記事を消す（書いた人は完全に削除、管理者は非表示にする）
create or replace function public.gp_post_delete(p_token text, p_id bigint) returns jsonb language plpgsql
  security definer set search_path = 'public', 'extensions' as $$
declare a public.ka_accounts; owner uuid;
begin
  a := public._ka_from_token(p_token);
  if a.id is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  select ka_id into owner from public.gp_posts where id = p_id;
  if owner is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if owner = a.id then
    delete from public.gp_posts where id = p_id;
    delete from public.gp_reports where target = 'post' and target_id = p_id;
  elsif coalesce(a.is_admin, false) then
    update public.gp_posts set status = 'removed' where id = p_id;
    delete from public.gp_reports where target = 'post' and target_id = p_id;
  else
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ピタっと！（いいね）の切りかえ
create or replace function public.gp_like_toggle(p_token text, p_id bigint) returns jsonb language plpgsql
  security definer set search_path = 'public', 'extensions' as $$
declare a public.ka_accounts; now_liked boolean;
begin
  a := public._ka_from_token(p_token);
  if a.id is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if not exists (select 1 from public.gp_posts where id = p_id and status = 'public') then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  delete from public.gp_likes where post_id = p_id and ka_id = a.id;
  if found then now_liked := false;
  else
    insert into public.gp_likes (post_id, ka_id) values (p_id, a.id) on conflict do nothing;
    now_liked := true;
  end if;
  return jsonb_build_object('ok', true, 'liked', now_liked,
    'likes', (select count(*) from public.gp_likes where post_id = p_id));
end $$;

-- コメントを書く
create or replace function public.gp_comment_add(p_token text, p_id bigint, p_body text) returns jsonb language plpgsql
  security definer set search_path = 'public', 'extensions' as $$
declare a public.ka_accounts; b text := btrim(coalesce(p_body, ''));
begin
  a := public._ka_from_token(p_token);
  if a.id is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if char_length(b) not between 1 and 500 then return jsonb_build_object('ok', false, 'reason', 'comment'); end if;
  if not exists (select 1 from public.gp_posts where id = p_id and status = 'public') then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if (select count(*) from public.gp_comments where ka_id = a.id and created_at > now() - interval '1 hour') >= 30 then
    return jsonb_build_object('ok', false, 'reason', 'too_many');
  end if;
  insert into public.gp_comments (post_id, ka_id, body) values (p_id, a.id, b);
  return jsonb_build_object('ok', true);
end $$;

-- コメントを消す（書いた人・記事を書いた人・管理者）
create or replace function public.gp_comment_delete(p_token text, p_cid bigint) returns jsonb language plpgsql
  security definer set search_path = 'public', 'extensions' as $$
declare a public.ka_accounts; c public.gp_comments; post_owner uuid;
begin
  a := public._ka_from_token(p_token);
  if a.id is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  select * into c from public.gp_comments where id = p_cid;
  if c.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select ka_id into post_owner from public.gp_posts where id = c.post_id;
  if not (c.ka_id = a.id or post_owner = a.id or coalesce(a.is_admin, false)) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  delete from public.gp_comments where id = p_cid;
  delete from public.gp_reports where target = 'comment' and target_id = p_cid;
  return jsonb_build_object('ok', true);
end $$;

-- 通報
create or replace function public.gp_report(p_token text, p_target text, p_id bigint, p_reason text) returns jsonb language plpgsql
  security definer set search_path = 'public', 'extensions' as $$
declare a public.ka_accounts; r text := btrim(coalesce(p_reason, ''));
begin
  a := public._ka_from_token(p_token);
  if a.id is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if p_target not in ('post', 'comment') then return jsonb_build_object('ok', false, 'reason', 'bad'); end if;
  if char_length(r) not between 1 and 200 then return jsonb_build_object('ok', false, 'reason', 'reason'); end if;
  if (p_target = 'post' and not exists (select 1 from public.gp_posts where id = p_id and status = 'public'))
     or (p_target = 'comment' and not exists (select 1 from public.gp_comments where id = p_id)) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if (select count(*) from public.gp_reports where ka_id = a.id and created_at > now() - interval '1 day') >= 20 then
    return jsonb_build_object('ok', false, 'reason', 'too_many');
  end if;
  insert into public.gp_reports (target, target_id, ka_id, reason) values (p_target, p_id, a.id, r)
  on conflict (target, target_id, ka_id) do update set reason = excluded.reason, created_at = now();
  return jsonb_build_object('ok', true);
end $$;

-- 管理者: 通報の一覧
create or replace function public.gp_admin_reports(p_token text) returns jsonb language plpgsql
  security definer set search_path = 'public', 'extensions' as $$
declare a public.ka_accounts;
begin
  a := public._ka_from_token(p_token);
  if not coalesce(a.is_admin, false) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  return jsonb_build_object('ok', true, 'reports', coalesce((select jsonb_agg(jsonb_build_object(
      'id', r.id, 'target', r.target, 'target_id', r.target_id, 'reason', r.reason, 'created_at', r.created_at,
      'reporter', public._gp_author(r.ka_id),
      'post_id', case when r.target = 'post' then r.target_id else (select post_id from public.gp_comments where id = r.target_id) end,
      'text', case when r.target = 'post' then (select title from public.gp_posts where id = r.target_id)
                   else (select left(body, 100) from public.gp_comments where id = r.target_id) end)
    order by r.created_at desc) from public.gp_reports r), '[]'::jsonb));
end $$;

-- 管理者: 通報を片づける（何もしない）
create or replace function public.gp_admin_dismiss(p_token text, p_report_id bigint) returns jsonb language plpgsql
  security definer set search_path = 'public', 'extensions' as $$
declare a public.ka_accounts;
begin
  a := public._ka_from_token(p_token);
  if not coalesce(a.is_admin, false) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  delete from public.gp_reports where id = p_report_id;
  return jsonb_build_object('ok', true);
end $$;

-- よく使われているタグ
create or replace function public.gp_tags() returns jsonb language sql stable
  security definer set search_path = 'public' as $$
  select coalesce(jsonb_agg(jsonb_build_object('tag', t, 'n', n) order by n desc, t), '[]'::jsonb)
  from (select t, count(*) n from public.gp_posts p, unnest(p.tags) t where p.status = 'public'
        group by t order by count(*) desc, t limit 30) s
$$;

-- 書いた人のプロフィール
create or replace function public.gp_profile(p_username text) returns jsonb language plpgsql
  security definer set search_path = 'public', 'extensions' as $$
declare a public.ka_accounts;
begin
  select * into a from public.ka_accounts where username = p_username;
  if a.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  return jsonb_build_object('ok', true, 'author', public._gp_author(a.id), 'since', a.created_at,
    'posts', (select count(*) from public.gp_posts where ka_id = a.id and status = 'public'),
    'likes', (select count(*) from public.gp_likes l join public.gp_posts p on p.id = l.post_id
              where p.ka_id = a.id and p.status = 'public'));
end $$;

-- ピタっと診断: 答えに合う記事を点数順に返す
-- p_answers: {genres:[...], players:'solo|multi|any', length:'short|long|any',
--             difficulty:'easy|normal|hard|any', platforms:[...], price:'free|any'}
create or replace function public.gp_diagnose(p_answers jsonb) returns jsonb language plpgsql
  security definer set search_path = 'public', 'extensions' as $$
declare ans jsonb := coalesce(p_answers, '{}'::jsonb); g text[]; pl text[];
  w_players text; w_length text; w_diff text; w_price text;
begin
  if jsonb_typeof(ans) <> 'object' then return jsonb_build_object('ok', false, 'reason', 'bad'); end if;
  select coalesce(array_agg(x), '{}') into g from (
    select x from jsonb_array_elements_text(case when jsonb_typeof(ans->'genres') = 'array' then ans->'genres' else '[]' end) x limit 20) s;
  select coalesce(array_agg(x), '{}') into pl from (
    select x from jsonb_array_elements_text(case when jsonb_typeof(ans->'platforms') = 'array' then ans->'platforms' else '[]' end) x limit 20) s;
  w_players := coalesce(ans->>'players', 'any');
  w_length := coalesce(ans->>'length', 'any');
  w_diff := coalesce(ans->>'difficulty', 'any');
  w_price := coalesce(ans->>'price', 'any');

  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(public._gp_card(top.p) || jsonb_build_object('score', top.score) order by top.score desc, (top.p).rating desc, top.lk desc)
    from (select s.* from (
      select q.p, q.lk,
        (case when cardinality(g) = 0 or q.genre = any(g) then 30 else 0 end
       + case when w_players = 'any' or q.players = 'both' or q.players = w_players then 20 else 0 end
       + case when w_length = 'any' or q.length = 'both' or q.length = w_length then 15 else 0 end
       + case when w_diff = 'any' or q.difficulty = w_diff then 15
              when (w_diff = 'normal' or q.difficulty = 'normal') then 7 else 0 end
       + case when cardinality(pl) = 0 or q.platforms && pl then 15 else 0 end
       + case when w_price = 'any' or q.price = w_price then 5 else 0 end) as score
      from (select pp as p, pp.genre, pp.players, pp.length, pp.difficulty, pp.platforms, pp.price,
                   (select count(*) from public.gp_likes l where l.post_id = pp.id) as lk
            from public.gp_posts pp where pp.status = 'public') q
    ) s
    where s.score >= 50
    order by s.score desc, (s.p).rating desc, s.lk desc
    limit 12) top), '[]'::jsonb));
end $$;

-- 実行権限: 公開 RPC だけ anon / authenticated に許可
revoke all on function public.gp_me(text), public.gp_list(text, text, text, text, text, int), public.gp_get(text, bigint),
  public.gp_post_save(text, bigint, jsonb), public.gp_post_delete(text, bigint), public.gp_like_toggle(text, bigint),
  public.gp_comment_add(text, bigint, text), public.gp_comment_delete(text, bigint), public.gp_report(text, text, bigint, text),
  public.gp_admin_reports(text), public.gp_admin_dismiss(text, bigint), public.gp_tags(), public.gp_profile(text),
  public.gp_diagnose(jsonb) from public;
grant execute on function public.gp_me(text), public.gp_list(text, text, text, text, text, int), public.gp_get(text, bigint),
  public.gp_post_save(text, bigint, jsonb), public.gp_post_delete(text, bigint), public.gp_like_toggle(text, bigint),
  public.gp_comment_add(text, bigint, text), public.gp_comment_delete(text, bigint), public.gp_report(text, text, bigint, text),
  public.gp_admin_reports(text), public.gp_admin_dismiss(text, bigint), public.gp_tags(), public.gp_profile(text),
  public.gp_diagnose(jsonb) to anon, authenticated;
