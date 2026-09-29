-- Private support inbox. Existing lti_role enforces active sessions, initial setup and MFA.
create table public.lti_support_messages (
 id uuid primary key default gen_random_uuid(),
 sender_id uuid not null default auth.uid() references public.lti_profiles(id),
 school_id text not null,
 school_name text not null,
 sender_name text not null,
 sender_role text not null check (sender_role in ('teacher','student')),
 category text not null check (category in ('機能追加の希望','不具合・修正依頼','その他')),
 subject text not null check (char_length(btrim(subject)) between 1 and 120),
 body text not null check (char_length(btrim(body)) between 1 and 5000),
 status text not null default '未対応' check (status in ('未対応','対応中','対応済み')),
 reply text not null default '' check (char_length(reply)<=5000),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index lti_support_sender_created on public.lti_support_messages(sender_id,created_at desc);
create index lti_support_status_created on public.lti_support_messages(status,created_at desc);
alter table public.lti_support_messages enable row level security;
revoke all on public.lti_support_messages from public,anon,authenticated;
grant select on public.lti_support_messages to authenticated;
grant insert (id,category,subject,body) on public.lti_support_messages to authenticated;
grant update (status,reply) on public.lti_support_messages to authenticated;
grant all on public.lti_support_messages to service_role;
create policy support_read on public.lti_support_messages for select to authenticated
 using ((select public.lti_role())='admin' or ((select public.lti_role()) in ('teacher','student') and sender_id=(select auth.uid())));
create policy support_send on public.lti_support_messages for insert to authenticated
 with check ((select public.lti_role()) in ('teacher','student') and sender_id=(select auth.uid()) and school_id=(select public.lti_school()));
create policy support_manage on public.lti_support_messages for update to authenticated
 using ((select public.lti_role())='admin') with check ((select public.lti_role())='admin');
create function public.lti_support_prepare() returns trigger language plpgsql security invoker set search_path='' as $$
declare p public.lti_profiles; role_name text;
begin
 role_name:=public.lti_role();
 if TG_OP='INSERT' then
  if role_name is null or role_name not in ('teacher','student') then raise exception '送信する権限がありません'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,1731));
  if (select count(*) from public.lti_support_messages where sender_id=auth.uid() and created_at>now()-interval '1 hour')>=10 then
   raise exception '1時間に送信できるのは10件までです。時間をおいてお試しください';
  end if;
  select * into strict p from public.lti_profiles where id=auth.uid();
  new.sender_id:=p.id; new.school_id:=p.school_id; new.sender_name:=p.name; new.sender_role:=role_name;
  select name into new.school_name from public.lti_schools where id=p.school_id;
  new.subject:=btrim(new.subject); new.body:=btrim(new.body);
  new.status:='未対応'; new.reply:=''; new.created_at:=now();
 elsif role_name is distinct from 'admin' then raise exception '運営のみ更新できます';
 end if;
 new.updated_at:=now(); return new;
end $$;
revoke all on function public.lti_support_prepare() from public,anon,authenticated;
create trigger support_prepare before insert or update on public.lti_support_messages for each row execute function public.lti_support_prepare();
