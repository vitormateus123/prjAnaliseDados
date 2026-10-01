-- migrations/0014_extraction_status_and_push_tokens.sql
-- ============================================================
-- Migration 014: status de extração da IA + tokens de push
-- ============================================================
-- Adiciona extraction_status na tabela reports (independente do sync_status)
-- Cria tabela push_tokens para notificações via Expo Push API
-- Rode isso depois de 0001 a 0013 já terem rodado.
-- ============================================================

-- ─── extraction_status em reports ────────────────────────────
ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS extraction_status TEXT NOT NULL DEFAULT 'not_applicable'
    CHECK (extraction_status IN (
      'not_applicable',  -- relatórios manuais, sem IA
      'pending',         -- aguardando processamento (offline ou fila)
      'processing',      -- worker pegou para processar
      'done',            -- extração concluída com sucesso
      'failed'           -- falhou após tentativas
    )),
  ADD COLUMN IF NOT EXISTS extraction_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extraction_last_error TEXT;

-- Índice para o worker buscar pendentes rápido
CREATE INDEX IF NOT EXISTS idx_reports_extraction_status
  ON reports(extraction_status)
  WHERE extraction_status IN ('pending', 'processing');

-- ─── tabela push_tokens ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS push_tokens (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expo_push_token TEXT NOT NULL,
  device_id       TEXT,                -- opcional, pra diferenciar múltiplos dispositivos
  platform        TEXT,                -- 'android' | 'ios' | 'web'
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, expo_push_token)
);

ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;

-- Usuário gerencia seus próprios tokens
CREATE POLICY "own_push_tokens" ON push_tokens
  FOR ALL USING (user_id = auth.uid());

-- Trigger updated_at
CREATE TRIGGER trg_push_tokens_updated_at
  BEFORE UPDATE ON push_tokens
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── extractions: adiciona extraction_status também (opcional, para auditoria) ────────────
-- A tabela extractions já existe (migration 0001) com status 'pending'|'processing'|'success'|'error'
-- Mantemos como está para log detalhado; extraction_status do reports é o status agregado.