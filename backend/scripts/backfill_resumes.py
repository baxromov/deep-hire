"""
One-time script: attach doc/ folder resume files to existing DB candidates.

For each candidate where raw_resume_json.source == "file" and minio_key is missing,
finds the matching file in the doc/ folder by filename, uploads it to MinIO,
and sets candidate.resume_url to the download endpoint.

Run from /backend/:
    python scripts/backfill_resumes.py
"""

import asyncio
import sys
from pathlib import Path

# Allow importing from the backend app package
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.config import settings  # noqa: E402
from app.database import init_db  # noqa: E402
from app.models.candidate import Candidate  # noqa: E402
from app.services import minio_service  # noqa: E402

DOC_ROOT = Path(__file__).parent.parent.parent / "doc"


def _collect_files(root: Path) -> dict[str, Path]:
    """Return {filename_lower: full_path} for all PDF/DOCX files under root."""
    files: dict[str, Path] = {}
    for ext in ("*.pdf", "*.docx", "*.doc"):
        for f in root.rglob(ext):
            files[f.name.lower()] = f
    return files


async def main() -> None:
    await init_db()

    file_map = _collect_files(DOC_ROOT)
    print(f"Found {len(file_map)} files in {DOC_ROOT}")

    candidates = await Candidate.find({"raw_resume_json.source": "file"}).to_list()
    print(f"Found {len(candidates)} file-based candidates in DB")

    updated = 0
    skipped = 0

    for cand in candidates:
        raw = cand.raw_resume_json or {}

        # Skip if already has minio_key
        if raw.get("minio_key"):
            skipped += 1
            continue

        filename: str = raw.get("filename", "")
        matched_path = file_map.get(filename.lower())

        if not matched_path:
            print(f"  [MISS]  '{filename}' — no matching file found")
            continue

        try:
            file_bytes = matched_path.read_bytes()
            minio_key = await minio_service.upload_file(file_bytes, filename)
        except Exception as e:
            print(f"  [ERR]   '{filename}' — upload failed: {e}")
            continue

        cand.raw_resume_json = {**raw, "minio_key": minio_key}
        cand.resume_url = f"/api/candidates/{str(cand.id)}/resume"
        await cand.save()

        print(f"  [OK]    '{filename}' → {minio_key}")
        updated += 1

    print(f"\nDone. Updated: {updated}, Already set: {skipped}, Missed: {len(candidates) - updated - skipped}")


if __name__ == "__main__":
    asyncio.run(main())
