-- migrations/0003_seed_form_templates.sql
-- Popula form_templates + form_fields com os 3 formulários que hoje estão
-- hardcoded em src/mock/formTemplates.ts. Rode isso uma vez no SQL Editor
-- do Supabase, depois que 0001 e 0002 já tiverem rodado.
--
-- organization_id fica NULL de propósito (ainda não há multi-organização
-- em uso) — se isso mudar, ajuste aqui e no RLS.

-- ─── 1. Análise de Documento ───────────────────────────────
WITH novo_template AS (
  INSERT INTO form_templates (name, description, version, active)
  VALUES ('Análise de Documento', 'Extração de informações de documentos oficiais', 1, TRUE)
  RETURNING id
)
INSERT INTO form_fields (form_template_id, key, label, type, required, position, extraction_hint, options)
SELECT id, key, label, type, required, position, extraction_hint, options
FROM novo_template, (VALUES
  ('numero_documento', 'Número do Documento', 'text', TRUE, 0,
    'Identifique o número ou código oficial presente no documento (ex: 123/2026).', NULL::jsonb),
  ('tipo_documento', 'Tipo de Documento', 'select', TRUE, 1,
    'Identifique o tipo do documento entre as opções disponíveis.',
    '["Ofício","Memorando","Contrato","Nota Fiscal","Laudo","Outro"]'::jsonb),
  ('data_documento', 'Data do Documento', 'date', FALSE, 2,
    'Identifique a data de emissão do documento no formato DD/MM/AAAA.', NULL::jsonb),
  ('orgao_emissor', 'Órgão Emissor', 'text', FALSE, 3,
    'Nome da instituição ou órgão que emitiu o documento.', NULL::jsonb),
  ('assunto', 'Assunto', 'long_text', FALSE, 4,
    'Resumo do assunto ou objetivo principal do documento.', NULL::jsonb),
  ('observacoes', 'Observações', 'long_text', FALSE, 5,
    'Qualquer informação adicional relevante que não se encaixe nos campos acima.', NULL::jsonb)
) AS f(key, label, type, required, position, extraction_hint, options);

-- ─── 2. Contagem de Estoque ─────────────────────────────────
WITH novo_template AS (
  INSERT INTO form_templates (name, description, version, active)
  VALUES ('Contagem de Estoque', 'Registro de inventário e contagem de itens', 1, TRUE)
  RETURNING id
)
INSERT INTO form_fields (form_template_id, key, label, type, required, position, extraction_hint, options, validation_rules)
SELECT id, key, label, type, required, position, extraction_hint, options, validation_rules
FROM novo_template, (VALUES
  ('produto', 'Produto', 'text', TRUE, 0,
    'Nome do produto ou material contado.', NULL::jsonb, NULL::jsonb),
  ('codigo', 'Código / SKU', 'text', FALSE, 1,
    'Código, SKU ou número de referência do produto, se mencionado.', NULL::jsonb, NULL::jsonb),
  ('quantidade', 'Quantidade', 'number', TRUE, 2,
    'Quantidade total de unidades contadas. Se for foto, conte os itens visíveis.',
    NULL::jsonb, '{"min":0}'::jsonb),
  ('unidade', 'Unidade de Medida', 'select', FALSE, 3,
    'Unidade de medida da quantidade informada.',
    '["unidade","caixa","kg","litro","metro","pacote"]'::jsonb, NULL::jsonb),
  ('local', 'Local / Setor', 'text', FALSE, 4,
    'Onde o item está armazenado (ex: Galpão 3, Prateleira B2).', NULL::jsonb, NULL::jsonb),
  ('observacoes', 'Observações', 'long_text', FALSE, 5,
    'Estado do produto, divergências ou observações adicionais.', NULL::jsonb, NULL::jsonb)
) AS f(key, label, type, required, position, extraction_hint, options, validation_rules);

-- ─── 3. Inspeção de Campo ───────────────────────────────────
WITH novo_template AS (
  INSERT INTO form_templates (name, description, version, active)
  VALUES ('Inspeção de Campo', 'Registro de inspeções e vistorias em campo', 1, TRUE)
  RETURNING id
)
INSERT INTO form_fields (form_template_id, key, label, type, required, position, extraction_hint, options)
SELECT id, key, label, type, required, position, extraction_hint, options
FROM novo_template, (VALUES
  ('local', 'Local Inspecionado', 'text', TRUE, 0,
    'Nome ou descrição do local inspecionado.', NULL::jsonb),
  ('data', 'Data da Inspeção', 'date', TRUE, 1,
    'Data em que a inspeção foi realizada.', NULL::jsonb),
  ('responsavel', 'Responsável', 'text', FALSE, 2,
    'Nome do responsável pela inspeção ou pelo local.', NULL::jsonb),
  ('condicao', 'Condição Geral', 'select', FALSE, 3,
    'Avaliação geral das condições do local: boa, regular, ruim ou crítica.',
    '["Boa","Regular","Ruim","Crítica"]'::jsonb),
  ('problema_identificado', 'Problema Identificado', 'long_text', FALSE, 4,
    'Descreva qualquer problema, falha, risco ou não conformidade encontrada.', NULL::jsonb),
  ('observacoes', 'Observações', 'long_text', FALSE, 5,
    'Informações complementares sobre a inspeção.', NULL::jsonb)
) AS f(key, label, type, required, position, extraction_hint, options);
