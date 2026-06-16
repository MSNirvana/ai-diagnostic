"""事实档案构建测试：同字段取最新 / 未填板块 has_data=false / 文件聚合 / 跳过文件摘要。"""
import json
from datetime import datetime, timedelta, timezone

from app.api.project import _build_archive, ARCHIVE_MODULES
from app.db.models import DiagnosisRecord, UploadedFile


def _now(offset_min: int = 0) -> datetime:
    return datetime(2026, 6, 14, 10, 0, tzinfo=timezone.utc) + timedelta(minutes=offset_min)


def _record(created_at: datetime, *, problem_map: dict, answers: list[dict]) -> DiagnosisRecord:
    return DiagnosisRecord(
        user_id="u1",
        answers_json=json.dumps({"problem_map": problem_map, "answers": answers}, ensure_ascii=False),
        created_at=created_at,
    )


def test_archive_profile_and_module_facts():
    rec = _record(
        _now(),
        problem_map={"company_name": "华火厨电", "industry": "商用厨电", "main_business": "电火灶"},
        answers=[
            {"module": "finance", "facts": {"上年度营收": "6000万元", "毛利率": "38%"}},
            {"module": "sales", "facts": {"获客成本": "1800元"}},
        ],
    )
    archive = _build_archive([rec], [])

    # 企业基本盘
    profile = {f.label: f.value for f in archive.profile}
    assert profile["公司名称"] == "华火厨电"
    assert profile["所属行业"] == "商用厨电"

    # 板块事实
    by_module = {m.module: m for m in archive.modules}
    assert by_module["finance"].has_data is True
    fin = {f.label: f.value for f in by_module["finance"].facts}
    assert fin["上年度营收"] == "6000万元"
    # 未填板块灰显
    assert by_module["product"].has_data is False
    assert by_module["product"].facts == []
    # 固定 6 板块顺序
    assert [m.module for m in archive.modules] == [k for k, _ in ARCHIVE_MODULES]


def test_archive_latest_value_wins():
    """同一字段多次诊断填过，取最新（created_at 最大）那次的值。"""
    old = _record(
        _now(0),
        problem_map={"company_name": "华火"},
        answers=[{"module": "finance", "facts": {"上年度营收": "5000万元"}}],
    )
    new = _record(
        _now(60),
        problem_map={"company_name": "华火科技"},
        answers=[{"module": "finance", "facts": {"上年度营收": "6000万元"}}],
    )
    # 倒序传入（最新在前），模拟接口查询顺序
    archive = _build_archive([new, old], [])

    fin = {f.label: f.value for f in next(m for m in archive.modules if m.module == "finance").facts}
    assert fin["上年度营收"] == "6000万元"   # 取了新值
    profile = {f.label: f.value for f in archive.profile}
    assert profile["公司名称"] == "华火科技"  # 画像也取最新
    assert archive.last_updated == _now(60)


def test_archive_skips_file_summary_facts():
    """file_ 前缀的合成 facts（文件解析摘要）不进档案字段。"""
    rec = _record(
        _now(),
        problem_map={},
        answers=[{"module": "finance", "facts": {
            "毛利率": "38%",
            "file_报表.xlsx": "解析摘要……",
            "现金流_file_流水.csv": "解析摘要……",
        }}],
    )
    archive = _build_archive([rec], [])
    fin = {f.label: f.value for f in next(m for m in archive.modules if m.module == "finance").facts}
    assert fin == {"毛利率": "38%"}   # 只剩用户直接填的


def test_archive_files_aggregated_newest_first():
    f1 = UploadedFile(session_id="s1", module_key="finance", field_key="现金流",
                      original_name="报表.xlsx", stored_path="x", created_at=_now(0))
    f2 = UploadedFile(session_id="s1", module_key="sales", field_key="投放",
                      original_name="ads.csv", stored_path="y", created_at=_now(30))
    archive = _build_archive([], [f1, f2])
    assert [f.name for f in archive.files] == ["ads.csv", "报表.xlsx"]  # 新的在前
    assert archive.files[0].module == "sales"


def test_archive_empty_project():
    archive = _build_archive([], [])
    assert archive.profile == []
    assert archive.files == []
    assert archive.last_updated is None
    assert all(m.has_data is False for m in archive.modules)


def test_archive_tolerates_bad_json():
    bad = DiagnosisRecord(user_id="u1", answers_json="{not valid json", created_at=_now())
    archive = _build_archive([bad], [])
    assert archive.profile == []
    assert all(not m.has_data for m in archive.modules)
