-- migrations/0006_captures_text_type.sql
-- ============================================================
-- Texto digitado passa a ser uma modalidade de entrada de primeira classe,
-- igual a foto e voz (ver Captura.tsx: botão "Escrever" + POST /extract/auto
-- com media_type='text'). Sem isso, o INSERT em captures falhava no
-- CHECK constraint original, que só aceitava 'voice'/'photo'/'manual'.
-- ============================================================

ALTER TABLE captures DROP CONSTRAINT captures_type_check;
ALTER TABLE captures ADD CONSTRAINT captures_type_check
  CHECK (type IN ('voice', 'photo', 'text', 'manual'));