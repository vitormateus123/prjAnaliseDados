-- migrations/0012_capture_transcript.sql
-- ============================================================
-- Migration 012: transcrição da captura de voz
-- ============================================================
-- Ate aqui, o audio de uma capture do tipo 'voice' era transcrito pelo
-- Groq/Whisper so como passo INTERNO da extracao (ver groq_service.py) —
-- o texto da transcricao nunca era devolvido ao app nem persistido em
-- lugar nenhum, so usado na hora de alimentar o Gemini e depois descartado.
--
-- Esta migration adiciona a coluna onde essa transcricao passa a ser
-- gravada de verdade, no mesmo padrao de captures.text_content (migration
-- 0010) — permanencia da fonte de origem da extracao, agora tambem em
-- texto legivel para audio.
--
-- Rode isso depois de 0001 a 0011 ja terem rodado.
-- ============================================================

ALTER TABLE captures
  ADD COLUMN IF NOT EXISTS transcript TEXT;

-- SEMANTICA:
--   transcript — texto transcrito automaticamente (Whisper via Groq) do
--                audio desta capture (type='voice'). NULL para fotos/texto
--                digitado, e tambem NULL quando a transcricao nao foi
--                gerada (ex: relatorio criado antes desta migration, ou
--                extracao que falhou antes de transcrever).
