"""事实档案构建测试：同字段取最新 / 动态经营域 / 文件聚合 / 跳过文件摘要。"""
import json
from datetime import datetime, timedelta, timezone

from app.api.project import _build_archive, _render_archive_file_preview_blocks, _render_archive_file_preview_text
from app.db.models import DiagnosisRecord, ProjectMemoryEntry, UploadedFile


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

    # 项目基本盘
    profile = {f.label: f.value for f in archive.profile}
    assert profile["项目/品牌名称"] == "华火厨电"
    assert profile["所属行业"] == "商用厨电"

    # 板块事实
    by_module = {m.module: m for m in archive.modules}
    assert by_module["finance"].has_data is True
    fin = {f.label: f.value for f in by_module["finance"].facts}
    assert fin["上年度营收"] == "6000万元"
    # 默认三个基础经营域始终保留，项目数据域追加在后面。
    assert [m.module for m in archive.modules] == ["market", "product", "sales", "finance"]
    assert by_module["market"].has_data is False
    assert by_module["product"].has_data is False
    assert by_module["sales"].has_data is True


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
    assert profile["项目/品牌名称"] == "华火科技"  # 画像也取最新
    assert archive.last_updated == _now(60)


def test_archive_translates_technical_fact_keys_to_chinese_labels():
    rec = _record(
        _now(),
        problem_map={},
        answers=[{"module": "sales", "facts": {
            "core_problem": "尚未跑通可持续销售模式",
            "goal": "建立可复制的销售模型",
            "constraints": "预算和团队能力有限",
            "impact": "现金流持续承压",
            "data_readiness": "可提供直播与成交数据",
        }}],
    )
    archive = _build_archive([rec], [])
    sales = next(m for m in archive.modules if m.module == "sales")
    facts = {f.label: f.value for f in sales.facts}

    assert facts["核心问题"] == "尚未跑通可持续销售模式"
    assert facts["目标"] == "建立可复制的销售模型"
    assert facts["约束条件"] == "预算和团队能力有限"
    assert facts["业务影响"] == "现金流持续承压"
    assert facts["可用数据"] == "可提供直播与成交数据"
    assert "core_problem" not in facts
    assert "data_readiness" not in facts


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
    assert [m.module for m in archive.modules] == ["market", "product", "sales"]
    assert all(m.has_data is False for m in archive.modules)
    assert "channel_franchise" in {m.module for m in archive.recommended_modules}


def test_archive_tolerates_bad_json():
    bad = DiagnosisRecord(user_id="u1", answers_json="{not valid json", created_at=_now())
    archive = _build_archive([bad], [])
    assert archive.profile == []
    assert all(not m.has_data for m in archive.modules)


def test_archive_translates_retention_churn_module_label():
    rec = _record(
        _now(),
        problem_map={},
        answers=[{"module": "retention_churn", "facts": {"回流用户数": "注册20人，30天内只有一个人调用API"}}],
    )
    archive = _build_archive([rec], [])
    module = next(m for m in archive.modules if m.module == "retention_churn")

    assert module.label == "留存与流失"
    assert module.has_data is True


def test_archive_uses_refined_memory_instead_of_raw_answer_copy():
    rec = _record(
        _now(),
        problem_map={},
        answers=[{"module": "market", "facts": {
            "补充说明": "目前还没有开始对外引流，都是内部在推，不知道怎么对外引流",
            "主站与API入口链接": "https://ggoo.ai、https://api2sub.ggoo.ai",
        }}],
    )
    rec.id = "rec-1"
    refined = ProjectMemoryEntry(
        project_id="p1",
        user_id="u1",
        entry_type="archive_refinement",
        summary="智能提炼入档：市场与客户，已整理核心入口。",
        payload_json=json.dumps({
            "module": "market",
            "label": "市场与客户",
            "highlights": [
                {
                    "label": "核心入口链接",
                    "value": "官网 ggoo.ai；API 网关 api2sub.ggoo.ai",
                    "display": {"type": "link_list", "unit": "", "series": []},
                    "source_labels": ["主站与API入口链接"],
                }
            ],
        }, ensure_ascii=False),
        source_id="rec-1",
        created_at=_now(1),
    )

    archive = _build_archive([rec], [], [refined])
    market = next(m for m in archive.modules if m.module == "market")
    facts = {f.label: f.value for f in market.facts}

    assert facts["核心入口链接"] == "官网 ggoo.ai；API 网关 api2sub.ggoo.ai"
    refined_fact = next(f for f in market.facts if f.label == "核心入口链接")
    assert refined_fact.display == {"type": "link_list", "unit": "", "series": []}
    assert refined_fact.source_labels == ["主站与API入口链接"]
    assert "补充说明" not in facts
    assert "主站与API入口链接" not in facts


