import io
import html as html_lib
import json
import re
import shutil
import subprocess
import tempfile
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

import pandas as pd


TEXT_EXTENSIONS = (".txt", ".md", ".markdown", ".log")
IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff")
HTML_EXTENSIONS = (".html", ".htm")
JSON_EXTENSIONS = (".json", ".jsonl")
RTF_EXTENSIONS = (".rtf",)
PRESENTATION_EXTENSIONS = (".pptx",)
LEGACY_CONVERTIBLE_EXTENSIONS = (".doc", ".ppt")
PDF_MAX_PAGES = 80
TEXT_LIMIT = 120000


def _compact_text(text: str, limit: int = 30000, preserve_lines: bool = False) -> str:
    text = str(text or "").strip()
    if preserve_lines:
        text = re.sub(r"[ \t]+", " ", text)
        text = re.sub(r"\n{3,}", "\n\n", text)
    else:
        text = re.sub(r"\s+", " ", text)
    if len(text) <= limit:
        return text
    return f"{text[:limit].rstrip()}…"


def _decode_text(content: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "utf-16", "utf-16le", "gb18030", "big5", "latin-1"):
        try:
            text = content.decode(encoding)
            if text.strip():
                return text
        except UnicodeError:
            continue
    return content.decode("utf-8", errors="ignore")


def _text_preview_block(text: str, index: int) -> dict:
    clean = str(text or "").strip()
    if not clean:
        return {}
    if index == 0 and len(clean) <= 90:
        return {"type": "title", "text": clean, "level": 1}
    if re.match(r"^[一二三四五六七八九十]+[、.．]\s*", clean):
        return {"type": "heading", "text": clean, "level": 2}
    if re.match(r"^\d+(?:\.\d+)+\s+", clean):
        return {"type": "heading", "text": clean, "level": 3}
    return {"type": "paragraph", "text": clean}


def _markdown_preview_blocks(text: str) -> list[dict]:
    blocks: list[dict] = []
    paragraph: list[str] = []

    def flush_paragraph() -> None:
        if not paragraph:
            return
        joined = " ".join(item.strip() for item in paragraph if item.strip()).strip()
        paragraph.clear()
        if joined:
            blocks.append({"type": "paragraph", "text": joined})

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            flush_paragraph()
            continue
        heading = re.match(r"^(#{1,6})\s+(.+)$", line)
        if heading:
            flush_paragraph()
            blocks.append({"type": "heading", "text": heading.group(2).strip(), "level": len(heading.group(1))})
            continue
        paragraph.append(line)
    flush_paragraph()
    return blocks[:1000]


def _plain_text_preview_blocks(text: str) -> list[dict]:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if not lines and text.strip():
        lines = [text.strip()]
    return [
        block for index, line in enumerate(lines[:1000])
        if (block := _text_preview_block(line, index))
    ]


