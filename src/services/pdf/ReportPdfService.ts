// src/services/pdf/ReportPdfService.ts
// Gera o PDF de um Report (expo-print) e o abre para visualização. Todo o
// texto do documento vem de utils/reportPdfHtml.ts — aqui fica só o I/O:
// ler as fotos, gerar o arquivo e abri-lo. Compartilhar/salvar fica por
// conta do próprio visualizador.
import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as IntentLauncher from 'expo-intent-launcher';
import * as FileSystem from 'expo-file-system/legacy';
import { Capture, Report } from '../../types/reports';
import { buildReportPdfHtml, reportPdfFileName } from '../../utils/reportPdfHtml';

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

/** Gera o PDF do relatório e abre para visualização — não compartilha.
 * No Android abre o leitor de PDF do aparelho; no iOS (e no Android sem
 * leitor de PDF) abre a pré-visualização de impressão do sistema. Lança
 * Error com mensagem legível se algo falhar — quem chama decide como avisar
 * o usuário. Devolve o uri do PDF (null na web). */
export async function openReportPdf(report: Report): Promise<string | null> {
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

  const { uri: tempUri, base64 } = await Print.printToFileAsync({
    html,
    width: A4_WIDTH,
    height: A4_HEIGHT,
    margins: { top: PAGE_MARGIN, right: PAGE_MARGIN, bottom: PAGE_MARGIN, left: PAGE_MARGIN },
    base64: true,
  });

  // O expo-print grava numa pasta própria (nome = UUID) que, no Android —
  // principalmente no Expo Go —, os outros módulos não têm permissão de ler
  // ("Not allowed to read file under given URL"). Por isso o PDF é regravado
  // no cache do app, com nome reconhecível (é o nome que o leitor de PDF
  // mostra). Renomear com moveAsync não serve: ele também precisa ler a
  // pasta de origem.
  let uri = tempUri;
  try {
    if (!base64) throw new Error('expo-print não devolveu o conteúdo do PDF.');
    const target = `${FileSystem.cacheDirectory}${reportPdfFileName(report)}`;
    await FileSystem.writeAsStringAsync(target, base64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    uri = target;
    FileSystem.deleteAsync(tempUri, { idempotent: true }).catch(() => {});
  } catch {
    // Se não conseguir regravar, tenta abrir o arquivo original.
  }

  if (Platform.OS === 'android') {
    try {
      // O leitor de PDF é outro app, então precisa de uma content:// URI
      // (FileProvider) com permissão temporária de leitura (flag 1).
      const contentUri = await FileSystem.getContentUriAsync(uri);
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: contentUri,
        flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
        type: 'application/pdf',
      });
      return uri;
    } catch {
      // Sem leitor de PDF instalado (ou falha ao abrir): cai na
      // pré-visualização de impressão abaixo.
    }
  }

  // iOS: mostra a pré-visualização do sistema, de onde dá para compartilhar
  // ou salvar em Arquivos.
  await Print.printAsync({ uri });
  return uri;
}
