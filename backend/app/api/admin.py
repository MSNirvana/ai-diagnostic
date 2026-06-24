"""Skill 版本管理端点。

第一期只给运营自己用（curl/Postman），不做鉴权 UI。
负责 skill 版本的查看、新增、激活——是"会进化的 skill 系统"的人工治理入口。
所有改动都留痕（change_reason/category/reviewed_by）。
"""
import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_session
from app.db.models import SkillVersion
from app.skills.configured import card_from_version, card_requirements
from app.skills.registry import get_skill
from app.skills.skill_network import all_skill_definitions, skill_definition, skill_flow

router = APIRouter(prefix="/admin/skills")


class NewVersionRequest(BaseModel):
    system_prompt: str
    method: str = "hypothesis"
    skill_type: str | None = None
    change_reason: str
    change_category: str | None = None
    reviewed_by: str | None = None
    activate: bool = False   # 新建即激活


class SkillVersionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    module: str
    skill_type: str
    version: int
    system_prompt: str
    method: str
    is_active: bool
    change_reason: str | None
    change_category: str | None
    reviewed_by: str | None


class SkillRegistryItemOut(BaseModel):
    key: str
    label: str
    category: str
    category_label: str
    skill_type: str
    method: str
    description: str
    flow: str                       # 用在哪个流程（后台"?"悬停说明）
    fallback_prompt: str
    industry_kpis: list[str] = []   # 诊断域的关键指标（脑子现场生成判断的依据）
    judgment_hints: list[str] = []  # 诊断域的易误判提示
    card_json: str = ""             # 诊断卡可治理数据的 JSON（后台编辑/版本化用，非诊断域为空）
    trigger_keywords: list[str]
    data_requirements: list[dict[str, object]]
    upgrade_policy: str
    evaluation_metrics: list[str]
    enabled: bool
    default_core: bool
    active_version: SkillVersionOut | None = None


@router.get("/", response_model=list[SkillVersionOut])
async def list_active(session: AsyncSession = Depends(get_session)):
    """所有模块的当前激活版本。"""
    stmt = select(SkillVersion).where(SkillVersion.is_active == True)  # noqa: E712
    return list(await session.scalars(stmt))


@router.get("/registry", response_model=list[SkillRegistryItemOut])
async def list_registry(session: AsyncSession = Depends(get_session)):
    """Skill 网络目录：包含未创建 DB 版本的可用 Skill。"""
    active_rows = list(await session.scalars(
        select(SkillVersion).where(SkillVersion.is_active == True)  # noqa: E712
    ))
    active_by_module = {row.module: row for row in active_rows}

    def _effective_card(key: str, active: SkillVersion | None):
        """诊断卡的生效内容：DB 激活版本若是卡片则用它（后台改过的），否则用文件默认。

        返回 (industry_kpis, judgment_hints, data_requirement_dicts, card_json)。非诊断 skill 返回空。
        """
        cfg = getattr(get_skill(key), "config", None)
        if cfg is None:
            return [], [], [], ""
        card = card_from_version(active.system_prompt) if active else None
        kpis = card["industry_kpis"] if card and isinstance(card.get("industry_kpis"), list) else list(cfg.industry_kpis)
        hints = card["judgment_hints"] if card and isinstance(card.get("judgment_hints"), list) else list(cfg.judgment_hints)
        reqs = card_requirements(card) if card and card.get("data_requirements") is not None else cfg.data_requirements
        req_dicts = [
            {
                "key": r.key, "label": r.label, "reason": r.reason,
                "source_hint": r.source_hint, "keywords": list(r.keywords), "required": r.required,
            }
            for r in reqs
        ]
        card_json = json.dumps(
            {"industry_kpis": list(kpis), "judgment_hints": list(hints), "data_requirements": req_dicts},
            ensure_ascii=False,
            indent=2,
        )
        return list(kpis), list(hints), req_dicts, card_json

    items = []
    for definition in all_skill_definitions():
        active = active_by_module.get(definition.key)
        kpis, hints, req_dicts, card_json = _effective_card(definition.key, active)
        # 诊断域：取数项来自 config（生效卡）；非诊断域：沿用定义里的 data_requirements。
        data_reqs = req_dicts if req_dicts else [
            {
                "key": requirement.key,
                "label": requirement.label,
                "reason": requirement.reason,
                "source_hint": requirement.source_hint,
                "required": requirement.required,
            }
            for requirement in definition.data_requirements
        ]
        items.append(SkillRegistryItemOut(
            key=definition.key,
            label=definition.label,
            category=definition.category,
            category_label=definition.category_label,
            skill_type=definition.skill_type,
            method=definition.method,
            description=definition.description,
            flow=skill_flow(definition.key, definition.skill_type),
            fallback_prompt=definition.fallback_prompt,
            industry_kpis=kpis,
            judgment_hints=hints,
            card_json=card_json,
            trigger_keywords=list(definition.trigger_keywords),
            data_requirements=data_reqs,
            upgrade_policy=definition.upgrade_policy,
            evaluation_metrics=list(definition.evaluation_metrics),
            enabled=definition.enabled,
            default_core=definition.default_core,
            active_version=(
                SkillVersionOut.model_validate(active) if active else None
            ),
        ))
    return items


@router.get("/{module}/versions", response_model=list[SkillVersionOut])
async def list_versions(module: str, session: AsyncSession = Depends(get_session)):
    stmt = (
        select(SkillVersion)
        .where(SkillVersion.module == module)
        .order_by(SkillVersion.version.desc())
    )
    return list(await session.scalars(stmt))


async def _deactivate_all(session: AsyncSession, module: str) -> None:
    stmt = select(SkillVersion).where(
        SkillVersion.module == module,
        SkillVersion.is_active == True,  # noqa: E712
    )
    for v in await session.scalars(stmt):
        v.is_active = False
        session.add(v)


@router.post("/{module}/versions", response_model=SkillVersionOut, status_code=201)
async def add_version(
    module: str,
    body: NewVersionRequest,
    session: AsyncSession = Depends(get_session),
):
    # version 号 = 当前该模块最大版本 + 1
    max_v = await session.scalar(
        select(func.max(SkillVersion.version)).where(SkillVersion.module == module)
    )
    next_v = (max_v or 0) + 1
    previous = await session.scalar(
        select(SkillVersion)
        .where(SkillVersion.module == module)
        .order_by(SkillVersion.version.desc())
        .limit(1)
    )
    if body.activate:
        await _deactivate_all(session, module)
    definition = skill_definition(module)
    ver = SkillVersion(
        module=module,
        skill_type=body.skill_type or (previous.skill_type if previous else definition.skill_type if definition else "diagnosis"),
        version=next_v,
        system_prompt=body.system_prompt,
        method=body.method if body.method != "hypothesis" or definition is None else definition.method,
        is_active=body.activate,
        change_reason=body.change_reason,
        change_category=body.change_category,
        reviewed_by=body.reviewed_by,
        reviewed_at=datetime.now(timezone.utc) if body.reviewed_by else None,
    )
    session.add(ver)
    await session.commit()
    await session.refresh(ver)
    return ver


@router.post("/{module}/activate/{version_id}", response_model=SkillVersionOut)
async def activate_version(
    module: str,
    version_id: str,
    session: AsyncSession = Depends(get_session),
):
    ver = await session.get(SkillVersion, version_id)
    if ver is None or ver.module != module:
        raise HTTPException(status_code=404, detail="版本不存在")
    await _deactivate_all(session, module)
    ver.is_active = True
    session.add(ver)
    await session.commit()
    await session.refresh(ver)
    return ver
