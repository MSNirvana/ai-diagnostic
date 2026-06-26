"""运营后台「案例库」端点（跨用户，管理员专用）。

两个口径：
- 台账（projects）：真实 Project/DiagnosisRecord，看"全平台有哪些项目、卡在哪"。
- 洞察（insights）：脱敏 CaseAsset 聚合，看"行业/信号/缺数据"分布，反哺平台。

只读统计，不改任何线上逻辑。整个 router 被 require_admin 盖住。
"""
from __future__ import annotations

import hashlib
import json
import re
from collections import Counter, defaultdict
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.jwt import require_admin
from app.config import get_llm_client
from app.db.database import get_session
from app.llm.base import LLMClient
from app.db.models import (
    CaseAsset,
    DiagnosisFeedback,
    DiagnosisRecord,
    Project,
    ResearchEvidence,
    User,
)

router = APIRouter(prefix="/admin/cases", dependencies=[Depends(require_admin)])

_SIGNAL_SEVERITY = {"red": 3, "yellow": 2, "green": 1}


def _loads(raw: str | None, default):
    try:
        return json.loads(raw) if raw else default
    except (ValueError, TypeError):
        return default


def _profile_of(project: Project) -> dict:
    """项目画像（problem_map 同步到 profile_json，含 industry/main_business/core_problem）。"""
    data = _loads(project.profile_json, {})
    return data if isinstance(data, dict) else {}


def _headline_signal(results: list) -> str:
    """一条诊断里最严重的信号（red>yellow>green）作为该次诊断的总信号。"""
    worst = ""
    worst_rank = 0
    for r in results:
        sig = (r.get("signal") or "") if isinstance(r, dict) else ""
        rank = _SIGNAL_SEVERITY.get(sig, 0)
        if rank > worst_rank:
            worst, worst_rank = sig, rank
    return worst


def _ledger_delivery_state(records: list[DiagnosisRecord], has_plan: bool) -> str:
    """轻量交付态（不重建作战室）：对齐 project._delivery_status 的判定。"""
    approved = any(r.review_status == "approved" for r in records)
    pending = any(r.review_status == "pending_review" for r in records)
    rejected = any(r.review_status == "rejected" for r in records)
    if has_plan and approved:
        return "approved"
    if pending:
        return "pending_review"
    if rejected:
        return "rejected"
    return "empty"


# ── 台账 ──────────────────────────────────────────────────────────────────────

class ProjectLedgerItem(BaseModel):
    id: str
    name: str
    user_email: str
    industry: str = ""
    main_business: str = ""
    core_problem: str = ""
    product: str = ""              # 大脑语义归一后的产品/品类（仅产品分组接口回填）
    primary_module: str = ""
    latest_signal: str = ""        # red|yellow|green|""
    diagnosis_count: int = 0
    delivery_state: str = "empty"
    review_status: str = ""        # 最新一条诊断的审核状态
    status: str = "active"
    created_at: datetime
    updated_at: datetime


class ProjectLedgerPage(BaseModel):
    total: int
    items: list[ProjectLedgerItem]
    industries: list[str]          # 全量行业清单（供前端筛选/分组，稳定不随筛选变）


