import io
import json
import re
import zipfile
import xml.etree.ElementTree as ET

import pandas as pd


TEXT_EXTENSIONS = (".txt", ".md", ".markdown", ".csv")
IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff")


def _compact_text(text: str, limit: int = 4000) -> str:
    text = re.sub(r"\s+", " ", str(text or "")).strip()
    if len(text) <= limit:
        return text
    return f"{text[:limit].rstrip()}…"


def _table_summary(df: pd.DataFrame) -> dict:
    numeric = df.select_dtypes("number")
    stats = {
        col: {
            "sum": float(numeric[col].sum()),
            "mean": float(numeric[col].mean()),
        }
        for col in numeric.columns
    }
    preview = df.head(5).fillna("").astype(str).to_dict(orient="records")
    return {
        "content_type": "table",
        "row_count": int(len(df)),
        "columns": list(df.columns),
        "numeric_stats": stats,
        "preview_rows": preview,
    }


def parse_table(filename: str, content: bytes) -> dict:
    """解析上传的 CSV/Excel，返回结构化摘要（喂给 skill 当内部数据）。"""
    name = filename.lower()
    if name.endswith(".csv"):
        df = pd.read_csv(io.BytesIO(content))
    elif name.endswith((".xlsx", ".xls")):
        df = pd.read_excel(io.BytesIO(content))
    else:
        raise ValueError(f"unsupported file type: {filename}")

    return _table_summary(df)


def parse_uploaded_file(filename: str, content: bytes) -> dict:
    """Parse a user-uploaded business document into an AI-readable summary.

    The parser is intentionally honest: when this runtime lacks a PDF/OCR
    dependency, it returns metadata plus a clear extraction note instead of
    inventing content.
    """
    name = filename.lower()
    base = {
        "filename": filename,
        "size_bytes": len(content),
    }

    if name.endswith((".csv", ".xlsx", ".xls")):
        return {**base, **parse_table(filename, content)}
    if name.endswith(".docx"):
        return {**base, **_parse_docx(content)}
    if name.endswith(".pdf"):
        return {**base, **_parse_pdf(content)}
    if name.endswith(IMAGE_EXTENSIONS):
        return {**base, **_parse_image(filename, content)}
    if name.endswith(TEXT_EXTENSIONS):
        return {**base, **_parse_text(content)}
    return {
        **base,
        "content_type": "unknown",
        "extraction_status": "unsupported",
        "extraction_note": "暂未支持该文件类型自动解析。请在对话中补充文件里的关键结论、指标或截图说明。",
    }


def render_file_summary(filename: str, summary: dict) -> str:
    """Render parsed file metadata into concise text for prompts and memories."""
    content_type = summary.get("content_type") or "unknown"
    status = summary.get("extraction_status") or "parsed"
    lines = [f"资料《{filename}》解析摘要：类型={content_type}，状态={status}。"]
    if content_type == "table":
        lines.append(
            f"表格共 {summary.get('row_count', 0)} 行；字段："
            f"{'、'.join(map(str, summary.get('columns') or [])) or '未识别'}。"
        )
        stats = summary.get("numeric_stats") or {}
        if stats:
            lines.append(f"数值统计：{json.dumps(stats, ensure_ascii=False)}。")
        preview = summary.get("preview_rows") or []
        if preview:
            lines.append(f"前几行样例：{json.dumps(preview[:3], ensure_ascii=False)}。")
    elif summary.get("text"):
        lines.append(f"正文摘录：{summary.get('text')}")
    if summary.get("extraction_note"):
        lines.append(str(summary["extraction_note"]))
    return "\n".join(lines)


def _parse_text(content: bytes) -> dict:
    text = content.decode("utf-8", errors="ignore")
    return {
        "content_type": "text",
        "extraction_status": "parsed" if text.strip() else "empty",
        "text": _compact_text(text),
    }


def _parse_docx(content: bytes) -> dict:
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as docx:
            xml = docx.read("word/document.xml")
        root = ET.fromstring(xml)
        ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
        paragraphs: list[str] = []
        for para in root.findall(".//w:p", ns):
            text = "".join(node.text or "" for node in para.findall(".//w:t", ns)).strip()
            if text:
                paragraphs.append(text)
        body = "\n".join(paragraphs)
        return {
            "content_type": "word",
            "extraction_status": "parsed" if body.strip() else "empty",
            "paragraph_count": len(paragraphs),
            "text": _compact_text(body),
        }
    except Exception as exc:
        return {
            "content_type": "word",
            "extraction_status": "failed",
            "extraction_note": f"Word 文件正文未能自动解析：{exc.__class__.__name__}。请补充关键段落或转换为可复制文本。",
        }


def _parse_pdf(content: bytes) -> dict:
    try:
        from pypdf import PdfReader  # type: ignore
    except Exception:
        return {
            "content_type": "pdf",
            "extraction_status": "dependency_missing",
            "extraction_note": "当前运行环境未安装 PDF 文本解析依赖，已保存原文件。请补充 PDF 的关键页摘要或安装 pypdf 后重试。",
        }
    try:
        reader = PdfReader(io.BytesIO(content))
        pages = [page.extract_text() or "" for page in reader.pages[:12]]
        text = "\n".join(page for page in pages if page.strip())
        return {
            "content_type": "pdf",
            "extraction_status": "parsed" if text.strip() else "empty",
            "page_count": len(reader.pages),
            "text": _compact_text(text),
        }
    except Exception as exc:
        return {
            "content_type": "pdf",
            "extraction_status": "failed",
            "extraction_note": f"PDF 正文未能自动解析：{exc.__class__.__name__}。如果是扫描件，请补充截图说明或启用 OCR。",
        }


def _parse_image(filename: str, content: bytes) -> dict:
    try:
        from PIL import Image  # type: ignore
        image = Image.open(io.BytesIO(content))
        width, height = image.size
    except Exception:
        width = height = None

    ocr_text = ""
    ocr_note = "当前运行环境未启用图片 OCR/视觉识别，已保存原图。请在对话中补充截图里的关键数字、表格或结论。"
    try:
        import pytesseract  # type: ignore
        from PIL import Image  # type: ignore
        ocr_text = pytesseract.image_to_string(Image.open(io.BytesIO(content)), lang="chi_sim+eng")
        ocr_note = ""
    except Exception:
        pass

    return {
        "content_type": "image",
        "extraction_status": "parsed" if ocr_text.strip() else "ocr_unavailable",
        "width": width,
        "height": height,
        "text": _compact_text(ocr_text),
        "extraction_note": ocr_note,
        "filename": filename,
    }
