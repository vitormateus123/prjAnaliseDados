# backend/app/services/groq_service.py
import io
from groq import Groq
from app.core.config import settings

_client = Groq(api_key=settings.groq_api_key)

async def transcribe_audio(audio_bytes: bytes, mime_type: str = "audio/m4a") -> str:
    """Transcreve áudio usando Whisper via Groq."""
    ext = mime_type.split("/")[-1]  # 'mp4' ou 'm4a'
    filename = f"audio.{ext}"
    
    transcription = _client.audio.transcriptions.create(
        file=(filename, io.BytesIO(audio_bytes), mime_type),
        model="whisper-large-v3",
        language="pt",
        response_format="text",
    )
    return transcription