-- migrations/0013_fix_reports_delete_policy.sql
-- A policy "reports_delete" (migration 0011) só permitia user_id = auth.uid(),
-- diferente de "reports_select"/"reports_update", que também liberam para
-- quem está na mesma organization_id. Um relatório sem user_id (dado antigo,
-- de antes da 0011) ou de outro usuário da mesma org nunca podia ser
-- apagado por RLS — o DELETE simplesmente afetava zero linhas, sem erro
-- nenhum, e a API interpretava isso como "relatório não existe".

drop policy if exists "reports_delete" on public.reports;

create policy "reports_delete"
on public.reports
for delete
to authenticated
using (
    user_id = auth.uid()
    or (
        organization_id is not null
        and organization_id = private.current_user_organization_id()
    )
);
