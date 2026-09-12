# backend/tests/test_extract.py
import pytest
from httpx import AsyncClient
from app.main import app

@pytest.mark.asyncio
async def test_extract_photo_returns_fields():
    async with AsyncClient(app=app, base_url="http://test") as client:
        with open("tests/fixtures/sample_document.jpg", "rb") as f:
            response = await client.post(
                "/extract/",
                data={
                    "fields_json": '[{"key":"numero","label":"Número","type":"text","extraction_hint":"número do documento"}]',
                    "media_type": "photo",
                },
                files={"file": ("doc.jpg", f, "image/jpeg")},
            )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert len(data["fields"]) > 0