-- GamePita v1.2.0 の追加（マイグレーション gamepita_v1_2）
-- ゲームごとのまとめ・似ている記事・遊んだ/気になる・書いた人のバッジ・通知

-- ========== テーブル ==========
-- ゲーム（同じゲームの記事をまとめるため。norm は表記ゆれを吸収したキー）
create table public.gp_games (
  id bigint generated always as identity primary key,
  name text not null,
  norm text not null unique,
  created_at timestamptz not null default now()
);
alter table public.gp_posts add column game_id bigint references public.gp_games(id);
create index gp_posts_game_idx on public.gp_posts (game_id);

-- サイトごとのユーザー情報（公認ライター・通知を見た時刻）
create table public.gp_users (
  ka_id uuid primary key references public.ka_accounts(id) on delete cascade,
  official boolean not null default false,
  notif_seen_at timestamptz not null default 'epoch'
);

-- 遊んだ！・気になる（ゲーム単位。本人だけが見られる）
create table public.gp_marks (
  ka_id uuid not null references public.ka_accounts(id) on delete cascade,
  game_id bigint not null references public.gp_games(id) on delete cascade,
  status text not null check (status in ('want', 'playing', 'done')),
  updated_at timestamptz not null default now(),
  primary key (ka_id, game_id)
);
create index gp_marks_game_idx on public.gp_marks (game_id);
create index gp_likes_post_idx on public.gp_likes (post_id, created_at);

alter table public.gp_games enable row level security;
alter table public.gp_users enable row level security;
alter table public.gp_marks enable row level security;
revoke all on public.gp_games, public.gp_users, public.gp_marks from anon, authenticated, public;

-- ========== 内部用 ==========
-- ゲーム名の表記ゆれを吸収（全角半角・大文字小文字・空白・記号）
create or replace function public._gp_norm(t text) returns text language sql immutable set search_path = '' as $$
  select lower(regexp_replace(normalize(coalesce(t, ''), NFKC),
    '[[:space:][:punct:]・：！？。、「」『』【】（）〜～]', '', 'g'))
$$;

create or replace function public._gp_game_for(p_name text) returns bigint language plpgsql
  security definer set search_path = 'public' as $$
declare n text := public._gp_norm(p_name); gid bigint;
begin
  if n = '' then n := lower(btrim(coalesce(p_name, ''))); end if;
  insert into public.gp_games (name, norm) values (btrim(p_name), n)
  on conflict (norm) do nothing returning id into gid;
  if gid is null then select id into gid from public.gp_games where norm = n; end if;
  return gid;
end $$;

-- 記事のゲーム名が決まったら、ゲームにひもづける
create or replace function public._gp_post_game() returns trigger language plpgsql
  security definer set search_path = 'public' as $$
begin
  new.game_id := public._gp_game_for(new.game);
  return new;
end $$;
create trigger gp_posts_game before insert or update of game on public.gp_posts
  for each row execute function public._gp_post_game();

-- 書いた人のバッジ（記事数・もらったピタっと！・コメント数・公認）
create or replace function public._gp_badges(p_ka uuid) returns jsonb language sql stable
  security definer set search_path = 'public' as $$
  with s as (
    select (select count(*) from public.gp_posts where ka_id = p_ka and status = 'public') as posts,
           (select count(*) from public.gp_likes l join public.gp_posts p on p.id = l.post_id
             where p.ka_id = p_ka and p.status = 'public' and l.ka_id <> p_ka) as likes,
           (select count(*) from public.gp_comments where ka_id = p_ka) as comments,
           coalesce((select official from public.gp_users where ka_id = p_ka), false) as official)
  select coalesce(jsonb_agg(v.b order by v.o) filter (where v.b is not null), '[]'::jsonb)
  from s, lateral (values
    (1, case when s.official then jsonb_build_object('e', '👑', 't', '公認ライター') end),
    (2, case when s.posts >= 30 then jsonb_build_object('e', '🏆', 't', 'レジェンドライター（記事30本）')
             when s.posts >= 10 then jsonb_build_object('e', '📚', 't', 'ベテランライター（記事10本）')
             when s.posts >= 5 then jsonb_build_object('e', '📝', 't', 'ライター（記事5本）')
             when s.posts >= 1 then jsonb_build_object('e', '✏️', 't', 'はじめての記事') end),
    (3, case when s.likes >= 100 then jsonb_build_object('e', '🌟', 't', 'ピタっと！100')
             when s.likes >= 50 then jsonb_build_object('e', '💎', 't', 'ピタっと！50')
             when s.likes >= 10 then jsonb_build_object('e', '🧩', 't', 'ピタっと！10') end),
    (4, case when s.comments >= 10 then jsonb_build_object('e', '💬', 't', 'おしゃべり（コメント10）') end)
  ) as v(o, b)
