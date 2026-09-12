import { ExtractionResult, ReportField } from '../types';

export async function extractFieldsFromVoice(): Promise<ExtractionResult> {
  await new Promise((resolve) => setTimeout(resolve, 1800));

  const fields: ReportField[] = [
    {
      key: 'origem',
      label: 'Origem',
      type: 'texto',
      value: 'voz',
      required: false,
    },
    {
      key: 'local',
      label: 'Local',
      type: 'texto',
      value: '',
      required: false,
    },
    {
      key: 'quantidade',
      label: 'Quantidade',
      type: 'quantidade',
      value: '',
      required: false,
    },
    {
      key: 'observacao',
      label: 'Observação',
      type: 'texto-longo',
      value: '',
      required: false,
    },
  ];

  return { fields, hasValues: false };
}

export async function extractFieldsFromPhoto(): Promise<ExtractionResult> {
  await new Promise((resolve) => setTimeout(resolve, 2200));

  const fields: ReportField[] = [
    {
      key: 'origem',
      label: 'Origem',
      type: 'texto',
      value: 'foto',
      required: false,
    },
    {
      key: 'local',
      label: 'Local',
      type: 'texto',
      value: '',
      required: false,
    },
    {
      key: 'quantidade',
      label: 'Quantidade',
      type: 'quantidade',
      value: '',
      required: false,
    },
    {
      key: 'observacao',
      label: 'Observação',
      type: 'texto-longo',
      value: '',
      required: false,
    },
  ];

  return { fields, hasValues: false };
}
