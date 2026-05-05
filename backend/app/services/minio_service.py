import io
import uuid
from typing import Optional

from app.config import settings


def _get_client():
    from miniopy_async import Minio
    return Minio(
        settings.minio_endpoint,
        access_key=settings.minio_access_key,
        secret_key=settings.minio_secret_key,
        secure=settings.minio_secure,
    )


async def ensure_bucket() -> None:
    client = _get_client()
    exists = await client.bucket_exists(settings.minio_bucket)
    if not exists:
        await client.make_bucket(settings.minio_bucket)


async def upload_file(file_bytes: bytes, filename: str) -> str:
    await ensure_bucket()
    client = _get_client()
    ext = filename.rsplit(".", 1)[-1] if "." in filename else "bin"
    object_key = f"{uuid.uuid4()}.{ext}"
    await client.put_object(
        settings.minio_bucket,
        object_key,
        io.BytesIO(file_bytes),
        length=len(file_bytes),
        content_type="application/octet-stream",
    )
    return object_key


async def get_file_bytes(object_key: str) -> Optional[bytes]:
    client = _get_client()
    try:
        response = await client.get_object(settings.minio_bucket, object_key)
        return await response.read()
    except Exception:
        return None
