"""Loop 治理端点 —— 给后台管理页面暴露 4 个 Loop 的实时运行状态。

设计原则：只读统计，不改任何线上逻辑。
- L1 Skill 生产：评测结果、候选队列、人审操作
- L2 Router 健康：召回样本统计、漏召回率、假阳性率
- L3 案例飞轮：归档数量、行业分布、最近归档
- L4 Composer：enhancer 改写统计（从 DiagnosisRecord 采样）
"""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select, func, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_session
from app.db.models import CaseAsset, DiagnosisRecord, DiagnosisFeedback, RoutingSample

from app.auth.jwt import require_admin

router = APIRouter(prefix="/admin/loops", dependencies=[Depends(require_admin)])

CONFIGS_DIR = Path(__file__).parent.parent / "skills" / "configs"


# ── L1 Skill 生产线 ──────────────────────────────────────────────────────────

class SkillCandidateItem(BaseModel):
    key: str
    label: str | None = None
    verdict: str        # pass | redo | fail
    l1_passed: bool
    l2_rate: float
    signal_accuracy: float
    error_count: int
    review_status: str  # pending_human | approved | rejected
    review_notes: str | None = None
    created_at: str | None = None


class L1Stats(BaseModel):
    total_configs: int          # configs/*.json 文件数
    pending_review: int         # verdict=pass 但未人审
    approved: int               # 人审通过
    failed: int                 # 机器 fail
    candidates: list[SkillCandidateItem]


@router.get("/l1", response_model=L1Stats)
async def l1_stats():
    """Skill 生产线：评测结果 + 候选人审队列。"""
    eval_dir = CONFIGS_DIR / "_eval"
    review_dir = CONFIGS_DIR / "_review"

    candidates: list[SkillCandidateItem] = []
    pending = approved = failed = 0

    if eval_dir.exists():
        for eval_file in sorted(eval_dir.glob("*.machine.json")):
            key = eval_file.stem.replace(".machine", "")
            try:
                data = json.loads(eval_file.read_text(encoding="utf-8"))
            except Exception:
                continue

            verdict = data.get("machine_verdict", "unknown")
            review_file = review_dir / f"{key}.json"
            review_status = "no_eval"
            review_notes = None

            if review_file.exists():
                try:
                    rv = json.loads(review_file.read_text(encoding="utf-8"))
                    review_status = rv.get("review_status", "pending_human")
                    notes = rv.get("human_review_notes", [])
                    review_notes = notes[0].get("one_line") if notes else None
                except Exception:
                    review_status = "pending_human"
            elif verdict == "pass":
                review_status = "pending_human"
            else:
                review_status = "not_ready"

            if review_status == "approved":
                approved += 1
            elif verdict == "fail":
                failed += 1
            elif verdict == "pass":
                pending += 1

            # label from meta json
            meta_file = CONFIGS_DIR / f"{key}.json"
            label = None
            if meta_file.exists():
                try:
                    label = json.loads(meta_file.read_text(encoding="utf-8")).get("label")
                except Exception:
                    pass

            candidates.append(SkillCandidateItem(
                key=key,
                label=label,
                verdict=verdict,
                l1_passed=data.get("l1_all_pass", False),
                l2_rate=data.get("l2_overall_rate", 0.0),
                signal_accuracy=data.get("signal_accuracy", 0.0),
                error_count=data.get("error_count", 0),
                review_status=review_status,
                review_notes=review_notes,
            ))

    total_configs = len(list(CONFIGS_DIR.glob("*.json"))) if CONFIGS_DIR.exists() else 0

    return L1Stats(
        total_configs=total_configs,
        pending_review=pending,
        approved=approved,
        failed=failed,
        candidates=candidates,
    )


# ── L2 Router 健康 ────────────────────────────────────────────────────────────

class SkillRecallItem(BaseModel):
    module: str
    recall_count: int
    source_breakdown: dict[str, int]  # focus/keyword/user_filled


class L2Stats(BaseModel):
    total_samples: int
    missed_recall_rate: float
    samples_with_missed: int
    keyword_false_positive_rate: float
    keyword_recalls: int
    keyword_false_positives: int
    skill_recall_frequency: list[SkillRecallItem]
    recent_missed: list[str]     # 最近漏召回的 module 名


