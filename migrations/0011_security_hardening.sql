-- 0011_security_hardening.sql
-- Segurança/autorização por usuário e organização.
-- Não altera nem remove dados existentes.

create schema if not exists private;

-- ============================================================
-- Helpers de autorização
-- ============================================================

create or replace function private.current_user_organization_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
    select organization_id
    from public.users
    where id = auth.uid()
    limit 1;
$$;

create or replace function private.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
    select role
    from public.users
    where id = auth.uid()
    limit 1;
$$;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(private.current_user_role() = 'admin', false);
$$;

create or replace function private.can_access_report(target_report_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.reports r
        where id = target_report_id
          and (
              r.user_id = auth.uid()
              or (
                  r.organization_id is not null
                  and r.organization_id = private.current_user_organization_id()
              )
          )
    );
$$;

-- ============================================================
-- Usuários
-- ============================================================

drop policy if exists "own_user_profile" on public.users;

create policy "users_select_own_profile"
on public.users
for select
to authenticated
using (
    id = auth.uid()
);

-- Usuário autenticado não pode alterar role/org/id pelo cliente.
-- Alterações administrativas devem ocorrer pelo backend/service role.

-- ============================================================
-- Organizações
-- ============================================================

drop policy if exists "organizations_select" on public.organizations;

create policy "organizations_select_own"
on public.organizations
for select
to authenticated
using (
    id = private.current_user_organization_id()
);

-- ============================================================
-- Templates
-- ============================================================

drop policy if exists "org_isolation_form_templates"
on public.form_templates;

create policy "form_templates_select"
on public.form_templates
for select
to authenticated
using (
    organization_id is null
    or organization_id = private.current_user_organization_id()
);

create policy "form_templates_admin_insert"
on public.form_templates
for insert
to authenticated
with check (
    private.is_admin()
    and (
        organization_id is null
        or organization_id = private.current_user_organization_id()
    )
);

create policy "form_templates_admin_update"
on public.form_templates
for update
to authenticated
using (
    private.is_admin()
    and (
        organization_id is null
        or organization_id = private.current_user_organization_id()
    )
)
with check (
    private.is_admin()
    and (
        organization_id is null
        or organization_id = private.current_user_organization_id()
    )
);

create policy "form_templates_admin_delete"
on public.form_templates
for delete
to authenticated
using (
    private.is_admin()
);

-- ============================================================
-- Campos dos templates
-- ============================================================

drop policy if exists "authenticated_form_fields_access"
on public.form_fields;

create policy "form_fields_select"
on public.form_fields
for select
to authenticated
using (
    exists (
        select 1
        from public.form_templates ft
        where ft.id = form_fields.template_id
          and (
              ft.organization_id is null
              or ft.organization_id = private.current_user_organization_id()
          )
    )
);

create policy "form_fields_admin_insert"
on public.form_fields
for insert
to authenticated
with check (
    private.is_admin()
    and exists (
        select 1
        from public.form_templates ft
        where ft.id = form_fields.template_id
          and (
              ft.organization_id is null
              or ft.organization_id = private.current_user_organization_id()
          )
    )
);

create policy "form_fields_admin_update"
on public.form_fields
for update
to authenticated
using (
    private.is_admin()
    and exists (
        select 1
        from public.form_templates ft
        where ft.id = form_fields.template_id
          and (
              ft.organization_id is null
              or ft.organization_id = private.current_user_organization_id()
          )
    )
)
with check (
    private.is_admin()
    and exists (
        select 1
        from public.form_templates ft
        where ft.id = form_fields.template_id
          and (
              ft.organization_id is null
              or ft.organization_id = private.current_user_organization_id()
          )
    )
);

create policy "form_fields_admin_delete"
on public.form_fields
for delete
to authenticated
using (
    private.is_admin()
);

-- ============================================================
-- Reports
-- ============================================================

drop policy if exists "org_isolation_reports"
on public.reports;

