import io
import logging
from typing import Optional

logger = logging.getLogger(__name__)


def extract_text_from_pdf(file_bytes: bytes) -> Optional[str]:
    try:
        import pdfplumber
        with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
            pages = [page.extract_text() or "" for page in pdf.pages]
        return "\n".join(pages).strip() or None
    except Exception as e:
        logger.warning("PDF extraction failed: %s", e)
        return None


def extract_text_from_docx(file_bytes: bytes) -> Optional[str]:
    try:
        from docx import Document
        doc = Document(io.BytesIO(file_bytes))

        W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
        W_T = W + "t"
        W_P = W + "p"

        def _para_lines(root) -> list[str]:
            lines = []
            for para in root.iter(W_P):
                tokens = [(e.text or "").strip() for e in para.iter(W_T)]
                line = " ".join(t for t in tokens if t)
                if line:
                    lines.append(line)
            return lines

        lines = _para_lines(doc.element.body)

        # Also sweep headers/footers (some CVs put the name there)
        for section in doc.sections:
            for hdr in (section.header, section.first_page_header, section.even_page_header):
                try:
                    if not hdr.is_linked_to_previous:
                        lines.extend(_para_lines(hdr._element))
                except Exception:
                    pass

        return "\n".join(lines).strip() or None
    except Exception as e:
        logger.warning("DOCX extraction failed: %s", e)
        return None


def extract_text(filename: str, file_bytes: bytes) -> Optional[str]:
    lower = filename.lower()
    if lower.endswith(".pdf"):
        return extract_text_from_pdf(file_bytes)
    if lower.endswith(".docx") or lower.endswith(".doc"):
        return extract_text_from_docx(file_bytes)
    return None


def extract_rows_from_xlsx(file_bytes: bytes) -> list[dict]:
    """Parse Excel file from the internship application form.

    Returns list of dicts with keys: row_id, first_name, last_name,
    phone, internship_name, comment.
    Only rows with a numeric ID and at least a first name are included.
    """
    try:
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(file_bytes), read_only=True, data_only=True)
        ws = wb.active
        rows = []
        for row in ws.iter_rows(min_row=2, values_only=True):
            row_id = row[0]   # col A: ID
            first_name = row[9]   # col J: [[NAME]]
            last_name = row[10]   # col K: [[SURENAME]]
            phone = row[11]       # col L: [[PHONE]]
            internship = row[12]  # col M: [[INTERNSHIP_NAME]]
            comment = row[13]     # col N: [[COMMENT]]
            if not row_id or not first_name:
                continue
            rows.append({
                "row_id": str(row_id),
                "first_name": str(first_name).strip(),
                "last_name": str(last_name).strip() if last_name else None,
                "phone": str(phone).strip() if phone else None,
                "internship_name": str(internship).strip() if internship else None,
                "comment": str(comment).strip() if comment else None,
            })
        wb.close()
        return rows
    except Exception as e:
        logger.warning("XLSX extraction failed: %s", e)
        return []
