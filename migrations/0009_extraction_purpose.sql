-- migrations/0009_extraction_purpose.sql
-- ============================================================
-- Migration 009: finalidade da extracao escolhida pelo usuario
-- ============================================================
-- Antes de capturar, o usuario agora pode indicar a finalidade da
-- extracao (contagem de estoque, analise de documento, relatorio,
-- analise de cenario/objeto/pessoa ou "outros" com instrucao livre).
-- Isso e so CONTEXTO para a IA (ver _AUTO_PROMPT em gemini_service.py) —
-- nao define campos nem cria template. Guardamos aqui apenas para
-- historico/auditoria/reprocessamento.
--
-- Rode isso depois de 0001 a 0008 ja terem rodado.
-- ============================================================

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS extraction_purpose TEXT,
  ADD COLUMN IF NOT EXISTS extraction_custom_instruction TEXT;

-- SEMANTICA:
--   extraction_purpose             — 'STOCK_COUNT' | 'DOCUMENT_ANALYSIS' |
--                                     'REPORT' | 'SCENE_OBJECT_PERSON_ANALYSIS' |
--                                     'OTHER' | NULL (relatorios antigos,
--                                     ou criados no modo guiado com template
--                                     escolhido manualmente, sem passar pela
--                                     tela de escolha de finalidade)
--   extraction_custom_instruction  — texto livre digitado quando
--                                     extraction_purpose = 'OTHER'