$$;

-- 一覧用のカード（game_id を追加）
create or replace function public._gp_card(p public.gp_posts) returns jsonb language sql stable
  security definer set search_path = 'public' as $$
  select jsonb_build_object(
    'id', p.id, 'title', p.title, 'game', p.game, 'game_id', p.game_id, 'genre', p.genre, 'tags', p.tags,
    'platforms', p.platforms, 'rating', p.rating, 'cover_url', p.cover_url,
    'excerpt', left(regexp_replace(regexp_replace(p.body, '\|\|.+?\|\|', '（ネタバレ）', 'g'), '\s+', ' ', 'g'), 120),
    'created_at', p.created_at, 'author', public._gp_author(p.ka_id),
    'likes', (select count(*) from public.gp_likes l where l.post_id = p.id),
    'comments', (select count(*) from public.gp_comments c where c.post_id = p.id))
$$;

revoke all on function public._gp_norm(text), public._gp_game_for(text), public._gp_post_game(),
  public._gp_badges(uuid) from public, anon, authenticated;

-- ========== 公開 RPC（作り直し） ==========
-- 記事1件（ゲーム名・書いた人のバッジ・自分のマークを追加）
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
      'game_name', (select name from public.gp_games where id = p.game_id),
      'author_badges', public._gp_badges(p.ka_id),
      'my_mark', case when a.id is null then null else (select status from public.gp_marks where ka_id = a.id and game_id = p.game_id) end,
      'mine', a.id is not null and a.id = p.ka_id,
      'liked', a.id is not null and exists (select 1 from public.gp_likes l where l.post_id = p.id and l.ka_id = a.id)),
    'is_admin', adm,
    'comments', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'body', c.body, 'created_at', c.created_at, 'author', public._gp_author(c.ka_id),
        'can_delete', a.id is not null and (c.ka_id = a.id or p.ka_id = a.id or adm))
      order by c.created_at)
      from (select * from public.gp_comments where post_id = p.id order by created_at desc limit 300) c), '[]'::jsonb));
end $$;

-- 書いた人のプロフィール（バッジを追加）
create or replace function public.gp_profile(p_username text) returns jsonb language plpgsql
  security definer set search_path = 'public', 'extensions' as $$
declare a public.ka_accounts;
begin
  select * into a from public.ka_accounts where username = p_username;
  if a.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  return jsonb_build_object('ok', true, 'author', public._gp_author(a.id), 'since', a.created_at,
    'badges', public._gp_badges(a.id),
    'posts', (select count(*) from public.gp_posts where ka_id = a.id and status = 'public'),
    'likes', (select count(*) from public.gp_likes l join public.gp_posts p on p.id = l.post_id
              where p.ka_id = a.id and p.status = 'public'));
end $$;

-- 静的ページ用の書き出し（ゲーム・バッジを追加）
create or replace function public.gp_export() returns jsonb language sql stable
  security definer set search_path = 'public' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'title', p.title, 'game', p.game, 'game_id', p.game_id,
    'game_name', (select name from public.gp_games g where g.id = p.game_id),
    'genre', p.genre, 'tags', p.tags, 'platforms', p.platforms,
    'players', p.players, 'length', p.length, 'difficulty', p.difficulty, 'price', p.price,
    'rating', p.rating, 'body', p.body, 'cover_url', p.cover_url, 'official_url', p.official_url,
    'created_at', p.created_at, 'updated_at', p.updated_at,
    'author', public._gp_author(p.ka_id), 'author_badges', public._gp_badges(p.ka_id),
    'likes', (select count(*) from public.gp_likes l where l.post_id = p.id))
    order by p.id desc), '[]'::jsonb)
  from (select * from public.gp_posts where status = 'public' order by id desc limit 5000) p
$$;

-- ========== 公開 RPC（新規） ==========
-- ゲームのまとめページ
create or replace function public.gp_game(p_token text, p_id bigint) returns jsonb language plpgsql
  security definer set search_path = 'public', 'extensions' as $$
