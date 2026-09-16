-- migrations/0005_form_fields_source.sql
-- ============================================================
-- Dinamicidade de campos: no fluxo /extract/auto, quando a IA reconhece
-- um template JÁ EXISTENTE mas percebe que falta um campo essencial pro
-- conteúdo capturado (ex: nota fiscal sem "emissor"/"destinatário" num
-- template que só tinha número e data), ela grava esse(s) campo(s) novo(s)
-- direto em form_fields — em vez de descartar a informação ou ficar presa
-- ao conjunto fixo que o template já tinha.
--
-- Precisamos marcar a origem de cada campo pelo mesmo motivo que
-- form_templates.source já existe (migration 0004): a
-- GerenciarFormulariosScreen sinaliza "sugerido pela IA" e o usuário decide
-- se mantém ou remove (ela já tem DELETE /templates/{id}/fields/{field_id}).
--
-- Rode isso depois de 0001, 0002, 0003 e 0004 já terem rodado.
-- ============================================================

ALTER TABLE form_fields
  ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'ai_generated'));

-- Campos que vieram junto de um template inteiramente proposto pela IA
-- (form_templates.source = 'ai_generated') também nasceram da IA — alinha
-- o histórico existente com a nova coluna.
UPDATE form_fields
SET source = 'ai_generated'
WHERE form_template_id IN (
  SELECT id FROM form_templates WHERE source = 'ai_generated'
);