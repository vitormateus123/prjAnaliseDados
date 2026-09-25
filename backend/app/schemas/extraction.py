# backend/app/schemas/extraction.py
from pydantic import BaseModel, Field

# ─── finalidade da extracao (modo automatico) ──────────────────────────────
# Contexto opcional que o usuario informa antes de capturar, pra orientar a
# IA sobre O QUE ela esta olhando — NAO define campos nem funciona como
# template. Ver _AUTO_PROMPT em gemini_service.py e ETAPA 4/5 no frontend
# (Captura.tsx). Mantido como str (nao Enum) de proposito: "OTHER" already
# cobre qualquer finalidade nao prevista via custom_instruction, entao nao
# ha necessidade de travar o backend numa lista fechada.
EXTRACTION_PURPOSES = {
    "STOCK_COUNT",
    "DOCUMENT_ANALYSIS",
    "REPORT",
    "SCENE_OBJECT_PERSON_ANALYSIS",
    "OTHER",
}

# ─── extração "clássica" (endpoint /extract/, template já escolhido) ──────

class FieldHint(BaseModel):
    key: str
    label: str
    extraction_hint: str | None = None
    type: str = "text"
    # Só importa quando o template tem has_items=True: diz se este campo se
    # repete por item (ex: "produto") ou é único no relatório (ex: "local").
    is_item_field: bool = False


class ExtractRequest(BaseModel):
    form_template_id: str
    fields: list[FieldHint]
    media_type: str = Field(..., description="'voice' or 'photo'")
    # Arquivo enviado via multipart/form-data — ver rota

class ExtractedField(BaseModel):
    key: str
    value: str
    confidence: float = Field(ge=0.0, le=1.0)
    # De qual fonte esse valor veio predominantemente — só faz sentido
    # quando a captura combina mais de uma modalidade (ex: foto + áudio).
    # 'image' | 'audio' | 'text' — None quando o modelo não informou.
    source: str | None = None

class ExtractResponse(BaseModel):
    success: bool
    fields: list[ExtractedField]
    provider: str
    model: str
    error: str | None = None
    # true = vale a pena chamar de novo (ex: sobrecarga momentânea do
    # provedor de IA); false = erro que tentar de novo não resolve sozinho.
    retryable: bool = False


# ─── catálogo enviado à IA para classificação ──────────────────────────────

class TemplateCatalogField(BaseModel):
    key: str
    label: str
    type: str
    extraction_hint: str | None = None
    options: list[str] | None = None
    is_item_field: bool = False


class TemplateCatalogEntry(BaseModel):
    id: str
    name: str
    description: str | None = None
    has_items: bool = False
    fields: list[TemplateCatalogField] = []


# ─── resposta da IA: usar template existente OU estruturar dinamicamente ───
# match="existing": reaproveita um form_template já cadastrado (podendo
#   completá-lo com suggested_fields quando falta algo essencial).
# match="dynamic": nada do catálogo serve — a IA estrutura livremente,
#   sem criar form_template novo (ver DynamicExtractedField/Item abaixo).
#   Documentação apenas — classify_and_extract() retorna dict cru.

class ProposedField(BaseModel):
    key: str
    label: str
    type: str
    extraction_hint: str | None = None
    options: list[str] | None = None
    is_item_field: bool = False


class ClassificationResult(BaseModel):
    match: str  # 'existing' | 'dynamic'
    template_id: str | None = None
    # Só relevante quando match='existing': campos que a IA identificou como
    # essenciais para o conteúdo capturado, mas que o template escolhido
    # ainda não tem (ex: nota fiscal sem "emissor"). extract.py os grava no
    # template antes de extrair.
    suggested_fields: list[ProposedField] = []


# ─── requisição do endpoint /extract/auto (multimodal combinada) ──────────
# Vai como JSON (não multipart) de propósito: o app pode anexar mais de uma
# foto + um áudio + um texto na MESMA captura, e o cliente RN atual não
# consegue subir múltiplos arquivos binários numa única requisição multipart
# de forma confiável (ver comentário em AutoExtractionService.ts). Cada
# arquivo vai em base64 dentro do JSON.

class MediaItem(BaseModel):
    data: str        # conteúdo do arquivo, codificado em base64
    mime_type: str


class AutoExtractRequest(BaseModel):
    photos: list[MediaItem] = []   # 0 ou mais fotos da mesma captura
    audio: MediaItem | None = None  # no máximo uma gravação de voz
    text: str | None = None         # texto digitado, pode combinar com foto/áudio
    # Finalidade escolhida pelo usuário na tela de captura — ver
    # EXTRACTION_PURPOSES acima. Puramente contextual para o prompt da IA.
    purpose: str | None = None
    # Só usado quando purpose="OTHER": instrução livre do usuário
    # (ex: "quero identificar produtos próximos da validade").
    custom_instruction: str | None = None


