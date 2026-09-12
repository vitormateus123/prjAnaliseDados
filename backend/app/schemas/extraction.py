# backend/app/schemas/extraction.py
from pydantic import BaseModel, Field

class FieldHint(BaseModel):
    key: str
    label: str
    extraction_hint: str | None = None
    type: str = "text"

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