import io
from app.data.uploads import parse_table


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
