-- ============================================================
-- Migration 005: Schema dinamico — suporte a registros sem template
-- ============================================================
-- Execute este arquivo no SQL Editor do Supabase (uma vez).
-- Compativel com dados existentes: apenas adiciona colunas/relaxa constraints.
-- ============================================================

-- ─── reports: tornar form_template_id opcional ───────────────
ALTER TABLE reports
  ALTER COLUMN form_template_id DROP NOT NULL;

-- ─── reports: adicionar metadados de contexto da IA ──────────
ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS context_label TEXT,
  ADD COLUMN IF NOT EXISTS context_type  TEXT;

-- EXEMPLOS:
--   context_label = 'Nota Fiscal Eletronica'
--   context_type  = 'nota_fiscal'
-- Ficam NULL para relatorios criados com template (modo guiado antigo).

-- ─── report_fields: tornar form_field_id opcional ────────────
ALTER TABLE report_fields
  ALTER COLUMN form_field_id DROP NOT NULL;

-- Campos dinamicos (descobertos pela IA sem template) nao tem form_field_id.
-- A restricao UNIQUE (report_id, form_field_id) nao funciona com NULLs
-- multiplos no Postgres — precisamos remover e criar uma restricao parcial.
ALTER TABLE report_fields
  DROP CONSTRAINT IF EXISTS report_fields_report_id_form_field_id_key;

-- Constraint apenas para campos guiados (com form_field_id nao nulo)
CREATE UNIQUE INDEX IF NOT EXISTS uq_report_fields_guided
  ON report_fields (report_id, form_field_id)
  WHERE form_field_id IS NOT NULL;

-- ─── report_fields: colunas para campos dinamicos ────────────
ALTER TABLE report_fields
  ADD COLUMN IF NOT EXISTS dynamic_key   TEXT,
  ADD COLUMN IF NOT EXISTS dynamic_label TEXT,
  ADD COLUMN IF NOT EXISTS dynamic_type  TEXT;

-- SEMANTICA:
--   dynamic_key   — chave gerada pela IA (ex: "numero_nf")
--   dynamic_label — rotulo gerado pela IA (ex: "Numero da Nota Fiscal")
--   dynamic_type  — tipo inferido (ex: "text", "date", "number")
-- Ficam NULL para campos guiados (que usam form_field_id -> form_fields).

-- ─── report_fields: rastrear fonte da informacao ─────────────
ALTER TABLE report_fields
  ADD COLUMN IF NOT EXISTS input_source TEXT
    CHECK (input_source IN ('image', 'audio', 'text', 'combined', 'manual'));

-- SEMANTICA:
--   'image'    — valor extraido de uma foto
--   'audio'    — valor extraido de gravacao de voz
--   'text'     — valor extraido de texto digitado pelo usuario
--   'combined' — valor extraido de multiplas fontes (foto + voz, etc.)
--   'manual'   — valor inserido manualmente pelo usuario na revisao

-- ─── Indice para buscas por context_type ─────────────────────
CREATE INDEX IF NOT EXISTS idx_reports_context_type ON reports(context_type);

-- ─── Verificacao final ────────────────────────────────────────
-- Rode esta query para confirmar que a migracao foi aplicada:
-- SELECT column_name, is_nullable, data_type
-- FROM information_schema.columns
-- WHERE table_name IN ('reports', 'report_fields')
--   AND column_name IN (
--     'form_template_id', 'context_label', 'context_type',
--     'form_field_id', 'dynamic_key', 'dynamic_label', 'dynamic_type', 'input_source'
--   )
-- ORDER BY table_name, column_name;
