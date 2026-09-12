// src/types/index.ts
// Re-exporta os tipos novos mantendo compatibilidade com imports existentes

export * from './src/types/forms';
export * from './src/types/reports';

// Aliases de compatibilidade (remover quando todas as telas forem migradas)
export type ReportOrigin = 'voz' | 'foto';