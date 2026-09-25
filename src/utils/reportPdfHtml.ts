// src/utils/reportPdfHtml.ts
// Monta o HTML (A4, estilos inline) que o expo-print transforma em PDF.
// Função pura — sem expo/react-native — pra ficar fácil de testar e pra que
// o I/O (ler fotos, gerar arquivo, compartilhar) fique todo em
// services/pdf/ReportPdfService.ts.
import { Capture, Report, ReportField, ReportItem } from '../types/reports';
import { purposeLabel } from '../constants/extractionPurpose';
import { fieldValueToDisplayString } from './fieldValue';

export interface ReportPdfHtmlOptions {
  /** Fotos já lidas como data URI (`data:image/jpeg;base64,...`), por Capture.id. */
  images?: Record<string, string>;
  /** Margem da página em px, aplicada via @page. No iOS a margem vem da
   * opção `margins` do expo-print, então lá deve ser 0 (evita margem dupla). */
  pageMarginPx?: number;
  /** Momento de geração exibido no rodapé (injetável pra teste). */
  generatedAt?: Date;
}

const STATUS_LABEL: Record<Report['status'], string> = {
  draft: 'Rascunho',
  pending_sync: 'Pendente de sincronização',
  synced: 'Sincronizado',
  error: 'Erro de sincronização',
};

// Acima disso os itens deixam de caber lado a lado numa tabela A4 legível e
// passam a ser exibidos como um bloco (campo/valor) por item.
const MAX_ITEM_TABLE_COLUMNS = 5;

const EMPTY = '<span class="empty">—</span>';

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function reportTitle(report: Report): string {
  return report.context_label || report.form_template_name || 'Relatório';
}

