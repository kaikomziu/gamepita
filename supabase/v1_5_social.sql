-- GamePita v1.5.0（マイグレーション gamepita_social）
-- ほしいもの・あとで読む・フォロー・リアクション・アカウントの下書き・お題企画・ランキング・管理者への新着通知
-- テーブルは RLS 有効・ポリシーなし・権限なし。読み書きはすべて SECURITY DEFINER の RPC だけ。

-- ---------- テーブル ----------
create table public.gp_bookmarks (            -- あとで読む（記事・商品）
  ka_id uuid not null references public.ka_accounts(id) on delete cascade,
  target text not null check (target in ('post', 'goods')),
  target_id bigint not null,
  created_at timestamptz not null default now(),
  primary key (ka_id, target, target_id)
);
create index gp_bookmarks_target_idx on public.gp_bookmarks (target, target_id);

create table public.gp_goods_wants (          -- ほしいもの（商品）
  goods_id bigint not null references public.gp_goods(id) on delete cascade,
  ka_id uuid not null references public.ka_accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (goods_id, ka_id)
);
create index gp_goods_wants_ka_idx on public.gp_goods_wants (ka_id, created_at desc);

create table public.gp_follows (              -- フォロー
  follower uuid not null references public.ka_accounts(id) on delete cascade,
  followee uuid not null references public.ka_accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower, followee),
  check (follower <> followee)
);
create index gp_follows_followee_idx on public.gp_follows (followee, created_at desc);

create table public.gp_reactions (            -- リアクション（記事・商品）
  ka_id uuid not null references public.ka_accounts(id) on delete cascade,
  target text not null check (target in ('post', 'goods')),
  target_id bigint not null,
  kind text not null check (kind in ('funny', 'helpful', 'wantplay')),
  created_at timestamptz not null default now(),
  primary key (ka_id, target, target_id, kind)
);
create index gp_reactions_target_idx on public.gp_reactions (target, target_id);

create table public.gp_drafts (               -- アカウントに保存する下書き（記事・商品で1つずつ）
  ka_id uuid not null references public.ka_accounts(id) on delete cascade,
  kind text not null check (kind in ('post', 'goods')),
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (ka_id, kind)
);

create table public.gp_themes (               -- お題企画
  id bigint generated always as identity primary key,
  title text not null check (char_length(title) between 1 and 40),
  tag text not null check (char_length(tag) between 1 and 20 and tag !~ '[[:space:]<>#＃]'),
  description text check (description is null or char_length(description) <= 300),
  starts_on date not null,
  ends_on date not null,
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);
create index gp_themes_period_idx on public.gp_themes (starts_on desc);

alter table public.gp_bookmarks enable row level security;
alter table public.gp_goods_wants enable row level security;
alter table public.gp_follows enable row level security;
alter table public.gp_reactions enable row level security;
alter table public.gp_drafts enable row level security;
alter table public.gp_themes enable row level security;
revoke all on public.gp_bookmarks, public.gp_goods_wants, public.gp_follows, public.gp_reactions, public.gp_drafts, public.gp_themes
  from public, anon, authenticated;

-- 記事・商品が消えたら、あとで読む・リアクションも消す
create or replace function public._gp_cleanup_post() returns trigger language plpgsql security definer set search_path = 'public' as $$
begin
  delete from public.gp_bookmarks where target = 'post' and target_id = old.id;
  delete from public.gp_reactions where target = 'post' and target_id = old.id;
  return old;
end $$;
create or replace function public._gp_cleanup_goods() returns trigger language plpgsql security definer set search_path = 'public' as $$
begin
  delete from public.gp_bookmarks where target = 'goods' and target_id = old.id;
  delete from public.gp_reactions where target = 'goods' and target_id = old.id;
  return old;
end $$;
create trigger gp_posts_cleanup after delete on public.gp_posts for each row execute function public._gp_cleanup_post();
create trigger gp_goods_cleanup after delete on public.gp_goods for each row execute function public._gp_cleanup_goods();

