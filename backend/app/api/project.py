"""项目（持续诊断档案）端点。

一个用户可有多个项目，每个项目沉淀其下所有诊断会话与诊断记录，
随时间持续更新——这是从一次性诊断走向持续诊断的载体。
"""
import json
import mimetypes
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.jwt import get_current_user
from app.config import get_llm_client
from app.db.database import get_session
from app.db.models import (
    User,
    Project,
    BrainstormSession,
    DiagnosisSession,
    DiagnosisRecord,
    ProjectMemoryEntry,
    UploadedFile,
    WarRoomFeedbackEvent,
)
from app.memory.project_memory import append_memory_entry
from app.memory.session_visibility import is_meaningful_session
from app.memory.session_title import display_session_title
from app.llm.base import LLMClient
from app.skills.prompts import ARCHIVE_EXTRACTION
from app.skills.parsing import parse_json_object
from app.skills.store import get_active_skill_version
from app.models.warroom import WarRoomPlan
from app.research.store import list_project_evidence
from app.warroom.history import can_build_war_room_plan, get_or_build_project_war_room_plan

router = APIRouter(prefix="/project")


def _now() -> datetime:
    return datetime.now(timezone.utc)


class CreateProjectRequest(BaseModel):
    name: str


class ProjectSummary(BaseModel):
    id: str
    name: str
    created_at: datetime
    updated_at: datetime
    status: str
    memory_summary: str = ""


class MemoryEntryOut(BaseModel):
    id: str
    created_at: datetime
    entry_type: str
    summary: str
    payload: dict
    source_id: str | None = None


class SessionBrief(BaseModel):
    id: str
    title: str
    status: str
    updated_at: datetime
    is_pinned: bool = False
    memory_enabled: bool = True


class BrainstormBrief(BaseModel):
    id: str
    title: str
    updated_at: datetime
    is_pinned: bool = False
    use_project_context: bool = True


class RecordBrief(BaseModel):
    id: str
    created_at: datetime
    module_count: int
    has_war_room_plan: bool = False
    review_status: str = "approved"


class ProjectDeliveryStatus(BaseModel):
    state: str
    approved_count: int = 0
    pending_review_count: int = 0
    rejected_count: int = 0
    latest_review_status: str | None = None


# ── 事实档案：把老板填写/上传的客观信息整理归档（不含任何诊断/信号/问题判断）──

# 经营域目录：前 6 个是通用种子，不代表每个项目都必须展示。
ARCHIVE_MODULES: list[tuple[str, str]] = [
    ("market", "市场与客户"),
    ("product", "产品与服务"),
    ("sales", "销售与增长"),
    ("ops", "运营与供应链"),
    ("org", "组织与人才"),
    ("finance", "财务与资本"),
    ("channel_franchise", "渠道与加盟"),
    ("legal_compliance", "法务合规"),
    ("policy", "政策与监管"),
    ("supply_chain", "供应链"),
    ("manufacturing", "生产制造"),
    ("service_delivery", "交付与售后"),
    ("data_systems", "数据系统"),
    ("retention_churn", "留存与流失"),
    ("tax", "税务合规"),
    ("ip", "知识产权"),
    ("ecommerce", "电商与内容"),
]
ARCHIVE_MODULE_LABELS = dict(ARCHIVE_MODULES)
ARCHIVE_MODULE_KEYWORDS: dict[str, tuple[str, ...]] = {
    "market": ("市场", "客户", "客群", "用户", "需求", "定位", "流量", "获客", "推广", "品牌"),
    "product": ("产品", "服务", "功能", "卖点", "研发", "体验", "质量", "型号", "sku"),
    "sales": ("销售", "成交", "转化", "线索", "报价", "复购", "回款", "客单", "直播间"),
    "ops": ("运营", "交付", "履约", "库存", "排产", "流程", "效率", "门店", "店铺"),
    "org": ("组织", "团队", "人才", "招聘", "绩效", "激励", "负责人", "人员"),
    "finance": ("财务", "资金", "现金流", "毛利", "利润", "营收", "成本", "预算", "账期"),
    "channel_franchise": ("招商", "加盟", "代理", "经销", "渠道商", "招商页", "回本", "保证金"),
    "legal_compliance": ("合规", "合同", "资质", "法务", "许可", "风险条款", "宣传承诺"),
    "policy": ("政策", "监管", "补贴", "标准", "认证", "地方政策", "行业规范"),
    "supply_chain": ("供应链", "供应商", "采购", "原料", "物流", "仓储", "交期"),
    "manufacturing": ("生产", "制造", "工厂", "产能", "代工", "品控", "良率", "设备"),
    "service_delivery": ("售后", "安装", "维修", "客服", "培训", "履约", "交付"),
    "data_systems": ("数据", "系统", "crm", "erp", "后台", "看板", "埋点", "投放账号"),
    "retention_churn": ("留存", "流失", "复购", "续费", "退订", "召回", "生命周期", "沉默用户"),
    "tax": ("税务", "发票", "税负", "进项", "销项", "税筹"),
    "ip": ("专利", "商标", "著作权", "知识产权", "侵权"),
    "ecommerce": ("抖音", "快手", "小红书", "淘宝", "天猫", "京东", "视频号", "内容", "直播"),
}
ARCHIVE_DEFAULT_SEED_MODULES = ("market", "product", "sales")
ARCHIVE_DEFAULT_RECOMMENDED_MODULES = (
    "channel_franchise",
    "legal_compliance",
    "policy",
    "supply_chain",
    "data_systems",
    "service_delivery",
)
ARCHIVE_IGNORED_MODULES = ("conversation", "uploaded_context", "misc", "profile", "supplement")

# 项目画像字段（problem_map 里的英文 key → 中文 label），固定展示顺序
PROFILE_FIELDS: list[tuple[str, str]] = [
    ("company_name", "项目/品牌名称"),
    ("industry", "所属行业"),
    ("main_business", "主营业务"),
    ("business_model", "商业模式"),
    ("scale", "规模"),
    ("stage", "发展阶段"),
]
PROFILE_LABELS = {label for _, label in PROFILE_FIELDS}
ARCHIVE_FIELD_LABELS: dict[str, str] = {
    **dict(PROFILE_FIELDS),
    "core_problem": "核心问题",
    "goal": "目标",
    "constraints": "约束条件",
    "success_criteria": "成功标准",
    "impact": "业务影响",
    "context": "背景情况",
    "suspected_cause": "疑似原因",
    "tried": "已尝试动作",
    "data_readiness": "可用数据",
    "diagnosis_focus": "优先诊断方向",
    "scenario_label": "业务场景",
    "sub_problems": "子问题",
    "information_score": "信息完整度",
    "missing_fields": "待补信息",
    "next_question_reason": "追问原因",
}


