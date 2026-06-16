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
from app.db.database import get_session
from app.db.models import User, Project, DiagnosisSession, DiagnosisRecord, ProjectMemoryEntry, UploadedFile
from app.memory.session_visibility import is_meaningful_session
from app.models.warroom import WarRoomPlan
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


class RecordBrief(BaseModel):
    id: str
    created_at: datetime
    module_count: int
    has_war_room_plan: bool = False


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


class ProfileField(BaseModel):
    label: str
    value: str


class ModuleFacts(BaseModel):
    module: str
    label: str
    facts: list[ProfileField]
    has_data: bool


class ArchiveFile(BaseModel):
    name: str
    module: str
    field: str
    uploaded_at: datetime


class ProjectArchive(BaseModel):
    profile: list[ProfileField]
    modules: list[ModuleFacts]
    files: list[ArchiveFile]
    last_updated: datetime | None = None


def _build_archive(
    records: list[DiagnosisRecord],
    files: list[UploadedFile],
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

    profile = [
        ProfileField(label=label, value=profile_raw[key])
        for key, label in PROFILE_FIELDS
        if profile_raw.get(key)
    ]

    modules: list[ModuleFacts] = []
    for module, label in ARCHIVE_MODULES:
        bucket = module_facts_raw.get(module, {})
        facts = [ProfileField(label=k, value=v) for k, v in bucket.items()]
        modules.append(
            ModuleFacts(module=module, label=label, facts=facts, has_data=bool(facts))
        )

    archive_files = [
        ArchiveFile(
            name=f.original_name,
            module=f.module_key,
            field=f.field_key,
            uploaded_at=f.created_at,
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
    records: list[RecordBrief]
    archive: ProjectArchive
    war_room_plan: WarRoomPlan | None = None


class PatchProjectRequest(BaseModel):
    name: str | None = None
    status: str | None = None


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
        .order_by(DiagnosisSession.updated_at.desc())
    )
    sessions = [
        SessionBrief(id=s.id, title=s.title or "未命名会话", status=s.status, updated_at=s.updated_at)
        for s in (await session.scalars(sess_stmt)).all()
        if is_meaningful_session(s)
    ]

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
                has_war_room_plan=can_build_war_room_plan(r),
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
    archive = _build_archive(raw_records, archive_files)

    mem_stmt = (
        select(ProjectMemoryEntry)
        .where(ProjectMemoryEntry.project_id == project_id)
        .order_by(ProjectMemoryEntry.created_at.desc())
    )
    memory_entries: list[MemoryEntryOut] = []
    for entry in (await session.scalars(mem_stmt)).all():
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

    return ProjectDetail(
        id=p.id, name=p.name, created_at=p.created_at, updated_at=p.updated_at,
        status=p.status, memory_summary=p.memory_summary,
        memory_entries=memory_entries,
        sessions=sessions, records=records,
        archive=archive,
        war_room_plan=war_room_plan,
    )


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
        raise HTTPException(status_code=404, detail="作战室尚未建立")
    return plan


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