-- 対象が公開中かどうか（内部用）
create or replace function public._gp_target_ok(p_target text, p_id bigint) returns boolean
language sql stable security definer set search_path = 'public' as $$
  select case p_target
    when 'post' then exists (select 1 from public.gp_posts where id = p_id and status = 'public')
    when 'goods' then exists (select 1 from public.gp_goods where id = p_id and status = 'public')
    else false end
$$;
create or replace function public._gp_target_owner(p_target text, p_id bigint) returns uuid
language sql stable security definer set search_path = 'public' as $$
  select case p_target when 'post' then (select ka_id from public.gp_posts where id = p_id)
                       when 'goods' then (select ka_id from public.gp_goods where id = p_id) end
$$;
create or replace function public._gp_reaction_counts(p_target text, p_id bigint) returns jsonb
language sql stable security definer set search_path = 'public' as $$
  select jsonb_build_object(
    'funny', count(*) filter (where kind = 'funny'),
    'helpful', count(*) filter (where kind = 'helpful'),
    'wantplay', count(*) filter (where kind = 'wantplay'))
  from public.gp_reactions where target = p_target and target_id = p_id
$$;

-- ---------- 記事・商品ページのボタンの状態 ----------
create or replace function public.gp_item_state(p_token text, p_target text, p_id bigint)
returns jsonb language plpgsql security definer set search_path = 'public', 'extensions' as $$
declare a public.ka_accounts; owner uuid;
begin
  if p_target not in ('post', 'goods') or not public._gp_target_ok(p_target, p_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  a := public._ka_from_token(p_token);
  owner := public._gp_target_owner(p_target, p_id);
  return jsonb_build_object('ok', true,
    'reactions', public._gp_reaction_counts(p_target, p_id),
    'mine', coalesce((select jsonb_agg(kind) from public.gp_reactions where a.id is not null and ka_id = a.id and target = p_target and target_id = p_id), '[]'::jsonb),
    'bookmarked', a.id is not null and exists (select 1 from public.gp_bookmarks where ka_id = a.id and target = p_target and target_id = p_id),
    'wanted', p_target = 'goods' and a.id is not null and exists (select 1 from public.gp_goods_wants where ka_id = a.id and goods_id = p_id),
    'wants', case when p_target = 'goods' then (select count(*) from public.gp_goods_wants where goods_id = p_id) else 0 end,
    'self', a.id is not null and a.id = owner,
    'following', a.id is not null and exists (select 1 from public.gp_follows where follower = a.id and followee = owner));
end $$;

-- ---------- リアクション ----------
create or replace function public.gp_react_toggle(p_token text, p_target text, p_id bigint, p_kind text)
returns jsonb language plpgsql security definer set search_path = 'public', 'extensions' as $$
declare a public.ka_accounts;
begin
  a := public._ka_from_token(p_token);
  if a.id is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if p_target not in ('post', 'goods') or p_kind not in ('funny', 'helpful', 'wantplay') then return jsonb_build_object('ok', false, 'reason', 'bad'); end if;
  if not public._gp_target_ok(p_target, p_id) then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  delete from public.gp_reactions where ka_id = a.id and target = p_target and target_id = p_id and kind = p_kind;
  if not found then
    if (select count(*) from public.gp_reactions where ka_id = a.id and created_at > now() - interval '1 hour') >= 300 then
      return jsonb_build_object('ok', false, 'reason', 'too_many');
    end if;
    insert into public.gp_reactions (ka_id, target, target_id, kind) values (a.id, p_target, p_id, p_kind) on conflict do nothing;
  end if;
  return jsonb_build_object('ok', true, 'reactions', public._gp_reaction_counts(p_target, p_id),
    'mine', coalesce((select jsonb_agg(kind) from public.gp_reactions where ka_id = a.id and target = p_target and target_id = p_id), '[]'::jsonb));
end $$;

-- ---------- あとで読む・ほしいもの ----------
create or replace function public.gp_bookmark_toggle(p_token text, p_target text, p_id bigint)
returns jsonb language plpgsql security definer set search_path = 'public', 'extensions' as $$
declare a public.ka_accounts;
begin
  a := public._ka_from_token(p_token);
  if a.id is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if p_target not in ('post', 'goods') then return jsonb_build_object('ok', false, 'reason', 'bad'); end if;
  delete from public.gp_bookmarks where ka_id = a.id and target = p_target and target_id = p_id;
  if found then return jsonb_build_object('ok', true, 'bookmarked', false); end if;
  if not public._gp_target_ok(p_target, p_id) then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if (select count(*) from public.gp_bookmarks where ka_id = a.id) >= 500 then return jsonb_build_object('ok', false, 'reason', 'list_full'); end if;
  insert into public.gp_bookmarks (ka_id, target, target_id) values (a.id, p_target, p_id) on conflict do nothing;
  return jsonb_build_object('ok', true, 'bookmarked', true);
end $$;

create or replace function public.gp_goods_want_toggle(p_token text, p_id bigint)
returns jsonb language plpgsql security definer set search_path = 'public', 'extensions' as $$
declare a public.ka_accounts; now_wanted boolean;
begin
  a := public._ka_from_token(p_token);
  if a.id is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  delete from public.gp_goods_wants where ka_id = a.id and goods_id = p_id;
  if found then now_wanted := false;
  else
    if not public._gp_target_ok('goods', p_id) then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
    if (select count(*) from public.gp_goods_wants where ka_id = a.id) >= 500 then return jsonb_build_object('ok', false, 'reason', 'list_full'); end if;
    insert into public.gp_goods_wants (goods_id, ka_id) values (p_id, a.id) on conflict do nothing;
    now_wanted := true;
  end if;
  return jsonb_build_object('ok', true, 'wanted', now_wanted, 'wants', (select count(*) from public.gp_goods_wants where goods_id = p_id));
end $$;

-- ---------- フォロー ----------
create or replace function public.gp_follow_state(p_token text, p_username text)
returns jsonb language plpgsql security definer set search_path = 'public', 'extensions' as $$
declare a public.ka_accounts; t uuid;
begin
  select id into t from public.ka_accounts where username = p_username;
  if t is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  a := public._ka_from_token(p_token);
  return jsonb_build_object('ok', true,
    'followers', (select count(*) from public.gp_follows where followee = t),
    'followees', (select count(*) from public.gp_follows where follower = t),
    'following', a.id is not null and exists (select 1 from public.gp_follows where follower = a.id and followee = t),
    'self', a.id is not null and a.id = t);
end $$;

create or replace function public.gp_follow_toggle(p_token text, p_username text)
returns jsonb language plpgsql security definer set search_path = 'public', 'extensions' as $$
declare a public.ka_accounts; t uuid; now_following boolean;
begin
  a := public._ka_from_token(p_token);
  if a.id is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  select id into t from public.ka_accounts where username = p_username;
  if t is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if t = a.id then return jsonb_build_object('ok', false, 'reason', 'self_follow'); end if;
  delete from public.gp_follows where follower = a.id and followee = t;
  if found then now_following := false;
  else
    if (select count(*) from public.gp_follows where follower = a.id) >= 1000 then return jsonb_build_object('ok', false, 'reason', 'list_full'); end if;
    if (select count(*) from public.gp_follows where follower = a.id and created_at > now() - interval '1 hour') >= 60 then
      return jsonb_build_object('ok', false, 'reason', 'too_many');
    end if;
    insert into public.gp_follows (follower, followee) values (a.id, t) on conflict do nothing;
    now_following := true;
  end if;
  return jsonb_build_object('ok', true, 'following', now_following, 'followers', (select count(*) from public.gp_follows where followee = t));
end $$;

-- ---------- マイリスト（あとで読む・ほしいもの・フォロー中・フォロー中の新着） ----------
create or replace function public.gp_my_lists(p_token text)
returns jsonb language plpgsql security definer set search_path = 'public', 'extensions' as $$
declare a public.ka_accounts;
begin
  a := public._ka_from_token(p_token);
  if a.id is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  return jsonb_build_object('ok', true,
    'bookmarks', coalesce((select jsonb_agg(x.c order by x.at desc) from (
        select public._gp_card(p) || jsonb_build_object('kind', 'post') as c, b.created_at as at
        from public.gp_bookmarks b join public.gp_posts p on p.id = b.target_id
        where b.ka_id = a.id and b.target = 'post' and p.status = 'public'
        union all
        select public._gp_goods_card(g) || jsonb_build_object('kind', 'goods'), b.created_at
        from public.gp_bookmarks b join public.gp_goods g on g.id = b.target_id
        where b.ka_id = a.id and b.target = 'goods' and g.status = 'public'
        order by 2 desc limit 200) x), '[]'::jsonb),
    'wants', coalesce((select jsonb_agg(public._gp_goods_card(g) order by w.created_at desc)
        from public.gp_goods_wants w join public.gp_goods g on g.id = w.goods_id
        where w.ka_id = a.id and g.status = 'public'), '[]'::jsonb),
    'following', coalesce((select jsonb_agg(public._gp_author(f.followee) order by f.created_at desc)
        from public.gp_follows f where f.follower = a.id), '[]'::jsonb),
    'feed', coalesce((select jsonb_agg(x.c order by x.at desc) from (
        select public._gp_card(p) || jsonb_build_object('kind', 'post') as c, p.created_at as at
        from public.gp_posts p join public.gp_follows f on f.followee = p.ka_id and f.follower = a.id
        where p.status = 'public' and p.created_at > now() - interval '60 days'
        union all
        select public._gp_goods_card(g) || jsonb_build_object('kind', 'goods'), g.created_at
        from public.gp_goods g join public.gp_follows f on f.followee = g.ka_id and f.follower = a.id
        where g.status = 'public' and g.created_at > now() - interval '60 days'
        order by 2 desc limit 40) x), '[]'::jsonb));
end $$;

-- ---------- ランキング（期間中にもらったピタっと！の数） ----------
create or replace function public.gp_ranking(p_kind text, p_period text)
returns jsonb language plpgsql security definer set search_path = 'public', 'extensions' as $$
declare since timestamptz;
begin
  if p_kind not in ('post', 'goods') or p_period not in ('week', 'month', 'all') then return jsonb_build_object('ok', false, 'reason', 'bad'); end if;
  since := case p_period when 'week' then now() - interval '7 days' when 'month' then now() - interval '30 days' else '-infinity'::timestamptz end;
  if p_kind = 'post' then
    return jsonb_build_object('ok', true, 'items', coalesce((select jsonb_agg(public._gp_card(x.p) || jsonb_build_object('score', x.n) order by x.n desc, (x.p).id desc)
      from (select p, s.n from (select post_id, count(*) as n from public.gp_likes where created_at >= since group by post_id) s
            join public.gp_posts p on p.id = s.post_id and p.status = 'public'
            order by s.n desc, p.id desc limit 30) x), '[]'::jsonb));
  else
    return jsonb_build_object('ok', true, 'items', coalesce((select jsonb_agg(public._gp_goods_card(x.g) || jsonb_build_object('score', x.n) order by x.n desc, (x.g).id desc)
      from (select g, s.n from (select goods_id, count(*) as n from public.gp_goods_likes where created_at >= since group by goods_id) s
            join public.gp_goods g on g.id = s.goods_id and g.status = 'public'
            order by s.n desc, g.id desc limit 30) x), '[]'::jsonb));
  end if;
end $$;

-- ---------- 下書き（アカウントに保存） ----------
create or replace function public.gp_draft_get(p_token text, p_kind text)
returns jsonb language plpgsql security definer set search_path = 'public', 'extensions' as $$
declare a public.ka_accounts; d public.gp_drafts;
begin
  a := public._ka_from_token(p_token);
  if a.id is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  select * into d from public.gp_drafts where ka_id = a.id and kind = p_kind;
  return jsonb_build_object('ok', true, 'data', d.data, 'updated_at', d.updated_at);
end $$;

create or replace function public.gp_draft_save(p_token text, p_kind text, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = 'public', 'extensions' as $$
declare a public.ka_accounts;
begin
  a := public._ka_from_token(p_token);
  if a.id is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if p_kind not in ('post', 'goods') or p_data is null or jsonb_typeof(p_data) <> 'object' then return jsonb_build_object('ok', false, 'reason', 'bad'); end if;
  if pg_column_size(p_data) > 40000 then return jsonb_build_object('ok', false, 'reason', 'draft_big'); end if;
  insert into public.gp_drafts (ka_id, kind, data, updated_at) values (a.id, p_kind, p_data, now())
  on conflict (ka_id, kind) do update set data = excluded.data, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.gp_draft_delete(p_token text, p_kind text)
returns jsonb language plpgsql security definer set search_path = 'public', 'extensions' as $$
declare a public.ka_accounts;
begin
  a := public._ka_from_token(p_token);
  if a.id is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  delete from public.gp_drafts where ka_id = a.id and kind = p_kind;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- お題企画 ----------
create or replace function public.gp_themes_list()
returns jsonb language sql stable security definer set search_path = 'public' as $$
  with today as (select (now() at time zone 'Asia/Tokyo')::date as d),
  t as (
    select th.*, (select count(*) from public.gp_posts p where p.status = 'public' and p.tags @> array[th.tag])
               + (select count(*) from public.gp_goods g where g.status = 'public' and g.tags @> array[th.tag]) as n
    from public.gp_themes th)
  select jsonb_build_object('ok', true, 'today', (select d from today),
    'current', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'tag', tag, 'description', description,
        'starts_on', starts_on, 'ends_on', ends_on, 'count', n) order by starts_on desc) from t, today where today.d between starts_on and ends_on), '[]'::jsonb),
    'upcoming', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'tag', tag, 'description', description,
        'starts_on', starts_on, 'ends_on', ends_on, 'count', n) order by starts_on) from t, today where starts_on > today.d), '[]'::jsonb),
    'past', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'tag', tag, 'description', description,
        'starts_on', starts_on, 'ends_on', ends_on, 'count', n) order by ends_on desc) from (select t.* from t, today where ends_on < today.d order by ends_on desc limit 50) p), '[]'::jsonb))
