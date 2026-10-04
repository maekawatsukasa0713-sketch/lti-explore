-- Keep initial and reset passwords valid for about six months (180 days).
-- The account Edge Function may submit a shorter timestamp; the database is the source of truth.
create or replace function public.lti_enforce_initial_password_expiry()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.must_change_password is true
     and new.initial_password_expires_at is not null
     and (
       tg_op = 'INSERT'
       or old.must_change_password is distinct from new.must_change_password
       or old.initial_password_expires_at is distinct from new.initial_password_expires_at
     )
  then
    new.initial_password_expires_at := now() + interval '180 days';
  end if;
  return new;
end;
$$;

drop trigger if exists lti_enforce_initial_password_expiry on public.lti_profiles;
create trigger lti_enforce_initial_password_expiry
before insert or update on public.lti_profiles
for each row
execute function public.lti_enforce_initial_password_expiry();
