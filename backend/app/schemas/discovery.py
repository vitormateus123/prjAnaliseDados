# backend/app/schemas/discovery.py
# Schemas para o modo de descoberta dinâmica da IA.
# Usado quando nenhum template é fornecido — a IA analisa livremente
# o conteúdo e propõe contexto + campos + valores.

from pydantic import BaseModel, Field


class DiscoveredField(BaseModel):
    key: str
    label: str
    type: str = "text"          # tipo inferido pela IA
    value: str                  # sempre string — o app converte depois
    confidence: float = Field(ge=0.0, le=1.0)


class DiscoveryResult(BaseModel):
    success: bool
    # Descricao em linguagem natural do que foi identificado
    context: str | None = None          # ex: "Nota fiscal eletronica"
    # Slug identificador do contexto (gerado pela IA)
    context_type: str | None = None     # ex: "nota_fiscal"
    fields: list[DiscoveredField] = []
    provider: str = ""
    model: str = ""
    error: str | None = None
    # "discovery" = sem template  |  "guided" = com template (FieldHint)
    mode: str = "discovery"
