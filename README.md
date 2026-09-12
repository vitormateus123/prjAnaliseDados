# Sistema de Análise de Dados de Campo

App para quem está em campo, sem acesso fácil a computador, registrar informações por voz ou foto e já sair com um relatório estruturado, pronto para encaminhar a um superior ou arquivar. A extração dos campos é automática, mas nada é considerado final até passar por revisão humana.

## Visão geral

- **Captura:** registrar voz/foto, extração automática de campos, revisão prévia antes de salvar
- **Revisão:** editar campos extraídos automaticamente — confirme antes de finalizar
- **Histórico:** listar todos os relatórios, filtrar por status (pendente/sincronizado), reabrir para edição
- **Ajustes:** status offline-first, sincronizar fila de relatórios pendentes

## Estrutura de navegação

```
Captura ----(grava/fotografa)----> Revisão --(salva)--> Histórico
Histórico --(toca num item)------> Revisão
Ajustes (aba isolada, sem entrada/saída para outras telas)
```

### Fluxo típico

1. **Captura** (primeira tela): escolha "Gravar por voz" ou "Tirar foto". Enquanto processa, o botão fica desabilitado e um indicador de "extraindo..." aparece.
2. **Revisão** (modal): confira os campos extraídos (campo `origem` é somente leitura). Edite o que precisar e toque em **Salvar relatório**.
3. **Histórico** (aba inferior): lista de relatórios com status (pendente/sincronizado). Toque em um item para reabrir em Revisão.
4. **Ajustes** (aba inferior): visibilidade da conexão offline-first e botão **Sincronizar agora**.

## Instalação e execução

```bash
# Clonar este repositório e instalar dependências
npm install

# Executar localmente (iOS/Android/Chrome) – usa Expo Go
s npm start

# Construir para Android (requer Android Studio)
npm run android

# Construir para iOS (requer macOS)
npm run ios

# Web (dev-only)
npm run web
```

## Funcionamento offline

- Captura, edição e salvamento funcionam sem conexão.
- A fila de relatórios "pendente" é exibida em Histórico e Ajustes.
- **Sincronizar agora** em Ajustes envia os relatórios pendentes (simulado em app).

## Arquitetura e padrões

- **Navegação:** React Navigation (tab + native-stack)
- **Persistência:** AsyncStorage (React Native)
- **Mock de extração:** delay simulando processamento em backend
- **UI:** estilizada com React Native apenas (StyleSheet), sem dependência de Tailwind
- **Componentes:** DynamicFields reutiliza renderização de campos dinamicamente
- **Estado global:** simplificado – cada tela carrega do storage local, sem Redux/Zustand extra

## Componentes e seus papéis

| Componente/Arquivo | Propósito |
|-------------------|---------|
| `src/screens/Captura.tsx` | Interface de captura de voz/foto, extração automática, tratamento de erro, navegação para Revisão |
| `src/screens/Revisao.tsx` | Edição dinâmica de campos extraídos, histórico, salvar, sair sem salvar, alerta de alterações |
| `src/screens/Historico.tsx` | Lista de relatórios com status (pendente/sincronizado), ações: editar, sincronizar, excluir |
| `src/screens/Ajustes.tsx` | Visibilidade offline-first: status de conexão, contagem de pendentes, sincronizar agora |
| `src/components/DynamicFields.tsx` | Renderiza dinamicamente um array de `ReportField` como entradas editáveis (origem é somente leitura) |
| `src/types/index.ts` | Tipos TypeScript principais: `Report`, `ReportField`, `ExtractionResult`, etc. |
| `src/storage/reports.ts` | CRUD do AsyncStorage para `Report[]` – load, upsert, loadReports |
| `src/mock/api.ts` | Mock backend que simula extração por voz/foto com delays realistas |

## Fluxo detalhado por tela

### Captura

1. **Interface:** título "Nova captura", botões "Gravar por voz" e "Tirar foto". Se `isProcessing` for true, o botão exibe "Processando..." e fica desabilitado.
2. **Ações:** ao tocar, chama `extractFieldsFromVoice()` / `extractFieldsFromPhoto()` (mock com ~2s de delay).
3. **Sucesso:** cria um `Report` com:
   - `origin: 'voz' | 'foto'`
   - `fields` vindos da extração (cada campo tem `key`, `label`, `type`, `value`, `required`)
   - `isDraft: true`, `status: 'pendente'`, `syncAttempted: false`
4. **Navegação:** `navigation.navigate('Revisão', { reportId: ... })`.
5. **Tratamento de erro:** Alert com mensagem amigável, reabilita botões, permite tentar de novo.

### Revisão

