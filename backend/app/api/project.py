"""项目（持续诊断档案）端点。

一个用户可有多个项目，每个项目沉淀其下所有诊断会话与诊断记录，
随时间持续更新——这是从一次性诊断走向持续诊断的载体。
"""
import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.jwt import get_current_user
from app.config import get_llm_client
from app.db.database import get_session
from app.db.models import User, Project, BrainstormSession, DiagnosisSession, DiagnosisRecord, ProjectMemoryEntry, UploadedFile
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

# 6 大板块固定顺序与中文名（与前端 modules.ts 对齐）
ARCHIVE_MODULES: list[tuple[str, str]] = [
    ("market", "市场与客户"),
    ("product", "产品与服务"),
    ("sales", "销售与增长"),
    ("ops", "运营与供应链"),
    ("org", "组织与人才"),
    ("finance", "财务与资本"),
]

# 企业画像字段（problem_map 里的英文 key → 中文 label），固定展示顺序
PROFILE_FIELDS: list[tuple[str, str]] = [
    ("company_name", "公司名称"),
    ("industry", "所属行业"),
    ("main_business", "主营业务"),
    ("business_model", "商业模式"),
    ("scale", "规模"),
    ("stage", "发展阶段"),
]
PROFILE_LABELS = {label for _, label in PROFILE_FIELDS}


class ProfileField(BaseModel):
    label: str
    value: str


class ModuleFacts(BaseModel):
    module: str
    label: str
    facts: list[ProfileField]
    has_data: bool


class ArchiveFile(BaseModel):
    id: str
    name: str
    module: str
    field: str
    uploaded_at: datetime
    extraction_status: str = "none"
    extracted_highlights: list[ProfileField] = []


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
    files: list[ArchiveFile]
    last_updated: datetime | None = None


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

    for record in records:  # 已是 created_at desc
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

        for answer in payload.get("answers") or []:
            if not isinstance(answer, dict):
                continue
            module = str(answer.get("module") or "").strip()
            if not module:
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
                if value and key not in bucket:   # 先到先得=最新
                    bucket[key] = value

    def merge_highlights(module_key: str, highlights: list[ProfileField]) -> None:
        if module_key == "profile":
            for item in highlights:
                if item.label not in profile_raw and item.value.strip():
                    profile_raw[item.label] = item.value.strip()
            return
        bucket = module_facts_raw.setdefault(module_key, {})
        for item in highlights:
            if item.label not in bucket and item.value.strip():
                bucket[item.label] = item.value.strip()

    # 文件删除后，已确认沉淀的结构化事实仍应从项目长期记忆中保留。
    for entry in archive_memory_entries or []:
        if entry.entry_type != "archive_file_extract":
            continue
        try:
            payload = json.loads(entry.payload_json)
        except (ValueError, TypeError):
            continue
        if not isinstance(payload, dict):
            continue
        module_key = str(payload.get("module") or "").strip()
        if not module_key:
            continue
        highlights = _load_archive_highlights_from_payload(payload)
        if highlights:
            merge_highlights(module_key, highlights)

    # 兼容历史数据：没有长期记忆的已确认文件重点，也纳入长期档案。
    for uploaded in sorted(files, key=lambda item: item.created_at, reverse=True):
        if (uploaded.archive_extraction_status or "none") != "confirmed":
            continue
        highlights = _load_archive_highlights(uploaded.archive_extraction_json)
        if not highlights:
            continue
        merge_highlights(uploaded.module_key, highlights)

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

    modules: list[ModuleFacts] = []
    for module, label in ARCHIVE_MODULES:
        bucket = module_facts_raw.get(module, {})
        facts = [ProfileField(label=k, value=v) for k, v in bucket.items()]
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
            extraction_status=f.archive_extraction_status or "none",
            extracted_highlights=_load_archive_highlights(f.archive_extraction_json),
        )
        for f in sorted(files, key=lambda x: x.created_at, reverse=True)
    ]

    last_updated = records[0].created_at if records else None

    return ProjectArchive(
        profile=profile,
        modules=modules,
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
    if body.status is not None and body.status in ("active", "archived"):
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
            highlights.append(ProfileField(label=label, value=value))
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
            highlights.append(ProfileField(label=label, value=value))
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
                "请根据当前经营模块，提炼这个文件里最适合沉淀到企业档案的重点事实。"
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