# ─── resposta do endpoint /extract/auto ────────────────────────────────────
# Espelha src/types/reports.ts (Report/ReportField) mais src/types/forms.ts
# (FormTemplate) — a Fase 3/4 no app consome isso para montar a tela de
# Revisão sem precisar de uma segunda chamada.

class ExtractedItem(BaseModel):
    fields: list[ExtractedField]


# ─── campos sem template (match="dynamic") ─────────────────────────────────
# Mesma forma de DiscoveredField (schemas/discovery.py), mas com "source"
# (de qual mídia veio o valor) — o modo automático combina mídias, o modo
# descoberta clássico não.

class DynamicExtractedField(BaseModel):
    key: str
    label: str
    type: str = "text"
    value: str
    confidence: float = Field(ge=0.0, le=1.0)
    source: str | None = None


class DynamicExtractedItem(BaseModel):
    fields: list[DynamicExtractedField]


class AutoExtractResponse(BaseModel):
    success: bool
    # "guided"  = estruturado com um form_template (novo ou existente,
    #             reaproveitado do catálogo) — fields/items abaixo.
    # "dynamic" = sem template — dynamic_fields/dynamic_items abaixo.
    structure_mode: str = "guided"

    # ─── modo guiado (structure_mode="guided") ───
    template_id: str | None = None
    template_name: str | None = None
    has_items: bool = False
    fields: list[ExtractedField] = []   # campos de nível de relatório
    items: list[ExtractedItem] = []     # só preenchido quando has_items=True
    # Keys dos campos que a IA acabou de adicionar a um template EXISTENTE
    # (ver ClassificationResult.suggested_fields) — vazio quando o template
    # escolhido já cobria bem o conteúdo. O app usa isso só pra avisar o
    # usuário; os campos já vêm completos ao buscar o template por
    # fetchFormTemplateById logo em seguida.
    new_field_keys: list[str] = []

    # ─── modo dinâmico (structure_mode="dynamic") ───
    context_label: str | None = None    # ex: "Contagem de estoque — depósito A"
    context_type: str | None = None     # slug curto, ex: "contagem_estoque"
    dynamic_fields: list[DynamicExtractedField] = []
    dynamic_items: list[DynamicExtractedItem] = []

    provider: str
    model: str
    error: str | None = None
    retryable: bool = False

    # Transcrição do áudio gerada pelo Groq (Whisper) — ver extract_auto em
    # routes/extract.py. Presente só quando a captura incluiu áudio; o app
    # persiste isso na capture (Capture.transcript) pra exibir no
    # CaptureOriginCard sem precisar de nova chamada.
    transcript: str | None = None


# ─── refinamento: re-extração de campos específicos ──────────────────────────
# Usado pelo endpoint POST /extract/refine — o app envia as capturas originais
# (base64 ou file_url remota) e a lista de campos alvo; a IA re-analisa e
# devolve apenas os valores desses campos.

class RefineMediaItem(BaseModel):
    """Mídia para refinamento: aceita base64 (data) OU URL remota (file_url).
    Exatamente um dos dois deve estar presente."""
    mime_type: str
    data: str | None = None        # conteúdo em base64 (arquivo local)
    file_url: str | None = None    # URL assinada (captura já sincronizada)


class RefineRequest(BaseModel):
    photos: list[RefineMediaItem] = []
    audio: RefineMediaItem | None = None
    text: str | None = None                    # texto digitado ou transcrição já disponível
    target_fields: list[FieldHint]             # campos que devem ser (re)extraídos


class RefineResponse(BaseModel):
    success: bool
    fields: list[ExtractedField] = []
    provider: str
    model: str
    error: str | None = None
    retryable: bool = False


# ─── resumo do relatório (frase curta pro card do Histórico) ──────────────
# Usado pelo endpoint POST /extract/summarize — o app manda os campos JÁ
# EXTRAÍDOS (texto, sem mídia) depois de uma captura ou edição, e a IA
# devolve uma frase curta que identifica o relatório de relance (ver
# SummaryService.ts no app). Best-effort: erro aqui nunca deve travar o
# fluxo de captura/revisão, por isso a resposta sempre success=False em vez
# de HTTP error quando algo falha.

class SummarizeField(BaseModel):
    label: str
    value: str


class SummarizeRequest(BaseModel):
    context_label: str | None = None
    purpose: str | None = None
    fields: list[SummarizeField]


class SummarizeResponse(BaseModel):
    success: bool
    summary: str | None = None
    error: str | None = None