1. **Entrada:** recebe `reportId` da rota.
2. **Estado inicial:** carrega `Report` completo do storage, mapeia `values` para cada `field.key`.
3. **Layout:** 
   - Cabeçalho (título + subtítulo)
   - Cartão de origem somente leitura (mostra "Gravação por voz" / "Foto")
   - Lista dinâmica de `DynamicFields` (etiqueta + input editável para cada campo, excluindo origem)
   - Se extração veio vazia (`!report.fields.some(f => f.value?.length > 0)`), exibe aviso "Não foi possível extrair automaticamente…"
4. **Ações:**
   - **Salvar relatório:** persiste campos atualizados em `upsertReport()`, atualiza `hasChanges` para false. Exibe Alert "Salvo" e navega para **Histórico**.
   - **Sair sem salvar:** se `hasChanges`, alerta confirmação; caso contrário, apenas `navigation.goBack()`.
5. **Estados:** indicador de salvamento, avisos em tempo real de alterações não salvas.

### Histórico

1. **Interface:** `FlatList` de itens de relatório, estado vazio (sem relatórios).
2. **Item de relatório:** exibe:
   - ID resumido (`report.id.slice(0,8)`)  
   - Origem (🎤 Voz / 📷 Foto)
   - Status visual (cor/de botão de acordo com `status`)
   - Ações: Editar (abre Revisão), Sincronizar (marca como sincronizado), Excluir (permite exclusão)
3. **Sincronização:** `handleSyncReport` atualiza `status` para "sincronizado" e marca `syncAttempted: true`.
4. **Exclusão:** confirma antes de remover do AsyncStorage via `loadReports` + `upsertReport`.
5. **Estado vazio:** botão "+ Novo relatório" que navega para **Captura**.

### Ajustes

1. **Status de conexão:** placeholder booleano `isOnline` exibe dot + texto.
2. **Relatórios pendentes:** conta filtrando `status === 'pendente'`.
3. **Botão Sincronizar agora:** exibe spinner durante processamento, envia todos os pendentes para o mock de sync (soma 2s de delay), marca cada um como `status: 'sincronizado'`.
4. **Persistência:** a sincronização atualiza os relatórios no `AsyncStorage` local, deixando uma cópia "congelada" para devolução futura.

## Teste e desenvolvimento local

```bash
# Compilar para desenvolvimento
npx expo start

# Abrir QR code no Expo Go (Android/iOS) ou navegador (web)
# Ou usar `npm run android` / `npm run ios`
```

**Visualizar alterações UI** (estilos implementados com StyleSheet)

## Futuros aprimoramentos (fora do escopo inicial)

- **Template de formulário editável pelo usuário:** permitir que organizações guardem conjuntos de campos personalizados (salvos em AsyncStorage), em vez de rota fixa.
- **Editor de campo com rich-text / picker:** substituição do TextInput simples para tipos específicos (ex.: select para `quantidade`).
- **Melhorias no mock de extração:** mais realista (intérprete de fala, OCR), retornos com erro.
- **Fila real de sincronização:** comunicação com backend real, retry exponencial, network-first com cache.
- **Log de atividades e auditoria:** quem criou/editou/excluiu o relatório e quando.
- **Ações em lote:** marcar múltiplos selecionados como sincronizado/excluir.
- **Busca/filtro em Histórico:** por data, origem, status.
- **Notificações em tempo real:** push para quando um relatório remoto é sincronizado.

## Observações técnicas

- **Campos dinâmicos:** `DynamicFields` aceita `fields: ReportField[]` e renderiza um `TextInput` (ou somente leitura) por chave, permitindo qualquer schema futuro sem modificar o código da tela.
- **Persistência:** `reports.ts` abstrai a chave do AsyncStorage, fornece helpers `upsertReport` e `loadReports`. Sem Redux — cada tela carrega o array completo localmente (pequeno para carga de campo típica).
- **Tratamento de erro:** Alert nativo do React Native, mensagens amigáveis, reabilita botões após erro de rede/extração.
- **Design system:** `src/styles.ts` guarda um objeto StyleSheet com design tokens reutilizáveis – sem dependência de biblioteca de estilos de terceiros.

## Considerações legais

- Mock sem autenticação — em uma construção real, adicione tokens, encrypt SensitiveData, e um servidor real de extração OCR/Speech-to-Text.
- Backup local: os relatórios são armazenados em AsyncStorage no dispositivo — se necessário maior durabilidade, adicione periodicamente ao cloud (ex.: Firestore/ Supabase) quando online.

Esperamos que você goste da construção! Sinta-se à vontade para abrir issues no repositório com bug reports, feature requests ou qualquer problema de UX.