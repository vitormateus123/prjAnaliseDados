// src/mock/formTemplates.ts
// 3 formulários de exemplo que demonstram a generalidade do sistema

import { FormTemplate } from '../types/forms';

export const MOCK_FORM_TEMPLATES: FormTemplate[] = [
  {
    id: 'form-analise-documento',
    name: 'Análise de Documento',
    description: 'Extração de informações de documentos oficiais',
    version: 1,
    active: true,
    fields: [
      {
        id: 'f1', key: 'numero_documento', label: 'Número do Documento',
        type: 'text', required: true, position: 0,
        extraction_hint: 'Identifique o número ou código oficial presente no documento (ex: 123/2026).',
      },
      {
        id: 'f2', key: 'tipo_documento', label: 'Tipo de Documento',
        type: 'select', required: true, position: 1,
        options: ['Ofício', 'Memorando', 'Contrato', 'Nota Fiscal', 'Laudo', 'Outro'],
        extraction_hint: 'Identifique o tipo do documento entre as opções disponíveis.',
      },
      {
        id: 'f3', key: 'data_documento', label: 'Data do Documento',
        type: 'date', required: false, position: 2,
        extraction_hint: 'Identifique a data de emissão do documento no formato DD/MM/AAAA.',
      },
      {
        id: 'f4', key: 'orgao_emissor', label: 'Órgão Emissor',
        type: 'text', required: false, position: 3,
        extraction_hint: 'Nome da instituição ou órgão que emitiu o documento.',
      },
      {
        id: 'f5', key: 'assunto', label: 'Assunto',
        type: 'long_text', required: false, position: 4,
        extraction_hint: 'Resumo do assunto ou objetivo principal do documento.',
      },
      {
        id: 'f6', key: 'observacoes', label: 'Observações',
        type: 'long_text', required: false, position: 5,
        extraction_hint: 'Qualquer informação adicional relevante que não se encaixe nos campos acima.',
      },
    ],
  },
  {
    id: 'form-contagem-estoque',
    name: 'Contagem de Estoque',
    description: 'Registro de inventário e contagem de itens',
    version: 1,
    active: true,
    fields: [
      {
        id: 'f7', key: 'produto', label: 'Produto',
        type: 'text', required: true, position: 0,
        extraction_hint: 'Nome do produto ou material contado.',
      },
      {
        id: 'f8', key: 'codigo', label: 'Código / SKU',
        type: 'text', required: false, position: 1,
        extraction_hint: 'Código, SKU ou número de referência do produto, se mencionado.',
      },
      {
        id: 'f9', key: 'quantidade', label: 'Quantidade',
        type: 'number', required: true, position: 2,
        extraction_hint: 'Quantidade total de unidades contadas. Se for foto, conte os itens visíveis.',
        validation_rules: { min: 0 },
      },
      {
        id: 'f10', key: 'unidade', label: 'Unidade de Medida',
        type: 'select', required: false, position: 3,
        options: ['unidade', 'caixa', 'kg', 'litro', 'metro', 'pacote'],
        extraction_hint: 'Unidade de medida da quantidade informada.',
      },
      {
        id: 'f11', key: 'local', label: 'Local / Setor',
        type: 'text', required: false, position: 4,
        extraction_hint: 'Onde o item está armazenado (ex: Galpão 3, Prateleira B2).',
      },
      {
        id: 'f12', key: 'observacoes', label: 'Observações',
        type: 'long_text', required: false, position: 5,
        extraction_hint: 'Estado do produto, divergências ou observações adicionais.',
      },
    ],
  },
  {
    id: 'form-inspecao-campo',
    name: 'Inspeção de Campo',
    description: 'Registro de inspeções e vistorias em campo',
    version: 1,
    active: true,
    fields: [
      {
        id: 'f13', key: 'local', label: 'Local Inspecionado',
        type: 'text', required: true, position: 0,
        extraction_hint: 'Nome ou descrição do local inspecionado.',
      },
      {
        id: 'f14', key: 'data', label: 'Data da Inspeção',
        type: 'date', required: true, position: 1,
        extraction_hint: 'Data em que a inspeção foi realizada.',
      },
      {
        id: 'f15', key: 'responsavel', label: 'Responsável',
        type: 'text', required: false, position: 2,
        extraction_hint: 'Nome do responsável pela inspeção ou pelo local.',
      },
      {
        id: 'f16', key: 'condicao', label: 'Condição Geral',
        type: 'select', required: false, position: 3,
        options: ['Boa', 'Regular', 'Ruim', 'Crítica'],
        extraction_hint: 'Avaliação geral das condições do local: boa, regular, ruim ou crítica.',
      },
      {
        id: 'f17', key: 'problema_identificado', label: 'Problema Identificado',
        type: 'long_text', required: false, position: 4,
        extraction_hint: 'Descreva qualquer problema, falha, risco ou não conformidade encontrada.',
      },
      {
        id: 'f18', key: 'observacoes', label: 'Observações',
        type: 'long_text', required: false, position: 5,
        extraction_hint: 'Informações complementares sobre a inspeção.',
      },
    ],
  },
];