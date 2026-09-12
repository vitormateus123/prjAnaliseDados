-- ============================================================
-- Migration 001: Core schema
-- ============================================================

-- Extensão para UUIDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── organizations ──────────────────────────────────────────
CREATE TABLE organizations (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── users (extensão do Supabase Auth) ──────────────────────
-- auth.users é gerenciado pelo Supabase Auth.
-- Esta tabela guarda dados adicionais vinculados ao auth.users.id
CREATE TABLE users (
  id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'field_agent' 
                    CHECK (role IN ('admin', 'field_agent', 'viewer')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── form_templates ─────────────────────────────────────────
CREATE TABLE form_templates (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  version         INTEGER NOT NULL DEFAULT 1,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── form_fields ────────────────────────────────────────────
CREATE TABLE form_fields (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  form_template_id UUID NOT NULL REFERENCES form_templates(id) ON DELETE CASCADE,
  key              TEXT NOT NULL,   -- chave usada em report_fields e no JSON da IA
  label            TEXT NOT NULL,   -- rótulo exibido na tela
  type             TEXT NOT NULL    -- ver tipos suportados
                     CHECK (type IN (
                       'text','long_text','number','decimal',
                       'date','boolean','select','multiselect'
                     )),
  required         BOOLEAN NOT NULL DEFAULT FALSE,
  position         INTEGER NOT NULL DEFAULT 0,  -- ordem de exibição
  description      TEXT,            -- descrição para o usuário
  extraction_hint  TEXT,            -- instrução para a IA: "identifique o número do documento"
  options          JSONB,           -- para select/multiselect: ["Opção A", "Opção B"]
  validation_rules JSONB,           -- ex: {"min": 0, "max": 1000}
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (form_template_id, key)    -- chave única por formulário
);

-- ─── reports ────────────────────────────────────────────────
CREATE TABLE reports (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  form_template_id UUID NOT NULL REFERENCES form_templates(id),
  user_id          UUID REFERENCES users(id) ON DELETE SET NULL,
  organization_id  UUID REFERENCES organizations(id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','pending_sync','synced','error')),
  local_id         TEXT UNIQUE,     -- ID gerado offline no dispositivo (para dedup)
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced_at        TIMESTAMPTZ      -- quando foi sincronizado com sucesso
);

-- ─── report_fields ──────────────────────────────────────────
-- Armazena o valor de cada campo de um report.
-- Usa colunas tipadas para evitar perda semântica.
CREATE TABLE report_fields (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_id     UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  form_field_id UUID NOT NULL REFERENCES form_fields(id) ON DELETE CASCADE,
  
  -- Valor tipado (apenas uma coluna deve ser preenchida por linha)
  value_text    TEXT,
  value_number  NUMERIC,
  value_boolean BOOLEAN,
  value_date    DATE,
  value_json    JSONB,            -- para select múltiplo e tipos compostos
  
  -- Metadados de extração
  confidence    NUMERIC(4,3),    -- 0.000 a 1.000
  source        TEXT NOT NULL DEFAULT 'manual'
                  CHECK (source IN ('ai','manual','ai_edited')),
  was_edited    BOOLEAN NOT NULL DEFAULT FALSE,
  
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (report_id, form_field_id)
);

-- ─── captures ───────────────────────────────────────────────
CREATE TABLE captures (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_id    UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  type         TEXT NOT NULL CHECK (type IN ('voice','photo','manual')),
  file_url     TEXT,            -- URL no Supabase Storage (após upload)
  local_path   TEXT,            -- caminho local enquanto offline
  mime_type    TEXT,
  metadata     JSONB,           -- duração do áudio, dimensões da foto, etc.
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── extractions ────────────────────────────────────────────
CREATE TABLE extractions (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_id      UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  capture_id     UUID REFERENCES captures(id) ON DELETE SET NULL,
  provider       TEXT NOT NULL,  -- 'gemini', 'groq', etc.
  model          TEXT NOT NULL,  -- 'gemini-2.5-flash', 'whisper-large-v3', etc.
  status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','processing','success','error')),
  raw_text       TEXT,           -- transcrição bruta (STT) ou texto extraído
  raw_response   JSONB,          -- resposta completa da API (para auditoria)
  error_message  TEXT,
  prompt_version TEXT,           -- ex: 'v1.2' para rastrear qual prompt foi usado
  tokens_used    INTEGER,
  latency_ms     INTEGER,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Índices para performance
-- ============================================================
CREATE INDEX idx_reports_user_id ON reports(user_id);
CREATE INDEX idx_reports_organization_id ON reports(organization_id);
CREATE INDEX idx_reports_status ON reports(status);
CREATE INDEX idx_report_fields_report_id ON report_fields(report_id);
CREATE INDEX idx_captures_report_id ON captures(report_id);
CREATE INDEX idx_extractions_report_id ON extractions(report_id);

-- ============================================================
-- Row Level Security (RLS)
-- ============================================================
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE captures ENABLE ROW LEVEL SECURITY;
ALTER TABLE extractions ENABLE ROW LEVEL SECURITY;

-- Usuários só veem dados da própria organização
CREATE POLICY "org_isolation_reports" ON reports
  FOR ALL USING (
    organization_id = (SELECT organization_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "org_isolation_form_templates" ON form_templates
  FOR ALL USING (
    organization_id = (SELECT organization_id FROM users WHERE id = auth.uid())
    OR organization_id IS NULL  -- templates globais/públicos
  );

-- Usuário acessa seu próprio perfil
CREATE POLICY "own_user_profile" ON users
  FOR ALL USING (id = auth.uid());

-- ============================================================
-- Trigger: updated_at automático
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_reports_updated_at
  BEFORE UPDATE ON reports
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_report_fields_updated_at
  BEFORE UPDATE ON report_fields
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();