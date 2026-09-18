// src/constants/extractionPurpose.ts
// Fonte única das opções/labels de ExtractionPurpose — usada na escolha
// (Captura.tsx) e na exibição do que foi escolhido (RevisaoScreen,
// Historico.tsx), pra não duplicar os textos em cada tela.
import { Ionicons } from '@expo/vector-icons';
import { ExtractionPurpose } from '../types/reports';

export interface PurposeOption {
  value: ExtractionPurpose;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}

// Ordem também usada como ordem de exibição na tela de Captura.
export const PURPOSE_OPTIONS: PurposeOption[] = [
  { value: 'STOCK_COUNT', label: 'Contagem de estoque', icon: 'cube-outline' },
  { value: 'DOCUMENT_ANALYSIS', label: 'Análise de documento', icon: 'document-text-outline' },
  { value: 'REPORT', label: 'Relatório', icon: 'alert-circle-outline' },
  { value: 'SCENE_OBJECT_PERSON_ANALYSIS', label: 'Cenário, objeto ou pessoa', icon: 'eye-outline' },
  { value: 'OTHER', label: 'Outros', icon: 'ellipsis-horizontal-outline' },
];

const PURPOSE_MAP: Record<ExtractionPurpose, PurposeOption> = PURPOSE_OPTIONS.reduce(
  (acc, option) => ({ ...acc, [option.value]: option }),
  {} as Record<ExtractionPurpose, PurposeOption>,
);

export function purposeLabel(purpose: ExtractionPurpose | null | undefined): string | null {
  if (!purpose) return null;
  return PURPOSE_MAP[purpose]?.label ?? null;
}

export function purposeIcon(purpose: ExtractionPurpose | null | undefined): keyof typeof Ionicons.glyphMap {
  if (!purpose) return 'help-circle-outline';
  return PURPOSE_MAP[purpose]?.icon ?? 'help-circle-outline';
}