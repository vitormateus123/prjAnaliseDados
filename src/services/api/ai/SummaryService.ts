// src/services/api/ai/SummaryService.ts
// Pede à IA uma frase curta descrevendo do que se trata o relatório, a
// partir dos campos JÁ EXTRAÍDOS (texto, sem mídia) — usada pra preencher
// Report.ai_summary, exibido no card do Histórico em vez de listar campo
// por campo (que fica extenso e pouco legível com muitos campos).
//
// Chamada em dois momentos:
//  - Captura.tsx, logo depois que os campos são extraídos (report novo).
//  - RevisaoScreen.tsx, ao salvar — se os campos mudaram, o resumo antigo
//    pode não refletir mais o conteúdo.
//
// Best-effort de propósito: se falhar (rede, IA fora do ar), devolve null e
// quem chamou segue o fluxo normalmente — o Histórico já sabe lidar com
// ai_summary ausente (volta a listar os campos nesse card).

import { Report } from '../../../types/reports';
import { fieldValueToString } from '../../../utils/fieldValue';
import { apiFetch, UPLOAD_TIMEOUT_MS } from '../apiClient';

interface SummarizeResult {
  success: boolean;
  summary: string | null;
  error?: string;
}

/** Extrai os pares label/valor de um report (nível superior + itens) no
 * formato que o endpoint /extract/summarize espera. */
function reportFieldsForSummary(report: Pick<Report, 'fields' | 'items'>) {
  const all = [
    ...report.fields,
    ...report.items.flatMap((item) => item.fields),
  ];
  return all
    .map((f) => ({ label: f.label, value: fieldValueToString(f.field_value).trim() }))
    .filter((f) => f.value.length > 0);
}

export async function summarizeReport(
  report: Pick<Report, 'context_label' | 'form_template_name' | 'extraction_purpose' | 'fields' | 'items'>,
): Promise<string | null> {
  const fields = reportFieldsForSummary(report);
  // Sem nenhum campo preenchido não há o que resumir — evita uma chamada à
  // IA que só ia devolver algo genérico tipo "relatório vazio".
  if (fields.length === 0) return null;

  try {
    const result = await apiFetch<SummarizeResult>(
      '/extract/summarize',
      {
        method: 'POST',
        body: JSON.stringify({
          context_label: report.context_label ?? report.form_template_name ?? null,
          purpose: report.extraction_purpose ?? null,
          fields,
        }),
      },
      UPLOAD_TIMEOUT_MS,
    );
    return result.success ? (result.summary?.trim() || null) : null;
  } catch {
    // Best-effort — falha aqui nunca deve travar o fluxo de captura/revisão.
    return null;
  }
}