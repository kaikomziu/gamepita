-- GamePita v1.4.0: 商品紹介（ゲームソフト・ゲーム機・周辺機器・グッズ・本など）。マイグレーション gamepita_goods
-- ゲーム紹介記事（gp_posts）とは別のテーブルにして、診断・ゲームまとめなど今の機能には影響させない。
-- テーブルは RLS 有効・ポリシーなし・権限なし。読み書きはすべて SECURITY DEFINER の RPC だけ。

create table public.gp_goods (
  id bigint generated always as identity primary key,
  ka_id uuid not null references public.ka_accounts(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 60),
  name text not null check (char_length(name) between 1 and 80),
  category text not null check (category in ('soft', 'hard', 'acc', 'goods', 'book', 'other')),
  maker text check (maker is null or char_length(maker) between 1 and 40),
  price integer check (price is null or price between 0 and 10000000),
  rating smallint not null check (rating between 1 and 5),
  body text not null check (char_length(body) between 1 and 8000),
  image_url text check (image_url is null or public._gp_url_ok(image_url)),
  shop_url text check (shop_url is null or public._gp_url_ok(shop_url)),
  tags text[] not null default '{}',
  pr boolean not null default false,          -- 提供・依頼を受けて書いた（PR 表示）
  status text not null default 'public' check (status in ('public', 'removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index gp_goods_created_idx on public.gp_goods (status, created_at desc);
create index gp_goods_ka_idx on public.gp_goods (ka_id, created_at desc);
create index gp_goods_tags_idx on public.gp_goods using gin (tags);

create table public.gp_goods_likes (
  goods_id bigint not null references public.gp_goods(id) on delete cascade,
  ka_id uuid not null references public.ka_accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (goods_id, ka_id)
);
create index gp_goods_likes_ka_idx on public.gp_goods_likes (ka_id);

create table public.gp_goods_comments (
  id bigint generated always as identity primary key,
  goods_id bigint not null references public.gp_goods(id) on delete cascade,
  ka_id uuid not null references public.ka_accounts(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);
create index gp_goods_comments_goods_idx on public.gp_goods_comments (goods_id, created_at);
create index gp_goods_comments_ka_idx on public.gp_goods_comments (ka_id, created_at desc);

alter table public.gp_goods enable row level security;
alter table public.gp_goods_likes enable row level security;
alter table public.gp_goods_comments enable row level security;
revoke all on public.gp_goods, public.gp_goods_likes, public.gp_goods_comments from public, anon, authenticated;

-- 通報の対象に商品・商品へのコメントを追加
alter table public.gp_reports drop constraint gp_reports_target_check;
alter table public.gp_reports add constraint gp_reports_target_check check (target in ('post', 'comment', 'goods', 'goods_comment'));

-- ---------- 内部用 ----------
create or replace function public._gp_goods_card(g public.gp_goods) returns jsonb
language sql stable security definer set search_path = 'public' as $$
  select jsonb_build_object(
    'id', g.id, 'title', g.title, 'name', g.name, 'category', g.category, 'maker', g.maker, 'price', g.price,
    'rating', g.rating, 'image_url', g.image_url, 'tags', g.tags, 'pr', g.pr,
    'excerpt', left(regexp_replace(regexp_replace(g.body, '\|\|.+?\|\|', '（ネタバレ）', 'g'), '\s+', ' ', 'g'), 120),
    'created_at', g.created_at, 'author', public._gp_author(g.ka_id),
    'likes', (select count(*) from public.gp_goods_likes l where l.goods_id = g.id),
    'comments', (select count(*) from public.gp_goods_comments c where c.goods_id = g.id))
$$;

-- ---------- 一覧 ----------
create or replace function public.gp_goods_list(p_q text default null, p_category text default null, p_tag text default null,
  p_author text default null, p_sort text default 'new', p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path = 'public', 'extensions' as $$
declare q text := btrim(coalesce(p_q, '')); pat text; off int := greatest(0, least(coalesce(p_offset, 0), 5000));
  items jsonb; total int;
begin
  if char_length(q) > 50 then q := left(q, 50); end if;
  pat := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  select coalesce(jsonb_agg(public._gp_goods_card(s.g) order by s.rn), '[]'::jsonb), count(*) into items, total
  from (
    select x.g, row_number() over (
      order by case when p_sort = 'popular' then x.lk end desc nulls last,
               case when p_sort = 'rating' then (x.g).rating end desc nulls last,
               (x.g).created_at desc, (x.g).id desc) as rn
    from (
      select g, (select count(*) from public.gp_goods_likes l where l.goods_id = g.id) as lk
      from public.gp_goods g left join public.ka_accounts a on a.id = g.ka_id
      where g.status = 'public'
        and (q = '' or g.title ilike pat or g.name ilike pat or g.maker ilike pat or g.body ilike pat
             or exists (select 1 from unnest(g.tags) t where t ilike pat))
        and (p_category is null or p_category = '' or g.category = p_category)
        and (p_tag is null or p_tag = '' or g.tags @> array[p_tag])
        and (p_author is null or p_author = '' or a.username = p_author)
    ) x
  ) s
  where s.rn > off and s.rn <= off + 25;
  return jsonb_build_object('ok', true, 'items', case when total > 24 then items - 24 else items end, 'more', total > 24);
end $$;

-- ---------- 1件 ----------
create or replace function public.gp_goods_get(p_token text, p_id bigint)
returns jsonb language plpgsql security definer set search_path = 'public', 'extensions' as $$
declare a public.ka_accounts; g public.gp_goods; adm boolean;
begin
  a := public._ka_from_token(p_token);
  adm := coalesce(a.is_admin, false);
  select * into g from public.gp_goods where id = p_id;
  if g.id is null or (g.status <> 'public' and not adm) then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  return jsonb_build_object('ok', true, 'item', public._gp_goods_card(g) || jsonb_build_object(
      'body', g.body, 'shop_url', g.shop_url, 'status', g.status, 'updated_at', g.updated_at,
      'author_badges', public._gp_badges(g.ka_id),
      'mine', a.id is not null and a.id = g.ka_id,
      'liked', a.id is not null and exists (select 1 from public.gp_goods_likes l where l.goods_id = g.id and l.ka_id = a.id)),
    'is_admin', adm,
    'comments', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'body', c.body, 'created_at', c.created_at, 'author', public._gp_author(c.ka_id),
        'can_delete', a.id is not null and (c.ka_id = a.id or g.ka_id = a.id or adm)) order by c.created_at)
      from (select * from public.gp_goods_comments where goods_id = g.id order by created_at desc limit 300) c), '[]'::jsonb));
end $$;

-- ---------- 書く・直す ----------
create or replace function public.gp_goods_save(p_token text, p_id bigint, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = 'public', 'extensions' as $$
declare a public.ka_accounts; d jsonb := coalesce(p_data, '{}'::jsonb);
  v_title text; v_name text; v_cat text; v_maker text; v_price int; v_rating int; v_body text;
  v_img text; v_shop text; v_tags text[]; v_pr boolean; v_id bigint; owner uuid;
begin
  a := public._ka_from_token(p_token);
  if a.id is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if jsonb_typeof(d) <> 'object' then return jsonb_build_object('ok', false, 'reason', 'bad'); end if;

  v_title := btrim(coalesce(d->>'title', ''));
  v_name := btrim(coalesce(d->>'name', ''));
  v_cat := coalesce(d->>'category', '');
  v_maker := nullif(btrim(coalesce(d->>'maker', '')), '');
  v_body := btrim(coalesce(d->>'body', ''));
  v_img := nullif(btrim(coalesce(d->>'image_url', '')), '');
  v_shop := nullif(btrim(coalesce(d->>'shop_url', '')), '');
  v_pr := case when jsonb_typeof(d->'pr') = 'boolean' then (d->'pr')::boolean else false end;
  begin v_rating := (d->>'rating')::int; exception when others then v_rating := null; end;
  if d ? 'price' and jsonb_typeof(d->'price') <> 'null' then
    if jsonb_typeof(d->'price') <> 'number' then return jsonb_build_object('ok', false, 'reason', 'price'); end if;
    begin v_price := (d->>'price')::int; exception when others then return jsonb_build_object('ok', false, 'reason', 'price'); end;
    if v_price not between 0 and 10000000 then return jsonb_build_object('ok', false, 'reason', 'price'); end if;
  end if;

  if char_length(v_title) not between 1 and 60 then return jsonb_build_object('ok', false, 'reason', 'title'); end if;
  if char_length(v_name) not between 1 and 80 then return jsonb_build_object('ok', false, 'reason', 'goods_name'); end if;
  if v_cat not in ('soft', 'hard', 'acc', 'goods', 'book', 'other') then return jsonb_build_object('ok', false, 'reason', 'category'); end if;
  if v_maker is not null and char_length(v_maker) > 40 then return jsonb_build_object('ok', false, 'reason', 'maker'); end if;
  if v_rating is null or v_rating not between 1 and 5 then return jsonb_build_object('ok', false, 'reason', 'rating'); end if;
  if char_length(v_body) not between 1 and 8000 then return jsonb_build_object('ok', false, 'reason', 'body'); end if;
  if v_img is not null and not public._gp_url_ok(v_img) then return jsonb_build_object('ok', false, 'reason', 'url'); end if;
  if v_shop is not null and not public._gp_url_ok(v_shop) then return jsonb_build_object('ok', false, 'reason', 'url'); end if;

  if d ? 'tags' and jsonb_typeof(d->'tags') <> 'array' then return jsonb_build_object('ok', false, 'reason', 'tags'); end if;
  select coalesce(array_agg(t order by ord), '{}') into v_tags from (
    select distinct on (t) t, ord from (
      select btrim(regexp_replace(x, '^[#＃]+', '')) as t, ord
      from jsonb_array_elements_text(coalesce(d->'tags', '[]'::jsonb)) with ordinality as e(x, ord)) s
    where t <> '' order by t, ord) u;
  if array_length(v_tags, 1) > 5 or exists (select 1 from unnest(v_tags) t where char_length(t) > 20 or t ~ '[[:space:]<>]') then
    return jsonb_build_object('ok', false, 'reason', 'tags');
  end if;

  if p_id is null then
    if (select count(*) from public.gp_goods where ka_id = a.id and created_at > now() - interval '1 day') >= 10 then
      return jsonb_build_object('ok', false, 'reason', 'too_many_today');
    end if;
    insert into public.gp_goods (ka_id, title, name, category, maker, price, rating, body, image_url, shop_url, tags, pr)
    values (a.id, v_title, v_name, v_cat, v_maker, v_price, v_rating, v_body, v_img, v_shop, v_tags, v_pr)
    returning id into v_id;
  else
    select ka_id into owner from public.gp_goods where id = p_id and status = 'public';
    if owner is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
    if owner <> a.id then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
    update public.gp_goods set title = v_title, name = v_name, category = v_cat, maker = v_maker, price = v_price,
      rating = v_rating, body = v_body, image_url = v_img, shop_url = v_shop, tags = v_tags, pr = v_pr, updated_at = now()
    where id = p_id;
    v_id := p_id;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- ---------- 削除（本人は削除・管理者は非表示） ----------
create or replace function public.gp_goods_delete(p_token text, p_id bigint)
returns jsonb language plpgsql security definer set search_path = 'public', 'extensions' as $$
declare a public.ka_accounts; owner uuid;
begin
  a := public._ka_from_token(p_token);
  if a.id is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  select ka_id into owner from public.gp_goods where id = p_id;
  if owner is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if owner = a.id then
    delete from public.gp_reports where target = 'goods_comment' and target_id in (select id from public.gp_goods_comments where goods_id = p_id);
    delete from public.gp_goods where id = p_id;
    delete from public.gp_reports where target = 'goods' and target_id = p_id;
  elsif coalesce(a.is_admin, false) then
    update public.gp_goods set status = 'removed' where id = p_id;
    delete from public.gp_reports where target = 'goods' and target_id = p_id;
  else
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- ピタっと！ ----------
create or replace function public.gp_goods_like(p_token text, p_id bigint)
returns jsonb language plpgsql security definer set search_path = 'public', 'extensions' as $$
declare a public.ka_accounts; now_liked boolean;
begin
  a := public._ka_from_token(p_token);
  if a.id is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if not exists (select 1 from public.gp_goods where id = p_id and status = 'public') then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  delete from public.gp_goods_likes where goods_id = p_id and ka_id = a.id;
  if found then now_liked := false;
  else insert into public.gp_goods_likes (goods_id, ka_id) values (p_id, a.id) on conflict do nothing; now_liked := true;
  end if;
  return jsonb_build_object('ok', true, 'liked', now_liked, 'likes', (select count(*) from public.gp_goods_likes where goods_id = p_id));
end $$;

-- ---------- コメント ----------
create or replace function public.gp_goods_comment_add(p_token text, p_id bigint, p_body text)
returns jsonb language plpgsql security definer set search_path = 'public', 'extensions' as $$
declare a public.ka_accounts; b text := btrim(coalesce(p_body, ''));
begin
  a := public._ka_from_token(p_token);
  if a.id is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if char_length(b) not between 1 and 500 then return jsonb_build_object('ok', false, 'reason', 'comment'); end if;
  if not exists (select 1 from public.gp_goods where id = p_id and status = 'public') then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  -- 記事へのコメントと合わせて1時間に30件まで
  if (select count(*) from public.gp_comments where ka_id = a.id and created_at > now() - interval '1 hour')
     + (select count(*) from public.gp_goods_comments where ka_id = a.id and created_at > now() - interval '1 hour') >= 30 then
    return jsonb_build_object('ok', false, 'reason', 'too_many');
  end if;
  insert into public.gp_goods_comments (goods_id, ka_id, body) values (p_id, a.id, b);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.gp_goods_comment_delete(p_token text, p_cid bigint)
returns jsonb language plpgsql security definer set search_path = 'public', 'extensions' as $$
declare a public.ka_accounts; c public.gp_goods_comments; owner uuid;
begin
  a := public._ka_from_token(p_token);
  if a.id is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  select * into c from public.gp_goods_comments where id = p_cid;
  if c.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select ka_id into owner from public.gp_goods where id = c.goods_id;
  if not (c.ka_id = a.id or owner = a.id or coalesce(a.is_admin, false)) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  delete from public.gp_goods_comments where id = p_cid;
  delete from public.gp_reports where target = 'goods_comment' and target_id = p_cid;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- 静的ページ用（公開中だけ） ----------
create or replace function public.gp_goods_export() returns jsonb
language sql stable security definer set search_path = 'public' as $$
  select coalesce(jsonb_agg(public._gp_goods_card(g) || jsonb_build_object(
      'body', g.body, 'shop_url', g.shop_url, 'updated_at', g.updated_at, 'author_badges', public._gp_badges(g.ka_id))
    order by g.id desc), '[]'::jsonb)
  from (select * from public.gp_goods where status = 'public' order by id desc limit 5000) g
$$;

-- ---------- 通報（商品・商品コメントにも対応） ----------
create or replace function public.gp_report(p_token text, p_target text, p_id bigint, p_reason text)
returns jsonb language plpgsql security definer set search_path = 'public', 'extensions' as $$
declare a public.ka_accounts; r text := btrim(coalesce(p_reason, ''));
begin
  a := public._ka_from_token(p_token);
  if a.id is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if p_target not in ('post', 'comment', 'goods', 'goods_comment') then return jsonb_build_object('ok', false, 'reason', 'bad'); end if;
  if char_length(r) not between 1 and 200 then return jsonb_build_object('ok', false, 'reason', 'reason'); end if;
  if (p_target = 'post' and not exists (select 1 from public.gp_posts where id = p_id and status = 'public'))
     or (p_target = 'comment' and not exists (select 1 from public.gp_comments where id = p_id))
     or (p_target = 'goods' and not exists (select 1 from public.gp_goods where id = p_id and status = 'public'))
     or (p_target = 'goods_comment' and not exists (select 1 from public.gp_goods_comments where id = p_id)) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if (select count(*) from public.gp_reports where ka_id = a.id and created_at > now() - interval '1 day') >= 20 then
    return jsonb_build_object('ok', false, 'reason', 'too_many');
  end if;
  insert into public.gp_reports (target, target_id, ka_id, reason) values (p_target, p_id, a.id, r)
  on conflict (target, target_id, ka_id) do update set reason = excluded.reason, created_at = now();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.gp_admin_reports(p_token text)
returns jsonb language plpgsql security definer set search_path = 'public', 'extensions' as $$
declare a public.ka_accounts;
begin
  a := public._ka_from_token(p_token);
  if not coalesce(a.is_admin, false) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  return jsonb_build_object('ok', true, 'reports', coalesce((select jsonb_agg(jsonb_build_object(
      'id', r.id, 'target', r.target, 'target_id', r.target_id, 'reason', r.reason, 'created_at', r.created_at,
      'reporter', public._gp_author(r.ka_id),
      'post_id', case r.target when 'post' then r.target_id
                   when 'comment' then (select post_id from public.gp_comments where id = r.target_id) end,
      'goods_id', case r.target when 'goods' then r.target_id
                   when 'goods_comment' then (select goods_id from public.gp_goods_comments where id = r.target_id) end,
      'text', case r.target when 'post' then (select title from public.gp_posts where id = r.target_id)
                   when 'comment' then (select left(body, 100) from public.gp_comments where id = r.target_id)
                   when 'goods' then (select title from public.gp_goods where id = r.target_id)
                   else (select left(body, 100) from public.gp_goods_comments where id = r.target_id) end)
    order by r.created_at desc) from public.gp_reports r), '[]'::jsonb));
end $$;

-- ---------- 通知（商品へのコメント・ピタっと！を追加） ----------
create or replace function public.gp_notifs(p_token text) returns jsonb language plpgsql
  security definer set search_path = 'public', 'extensions' as $$
declare a public.ka_accounts; seen timestamptz;
begin
  a := public._ka_from_token(p_token);
  if a.id is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
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
    )
    select jsonb_build_object('ok', true,
      'unread', (select count(*) from ev where ev.at > seen),
      'items', coalesce((select jsonb_agg(jsonb_build_object(
          'kind', e.kind, 'post_id', e.post_id, 'goods_id', e.goods_id,
          'post_title', coalesce((select title from public.gp_posts where id = e.post_id), (select title from public.gp_goods where id = e.goods_id)),
          'who', case when e.who is null then null else public._gp_author(e.who) end,
          'body', e.body, 'at', e.at, 'unread', e.at > seen) order by e.at desc)
        from (select * from ev order by at desc limit 30) e), '[]'::jsonb)));
end $$;

-- ---------- 権限 ----------
revoke all on function public._gp_goods_card(public.gp_goods) from public, anon, authenticated;
revoke all on function public.gp_goods_list(text, text, text, text, text, integer), public.gp_goods_get(text, bigint),
  public.gp_goods_save(text, bigint, jsonb), public.gp_goods_delete(text, bigint), public.gp_goods_like(text, bigint),
  public.gp_goods_comment_add(text, bigint, text), public.gp_goods_comment_delete(text, bigint), public.gp_goods_export() from public;
grant execute on function public.gp_goods_list(text, text, text, text, text, integer), public.gp_goods_get(text, bigint),
  public.gp_goods_save(text, bigint, jsonb), public.gp_goods_delete(text, bigint), public.gp_goods_like(text, bigint),
  public.gp_goods_comment_add(text, bigint, text), public.gp_goods_comment_delete(text, bigint), public.gp_goods_export() to anon, authenticated;
