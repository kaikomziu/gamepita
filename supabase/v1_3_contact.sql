-- GamePita v1.3.0: お問い合わせ（マイグレーション gamepita_contact）
-- メールアドレスは集めない。返信は、送った端末（inbox_key）か、ログイン中ならアカウントで見られる。

create table public.gp_inquiries (
  id bigint generated always as identity primary key,
  inbox_key uuid not null,
  ka_id uuid references public.ka_accounts(id) on delete set null,
  category text not null check (category in ('question', 'bug', 'delete', 'report', 'other')),
  name text not null check (char_length(name) between 1 and 40),
  body text not null check (char_length(body) between 1 and 2000),
  reply text check (reply is null or char_length(reply) <= 2000),
  created_at timestamptz not null default now(),
  replied_at timestamptz
);
create index gp_inquiries_inbox_idx on public.gp_inquiries (inbox_key, created_at desc);
create index gp_inquiries_ka_idx on public.gp_inquiries (ka_id, created_at desc);
create index gp_inquiries_created_idx on public.gp_inquiries (created_at desc);
alter table public.gp_inquiries enable row level security;
revoke all on public.gp_inquiries from public, anon, authenticated;

-- 送る（1つの端末から1時間に3件・1日に10件まで）
create or replace function public.gp_inquiry_submit(p_token text, p_inbox_key uuid, p_category text, p_name text, p_body text)
returns jsonb language plpgsql security definer set search_path = 'public', 'extensions' as $$
declare a public.ka_accounts; n text := btrim(coalesce(p_name, '')); b text := btrim(coalesce(p_body, ''));
begin
  a := public._ka_from_token(p_token);
  if p_inbox_key is null then return jsonb_build_object('ok', false, 'reason', 'bad'); end if;
  if p_category not in ('question', 'bug', 'delete', 'report', 'other') then return jsonb_build_object('ok', false, 'reason', 'bad'); end if;
  if char_length(n) not between 1 and 40 then return jsonb_build_object('ok', false, 'reason', 'name'); end if;
  if char_length(b) not between 1 and 2000 then return jsonb_build_object('ok', false, 'reason', 'inquiry'); end if;
  if (select count(*) from public.gp_inquiries where inbox_key = p_inbox_key and created_at > now() - interval '1 hour') >= 3
     or (select count(*) from public.gp_inquiries where inbox_key = p_inbox_key and created_at > now() - interval '1 day') >= 10
     or (a.id is not null and (select count(*) from public.gp_inquiries where ka_id = a.id and created_at > now() - interval '1 day') >= 10) then
    return jsonb_build_object('ok', false, 'reason', 'too_many');
  end if;
  insert into public.gp_inquiries (inbox_key, ka_id, category, name, body) values (p_inbox_key, a.id, p_category, n, b);
  return jsonb_build_object('ok', true);
end $$;

-- 自分が送ったもの（この端末から送ったもの＋ログイン中のアカウントで送ったもの）
create or replace function public.gp_inquiry_mine(p_token text, p_inbox_key uuid)
returns jsonb language plpgsql security definer set search_path = 'public', 'extensions' as $$
declare a public.ka_accounts;
begin
  a := public._ka_from_token(p_token);
  return jsonb_build_object('ok', true, 'items', coalesce((select jsonb_agg(jsonb_build_object(
      'id', q.id, 'category', q.category, 'name', q.name, 'body', q.body, 'reply', q.reply,
      'created_at', q.created_at, 'replied_at', q.replied_at) order by q.created_at desc)
    from (select * from public.gp_inquiries
          where (p_inbox_key is not null and inbox_key = p_inbox_key) or (a.id is not null and ka_id = a.id)
          order by created_at desc limit 50) q), '[]'::jsonb));
end $$;

-- 管理者: 一覧と返信
create or replace function public.gp_admin_inquiries(p_token text)
returns jsonb language plpgsql security definer set search_path = 'public', 'extensions' as $$
declare a public.ka_accounts;
begin
  a := public._ka_from_token(p_token);
  if not coalesce(a.is_admin, false) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  return jsonb_build_object('ok', true, 'items', coalesce((select jsonb_agg(jsonb_build_object(
      'id', q.id, 'category', q.category, 'name', q.name, 'body', q.body, 'reply', q.reply,
      'created_at', q.created_at, 'replied_at', q.replied_at,
      'account', case when q.ka_id is null then null else public._gp_author(q.ka_id) end)
      order by (q.replied_at is null) desc, q.created_at desc)
    from (select * from public.gp_inquiries order by created_at desc limit 200) q), '[]'::jsonb));
end $$;

create or replace function public.gp_admin_inquiry_reply(p_token text, p_id bigint, p_reply text)
returns jsonb language plpgsql security definer set search_path = 'public', 'extensions' as $$
declare a public.ka_accounts; r text := btrim(coalesce(p_reply, ''));
begin
  a := public._ka_from_token(p_token);
  if not coalesce(a.is_admin, false) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if char_length(r) not between 1 and 2000 then return jsonb_build_object('ok', false, 'reason', 'inquiry'); end if;
  update public.gp_inquiries set reply = r, replied_at = now() where id = p_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- 通知に「お問い合わせへの返信」を追加（作り直し）
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
      union all
      select 'reply', null::bigint, null::uuid, left(q.reply, 80), q.replied_at
      from public.gp_inquiries q
      where q.ka_id = a.id and q.replied_at is not null and q.replied_at > now() - interval '60 days'
    )
    select jsonb_build_object('ok', true,
      'unread', (select count(*) from ev where ev.at > seen),
      'items', coalesce((select jsonb_agg(jsonb_build_object(
          'kind', e.kind, 'post_id', e.post_id, 'post_title', (select title from public.gp_posts where id = e.post_id),
          'who', case when e.who is null then null else public._gp_author(e.who) end,
          'body', e.body, 'at', e.at, 'unread', e.at > seen) order by e.at desc)
        from (select * from ev order by at desc limit 30) e), '[]'::jsonb)));
end $$;

revoke all on function public.gp_inquiry_submit(text, uuid, text, text, text), public.gp_inquiry_mine(text, uuid),
  public.gp_admin_inquiries(text), public.gp_admin_inquiry_reply(text, bigint, text) from public;
grant execute on function public.gp_inquiry_submit(text, uuid, text, text, text), public.gp_inquiry_mine(text, uuid),
  public.gp_admin_inquiries(text), public.gp_admin_inquiry_reply(text, bigint, text) to anon, authenticated;
