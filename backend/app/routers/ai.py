from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

from app.schemas.vacancy import AIExtractedFields
from app.services import ai_service, file_service, minio_service

router = APIRouter(prefix="/api/ai", tags=["ai"])


class TextRequest(BaseModel):
    text: str


async def extract_from_file(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    file_bytes = await file.read()
    if len(file_bytes) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large (max 10 MB)")

    # Save to MinIO
    try:
        await minio_service.upload_file(file_bytes, file.filename)
    except Exception:
        pass  # Storage failure is non-fatal — we still extract

    text = file_service.extract_text(file.filename, file_bytes)
    if not text:
        raise HTTPException(status_code=422, detail="Could not extract text from file")

    fields = await ai_service.extract_fields(text)
    return AIExtractedFields(**{k: fields.get(k) for k in AIExtractedFields.model_fields})


async def extract_from_text(body: TextRequest):
    if not body.text.strip():
        raise HTTPException(status_code=400, detail="Text is empty")
    fields = await ai_service.extract_fields(body.text)
    return AIExtractedFields(**{k: fields.get(k) for k in AIExtractedFields.model_fields})


router.add_api_route("/extract-from-file", extract_from_file, methods=["POST"], response_model=AIExtractedFields)
router.add_api_route("/extract-from-text", extract_from_text, methods=["POST"], response_model=AIExtractedFields)
