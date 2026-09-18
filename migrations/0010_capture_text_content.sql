-- migrations/0010_capture_text_content.sql
-- ============================================================
-- Migration 010: permanencia da fonte de origem (imagem/audio/texto)
-- ============================================================
-- Ate aqui, so o VALOR extraido pela IA era persistido — a midia/texto de
-- origem nunca era guardada de verdade:
--   - captures.file_url nunca era preenchido (o app so mandava local_path,
--     um URI do dispositivo, que nao serve pra nada fora dele);
--   - captures do tipo 'text' nao guardavam o texto digitado em lugar
--     nenhum (so era usado na hora da extracao e descartado).
--
-- Esta migration resolve a parte de texto: adiciona a coluna onde o texto
-- digitado passa a ser gravado. A parte de imagem/audio usa a coluna
-- file_url que ja existia (migration 0001) — agora de fato preenchida pelo
-- backend com o caminho do arquivo no bucket 'captures' (migration 0002)
-- apos o upload feito em POST /reports/.
--
-- Rode isso depois de 0001 a 0009 ja terem rodado.
-- ============================================================

ALTER TABLE captures
  ADD COLUMN IF NOT EXISTS text_content TEXT;

-- SEMANTICA:
--   text_content — texto digitado pelo usuario nesta capture (type='text').
--                  NULL para captures de foto/audio (a fonte delas fica em
--                  file_url, apontando pro arquivo no Storage).