class ProfileField(BaseModel):
    label: str
    value: str
    display: dict | None = None
    source_labels: list[str] = []


class ModuleFacts(BaseModel):
    module: str
    label: str
    facts: list[ProfileField]
    has_data: bool


class ArchiveModuleOption(BaseModel):
    module: str
    label: str
    reason: str = ""


class ArchiveFile(BaseModel):
    id: str
    name: str
    module: str
    field: str
    uploaded_at: datetime
    content_type: str = ""
    media_type: str = ""
    extraction_status: str = "none"
    extracted_highlights: list[ProfileField] = []
    preview_text: str = ""
    preview_blocks: list[dict] = []


class ArchiveExtractionPreview(BaseModel):
    file_id: str
    module: str
    field: str
    file_name: str
    highlights: list[ProfileField]
    summary: str = ""
    status: str = "pending_confirm"


class ArchiveExtractionConfirmRequest(BaseModel):
    highlights: list[ProfileField]
    summary: str = ""


class ProjectArchive(BaseModel):
    profile: list[ProfileField]
    modules: list[ModuleFacts]
    recommended_modules: list[ArchiveModuleOption] = []
    hidden_modules: list[ArchiveModuleOption] = []
    files: list[ArchiveFile]
    last_updated: datetime | None = None


class AddArchiveModuleRequest(BaseModel):
    module: str
    label: str | None = None


def _build_archive(
    records: list[DiagnosisRecord],
    files: list[UploadedFile],
    archive_memory_entries: list[ProjectMemoryEntry] | None = None,
) -> ProjectArchive:
    """从项目下所有诊断记录里提取「用户填写的事实」，整理成长期档案。

    - records 必须按 created_at 倒序传入（最新在前）。同一字段取最新值：
      倒序遍历、先到先得、后面的旧值不覆盖。
    - 只收用户直接填写的 facts；以 file_ 前缀的合成 facts（文件解析摘要）跳过。
    - 不含任何信号/结论/问题——那些属于作战室。
    """
    profile_raw: dict[str, str] = {}          # company_name -> value（最新）
    module_facts_raw: dict[str, dict[str, str]] = {}  # module -> {字段key: value}（最新）
    project_text_parts: list[str] = []
    record_modules: set[str] = set()
    enabled_from_memory: dict[str, str] = {}
    hidden_from_memory: dict[str, str] = {}
    module_visibility_seen: set[str] = set()
    refined_source_ids: set[str] = {
        entry.source_id
        for entry in (archive_memory_entries or [])
        if entry.entry_type == "archive_refinement" and entry.source_id
    }

    for record in records:  # 已是 created_at desc
        use_raw_answer_facts = record.id not in refined_source_ids
        try:
            payload = json.loads(record.answers_json)
        except (ValueError, TypeError):
            continue

        problem_map = payload.get("problem_map") or {}
        if isinstance(problem_map, dict):
            for key, _label in PROFILE_FIELDS:
                val = str(problem_map.get(key) or "").strip()
                if val and key not in profile_raw:   # 先到先得=最新
                    profile_raw[key] = val
            project_text_parts.extend(str(value) for value in problem_map.values() if value)

        for answer in payload.get("answers") or []:
            if not isinstance(answer, dict):
                continue
            module = str(answer.get("module") or "").strip()
            if not module:
                continue
            record_modules.add(module)
            if not use_raw_answer_facts:
                continue
            facts = answer.get("facts") or {}
            if not isinstance(facts, dict):
                continue
            bucket = module_facts_raw.setdefault(module, {})
            for fkey, fval in facts.items():
                key = str(fkey)
                if key.startswith("file_") or "_file_" in key:
                    continue  # 文件解析摘要，不是用户直接填的字段
                value = str(fval or "").strip()
                label = _archive_field_label(key)
                if value and label not in bucket:   # 先到先得=最新
                    bucket[label] = value
                    project_text_parts.append(f"{key} {value}")

    fact_meta_raw: dict[str, dict[str, dict]] = {}

    def merge_highlights(module_key: str, highlights: list[ProfileField], *, display_hints: list[dict] | None = None) -> None:
        if module_key == "profile":
            for item in highlights:
                if item.label not in profile_raw and item.value.strip():
                    profile_raw[item.label] = item.value.strip()
            return
        bucket = module_facts_raw.setdefault(module_key, {})
        meta_bucket = fact_meta_raw.setdefault(module_key, {})
        for index, item in enumerate(highlights):
            label = _archive_field_label(item.label)
            if label not in bucket and item.value.strip():
                bucket[label] = item.value.strip()
                display = item.display or ((display_hints or [])[index] if index < len(display_hints or []) else None)
                meta_bucket[label] = {
                    "display": display,
                    "source_labels": item.source_labels,
                }

    # 文件删除后，已确认沉淀的结构化事实仍应从项目长期记忆中保留。
    for entry in sorted(archive_memory_entries or [], key=_archive_entry_sort_key, reverse=True):
        try:
            payload = json.loads(entry.payload_json)
        except (ValueError, TypeError):
            continue
        if not isinstance(payload, dict):
            continue
        if entry.entry_type in {"archive_module_enabled", "archive_module_hidden"}:
            module_key = str(payload.get("module") or "").strip()
            label = str(payload.get("label") or "").strip()
            if module_key and module_key not in module_visibility_seen:
                module_visibility_seen.add(module_key)
                if entry.entry_type == "archive_module_hidden":
                    hidden_from_memory[module_key] = label or _archive_module_label(module_key)
                    continue
                enabled_from_memory[module_key] = label or _archive_module_label(module_key)
            continue
        if entry.entry_type not in {"archive_file_extract", "archive_refinement"}:
            continue
        module_key = str(payload.get("module") or "").strip()
        if not module_key:
            continue
        highlights = _load_archive_highlights_from_payload(payload)
        if highlights:
            display_hints = payload.get("display_hints") if entry.entry_type == "archive_refinement" else None
            merge_highlights(module_key, highlights, display_hints=display_hints if isinstance(display_hints, list) else None)
            project_text_parts.extend(f"{item.label} {item.value}" for item in highlights)

    # 兼容历史数据：没有长期记忆的已确认文件重点，也纳入长期档案。
    for uploaded in sorted(files, key=lambda item: item.created_at, reverse=True):
        if uploaded.module_key:
            record_modules.add(uploaded.module_key)
            project_text_parts.append(f"{uploaded.module_key} {uploaded.field_key} {uploaded.original_name}")
        if (uploaded.archive_extraction_status or "none") != "confirmed":
            continue
        highlights = _load_archive_highlights(uploaded.archive_extraction_json)
        if not highlights:
            continue
        merge_highlights(uploaded.module_key, highlights)
        project_text_parts.extend(f"{item.label} {item.value}" for item in highlights)

    profile = [
        ProfileField(label=label, value=profile_raw[key])
        for key, label in PROFILE_FIELDS
        if profile_raw.get(key)
    ]
    extra_profile = [
        ProfileField(label=label, value=value)
        for label, value in profile_raw.items()
        if label not in PROFILE_LABELS
    ]
    profile.extend(extra_profile)

    enabled_modules = _enabled_archive_modules(
        module_facts_raw=module_facts_raw,
        files=files,
        record_modules=record_modules,
        enabled_from_memory=enabled_from_memory,
        hidden_modules=set(hidden_from_memory),
    )
    recommended_modules = _recommended_archive_modules(
        enabled_modules=enabled_modules,
        hidden_modules=set(hidden_from_memory),
        project_text=" ".join(project_text_parts),
    )
    hidden_modules = [
        ArchiveModuleOption(module=module, label=label, reason="已隐藏，可随时恢复。")
        for module, label in hidden_from_memory.items()
        if _is_archive_business_module(module)
    ]

    modules: list[ModuleFacts] = []
    for module in enabled_modules:
        label = enabled_from_memory.get(module) or _archive_module_label(module)
        bucket = module_facts_raw.get(module, {})
        meta_bucket = fact_meta_raw.get(module, {})
        facts = [
            ProfileField(
                label=k,
                value=v,
                display=meta_bucket.get(k, {}).get("display"),
                source_labels=meta_bucket.get(k, {}).get("source_labels") or [],
            )
            for k, v in bucket.items()
        ]
        modules.append(
            ModuleFacts(module=module, label=label, facts=facts, has_data=bool(facts))
        )

    archive_files = [
        ArchiveFile(
            id=f.id,
            name=f.original_name,
            module=f.module_key,
            field=f.field_key,
            uploaded_at=f.created_at,
            content_type=_archive_file_content_type(f.parsed_summary),
            media_type=mimetypes.guess_type(f.original_name)[0] or "",
            extraction_status=f.archive_extraction_status or "none",
            extracted_highlights=_load_archive_highlights(f.archive_extraction_json),
            preview_text=_render_archive_file_preview_text(f.parsed_summary),
            preview_blocks=_render_archive_file_preview_blocks(f.parsed_summary),
        )
        for f in sorted(files, key=lambda x: x.created_at, reverse=True)
    ]

    last_updated = records[0].created_at if records else None

    return ProjectArchive(
        profile=profile,
        modules=modules,
        recommended_modules=recommended_modules,
        hidden_modules=hidden_modules,
        files=archive_files,
        last_updated=last_updated,
    )


