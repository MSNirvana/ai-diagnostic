import io
from app.data.uploads import parse_table, parse_uploaded_file


def test_parse_csv_returns_summary():
    csv_bytes = b"month,sales\n2026-01,100\n2026-02,150\n2026-03,90\n"
    summary = parse_table(filename="sales.csv", content=csv_bytes)
    assert summary["row_count"] == 3
    assert "sales" in summary["columns"]
    assert summary["numeric_stats"]["sales"]["sum"] == 340


def test_parse_rejects_unknown_extension():
    import pytest
    with pytest.raises(ValueError):
        parse_table(filename="x.txt", content=b"abc")


def test_parse_markdown_returns_preview_blocks():
    summary = parse_uploaded_file("strategy.md", "# 总战略\n\n一、定位\n\n先建立现金流底盘。".encode("utf-8"))

    assert summary["content_type"] == "markdown"
    assert summary["extraction_status"] == "parsed"
    assert summary["preview_blocks"][0]["type"] == "heading"
    assert "现金流底盘" in summary["text"]


def test_parse_html_returns_readable_text():
    html = "<html><body><h1>项目说明</h1><p>目标客户是AI创业者。</p><script>ignore()</script></body></html>"
    summary = parse_uploaded_file("intro.html", html.encode("utf-8"))

    assert summary["content_type"] == "html"
    assert "项目说明" in summary["text"]
    assert "ignore" not in summary["text"]


def test_parse_json_returns_pretty_text():
    summary = parse_uploaded_file("metrics.json", b'{"roi": 1.8, "channel": "douyin"}')

    assert summary["content_type"] == "json"
    assert '"roi": 1.8' in summary["text"]
    assert summary["preview_blocks"]


def test_parse_csv_includes_table_preview_block():
    csv_bytes = b"month,sales\n2026-01,100\n2026-02,150\n"
    summary = parse_uploaded_file("sales.csv", csv_bytes)

    assert summary["content_type"] == "table"
    assert summary["preview_blocks"][0]["type"] == "table"
    assert summary["preview_blocks"][0]["rows"][0] == ["month", "sales"]


def test_parse_legacy_doc_uses_converter_when_available(monkeypatch):
    import subprocess

    def fake_which(name: str) -> str | None:
        return "/usr/bin/textutil" if name == "textutil" else None

    class FakeResult:
        stdout = "AI创业者创新空间与公司整体战略整合说明\n\n一、总战略定位\n公司未来不是单纯做一个项目。"

    monkeypatch.setattr("app.data.uploads.shutil.which", fake_which)
    monkeypatch.setattr(subprocess, "run", lambda *args, **kwargs: FakeResult())

    summary = parse_uploaded_file("战略说明.doc", b"legacy-binary")

    assert summary["content_type"] == "word"
    assert summary["extraction_status"] == "parsed"
    assert "总战略定位" in summary["text"]
    assert summary["preview_blocks"][0]["type"] == "title"