async def _enriched_ledger(session: AsyncSession, status: str) -> list[ProjectLedgerItem]:
    """跨用户拉取项目并补全台账字段（批量查询，避免 N+1）。不含 product。"""
    stmt = select(Project).where(Project.status != "deleted")
    if status != "all":
        stmt = stmt.where(Project.status == status)
    stmt = stmt.order_by(Project.updated_at.desc())
    projects = list((await session.scalars(stmt)).all())

    pids = [p.id for p in projects]
    uids = list({p.user_id for p in projects})
    recs_by_pid: dict[str, list[DiagnosisRecord]] = defaultdict(list)
    if pids:
        rec_rows = list((await session.scalars(
            select(DiagnosisRecord)
            .where(DiagnosisRecord.project_id.in_(pids))
            .order_by(DiagnosisRecord.created_at.desc())
        )).all())
        for r in rec_rows:
            recs_by_pid[r.project_id].append(r)
    email_by_uid: dict[str, str] = {}
    if uids:
        for u in (await session.scalars(select(User).where(User.id.in_(uids)))).all():
            email_by_uid[u.id] = u.email

    items: list[ProjectLedgerItem] = []
    for p in projects:
        prof = _profile_of(p)
        recs = recs_by_pid.get(p.id, [])             # 已按时间倒序
        latest = recs[0] if recs else None
        latest_results = _loads(latest.results_json, []) if latest else []
        items.append(ProjectLedgerItem(
            id=p.id,
            name=p.name,
            user_email=email_by_uid.get(p.user_id, ""),
            industry=str(prof.get("industry") or "").strip(),
            main_business=str(prof.get("main_business") or "").strip(),
            core_problem=str(prof.get("core_problem") or "").strip(),
            primary_module=(latest.primary_module if latest else "") or "",
            latest_signal=_headline_signal(latest_results),
            diagnosis_count=len(recs),
            delivery_state=_ledger_delivery_state(recs, bool(p.war_room_plan_json)),
            review_status=(latest.review_status if latest else "") or "",
            status=p.status,
            created_at=p.created_at,
            updated_at=p.updated_at,
        ))
    return items


def _passes_filters(
    e: ProjectLedgerItem,
    *,
    industry: str | None,
    primary_module: str | None,
    signal: str | None,
    delivery_state: str | None,
    q: str | None,
) -> bool:
    if industry and e.industry != industry:
        return False
    if primary_module and e.primary_module != primary_module:
        return False
    if signal and e.latest_signal != signal:
        return False
    if delivery_state and e.delivery_state != delivery_state:
        return False
    if q:
        needle = q.strip().lower()
        if needle not in e.name.lower() and needle not in e.core_problem.lower():
            return False
    return True


