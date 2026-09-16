# backend/app/schemas/extraction.py
from pydantic import BaseModel, Field

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


# ─── resposta da IA: usar template existente ou propor um novo ────────────

class ProposedField(BaseModel):
    key: str
    label: str
    type: str
    extraction_hint: str | None = None
    options: list[str] | None = None
    is_item_field: bool = False


class ProposedTemplate(BaseModel):
    name: str
    description: str | None = None
    has_items: bool = False
    fields: list[ProposedField] = []


class ClassificationResult(BaseModel):
    match: str  # 'existing' | 'new'
    template_id: str | None = None
    new_template: ProposedTemplate | None = None
    # Só relevante quando match='existing': campos que a IA identificou como
    # essenciais para o conteúdo capturado, mas que o template escolhido
    # ainda não tem (ex: nota fiscal sem "emissor"). Mesmo formato dos campos
    # de new_template — extract.py os grava no template antes de extrair.
    suggested_fields: list[ProposedField] = []


# ─── resposta do endpoint /extract/auto ────────────────────────────────────
# Espelha src/types/reports.ts (Report/ReportField) mais src/types/forms.ts
# (FormTemplate) — a Fase 3/4 no app consome isso para montar a tela de
# Revisão sem precisar de uma segunda chamada.

class ExtractedItem(BaseModel):
    fields: list[ExtractedField]


class AutoExtractResponse(BaseModel):
    success: bool
    template_id: str
    template_name: str
    template_is_new: bool
    has_items: bool
    fields: list[ExtractedField] = []   # campos de nível de relatório (sempre presentes)
    items: list[ExtractedItem] = []     # só preenchido quando has_items=True
    provider: str
    model: str
    error: str | None = None
    retryable: bool = False
    # Keys dos campos que a IA acabou de adicionar a um template EXISTENTE
    # (ver ClassificationResult.suggested_fields) — vazio quando
    # template_is_new=True (nesse caso o template inteiro já é novo) ou
    # quando o template escolhido já cobria bem o conteúdo. O app usa isso
    # só pra avisar o usuário; os campos já vêm completos ao buscar o
    # template por fetchFormTemplateById logo em seguida.
    new_field_keys: list[str] = []