def _text_summary(content_type: str, text: str, *, source: str = "", note: str = "") -> dict:
    compact = _compact_text(text, limit=TEXT_LIMIT, preserve_lines=True)
    blocks = _markdown_preview_blocks(compact) if content_type == "markdown" else _plain_text_preview_blocks(compact)
    paragraphs = [
        str(block.get("text") or "").strip()
        for block in blocks
        if block.get("type") != "table" and str(block.get("text") or "").strip()
    ]
    result = {
        "content_type": content_type,
        "extraction_status": "parsed" if compact.strip() else "empty",
        "paragraph_count": len(paragraphs),
        "paragraphs": paragraphs[:1000],
        "preview_blocks": blocks[:1000],
        "text": compact,
    }
    if source:
        result["extraction_source"] = source
    if note:
        result["extraction_note"] = note
    return result


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
    preview_rows = [list(map(str, df.columns))]
    preview_rows.extend(
        [str(row.get(col, "")) for col in df.columns]
        for row in df.head(20).fillna("").astype(str).to_dict(orient="records")
    )
    return {
        "content_type": "table",
        "row_count": int(len(df)),
        "columns": list(df.columns),
        "numeric_stats": stats,
        "preview_rows": preview,
        "preview_blocks": [{"type": "table", "rows": preview_rows}],
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
    if name.endswith(LEGACY_CONVERTIBLE_EXTENSIONS):
        return {**base, **_parse_legacy_convertible(filename, content)}
    if name.endswith(".pdf"):
        return {**base, **_parse_pdf(content)}
    if name.endswith(PRESENTATION_EXTENSIONS):
        return {**base, **_parse_pptx(content)}
    if name.endswith(IMAGE_EXTENSIONS):
        return {**base, **_parse_image(filename, content)}
    if name.endswith(HTML_EXTENSIONS):
        return {**base, **_parse_html(content)}
    if name.endswith(JSON_EXTENSIONS):
        return {**base, **_parse_json_text(content)}
    if name.endswith(RTF_EXTENSIONS):
        return {**base, **_parse_rtf(filename, content)}
    if name.endswith(TEXT_EXTENSIONS):
        return {**base, **_parse_text(filename, content)}
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


def _parse_text(filename: str, content: bytes) -> dict:
    text = _decode_text(content)
    content_type = "markdown" if filename.lower().endswith((".md", ".markdown")) else "text"
    return _text_summary(content_type, text)


def _parse_html(content: bytes) -> dict:
    text = _decode_text(content)
    text = re.sub(r"(?is)<(script|style).*?>.*?</\1>", "\n", text)
    text = re.sub(r"(?i)<br\s*/?>", "\n", text)
    text = re.sub(r"(?i)</(?:p|div|section|article|h[1-6]|li|tr)>", "\n", text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = html_lib.unescape(text)
    return _text_summary("html", text)


def _parse_json_text(content: bytes) -> dict:
    raw = _decode_text(content)
    try:
        parsed = json.loads(raw)
        text = json.dumps(parsed, ensure_ascii=False, indent=2)
    except Exception:
        lines: list[object] = []
        for line in raw.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                lines.append(json.loads(line))
            except Exception:
                lines.append(line)
        text = json.dumps(lines, ensure_ascii=False, indent=2) if lines else raw
    return _text_summary("json", text)


def _parse_docx(content: bytes) -> dict:
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as docx:
            xml = docx.read("word/document.xml")
            style_map = _docx_style_map(docx)
        root = ET.fromstring(xml)
        ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
        body_node = root.find(".//w:body", ns)
        if body_node is None:
            raise ValueError("missing document body")
        paragraphs: list[str] = []
        preview_blocks: list[dict] = []
        table_count = 0

        for child in body_node:
            tag_name = _xml_local_name(child.tag)
            if tag_name == "p":
                text = _docx_paragraph_text(child, ns)
                if not text:
                    continue
                paragraphs.append(text)
                preview_blocks.append(_docx_preview_block(child, ns, text, style_map, len(preview_blocks)))
            elif tag_name == "tbl":
                rows = _docx_table_rows(child, ns)
                if not rows:
                    continue
                table_count += 1
                preview_blocks.append({"type": "table", "rows": rows[:60]})
                for row in rows:
                    row_text = " | ".join(cell for cell in row if cell)
                    if row_text:
                        paragraphs.append(row_text)

        body = "\n".join(paragraphs)
        return {
            "content_type": "word",
            "extraction_status": "parsed" if body.strip() else "empty",
            "paragraph_count": len(paragraphs),
            "table_count": table_count,
            "paragraphs": paragraphs[:1000],
            "preview_blocks": preview_blocks[:1000],
            "text": _compact_text(body, limit=80000, preserve_lines=True),
        }
    except Exception as exc:
        return {
            "content_type": "word",
            "extraction_status": "failed",
            "extraction_note": f"Word 文件正文未能自动解析：{exc.__class__.__name__}。请补充关键段落或转换为可复制文本。",
        }


def _parse_legacy_convertible(filename: str, content: bytes) -> dict:
    converted = _convert_legacy_document(filename, content)
    if converted.strip():
        return _text_summary("word" if filename.lower().endswith(".doc") else "presentation", converted, source="external_converter")
    fallback = _extract_printable_text(content)
    if fallback.strip():
        return _text_summary(
            "word" if filename.lower().endswith(".doc") else "presentation",
            fallback,
            source="binary_text_fallback",
            note="未找到可用文档转换器，已从二进制文件中尽力提取可读文本。建议部署环境安装 libreoffice、antiword 或 catdoc 提升解析质量。",
        )
    return {
        "content_type": "word" if filename.lower().endswith(".doc") else "presentation",
        "extraction_status": "dependency_missing",
        "extraction_note": "当前运行环境缺少旧版 Office 文档转换器，已保存原文件。建议安装 libreoffice、antiword、catdoc 或 pandoc 后重新解析。",
    }


def _parse_rtf(filename: str, content: bytes) -> dict:
    converted = _convert_legacy_document(filename, content)
    if converted.strip():
        return _text_summary("rtf", converted, source="external_converter")
    text = _decode_text(content)
    # Lightweight RTF fallback: strip control words and braces. It is not a full
    # renderer, but gives the archive enough readable context when converters are unavailable.
    text = re.sub(r"\\'[0-9a-fA-F]{2}", " ", text)
    text = re.sub(r"\\[a-zA-Z]+-?\d* ?", " ", text)
    text = text.replace("{", " ").replace("}", " ").replace("\\", " ")
    return _text_summary("rtf", text, source="rtf_text_fallback")


def _parse_pptx(content: bytes) -> dict:
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as pptx:
            slide_names = sorted(
                name for name in pptx.namelist()
                if re.match(r"ppt/slides/slide\d+\.xml$", name)
            )
            ns = {"a": "http://schemas.openxmlformats.org/drawingml/2006/main"}
            blocks: list[dict] = []
            text_parts: list[str] = []
            for slide_index, name in enumerate(slide_names, start=1):
                root = ET.fromstring(pptx.read(name))
                lines = [
                    "".join(t.text or "" for t in paragraph.findall(".//a:t", ns)).strip()
                    for paragraph in root.findall(".//a:p", ns)
                ]
                lines = [line for line in lines if line]
                if not lines:
                    continue
                blocks.append({"type": "heading", "text": f"第 {slide_index} 页", "level": 2})
                text_parts.append(f"第 {slide_index} 页")
                for line_index, line in enumerate(lines):
                    block = {"type": "title" if line_index == 0 else "paragraph", "text": line, "level": 3}
                    blocks.append(block)
                    text_parts.append(line)
        body = "\n".join(text_parts)
        return {
            "content_type": "presentation",
            "extraction_status": "parsed" if body.strip() else "empty",
            "slide_count": len(slide_names),
            "paragraph_count": len(text_parts),
            "paragraphs": text_parts[:1000],
            "preview_blocks": blocks[:1000],
            "text": _compact_text(body, limit=TEXT_LIMIT, preserve_lines=True),
        }
    except Exception as exc:
        return {
            "content_type": "presentation",
            "extraction_status": "failed",
            "extraction_note": f"PPTX 文件正文未能自动解析：{exc.__class__.__name__}。请补充关键页截图或转换为 PDF。",
        }


def _convert_legacy_document(filename: str, content: bytes) -> str:
    suffix = Path(filename).suffix or ".doc"
    with tempfile.TemporaryDirectory() as tmpdir:
        input_path = Path(tmpdir) / f"input{suffix}"
        input_path.write_bytes(content)
        output_path = Path(tmpdir) / "output.txt"
        attempts: list[list[str]] = []
        if shutil.which("textutil"):
            attempts.append(["textutil", "-convert", "txt", "-stdout", str(input_path)])
        if shutil.which("antiword") and suffix.lower() == ".doc":
            attempts.append(["antiword", str(input_path)])
        if shutil.which("catdoc") and suffix.lower() == ".doc":
            attempts.append(["catdoc", str(input_path)])
        if shutil.which("pandoc"):
            attempts.append(["pandoc", str(input_path), "-t", "plain"])
        office = shutil.which("soffice") or shutil.which("libreoffice")
        if office:
            attempts.append([office, "--headless", "--convert-to", "txt:Text", "--outdir", tmpdir, str(input_path)])

        for cmd in attempts:
            try:
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=20, check=False)
                if result.stdout.strip():
                    return result.stdout
                if output_path.exists() and output_path.read_text(errors="ignore").strip():
                    return output_path.read_text(errors="ignore")
                converted = list(Path(tmpdir).glob("*.txt"))
                for path in converted:
                    text = path.read_text(errors="ignore")
                    if text.strip():
                        return text
            except Exception:
                continue
    return ""


def _extract_printable_text(content: bytes) -> str:
    decoded = content.decode("latin-1", errors="ignore")
    runs = re.findall(r"[\x20-\x7E\u00A0-\uFFFF]{4,}", decoded)
    text = "\n".join(run.strip() for run in runs if run.strip())
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text


def _xml_local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


def _docx_attr(name: str) -> str:
    return f"{{http://schemas.openxmlformats.org/wordprocessingml/2006/main}}{name}"


def _docx_style_map(docx: zipfile.ZipFile) -> dict[str, dict[str, str | int]]:
    styles: dict[str, dict[str, str | int]] = {}
    try:
        root = ET.fromstring(docx.read("word/styles.xml"))
    except Exception:
        return styles
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    for style in root.findall(".//w:style", ns):
        style_id = style.attrib.get(_docx_attr("styleId"), "")
        if not style_id:
            continue
        name_node = style.find("./w:name", ns)
        outline_node = style.find("./w:pPr/w:outlineLvl", ns)
        name = name_node.attrib.get(_docx_attr("val"), "") if name_node is not None else ""
        outline_raw = outline_node.attrib.get(_docx_attr("val"), "") if outline_node is not None else ""
        meta: dict[str, str | int] = {"name": name}
        if str(outline_raw).isdigit():
            meta["outline_level"] = int(outline_raw)
        styles[style_id] = meta
    return styles


def _docx_paragraph_text(para: ET.Element, ns: dict[str, str]) -> str:
    return "".join(node.text or "" for node in para.findall(".//w:t", ns)).strip()


def _docx_paragraph_style_id(para: ET.Element, ns: dict[str, str]) -> str:
    style = para.find("./w:pPr/w:pStyle", ns)
    return style.attrib.get(_docx_attr("val"), "") if style is not None else ""


def _docx_paragraph_alignment(para: ET.Element, ns: dict[str, str]) -> str:
    alignment = para.find("./w:pPr/w:jc", ns)
    return alignment.attrib.get(_docx_attr("val"), "") if alignment is not None else ""


def _docx_preview_block(
    para: ET.Element,
    ns: dict[str, str],
    text: str,
    style_map: dict[str, dict[str, str | int]],
    index: int,
) -> dict:
    style_id = _docx_paragraph_style_id(para, ns)
    style_meta = style_map.get(style_id, {})
    style_name = str(style_meta.get("name") or "").lower()
    outline_level = style_meta.get("outline_level")
    alignment = _docx_paragraph_alignment(para, ns)

    if index == 0 and (alignment == "center" or len(text) <= 80):
        return {"type": "title", "text": text, "level": 1}
    if isinstance(outline_level, int):
        return {"type": "heading", "text": text, "level": min(outline_level + 1, 6)}
    match = re.search(r"heading\s*(\d+)", style_name)
    if match:
        return {"type": "heading", "text": text, "level": min(int(match.group(1)), 6)}
    if re.match(r"^[一二三四五六七八九十]+[、.．]\s*", text):
        return {"type": "heading", "text": text, "level": 2}
    if re.match(r"^\d+(?:\.\d+)+\s+", text):
        return {"type": "heading", "text": text, "level": 3}
    return {"type": "paragraph", "text": text}


def _docx_table_rows(tbl: ET.Element, ns: dict[str, str]) -> list[list[str]]:
    rows: list[list[str]] = []
    for row in tbl.findall("./w:tr", ns):
        cells: list[str] = []
        for cell in row.findall("./w:tc", ns):
            parts = [_docx_paragraph_text(para, ns) for para in cell.findall("./w:p", ns)]
            cells.append(" ".join(part for part in parts if part).strip())
        if any(cells):
            rows.append(cells)
    return rows


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
        pages = [page.extract_text() or "" for page in reader.pages[:PDF_MAX_PAGES]]
        text = "\n".join(page for page in pages if page.strip())
        return {
            "content_type": "pdf",
            "extraction_status": "parsed" if text.strip() else "empty",
            "page_count": len(reader.pages),
            "preview_blocks": [
                {"type": "paragraph", "text": line.strip()}
                for line in text.splitlines()
                if line.strip()
            ][:1000],
            "paragraphs": [line.strip() for line in text.splitlines() if line.strip()][:1000],
            "text": _compact_text(text, limit=80000, preserve_lines=True),
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