create policy "reports_select"
on public.reports
for select
to authenticated
using (
    user_id = auth.uid()
    or (
        organization_id is not null
        and organization_id = private.current_user_organization_id()
    )
);

create policy "reports_insert"
on public.reports
for insert
to authenticated
with check (
    user_id = auth.uid()
    and (
        organization_id is null
        or organization_id = private.current_user_organization_id()
    )
);

create policy "reports_update"
on public.reports
for update
to authenticated
using (
    user_id = auth.uid()
    or (
        organization_id is not null
        and organization_id = private.current_user_organization_id()
    )
)
with check (
    user_id = auth.uid()
    or (
        organization_id is not null
        and organization_id = private.current_user_organization_id()
    )
);

create policy "reports_delete"
on public.reports
for delete
to authenticated
using (
    user_id = auth.uid()
);

-- ============================================================
-- Garante identidade do relatório no banco.
-- O cliente não escolhe outro usuário.
-- ============================================================

create or replace function private.set_report_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is null then
        raise exception 'not authenticated';
    end if;

    new.user_id := auth.uid();
    new.organization_id := private.current_user_organization_id();

    return new;
end;
$$;

drop trigger if exists trg_set_report_identity on public.reports;

create trigger trg_set_report_identity
before insert or update on public.reports
for each row
execute function private.set_report_identity();

-- ============================================================
-- Report fields
-- ============================================================

drop policy if exists "report_fields_access"
on public.report_fields;

create policy "report_fields_select"
on public.report_fields
for select
to authenticated
using (
    private.can_access_report(report_id)
);

create policy "report_fields_insert"
on public.report_fields
for insert
to authenticated
with check (
    private.can_access_report(report_id)
    and (
        form_field_id is null
        or exists (
            select 1
            from public.reports r
            join public.form_templates ft
              on ft.id = r.form_template_id
            join public.form_fields ff
              on ff.id = report_fields.form_field_id
            where r.id = report_fields.report_id
              and ff.template_id = ft.id
        )
    )
);

create policy "report_fields_update"
on public.report_fields
for update
to authenticated
using (
    private.can_access_report(report_id)
)
with check (
    private.can_access_report(report_id)
);

create policy "report_fields_delete"
on public.report_fields
for delete
to authenticated
using (
    private.can_access_report(report_id)
);

-- ============================================================
-- Report items
-- ============================================================

drop policy if exists "report_items_access"
on public.report_items;

create policy "report_items_select"
on public.report_items
for select
to authenticated
using (
    private.can_access_report(report_id)
);

create policy "report_items_insert"
on public.report_items
for insert
to authenticated
with check (
    private.can_access_report(report_id)
);

create policy "report_items_update"
on public.report_items
for update
to authenticated
using (
    private.can_access_report(report_id)
)
with check (
    private.can_access_report(report_id)
);

create policy "report_items_delete"
on public.report_items
for delete
to authenticated
using (
    private.can_access_report(report_id)
);

-- ============================================================
-- Report item fields
-- ============================================================

drop policy if exists "report_item_fields_access"
on public.report_item_fields;

create policy "report_item_fields_select"
on public.report_item_fields
for select
to authenticated
using (
    exists (
        select 1
        from public.report_items ri
        where ri.id = report_item_fields.report_item_id
          and private.can_access_report(ri.report_id)
    )
);

create policy "report_item_fields_insert"
on public.report_item_fields
for insert
to authenticated
with check (
    exists (
        select 1
        from public.report_items ri
        where ri.id = report_item_fields.report_item_id
          and private.can_access_report(ri.report_id)
    )
);

create policy "report_item_fields_update"
on public.report_item_fields
for update
to authenticated
using (
    exists (
        select 1
        from public.report_items ri
        where ri.id = report_item_fields.report_item_id
          and private.can_access_report(ri.report_id)
    )
)
with check (
    exists (
        select 1
        from public.report_items ri
        where ri.id = report_item_fields.report_item_id
          and private.can_access_report(ri.report_id)
    )
);

