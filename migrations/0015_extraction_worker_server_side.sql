-- migrations/0015_extraction_worker_server_side.sql
-- ============================================================
-- Migration 015: extração offline feita SÓ no servidor
-- ============================================================
-- Rode depois da 0014.
--
-- 1) private.set_report_identity (0011) rodava em INSERT *e* UPDATE e
--    levantava 'not authenticated' quando auth.uid() era NULL. O worker usa a
--    service key (auth.uid() NULL), então TODO update dele em reports falhava.
--    Além disso, em UPDATE ele reatribuía user_id := auth.uid(), passando a
--    posse do relatório para quem editou por último.
--    Agora: INSERT define a identidade a partir do JWT; UPDATE a preserva.
--
-- 2) Guarda no banco contra rebaixamento de extraction_status: se o servidor
--    já está 'processing' ou 'done', um sync atrasado do app (que ainda
--    carrega 'pending') não pode voltar o status para 'pending' — senão a
--    extração rodaria em duplicidade. Só o servidor (service key,
--    auth.uid() NULL) pode reabrir um relatório para 'pending' (retry).
-- ============================================================

create or replace function private.set_report_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if tg_op = 'INSERT' then
        if auth.uid() is null then
            raise exception 'not authenticated';
        end if;

        new.user_id := auth.uid();
        new.organization_id := private.current_user_organization_id();
    else
        -- UPDATE: a identidade do relatório é imutável (e o worker, que usa a
        -- service key, também passa por aqui com auth.uid() NULL).
        new.user_id := old.user_id;
        new.organization_id := old.organization_id;
    end if;

    return new;
end;
$$;

create or replace function private.guard_extraction_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is not null
       and old.extraction_status in ('processing', 'done')
       and new.extraction_status = 'pending' then
        new.extraction_status := old.extraction_status;
        new.extraction_attempts := old.extraction_attempts;
        new.extraction_last_error := old.extraction_last_error;
    end if;

    return new;
end;
$$;

drop trigger if exists trg_guard_extraction_status on public.reports;

create trigger trg_guard_extraction_status
before update on public.reports
for each row
execute function private.guard_extraction_status();