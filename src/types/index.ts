export type FieldKey = 'origem' | 'local' | 'quantidade' | 'observacao';

export type ReportOrigin = 'voz' | 'foto';

export type ReportStatus = 'pendente' | 'sincronizado';

export type ReportField = {
  key: FieldKey;
  label: string;
  type: 'texto' | 'quantidade' | 'texto-longo';
  value: string;
  required: boolean;
};

export type Report = {
  id: string;
  createdAt: Date;
  origin: ReportOrigin;
  fields: ReportField[];
  status: ReportStatus;
  isDraft: boolean;
  syncAttempted: boolean;
};

export type ExtractionResult = {
  fields: ReportField[];
  hasValues: boolean;
};

export type AppContextValue = {
  reports: Report[];
  saveReport: (report: Report) => void;
  syncReports: () => void;
  pendingCount: number;
};