/** Nome de arquivo seguro: `relatorio-nota-fiscal-2026-09-24.pdf`. */
export function reportPdfFileName(report: Report): string {
  const slug = (report.context_label || report.form_template_name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const date = new Date(report.created_at);
  const day = Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
  return ['relatorio', slug, day].filter(Boolean).join('-') + '.pdf';
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function formatDateTime(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '';
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function valueHtml(field: ReportField): string {
  const text = fieldValueToDisplayString(field.field_value);
  return text ? escapeHtml(text) : EMPTY;
}

function metaLine(label: string, value: string | null | undefined): string {
  return value ? `<div><span class="meta-label">${escapeHtml(label)}:</span> ${escapeHtml(value)}</div>` : '';
}

/** Um campo do template pode vir sem valor porque não fazia sentido pra
 * essa extração (ex: template genérico com campo que não se aplica a este
 * conteúdo específico) — nesses casos ele não deve aparecer no relatório
 * final, só na tela de Revisão (onde faz sentido oferecer pra preencher
 * manualmente). Ver buildReportFields em utils/reportBuilder.ts. */
function isFilled(field: ReportField): boolean {
  return fieldValueToDisplayString(field.field_value).trim() !== '';
}

function fieldsTable(fields: ReportField[]): string {
  const filled = fields.filter(isFilled);
  if (filled.length === 0) return '';
  const rows = filled
    .map((f) => `<tr><th>${escapeHtml(f.label)}</th><td>${valueHtml(f)}</td></tr>`)
    .join('');
  return `<table class="kv">${rows}</table>`;
}

function itemsSection(items: ReportItem[]): string {
  const title = `<h2>Itens (${items.length})</h2>`;

  // Cada item fica só com os campos que têm valor — um campo que não fazia
  // sentido pra aquele item específico (ex: SKU que só existe em alguns
  // produtos) não deve aparecer nem como "—".
  const filledPerItem = items.map((item) => item.fields.filter(isFilled));
  if (filledPerItem.every((fs) => fs.length === 0)) return '';

  // A tabela compacta (colunas compartilhadas) só funciona sem reintroduzir
  // campos vazios quando TODO item preenche exatamente o mesmo conjunto de
  // campos — aí sim uma célula "—" seria enganosa, nunca necessária. Se os
  // itens preenchem campos diferentes entre si, cada um vira um bloco só
  // com os campos que ele de fato tem.
  const keySignature = (fs: ReportField[]) => fs.map((f) => f.key).sort().join('|');
  const firstSignature = keySignature(filledPerItem[0]);
  const uniform = filledPerItem.every((fs) => keySignature(fs) === firstSignature);
  const columns = uniform ? filledPerItem[0].map((f) => ({ key: f.key, label: f.label })) : [];

  if (uniform && columns.length > 0 && columns.length <= MAX_ITEM_TABLE_COLUMNS) {
    const head = `<tr><th class="idx">#</th>${columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join('')}</tr>`;
    const body = items
      .map((item, i) => {
        const cells = columns
          .map((c) => valueHtml(item.fields.find((x) => x.key === c.key)!))
          .map((v) => `<td>${v}</td>`)
          .join('');
        return `<tr><td class="idx">${i + 1}</td>${cells}</tr>`;
      })
      .join('');
    return `${title}<table class="grid"><thead>${head}</thead><tbody>${body}</tbody></table>`;
  }

  const blocks = items
    .map((item, i) => {
      const table = fieldsTable(item.fields);
      return table ? `<div class="item"><h3>Item ${i + 1}</h3>${table}</div>` : '';
    })
    .filter(Boolean)
    .join('');
  if (!blocks) return '';
  return `${title}${blocks}`;
}

function capturesSection(captures: Capture[], images: Record<string, string>): string {
  const parts: string[] = [];
  let voiceWithoutTranscript = 0;

  for (const c of captures) {
    if (c.type === 'photo' && images[c.id]) {
      parts.push(`<figure><img src="${images[c.id]}" /></figure>`);
    } else if (c.type === 'text' && c.text_content?.trim()) {
      parts.push(
        `<div class="capture-label">Texto digitado</div><blockquote>${escapeHtml(c.text_content.trim())}</blockquote>`,
      );
    } else if (c.type === 'voice') {
      // O áudio em si não entra no PDF, mas a transcrição gerada na
      // captura (Groq/Whisper — ver Capture.transcript/text_content)
      // sim, do mesmo jeito que o texto digitado.
      const transcript = (c.transcript ?? c.text_content)?.trim();
      if (transcript) {
        parts.push(
          `<div class="capture-label">Transcrição do áudio</div><blockquote>${escapeHtml(transcript)}</blockquote>`,
        );
      } else {
        voiceWithoutTranscript++;
      }
    }
  }
  if (voiceWithoutTranscript > 0) {
    parts.push(
      `<p class="note">${voiceWithoutTranscript === 1 ? '1 gravação de áudio' : `${voiceWithoutTranscript} gravações de áudio`} usada${voiceWithoutTranscript === 1 ? '' : 's'} na extração, sem transcrição disponível (áudio não incluído no PDF).</p>`,
    );
  }
  return parts.length > 0 ? `<h2>Capturas originais</h2>${parts.join('')}` : '';
}

export function buildReportPdfHtml(report: Report, options: ReportPdfHtmlOptions = {}): string {
  const { images = {}, pageMarginPx = 0, generatedAt = new Date() } = options;

  const purpose = purposeLabel(report.extraction_purpose);
  const purposeText = purpose
    ? report.extraction_custom_instruction ? `${purpose} — ${report.extraction_custom_instruction}` : purpose
    : null;
  const templateName =
    report.form_template_name && report.form_template_name !== reportTitle(report)
      ? report.form_template_name
      : null;

  const summary = report.ai_summary?.trim()
    ? `<div class="summary">${escapeHtml(report.ai_summary.trim())}</div>`
    : '';
  const fieldsTableHtml = fieldsTable(report.fields);
  const fields = fieldsTableHtml ? `<h2>Informações extraídas</h2>${fieldsTableHtml}` : '';
  const items = report.items.length > 0 ? itemsSection(report.items) : '';
  const captures = capturesSection(report.captures, images);
  const hasContent = Boolean(fields || items);

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(reportTitle(report))}</title>
<style>
  @page { margin: ${pageMarginPx}px; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 12px; line-height: 1.45; color: #161827; margin: 0; padding: 0; }
  .eyebrow { font-size: 10px; font-weight: 800; letter-spacing: 1.2px; color: #4f46e5; }
  h1 { font-size: 22px; margin: 2px 0 6px; letter-spacing: -0.3px; }
  h2 { font-size: 13px; margin: 22px 0 8px; padding-bottom: 4px; border-bottom: 2px solid #4f46e5; color: #3730a3; text-transform: uppercase; letter-spacing: 0.6px; }
  h3 { font-size: 12px; margin: 0 0 4px; color: #5c6079; }
  .meta { color: #5c6079; font-size: 11px; }
  .meta-label { font-weight: 700; color: #161827; }
  .summary { margin-top: 14px; padding: 10px 12px; background: #eef0ff; border-left: 3px solid #4f46e5; border-radius: 4px; }
  table { width: 100%; border-collapse: collapse; }
  tr { page-break-inside: avoid; }
  table.kv th { width: 34%; text-align: left; vertical-align: top; font-weight: 700; padding: 6px 8px; background: #f8f9fd; border: 1px solid #e6e8f4; }
  table.kv td { vertical-align: top; padding: 6px 8px; border: 1px solid #e6e8f4; white-space: pre-wrap; word-wrap: break-word; overflow-wrap: anywhere; }
  table.grid th { text-align: left; padding: 6px 8px; background: #eef0ff; border: 1px solid #d7daf0; font-size: 11px; }
  table.grid td { vertical-align: top; padding: 6px 8px; border: 1px solid #e6e8f4; word-wrap: break-word; overflow-wrap: anywhere; }
  table.grid tbody tr:nth-child(even) td { background: #f8f9fd; }
  .idx { width: 28px; text-align: center; color: #5c6079; }
  .item { margin-bottom: 12px; page-break-inside: avoid; }
  .empty { color: #9599b3; }
  figure { margin: 0 0 12px; text-align: center; page-break-inside: avoid; }
  figure img { max-width: 100%; max-height: 420px; border: 1px solid #e6e8f4; border-radius: 4px; }
  blockquote { margin: 0 0 12px; padding: 8px 12px; background: #f8f9fd; border-left: 3px solid #d7daf0; white-space: pre-wrap; overflow-wrap: anywhere; }
  .capture-label { font-size: 10px; font-weight: 700; color: #9599b3; text-transform: uppercase; letter-spacing: 0.4px; margin: 0 0 4px; }
  .note { color: #5c6079; font-style: italic; margin: 6px 0; }
  .footer { margin-top: 28px; padding-top: 8px; border-top: 1px solid #e6e8f4; font-size: 10px; color: #9599b3; }
</style>
</head>
<body>
  <div class="eyebrow">RELATÓRIO</div>
  <h1>${escapeHtml(reportTitle(report))}</h1>
  <div class="meta">
    ${metaLine('Tipo', templateName)}
    ${metaLine('Criado em', formatDateTime(report.created_at))}
    ${metaLine('Atualizado em', report.updated_at !== report.created_at ? formatDateTime(report.updated_at) : null)}
    ${metaLine('Situação', STATUS_LABEL[report.status])}
    ${metaLine('Finalidade', purposeText)}
  </div>
  ${summary}
  ${fields}
  ${items}
  ${hasContent ? '' : '<p class="note">Nenhuma informação foi extraída para este relatório.</p>'}
  ${captures}
  <div class="footer">Gerado em ${formatDateTime(generatedAt)} · Campo — Análise de Dados</div>
</body>
</html>`;
}