declare a public.ka_accounts; g public.gp_games;
begin
  a := public._ka_from_token(p_token);
  select * into g from public.gp_games where id = p_id;
  if g.id is null or not exists (select 1 from public.gp_posts where game_id = g.id and status = 'public') then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  return jsonb_build_object('ok', true,
    'game', jsonb_build_object('id', g.id, 'name', g.name),
    'count', (select count(*) from public.gp_posts where game_id = g.id and status = 'public'),
    'avg', (select round(avg(rating)::numeric, 1) from public.gp_posts where game_id = g.id and status = 'public'),
    'platforms', (select coalesce(jsonb_agg(distinct x), '[]'::jsonb) from public.gp_posts p, unnest(p.platforms) x
                  where p.game_id = g.id and p.status = 'public'),
    'genres', (select coalesce(jsonb_agg(distinct genre), '[]'::jsonb) from public.gp_posts where game_id = g.id and status = 'public'),
    'marks', (select jsonb_build_object(
        'want', count(*) filter (where status = 'want'),
        'playing', count(*) filter (where status = 'playing'),
        'done', count(*) filter (where status = 'done')) from public.gp_marks where game_id = g.id),
    'my_mark', case when a.id is null then null else (select status from public.gp_marks where ka_id = a.id and game_id = g.id) end,
    'posts', (select coalesce(jsonb_agg(s.c order by s.id desc), '[]'::jsonb) from (
        select public._gp_card(p) as c, p.id from public.gp_posts p
        where p.game_id = g.id and p.status = 'public' order by p.id desc limit 50) s));
end $$;

-- ゲーム名の候補（記事を書くときの入力補助）
create or replace function public.gp_game_suggest(p_q text) returns jsonb language plpgsql
  security definer set search_path = 'public', 'extensions' as $$
declare q text := left(btrim(coalesce(p_q, '')), 40); pat text;
begin
  if q = '' then return '[]'::jsonb; end if;
  pat := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return coalesce((select jsonb_agg(s.name order by s.n desc, s.name) from (
    select g.name, count(p.id) as n from public.gp_games g
    join public.gp_posts p on p.game_id = g.id and p.status = 'public'
    where g.name ilike pat or g.norm like '%' || public._gp_norm(q) || '%'
    group by g.id, g.name order by count(p.id) desc, g.name limit 8) s), '[]'::jsonb);
end $$;

-- 似ている記事（同じゲーム・ジャンル・遊び方・時間・難しさ・機種・タグが近い順）
create or replace function public.gp_similar(p_id bigint) returns jsonb language sql stable
  security definer set search_path = 'public' as $$
  select coalesce(jsonb_agg(s.c order by s.score desc, s.id desc), '[]'::jsonb) from (
    select public._gp_card(q) as c, q.id,
      (case when q.game_id = b.game_id then 4 else 0 end
     + case when q.genre = b.genre then 3 else 0 end
     + case when q.players = b.players or 'both' in (q.players, b.players) then 1 else 0 end
     + case when q.length = b.length or 'both' in (q.length, b.length) then 1 else 0 end
     + case when q.difficulty = b.difficulty then 1 else 0 end
     + case when q.platforms && b.platforms then 1 else 0 end
     + least(2, cardinality(array(select unnest(q.tags) intersect select unnest(b.tags))))) as score
    from public.gp_posts b join public.gp_posts q on q.id <> b.id and q.status = 'public'
    where b.id = p_id and b.status = 'public'
    order by score desc, q.id desc limit 4) s
  where s.score >= 3
$$;

-- 遊んだ！・気になる（status: want / playing / done、null で外す）
create or replace function public.gp_mark_set(p_token text, p_game_id bigint, p_status text) returns jsonb language plpgsql
  security definer set search_path = 'public', 'extensions' as $$
declare a public.ka_accounts;
begin
  a := public._ka_from_token(p_token);
  if a.id is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if not exists (select 1 from public.gp_games where id = p_game_id) then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if p_status is null then
    delete from public.gp_marks where ka_id = a.id and game_id = p_game_id;
  elsif p_status in ('want', 'playing', 'done') then
    if (select count(*) from public.gp_marks where ka_id = a.id) >= 2000
       and not exists (select 1 from public.gp_marks where ka_id = a.id and game_id = p_game_id) then
      return jsonb_build_object('ok', false, 'reason', 'too_many');
    end if;
    insert into public.gp_marks (ka_id, game_id, status) values (a.id, p_game_id, p_status)
    on conflict (ka_id, game_id) do update set status = excluded.status, updated_at = now();
  else
    return jsonb_build_object('ok', false, 'reason', 'bad');
  end if;
  return jsonb_build_object('ok', true, 'status', p_status);
end $$;

-- 自分のマイリスト
create or replace function public.gp_my_marks(p_token text) returns jsonb language plpgsql
  security definer set search_path = 'public', 'extensions' as $$
