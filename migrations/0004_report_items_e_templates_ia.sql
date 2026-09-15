-- migrations/0004_report_items_e_templates_ia.sql
-- ============================================================
-- Fase 1 do plano de "captura primeiro, IA decide depois":
--   - colunas novas em form_templates/form_fields para suportar
--     templates propostos pela IA (source/review_status) e
--     formulários com itens repetidos (has_items/is_item_field);
--   - report_items/report_item_fields, espelhando reports/report_fields,
--     para guardar os itens extraídos quando has_items=TRUE;
--   - RLS nas tabelas novas.
--
-- Rode isso depois de 0001, 0002 e 0003 já terem rodado.
-- ============================================================

-- ─── form_templates: de onde veio o template e se já foi revisado ────────
ALTER TABLE form_templates
  ADD COLUMN has_items BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'ai_generated')),
  ADD COLUMN review_status TEXT NOT NULL DEFAULT 'approved'
    CHECK (review_status IN ('pending', 'approved', 'rejected'));

-- Templates que já existiam antes desta migration foram todos criados à mão
-- (migration 0003) — os defaults acima já deixam isso correto sem UPDATE.

-- ─── form_fields: campo se repete por item ou é único no relatório ───────
ALTER TABLE form_fields
  ADD COLUMN is_item_field BOOLEAN NOT NULL DEFAULT FALSE;

-- ─── report_items ───────────────────────────────────────────
-- Um item dentro de um relatório com has_items=TRUE (ex: cada produto
-- identificado numa foto de prateleira). O id é gerado no app (mesmo
-- padrão de reports.id / captures.id) para permitir upsert idempotente.
CREATE TABLE report_items (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_id   UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── report_item_fields ─────────────────────────────────────
-- Espelha report_fields, mas vinculado a um item em vez de ao relatório
-- inteiro. Mesmas colunas tipadas e mesmos metadados de extração.
CREATE TABLE report_item_fields (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_item_id UUID NOT NULL REFERENCES report_items(id) ON DELETE CASCADE,
  form_field_id  UUID NOT NULL REFERENCES form_fields(id) ON DELETE CASCADE,

  value_text     TEXT,
  value_number   NUMERIC,
  value_boolean  BOOLEAN,
  value_date     DATE,
  value_json     JSONB,

  confidence     NUMERIC(4,3),
  source         TEXT NOT NULL DEFAULT 'manual'
                   CHECK (source IN ('ai', 'manual', 'ai_edited')),
  was_edited     BOOLEAN NOT NULL DEFAULT FALSE,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (report_item_id, form_field_id)
);

-- ============================================================
-- Índices
-- ============================================================
CREATE INDEX idx_report_items_report_id ON report_items(report_id);
CREATE INDEX idx_report_item_fields_report_item_id ON report_item_fields(report_item_id);
CREATE INDEX idx_form_templates_review_status ON form_templates(review_status);

-- ============================================================
-- Row Level Security (RLS)
-- ============================================================
ALTER TABLE report_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_item_fields ENABLE ROW LEVEL SECURITY;

-- Sem policy própria de propósito — mesmo padrão já usado em report_fields,
-- captures e extractions (migration 0001): com RLS ligado e nenhuma policy,
-- só o service_role do backend (que ignora RLS) consegue ler/escrever.
-- Se no futuro o app passar a acessar o Supabase direto com Auth de usuário,
-- adicione aqui uma policy equivalente a "org_isolation_reports", mas
-- indireta via join em reports:
--
-- CREATE POLICY "org_isolation_report_items" ON report_items
--   FOR ALL USING (
--     report_id IN (
--       SELECT id FROM reports
--       WHERE organization_id = (SELECT organization_id FROM users WHERE id = auth.uid())
--     )
--   );

-- ============================================================
-- Trigger: updated_at automático
-- ============================================================
CREATE TRIGGER trg_report_items_updated_at
  BEFORE UPDATE ON report_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_report_item_fields_updated_at
  BEFORE UPDATE ON report_item_fields
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();