$$;

create or replace function public.gp_admin_theme_save(p_token text, p_id bigint, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = 'public', 'extensions' as $$
declare a public.ka_accounts; d jsonb := coalesce(p_data, '{}'::jsonb);
  v_title text; v_tag text; v_desc text; v_s date; v_e date; v_id bigint;
begin
  a := public._ka_from_token(p_token);
  if not coalesce(a.is_admin, false) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if jsonb_typeof(d) <> 'object' then return jsonb_build_object('ok', false, 'reason', 'bad'); end if;
  v_title := btrim(coalesce(d->>'title', ''));
  v_tag := btrim(regexp_replace(coalesce(d->>'tag', ''), '^[#＃]+', ''));
  v_desc := nullif(btrim(coalesce(d->>'description', '')), '');
  begin v_s := (d->>'starts_on')::date; v_e := (d->>'ends_on')::date; exception when others then return jsonb_build_object('ok', false, 'reason', 'theme_date'); end;
  if char_length(v_title) not between 1 and 40 then return jsonb_build_object('ok', false, 'reason', 'theme_title'); end if;
  if char_length(v_tag) not between 1 and 20 or v_tag ~ '[[:space:]<>#＃]' then return jsonb_build_object('ok', false, 'reason', 'tags'); end if;
  if v_desc is not null and char_length(v_desc) > 300 then return jsonb_build_object('ok', false, 'reason', 'theme_desc'); end if;
  if v_s is null or v_e is null or v_e < v_s or v_e > v_s + 366 then return jsonb_build_object('ok', false, 'reason', 'theme_date'); end if;
  if p_id is null then
    insert into public.gp_themes (title, tag, description, starts_on, ends_on) values (v_title, v_tag, v_desc, v_s, v_e) returning id into v_id;
  else
    update public.gp_themes set title = v_title, tag = v_tag, description = v_desc, starts_on = v_s, ends_on = v_e where id = p_id;
    if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
    v_id := p_id;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.gp_admin_theme_delete(p_token text, p_id bigint)
returns jsonb language plpgsql security definer set search_path = 'public', 'extensions' as $$
declare a public.ka_accounts;
begin
  a := public._ka_from_token(p_token);
  if not coalesce(a.is_admin, false) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  delete from public.gp_themes where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- 管理者：新しい投稿 ----------
create or replace function public.gp_admin_new_items(p_token text)
returns jsonb language plpgsql security definer set search_path = 'public', 'extensions' as $$
declare a public.ka_accounts;
begin
  a := public._ka_from_token(p_token);
  if not coalesce(a.is_admin, false) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  return jsonb_build_object('ok', true, 'items', coalesce((select jsonb_agg(x.c order by x.at desc) from (
      select jsonb_build_object('kind', 'post', 'id', p.id, 'title', p.title, 'name', p.game, 'created_at', p.created_at,
        'author', public._gp_author(p.ka_id), 'reports', (select count(*) from public.gp_reports r where r.target = 'post' and r.target_id = p.id)) as c, p.created_at as at
      from public.gp_posts p where p.status = 'public' and p.created_at > now() - interval '14 days'
      union all
      select jsonb_build_object('kind', 'goods', 'id', g.id, 'title', g.title, 'name', g.name, 'created_at', g.created_at,
        'author', public._gp_author(g.ka_id), 'reports', (select count(*) from public.gp_reports r where r.target = 'goods' and r.target_id = g.id)), g.created_at
      from public.gp_goods g where g.status = 'public' and g.created_at > now() - interval '14 days'
      order by 2 desc limit 50) x), '[]'::jsonb));
end $$;

-- ---------- 通知（フォロー・フォロー中の人の新しい投稿・管理者への新着を追加） ----------
create or replace function public.gp_notifs(p_token text) returns jsonb language plpgsql
  security definer set search_path = 'public', 'extensions' as $$
declare a public.ka_accounts; seen timestamptz; adm boolean;
begin
  a := public._ka_from_token(p_token);
  if a.id is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  adm := coalesce(a.is_admin, false);
  seen := coalesce((select notif_seen_at from public.gp_users where ka_id = a.id), 'epoch'::timestamptz);
  return (with ev as (
      select 'comment' as kind, c.post_id, null::bigint as goods_id, c.ka_id as who, left(c.body, 80) as body, c.created_at as at
      from public.gp_comments c join public.gp_posts p on p.id = c.post_id
      where p.ka_id = a.id and c.ka_id <> a.id and c.created_at > now() - interval '60 days'
      union all
      select 'like', l.post_id, null, l.ka_id, null, l.created_at
      from public.gp_likes l join public.gp_posts p on p.id = l.post_id
      where p.ka_id = a.id and l.ka_id <> a.id and l.created_at > now() - interval '60 days'
      union all
      select 'comment', null, c.goods_id, c.ka_id, left(c.body, 80), c.created_at
      from public.gp_goods_comments c join public.gp_goods g on g.id = c.goods_id
      where g.ka_id = a.id and c.ka_id <> a.id and c.created_at > now() - interval '60 days'
      union all
      select 'like', null, l.goods_id, l.ka_id, null, l.created_at
      from public.gp_goods_likes l join public.gp_goods g on g.id = l.goods_id
      where g.ka_id = a.id and l.ka_id <> a.id and l.created_at > now() - interval '60 days'
      union all
      select 'reply', null, null, null, left(q.reply, 80), q.replied_at
      from public.gp_inquiries q
      where q.ka_id = a.id and q.replied_at is not null and q.replied_at > now() - interval '60 days'
      union all
      select 'follow', null, null, f.follower, null, f.created_at
      from public.gp_follows f where f.followee = a.id and f.created_at > now() - interval '60 days'
      union all
      select 'new_post', p.id, null, p.ka_id, null, p.created_at
      from public.gp_posts p join public.gp_follows f on f.followee = p.ka_id and f.follower = a.id
      where p.status = 'public' and p.created_at > f.created_at and p.created_at > now() - interval '30 days'
      union all
      select 'new_goods', null, g.id, g.ka_id, null, g.created_at
      from public.gp_goods g join public.gp_follows f on f.followee = g.ka_id and f.follower = a.id
      where g.status = 'public' and g.created_at > f.created_at and g.created_at > now() - interval '30 days'
      union all
      select 'admin_post', p.id, null, p.ka_id, null, p.created_at
      from public.gp_posts p where adm and p.ka_id <> a.id and p.status = 'public' and p.created_at > now() - interval '14 days'
      union all
      select 'admin_goods', null, g.id, g.ka_id, null, g.created_at
      from public.gp_goods g where adm and g.ka_id <> a.id and g.status = 'public' and g.created_at > now() - interval '14 days'
    )
    select jsonb_build_object('ok', true,
      'unread', (select count(*) from ev where ev.at > seen),
      'items', coalesce((select jsonb_agg(jsonb_build_object(
          'kind', e.kind, 'post_id', e.post_id, 'goods_id', e.goods_id,
          'post_title', coalesce((select title from public.gp_posts where id = e.post_id), (select title from public.gp_goods where id = e.goods_id)),
          'who', case when e.who is null then null else public._gp_author(e.who) end,
          'body', e.body, 'at', e.at, 'unread', e.at > seen) order by e.at desc)
        from (select * from ev order by at desc limit 40) e), '[]'::jsonb)));
end $$;

-- ---------- 権限 ----------
revoke all on function public._gp_cleanup_post(), public._gp_cleanup_goods(), public._gp_target_ok(text, bigint),
  public._gp_target_owner(text, bigint), public._gp_reaction_counts(text, bigint) from public, anon, authenticated;
revoke all on function public.gp_item_state(text, text, bigint), public.gp_react_toggle(text, text, bigint, text),
  public.gp_bookmark_toggle(text, text, bigint), public.gp_goods_want_toggle(text, bigint), public.gp_follow_state(text, text),
  public.gp_follow_toggle(text, text), public.gp_my_lists(text), public.gp_ranking(text, text), public.gp_draft_get(text, text),
  public.gp_draft_save(text, text, jsonb), public.gp_draft_delete(text, text), public.gp_themes_list(),
  public.gp_admin_theme_save(text, bigint, jsonb), public.gp_admin_theme_delete(text, bigint), public.gp_admin_new_items(text) from public;
grant execute on function public.gp_item_state(text, text, bigint), public.gp_react_toggle(text, text, bigint, text),
  public.gp_bookmark_toggle(text, text, bigint), public.gp_goods_want_toggle(text, bigint), public.gp_follow_state(text, text),
  public.gp_follow_toggle(text, text), public.gp_my_lists(text), public.gp_ranking(text, text), public.gp_draft_get(text, text),
  public.gp_draft_save(text, text, jsonb), public.gp_draft_delete(text, text), public.gp_themes_list(),
  public.gp_admin_theme_save(text, bigint, jsonb), public.gp_admin_theme_delete(text, bigint), public.gp_admin_new_items(text) to anon, authenticated;
