# backend/app/schemas/forms.py
# Espelha exatamente src/types/forms.ts — qualquer mudança lá precisa
# ser refletida aqui também.
from pydantic import BaseModel


class ValidationRules(BaseModel):
    min: float | None = None
    max: float | None = None
    pattern: str | None = None


class FormFieldOut(BaseModel):
    id: str
    key: str
    label: str
    type: str
    required: bool
    position: int
    description: str | None = None
    extraction_hint: str | None = None
    options: list[str] | None = None
    validation_rules: ValidationRules | None = None


class FormTemplateOut(BaseModel):
    id: str
    name: str
    description: str | None = None
    version: int
    active: bool
    fields: list[FormFieldOut] = []