class ProjectDetail(BaseModel):
    id: str
    name: str
    created_at: datetime
    updated_at: datetime
    status: str
    memory_summary: str
    memory_entries: list[MemoryEntryOut]
    sessions: list[SessionBrief]
    brainstorm_sessions: list[BrainstormBrief] = []
    records: list[RecordBrief]
    archive: ProjectArchive
    war_room_plan: WarRoomPlan | None = None
    delivery_status: ProjectDeliveryStatus


class PatchProjectRequest(BaseModel):
    name: str | None = None
    status: str | None = None


class ProjectEvidenceOut(BaseModel):
    id: str
    job_id: str
    project_id: str | None = None
    record_id: str | None = None
    module: str
    source_stage: str
    provider: str
    query: str
    title: str
    url: str
    snippet: str
    source_type: str
    credibility: float
    retrieved_at: str


class WarRoomFeedbackEventOut(BaseModel):
    id: str
    project_id: str
    user_id: str | None = None
    created_at: datetime
    war_room_plan_id: str
    record_id: str | None = None
    card_type: str
    card_id: str
    card_title: str
    adoption_status: str
    feedback_result: str
    note: str = ""
    owner: str = ""
    attachments: list[str] = []


class WarRoomFeedbackCreateRequest(BaseModel):
    war_room_plan_id: str
    record_id: str | None = None
    card_type: str = "decision"
    card_id: str
    card_title: str
    adoption_status: str = "pending"
    feedback_result: str = "none"
    note: str = ""
    owner: str = ""
    attachments: list[str] = []


ADOPTION_STATUS_LABELS = {
    "pending": "待确认",
    "adopted": "已采纳",
    "deferred": "暂缓",
    "rejected": "不采纳",
}
FEEDBACK_RESULT_LABELS = {
    "none": "暂未反馈效果",
    "effective": "有效",
    "no_change": "无明显变化",
    "new_issue": "出现新问题",
    "insufficient_data": "数据不足",
}
VALID_CARD_TYPES = {"decision", "action", "review"}