@router.get("/l2", response_model=L2Stats)
async def l2_stats(session: AsyncSession = Depends(get_session)):
    """Router 健康：召回样本统计 + 漏召回 + 假阳性。"""
    samples = list(await session.scalars(
        select(RoutingSample).order_by(desc(RoutingSample.created_at)).limit(200)
    ))
    total = len(samples)
    if total == 0:
        return L2Stats(total_samples=0, missed_recall_rate=0, samples_with_missed=0,
                       keyword_false_positive_rate=0, keyword_recalls=0,
                       keyword_false_positives=0, skill_recall_frequency=[], recent_missed=[])

    skill_counter: Counter = Counter()
    source_by_skill: dict[str, Counter] = {}
    missed_total_samples = 0
    keyword_recalls = 0
    keyword_fp = 0
    recent_missed: list[str] = []

    for s in samples:
        selected = json.loads(s.selected_json or "[]")
        outcomes = {o["module"]: o for o in json.loads(s.outcomes_json or "[]")}
        missed = json.loads(s.missed_json or "[]")

        if missed:
            missed_total_samples += 1
            recent_missed.extend(missed)

        for sel in selected:
            module = sel["module"]
            source = sel.get("source", "other")
            skill_counter[module] += 1
            if module not in source_by_skill:
                source_by_skill[module] = Counter()
            source_by_skill[module][source] += 1

            if source == "keyword":
                keyword_recalls += 1
                outcome = outcomes.get(module)
                if outcome:
                    sig = outcome.get("signal")
                    conf = outcome.get("confidence")
                    if sig == "green" or (conf is not None and conf < 0.5):
                        keyword_fp += 1

    skill_recall_frequency = [
        SkillRecallItem(
            module=m,
            recall_count=cnt,
            source_breakdown=dict(source_by_skill.get(m, Counter())),
        )
        for m, cnt in skill_counter.most_common()
    ]

    return L2Stats(
        total_samples=total,
        missed_recall_rate=round(missed_total_samples / total, 3),
        samples_with_missed=missed_total_samples,
        keyword_false_positive_rate=round(keyword_fp / keyword_recalls, 3) if keyword_recalls else 0.0,
        keyword_recalls=keyword_recalls,
        keyword_false_positives=keyword_fp,
        skill_recall_frequency=skill_recall_frequency,
        recent_missed=list(dict.fromkeys(recent_missed))[:10],
    )


# ── L3 案例飞轮 ───────────────────────────────────────────────────────────────

class CaseIndustryItem(BaseModel):
    industry: str
    count: int


class RecentCaseItem(BaseModel):
    id: str
    industry: str
    company_profile: str
    skills_used: list[str]
    created_at: str


class L3Stats(BaseModel):
    total_cases: int
    industry_distribution: list[CaseIndustryItem]
    recent_cases: list[RecentCaseItem]


@router.get("/l3", response_model=L3Stats)
async def l3_stats(session: AsyncSession = Depends(get_session)):
    """案例飞轮：归档数量 + 行业分布 + 最近归档。"""
    total = await session.scalar(select(func.count()).select_from(CaseAsset)) or 0

    rows = list(await session.scalars(
        select(CaseAsset).order_by(desc(CaseAsset.created_at)).limit(100)
    ))

    industry_counter: Counter = Counter()
    recent: list[RecentCaseItem] = []

    for c in rows:
        industry = c.industry or "未知"
        industry_counter[industry] += 1

        if len(recent) < 10:
            try:
                skills = json.loads(c.skills_used_json or "[]")
            except Exception:
                skills = []
            try:
                profile = json.loads(c.company_profile_json or "{}")
                main_biz = str(profile.get("main_business", ""))[:60]
            except Exception:
                main_biz = ""
            recent.append(RecentCaseItem(
                id=c.id,
                industry=industry,
                company_profile=main_biz,
                skills_used=skills[:4],
                created_at=str(c.created_at),
            ))

    return L3Stats(
        total_cases=total,
        industry_distribution=[
            CaseIndustryItem(industry=ind, count=cnt)
            for ind, cnt in industry_counter.most_common(10)
        ],
        recent_cases=recent,
    )


# ── L4 Composer 质量 ─────────────────────────────────────────────────────────

class L4Stats(BaseModel):
    total_diagnoses: int
    recent_feedback_count: int
    avg_rating: float | None
    useful_rate: float | None


@router.get("/l4", response_model=L4Stats)
async def l4_stats(session: AsyncSession = Depends(get_session)):
    """Composer 质量：诊断量 + 用户反馈评分。"""
    total = await session.scalar(select(func.count()).select_from(DiagnosisRecord)) or 0

    feedbacks = list(await session.scalars(
        select(DiagnosisFeedback).order_by(desc(DiagnosisFeedback.created_at)).limit(200)
    ))

    avg_rating = None
    useful_rate = None
    if feedbacks:
        ratings = [f.rating for f in feedbacks if f.rating]
        if ratings:
            avg_rating = round(sum(ratings) / len(ratings), 2)
        useful = [f.is_useful for f in feedbacks if f.is_useful is not None]
        if useful:
            useful_rate = round(sum(useful) / len(useful), 3)

    return L4Stats(
        total_diagnoses=total,
        recent_feedback_count=len(feedbacks),
        avg_rating=avg_rating,
        useful_rate=useful_rate,
    )