def test_archive_manual_enabled_module_persists_without_data():
    entry = ProjectMemoryEntry(
        project_id="p1",
        user_id="u1",
        entry_type="archive_module_enabled",
        summary="启用经营域：法务合规",
        payload_json=json.dumps({"module": "legal_compliance", "label": "法务合规"}, ensure_ascii=False),
        created_at=_now(),
    )
    archive = _build_archive([], [], [entry])
    by_module = {m.module: m for m in archive.modules}

    assert [m.module for m in archive.modules[:3]] == ["market", "product", "sales"]
    assert by_module["legal_compliance"].label == "法务合规"
    assert by_module["legal_compliance"].has_data is False
    assert "legal_compliance" not in {m.module for m in archive.recommended_modules}


def test_archive_hidden_module_is_not_displayed_or_recommended():
    entry = ProjectMemoryEntry(
        project_id="p1",
        user_id="u1",
        entry_type="archive_module_hidden",
        summary="隐藏经营域：产品与服务",
        payload_json=json.dumps({"module": "product", "label": "产品与服务"}, ensure_ascii=False),
        created_at=_now(),
    )
    archive = _build_archive([], [], [entry])

    assert [m.module for m in archive.modules] == ["market", "sales"]
    assert [m.module for m in archive.hidden_modules] == ["product"]
    assert "product" not in {m.module for m in archive.recommended_modules}


def test_archive_latest_visibility_action_wins():
    hidden = ProjectMemoryEntry(
        project_id="p1",
        user_id="u1",
        entry_type="archive_module_hidden",
        summary="隐藏经营域：产品与服务",
        payload_json=json.dumps({"module": "product", "label": "产品与服务"}, ensure_ascii=False),
        created_at=_now(10),
    )
    enabled = ProjectMemoryEntry(
        project_id="p1",
        user_id="u1",
        entry_type="archive_module_enabled",
        summary="启用经营域：产品与服务",
        payload_json=json.dumps({"module": "product", "label": "产品与服务"}, ensure_ascii=False),
        created_at=_now(20),
    )
    archive = _build_archive([], [], [hidden, enabled])

    assert "product" in {m.module for m in archive.modules}
    assert archive.hidden_modules == []


def test_archive_recommends_modules_from_project_keywords():
    rec = _record(
        _now(),
        problem_map={
            "company_name": "华火",
            "industry": "新能源厨电",
            "main_business": "电火灶招商加盟，涉及代理合同、政策监管和售后安装",
        },
        answers=[{"module": "sales", "facts": {"线索来源": "招商页"}}],
    )
    archive = _build_archive([rec], [])
    recommended = {item.module for item in archive.recommended_modules}

    assert "channel_franchise" in recommended
    assert "legal_compliance" in recommended
    assert "policy" in recommended
    assert "service_delivery" in recommended


def test_archive_ignores_internal_upload_modules():
    f = UploadedFile(
        session_id="s1",
        module_key="conversation",
        field_key="uploaded_context",
        original_name="项目资料.docx",
        stored_path="x",
        created_at=_now(),
    )
    archive = _build_archive([], [f])

    assert "conversation" not in {m.module for m in archive.modules}
    assert [m.module for m in archive.modules] == ["market", "product", "sales"]


def test_archive_file_preview_keeps_document_structure():
    raw = json.dumps(
        {
            "content_type": "word",
            "preview_blocks": [
                {"type": "title", "text": "项目调研报告", "level": 1},
                {"type": "heading", "text": "一、 市场概况", "level": 2},
                {"type": "paragraph", "text": "当前市场仍处于教育期。"},
                {"type": "table", "rows": [["维度", "结论"], ["需求", "刚性但认知不足"]]},
            ],
        },
        ensure_ascii=False,
    )

    blocks = _render_archive_file_preview_blocks(raw)

    assert blocks[0] == {"type": "title", "text": "项目调研报告", "level": 1}
    assert blocks[1]["type"] == "heading"
    assert blocks[3] == {"type": "table", "rows": [["维度", "结论"], ["需求", "刚性但认知不足"]]}
    assert "维度 | 结论" in _render_archive_file_preview_text(raw)