@router.post("/", response_model=ProjectSummary, status_code=201)
async def create_project(
    body: CreateProjectRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ProjectSummary:
    p = Project(user_id=user.id, name=body.name.strip() or "未命名项目")
    session.add(p)
    await session.commit()
    await session.refresh(p)
    return ProjectSummary(
        id=p.id, name=p.name, created_at=p.created_at,
        updated_at=p.updated_at, status=p.status, memory_summary=p.memory_summary,
    )


@router.get("/", response_model=list[ProjectSummary])
async def list_projects(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[ProjectSummary]:
    stmt = (
        select(Project)
        .where(Project.user_id == user.id)
        .where(Project.status != "deleted")
        .order_by(Project.updated_at.desc())
    )
    rows = (await session.scalars(stmt)).all()
    return [
        ProjectSummary(
            id=p.id, name=p.name, created_at=p.created_at,
            updated_at=p.updated_at, status=p.status, memory_summary=p.memory_summary,
        )
        for p in rows
    ]


@router.get("/{project_id}", response_model=ProjectDetail)
async def get_project(
    project_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ProjectDetail:
    p = await session.get(Project, project_id)
    if p is None or p.user_id != user.id:
        raise HTTPException(status_code=404, detail="项目不存在")

    sess_stmt = (
        select(DiagnosisSession)
        .where(DiagnosisSession.project_id == project_id)
        .where(DiagnosisSession.deleted_at.is_(None))
        .order_by(DiagnosisSession.is_pinned.desc(), DiagnosisSession.updated_at.desc())
    )
    sessions = [
        SessionBrief(
            id=s.id,
            title=display_session_title(s),
            status=s.status,
            updated_at=s.updated_at,
            is_pinned=s.is_pinned,
            memory_enabled=s.memory_enabled,
        )
        for s in (await session.scalars(sess_stmt)).all()
        if is_meaningful_session(s)
    ]

    brainstorm_stmt = (
        select(BrainstormSession)
        .where(BrainstormSession.project_id == project_id)
        .where(BrainstormSession.user_id == user.id)
        .where(BrainstormSession.deleted_at.is_(None))
        .order_by(BrainstormSession.is_pinned.desc(), BrainstormSession.updated_at.desc())
    )
    brainstorm_sessions: list[BrainstormBrief] = []
    for b in (await session.scalars(brainstorm_stmt)).all():
        try:
            messages = json.loads(b.messages_json or "[]")
        except (TypeError, ValueError):
            messages = []
        if not messages:
            continue
        brainstorm_sessions.append(
            BrainstormBrief(
                id=b.id,
                title=b.title or "风暴记录",
                updated_at=b.updated_at,
                is_pinned=b.is_pinned,
                use_project_context=b.use_project_context,
            )
        )

    rec_stmt = (
        select(DiagnosisRecord)
        .where(DiagnosisRecord.project_id == project_id)
        .order_by(DiagnosisRecord.created_at.desc())
    )
    raw_records = list((await session.scalars(rec_stmt)).all())
    records = []
    for r in raw_records:
        try:
            answers = json.loads(r.answers_json)
            mc = len(answers.get("answers", []))
        except (ValueError, TypeError):
            mc = 0
        records.append(
            RecordBrief(
                id=r.id,
                created_at=r.created_at,
                module_count=mc,
                has_war_room_plan=r.review_status == "approved" and can_build_war_room_plan(r),
                review_status=r.review_status,
            )
        )

    # 事实档案：聚合项目下所有诊断记录的用户填写事实 + 上传文件
    all_session_ids = [
        sid for (sid,) in (
            await session.execute(
                select(DiagnosisSession.id).where(DiagnosisSession.project_id == project_id)
            )
        ).all()
    ]
    archive_files: list[UploadedFile] = []
    if all_session_ids:
        file_stmt = select(UploadedFile).where(UploadedFile.session_id.in_(all_session_ids))
        archive_files = list(await session.scalars(file_stmt))
    mem_stmt = (
        select(ProjectMemoryEntry)
        .where(ProjectMemoryEntry.project_id == project_id)
        .order_by(ProjectMemoryEntry.created_at.desc())
    )
    memory_rows = list((await session.scalars(mem_stmt)).all())
    archive = _build_archive(raw_records, archive_files, memory_rows)

    memory_entries: list[MemoryEntryOut] = []
    for entry in memory_rows:
        try:
            payload = json.loads(entry.payload_json)
        except (ValueError, TypeError):
            payload = {}
        memory_entries.append(
            MemoryEntryOut(
                id=entry.id,
                created_at=entry.created_at,
                entry_type=entry.entry_type,
                summary=entry.summary,
                payload=payload,
                source_id=entry.source_id,
            )
        )

    war_room_plan = await get_or_build_project_war_room_plan(session, p)
    delivery_status = _delivery_status(raw_records, war_room_plan)

    return ProjectDetail(
        id=p.id, name=p.name, created_at=p.created_at, updated_at=p.updated_at,
        status=p.status, memory_summary=p.memory_summary,
        memory_entries=memory_entries,
        sessions=sessions, brainstorm_sessions=brainstorm_sessions, records=records,
        archive=archive,
        war_room_plan=war_room_plan,
        delivery_status=delivery_status,
    )


@router.post("/{project_id}/archive/files/{file_id}/extract", response_model=ArchiveExtractionPreview)
async def extract_archive_file(
    project_id: str,
    file_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    llm: LLMClient = Depends(get_llm_client),
) -> ArchiveExtractionPreview:
    project = await session.get(Project, project_id)
    if project is None or project.user_id != user.id:
        raise HTTPException(status_code=404, detail="项目不存在")

    uploaded = await session.get(UploadedFile, file_id)
    if uploaded is None:
        raise HTTPException(status_code=404, detail="文件不存在")

    owner_session = await session.get(DiagnosisSession, uploaded.session_id)
    if owner_session is None or owner_session.project_id != project_id:
        raise HTTPException(status_code=404, detail="文件不存在")

    highlights, summary = await _extract_file_highlights(session, llm, uploaded)
    payload = {
        "highlights": [item.model_dump() for item in highlights],
        "summary": summary,
    }
    uploaded.archive_extraction_json = json.dumps(payload, ensure_ascii=False)
    uploaded.archive_extraction_status = "pending_confirm"
    uploaded.archive_extracted_at = _now()
    session.add(uploaded)
    await session.commit()
    return ArchiveExtractionPreview(
        file_id=uploaded.id,
        module=uploaded.module_key,
        field=uploaded.field_key,
        file_name=uploaded.original_name,
        highlights=highlights,
        summary=summary,
        status="pending_confirm",
    )


@router.post("/{project_id}/archive/files/{file_id}/confirm", response_model=ProjectArchive)
async def confirm_archive_file_extraction(
    project_id: str,
    file_id: str,
    body: ArchiveExtractionConfirmRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ProjectArchive:
    project = await session.get(Project, project_id)
    if project is None or project.user_id != user.id:
        raise HTTPException(status_code=404, detail="项目不存在")

    uploaded = await session.get(UploadedFile, file_id)
    if uploaded is None:
        raise HTTPException(status_code=404, detail="文件不存在")

    owner_session = await session.get(DiagnosisSession, uploaded.session_id)
    if owner_session is None or owner_session.project_id != project_id:
        raise HTTPException(status_code=404, detail="文件不存在")

    clean_highlights = [
        ProfileField(label=str(item.label).strip(), value=str(item.value).strip())
        for item in body.highlights
        if str(item.label).strip() and str(item.value).strip()
    ]
    payload = {
        "highlights": [item.model_dump() for item in clean_highlights],
        "summary": body.summary.strip(),
    }
    uploaded.archive_extraction_json = json.dumps(payload, ensure_ascii=False)
    uploaded.archive_extraction_status = "confirmed"
    uploaded.archive_extracted_at = _now()
    session.add(uploaded)

    if clean_highlights:
        await _append_archive_memory_entry(
            session,
            project_id=project_id,
            uploaded=uploaded,
            highlights=clean_highlights,
            summary=body.summary.strip(),
            user_id=user.id,
        )

    project.updated_at = _now()
    session.add(project)
    await session.commit()

    return await _load_project_archive(session, project_id)


@router.post("/{project_id}/archive/modules", response_model=ProjectArchive)
async def add_archive_module(
    project_id: str,
    body: AddArchiveModuleRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ProjectArchive:
    project = await session.get(Project, project_id)
    if project is None or project.user_id != user.id:
        raise HTTPException(status_code=404, detail="项目不存在")

    module = body.module.strip()
    if not module:
        raise HTTPException(status_code=400, detail="数据板块不能为空")
    label = (body.label or _archive_module_label(module)).strip() or _archive_module_label(module)

    visibility_stmt = (
        select(ProjectMemoryEntry)
        .where(ProjectMemoryEntry.project_id == project_id)
        .where(ProjectMemoryEntry.entry_type.in_(["archive_module_enabled", "archive_module_hidden"]))
        .order_by(ProjectMemoryEntry.created_at.desc())
    )
    for entry in (await session.scalars(visibility_stmt)).all():
        try:
            payload = json.loads(entry.payload_json or "{}")
        except (TypeError, ValueError):
            payload = {}
        if payload.get("module") != module:
            continue
        if entry.entry_type == "archive_module_enabled":
            return await _load_project_archive(session, project_id)
        break

    entry = ProjectMemoryEntry(
        project_id=project_id,
        user_id=user.id,
        entry_type="archive_module_enabled",
        summary=f"启用数据板块：{label}",
        payload_json=json.dumps({"module": module, "label": label}, ensure_ascii=False),
        source_id=None,
    )
    project.updated_at = _now()
    session.add(entry)
    session.add(project)
    await session.commit()
    return await _load_project_archive(session, project_id)


@router.delete("/{project_id}/archive/modules/{module}", response_model=ProjectArchive)
async def hide_archive_module(
    project_id: str,
    module: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ProjectArchive:
    project = await session.get(Project, project_id)
    if project is None or project.user_id != user.id:
        raise HTTPException(status_code=404, detail="项目不存在")

    module_key = module.strip()
    if not module_key or not _is_archive_business_module(module_key):
        raise HTTPException(status_code=400, detail="经营域无效")

    label = _archive_module_label(module_key)
    entry = ProjectMemoryEntry(
        project_id=project_id,
        user_id=user.id,
        entry_type="archive_module_hidden",
        summary=f"隐藏经营域：{label}",
        payload_json=json.dumps({"module": module_key, "label": label}, ensure_ascii=False),
        source_id=None,
    )
    project.updated_at = _now()
    session.add(entry)
    session.add(project)
    await session.commit()
    return await _load_project_archive(session, project_id)


@router.get("/{project_id}/war-room", response_model=WarRoomPlan)
async def get_project_war_room(
    project_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WarRoomPlan:
    p = await session.get(Project, project_id)
    if p is None or p.user_id != user.id:
        raise HTTPException(status_code=404, detail="项目不存在")
    plan = await get_or_build_project_war_room_plan(session, p)
    if plan is None:
        status = _delivery_status(
            list((await session.scalars(
                select(DiagnosisRecord)
                .where(DiagnosisRecord.project_id == project_id)
                .order_by(DiagnosisRecord.created_at.desc())
            )).all()),
            None,
        )
        if status.pending_review_count > 0:
            raise HTTPException(status_code=403, detail="项目作战室正在顾问审核中，审核通过后交付")
        if status.rejected_count > 0:
            raise HTTPException(status_code=409, detail="最近诊断已被顾问打回，请补充资料后重新诊断")
        raise HTTPException(status_code=404, detail="作战室尚未建立")
    return plan


@router.get("/{project_id}/war-room/feedback", response_model=list[WarRoomFeedbackEventOut])
async def list_project_war_room_feedback(
    project_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[WarRoomFeedbackEventOut]:
    p = await session.get(Project, project_id)
    if p is None or p.user_id != user.id:
        raise HTTPException(status_code=404, detail="项目不存在")

    stmt = (
        select(WarRoomFeedbackEvent)
        .where(WarRoomFeedbackEvent.project_id == project_id)
        .order_by(WarRoomFeedbackEvent.created_at.desc())
    )
    rows = list((await session.scalars(stmt)).all())
    return [_feedback_event_out(row) for row in rows]


@router.post("/{project_id}/war-room/feedback", response_model=WarRoomFeedbackEventOut, status_code=201)
async def create_project_war_room_feedback(
    project_id: str,
    body: WarRoomFeedbackCreateRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WarRoomFeedbackEventOut:
    p = await session.get(Project, project_id)
    if p is None or p.user_id != user.id:
        raise HTTPException(status_code=404, detail="项目不存在")

    card_type = body.card_type.strip() or "decision"
    if card_type not in VALID_CARD_TYPES:
        raise HTTPException(status_code=400, detail="反馈对象无效")
    adoption_status = body.adoption_status.strip() or "pending"
    if adoption_status not in ADOPTION_STATUS_LABELS:
        raise HTTPException(status_code=400, detail="采纳状态无效")
    feedback_result = body.feedback_result.strip() or "none"
    if feedback_result not in FEEDBACK_RESULT_LABELS:
        raise HTTPException(status_code=400, detail="反馈结果无效")

    plan_id = body.war_room_plan_id.strip()
    card_id = body.card_id.strip()
    card_title = body.card_title.strip()
    if not plan_id or not card_id or not card_title:
        raise HTTPException(status_code=400, detail="反馈缺少作战室卡片信息")

    current_plan = await get_or_build_project_war_room_plan(session, p)
    if current_plan is None:
        raise HTTPException(status_code=404, detail="作战室尚未建立")
    if current_plan.id != plan_id:
        raise HTTPException(status_code=409, detail="作战室版本已更新，请刷新后再反馈")

    attachments = [str(item).strip() for item in body.attachments if str(item).strip()][:8]
    event = WarRoomFeedbackEvent(
        project_id=project_id,
        user_id=user.id,
        war_room_plan_id=plan_id,
        record_id=(body.record_id or current_plan.record_id or "").strip() or None,
        card_type=card_type,
        card_id=card_id,
        card_title=card_title[:120],
        adoption_status=adoption_status,
        feedback_result=feedback_result,
        note=body.note.strip()[:1200],
        owner=body.owner.strip()[:80],
        attachments_json=json.dumps(attachments, ensure_ascii=False),
    )
    session.add(event)

    await append_memory_entry(
        session,
        project_id=project_id,
        entry_type="war_room_feedback",
        summary=_war_room_feedback_summary(event),
        payload={
            "war_room_plan_id": event.war_room_plan_id,
            "record_id": event.record_id,
            "card_type": event.card_type,
            "card_id": event.card_id,
            "card_title": event.card_title,
            "adoption_status": event.adoption_status,
            "adoption_status_label": ADOPTION_STATUS_LABELS[event.adoption_status],
            "feedback_result": event.feedback_result,
            "feedback_result_label": FEEDBACK_RESULT_LABELS[event.feedback_result],
            "note": event.note,
            "owner": event.owner,
            "attachments": attachments,
        },
        user_id=user.id,
        source_id=event.id,
    )
    await session.commit()
    await session.refresh(event)
    return _feedback_event_out(event)


@router.get("/{project_id}/evidence", response_model=list[ProjectEvidenceOut])
async def get_project_evidence(
    project_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[ProjectEvidenceOut]:
    p = await session.get(Project, project_id)
    if p is None or p.user_id != user.id:
        raise HTTPException(status_code=404, detail="项目不存在")
    rows = await list_project_evidence(session, project_id, limit=200)
    return [
        ProjectEvidenceOut(
            id=row.id,
            job_id=row.job_id,
            project_id=row.project_id,
            record_id=row.record_id,
            module=row.module,
            source_stage=row.source_stage,
            provider=row.provider,
            query=row.query,
            title=row.title,
            url=row.url,
            snippet=row.snippet,
            source_type=row.source_type,
            credibility=row.credibility,
            retrieved_at=row.retrieved_at.isoformat(),
        )
        for row in rows
    ]


@router.patch("/{project_id}", response_model=ProjectSummary)
async def patch_project(
    project_id: str,
    body: PatchProjectRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ProjectSummary:
    p = await session.get(Project, project_id)
    if p is None or p.user_id != user.id:
        raise HTTPException(status_code=404, detail="项目不存在")
    if body.name is not None:
        p.name = body.name.strip() or p.name
    if body.status is not None and body.status in ("active", "archived", "deleted"):
        p.status = body.status
    p.updated_at = _now()
    session.add(p)
    await session.commit()
    await session.refresh(p)
    return ProjectSummary(
        id=p.id, name=p.name, created_at=p.created_at,
        updated_at=p.updated_at, status=p.status, memory_summary=p.memory_summary,
    )


def _delivery_status(
    records: list[DiagnosisRecord],
    war_room_plan: WarRoomPlan | None,
) -> ProjectDeliveryStatus:
    approved = len([r for r in records if r.review_status == "approved"])
    pending = len([r for r in records if r.review_status == "pending_review"])
    rejected = len([r for r in records if r.review_status == "rejected"])
    latest = records[0].review_status if records else None
    if war_room_plan is not None and approved:
        state = "approved"
    elif pending:
        state = "pending_review"
    elif rejected:
        state = "rejected"
    else:
        state = "empty"
    return ProjectDeliveryStatus(
        state=state,
        approved_count=approved,
        pending_review_count=pending,
        rejected_count=rejected,
        latest_review_status=latest,
    )


async def _load_project_archive(session: AsyncSession, project_id: str) -> ProjectArchive:
    records = list((await session.scalars(
        select(DiagnosisRecord)
        .where(DiagnosisRecord.project_id == project_id)
        .order_by(DiagnosisRecord.created_at.desc())
    )).all())
    all_session_ids = [
        sid for (sid,) in (
            await session.execute(
                select(DiagnosisSession.id).where(DiagnosisSession.project_id == project_id)
            )
        ).all()
    ]
    files: list[UploadedFile] = []
    if all_session_ids:
        files = list(await session.scalars(select(UploadedFile).where(UploadedFile.session_id.in_(all_session_ids))))
    archive_memory_entries = list((await session.scalars(
        select(ProjectMemoryEntry)
        .where(ProjectMemoryEntry.project_id == project_id)
        .order_by(ProjectMemoryEntry.created_at.desc())
    )).all())
    return _build_archive(records, files, archive_memory_entries)


def _archive_module_label(module: str) -> str:
    if module in ARCHIVE_MODULE_LABELS:
        return ARCHIVE_MODULE_LABELS[module]
    known_labels = {
        "retention_churn": "留存与流失",
        "private_traffic": "私域运营",
        "acquisition_efficiency": "获客效率",
        "pricing_power": "定价能力",
        "cash_runway": "现金安全",
    }
    if module in known_labels:
        return known_labels[module]
    cleaned = re.sub(r"[_-]+", " ", module).strip()
    return cleaned or module


def _archive_field_label(field: str) -> str:
    key = str(field or "").strip()
    if key in ARCHIVE_FIELD_LABELS:
        return ARCHIVE_FIELD_LABELS[key]
    # 兼容历史/模型生成的英文技术字段，避免在老板侧直接显示 snake_case。
    if re.fullmatch(r"[a-zA-Z][a-zA-Z0-9_-]*", key) and ("_" in key or "-" in key):
        return re.sub(r"[_-]+", " ", key).strip().title()
    return key


def _is_archive_business_module(module: str) -> bool:
    return bool(module.strip()) and module not in ARCHIVE_IGNORED_MODULES


def _archive_entry_sort_key(entry: ProjectMemoryEntry) -> float:
    created_at = entry.created_at
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    return created_at.timestamp()


def _enabled_archive_modules(
    *,
    module_facts_raw: dict[str, dict[str, str]],
    files: list[UploadedFile],
    record_modules: set[str],
    enabled_from_memory: dict[str, str],
    hidden_modules: set[str] | None = None,
) -> list[str]:
    enabled: list[str] = []
    hidden = hidden_modules or set()

    def add(module: str) -> None:
        module = str(module or "").strip()
        if not _is_archive_business_module(module):
            return
        if module in hidden:
            return
        if module and module not in enabled:
            enabled.append(module)

    for module in ARCHIVE_DEFAULT_SEED_MODULES:
        add(module)

    for module, _label in ARCHIVE_MODULES:
        if (
            module in module_facts_raw
            or module in enabled_from_memory
            or module in record_modules
            or any(file.module_key == module for file in files)
        ):
            add(module)

    for module in record_modules:
        add(module)
    for module in enabled_from_memory:
        add(module)

    return enabled


def _recommended_archive_modules(
    *,
    enabled_modules: list[str],
    hidden_modules: set[str] | None = None,
    project_text: str,
    limit: int = 8,
) -> list[ArchiveModuleOption]:
    enabled = set(enabled_modules) | (hidden_modules or set())
    normalized = project_text.lower()
    scored: list[tuple[int, int, str, str]] = []
    for index, (module, label) in enumerate(ARCHIVE_MODULES):
        if module in enabled:
            continue
        keywords = ARCHIVE_MODULE_KEYWORDS.get(module, ())
        hits = [keyword for keyword in keywords if keyword.lower() in normalized]
        if hits:
            scored.append((len(hits), -index, module, f"项目内容提到：{'、'.join(hits[:3])}"))

    scored.sort(reverse=True)
    options = [
        ArchiveModuleOption(module=module, label=_archive_module_label(module), reason=reason)
        for _score, _order, module, reason in scored
    ]

    for module in ARCHIVE_DEFAULT_RECOMMENDED_MODULES:
        if module in enabled or any(option.module == module for option in options):
            continue
        options.append(
            ArchiveModuleOption(
                module=module,
                label=_archive_module_label(module),
                reason="常见专项经营域，可按项目需要启用。",
            )
        )
        if len(options) >= limit:
            break

    return options[:limit]


def _load_archive_highlights(raw: str | None) -> list[ProfileField]:
    if not raw:
        return []
    try:
        payload = json.loads(raw)
    except (TypeError, ValueError):
        return []
    items = payload.get("highlights") if isinstance(payload, dict) else None
    if not isinstance(items, list):
        return []
    highlights: list[ProfileField] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        label = str(item.get("label") or "").strip()
        value = str(item.get("value") or "").strip()
        if label and value:
            display = item.get("display") if isinstance(item.get("display"), dict) else None
            source_labels = [
                str(source).strip()
                for source in (item.get("source_labels") or [])
                if str(source).strip()
            ] if isinstance(item.get("source_labels"), list) else []
            highlights.append(ProfileField(label=label, value=value, display=display, source_labels=source_labels))
    return highlights


def _load_archive_highlights_from_payload(payload: dict) -> list[ProfileField]:
    items = payload.get("highlights")
    if not isinstance(items, list):
        return []
    highlights: list[ProfileField] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        label = str(item.get("label") or "").strip()
        value = str(item.get("value") or "").strip()
        if label and value:
            display = item.get("display") if isinstance(item.get("display"), dict) else None
            source_labels = [
                str(source).strip()
                for source in (item.get("source_labels") or [])
                if str(source).strip()
            ] if isinstance(item.get("source_labels"), list) else []
            highlights.append(ProfileField(label=label, value=value, display=display, source_labels=source_labels))
    return highlights


async def _extract_file_highlights(
    session: AsyncSession,
    llm: LLMClient,
    uploaded: UploadedFile,
) -> tuple[list[ProfileField], str]:
    raw_summary = _load_uploaded_parsed_summary(uploaded.parsed_summary)
    prompt = json.dumps(
        {
            "module": uploaded.module_key,
            "field": uploaded.field_key,
            "file_name": uploaded.original_name,
            "parsed_summary": raw_summary,
            "task": (
                "请根据当前经营模块，提炼这个文件里最适合沉淀到项目档案的重点事实。"
                "只保留稳定、可复用、偏事实的信息，不要写建议、判断或营销话术。"
            ),
        },
        ensure_ascii=False,
    )
    skill_version = await get_active_skill_version(session, "archive_extraction")
    system = skill_version.system_prompt if skill_version else ARCHIVE_EXTRACTION
    raw = await llm.complete(system=system, prompt=prompt)
    data = parse_json_object(raw)
    summary = str(data.get("summary") or "").strip()
    highlights: list[ProfileField] = []
    for item in data.get("highlights") or []:
        if not isinstance(item, dict):
            continue
        label = str(item.get("label") or "").strip()
        value = str(item.get("value") or "").strip()
        if label and value:
            highlights.append(ProfileField(label=label, value=value))
    return highlights[:10], summary


def _load_uploaded_parsed_summary(raw: str) -> dict:
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {"raw": parsed}
    except (TypeError, ValueError):
        return {"raw": str(raw or "")}


def _archive_file_content_type(raw: str) -> str:
    summary = _load_uploaded_parsed_summary(raw)
    return str(summary.get("content_type") or "").strip()


def _render_archive_file_preview_blocks(raw: str) -> list[dict]:
    summary = _load_uploaded_parsed_summary(raw)
    preview_blocks = summary.get("preview_blocks")
    if isinstance(preview_blocks, list):
        blocks = [_normalize_archive_preview_block(item) for item in preview_blocks]
        blocks = [item for item in blocks if item]
        if blocks:
            return blocks[:1000]
    paragraphs = summary.get("paragraphs")
    if isinstance(paragraphs, list):
        blocks = [_text_archive_preview_block(str(item), index) for index, item in enumerate(paragraphs)]
        blocks = [item for item in blocks if item.get("text")]
        if blocks:
            return blocks[:1000]
    text = str(summary.get("text") or summary.get("extraction_note") or "").strip()
    if text:
        blocks = [_text_archive_preview_block(item, index) for index, item in enumerate(re.split(r"\n+", text)) if item.strip()]
        return blocks[:1000] if blocks else [{"type": "paragraph", "text": text[:80000]}]
    if summary.get("content_type") == "table":
        columns = "、".join(map(str, summary.get("columns") or [])) or "未识别"
        rows = summary.get("preview_rows") or []
        parts: list[dict] = [{"type": "paragraph", "text": f"表格共 {summary.get('row_count', 0)} 行；字段：{columns}。"}]
        if rows:
            table_rows = [list(map(str, (summary.get("columns") or [])))]
            for row in rows[:20]:
                if isinstance(row, dict):
                    table_rows.append([str(row.get(col, "")) for col in summary.get("columns") or row.keys()])
            if len(table_rows) > 1:
                parts.append({"type": "table", "rows": table_rows})
            else:
                parts.append({"type": "paragraph", "text": f"前几行样例：{json.dumps(rows[:5], ensure_ascii=False)}"})
        return parts
    return [{"type": "paragraph", "text": "当前文件已保存原件，但没有可展示的文本预览。可下载原件查看完整内容。"}]


def _render_archive_file_preview_text(raw: str) -> str:
    lines: list[str] = []
    for block in _render_archive_file_preview_blocks(raw):
        if block.get("type") == "table":
            for row in block.get("rows") or []:
                if isinstance(row, list):
                    lines.append(" | ".join(str(cell) for cell in row))
            continue
        text = str(block.get("text") or "").strip()
        if text:
            lines.append(text)
    return "\n".join(lines)[:80000]


def _normalize_archive_preview_block(item: object) -> dict:
    if isinstance(item, str):
        return _text_archive_preview_block(item, 0)
    if not isinstance(item, dict):
        return {}
    block_type = str(item.get("type") or "paragraph").strip() or "paragraph"
    if block_type == "table":
        rows: list[list[str]] = []
        for row in item.get("rows") or []:
            if isinstance(row, list):
                cells = [str(cell).strip() for cell in row]
                if any(cells):
                    rows.append(cells)
        return {"type": "table", "rows": rows[:80]} if rows else {}
    text = str(item.get("text") or "").strip()
    if not text:
        return {}
    if block_type not in {"title", "heading", "paragraph"}:
        block_type = "paragraph"
    level = item.get("level")
    return {
        "type": block_type,
        "text": text,
        "level": int(level) if isinstance(level, int | float) else _guess_archive_heading_level(text, 0),
    }


def _text_archive_preview_block(text: str, index: int) -> dict:
    clean = str(text or "").strip()
    if not clean:
        return {}
    if index == 0 and len(clean) <= 80:
        return {"type": "title", "text": clean, "level": 1}
    if re.match(r"^[一二三四五六七八九十]+[、.．]\s*", clean):
        return {"type": "heading", "text": clean, "level": 2}
    if re.match(r"^\d+(?:\.\d+)+\s+", clean):
        return {"type": "heading", "text": clean, "level": 3}
    return {"type": "paragraph", "text": clean}


def _guess_archive_heading_level(text: str, fallback: int) -> int:
    if re.match(r"^[一二三四五六七八九十]+[、.．]\s*", text):
        return 2
    if re.match(r"^\d+(?:\.\d+)+\s+", text):
        return 3
    return fallback or 4


def _feedback_event_out(event: WarRoomFeedbackEvent) -> WarRoomFeedbackEventOut:
    try:
        attachments = json.loads(event.attachments_json or "[]")
    except (TypeError, ValueError):
        attachments = []
    if not isinstance(attachments, list):
        attachments = []
    return WarRoomFeedbackEventOut(
        id=event.id,
        project_id=event.project_id,
        user_id=event.user_id,
        created_at=event.created_at,
        war_room_plan_id=event.war_room_plan_id,
        record_id=event.record_id,
        card_type=event.card_type,
        card_id=event.card_id,
        card_title=event.card_title,
        adoption_status=event.adoption_status,
        feedback_result=event.feedback_result,
        note=event.note,
        owner=event.owner,
        attachments=[str(item) for item in attachments if str(item).strip()],
    )


def _war_room_feedback_summary(event: WarRoomFeedbackEvent) -> str:
    adoption = ADOPTION_STATUS_LABELS.get(event.adoption_status, event.adoption_status)
    result = FEEDBACK_RESULT_LABELS.get(event.feedback_result, event.feedback_result)
    title = event.card_title.strip(" ；;，,")
    parts = [f"阶段反馈：{adoption}「{title}」", f"现场结果：{result}"]
    if event.owner:
        parts.append(f"反馈人/负责人：{event.owner}")
    if event.note:
        note = event.note.strip()
        if note[-1:] not in "。！？.!?":
            note = f"{note}。"
        parts.append(f"说明：{note}")
    summary = "；".join(parts).strip()
    return summary if summary.endswith(("。", "！", "？", ".", "!", "?")) else f"{summary}。"


async def _append_archive_memory_entry(
    session: AsyncSession,
    *,
    project_id: str,
    uploaded: UploadedFile,
    highlights: list[ProfileField],
    summary: str,
    user_id: str,
) -> None:
    highlights_text = "；".join(f"{item.label}：{item.value}" for item in highlights[:3])
    entry = ProjectMemoryEntry(
        project_id=project_id,
        user_id=user_id,
        entry_type="archive_file_extract",
        summary=f"资料沉淀《{uploaded.original_name}》：{summary or highlights_text}",
        payload_json=json.dumps(
            {
                "file_id": uploaded.id,
                "module": uploaded.module_key,
                "field": uploaded.field_key,
                "file_name": uploaded.original_name,
                "highlights": [item.model_dump() for item in highlights],
                "summary": summary,
            },
            ensure_ascii=False,
        ),
        source_id=uploaded.id,
    )
    session.add(entry)
