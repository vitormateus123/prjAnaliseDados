-- 0012_ensure_user_profiles.sql
-- Contas no Auth sem linha em public.users recebem 403 em toda a API.
-- Esta migration: (1) preenche perfis que faltam, (2) cria perfil em todo
-- signup novo, (3) permite que o próprio usuário insira a linha.
insert into public.users (id, name, role)
select
  u.id,
  left(
    coalesce(
      nullif(u.raw_user_meta_data->>'name', ''),
      nullif(u.raw_user_meta_data->>'full_name', ''),
      split_part(coalesce(u.email, ''), '@', 1),
      'Usuário'
    ),
    120
  ),
  'field_agent'
from auth.users u
where not exists (select 1 from public.users p where p.id = u.id)
on conflict (id) do nothing;
create or replace function public.ensure_own_profile()
returns public.users
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  row public.users;
  display_name text;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  select left(
    coalesce(
      nullif(raw_user_meta_data->>'name', ''),
      nullif(raw_user_meta_data->>'full_name', ''),
      split_part(coalesce(email, ''), '@', 1),
      'Usuário'
    ),
    120
  )
  into display_name
  from auth.users
  where id = uid;
  insert into public.users (id, name, role)
  values (uid, coalesce(display_name, 'Usuário'), 'field_agent')
  on conflict (id) do nothing;
  select * into row from public.users where id = uid;
  return row;
end;
$$;
revoke all on function public.ensure_own_profile() from public;
grant execute on function public.ensure_own_profile() to authenticated;
grant execute on function public.ensure_own_profile() to service_role;
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, name, role)
  values (
    new.id,
    left(
      coalesce(
        nullif(new.raw_user_meta_data->>'name', ''),
        nullif(new.raw_user_meta_data->>'full_name', ''),
        split_part(coalesce(new.email, ''), '@', 1),
        'Usuário'
      ),
      120
    ),
    'field_agent'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();
drop policy if exists "users_insert_own_profile" on public.users;
create policy "users_insert_own_profile"
on public.users
for insert
to authenticated
with check (id = auth.uid());