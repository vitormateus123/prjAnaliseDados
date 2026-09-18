-- migrations/0008_dynamic_item_fields.sql
-- ============================================================
-- Migration 008: itens dinamicos em report_item_fields
-- ============================================================
-- A migration 0005 tornou report_fields.form_field_id opcional e
-- adicionou dynamic_key/dynamic_label/dynamic_type, para permitir campos
-- de nivel de relatorio sem template (ex: fallback "informacao nao
-- estruturada"). O mesmo nunca foi feito em report_item_fields — os
-- ITENS de um relatorio (ex: cada produto de uma contagem de estoque)
-- continuavam presos a form_field_id NOT NULL.
--
-- Isso passa a ser necessario com a finalidade "STOCK_COUNT"/"OTHER" no
-- modo automatico: quando nenhum formulario cadastrado serve, a IA propoe
-- itens (ex: produto/quantidade/unidade) sem nenhum form_template por
-- tras. Sem esta migration, o INSERT em report_item_fields falharia no
-- NOT NULL de form_field_id.
--
-- Rode isso depois de 0001 a 0007 ja terem rodado.
-- ============================================================

-- ─── report_item_fields: form_field_id vira opcional ──────────────────
ALTER TABLE report_item_fields
  ALTER COLUMN form_field_id DROP NOT NULL;

-- A UNIQUE (report_item_id, form_field_id) original nao funciona com
-- multiplos NULLs (mesmo problema resolvido na migration 0005 para
-- report_fields) — troca por indice unico parcial.
ALTER TABLE report_item_fields
  DROP CONSTRAINT IF EXISTS report_item_fields_report_item_id_form_field_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_report_item_fields_guided
  ON report_item_fields (report_item_id, form_field_id)
  WHERE form_field_id IS NOT NULL;

-- ─── report_item_fields: colunas para campos dinamicos ────────────────
-- Mesma semantica de report_fields.dynamic_key/dynamic_label/dynamic_type
-- (migration 0005): preenchidas quando form_field_id e NULL.
ALTER TABLE report_item_fields
  ADD COLUMN IF NOT EXISTS dynamic_key   TEXT,
  ADD COLUMN IF NOT EXISTS dynamic_label TEXT,
  ADD COLUMN IF NOT EXISTS dynamic_type  TEXT;

-- ─── Verificacao final ──────────────────────────────────────────────────
-- SELECT column_name, is_nullable, data_type
-- FROM information_schema.columns
-- WHERE table_name = 'report_item_fields'
--   AND column_name IN ('form_field_id', 'dynamic_key', 'dynamic_label', 'dynamic_type')
-- ORDER BY column_name;