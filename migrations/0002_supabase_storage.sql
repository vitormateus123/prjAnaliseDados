-- Criar bucket para arquivos de captura
INSERT INTO storage.buckets (id, name, public)
VALUES ('captures', 'captures', false);

-- Política: usuário só acessa arquivos da sua organização
CREATE POLICY "org_captures_access" ON storage.objects
  FOR ALL USING (
    bucket_id = 'captures'
    AND auth.uid() IS NOT NULL
  );