create policy "report_item_fields_delete"
on public.report_item_fields
for delete
to authenticated
using (
    exists (
        select 1
        from public.report_items ri
        where ri.id = report_item_fields.report_item_id
          and private.can_access_report(ri.report_id)
    )
);

-- ============================================================
-- Captures
-- ============================================================

drop policy if exists "captures_access"
on public.captures;

create policy "captures_select"
on public.captures
for select
to authenticated
using (
    private.can_access_report(report_id)
);

create policy "captures_insert"
on public.captures
for insert
to authenticated
with check (
    private.can_access_report(report_id)
);

create policy "captures_update"
on public.captures
for update
to authenticated
using (
    private.can_access_report(report_id)
)
with check (
    private.can_access_report(report_id)
);

create policy "captures_delete"
on public.captures
for delete
to authenticated
using (
    private.can_access_report(report_id)
);

-- ============================================================
-- Extractions
-- ============================================================

drop policy if exists "extractions_access"
on public.extractions;

create policy "extractions_select"
on public.extractions
for select
to authenticated
using (
    private.can_access_report(report_id)
);

create policy "extractions_insert"
on public.extractions
for insert
to authenticated
with check (
    private.can_access_report(report_id)
);

create policy "extractions_update"
on public.extractions
for update
to authenticated
using (
    private.can_access_report(report_id)
)
with check (
    private.can_access_report(report_id)
);

create policy "extractions_delete"
on public.extractions
for delete
to authenticated
using (
    private.can_access_report(report_id)
);

-- ============================================================
-- Storage: captures
--
-- Caminho atual:
-- <report_id>/<capture_id>.<ext>
-- ============================================================

drop policy if exists "org_captures_access"
on storage.objects;

create policy "captures_storage_select"
on storage.objects
for select
to authenticated
using (
    bucket_id = 'captures'
    and split_part(name, '/', 1) ~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
    and private.can_access_report(
        split_part(name, '/', 1)::uuid
    )
);

create policy "captures_storage_insert"
on storage.objects
for insert
to authenticated
with check (
    bucket_id = 'captures'
    and split_part(name, '/', 1) ~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
    and private.can_access_report(
        split_part(name, '/', 1)::uuid
    )
);

create policy "captures_storage_update"
on storage.objects
for update
to authenticated
using (
    bucket_id = 'captures'
    and split_part(name, '/', 1) ~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
    and private.can_access_report(
        split_part(name, '/', 1)::uuid
    )
)
with check (
    bucket_id = 'captures'
    and split_part(name, '/', 1) ~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
    and private.can_access_report(
        split_part(name, '/', 1)::uuid
    )
);

create policy "captures_storage_delete"
    on storage.objects
    for delete
    to authenticated
    using (
        bucket_id = 'captures'
        and split_part(name, '/', 1) ~
            '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
        and private.can_access_report(
            split_part(name, '/', 1)::uuid
        )
);

-- ============================================================
-- Permissões dos helpers
-- ============================================================

grant usage on schema private to authenticated;

grant execute on function private.current_user_organization_id()
to authenticated;

grant execute on function private.current_user_role()
to authenticated;

grant execute on function private.is_admin()
to authenticated;

grant execute on function private.can_access_report(uuid)
to authenticated;

grant execute on function private.set_report_identity()
to authenticated;

-- ============================================================
-- Índices para as verificações de autorização
-- ============================================================

create index if not exists idx_reports_user_id
    on public.reports(user_id);

create index if not exists idx_reports_organization_id
    on public.reports(organization_id);

create index if not exists idx_report_fields_report_id
    on public.report_fields(report_id);

create index if not exists idx_report_items_report_id
    on public.report_items(report_id);

create index if not exists idx_report_item_fields_item_id
    on public.report_item_fields(report_item_id);

create index if not exists idx_captures_report_id
    on public.captures(report_id);

create index if not exists idx_extractions_report_id
    on public.extractions(report_id);