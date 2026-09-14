# backend/app/services/groq_service.py
import io
from groq import AsyncGroq
from app.core.config import settings

# AsyncGroq em vez de Groq síncrono — evita bloquear o event loop do FastAPI
# quando a chamada de transcrição leva vários segundos (arquivos de áudio longos).
_client = AsyncGroq(api_key=settings.groq_api_key)


async def transcribe_audio(audio_bytes: bytes, mime_type: str = "audio/m4a") -> str:
    """Transcreve áudio usando Whisper via Groq (assíncrono).

    mime_type exemplos: 'audio/m4a', 'audio/wav', 'audio/mpeg'
    O Groq Whisper aceita: flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav, webm.
    """
    # Inferência da extensão pelo mime type
    mime_to_ext = {
        "audio/m4a": "m4a",
        "audio/mp4": "mp4",
        "audio/mpeg": "mp3",
        "audio/wav": "wav",
        "audio/ogg": "ogg",
        "audio/webm": "webm",
        "audio/flac": "flac",
    }
    ext = mime_to_ext.get(mime_type, mime_type.split("/")[-1])
    filename = f"audio.{ext}"

    transcription = await _client.audio.transcriptions.create(
        file=(filename, io.BytesIO(audio_bytes), mime_type),
        model="whisper-large-v3",
        language="pt",
        response_format="text",
    )
    # Groq retorna string diretamente com response_format="text"
    return transcription if isinstance(transcription, str) else transcription.text