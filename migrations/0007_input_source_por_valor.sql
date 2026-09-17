-- migrations/0007_input_source_por_valor.sql
-- ============================================================
-- Captura agora pode combinar mais de uma fonte (foto + áudio + texto na
-- mesma captura — ver POST /extract/auto). "source" em report_fields já
-- existia, mas com outro significado (quem preencheu o valor: 'ai',
-- 'manual' ou 'ai_edited'). Esta coluna nova guarda de QUAL FONTE o valor
-- veio ('image', 'audio' ou 'text') — útil pra auditoria/revisão quando a
-- captura combinou várias modalidades e o usuário quer entender de onde
-- cada valor saiu. NULL quando não se aplica (ex: valor preenchido manual).
--
-- Rode isso depois de 0001 a 0006 já terem rodado.
-- ============================================================

ALTER TABLE report_fields
  ADD COLUMN IF NOT EXISTS input_source TEXT
    CHECK (input_source IN ('image', 'audio', 'text'));

ALTER TABLE report_item_fields
  ADD COLUMN IF NOT EXISTS input_source TEXT
    CHECK (input_source IN ('image', 'audio', 'text'));
