# backend/app/api/routes/devices.py
# Endpoints para gerenciamento de tokens de push (Expo Push API)
from fastapi import APIRouter, HTTPException
from app.schemas.extraction import PushTokenRequest, PushTokenResponse
from app.services.supabase_service import get_client
from app.security.auth import get_current_user

router = APIRouter(prefix="/devices", tags=["devices"])


@router.post("/push-token", response_model=PushTokenResponse)
async def register_push_token(payload: PushTokenRequest):
    """
    Registra ou atualiza o token de push do Expo para o usuário autenticado.
    O app chama isso assim que a permissão de notificação é concedida.
    """
    user = get_current_user()
    if not user:
        raise HTTPException(status_code=401, detail="Usuário não autenticado.")

    supabase = get_client()

    try:
        # Upsert: atualiza se já existe, insere se novo
        # A UNIQUE (user_id, expo_push_token) na tabela garante idempotência
        token_row = {
            "user_id": user.id,
            "expo_push_token": payload.expo_push_token,
            "device_id": payload.device_id,
            "platform": payload.platform,
            "active": True,
        }
        resp = supabase.table("push_tokens").upsert(token_row).execute()

        if not resp.data:
            raise HTTPException(status_code=500, detail="Falha ao registrar token.")

        return PushTokenResponse(success=True)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao registrar token: {e}")


@router.delete("/push-token")
async def unregister_push_token(payload: PushTokenRequest):
    """
    Remove um token de push (ex: logout, usuário revogou permissão).
    """
    user = get_current_user()
    if not user:
        raise HTTPException(status_code=401, detail="Usuário não autenticado.")

    supabase = get_client()

    try:
        supabase.table("push_tokens").delete().eq("user_id", user.id).eq(
            "expo_push_token", payload.expo_push_token
        ).execute()
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao remover token: {e}")