@router.get("/projects", response_model=ProjectLedgerPage)
async def list_case_projects(
    session: AsyncSession = Depends(get_session),
    industry: str | None = None,
    primary_module: str | None = None,
    signal: str | None = None,
    delivery_state: str | None = None,
    status: str = "active",          # active|archived|all
    q: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> ProjectLedgerPage:
    """跨用户项目台账（扁平，按行业分组由前端做）。"""
    items = await _enriched_ledger(session, status)
    industries = sorted({e.industry for e in items if e.industry})
    filtered = [
        e for e in items
        if _passes_filters(e, industry=industry, primary_module=primary_module,
                           signal=signal, delivery_state=delivery_state, q=q)
    ]
    return ProjectLedgerPage(
        total=len(filtered),
        items=filtered[offset:offset + limit],
        industries=industries,
    )


# ── 产品归一分组（产品 → 诊断域 → 项目）──────────────────────────────────────────

class ProductModuleGroup(BaseModel):
    module: str                    # primary_module key（前端 displayModuleLabel 渲染）
    count: int
    projects: list[ProjectLedgerItem]


class ProductGroup(BaseModel):
    product: str
    count: int
    modules: list[ProductModuleGroup]


class ProductGroupsResponse(BaseModel):
    total: int
    groups: list[ProductGroup]
    industries: list[str]


_PRODUCT_SYSTEM = (
    "你是案例库的产品归类脑子。把项目的【行业/主营业务】归一成标准的“产品/品类”短名，"
    "同一产品的不同表述必须合并到同一个名字。"
)
_PRODUCT_PROMPT = """下面每行是一个项目的「行业 | 主营业务」。把每个归一成一个标准产品名。

规则：
1. 同一产品的不同写法合并到同一个名字。例：「新能源厨电」「新能源厨电 / 电火灶（等离子电生明火）」「新兴厨电 / 电火灶 / 区域代理分销」都归为「电火灶」。
2. 去掉商业模式/渠道词（招商、代理、分销、加盟、区域）和括号注解，只留产品本身。
3. 用最能代表“卖什么”的简短名词（2-6 字优先）。
4. 保留行业惯用英文（SaaS、DTC、ERP 等）。
5. 行业和主营都为空时，product 用「未分类」。

项目列表：
{items}

只输出 JSON，不要解释：
{{"assignments":[{{"index":0,"product":"电火灶"}}]}}"""

# 大脑聚类结果按「去重签名集合」缓存：同一批签名只调一次 LLM。仅缓存成功结果。
_PRODUCT_CACHE: dict[str, dict[str, str]] = {}


def _product_signature(it: ProjectLedgerItem) -> str:
    return f"{it.industry} | {it.main_business}".strip(" |")


def _clean_product(text: str) -> str:
    """规则兜底：取首段、去括号注解与商业模式词。"""
    seg = re.split(r"[／/]", text)[0]
    seg = re.sub(r"[（(][^)）]*[)）]", "", seg)
    seg = re.sub(r"(招商|代理|分销|加盟|区域)", "", seg)
    return seg.strip(" ·-") or "未分类"


def _fallback_product(it: ProjectLedgerItem) -> str:
    base = it.industry or it.main_business
    return _clean_product(base) if base else "未分类"


def _parse_assignments(raw: str) -> dict:
    s = (raw or "").strip()
    if s.startswith("```"):
        s = s.strip("`")
    start, end = s.find("{"), s.rfind("}")
    if start >= 0 and end > start:
        try:
            return json.loads(s[start:end + 1])
        except (ValueError, TypeError):
            return {}
    return {}


async def _cluster_products(items: list[ProjectLedgerItem], llm: LLMClient) -> dict[str, str]:
    """大脑把去重的「行业|主营」签名归一成产品名 → {签名: 产品}。失败返回空（调用方逐条兜底）。"""
    sigs = sorted({_product_signature(it) for it in items if _product_signature(it)})
    if not sigs:
        return {}
    key = hashlib.md5("\n".join(sigs).encode("utf-8")).hexdigest()
    if key in _PRODUCT_CACHE:
        return _PRODUCT_CACHE[key]
    mapping: dict[str, str] = {}
    try:
        numbered = "\n".join(f"{i}. {s}" for i, s in enumerate(sigs))
        raw = await llm.complete(_PRODUCT_SYSTEM, _PRODUCT_PROMPT.format(items=numbered))
        data = _parse_assignments(raw)
        for a in data.get("assignments", []):
            idx = a.get("index")
            prod = str(a.get("product") or "").strip()
            if isinstance(idx, int) and 0 <= idx < len(sigs) and prod:
                mapping[sigs[idx]] = prod
    except Exception:  # noqa: BLE001 — LLM 不可用/超时一律走兜底，不阻断后台
        mapping = {}
    if mapping:
        _PRODUCT_CACHE[key] = mapping   # 只缓存成功结果，兜底不污染缓存
    return mapping


@router.get("/product-groups", response_model=ProductGroupsResponse)
async def case_product_groups(
    session: AsyncSession = Depends(get_session),
    llm: LLMClient = Depends(get_llm_client),
    industry: str | None = None,
    primary_module: str | None = None,
    signal: str | None = None,
    delivery_state: str | None = None,
    status: str = "active",
    q: str | None = None,
) -> ProductGroupsResponse:
    """产品归一分组：大脑把同一产品的不同行业写法合并，再按诊断域(主战场)分二级。"""
    items = await _enriched_ledger(session, status)
    industries = sorted({e.industry for e in items if e.industry})

    # 产品归一在全量上做（产品分类稳定不随筛选变），随后再筛选
    prod_map = await _cluster_products(items, llm)
    for it in items:
        it.product = prod_map.get(_product_signature(it)) or _fallback_product(it)

    filtered = [
        e for e in items
        if _passes_filters(e, industry=industry, primary_module=primary_module,
                           signal=signal, delivery_state=delivery_state, q=q)
    ]

    by_product: dict[str, list[ProjectLedgerItem]] = defaultdict(list)
    for e in filtered:
        by_product[e.product].append(e)

    groups: list[ProductGroup] = []
    for product, rows in by_product.items():
        by_mod: dict[str, list[ProjectLedgerItem]] = defaultdict(list)
        for r in rows:
            by_mod[r.primary_module].append(r)
        modules = [
            ProductModuleGroup(module=m, count=len(rs), projects=rs)
            for m, rs in by_mod.items()
        ]
        modules.sort(key=lambda mg: (-mg.count, mg.module))
        groups.append(ProductGroup(product=product, count=len(rows), modules=modules))

    # 项目多的产品排前；「未分类」永远垫底
    groups.sort(key=lambda g: (g.product == "未分类", -g.count, g.product))
    return ProductGroupsResponse(total=len(filtered), groups=groups, industries=industries)


# ── 台账详情 ──────────────────────────────────────────────────────────────────

class ModuleSignal(BaseModel):
    module: str
    signal: str = ""
    conclusion: str = ""
    confidence: float | None = None


class CaseRecordDetail(BaseModel):
    id: str
    created_at: datetime
    review_status: str
    primary_module: str = ""
    signals: list[ModuleSignal] = []
    consultant_notes: list[str] = []


class CaseFeedback(BaseModel):
    count: int = 0
    avg_rating: float | None = None
    useful_rate: float | None = None


class CaseProjectDetail(BaseModel):
    id: str
    name: str
    user_email: str
    status: str
    created_at: datetime
    updated_at: datetime
    industry: str = ""
    main_business: str = ""
    core_problem: str = ""
    goal: str = ""
    company_name: str = ""
    records: list[CaseRecordDetail] = []
    war_room_summary: str = ""
    war_room_objective: str = ""
    evidence_count: int = 0
    feedback: CaseFeedback = CaseFeedback()


def _record_signals(results: list) -> list[ModuleSignal]:
    out: list[ModuleSignal] = []
    for r in results:
        if not isinstance(r, dict):
            continue
        pack = r.get("evidence_package") or {}
        conf = pack.get("confidence") if isinstance(pack, dict) else None
        out.append(ModuleSignal(
            module=str(r.get("module") or ""),
            signal=str(r.get("signal") or ""),
            conclusion=str(r.get("conclusion") or ""),
            confidence=conf if isinstance(conf, (int, float)) else None,
        ))
    return out


@router.get("/projects/{project_id}", response_model=CaseProjectDetail)
async def get_case_project(
    project_id: str,
    session: AsyncSession = Depends(get_session),
) -> CaseProjectDetail:
    """跨用户项目详情（不做 user_id 校验，管理员有权）。"""
    p = await session.get(Project, project_id)
    if p is None:
        raise HTTPException(status_code=404, detail="项目不存在")

    prof = _profile_of(p)
    user = await session.get(User, p.user_id)

    rec_rows = list((await session.scalars(
        select(DiagnosisRecord)
        .where(DiagnosisRecord.project_id == project_id)
        .order_by(DiagnosisRecord.created_at.desc())
    )).all())
    records = [
        CaseRecordDetail(
            id=r.id,
            created_at=r.created_at,
            review_status=r.review_status,
            primary_module=r.primary_module or "",
            signals=_record_signals(_loads(r.results_json, [])),
            consultant_notes=[
                str(n) for n in _loads(r.consultant_notes_json, []) if str(n).strip()
            ],
        )
        for r in rec_rows
    ]

    plan = _loads(p.war_room_plan_json, {})
    evidence_count = await session.scalar(
        select(func.count()).select_from(ResearchEvidence)
        .where(ResearchEvidence.project_id == project_id)
    ) or 0

    rec_ids = [r.id for r in rec_rows]
    feedback = CaseFeedback()
    if rec_ids:
        fbs = list((await session.scalars(
            select(DiagnosisFeedback).where(DiagnosisFeedback.record_id.in_(rec_ids))
        )).all())
        if fbs:
            ratings = [f.rating for f in fbs if f.rating]
            useful = [f.is_useful for f in fbs if f.is_useful is not None]
            feedback = CaseFeedback(
                count=len(fbs),
                avg_rating=round(sum(ratings) / len(ratings), 2) if ratings else None,
                useful_rate=round(sum(useful) / len(useful), 3) if useful else None,
            )

    return CaseProjectDetail(
        id=p.id,
        name=p.name,
        user_email=user.email if user else "",
        status=p.status,
        created_at=p.created_at,
        updated_at=p.updated_at,
        industry=str(prof.get("industry") or "").strip(),
        main_business=str(prof.get("main_business") or "").strip(),
        core_problem=str(prof.get("core_problem") or "").strip(),
        goal=str(prof.get("goal") or "").strip(),
        company_name=str(prof.get("company_name") or "").strip(),
        records=records,
        war_room_summary=str(plan.get("summary") or "") if isinstance(plan, dict) else "",
        war_room_objective=str(plan.get("objective") or "") if isinstance(plan, dict) else "",
        evidence_count=int(evidence_count),
        feedback=feedback,
    )


# ── 洞察（脱敏 CaseAsset 聚合）─────────────────────────────────────────────────

class DistItem(BaseModel):
    label: str
    count: int


class ModuleConfidence(BaseModel):
    module: str
    avg_confidence: float
    sample: int


class CaseInsights(BaseModel):
    total_cases: int
    industry_dist: list[DistItem]
    scenario_dist: list[DistItem]
    module_dist: list[DistItem]
    signal_dist: list[DistItem]
    avg_confidence_per_module: list[ModuleConfidence]
    data_gaps_top: list[DistItem]


@router.get("/insights", response_model=CaseInsights)
async def case_insights(session: AsyncSession = Depends(get_session)) -> CaseInsights:
    """脱敏案例聚合：行业/场景/主战场/信号分布 + 各域平均信心 + 缺数据 Top。"""
    total = await session.scalar(select(func.count()).select_from(CaseAsset)) or 0
    rows = list((await session.scalars(select(CaseAsset))).all())

    industry_c: Counter = Counter()
    scenario_c: Counter = Counter()
    module_c: Counter = Counter()
    signal_c: Counter = Counter()
    gaps_c: Counter = Counter()
    conf_sum: dict[str, float] = defaultdict(float)
    conf_n: dict[str, int] = defaultdict(int)

    for c in rows:
        if c.industry:
            industry_c[c.industry] += 1
        if c.scenario_key:
            scenario_c[c.scenario_key] += 1
        if c.primary_module:
            module_c[c.primary_module] += 1
        for key in _loads(c.data_gaps_json, []):
            if str(key).strip():
                gaps_c[str(key)] += 1
        summary = _loads(c.diagnosis_summary_json, {})
        if isinstance(summary, dict):
            for module, payload in summary.items():
                if not isinstance(payload, dict):
                    continue
                sig = str(payload.get("signal") or "")
                if sig:
                    signal_c[sig] += 1
                conf = payload.get("confidence")
                if isinstance(conf, (int, float)):
                    conf_sum[module] += float(conf)
                    conf_n[module] += 1

    def _dist(counter: Counter, top: int | None = None) -> list[DistItem]:
        items = counter.most_common(top) if top else counter.most_common()
        return [DistItem(label=k, count=v) for k, v in items]

    # 信号按 red/yellow/green 固定顺序
    signal_dist = [
        DistItem(label=s, count=signal_c.get(s, 0))
        for s in ("red", "yellow", "green") if signal_c.get(s, 0)
    ]
    avg_conf = sorted(
        (
            ModuleConfidence(
                module=m,
                avg_confidence=round(conf_sum[m] / conf_n[m], 2),
                sample=conf_n[m],
            )
            for m in conf_n
        ),
        key=lambda x: x.avg_confidence,   # 信心低的排前面 = 优先升级
    )

    return CaseInsights(
        total_cases=int(total),
        industry_dist=_dist(industry_c),
        scenario_dist=_dist(scenario_c, 10),
        module_dist=_dist(module_c),
        signal_dist=signal_dist,
        avg_confidence_per_module=avg_conf,
        data_gaps_top=_dist(gaps_c, 10),
    )
