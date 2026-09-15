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
    # true = este campo se repete por item quando o template tem has_items=True
    is_item_field: bool = False


class FormTemplateOut(BaseModel):
    id: str
    name: str
    description: str | None = None
    version: int
    active: bool
    fields: list[FormFieldOut] = []
    # true = relatório desse tipo pode ter uma lista de itens (report_items),
    # além ou no lugar dos campos de nível de relatório.
    has_items: bool = False