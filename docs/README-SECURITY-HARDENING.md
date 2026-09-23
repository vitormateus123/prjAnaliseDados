# prjAnaliseDados — security hardening

A integração GitHub desta sessão não tem permissão de escrita no repositório (HTTP 403), então estes arquivos estão prontos para copiar/commit.

Arquivos de substituição: App.tsx, src/screens/Ajustes.tsx, src/services/auth/supabaseClient.ts, src/services/api/apiClient.ts, backend/app/main.py, backend/app/core/config.py, backend/app/services/supabase_service.py.

Arquivos novos: src/screens/Login.tsx, backend/app/security/auth.py, backend/app/security/__init__.py, migrations/0011_security_hardening.sql.

Patch adicional: `git apply extract-hardening.patch`.

Depois: revise `git diff`, aplique a migration no Supabase, rode testes/build e faça `git add -A && git commit -m "security: add Supabase authentication and authorization"`.

Produção:
- APP_ENV=production
- ALLOWED_ORIGINS explícito, sem `*`
- EXPO_PUBLIC_API_URL em HTTPS
- SUPABASE_SERVICE_KEY somente no backend
- EXPO_PUBLIC_SUPABASE_ANON_KEY somente no app
