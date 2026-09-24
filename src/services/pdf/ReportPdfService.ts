// src/services/pdf/ReportPdfService.ts
// Exporta um Report como PDF (expo-print) e abre o menu de compartilhar do
// sistema (expo-sharing). Todo o texto do documento vem de
// utils/reportPdfHtml.ts — aqui fica só o I/O: ler as fotos, gerar o
// arquivo, renomear e compartilhar.
import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { Capture, Report } from '../../types/reports';
import { buildReportPdfHtml, reportPdfFileName, reportTitle } from '../../utils/reportPdfHtml';

// A4 em pontos (72 dpi) — o padrão do expo-print é US Letter.
const A4_WIDTH = 595;
const A4_HEIGHT = 842;
const PAGE_MARGIN = 32;

// O HTML carrega as fotos em base64 dentro da string — limitar quantidade e
// tamanho evita estourar memória do WebView de impressão em relatórios com
// muitas capturas. O que passa do limite simplesmente não entra no PDF.
const MAX_EMBEDDED_IMAGES = 4;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

async function readCaptureAsDataUri(capture: Capture): Promise<string | null> {
  const mime = capture.mime_type?.startsWith('image/') ? capture.mime_type : 'image/jpeg';
  let path = capture.local_path;
  let downloaded = false;

  try {
    if (path) {
      const info = await FileSystem.getInfoAsync(path);
      if (!info.exists) path = undefined;
    }

    // Captura já sincronizada e sem arquivo local (ex: relatório vindo do
    // servidor): baixa a URL assinada pro cache só pra embutir no PDF.
    if (!path && capture.file_url) {
      const target = `${FileSystem.cacheDirectory}pdf-capture-${capture.id}`;
      const result = await FileSystem.downloadAsync(capture.file_url, target);
      if (result.status !== 200) return null;
      path = result.uri;
      downloaded = true;
    }
    if (!path) return null;

    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists || (info.size ?? 0) > MAX_IMAGE_BYTES) return null;

    const base64 = await FileSystem.readAsStringAsync(path, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return `data:${mime};base64,${base64}`;
  } catch {
    // Foto ilegível não deve impedir o PDF — ele sai sem essa imagem.
    return null;
  } finally {
    if (downloaded && path) FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
  }
}

async function loadImages(report: Report): Promise<Record<string, string>> {
  const photos = report.captures.filter((c) => c.type === 'photo').slice(0, MAX_EMBEDDED_IMAGES);
  const entries = await Promise.all(
    photos.map(async (c) => [c.id, await readCaptureAsDataUri(c)] as const),
  );
  const images: Record<string, string> = {};
  for (const [id, uri] of entries) if (uri) images[id] = uri;
  return images;
}

/** Gera o PDF do relatório e abre o compartilhar do sistema (salvar em
 * Arquivos, WhatsApp, e-mail...). Lança Error com mensagem legível se algo
 * falhar — quem chama decide como avisar o usuário. Devolve o uri do PDF. */
export async function exportReportAsPdf(report: Report): Promise<string | null> {
  const images = await loadImages(report);
  const html = buildReportPdfHtml(report, {
    images,
    // Android aplica margem via @page; iOS via `margins` do expo-print.
    pageMarginPx: Platform.OS === 'android' ? PAGE_MARGIN : 0,
  });

  // Web: não há arquivo/compartilhar — abre o diálogo de impressão, de onde
  // dá pra "Salvar como PDF".
  if (Platform.OS === 'web') {
    await Print.printAsync({ html });
    return null;
  }

  const { uri: tempUri } = await Print.printToFileAsync({
    html,
    width: A4_WIDTH,
    height: A4_HEIGHT,
    margins: { top: PAGE_MARGIN, right: PAGE_MARGIN, bottom: PAGE_MARGIN, left: PAGE_MARGIN },
  });

  // O expo-print nomeia o arquivo com um UUID; renomeia pra o que a pessoa
  // vê no menu de compartilhar / ao salvar ser reconhecível.
  let uri = tempUri;
  try {
    const target = `${FileSystem.cacheDirectory}${reportPdfFileName(report)}`;
    await FileSystem.deleteAsync(target, { idempotent: true });
    await FileSystem.moveAsync({ from: tempUri, to: target });
    uri = target;
  } catch {
    // Se renomear falhar, compartilha com o nome original mesmo.
  }

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Este dispositivo não permite compartilhar arquivos.');
  }
  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    UTI: 'com.adobe.pdf',
    dialogTitle: `Exportar "${reportTitle(report)}"`,
  });
  return uri;
}