declare a public.ka_accounts;
begin
  a := public._ka_from_token(p_token);
  if a.id is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  return jsonb_build_object('ok', true, 'items', coalesce((select jsonb_agg(jsonb_build_object(
      'game_id', g.id, 'name', g.name, 'status', m.status, 'updated_at', m.updated_at,
      'count', (select count(*) from public.gp_posts where game_id = g.id and status = 'public'),
      'avg', (select round(avg(rating)::numeric, 1) from public.gp_posts where game_id = g.id and status = 'public'),
      'genre', (select genre from public.gp_posts where game_id = g.id and status = 'public' order by id desc limit 1),
      'cover_url', (select cover_url from public.gp_posts where game_id = g.id and status = 'public' and cover_url is not null order by id desc limit 1))
    order by m.updated_at desc)
    from public.gp_marks m join public.gp_games g on g.id = m.game_id where m.ka_id = a.id), '[]'::jsonb));
end $$;

-- 通知（自分の記事についたコメント・ピタっと！。60日以内の新しい順30件）
create or replace function public.gp_notifs(p_token text) returns jsonb language plpgsql
  security definer set search_path = 'public', 'extensions' as $$
declare a public.ka_accounts; seen timestamptz;
begin
  a := public._ka_from_token(p_token);
  if a.id is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  seen := coalesce((select notif_seen_at from public.gp_users where ka_id = a.id), 'epoch'::timestamptz);
  return (with ev as (
      select 'comment' as kind, c.post_id, c.ka_id as who, left(c.body, 80) as body, c.created_at as at
      from public.gp_comments c join public.gp_posts p on p.id = c.post_id
      where p.ka_id = a.id and c.ka_id <> a.id and c.created_at > now() - interval '60 days'
      union all
      select 'like', l.post_id, l.ka_id, null, l.created_at
      from public.gp_likes l join public.gp_posts p on p.id = l.post_id
      where p.ka_id = a.id and l.ka_id <> a.id and l.created_at > now() - interval '60 days'
    )
    select jsonb_build_object('ok', true,
      'unread', (select count(*) from ev where ev.at > seen),
      'items', coalesce((select jsonb_agg(jsonb_build_object(
          'kind', e.kind, 'post_id', e.post_id, 'post_title', (select title from public.gp_posts where id = e.post_id),
          'who', public._gp_author(e.who), 'body', e.body, 'at', e.at, 'unread', e.at > seen) order by e.at desc)
        from (select * from ev order by at desc limit 30) e), '[]'::jsonb)));
end $$;

create or replace function public.gp_notif_seen(p_token text) returns jsonb language plpgsql
  security definer set search_path = 'public', 'extensions' as $$
declare a public.ka_accounts;
begin
  a := public._ka_from_token(p_token);
  if a.id is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  insert into public.gp_users (ka_id, notif_seen_at) values (a.id, now())
  on conflict (ka_id) do update set notif_seen_at = now();
  return jsonb_build_object('ok', true);
end $$;

-- 管理者: 公認ライター
create or replace function public.gp_admin_set_official(p_token text, p_username text, p_on boolean) returns jsonb language plpgsql
  security definer set search_path = 'public', 'extensions' as $$
declare a public.ka_accounts; t uuid;
begin
  a := public._ka_from_token(p_token);
  if not coalesce(a.is_admin, false) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  select id into t from public.ka_accounts where username = p_username;
  if t is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  insert into public.gp_users (ka_id, official) values (t, coalesce(p_on, false))
  on conflict (ka_id) do update set official = excluded.official;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.gp_admin_writers(p_token text) returns jsonb language plpgsql
  security definer set search_path = 'public', 'extensions' as $$
declare a public.ka_accounts;
begin
  a := public._ka_from_token(p_token);
  if not coalesce(a.is_admin, false) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  return jsonb_build_object('ok', true, 'writers', coalesce((select jsonb_agg(public._gp_author(u.ka_id))
    from public.gp_users u where u.official), '[]'::jsonb));
end $$;

revoke all on function public.gp_game(text, bigint), public.gp_game_suggest(text), public.gp_similar(bigint),
  public.gp_mark_set(text, bigint, text), public.gp_my_marks(text), public.gp_notifs(text), public.gp_notif_seen(text),
  public.gp_admin_set_official(text, text, boolean), public.gp_admin_writers(text) from public;
grant execute on function public.gp_game(text, bigint), public.gp_game_suggest(text), public.gp_similar(bigint),
  public.gp_mark_set(text, bigint, text), public.gp_my_marks(text), public.gp_notifs(text), public.gp_notif_seen(text),
  public.gp_admin_set_official(text, text, boolean), public.gp_admin_writers(text) to anon, authenticated;

-- v1.2.0 より前の記事をゲームにひもづける（マイグレーション gamepita_backfill_game_id）
update public.gp_posts set game_id = public._gp_game_for(game) where game_id is null;
